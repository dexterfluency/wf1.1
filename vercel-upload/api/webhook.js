const crypto = require("crypto");

function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verifySignature(secret, rawBody, signature) {
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  return safeEqualHex(hmac, signature);
}

async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function asana(path, method = "GET", body = null) {
  const res = await fetch(`https://app.asana.com/api/1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.ASANA_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Asana ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function frameio(path, method = "GET", body = null) {
  const res = await fetch(`https://api.frame.io/v2${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.FRAMEIO_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Frame.io ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function getProjectRootAssetId(projectId) {
  const project = await frameio(`/projects/${projectId}`);
  if (!project?.root_asset_id) {
    throw new Error(`Frame.io project ${projectId} is missing root_asset_id`);
  }
  return project.root_asset_id;
}

async function listChildren(parentId) {
  const data = await frameio(`/assets/${parentId}/children`);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

async function findOrCreateFolder(parentId, name) {
  const children = await listChildren(parentId);
  const existing = children.find(
    (c) => c?.type === "folder" && c?.name?.toLowerCase() === name.toLowerCase()
  );
  if (existing) return existing.id;

  const created = await frameio(`/assets/${parentId}/children`, "POST", {
    name,
    type: "folder",
  });
  return created.id;
}

async function getTask(taskGid) {
  const data = await asana(
    `/tasks/${taskGid}?opt_fields=name,custom_fields,custom_fields.name,custom_fields.display_value,custom_fields.text_value,custom_fields.enum_value`
  );
  return data.data;
}

function getCustomField(task, fieldName) {
  const field = task.custom_fields?.find(
    (f) => f?.name?.toLowerCase() === fieldName.toLowerCase()
  );
  if (!field) return null;
  return (
    field.display_value ||
    field.text_value ||
    field.enum_value?.name ||
    null
  );
}

async function postComment(taskGid, text) {
  await asana(`/tasks/${taskGid}/stories`, "POST", { data: { text } });
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

module.exports = async function handler(req, res) {
  if (req.headers["x-hook-secret"]) {
    res.setHeader("X-Hook-Secret", req.headers["x-hook-secret"]);
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let rawBody = "";
  try {
    rawBody = await readRawBody(req);
  } catch {
    return res.status(400).json({ error: "Unable to read request body" });
  }
  if (!rawBody && typeof req.body === "string") rawBody = req.body;
  if (!rawBody && req.body && typeof req.body === "object") {
    rawBody = JSON.stringify(req.body);
  }

  const secret = process.env.ASANA_WEBHOOK_SECRET;
  const signature = req.headers["x-hook-signature"];
  if (secret) {
    if (!signature) {
      return res.status(401).json({ error: "Missing signature" });
    }
    if (!verifySignature(secret, rawBody, signature)) {
      return res.status(401).json({ error: "Invalid signature" });
    }
  }

  let events = [];
  try {
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    events = parsed.events || [];
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const projectGid = process.env.ASANA_PROJECT_GID || "1215213597727417";
  const clientFieldName = process.env.ASANA_CLIENT_FIELD_NAME || "Client";

  const newTaskEvents = events.filter(
    (e) =>
      e?.resource?.resource_type === "task" &&
      e?.action === "added" &&
      e?.parent?.gid === projectGid
  );

  if (newTaskEvents.length === 0) {
    return res.status(200).json({ message: "No relevant events" });
  }

  try {
    requireEnv("ASANA_TOKEN");
    requireEnv("FRAMEIO_TOKEN");
    requireEnv("FRAMEIO_SANDBOX_ID");
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const sandboxId = process.env.FRAMEIO_SANDBOX_ID;
  const results = [];

  for (const event of newTaskEvents) {
    const taskGid = event.resource.gid;

    try {
      const sandboxRootAssetId = await getProjectRootAssetId(sandboxId);
      const task = await getTask(taskGid);
      const briefTitle = task.name;
      const client = getCustomField(task, clientFieldName) || "Unknown Client";

      const clientFolderId = await findOrCreateFolder(
        sandboxRootAssetId,
        client
      );
      const briefFolderName = `${client} — ${briefTitle}`;
      const briefFolderId = await findOrCreateFolder(
        clientFolderId,
        briefFolderName
      );

      const folderUrl = `https://app.frame.io/projects/${sandboxId}/folders/${briefFolderId}`;
      const comment = [
        `Frame.io folder created for this brief.`,
        ``,
        `Location: AI Automation Sandbox / ${client} / ${briefFolderName}`,
        `Link: ${folderUrl}`,
      ].join("\n");

      await postComment(taskGid, comment);
      results.push({ taskGid, briefFolderId, folderUrl, status: "ok" });
    } catch (err) {
      results.push({ taskGid, status: "error", error: err.message });
    }
  }

  globalThis.__WF1_LAST_RUN__ = {
    at: new Date().toISOString(),
    processed: results.length,
    results,
  };

  return res.status(200).json({ processed: results.length, results });
};


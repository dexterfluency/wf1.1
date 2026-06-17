const crypto = require('crypto');

const ASANA_API_BASE = 'https://app.asana.com/api/1.0';
const FRAME_API_BASE = 'https://api.frame.io/v4';
const TARGET_ASANA_PROJECT_ID = '1215213597727417';
const FRAME_PROJECT_ID = process.env.FRAMEIO_PROJECT_ID || '6dac5849-43da-466a-a20d-08038d9a9adc';

function timingSafeCompare(left, right) {
  const leftBuffer = Buffer.from(left || '', 'utf8');
  const rightBuffer = Buffer.from(right || '', 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }

  if (typeof req.body === 'string') {
    return Promise.resolve(Buffer.from(req.body, 'utf8'));
  }

  if (req.body && typeof req.body === 'object') {
    return Promise.resolve(Buffer.from(JSON.stringify(req.body), 'utf8'));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sanitizeFolderName(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFieldValue(field) {
  if (!field) {
    return '';
  }

  if (field.display_value) {
    return String(field.display_value).trim();
  }

  if (field.text_value) {
    return String(field.text_value).trim();
  }

  if (field.enum_value && field.enum_value.name) {
    return String(field.enum_value.name).trim();
  }

  if (Array.isArray(field.multi_enum_values) && field.multi_enum_values.length > 0) {
    return field.multi_enum_values
      .map((item) => item && item.name)
      .filter(Boolean)
      .join(', ')
      .trim();
  }

  if (typeof field.number_value === 'number') {
    return String(field.number_value);
  }

  return '';
}

async function readJson(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse JSON response: ${text}`);
  }
}

async function asanaRequest(path, options = {}) {
  const token = process.env.ASANA_TOKEN;

  if (!token) {
    throw new Error('Missing ASANA_TOKEN environment variable.');
  }

  const response = await fetch(`${ASANA_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(`Asana API ${response.status}: ${payload.errors?.[0]?.message || payload.message || 'Unknown error'}`);
  }

  return payload.data;
}

async function frameRequest(path, options = {}) {
  const token = process.env.ADOBE_ACCESS_TOKEN;
  const clientId = process.env.ADOBE_CLIENT_ID;

  if (!token) {
    throw new Error('Missing ADOBE_ACCESS_TOKEN environment variable.');
  }

  const response = await fetch(`${FRAME_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(clientId ? { 'x-api-key': clientId } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(`Frame.io API ${response.status}: ${payload.errors?.[0]?.message || payload.message || 'Unknown error'}`);
  }

  return payload;
}

async function getFrameRootFolderId(accountId) {
  const payload = await frameRequest(`/accounts/${accountId}/projects/${FRAME_PROJECT_ID}`);
  const project = payload.data || payload;

  if (!project.root_folder_id) {
    throw new Error('Frame.io project response did not include root_folder_id.');
  }

  return project.root_folder_id;
}

async function listFrameFolderChildren(accountId, folderId) {
  const payload = await frameRequest(`/accounts/${accountId}/folders/${folderId}/children`);
  return Array.isArray(payload.data) ? payload.data : [];
}

async function createFrameFolder(accountId, parentFolderId, name) {
  const payload = await frameRequest(`/accounts/${accountId}/folders/${parentFolderId}/folders`, {
    method: 'POST',
    body: JSON.stringify({ name })
  });

  return payload.data || payload;
}

async function ensureFrameFolder(accountId, parentFolderId, folderName) {
  const normalizedName = folderName.trim().toLowerCase();
  const children = await listFrameFolderChildren(accountId, parentFolderId);
  const existing = children.find(
    (item) => item.type === 'folder' && String(item.name || '').trim().toLowerCase() === normalizedName
  );

  if (existing) {
    return existing;
  }

  return createFrameFolder(accountId, parentFolderId, folderName);
}

async function fetchAsanaTask(taskGid) {
  const query = new URLSearchParams({
    opt_fields: [
      'name',
      'permalink_url',
      'projects.gid',
      'custom_fields.name',
      'custom_fields.display_value',
      'custom_fields.text_value',
      'custom_fields.number_value',
      'custom_fields.enum_value.name',
      'custom_fields.multi_enum_values.name'
    ].join(',')
  });

  return asanaRequest(`/tasks/${taskGid}?${query.toString()}`);
}

async function postAsanaComment(taskGid, text) {
  return asanaRequest(`/tasks/${taskGid}/stories`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        text
      }
    })
  });
}

function getMatchingTaskEvents(payload) {
  const events = Array.isArray(payload.events) ? payload.events : [];

  return events.filter((event) => {
    const action = String(event.action || '').toLowerCase();
    const resourceType = String(event.resource?.resource_type || event.resource?.type || '').toLowerCase();
    const parentType = String(event.parent?.resource_type || event.parent?.type || '').toLowerCase();
    const parentGid = String(event.parent?.gid || '');

    return (
      action === 'added' &&
      resourceType === 'task' &&
      parentType === 'project' &&
      parentGid === TARGET_ASANA_PROJECT_ID
    );
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  const hookSecret = req.headers['x-hook-secret'];

  if (hookSecret) {
    res.setHeader('X-Hook-Secret', hookSecret);
    return res.status(200).send('');
  }

  const configuredSecret = process.env.ASANA_WEBHOOK_SECRET;

  if (!configuredSecret) {
    return res.status(500).json({ error: 'Missing ASANA_WEBHOOK_SECRET environment variable.' });
  }

  try {
    const rawBody = await readRawBody(req);
    const receivedSignature = req.headers['x-hook-signature'];

    if (!receivedSignature) {
      return res.status(401).json({ error: 'Missing X-Hook-Signature header.' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', configuredSecret)
      .update(rawBody)
      .digest('hex');

    if (!timingSafeCompare(expectedSignature, String(receivedSignature))) {
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    }

    const payload = rawBody.length > 0 ? JSON.parse(rawBody.toString('utf8')) : {};
    const matchingEvents = getMatchingTaskEvents(payload);

    if (matchingEvents.length === 0) {
      return res.status(200).json({ ok: true, message: 'No matching task.added events for the target project.' });
    }

    const accountId = process.env.FRAMEIO_ACCOUNT_ID;

    if (!accountId) {
      throw new Error('Missing FRAMEIO_ACCOUNT_ID environment variable.');
    }

    const rootFolderId = await getFrameRootFolderId(accountId);
    const results = [];

    for (const event of matchingEvents) {
      const taskGid = event.resource?.gid;

      if (!taskGid) {
        continue;
      }

      const task = await fetchAsanaTask(taskGid);
      const clientField = Array.isArray(task.custom_fields)
        ? task.custom_fields.find((field) => String(field.name || '').trim().toLowerCase() === 'client')
        : null;
      const clientName = sanitizeFolderName(extractFieldValue(clientField));

      if (!clientName) {
        await postAsanaComment(
          taskGid,
          'Frame.io folder automation skipped because the Client custom field is empty.'
        );
        results.push({ taskGid, status: 'skipped_missing_client' });
        continue;
      }

      const briefTitle = sanitizeFolderName(task.name || `Task ${taskGid}`);
      const clientFolder = await ensureFrameFolder(accountId, rootFolderId, clientName);
      const briefFolderName = `${clientName} — ${briefTitle}`;
      const briefFolder = await ensureFrameFolder(accountId, clientFolder.id, briefFolderName);
      const folderLink = briefFolder.view_url || clientFolder.view_url || '';
      const folderPath = `${clientName} / ${briefFolderName}`;
      const commentLines = [
        `Frame.io folder ready: ${folderPath}`,
        folderLink ? `Open folder: ${folderLink}` : 'Open folder link unavailable from Frame.io response.'
      ];

      await postAsanaComment(taskGid, commentLines.join('\n'));

      results.push({
        taskGid,
        status: 'processed',
        clientFolderId: clientFolder.id,
        briefFolderId: briefFolder.id,
        folderPath,
        folderLink
      });
    }

    return res.status(200).json({ ok: true, results });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

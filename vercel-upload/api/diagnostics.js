module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const required = ["ASANA_TOKEN", "FRAMEIO_TOKEN", "FRAMEIO_SANDBOX_ID"];
  const missing = required.filter((k) => !process.env[k]);

  const data = {
    ok: missing.length === 0,
    missing,
    config: {
      asanaProjectGid: process.env.ASANA_PROJECT_GID || "1215213597727417",
      asanaClientFieldName: process.env.ASANA_CLIENT_FIELD_NAME || "Client",
      signatureVerificationEnabled: Boolean(process.env.ASANA_WEBHOOK_SECRET),
    },
    runtime: {
      node: process.version,
      uptimeSeconds: process.uptime(),
    },
    lastRun: globalThis.__WF1_LAST_RUN__ || null,
  };

  return res.status(200).json(data);
};


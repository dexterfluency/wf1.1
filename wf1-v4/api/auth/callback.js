const TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const FRAME_ACCOUNTS_URL = 'https://api.frame.io/v4/accounts';
const REDIRECT_URI = 'https://wf11.vercel.app/api/auth/callback';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function parseJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON but received: ${text}`);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }

  const code = req.query.code;

  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }

  const clientId = process.env.ADOBE_CLIENT_ID;
  const clientSecret = process.env.ADOBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res
      .status(500)
      .send('Missing ADOBE_CLIENT_ID or ADOBE_CLIENT_SECRET environment variables.');
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: REDIRECT_URI
    });

    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: body.toString()
    });

    const tokenPayload = await parseJsonResponse(tokenResponse);

    if (!tokenResponse.ok) {
      return res.status(tokenResponse.status).send(
        `Adobe token exchange failed: ${tokenPayload.error_description || tokenPayload.error || 'Unknown error'}`
      );
    }

    const accessToken = tokenPayload.access_token;

    if (!accessToken) {
      return res.status(502).send('Adobe token response did not include access_token.');
    }

    const accountsResponse = await fetch(FRAME_ACCOUNTS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'x-api-key': clientId
      }
    });

    const accountsPayload = await parseJsonResponse(accountsResponse);

    if (!accountsResponse.ok) {
      return res.status(accountsResponse.status).send(
        `Frame.io account lookup failed: ${accountsPayload.message || accountsPayload.error || 'Unknown error'}`
      );
    }

    const accountId = Array.isArray(accountsPayload.data) && accountsPayload.data.length > 0
      ? accountsPayload.data[0].id
      : '';

    if (!accountId) {
      return res.status(502).send('Frame.io accounts response did not include an account id.');
    }

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WF1 v4 Adobe OAuth Success</title>
  <style>
    body { font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 32px; }
    main { max-width: 840px; margin: 0 auto; background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 24px; }
    h1 { margin-top: 0; }
    p { line-height: 1.5; }
    .card { background: #020617; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin-top: 16px; }
    code { display: block; white-space: pre-wrap; word-break: break-word; font-size: 13px; color: #93c5fd; }
  </style>
</head>
<body>
  <main>
    <h1>Adobe OAuth Complete</h1>
    <p>Copy these values into the Vercel environment variables for this project.</p>
    <div class="card">
      <strong>ADOBE_ACCESS_TOKEN</strong>
      <code>${escapeHtml(accessToken)}</code>
    </div>
    <div class="card">
      <strong>FRAMEIO_ACCOUNT_ID</strong>
      <code>${escapeHtml(accountId)}</code>
    </div>
  </main>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (error) {
    return res.status(500).send(`Callback error: ${error.message}`);
  }
};

const ADOBE_AUTHORIZE_URL = 'https://ims-na1.adobelogin.com/ims/authorize/v2';
const REDIRECT_URI = 'https://wf11.vercel.app/api/auth/callback';
const ADOBE_SCOPE = 'openid,AdobeID,frame.io';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }

  const clientId = process.env.ADOBE_CLIENT_ID;

  if (!clientId) {
    return res.status(500).send('Missing ADOBE_CLIENT_ID environment variable.');
  }

  const location = new URL(ADOBE_AUTHORIZE_URL);
  location.searchParams.set('client_id', clientId);
  location.searchParams.set('redirect_uri', REDIRECT_URI);
  location.searchParams.set('scope', ADOBE_SCOPE);
  location.searchParams.set('response_type', 'code');

  res.writeHead(302, { Location: location.toString() });
  res.end();
};

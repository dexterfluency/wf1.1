# wf1-v4

Vercel serverless project that watches Asana project `1215213597727417` and creates a matching folder structure in Frame.io v4.

## What It Does

- Handles the Adobe IMS OAuth flow to obtain a Frame.io v4 access token.
- Returns a callback page that shows `ADOBE_ACCESS_TOKEN` and `FRAMEIO_ACCOUNT_ID`.
- Accepts the Asana webhook handshake by echoing `X-Hook-Secret`.
- Verifies `X-Hook-Signature` using HMAC-SHA256 over the raw request body.
- Filters for `task.added` events in Asana project `1215213597727417`.
- Fetches the new task and reads the `Client` custom field.
- Finds or creates the client folder in Frame.io v4.
- Creates the brief folder as `{Client} — {briefTitle}`.
- Posts the folder path and link back to the Asana task as a comment.

## Project Structure

```text
wf1-v4/
  api/
    webhook.js
    auth/
      login.js
      callback.js
  package.json
  vercel.json
  .env.example
  README.md
  test-webhook.js
```

## Environment Variables

Copy `.env.example` into your Vercel project settings and populate:

```bash
ASANA_TOKEN=
ASANA_WEBHOOK_SECRET=
ADOBE_CLIENT_ID=
ADOBE_CLIENT_SECRET=
FRAMEIO_ACCOUNT_ID=
FRAMEIO_PROJECT_ID=6dac5849-43da-466a-a20d-08038d9a9adc
ADOBE_ACCESS_TOKEN=
```

## Setup

1. Merge the pull request into the work repo. Vercel auto-deploys from the merged branch.
2. In the Vercel dashboard, add all environment variables except `ASANA_WEBHOOK_SECRET` if you have not created the Asana webhook yet.
3. Visit [https://wf11.vercel.app/api/auth/login](https://wf11.vercel.app/api/auth/login) to start the Adobe OAuth flow.
4. Complete Adobe sign-in and copy `ADOBE_ACCESS_TOKEN` and `FRAMEIO_ACCOUNT_ID` from the callback page into Vercel environment variables.
5. Redeploy after saving the OAuth values.
6. Register the Asana webhook with the command below.
7. Copy the returned `X-Hook-Secret` value into `ASANA_WEBHOOK_SECRET` in Vercel and redeploy again.
8. Run the test script to confirm the endpoint accepts signed webhook payloads.

## Register The Asana Webhook

Run this from PowerShell after setting the token:

```powershell
$env:ASANA_TOKEN = "your_asana_token"
curl.exe --request POST `
  --url https://app.asana.com/api/1.0/webhooks `
  --header "Authorization: Bearer $env:ASANA_TOKEN" `
  --header "Content-Type: application/json" `
  --data "{\"data\":{\"resource\":\"1215213597727417\",\"target\":\"https://wf11.vercel.app/api/webhook\"}}"
```

The webhook target responds to the handshake automatically by echoing the `X-Hook-Secret` header. Save that secret into the Vercel env var `ASANA_WEBHOOK_SECRET`, then redeploy.

## End-To-End Test

The included script uses Node.js built-in `https` and signs the payload with `ASANA_WEBHOOK_SECRET`.

```powershell
cd wf1-v4
$env:ASANA_WEBHOOK_SECRET = "your_webhook_secret"
node test-webhook.js
```

To exercise the full downstream flow, pass a real task id that exists in Asana project `1215213597727417`:

```powershell
cd wf1-v4
$env:ASANA_WEBHOOK_SECRET = "your_webhook_secret"
$env:TEST_TASK_GID = "1234567890123456"
node test-webhook.js
```

The script defaults to:

- `WEBHOOK_URL=https://wf11.vercel.app/api/webhook`
- `ASANA_PROJECT_ID=1215213597727417`
- `TEST_TASK_GID=1234567890123456`

## Local Notes

- `api/auth/login.js` redirects to Adobe IMS using the fixed callback URL `https://wf11.vercel.app/api/auth/callback`.
- `api/auth/callback.js` exchanges the Adobe authorization code at `https://ims-na1.adobelogin.com/ims/token/v3`.
- `api/webhook.js` uses `ADOBE_ACCESS_TOKEN` as the bearer token for Frame.io v4 API calls.
- Folder creation is idempotent at both the client and brief levels to reduce duplicate folders on retried webhook deliveries.

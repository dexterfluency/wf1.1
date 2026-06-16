# WF1 — Asana brief created → Frame.io folder created

When a new task is added to a specific Asana project, this function:
1. Reads the task's `Client` custom field
2. Finds or creates a client folder in Frame.io (under your sandbox project)
3. Creates a brief subfolder: `{Client} — {Brief title}`
4. Posts the folder path + direct link as a comment on the Asana task

## Deploy to Vercel
1. Push this repo to GitHub
2. Deploy on Vercel (it will detect the `api/` folder automatically)
3. Set environment variables in Vercel:

| Name | Value |
|------|-------|
| `ASANA_TOKEN` | Asana personal access token |
| `FRAMEIO_TOKEN` | Frame.io API token |
| `FRAMEIO_SANDBOX_ID` | Frame.io project ID that will contain the folders |
| `ASANA_PROJECT_GID` | Asana project GID to listen to (defaults to `1215213597727417`) |
| `ASANA_CLIENT_FIELD_NAME` | Asana custom field name to read (defaults to `Client`) |
| `ASANA_WEBHOOK_SECRET` | Optional: if set, requests must include a valid `X-Hook-Signature` |

## Register the Asana webhook
Your function URL will be:
`https://your-project.vercel.app/api/webhook`

Example registration call:

```bash
curl -X POST https://app.asana.com/api/1.0/webhooks \
  -H "Authorization: Bearer YOUR_ASANA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "resource": "1215213597727417",
      "target": "https://your-project.vercel.app/api/webhook",
      "filters": [
        { "resource_type": "task", "action": "added" }
      ]
    }
  }'
```

Asana will send a handshake request first. The function replies by echoing back `X-Hook-Secret`.

## Folder structure in Frame.io

```
AI Automation Sandbox/
  └── Psycho Bunny/
        └── Psycho Bunny — SS25 Hero/
  └── ALC/
        └── ALC — June Retargeting/
```


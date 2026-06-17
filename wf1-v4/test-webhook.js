const crypto = require('crypto');
const https = require('https');

const webhookUrl = new URL(process.env.WEBHOOK_URL || 'https://wf11.vercel.app/api/webhook');
const webhookSecret = process.env.ASANA_WEBHOOK_SECRET;
const taskGid = process.env.TEST_TASK_GID || '1234567890123456';
const projectGid = process.env.ASANA_PROJECT_ID || '1215213597727417';

if (!webhookSecret) {
  console.error('Missing ASANA_WEBHOOK_SECRET environment variable.');
  process.exit(1);
}

const payload = JSON.stringify({
  events: [
    {
      action: 'added',
      created_at: new Date().toISOString(),
      parent: {
        gid: projectGid,
        resource_type: 'project'
      },
      resource: {
        gid: taskGid,
        resource_type: 'task'
      },
      user: {
        gid: '0',
        resource_type: 'user'
      }
    }
  ]
});

const signature = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');

const request = https.request(
  {
    protocol: webhookUrl.protocol,
    hostname: webhookUrl.hostname,
    port: webhookUrl.port || 443,
    path: `${webhookUrl.pathname}${webhookUrl.search}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'X-Hook-Signature': signature
    }
  },
  (response) => {
    let responseBody = '';

    response.on('data', (chunk) => {
      responseBody += chunk.toString('utf8');
    });

    response.on('end', () => {
      console.log(`Status: ${response.statusCode}`);
      console.log(responseBody || '<empty>');
    });
  }
);

request.on('error', (error) => {
  console.error(`Request failed: ${error.message}`);
  process.exit(1);
});

request.write(payload);
request.end();

# Firebase Push Notifications

To enable native push notifications (iOS/Android) for your self-hosted OneUptime instance, you need to configure Firebase Cloud Messaging (FCM). This allows OneUptime to send push notifications to mobile app users.

## Prerequisites

- Google account with access to [Firebase Console](https://console.firebase.google.com)
- Access to your OneUptime server configuration
- OneUptime mobile app installed on user devices

## Setup Instructions

### Step 1: Create a Firebase Project

1. Go to the [Firebase Console](https://console.firebase.google.com)
2. Click **"Create a project"** (or select an existing project)
3. Enter a project name (e.g., "OneUptime Notifications")
4. Follow the prompts to complete project creation

### Step 2: Generate a Service Account Key

1. In your Firebase project, go to **Project Settings** (gear icon in the top-left)
2. Click the **"Service accounts"** tab
3. Click **"Generate new private key"**
4. Confirm by clicking **"Generate key"**
5. A JSON file will be downloaded automatically — keep this file secure

### Step 3: Extract Values from the JSON File

Open the downloaded JSON file. You will need three values:

```json
{
  "project_id": "your-project-id",
  "client_email": "firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
}
```

Map these to the OneUptime environment variables:

| JSON Field | Environment Variable |
|------------|---------------------|
| `project_id` | `FIREBASE_PROJECT_ID` |
| `client_email` | `FIREBASE_CLIENT_EMAIL` |
| `private_key` | `FIREBASE_PRIVATE_KEY` |

### Step 4: Configure OneUptime

#### Docker Compose

Add these environment variables to your `config.env` file:

```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
```

**Note:** The private key contains newlines. Wrap it in double quotes in your env file.

#### Kubernetes with Helm

Add these to your `values.yaml` file:

```yaml
firebase:
  projectId: "your-project-id"
  clientEmail: "firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com"
  privateKey: "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
```

**Important:** Restart your OneUptime server after adding these environment variables so they take effect.

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `FIREBASE_PROJECT_ID` | The Firebase project ID from the service account JSON | Yes |
| `FIREBASE_CLIENT_EMAIL` | The service account email from the JSON file | Yes |
| `FIREBASE_PRIVATE_KEY` | The RSA private key from the JSON file (contains newlines) | Yes |

## Troubleshooting

### Common Issues

**Push notifications not being delivered:**
- Verify all three environment variables are set correctly
- Ensure the private key includes the `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----` markers
- Check that the service account has the necessary permissions in Firebase
- Restart your OneUptime server after changing configuration

**"Invalid credentials" error:**
- Double-check that `FIREBASE_PROJECT_ID` matches the `project_id` in your JSON file
- Verify `FIREBASE_CLIENT_EMAIL` matches the `client_email` exactly
- Ensure the private key is properly quoted and newlines are preserved

**"Service account not found" error:**
- The service account may have been deleted in the Firebase Console
- Generate a new service account key and update your configuration

## Security Best Practices

1. **Keep the service account key secure** — never commit it to version control
2. **Limit service account permissions** — the default Firebase Admin SDK role is sufficient
3. **Rotate keys periodically** — generate new service account keys and update your configuration
4. **Monitor usage** — check the Firebase Console for unusual notification activity

## Support

If you encounter issues with Firebase push notifications, please:

1. Check the troubleshooting section above
2. Review the OneUptime logs for detailed error messages
3. Contact us at [hello@oneuptime.com](mailto:hello@oneuptime.com)

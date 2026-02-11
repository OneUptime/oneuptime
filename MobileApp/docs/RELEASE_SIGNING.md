# Mobile App Release Signing Setup

This guide explains how to generate and configure the signing credentials required for automated Android APK and iOS IPA builds in the GitHub Actions release workflow.

---

## Android Secrets

### 1. Generate a release keystore

Run the following command to create a new `.jks` keystore:

```bash
keytool -genkeypair \
  -v \
  -storetype JKS \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass <your-store-password> \
  -keypass <your-key-password> \
  -alias <your-key-alias> \
  -keystore release.keystore \
  -dname "CN=OneUptime, OU=Mobile, O=OneUptime, L=City, ST=State, C=US"
```

Replace `<your-store-password>`, `<your-key-password>`, and `<your-key-alias>` with your chosen values. Keep these safe -- you will need them as secrets.

### 2. Base64-encode the keystore

```bash
base64 -i release.keystore -o release.keystore.b64
cat release.keystore.b64
```

On Linux use `base64 release.keystore` instead.

### 3. Add Android secrets to GitHub

Go to **Settings > Secrets and variables > Actions** in your GitHub repository and add:

| Secret name | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Contents of `release.keystore.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | The `<your-store-password>` you chose |
| `ANDROID_KEY_ALIAS` | The `<your-key-alias>` you chose |
| `ANDROID_KEY_PASSWORD` | The `<your-key-password>` you chose |

---

## iOS Secrets

### Prerequisites

- An [Apple Developer Program](https://developer.apple.com/programs/) membership (paid, $99/year)
- Xcode installed locally (for initial certificate and profile generation)
- Access to [App Store Connect](https://appstoreconnect.apple.com) and the [Apple Developer portal](https://developer.apple.com/account)

### 1. Create a Distribution Certificate

#### Option A: Using Xcode (recommended)

1. Open **Xcode > Settings > Accounts**
2. Select your Apple ID and your team
3. Click **Manage Certificates**
4. Click the **+** button and select **Apple Distribution**
5. Xcode will create the certificate and install it in your local Keychain

#### Option B: Using the Apple Developer portal

1. Go to [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list)
2. Click **+** to create a new certificate
3. Select **Apple Distribution** and click Continue
4. Upload a Certificate Signing Request (CSR):
   - Open **Keychain Access > Certificate Assistant > Request a Certificate From a Certificate Authority**
   - Fill in your email, set "Common Name" to something like "OneUptime Distribution"
   - Select **Saved to disk**, click Continue, and save the `.certSigningRequest` file
5. Upload the CSR, download the generated `.cer` file
6. Double-click the `.cer` file to install it in your Keychain

### 2. Export the certificate as .p12

1. Open **Keychain Access**
2. In the **login** keychain under **My Certificates**, find your **Apple Distribution** certificate
3. Expand it to verify the private key is attached
4. Right-click the certificate and select **Export...**
5. Choose **Personal Information Exchange (.p12)** format
6. Set an export password -- you will need this as a secret
7. Save the file (e.g., `distribution.p12`)

### 3. Base64-encode the certificate

```bash
base64 -i distribution.p12 -o distribution.p12.b64
cat distribution.p12.b64
```

### 4. Create an App ID

If you haven't already:

1. Go to [Identifiers](https://developer.apple.com/account/resources/identifiers/list) in the Apple Developer portal
2. Click **+**, select **App IDs**, then **App**
3. Set the Bundle ID to `com.oneuptime.oncall` (Explicit)
4. Enable any capabilities your app uses (e.g., Push Notifications)
5. Click **Register**

### 5. Create a Provisioning Profile

1. Go to [Profiles](https://developer.apple.com/account/resources/profiles/list) in the Apple Developer portal
2. Click **+** to create a new profile
3. Select **App Store Connect** (under Distribution) and click Continue
4. Select the App ID `com.oneuptime.oncall`
5. Select the distribution certificate you created in step 1
6. Name the profile **OneUptime Distribution** (this must match the value in `ExportOptions.plist`)
7. Click **Generate** and download the `.mobileprovision` file

### 6. Base64-encode the provisioning profile

```bash
base64 -i OneUptime_Distribution.mobileprovision -o profile.b64
cat profile.b64
```

### 7. Find your Team ID

1. Go to [Apple Developer Membership](https://developer.apple.com/account/#/membership/)
2. Your **Team ID** is listed on this page (a 10-character alphanumeric string)

### 8. Add iOS secrets to GitHub

Go to **Settings > Secrets and variables > Actions** in your GitHub repository and add:

| Secret name | Value |
|---|---|
| `IOS_DISTRIBUTION_CERTIFICATE_BASE64` | Contents of `distribution.p12.b64` |
| `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD` | The password you set when exporting the `.p12` |
| `IOS_PROVISIONING_PROFILE_BASE64` | Contents of `profile.b64` |
| `IOS_TEAM_ID` | Your 10-character Apple Team ID |

---

## Verifying the setup

Once all secrets are configured, push to the `release` branch. The workflow will:

1. Build Docker images and run E2E tests (existing steps)
2. Create a draft GitHub Release
3. Build the Android APK (`mobile-app-android-deploy` job)
4. Build the iOS IPA (`mobile-app-ios-deploy` job)
5. Upload both binaries to the draft release
6. Publish the release after all jobs succeed

Check the **Actions** tab in GitHub to monitor each job. If a signing job fails, the error logs will usually indicate whether the issue is with the certificate, provisioning profile, or keystore.

---

## Renewing credentials

- **Android keystore**: Does not expire (validity is set at creation time, typically 10,000 days). No action needed unless compromised.
- **iOS Distribution Certificate**: Valid for 1 year. When it expires, create a new one following the steps above, export a new `.p12`, and update `IOS_DISTRIBUTION_CERTIFICATE_BASE64` and `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`.
- **iOS Provisioning Profile**: Valid for 1 year. Regenerate it in the Developer portal, re-encode, and update `IOS_PROVISIONING_PROFILE_BASE64`. The profile must reference a valid (non-expired) distribution certificate.

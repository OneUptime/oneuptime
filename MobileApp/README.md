# OneUptime Mobile App

This directory contains the React Native application built with Expo (SDK 52).

## Local development

```bash
npm ci
npm run lint
npm run typecheck
npm run test -- --watch=false
npm run start
```

## Expo / EAS configuration

The project uses [Expo Application Services (EAS)](https://docs.expo.dev/eas/) for cloud builds and updates. Profiles are defined in [`eas.json`](./eas.json):

- `development` &ndash; Internal distribution with a development client
- `preview` &ndash; Internal distribution for QA
- `production` &ndash; Store-ready builds used by the automation workflow

## GitHub Actions workflow

The workflow defined in [`.github/workflows/mobile-app.yml`](../.github/workflows/mobile-app.yml) provides:

- **Build checks** (lint, type-check, tests) on pushes and pull requests touching `MobileApp/`
- **Manual publish job** that can be triggered via **Run workflow** in GitHub
  - Starts an EAS build for the selected platform and profile
  - Optionally publishes an EAS Update (`expo update`) and submits the latest build to the app stores using `eas submit`

### Required secrets

Add the following GitHub repository or environment secrets before running the publish job:

| Secret | Purpose |
| --- | --- |
| `EXPO_TOKEN` | Expo access token with rights to trigger EAS builds and publish updates |
| `EAS_APPLE_APP_SPECIFIC_PASSWORD` | (Optional) Needed for iOS submission via `eas submit` |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | (Optional) Needed for Android submission via `eas submit` |

Set any additional credentials referenced by your EAS project configuration as repository or environment secrets.

### Triggering a publish

Use **Actions &rarr; Mobile App Build & Publish &rarr; Run workflow**, then select:

- Platform: `android`, `ios`, or `all`
- Build profile: matches one defined in `eas.json` (default `production`)
- Channel & branch: used if you choose to publish an EAS Update
- Whether to submit the build to the stores and/or publish an update

The job waits for the remote build to finish and outputs download links in the workflow summary.

## Troubleshooting

- Ensure the Expo SDK version in `package.json` matches the CLI version pinned in `eas.json`
- If the publish job fails with authentication errors, confirm that `EXPO_TOKEN` has not expired and that credentials for the selected store submission are present
- Use `npm run start` for local debugging with the Expo dev client

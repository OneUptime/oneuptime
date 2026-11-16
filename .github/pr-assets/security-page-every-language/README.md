# User Profile > Security in every language

These images show User Profile > Security after #8796: the Two-factor authentication page (its
status, Security keys, Authenticator apps and Backup codes cards) and the Passkeys page. Each is
the real production page (`Pages/Global/UserProfile/Layout.tsx` with `TwoFactorAuth.tsx` or
`Passkeys.tsx`) rendered offline by the fixture in `packages/E2E/SecurityPage/Fixture`, for a
synthetic account ("Maya Chen") with two-factor authentication on, an authenticator app ready and
one whose setup is incomplete, a security key, two passkeys and seven of ten backup codes left.

Each image comes from the Playwright suite in `packages/E2E/SecurityPage`
(`cd packages/E2E && CI=1 npm run test-security-page-ui`; the images land in
`output/playwright/security-page-ui/`), at 1440 px unless named otherwise.

- `two-factor-en.png`, `two-factor-de.png`, `two-factor-ar.png`, `two-factor-fa.png`: the
  Two-factor authentication page in English, German, Arabic and Persian. Arabic and Persian read
  right to left, the side menu on the right.
- `passkeys-en.png`, `passkeys-de.png`, `passkeys-ar.png`, `passkeys-fa.png`: the Passkeys page in
  the same four languages.
- `two-factor-new-fa-dark.png`: an account with nothing set up yet, in Persian and the dark theme:
  each card's empty state, and Generate backup codes.
- `regenerate-de.png`: the confirmation Regenerate codes asks for first, in German, with two codes
  left.
- `two-factor-ar-phone.png`: the Arabic page at 390 px.

The words of the twelve languages that read in English before #8796 (Danish, French, Hindi,
Italian, Korean, Dutch, Norwegian, Portuguese, Russian, Swedish, Simplified and Traditional
Chinese) are held by `packages/App/Tests/Dashboard/SecurityPageWordsInEveryLanguage.test.ts`.

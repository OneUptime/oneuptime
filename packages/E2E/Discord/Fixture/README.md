# Discord installation acceptance tests

Standard: googledev-style.

This fixture replaces Discord's external HTTPS API while exercising the real
OneUptime browser, authenticated routes, services, and PostgreSQL persistence.
It uses the fixed `discord.com` hostname, a disposable CA, and an internal Docker
network. It never configures a production endpoint override or contacts Discord.

## Prerequisites

- Docker Compose and a Docker filesystem with at least 20 GiB available.
- A committed source revision. The app build freezes `git archive HEAD`; commit
  the proposed changes before comparing the built app with acceptance tests.
- Debian-based container images. Downloads and build layers use Docker storage.
- No existing `oneuptime-discord-e2e` project or `.scratch/discord-e2e` directory.
  The launcher refuses to replace an existing fixture's credentials or evidence.

## Run the isolated stack

From the repository root:

```bash
bash packages/E2E/Discord/Fixture/local-stack.sh prepare
bash packages/E2E/Discord/Fixture/local-stack.sh build
bash packages/E2E/Discord/Fixture/local-stack.sh start
bash packages/E2E/Discord/Fixture/local-stack.sh test --grep-invert 'excess requests|rate counter is unavailable'
```

The stack publishes no host ports. The browser reaches the application through
`http://oneuptime.test:7849`, using OneUptime's nginx rewrite configuration.
Direct requests to the app port do not reproduce browser identity routing.

The runner imports the disposable CA into Chromium's NSS trust database and
Node's trust store. TLS verification stays enabled. Generated client credentials,
bot token, CA keys, and interaction signing key are local test values. They stay
in ignored configuration or dedicated Docker volumes.

The `oneuptime-discord-e2e_evidence` volume contains HTML, JSON, screenshots,
Playwright traces, sanitized provider transcripts, and persisted binding evidence.
Build logs and the source revision are retained separately in that volume.

Run the rate-limit test separately with fresh disposable Redis state. Its default
is 600 accepted setup requests followed by HTTP 429. The unavailable-counter test
requires stopping only this project's Redis service and setting
`DISCORD_E2E_REDIS_UNAVAILABLE=true` in the test runner. Restore Redis afterward.
Never point these tests at a deployed OneUptime instance.

```bash
bash packages/E2E/Discord/Fixture/local-stack.sh stop
```

Stopping retains evidence and database volumes. Deleting this disposable project
is a separate operation; the launcher never removes volumes automatically.

## Evidence limits

A fixture pass demonstrates the app's contract with a modeled Discord server.
It does not prove Discord's live OAuth consent screen, installed application
configuration, or gateway delivery. Record live transport checks separately.

The original baseline at `17084e6b236afe4cb5cdfcf96cef31ab08044559` failed the
config, installation, callback, and generic identity-creation expectations after
successful browser signup and project creation. The initial direct-app run failed
onboarding because `/identity/signup` requires nginx's rewrite; that setup failure
is not feature evidence.

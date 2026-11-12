## Local development

- OneUptime runs locally under Docker Compose, served at the `HOST` set in `config.env` (copied from `config.example.env`). Database credentials are in `config.env` too.
- Containers hot-reload when you change code. Wait for the restart before you test.

## Writing code

- Put every import at the top of the file. Don't worry about circular dependencies.

### Keep OneUptime simple to use

Every UI change must be easy to understand and must look great. Show what most people need first, with sensible defaults, and fold advanced settings away (for example into a collapsed Advanced section) so nobody faces choice paralysis.

Before you build or change a page, a form, a dialog, a menu or the words on one, read the UX rulebook, [Docs/ux/README.md](Docs/ux/README.md): every rule, with the guard test that enforces it. A new UX guard starts with `// UX rule: Docs/ux/README.md#<section>` and its rule goes in that section (`UxRulebookInStep` fails otherwise).

### Migrations

Postgres:

- Never write a migration by hand. Run `npm run generate-postgres-migration`.
- Register the generated class in `packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts` (import it at the top, append it to the default export array). A migration that is not registered never runs.
- Run `npm run check-postgres-schema-drift`, which prints any statements still missing. CI's "Postgres Schema Drift" workflow runs the same check.
- `CREATE INDEX` or `ADD CONSTRAINT ... FOREIGN KEY` on an existing table blocks its writers. Move those statements into a migration of their own with `public transaction: boolean = false;` and pass each one, as generated, to `OnlineDdl.createIndex` / `OnlineDdl.addForeignKey` (`packages/Common/Server/Infrastructure/Postgres/OnlineDdl.ts`). `SchemaMigrationsOnlineDdl` enforces this.

ClickHouse migrations are written by hand in `packages/App/FeatureSet/Workers/DataMigrations`, following the existing ones and registered in that folder's `Index.ts`.

### Feed and chat Markdown

Feed items and Slack / Microsoft Teams messages are Markdown that carries people's text: names, titles, labels, rule names. Write it with the `mdText` tag from `packages/Common/Utils/Markdown/FeedMarkdown.ts`. It escapes every value for where it sits, and places a `MarkdownText` as it is, so nothing is escaped twice.

- Join pieces with `FeedMarkdown.join` / `bulletList` / `numberedList`, not `Array.join` or `+`. Never turn a `MarkdownText` into a string to place it again.
- Markdown a person wrote goes in with `FeedMarkdown.asMarkdown`, OneUptime AI's with `FeedMarkdown.aiWritten` (`aiWrittenForTeams` for the Teams bot), and text from outside OneUptime with `FeedMarkdown.writtenOutside` / `reportedValue`.
- Only `packages/Common/Utils/Markdown/` imports `MarkdownEscape` or `UntrustedMarkdown`.

`FeedAndChatPlainTextEscapedGuard` (`packages/Common/Tests/Server/Services`) enforces this for every feed and chat sink, including `ee/Server`.

### Megabyte-long values

Text from monitored systems and people can be megabytes on one line (a synthetic monitor's base64 screenshot, a response body, a pasted log) or a paragraph of 100,000 lines. Everything that handles it must run in linear time:

- No regular expression with an unbounded quantifier over such text: a long-running V8 process runs out of stack on a few megabytes ("Maximum call stack size exceeded"). Scan with a loop or `indexOf` (like `isBase64` in `packages/Common/Utils/Markdown/InlineImageDataUri.ts`), and give a regular expression that can cross lines a bounded quantifier (`{0,65536}`, as in `Markdown.convertToPlainText`).
- Markdown parsers (marked for emails, remark for the Dashboard, slackify for Slack) break or slow down on long or oddly shaped text. Before one reads it, hold back what is too long or too slow with `holdBackBase64Data` (`Base64Data.ts`), `holdBackOverLongText` (`OverLongText.ts`) and `holdBackSlowMarkdown` (`SlowMarkdown.ts`) in `packages/Common/Utils/Markdown/`; their headers explain the limits. A new converter does the same, and a newly found slow shape gets counted in `SlowMarkdown.ts`.
- Cut chat Markdown before a converter reads it (Slack: `cutMarkdown`; Teams: `MicrosoftTeamsMessageSize.fitMarkdownText`), and hold every message to what its channel takes, ending a cut one with "… (truncated — see OneUptime for the full text)": emails (`packages/Common/Server/Utils/Mail/EmailSize.ts`), Teams cards (`fitAdaptiveCard`), and SMS, call, push, WhatsApp, Telegram and Discord messages (`packages/Common/Utils/MessageFit.ts`, `TelegramMessageFit.ts`, `WhatsAppTemplateFit.ts`). A new channel or sender does the same.
- Test under `node --no-regexp-optimization`, the state a long-running process reaches. A new converter of notification text gets a timed entry in `HugeTextInLongRunningProcess.test.ts` (`packages/Common/Tests/Server/Types`); screenshots in emails are covered by `ScreenshotEmailInLongRunningProcess.test.ts` (`packages/Common/Tests/Server/Utils/Mail`).

### Emails load nothing from outside the installation

Emails are read offline and behind gateways that flag remote images, and a remote image tells whoever serves it who opened the email. So an email's markup loads nothing it does not carry: no CDN, web font, tracking pixel or other address spelled out in a template or in the code that writes email markup. The only host a template names is `oneuptime.com`, in the footer link of an installation that is not renamed.

- OneUptime's logo (`oneUptimeLogoUrl`, `packages/Common/Server/Utils/Mail/EmailLogo.ts`) and screenshots go out as inline attachments the HTML points at by Content-ID (`EmailInlineImages.ts`).
- A logo an operator uploaded is an address the installation builds on its own host; small PNG, JPEG and GIF logos go inside the email when it is sent (`EmailCarriedLogos.ts`).

`OfflineAssetHygiene.test.ts` (`packages/Common/Tests/Server/Utils`) reads every email template and the code that writes email markup; `EmailsLoadNothingFromOutside.test.ts` (`packages/App/Tests/Notification`) renders and sends every template on every transport.

## After you make a change

- Lint only the files you changed, by passing their paths to `npx eslint --fix` from the repository root. Never run `npm run lint`, `npm run fix-lint` or `npm run fix`: they lint the whole project.
- Run `npm run compile` in every package you changed.
- Commit often, in small commits of logically related changes with messages that say why: they make a bug easier to trace and cost less when a session is interrupted.

### Tests

- Write extensive tests: unit and integration tests for a new feature, a regression test for a bug fix.
- Run only the tests relevant to your change: the ones you added or changed, and the ones that read or scan the files you changed (search the test folders for those files' paths and names). Never run whole test folders or packages (such as `packages/App/Tests/Dashboard`, `packages/Common/Tests/UI`, `packages/App/Tests/FeatureSet/Docs` or the `packages/Home` tests), and don't re-run them after merging `main` into your branch. CI runs everything, and failures on `main` are fixed together there.
- Random inputs for property tests, fuzz sweeps and generated fixtures come from `seededRandom(seed)` and `shuffled` in `packages/Common/Tests/Helpers/SeededRandom.ts`, and generated texts from `generatedTexts` in `packages/Common/Tests/Helpers/GeneratedTexts.ts`, so every failure can be run again. Don't write a generator of your own: `SeededRandomGuard.test.ts` fails a test file that rolls an LCG, mulberry32 or xorshift.
- Helm charts (`HelmChart/Public/oneuptime`, the product; `HelmChart/Public/kubernetes-agent`, the Kubernetes agent): `npm run test-helm-chart` runs their helm-unittest tests, and `npm run test-helm-chart-all` adds lint and the KinD-cluster suites in `HelmChart/Tests/suites` ([HelmChart/README.md](HelmChart/README.md) says how to add one). The agent chart writes the OpenTelemetry collector configuration, where a mistake shows up as wrong data rather than a failed deploy: cover a change there with a render assertion.

## Pull requests

### Release notes

`Scripts/Release/GenerateReleaseNotes.js` writes each release's notes from the title of every pull request it ships (and the subject of every commit pushed straight to `main`), so a title is a line people read on the release page. Write it as `type(area): what changed, for the person using OneUptime`, not what the code does.

- `feat`, `fix`, `perf` and `docs` each get a section. `test`, `ci`, `chore`, `refactor`, `style` and `build`, and areas of the repository rather than the product (`fix(ci): ...`; `INTERNAL_AREAS` in the script), go under the folded Maintenance section.
- The area is the product's name (`exceptions`, `on-call`, `status-pages`). A title with no type can open with its area instead (`Workflows: every template in five steps`) and lands under New and improved.
- A `!` after the type or scope (`feat(helm)!: ...`) lists the change under Breaking changes, at the top. Use it whenever an upgrade asks something of the person upgrading.
- A label wins over the title (`bug`, `enhancement`, `documentation`, `dependencies`), and `ignore` leaves a pull request out.

### Follow-ups

File a GitHub issue for anything you notice outside your current task:

- A bug: labels `follow-up` and `bug`.
- Something that should be improved: labels `follow-up` and `enhancement`.

When your current task is done, fix the bug follow-ups you filed, then the important enhancement ones, in pull requests separate from your current one. Enhancement follow-ups that aren't important can stay open as issues.

## Read the guide before you touch these

Apps, listings and consoles outside this repository (Slack, Microsoft Teams, GitHub, the marketplaces, Google Cloud) don't change when code merges. Each guide says what to change by hand and in which order, how to test it end to end, and which steps only a maintainer may do.

- **Releases**: [RELEASING.md](RELEASING.md). While a release is in flight, `Scripts/Release/PrioritizeReleaseRuns.sh` cancels every other workflow run.
- **Mobile app builds and store releases**: [packages/MobileApp/RELEASING.md](packages/MobileApp/RELEASING.md).
- **Slack app** (`packages/Common/Server/Utils/Workspace/Slack/app-manifest.json`, or the scopes and events the code relies on): [Slack guide](packages/Common/Server/Utils/Workspace/Slack/RELEASING.md).
- **Microsoft Teams app** (`MicrosoftTeamsAPI.getTeamsAppManifest()`, or the Microsoft Graph permissions the code relies on): [Microsoft Teams guide](packages/Common/Server/Utils/Workspace/MicrosoftTeams/RELEASING.md).
- **GitHub Apps** (a permission, webhook event, callback or route the code needs from them, or their GitHub Marketplace listing): [GitHub App guide](packages/Common/Server/Utils/CodeRepository/GitHub/RELEASING.md).
- **OneUptime Cloud on AWS Marketplace and Microsoft Marketplace** (`ee/Server/CloudMarketplace`, `packages/Common/Server/Utils/Marketplace`, Sign in with Microsoft in `packages/Common/Server/Utils/MicrosoftSignIn`, usage prices, seller portals): [cloud marketplace guide](packages/Common/Server/Utils/Marketplace/RELEASING.md). OneUptime Cloud is not on Google Cloud Marketplace, which lists only SaaS hosted on Google Cloud.
- **Vercel Marketplace** (`ee/Server/CloudMarketplace/Vercel`, `ee/Server/CloudMarketplace/API`, the Telemetry log drain, Vercel's Integration Console): [Vercel Marketplace guide](packages/Common/Server/Utils/Marketplace/VERCEL_RELEASING.md).
- **Self-hosted OneUptime Enterprise on AWS, Microsoft and Google Cloud marketplaces** (`ee/Server/Marketplace`, `ee/Server/License`, `HelmChart/Marketplace`, the `enterpriseMarketplace` chart values, `.github/workflows/marketplace-release.yml`): [self-hosted marketplace guide](packages/Common/Server/Utils/Marketplace/SELF_HOSTED_RELEASING.md).
- **Continue with Google** (`packages/Common/Server/Utils/GoogleSignIn`, `packages/App/FeatureSet/Identity/Utils/ProviderSignIn.ts`, the Google OAuth client): [Continue with Google guide](packages/Common/Server/Utils/GoogleSignIn/RELEASING.md).
- **Infrastructure agent packages** (`agents/InfrastructureAgent/.goreleaser.yaml`, `Scripts/PackageManagers`, the `publish-infrastructure-agent-*` jobs in `.github/workflows/release.yml`): [package manager guide](Scripts/PackageManagers/README.md). To check on a release of the agent: [agents/InfrastructureAgent/RELEASING.md](agents/InfrastructureAgent/RELEASING.md).
- **Iron Bank** (`IronBank/`, `Scripts/IronBank/`, `.github/workflows/iron-bank.yml`): [IronBank/README.md](IronBank/README.md). Its Dockerfiles mirror the release images, so a change to `packages/App/Dockerfile.tpl`, `packages/Nginx/Dockerfile.tpl`, `packages/Runner/Dockerfile.tpl` or `packages/Probe/Dockerfile.tpl` (anything the image runs, sets, installs, copies or builds) fails `Tests/Ops/IronBankApp.test.js` or `IronBankProjects.test.js` until the matching `IronBank/` Dockerfile does the same.

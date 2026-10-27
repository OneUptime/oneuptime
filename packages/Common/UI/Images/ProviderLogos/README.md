# Logos of other companies' products

The official logos OneUptime shows next to a third-party product's name: the
storage an audit log export or a backup goes to, the security tools a project
connects, its clouds and AI providers, Slack and Microsoft Teams, the tools
Import from another tool reads, the languages the telemetry guide instruments.
`Common/Types/ProviderLogo/ProviderLogo.ts` names them; the component that draws
them is `Common/UI/Components/ProviderLogo/ProviderLogoImage.tsx`, which loads
each file by itself (`ProviderLogoAssets.ts`), the first time a page shows it.

## Rules every file here follows

- **Official.** Each file is the brand's own mark: from the brand's own kit,
  icon set or site, or from a collection that reproduces it faithfully -
  [Simple Icons](https://simpleicons.org) (CC0) or
  [SVG Logos](https://github.com/gilbarbara/logos) (CC0). The collections'
  licences cover the drawings; the marks stay their owners' trademarks.
- **Unaltered.** Never recoloured, redrawn, cropped into another shape,
  stretched or rotated. The only changes are an optimiser's (`svgo`, which keeps
  the drawing, the colours and the viewBox) and, for a lockup of a symbol and a
  wordmark, keeping the symbol on its own the way the brand's own icon does.
- **A mark for dark backgrounds only where the brand has one.** A `-dark` file
  is drawn on the dark theme instead of a mark that would all but disappear on
  it (black, dark navy): the brand's reversed logo (AWS's white lettering with
  its orange smile), or its one-colour mark in white, which every one of these
  brands publishes for dark backgrounds.
- **Local.** Every file is part of the installation. Nothing here, and nothing
  that draws these files, loads anything from another address: an installation
  without the internet draws every logo, and no brand learns who opened a page.
- **Named.** Every logo is shown with the product's name beside it (an image
  without words has the name as its accessible name), as the brands ask: a logo
  identifies their product, never OneUptime's.

`Common/Tests/UI/Components/ProviderLogo` holds every file to these rules: each
registered logo has its file (and its dark file where one is listed), every file
is registered and listed below, and no file reaches outside itself.

## Sources and the brands' rules

| File | Product | Source | The brand's rules |
| ---- | ------- | ------ | ----------------- |
| `amazon-s3.svg` | Amazon S3 | AWS Architecture Icons (2026-07 package), Simple Storage Service | [AWS Trademark Guidelines](https://aws.amazon.com/trademark-guidelines/), [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/) |
| `amazon-bedrock.svg` | Amazon Bedrock | AWS Architecture Icons (2026-07 package), Amazon Bedrock | as above |
| `aws-security-hub.svg` | AWS Security Hub | AWS Architecture Icons (2026-07 package), AWS Security Hub | as above |
| `aws.svg`, `aws-dark.svg` | Amazon Web Services | SVG Logos, `aws`; dark: AWS's reversed logo (white lettering, orange smile) | [AWS Trademark Guidelines](https://aws.amazon.com/trademark-guidelines/) |
| `azure.svg` | Microsoft Azure | Azure Public Service Icons V24, Azure | [Azure icons terms](https://learn.microsoft.com/azure/architecture/icons/), [Microsoft Trademark and Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks) |
| `azure-blob-storage.svg` | Azure Blob Storage | Azure Public Service Icons V24, Storage Accounts | as above |
| `azure-openai.svg` | Azure OpenAI | Azure Public Service Icons V24, Azure OpenAI | as above |
| `microsoft-sentinel.svg` | Microsoft Sentinel | Azure Public Service Icons V24, Azure Sentinel | as above |
| `microsoft-defender.svg` | Microsoft Defender | Microsoft's Defender icon (2025), as Wikimedia Commons keeps it from microsoft.com | [Microsoft Trademark and Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks) |
| `microsoft-teams.svg` | Microsoft Teams | Microsoft's Teams icon (2025), as Wikimedia Commons keeps it from microsoft.com | as above |
| `microsoft-copilot.svg`, `microsoft-copilot-dark.svg` | Microsoft Copilot | Microsoft's one-colour Copilot icon, as Wikimedia Commons keeps it from Microsoft's documentation; dark: in white | as above |
| `google-cloud.svg` | Google Cloud | SVG Logos, `google-cloud` | [Google brand resources](https://about.google/brand-resource-center/) |
| `google-cloud-storage.svg` | Google Cloud Storage | Google Cloud product icons ([cloud.google.com/icons](https://cloud.google.com/icons)), Cloud Storage | as above |
| `google-vertex-ai.svg` | Vertex AI | Google Cloud product icons, Vertex AI | as above |
| `google-security-operations.svg` | Google Security Operations | Google Cloud product icons, Security Operations | as above |
| `google-meet.svg` | Google Meet | SVG Logos, `google-meet` | as above |
| `cloudflare.svg` | Cloudflare | SVG Logos, `cloudflare-icon` | [Cloudflare trademark](https://www.cloudflare.com/trademark/) |
| `backblaze.svg` | Backblaze | Simple Icons, `backblaze` | [Backblaze press](https://www.backblaze.com/company/news.html) |
| `wasabi.svg` | Wasabi | Simple Icons, `wasabi` | [wasabi.com](https://wasabi.com) |
| `minio.svg` | MinIO | Simple Icons, `minio` | [MinIO logo](https://min.io/logo) |
| `crowdstrike.svg`, `crowdstrike-dark.svg` | CrowdStrike | CrowdStrike's falcon from crowdstrike.com (`CS_Logo_Falcon.svg`); dark: in white | [CrowdStrike](https://www.crowdstrike.com/) |
| `splunk.svg`, `splunk-dark.svg` | Splunk | Simple Icons, `splunk` (Splunk's logo is its wordmark); dark: in white | [splunk.com](https://www.splunk.com) |
| `elastic.svg`, `elastic-dark.svg` | Elastic Security | Elastic's Elastic Security logo from elastic.co (`logo-security-32-color.svg`); dark: its dark piece in white, as Elastic draws it on dark | [Elastic trademarks](https://www.elastic.co/legal/trademarks) |
| `okta.svg`, `okta-dark.svg` | Okta | SVG Logos, `okta-icon` (the Okta aura); dark: in white | [Okta content terms](https://www.okta.com/terms-of-use-for-okta-content/) |
| `openai.svg`, `openai-dark.svg` | OpenAI | SVG Logos, `openai-icon`; dark: in white | [OpenAI brand](https://openai.com/brand/) |
| `anthropic.svg`, `anthropic-dark.svg` | Anthropic | Simple Icons, `anthropic`; dark: in white | [anthropic.com](https://www.anthropic.com) |
| `claude.svg` | Claude | Simple Icons, `claude` | [claude.ai](https://claude.ai) |
| `groq.svg` | Groq | Groq's own favicon (groq.com/favicon.svg) | [groq.com](https://groq.com) |
| `mistral-ai.svg` | Mistral AI | SVG Logos, `mistral-ai-icon` | [mistral.ai](https://mistral.ai) |
| `ollama.svg`, `ollama-dark.svg` | Ollama | Simple Icons, `ollama`; dark: in white | [ollama.com](https://ollama.com) |
| `zoom.svg` | Zoom | SVG Logos, `zoom-icon` (Zoom's app icon) | [Zoom brand](https://brand.zoom.us/usage-legal/) |
| `slack.svg` | Slack | SVG Logos, `slack-icon` (the Slack mark) | [Slack media kit](https://slack.com/media-kit) |
| `discord.svg` | Discord | SVG Logos, `discord-icon` | [Discord branding](https://discord.com/branding) |
| `telegram.svg` | Telegram | SVG Logos, `telegram` | [telegram.org](https://telegram.org) |
| `whatsapp.svg` | WhatsApp | SVG Logos, `whatsapp-icon` | [WhatsApp brand](https://about.meta.com/brand/resources/whatsapp/whatsapp-brand) |
| `mattermost.svg`, `mattermost-dark.svg` | Mattermost | SVG Logos, `mattermost-icon`; dark: in white | [Mattermost brand guidelines](https://www.mattermost.org/brand-guidelines/) |
| `opsgenie.svg` | Opsgenie | SVG Logos, `opsgenie` | [Atlassian press kit](https://www.atlassian.com/company/news/press-kit) |
| `atlassian-statuspage.svg` | Statuspage | SVG Logos, `statuspage` | as above |
| `pagerduty.svg` | PagerDuty | SVG Logos, `pagerduty-icon` | [PagerDuty brand](https://www.pagerduty.com/brand/) |
| `incident-io.svg` | incident.io | SVG Logos, `incident-icon` | [incident.io](https://incident.io) |
| `grafana.svg` | Grafana | SVG Logos, `grafana` | [Grafana Labs trademark policy](https://grafana.com/legal/trademark-policy/) |
| `better-stack.svg`, `better-stack-dark.svg` | Better Stack | Simple Icons, `betterstack`; dark: in white | [betterstack.com](https://betterstack.com) |
| `pingdom.svg` | Pingdom | Pingdom's 2025 logo from pingdom.com (`SW_Logo2025_Pingdom_Web_Orange.svg`), its symbol on its own | [Pingdom brand assets](https://www.pingdom.com/resources/brand-assets/) |
| `statuscake.svg` | StatusCake | StatusCake's logo from statuscake.com (`horizontal-logo-blackberry-text.svg`), its symbol on its own | [statuscake.com](https://www.statuscake.com) |
| `uptimerobot.svg` | UptimeRobot | UptimeRobot's site icon (uptimerobot.com), its two circles at their own sizes and colours | [uptimerobot.com](https://uptimerobot.com) |
| `uptime-kuma.svg` | Uptime Kuma | Simple Icons, `uptimekuma` | [uptime.kuma.pet](https://uptime.kuma.pet) |
| `opentelemetry.svg` | OpenTelemetry | SVG Logos, `opentelemetry-icon` (CNCF artwork, CC BY 4.0) | [CNCF branding](https://cncf-branding.netlify.app/projects/opentelemetry/) |
| `fluent-bit.svg` | Fluent Bit | Simple Icons, `fluentbit` | [fluentbit.io](https://fluentbit.io) |
| `fluentd.svg` | Fluentd | Simple Icons, `fluentd` (Apache-2.0) | [Fluentd logo](https://docs.fluentd.org/quickstart/logo) |
| `kubernetes.svg` | Kubernetes | SVG Logos, `kubernetes` (CNCF artwork) | [Kubernetes logo](https://github.com/kubernetes/kubernetes/tree/master/logo) |
| `nodejs.svg` | Node.js | SVG Logos, `nodejs-icon` | [OpenJS trademark policy](https://trademark-policy.openjsf.org/) |
| `python.svg` | Python | SVG Logos, `python` | [PSF trademark usage policy](https://www.python.org/psf/trademarks/) |
| `go.svg` | Go | SVG Logos, `go` (Go's logo is its wordmark) | [Go brand](https://go.dev/brand) |
| `java.svg` | Java | SVG Logos, `java` | [Oracle trademarks](https://www.oracle.com/legal/trademarks.html) |
| `dotnet.svg` | .NET | SVG Logos, `dotnet` | [.NET brand](https://github.com/dotnet/brand) |
| `rust.svg`, `rust-dark.svg` | Rust | SVG Logos, `rust`; dark: in white | [Rust trademark policy](https://foundation.rust-lang.org/policies/logo-policy-and-media-guide/) |
| `php.svg` | PHP | SVG Logos, `php` | [PHP logos](https://www.php.net/download-logos.php) |
| `ruby.svg` | Ruby | SVG Logos, `ruby` | [Ruby logo](https://www.ruby-lang.org/en/about/logo/) |
| `elixir.svg` | Elixir | Simple Icons, `elixir` | [Elixir trademarks](https://elixir-lang.org/trademarks/) |
| `cplusplus.svg` | C++ | SVG Logos, `c-plusplus` (the Standard C++ Foundation's logo) | [isocpp.org](https://isocpp.org) |
| `swift.svg` | Swift | SVG Logos, `swift` | [Apple trademarks](https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html) |
| `react.svg` | React | SVG Logos, `react` | [react.dev](https://react.dev) |
| `angular.svg` | Angular | SVG Logos, `angular-icon` | [Angular press kit](https://angular.dev/press-kit) |

## Adding a logo

1. Get the brand's own mark: its press kit, icon set or site, or Simple Icons /
   SVG Logos. Prefer the brand's square symbol over its wordmark: a tile is
   square, and a wordmark shrunk into it cannot be read.
2. Optimise it without changing it (`svgo` with `removeViewBox` off) and save it
   here as `<logo>.svg`. Add `<logo>-dark.svg` only if the mark disappears on
   the dark theme (`#172033`), drawn the way the brand draws it on dark.
3. Add the logo to `ProviderLogo` and `PROVIDER_LOGO_NAMES`, its loader to
   `PROVIDER_LOGO_FILE_LOADERS`, a row above, and the logo to the catalog entry
   that names the product.

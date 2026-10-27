/*
 * THE OTHER COMPANIES' PRODUCTS ONEUPTIME SHOWS BY THEIR OWN LOGO.
 *
 * Wherever the product names a service someone connects, sends to, imports
 * from or instruments with - Amazon S3 in the audit log export, Slack on a
 * workspace page, PagerDuty in Import from another tool, Python in the
 * telemetry guide - it shows that service's official logo next to its name,
 * so it is recognised at a glance. A generic thing (a webhook, syslog, any
 * S3-compatible storage) keeps a generic icon.
 *
 * Each value names one logo: the file of the same name in
 * Common/UI/Images/ProviderLogos (with a "-dark" file where the brand has a
 * mark of its own for dark backgrounds), drawn by
 * Common/UI/Components/ProviderLogo. Where each mark comes from, and the
 * brand's rules for using it, are in that folder's README.
 *
 * React-free and free of the images themselves, so catalogs the server
 * reads too (audit log destinations, security connectors, cloud and AI
 * connections) can name a logo.
 */
enum ProviderLogo {
  // Storage
  AmazonS3 = "amazon-s3",
  GoogleCloudStorage = "google-cloud-storage",
  AzureBlobStorage = "azure-blob-storage",
  Cloudflare = "cloudflare",
  Backblaze = "backblaze",
  Wasabi = "wasabi",
  MinIO = "minio",

  // Security
  MicrosoftSentinel = "microsoft-sentinel",
  MicrosoftDefender = "microsoft-defender",
  CrowdStrike = "crowdstrike",
  Splunk = "splunk",
  Elastic = "elastic",
  AwsSecurityHub = "aws-security-hub",
  Okta = "okta",
  GoogleSecurityOperations = "google-security-operations",

  // Clouds
  Aws = "aws",
  Azure = "azure",
  GoogleCloud = "google-cloud",

  // AI
  OpenAI = "openai",
  Anthropic = "anthropic",
  AzureOpenAI = "azure-openai",
  AmazonBedrock = "amazon-bedrock",
  GoogleVertexAI = "google-vertex-ai",
  Claude = "claude",
  MicrosoftCopilot = "microsoft-copilot",
  Groq = "groq",
  MistralAI = "mistral-ai",
  Ollama = "ollama",

  // Calendars and networks
  GoogleCalendar = "google-calendar",
  // Cisco Meraki: Meraki is Cisco's, and is shown by Cisco's logo.
  Cisco = "cisco",

  // Video calls and chat
  Zoom = "zoom",
  GoogleMeet = "google-meet",
  MicrosoftTeams = "microsoft-teams",
  Slack = "slack",
  Discord = "discord",
  Telegram = "telegram",
  Mattermost = "mattermost",

  // On-call, incident, uptime and status page tools
  Opsgenie = "opsgenie",
  PagerDuty = "pagerduty",
  IncidentIo = "incident-io",
  Grafana = "grafana",
  AtlassianStatuspage = "atlassian-statuspage",
  BetterStack = "better-stack",
  Pingdom = "pingdom",
  UptimeKuma = "uptime-kuma",
  UptimeRobot = "uptimerobot",
  StatusCake = "statuscake",

  // Telemetry: the standard, its collectors, and the languages it instruments
  OpenTelemetry = "opentelemetry",
  FluentBit = "fluent-bit",
  Fluentd = "fluentd",
  Kubernetes = "kubernetes",
  NodeJs = "nodejs",
  Python = "python",
  Go = "go",
  Java = "java",
  DotNet = "dotnet",
  Rust = "rust",
  Php = "php",
  Ruby = "ruby",
  Elixir = "elixir",
  CPlusPlus = "cplusplus",
  Swift = "swift",
  React = "react",
  Angular = "angular",
}

export default ProviderLogo;

/*
 * The name each logo is read out as (its image's accessible name): the
 * product's own name, as its maker writes it. A product name is a brand,
 * never translated.
 */
export const PROVIDER_LOGO_NAMES: Readonly<Record<ProviderLogo, string>> = {
  [ProviderLogo.AmazonS3]: "Amazon S3",
  [ProviderLogo.GoogleCloudStorage]: "Google Cloud Storage",
  [ProviderLogo.AzureBlobStorage]: "Azure Blob Storage",
  [ProviderLogo.Cloudflare]: "Cloudflare",
  [ProviderLogo.Backblaze]: "Backblaze",
  [ProviderLogo.Wasabi]: "Wasabi",
  [ProviderLogo.MinIO]: "MinIO",
  [ProviderLogo.MicrosoftSentinel]: "Microsoft Sentinel",
  [ProviderLogo.MicrosoftDefender]: "Microsoft Defender",
  [ProviderLogo.CrowdStrike]: "CrowdStrike",
  [ProviderLogo.Splunk]: "Splunk",
  [ProviderLogo.Elastic]: "Elastic",
  [ProviderLogo.AwsSecurityHub]: "AWS Security Hub",
  [ProviderLogo.Okta]: "Okta",
  [ProviderLogo.GoogleSecurityOperations]: "Google Security Operations",
  [ProviderLogo.Aws]: "Amazon Web Services",
  [ProviderLogo.Azure]: "Microsoft Azure",
  [ProviderLogo.GoogleCloud]: "Google Cloud",
  [ProviderLogo.OpenAI]: "OpenAI",
  [ProviderLogo.Anthropic]: "Anthropic",
  [ProviderLogo.AzureOpenAI]: "Azure OpenAI",
  [ProviderLogo.AmazonBedrock]: "Amazon Bedrock",
  [ProviderLogo.GoogleVertexAI]: "Vertex AI",
  [ProviderLogo.Claude]: "Claude",
  [ProviderLogo.MicrosoftCopilot]: "Microsoft Copilot",
  [ProviderLogo.Groq]: "Groq",
  [ProviderLogo.MistralAI]: "Mistral AI",
  [ProviderLogo.Ollama]: "Ollama",
  [ProviderLogo.GoogleCalendar]: "Google Calendar",
  [ProviderLogo.Cisco]: "Cisco",
  [ProviderLogo.Zoom]: "Zoom",
  [ProviderLogo.GoogleMeet]: "Google Meet",
  [ProviderLogo.MicrosoftTeams]: "Microsoft Teams",
  [ProviderLogo.Slack]: "Slack",
  [ProviderLogo.Discord]: "Discord",
  [ProviderLogo.Telegram]: "Telegram",
  [ProviderLogo.Mattermost]: "Mattermost",
  [ProviderLogo.Opsgenie]: "Opsgenie",
  [ProviderLogo.PagerDuty]: "PagerDuty",
  [ProviderLogo.IncidentIo]: "incident.io",
  [ProviderLogo.Grafana]: "Grafana",
  [ProviderLogo.AtlassianStatuspage]: "Statuspage",
  [ProviderLogo.BetterStack]: "Better Stack",
  [ProviderLogo.Pingdom]: "Pingdom",
  [ProviderLogo.UptimeKuma]: "Uptime Kuma",
  [ProviderLogo.UptimeRobot]: "UptimeRobot",
  [ProviderLogo.StatusCake]: "StatusCake",
  [ProviderLogo.OpenTelemetry]: "OpenTelemetry",
  [ProviderLogo.FluentBit]: "Fluent Bit",
  [ProviderLogo.Fluentd]: "Fluentd",
  [ProviderLogo.Kubernetes]: "Kubernetes",
  [ProviderLogo.NodeJs]: "Node.js",
  [ProviderLogo.Python]: "Python",
  [ProviderLogo.Go]: "Go",
  [ProviderLogo.Java]: "Java",
  [ProviderLogo.DotNet]: ".NET",
  [ProviderLogo.Rust]: "Rust",
  [ProviderLogo.Php]: "PHP",
  [ProviderLogo.Ruby]: "Ruby",
  [ProviderLogo.Elixir]: "Elixir",
  [ProviderLogo.CPlusPlus]: "C++",
  [ProviderLogo.Swift]: "Swift",
  [ProviderLogo.React]: "React",
  [ProviderLogo.Angular]: "Angular",
};

export const ALL_PROVIDER_LOGOS: ReadonlyArray<ProviderLogo> = Object.values(
  ProviderLogo,
) as Array<ProviderLogo>;

export function isProviderLogo(value: unknown): value is ProviderLogo {
  return (
    typeof value === "string" &&
    (ALL_PROVIDER_LOGOS as ReadonlyArray<string>).includes(value)
  );
}

// The name a logo is read out as; empty for anything that is not one.
export function getProviderLogoName(
  logo: ProviderLogo | string | undefined,
): string {
  return isProviderLogo(logo) ? PROVIDER_LOGO_NAMES[logo] : "";
}

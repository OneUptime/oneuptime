import { HelmDocLinks, HelmDocs } from "./SelfHosted";

/*
 * THE AIR-GAPPED PAGE (/enterprise/air-gapped), AS DATA.
 *
 * Who runs OneUptime on a network with no route to the internet, what works
 * there, the four steps to get there, every connection a self-hosted install
 * makes out and what to use inside the gap instead, AI on a model the
 * customer runs, what stays inside for compliance, and the questions buyers
 * ask. The page (Views/air-gapped.ejs), its markdown variant
 * (/enterprise/air-gapped.md, Utils/AIDiscovery.ts) and the tests all read
 * this module.
 *
 * Every sentence here is something the repository shows: a chart value, a
 * line of product code, a docs page, or a governed claim in Utils/Claims.ts.
 * Tests/AirGappedFacts.test.ts holds each one to the file that makes it true,
 * and fails when a fact moves - a renamed chart value, a dropped probe
 * browser, a new outbound call. Do not add a capability, a certification, a
 * customer or a number that no file in the repository can back; if a claim
 * needs the maintainer's word, it does not go here.
 */

export const AIR_GAPPED_PAGE_PATH: string = "/enterprise/air-gapped";

/*
 * CODE INSIDE A SENTENCE.
 *
 * A setting, a command or an address someone would type is written between
 * backticks, as in Markdown: "Set `updateCheck.disabled: true`". The page
 * draws each such span as code (Views/air-gapped.ejs splits the text on its
 * backticks), the markdown variant keeps the backticks, so they are code
 * there too, and wherever plain words are wanted - the FAQ's structured data
 * for search engines, or a test reading the page's text - plainText drops
 * them. Every string here opens and closes its spans
 * (Tests/AirGappedPage.test.ts checks), so a stray backtick never turns the
 * rest of a sentence into code.
 */
export const plainText: (text: string) => string = (text: string): string => {
  return text.split("`").join("");
};

/*
 * What buyers type: each answers with a permanent redirect to the page
 * (Routes.ts), and Utils/Sitemap.ts keeps them out of the sitemap.
 */
export const AIR_GAPPED_SHORT_PATHS: ReadonlyArray<string> = [
  "/air-gapped",
  "/airgapped",
];

/*
 * The values.yaml the page shows. HelmChart/Tests/air-gapped-values.yaml
 * holds the same values (its comment lines aside), and the chart's
 * air-gapped suite (HelmChart/Tests/suites/air-gapped.sh) renders the chart
 * with that file: every image from the registry named here, the pull secret
 * on every pod, the update check off, no public nameserver for a probe, and
 * the probes' monitors and the webhooks allowed to reach private addresses -
 * on a network with no route out, every address a monitor checks or a
 * webhook posts to is one, and both are refused by default
 * (docs: self-hosted/private-network-access). Change one and change the
 * other; Tests/AirGappedFacts.test.ts compares them.
 */
export const AIR_GAPPED_REGISTRY: string = "registry.example.com";

export const AIR_GAPPED_VALUES_YAML: string = [
  "image:",
  `  registry: ${AIR_GAPPED_REGISTRY}`,
  "imagePullSecrets:",
  "  - name: internal-registry",
  "postgresql:",
  "  image:",
  `    repository: ${AIR_GAPPED_REGISTRY}/postgres`,
  "clickhouse:",
  "  image:",
  `    repository: ${AIR_GAPPED_REGISTRY}/clickhouse/clickhouse-server`,
  "valkey:",
  "  image:",
  `    repository: ${AIR_GAPPED_REGISTRY}/valkey/valkey`,
  "updateCheck:",
  "  disabled: true",
  "instanceCheckIn:",
  "  disabled: true",
  "dnsConfig:",
  "  nameservers: []",
  "probes:",
  "  one:",
  "    allowPrivateNetworkMonitors: true",
  "webhooks:",
  "  allowPrivateNetwork: true",
].join("\n");

/*
 * The global LLM provider settings for a model on the customer's network,
 * exactly as the LLM provider docs give them for Ollama
 * (ai/llm-provider.md, "Self-Hosted: Zero-Config via Environment
 * Variables").
 */
export const AIR_GAPPED_LLM_PROVIDER_ENV: string = [
  "GLOBAL_LLM_PROVIDER_TYPE=Ollama",
  "GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434",
  "GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1",
].join("\n");

/*
 * The key every release signs the Helm chart with (`helm package --sign
 * --key 'key@oneuptime.com'` in .github/workflows/release.yml), as the
 * chart's own Chart.yaml publishes it (artifacthub.io/signKey).
 */
export const CHART_SIGNING_KEY_FINGERPRINT: string =
  "83F2C1DDF58A052464C4A1729D87E494AC016697";

export const CHART_SIGNING_KEY_URL: string =
  "https://keybase.io/oneuptime/pgp_keys.asc";

/*
 * A fingerprint the way GnuPG prints one: groups of four, in two halves
 * ("83F2 C1DD F58A 0524 64C4", "A172 9D87 E494 AC01 6697"), so a reader can
 * hold it against what `gpg --show-keys` says.
 */
export const fingerprintHalves: (fingerprint: string) => Array<string> = (
  fingerprint: string,
): Array<string> => {
  const groups: Array<string> = [];

  for (let index: number = 0; index < fingerprint.length; index += 4) {
    groups.push(fingerprint.slice(index, index + 4));
  }

  const middle: number = Math.ceil(groups.length / 2);

  return [groups.slice(0, middle).join(" "), groups.slice(middle).join(" ")];
};

export interface AirGappedLink {
  label: string;
  href: string;
}

export interface AirGappedAudience {
  key: string;
  title: string;
  description: string;
}

export interface AirGappedCapability {
  key: string;
  title: string;
  description: string;
  link?: AirGappedLink | undefined;
}

export interface AirGappedStep {
  key: string;
  title: string;
  description: string;
  // The values, commands or settings the step uses, shown as code.
  settings: Array<string>;
  link?: AirGappedLink | undefined;
}

export interface AirGappedConnection {
  key: string;
  // What reaches out.
  name: string;
  // Where it goes.
  destination: string;
  // When it happens.
  when: string;
  // What to do inside an air gap instead.
  inside: string;
  // True for a connection a self-hosted install makes unless a setting stops it.
  onByDefault: boolean;
}

export interface AirGappedAiOption {
  key: string;
  title: string;
  description: string;
}

export interface AirGappedCompliancePoint {
  key: string;
  title: string;
  description: string;
}

export interface AirGappedFaq {
  question: string;
  answer: string;
}

/*
 * The section that books the conversation: what it covers, and where to
 * write instead. The booking itself is the self-hosted page's architecture
 * assessment (the same Cal event type and booking kind, written in the
 * template's script, as on self-hosted.ejs): an air-gapped install is
 * planned in that conversation, and meeting_booked's page_path tells the two
 * pages apart (Docs/analytics/enterprise-conversion-tracking.md).
 */
export interface AirGappedPlanCall {
  topics: Array<string>;
  email: string;
}

/*
 * The hero's picture: inside one boundary - the customer's network - what
 * OneUptime runs in the cluster, drawn inside OneUptime itself, and the
 * customer's own services it uses in place of anything on the internet,
 * drawn beside it. icon names the template's icon for each.
 */
export interface AirGappedNetworkItem {
  label: string;
  detail: string;
  icon: "probes" | "database" | "registry" | "mail" | "identity" | "model";
}

export interface AirGappedNetworkPicture {
  // What the chart runs next to OneUptime: its probes and datastores.
  runs: Array<AirGappedNetworkItem>;
  // What OneUptime uses of the customer's own, in place of the internet.
  yours: Array<AirGappedNetworkItem>;
}

export const AirGappedNetwork: AirGappedNetworkPicture = {
  runs: [
    { label: "Probes", detail: "Check what only you can see", icon: "probes" },
    {
      label: "PostgreSQL",
      detail: "Configuration and state",
      icon: "database",
    },
    {
      label: "ClickHouse",
      detail: "Logs, metrics and traces",
      icon: "database",
    },
    { label: "Valkey", detail: "Cache and queues", icon: "database" },
  ],
  yours: [
    { label: "Registry", detail: "Every image", icon: "registry" },
    { label: "Mail server", detail: "Every email", icon: "mail" },
    {
      label: "Identity provider",
      detail: "SAML or OIDC sign-in",
      icon: "identity",
    },
    { label: "AI model", detail: "If you want AI", icon: "model" },
  ],
};

// The four lines under the hero's buttons, each a fact the sections below show.
export const AirGappedProofPoints: Array<string> = [
  "No special build",
  "Enterprise licenses activate offline",
  "AI on a model you run",
  "Nothing loaded from a CDN",
];

export const AirGappedAudiences: Array<AirGappedAudience> = [
  {
    key: "government",
    title: "Government and defense",
    description:
      "Classified and sovereign networks, where software runs only on accredited infrastructure and nothing may leave.",
  },
  {
    key: "critical-infrastructure",
    title: "Critical infrastructure",
    description:
      "Energy, water, telecom and transport operators whose control networks are cut off from the internet.",
  },
  {
    key: "regulated-industries",
    title: "Regulated industries",
    description:
      "Banks, insurers, hospitals and laboratories that keep operational data inside their own boundary.",
  },
];

export const AirGappedCapabilities: Array<AirGappedCapability> = [
  {
    key: "monitoring",
    title: "Monitoring from inside",
    description:
      "Probes run in your cluster and anywhere else on your network. They check what only your network can see: websites and APIs, ping, ports, DNS, SSL certificates, network devices over SNMP, SQL databases, and synthetic browser tests in the Chromium and Firefox the probe image carries.",
    link: { label: "Custom probes", href: "/docs/probe/custom-probe" },
  },
  {
    key: "incidents",
    title: "Incidents, on-call and status pages",
    description:
      "Incidents, alerts, on-call schedules and escalation, and status pages your people open on your own network. A status page's custom domain takes a certificate you upload.",
    link: {
      label: "Status page certificates",
      href: "/docs/status-pages/branding-and-domains#ssl-certificates",
    },
  },
  {
    key: "telemetry",
    title: "Logs, metrics and traces",
    description:
      "OpenTelemetry over HTTP or gRPC, Fluentd and Fluent Bit, syslog and OneUptime's agents send to your install, and ClickHouse in your cluster keeps it all.",
    link: {
      label: "Architecture",
      href: "/docs/self-hosted/architecture",
    },
  },
  {
    key: "notifications",
    title: "Alerts that reach people inside",
    description:
      "Email through your own mail server, webhooks to your own tools, and workflows that post to a Mattermost or IRC server on your network.",
    link: { label: "SMTP", href: "/docs/emails/smtp" },
  },
  {
    key: "sign-in",
    title: "Sign-in with your identity provider",
    description:
      "SAML and OpenID Connect single sign-on against the identity provider on your network, in every edition.",
    link: { label: "Single sign-on", href: "/docs/identity/sso" },
  },
  {
    key: "assets",
    title: "Nothing loads from outside",
    description:
      "The Dashboard, status pages and docs load every script, stylesheet and font from your install. Emails carry OneUptime's logo inside them, so opening one asks no other host for anything. The docs and API reference ship with the install too.",
  },
];

export const AirGappedSteps: Array<AirGappedStep> = [
  {
    key: "mirror-images",
    title: "Mirror the images",
    description:
      "Copy OneUptime's images, from Docker Hub or the GitHub Container Registry, into your own registry, with the PostgreSQL, ClickHouse and Valkey images the chart runs. Keep their names and tags, and pin `image.tag` to the release you mirrored. Anything you turn on later, such as PgBouncer or a database operator, needs its images mirrored too.",
    settings: ["image.registry", "image.tag", "imagePullSecrets"],
  },
  {
    key: "bring-in-chart",
    title: "Bring in the signed chart",
    description:
      "Download the chart on a connected machine and verify it before it crosses: every release is signed with OneUptime's key. The operators it can install (KEDA, CloudNativePG and Altinity's ClickHouse operator) are packed inside it.",
    settings: ["helm verify"],
  },
  {
    key: "point-inward",
    title: "Point the install inward",
    description:
      "In `values.yaml`, name your registry, turn the update check and the daily check-in off, give the probes your own DNS alone, and let probes and webhooks reach private addresses. Then run `helm install`, as on any cluster.",
    settings: [
      "updateCheck.disabled",
      "instanceCheckIn.disabled",
      "dnsConfig.nameservers",
      "probes.one.allowPrivateNetworkMonitors",
      "webhooks.allowPrivateNetwork",
    ],
    link: {
      label: "Configuration reference",
      href: HelmDocs.configuration,
    },
  },
  {
    key: "license-offline",
    title: "License the Enterprise Edition offline",
    description:
      "Running the Enterprise Edition? Send us the instance ID from the edition label, and activate the signed license token we return. The install verifies it against keys built into the release and never contacts us.",
    // A token, not a setting someone types: nothing to show as code.
    settings: [],
    link: {
      label: "Offline activation",
      href: "/docs/self-hosted/enterprise#offline-activation-air-gapped-installs",
    },
  },
];

export const AirGappedUpgradeNote: string =
  "Upgrades work the same way: mirror the next release's images, bring in its chart, read its upgrade notes and run `helm upgrade`. The chart runs the database migrations in a Job of its own, inside your cluster.";

export const AirGappedValuesCaption: string =
  "A test renders the chart with exactly these values: every image comes from your registry, every pod gets the pull secret, the update check and the daily check-in are off, no probe is given a public nameserver, and probes and webhooks may reach private addresses.";

/*
 * Everything a self-hosted install reaches out to, by default or once set
 * up, as the page's table lists it. The first four happen unless a setting
 * stops them (onByDefault); everything else only once someone sets it up.
 * Tests/AirGappedFacts.test.ts holds every row to the code that makes the
 * call, and the defaults to the code that makes them the defaults.
 */
export const AirGappedConnections: Array<AirGappedConnection> = [
  {
    key: "update-check",
    name: "Update check",
    destination: "`api.github.com`",
    when: "Once a day, to tell admins that a newer release is out.",
    inside:
      "Set `updateCheck.disabled: true`, or point `updateCheck.url` at a mirror. With no route out, the check fails quietly and shows nothing.",
    onByDefault: true,
  },
  {
    key: "instance-check-in",
    name: "Daily check-in",
    destination: "`oneuptime.com`",
    when: "Once a day, to tell OneUptime which release the install runs: its address and version, and nothing about anyone.",
    inside:
      "Set `instanceCheckIn.disabled: true`. With no route out, the check-in fails quietly.",
    onByDefault: true,
  },
  {
    key: "release-emails",
    name: "Release emails at sign-up",
    destination: "`oneuptime.com`",
    when: "Each sign-up with “Notify me about security patches and new releases” ticked (it starts ticked): their name and email, any company and phone they gave, and the install's address and version.",
    inside:
      "Untick it when you sign up. With no route out, the request fails and the sign-up still goes through.",
    onByDefault: true,
  },
  {
    key: "probe-dns",
    name: "Probes' fallback DNS",
    destination: "`8.8.8.8` and `1.1.1.1`",
    when: "The Helm chart lists them for probes, after your cluster's own resolver.",
    inside: "Set `dnsConfig.nameservers` to `[]` so probes use your DNS alone.",
    onByDefault: true,
  },
  {
    key: "enterprise-license",
    name: "Enterprise license",
    destination: "`oneuptime.com`",
    when: "Activating a license key online, and a license sync once a day after that.",
    inside:
      "Activate with an offline license token instead. An install activated offline never contacts OneUptime.",
    onByDefault: false,
  },
  {
    key: "certificates",
    name: "Certificates",
    destination: "Let's Encrypt",
    when: "Only when the install orders certificates itself, for its own host or a status page's domain.",
    inside:
      "Bring your own certificates. A status page's domain takes one you upload.",
    onByDefault: false,
  },
  {
    key: "paging",
    name: "SMS, calls and push",
    destination:
      "Twilio, OneUptime's push relay or Expo, and browsers' push services",
    when: "Paging people by SMS, phone call, the mobile app or a browser.",
    inside:
      "These need a route to their service. Page by email, webhook or a chat server on your network instead.",
    onByDefault: false,
  },
  {
    key: "chat",
    name: "Chat apps",
    destination: "Slack and Microsoft Teams",
    when: "Notifications and actions in your workspace.",
    inside: "Post to Mattermost or IRC on your network, through a workflow.",
    onByDefault: false,
  },
  {
    key: "hosted-ai",
    name: "Hosted AI models",
    destination: "OpenAI, Anthropic and other providers",
    when: "OneUptime AI, when a project uses a hosted provider.",
    inside: "Use a model you run, or leave AI off.",
    onByDefault: false,
  },
];

export const AirGappedAiOptions: Array<AirGappedAiOption> = [
  {
    key: "ollama",
    title: "Ollama",
    description:
      "Open models you run yourself, such as Llama 3.1, Mistral or Qwen.",
  },
  {
    key: "openai-compatible",
    title: "Any OpenAI-compatible server",
    description:
      "vLLM, LocalAI, LM Studio and others, at an address on your network.",
  },
  {
    key: "no-ai",
    title: "Or no AI at all",
    description:
      "Monitoring, incidents and on-call never need a model. With no provider, no AI feature runs.",
  },
];

export const AirGappedAiSetup: string =
  "Add your model once, as a global provider: in the Admin Dashboard under Settings > Global LLM Providers, or with the server's `GLOBAL_LLM_PROVIDER_*` settings. Every project then uses it.";

// The governed claim, word for word (Utils/Claims.ts, encryption-secrets-redaction).
export const AirGappedAiSafety: string =
  "AI investigations are read-only and secrets are redacted before anything reaches a model.";

export const AirGappedCompliance: Array<AirGappedCompliancePoint> = [
  {
    key: "residency",
    title: "Data stays where you put it",
    description:
      "Configuration lives in PostgreSQL, telemetry in ClickHouse and queues in Valkey, in your cluster or in databases you run. No monitoring data, telemetry or logs leave the install.",
  },
  {
    key: "keys",
    title: "Your keys",
    description:
      "On a self-hosted deployment you terminate TLS and configure storage encryption with your own infrastructure and keys.",
  },
  {
    key: "accreditation",
    title: "Your accreditation boundary",
    description:
      "The install runs under your own authorization, and certifying it is yours to do. OneUptime's certifications cover OneUptime Cloud and the company that builds it; we share evidence and complete security questionnaires under NDA.",
  },
  {
    key: "supply-chain",
    title: "Know what crosses the gap",
    description:
      "Every release publishes a CycloneDX SBOM for each image, the images carry SPDX SBOM and provenance attestations, and the Helm chart is signed.",
  },
];

export const AirGappedFaqs: Array<AirGappedFaq> = [
  {
    question: "Is there a separate air-gapped edition?",
    answer:
      "No. An air-gapped install runs the same images and Helm chart as every other self-hosted install, in the Community or the Enterprise Edition. What changes is where they come from: your own registry, and the values that point the chart at it.",
  },
  {
    question: "Does OneUptime phone home?",
    answer:
      "A Community Edition install makes two calls on its own: a daily update check against GitHub's API, which `updateCheck.disabled` turns off, and a daily check-in that tells oneuptime.com the install's address and version, which `instanceCheckIn.disabled` turns off. Signing up with release emails ticked also tells oneuptime.com, so untick that box. An Enterprise Edition install activated with a license key syncs its license with oneuptime.com once a day; one activated with an offline license token never does. Everything else, from SMS to Slack to a hosted AI model, reaches out only once you set it up.",
  },
  {
    question: "How do we license the Enterprise Edition with no internet?",
    answer:
      "With an offline license token. A master admin reads the instance ID from the edition label, and we issue a token signed for that instance. The install verifies it against the signing keys built into the release, and every other install refuses it. To renew or add seats, activate a new token before the current one expires.",
  },
  {
    question: "How do upgrades work?",
    answer:
      "The same way as the first install: mirror the next release's images, bring in its signed chart, read its upgrade notes and run `helm upgrade`. The chart runs the database migrations in a Job of its own inside your cluster. Upgrade one major version at a time.",
  },
  {
    question: "Can we page people without SMS, calls or push?",
    answer:
      "Yes. OneUptime emails them through your own mail server, posts to webhooks your own tools receive, and runs workflows that post to Mattermost or IRC on your network. SMS and calls go through Twilio, and mobile push through OneUptime's push relay or Expo, so those need a route out.",
  },
  {
    question: "Does OneUptime AI work without the internet?",
    answer:
      "Yes, with a model on your network: Ollama, or any OpenAI-compatible server such as vLLM, LocalAI or LM Studio. Add it once as a global provider and every project uses it. Or leave AI off: nothing else depends on it.",
  },
  {
    question: "Can we run it with Docker Compose?",
    answer:
      "The Helm chart is the way to run OneUptime air-gapped: it reads every image from your own registry. Docker Compose names its images as Docker Hub does and pulls them when it updates, so it suits a single host that can reach Docker Hub, or one you load the images onto yourself.",
  },
  {
    question: "How do we check what we bring across the gap?",
    answer:
      "Every release attaches a CycloneDX SBOM for each image to its GitHub release, the images carry SPDX SBOM and provenance attestations, and the Helm chart is signed with OneUptime's key, so `helm verify` checks it before you install.",
  },
  {
    question: "Do OneUptime's certifications cover our install?",
    answer:
      "No. They cover OneUptime Cloud and the company that builds it. An air-gapped install runs inside your own accreditation boundary, and certifying it is yours to do. We share evidence and complete security questionnaires under NDA to support it.",
  },
];

export const AirGappedPlanCall: AirGappedPlanCall = {
  topics: [
    "What to mirror, and how to keep it current",
    "The values for your cluster, registry and DNS",
    "Paging and AI with what runs on your network",
    "Enterprise licensing with an offline token",
    "Upgrades and backups inside the gap",
    "Evidence for your security review",
  ],
  email: "enterprise@oneuptime.com",
};

/*
 * The docs pages the page sends a reader to for each topic. Every one is a
 * page of the docs' nav, at a heading it has (Tests/DocsLinks.test.ts reads
 * every docs address the website writes).
 */
export interface AirGappedDocsLinks {
  architecture: string;
  connectionsOut: string;
  offlineActivation: string;
  llmProviders: string;
  privateNetworkAccess: string;
  upgrading: string;
}

export const AirGappedDocs: AirGappedDocsLinks = {
  architecture: "/docs/self-hosted/architecture",
  connectionsOut:
    "/docs/self-hosted/architecture#connections-out-of-your-network",
  offlineActivation:
    "/docs/self-hosted/enterprise#offline-activation-air-gapped-installs",
  llmProviders:
    "/docs/ai/llm-provider#self-hosted-zero-config-via-environment-variables",
  privateNetworkAccess: "/docs/self-hosted/private-network-access",
  upgrading: "/docs/installation/upgrading",
};

export interface AirGappedPageContent {
  pagePath: string;
  proofPoints: Array<string>;
  network: AirGappedNetworkPicture;
  audiences: Array<AirGappedAudience>;
  capabilities: Array<AirGappedCapability>;
  steps: Array<AirGappedStep>;
  upgradeNote: string;
  valuesYaml: string;
  valuesCaption: string;
  registry: string;
  signingKey: {
    fingerprint: string;
    // The two halves GnuPG prints it in.
    fingerprintHalves: Array<string>;
    url: string;
  };
  connections: Array<AirGappedConnection>;
  ai: {
    options: Array<AirGappedAiOption>;
    setup: string;
    safety: string;
    envExample: string;
  };
  compliance: Array<AirGappedCompliancePoint>;
  faqs: Array<AirGappedFaq>;
  planCall: AirGappedPlanCall;
  docs: AirGappedDocsLinks;
  helmDocs: HelmDocLinks;
}

export const getAirGappedContent: () => AirGappedPageContent =
  (): AirGappedPageContent => {
    return {
      pagePath: AIR_GAPPED_PAGE_PATH,
      proofPoints: AirGappedProofPoints,
      network: AirGappedNetwork,
      audiences: AirGappedAudiences,
      capabilities: AirGappedCapabilities,
      steps: AirGappedSteps,
      upgradeNote: AirGappedUpgradeNote,
      valuesYaml: AIR_GAPPED_VALUES_YAML,
      valuesCaption: AirGappedValuesCaption,
      registry: AIR_GAPPED_REGISTRY,
      signingKey: {
        fingerprint: CHART_SIGNING_KEY_FINGERPRINT,
        fingerprintHalves: fingerprintHalves(CHART_SIGNING_KEY_FINGERPRINT),
        url: CHART_SIGNING_KEY_URL,
      },
      connections: AirGappedConnections,
      ai: {
        options: AirGappedAiOptions,
        setup: AirGappedAiSetup,
        safety: AirGappedAiSafety,
        envExample: AIR_GAPPED_LLM_PROVIDER_ENV,
      },
      compliance: AirGappedCompliance,
      faqs: AirGappedFaqs,
      planCall: AirGappedPlanCall,
      docs: AirGappedDocs,
      helmDocs: HelmDocs,
    };
  };

export default getAirGappedContent;

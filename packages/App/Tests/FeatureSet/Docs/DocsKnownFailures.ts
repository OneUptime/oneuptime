import { DocsKnownFailures } from "./DocsContentRules";

/*
 * The docs pages that broke a content rule when the rules were committed
 * (docs overhaul task 0, 2026-10-08), before the overhaul rewrote them:
 * page -> rule -> the languages it fails in. DocsContentIntegrity and
 * DocsTranslations hold every other page to every rule, and these pages to
 * every rule they keep.
 *
 * This list only shrinks.
 *
 *   - When a change makes a page pass a rule, the suites fail and say so
 *     ("<page> passes <rule> in <lang> now: delete ..."). Delete that
 *     language, and the rule or the page once nothing is left under it. A
 *     docs task that rewrites a page with its 16 translations deletes the
 *     page's whole block.
 *   - Never add an entry. A page that breaks a rule it kept is fixed, not
 *     listed: the suites name the line and what is wrong.
 *
 * The rules, by id (DocsContentRules.ts says what each one reads):
 *
 *   navHasPages                  the nav links only to pages that exist
 *   pagesInNav                   every English page is in the nav
 *   noStrayTranslations          every translated page has an English page
 *   titleMatchesNav              line 1 names what the page's nav link names
 *   title                        line 1 is "# Title", the only "# " heading
 *   components                   components are known, closed and nested
 *   codeClosed                   every code sample is closed
 *   pageLinks                    /docs links land on nav pages and headings
 *   inPageAnchors                #anchors land on a heading of the page
 *   images                       images and /docs/static/ files exist
 *   noRelativeLinks              no relative links ("./page.md", "page")
 *   rendered                     no raw ":::", "@tab" or "[!NOTE]" is shown
 *   uniqueHeadings               no two headings of a page share an anchor
 *   codeLanguage                 every English code sample names a language
 *   headingLevels                English headings never skip a level
 *   relativeDocsLinks            English pages link /docs/..., not the site
 *   gettingStartedReachesGroups  Getting Started links into every nav group
 *   translated                   every language has every English page
 *   sameShape                    a translation keeps its English page's shape
 */

/*
 * The languages as they were when the list was frozen, written out: a
 * language the docs add later is never excused by an entry made before it
 * existed.
 */
const EN: Array<string> = ["en"];
const EVERY_TRANSLATION: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];
const EVERY_LANGUAGE: Array<string> = [...EN, ...EVERY_TRANSLATION];

// A set of languages without some of them; each one left out must be in it.
const except: (
  languages: Array<string>,
  ...leftOut: Array<string>
) => Array<string> = (
  languages: Array<string>,
  ...leftOut: Array<string>
): Array<string> => {
  for (const lang of leftOut) {
    if (!languages.includes(lang)) {
      throw new Error(`"${lang}" is not in ${languages.join(", ")}`);
    }
  }
  return languages.filter((lang: string): boolean => {
    return !leftOut.includes(lang);
  });
};

/*
 * Persian has more pages translated than any other language: most
 * untranslated pages are missing in every translation but Persian.
 */
const EVERY_TRANSLATION_BUT_FA: Array<string> = except(EVERY_TRANSLATION, "fa");

export const DOCS_KNOWN_FAILURES: DocsKnownFailures = {
  "ai/ai-agent": {
    sameShape: EVERY_TRANSLATION_BUT_FA,
  },
  "ai/ai-sre": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "ai/ask-ai": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "ai/infrastructure-ai-agents": {
    translated: EVERY_TRANSLATION,
  },
  "ai/llm-provider": {
    codeLanguage: EN,
  },
  "ai/mcp-server": {
    uniqueHeadings: EVERY_LANGUAGE,
    codeLanguage: EN,
    sameShape: EVERY_TRANSLATION,
  },
  "api-reference/api-reference": {
    headingLevels: EN,
    sameShape: EVERY_TRANSLATION,
  },
  "cli/authentication": {
    sameShape: EVERY_TRANSLATION,
  },
  "cli/index": {
    noRelativeLinks: EVERY_LANGUAGE,
  },
  "cli/output-formats": {
    codeLanguage: EN,
  },
  "configuration/ip-addresses": {
    sameShape: EVERY_TRANSLATION,
  },
  "configuration/label-and-owner-rules": {
    translated: EVERY_TRANSLATION,
  },
  "configuration/label-rule-import-export": {
    translated: EVERY_TRANSLATION,
  },
  "configuration/run-rules-now": {
    translated: EVERY_TRANSLATION,
  },
  "dashboards/authoring": {
    sameShape: EVERY_TRANSLATION,
  },
  "dashboards/configuration": {
    sameShape: EVERY_TRANSLATION,
  },
  "dashboards/sharing": {
    sameShape: EVERY_TRANSLATION,
  },
  "dashboards/variables": {
    codeLanguage: EN,
    sameShape: EVERY_TRANSLATION_BUT_FA,
  },
  "emails/notification-rollup": {
    codeLanguage: EN,
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "emails/smtp": {
    uniqueHeadings: EVERY_TRANSLATION,
    sameShape: EVERY_TRANSLATION,
  },
  "forms/building": {
    translated: EVERY_TRANSLATION,
  },
  "forms/index": {
    translated: EVERY_TRANSLATION,
  },
  "forms/on-submit": {
    translated: EVERY_TRANSLATION,
  },
  "forms/sharing-and-security": {
    translated: EVERY_TRANSLATION,
  },
  "identity/global-sso": {
    sameShape: EVERY_TRANSLATION,
  },
  "identity/scim": {
    uniqueHeadings: EVERY_TRANSLATION,
    sameShape: EVERY_TRANSLATION,
  },
  "identity/sso": {
    uniqueHeadings: except(EVERY_TRANSLATION, "de"),
    sameShape: EVERY_TRANSLATION,
  },
  "incidents/declaring-incidents": {
    sameShape: except(EVERY_TRANSLATION, "de", "fa"),
  },
  "incidents/index": {
    sameShape: except(EVERY_TRANSLATION, "de", "fa"),
  },
  "incidents/linked-alerts": {
    translated: except(EVERY_TRANSLATION, "de", "fa"),
  },
  "incidents/notes-owners-and-feed": {
    sameShape: except(EVERY_TRANSLATION, "de", "fa"),
  },
  "incidents/settings": {
    sameShape: except(EVERY_TRANSLATION, "de", "fa"),
  },
  "incidents/states-and-severities": {
    sameShape: except(EVERY_TRANSLATION, "de", "fa"),
  },
  "installation/docker-compose": {
    sameShape: EVERY_TRANSLATION,
  },
  "installation/local-development": {
    sameShape: EVERY_TRANSLATION,
  },
  "installation/sizing": {
    sameShape: EVERY_TRANSLATION,
  },
  "installation/upgrading": {
    sameShape: EVERY_TRANSLATION,
  },
  "integrations/aws-security-hub": {
    translated: EVERY_TRANSLATION,
  },
  "integrations/crowdstrike-falcon": {
    translated: EVERY_TRANSLATION,
  },
  "integrations/datadog": {
    pageLinks: ["fa"],
  },
  "integrations/elastic-security": {
    translated: EVERY_TRANSLATION,
  },
  "integrations/google-secops": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "integrations/index": {
    pageLinks: EVERY_TRANSLATION,
  },
  "integrations/jira": {
    pageLinks: ["fa"],
    sameShape: EVERY_TRANSLATION,
  },
  "integrations/microsoft-defender-xdr": {
    translated: EVERY_TRANSLATION,
  },
  "integrations/microsoft-dynamics-365": {
    pageLinks: ["fa"],
    sameShape: EVERY_TRANSLATION,
  },
  "integrations/microsoft-sentinel": {
    translated: EVERY_TRANSLATION,
  },
  "integrations/okta": {
    translated: EVERY_TRANSLATION,
  },
  "integrations/prometheus-alertmanager": {
    pageLinks: ["fa"],
    codeLanguage: EN,
  },
  "integrations/splunk": {
    translated: EVERY_TRANSLATION,
  },
  "integrations/zabbix": {
    pageLinks: EVERY_TRANSLATION,
  },
  "introduction/getting-started": {
    title: EVERY_LANGUAGE,
    gettingStartedReachesGroups: EN,
    sameShape: EVERY_TRANSLATION,
  },
  "inventory/cmdb-sync": {
    codeLanguage: EN,
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "inventory/custom-fields": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "inventory/overview": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "mobile-desktop-apps/faq-troubleshooting": {
    noRelativeLinks: EVERY_LANGUAGE,
  },
  "mobile-desktop-apps/index": {
    noRelativeLinks: EVERY_LANGUAGE,
  },
  "mobile-desktop-apps/linux-installation": {
    uniqueHeadings: except(EVERY_LANGUAGE, "ja", "hi"),
    sameShape: ["ja", "hi"],
  },
  "mobile-desktop-apps/macos-installation": {
    uniqueHeadings: ["en", "no", "ru", "zh-CN", "zh-TW", "fa"],
    codeLanguage: EN,
    sameShape: except(EVERY_TRANSLATION, "no", "ru", "zh-CN", "zh-TW", "fa"),
  },
  "mobile-desktop-apps/windows-installation": {
    codeLanguage: EN,
    sameShape: except(
      EVERY_TRANSLATION,
      "da",
      "no",
      "sv",
      "ru",
      "zh-CN",
      "zh-TW",
      "fa",
    ),
  },
  "monitor/api-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/ceph-monitor": {
    uniqueHeadings: ["en", "fa"],
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "monitor/create-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/custom-code-monitor": {
    uniqueHeadings: EVERY_TRANSLATION,
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/database-health-monitor": {
    pageLinks: ["fa"],
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "monitor/dns-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/dnssec-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/docker-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/docker-swarm-monitor": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "monitor/domain-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/exceptions-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/external-status-page-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/host-monitor": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "monitor/incident-alert-templating": {
    pageLinks: ["fa"],
    uniqueHeadings: except(EVERY_LANGUAGE, "sv"),
    codeLanguage: EN,
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/incoming-email-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/incoming-request-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/iot-device-monitor": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "monitor/ip-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/javascript-expression": {
    uniqueHeadings: EVERY_TRANSLATION,
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/kubernetes-agent": {
    pageLinks: ["fa"],
    sameShape: EVERY_TRANSLATION_BUT_FA,
  },
  "monitor/kubernetes-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/logs-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/manual-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/metrics-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/monitor-secrets": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/monitor-templates": {
    translated: EVERY_TRANSLATION,
  },
  "monitor/network-device-monitor": {
    codeLanguage: EN,
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "monitor/network-sites": {
    pageLinks: ["fa"],
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "monitor/network-vendor-guides": {
    translated: EVERY_TRANSLATION,
  },
  "monitor/ping-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/podman-monitor": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "monitor/port-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/profiles-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/proxmox-monitor": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "monitor/server-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/sql-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/ssl-certificate-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/storage-array-monitor": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "monitor/synthetic-monitor": {
    uniqueHeadings: except(EVERY_TRANSLATION, "de"),
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/traces-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "monitor/vmware-monitor": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "monitor/website-monitor": {
    sameShape: EVERY_TRANSLATION,
  },
  "on-call/calendar-feeds": {
    codeLanguage: EN,
  },
  "on-call/escalation-rules": {
    sameShape: EVERY_TRANSLATION_BUT_FA,
  },
  "on-call/incoming-call-policy": {
    sameShape: EVERY_TRANSLATION,
  },
  "on-call/phone-number-whitelist": {
    sameShape: EVERY_TRANSLATION,
  },
  "on-call/schedules": {
    sameShape: EVERY_TRANSLATION,
  },
  "permissions/index": {
    sameShape: EVERY_TRANSLATION,
  },
  "permissions/reference": {
    sameShape: EVERY_TRANSLATION,
  },
  "probe/custom-probe": {
    title: EVERY_LANGUAGE,
    uniqueHeadings: except(EVERY_LANGUAGE, "de"),
    codeLanguage: EN,
    headingLevels: EN,
    sameShape: EVERY_TRANSLATION,
  },
  "probe/incoming-request-ingress": {
    codeLanguage: EN,
    sameShape: ["de", "hi"],
  },
  "rum/applications": {
    pageLinks: ["fa"],
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "rum/browser-setup": {
    pageLinks: ["fa"],
    codeLanguage: EN,
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "rum/index": {
    pageLinks: ["fa"],
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "rum/mobile-setup": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "rum/session-replay-troubleshooting": {
    pageLinks: ["fa"],
    codeLanguage: EN,
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "rum/troubleshooting": {
    codeLanguage: EN,
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "rum/web-vitals": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "runbooks/agents": {
    sameShape: EVERY_TRANSLATION,
  },
  "runbooks/authoring": {
    sameShape: EVERY_TRANSLATION_BUT_FA,
  },
  "runbooks/configuration": {
    sameShape: EVERY_TRANSLATION,
  },
  "runbooks/credentials": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "runbooks/index": {
    sameShape: EVERY_TRANSLATION,
  },
  "runbooks/rules": {
    sameShape: EVERY_TRANSLATION,
  },
  "self-hosted/enterprise": {
    codeLanguage: EN,
    translated: EVERY_TRANSLATION,
  },
  "self-hosted/github-integration": {
    sameShape: EVERY_TRANSLATION,
  },
  "self-hosted/microsoft-teams-integration": {
    sameShape: EVERY_TRANSLATION,
  },
  "self-hosted/private-network-access": {
    codeLanguage: EN,
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "self-hosted/push-notifications": {
    codeLanguage: EN,
    sameShape: EVERY_TRANSLATION,
  },
  "self-hosted/sendgrid-inbound-email": {
    codeLanguage: EN,
    sameShape: EVERY_TRANSLATION,
  },
  "self-hosted/slack-integration": {
    sameShape: EVERY_TRANSLATION,
  },
  "self-hosted/twilio-integration": {
    sameShape: EVERY_TRANSLATION,
  },
  "slo/burn-rate-alerts": {
    codeLanguage: EN,
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "slo/error-budget": {
    uniqueHeadings: ["en", "fa"],
    codeLanguage: EN,
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "slo/feed-and-audit-logs": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "slo/introduction": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "slo/label-and-owner-rules": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "slo/metrics": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "slo/monitor-rules": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "status-pages/branding-and-domains": {
    sameShape: EVERY_TRANSLATION,
  },
  "status-pages/index": {
    sameShape: EVERY_TRANSLATION,
  },
  "status-pages/one-status-page-per-audience": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "status-pages/public-api": {
    sameShape: EVERY_TRANSLATION,
  },
  "status-pages/resources-and-groups": {
    sameShape: EVERY_TRANSLATION,
  },
  "status-pages/subscribers": {
    sameShape: EVERY_TRANSLATION,
  },
  "telemetry/ai-agent-circuit-breaker": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "telemetry/ai-coding-assistants": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "telemetry/ai-gateways": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "telemetry/ai-llm-observability": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "telemetry/ceph": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "telemetry/charts-and-time-ranges": {
    translated: EVERY_TRANSLATION,
  },
  "telemetry/claude-code": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "telemetry/cloud-aws-ecs": {
    translated: EVERY_TRANSLATION,
  },
  "telemetry/cloud-azure-container-apps": {
    translated: EVERY_TRANSLATION,
  },
  "telemetry/cloud-environments": {
    codeLanguage: EN,
    sameShape: EVERY_TRANSLATION,
  },
  "telemetry/cloud-gcp-cloud-run": {
    translated: EVERY_TRANSLATION,
  },
  "telemetry/cloud-other-platforms": {
    translated: EVERY_TRANSLATION,
  },
  "telemetry/cloud-resources": {
    uniqueHeadings: EN,
    translated: EVERY_TRANSLATION,
  },
  "telemetry/cloud-troubleshooting": {
    translated: EVERY_TRANSLATION,
  },
  "telemetry/cursor": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "telemetry/databases": {
    translated: EVERY_TRANSLATION,
  },
  "telemetry/docker-host": {
    codeLanguage: EN,
    sameShape: EVERY_TRANSLATION,
  },
  "telemetry/docker-swarm": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "telemetry/fluentbit": {
    sameShape: EVERY_TRANSLATION,
  },
  "telemetry/fluentd": {
    sameShape: EVERY_TRANSLATION,
  },
  "telemetry/gemini-cli-and-copilot": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "telemetry/host-otel-collector": {
    codeLanguage: EN,
    sameShape: EVERY_TRANSLATION,
  },
  "telemetry/iot-devices": {
    sameShape: ["sv"],
  },
  "telemetry/kubernetes-agent": {
    codeLanguage: EN,
    sameShape: EVERY_TRANSLATION,
  },
  "telemetry/kubernetes-cost": {
    sameShape: EVERY_TRANSLATION_BUT_FA,
  },
  "telemetry/log-pipelines": {
    translated: EVERY_TRANSLATION,
  },
  "telemetry/log-recording-rules": {
    translated: EVERY_TRANSLATION,
  },
  "telemetry/open-telemetry": {
    headingLevels: EN,
    sameShape: except(EVERY_TRANSLATION, "zh-TW", "fa"),
  },
  "telemetry/openai-codex": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "telemetry/podman-host": {
    codeLanguage: EN,
    sameShape: EVERY_TRANSLATION,
  },
  "telemetry/profiles": {
    sameShape: EVERY_TRANSLATION,
  },
  "telemetry/proxmox": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "telemetry/queues": {
    translated: EVERY_TRANSLATION,
  },
  "telemetry/search-syntax": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "telemetry/security-events": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "telemetry/serilog": {
    sameShape: EVERY_TRANSLATION,
  },
  "telemetry/serverless-functions": {
    sameShape: EVERY_TRANSLATION,
  },
  "telemetry/session-replay": {
    pageLinks: ["fa"],
    codeLanguage: EN,
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "telemetry/source-maps": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "telemetry/storage-arrays": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "telemetry/syslog": {
    sameShape: EVERY_TRANSLATION,
  },
  "telemetry/threat-intelligence": {
    codeLanguage: EN,
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "telemetry/vmware": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "terraform/complete-guide": {
    codeLanguage: EN,
  },
  "terraform/importing-resources": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "terraform/index": {
    sameShape: EVERY_TRANSLATION,
  },
  "terraform/monitor-steps": {
    pageLinks: ["fa"],
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "terraform/opentofu": {
    translated: EVERY_TRANSLATION_BUT_FA,
  },
  "terraform/troubleshooting": {
    translated: EVERY_TRANSLATION_BUT_FA,
    sameShape: ["fa"],
  },
  "workflows/authoring": {
    sameShape: EVERY_TRANSLATION,
  },
  "workflows/components": {
    sameShape: EVERY_TRANSLATION,
  },
  "workflows/configuration": {
    sameShape: EVERY_TRANSLATION,
  },
  "workflows/runs-and-logs": {
    sameShape: EVERY_TRANSLATION,
  },
  "workflows/triggers": {
    sameShape: EVERY_TRANSLATION,
  },
  "workflows/variables": {
    codeLanguage: EN,
    sameShape: EVERY_TRANSLATION,
  },
  "workspace-connections/microsoft-teams": {
    headingLevels: EN,
    sameShape: EVERY_TRANSLATION,
  },
  "workspace-connections/slack": {
    headingLevels: EN,
    sameShape: EVERY_TRANSLATION,
  },
  "workspace-connections/video-calls": {
    translated: EVERY_TRANSLATION,
  },
};

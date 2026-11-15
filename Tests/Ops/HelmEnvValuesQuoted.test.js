"use strict";

/**
 * Every env value the Helm charts write from a setting is a quoted string.
 *
 * A template that writes `value: {{ $.Values.x }}` leaves the setting to
 * YAML's reading of an unquoted scalar, and many settings are credentials or
 * free text that hold YAML's own syntax. ': ' (a colon and a space) makes the
 * line a mapping, and the render fails. ' #' (a space and a hash) starts a
 * comment: everything after it is dropped without a word, so a collector, a
 * database or a webhook gets a shortened credential and refuses it. A leading
 * '*', '&' or '!' is read as an alias, an anchor or a tag. And a setting such
 * as 123456, yes or 0x1F comes out as a number or a boolean, which
 * Kubernetes refuses for an env value. Piped through `quote`, the value is
 * written as a double-quoted string that YAML reads back exactly. Issue
 * #7163 found it in the telemetry exporter's headers, where a value such as
 * 'x-a=one #two' reached the pods as 'x-a=one'.
 *
 * The oneuptime chart writes a setting through its helper
 * `oneuptime.envValue`, which quotes it and leaves out the whitespace around
 * it: YAML always left that out of an unquoted value, so a secret read from a
 * file with its final newline (helm --set-file, Terraform's file()) stays the
 * secret the pods had before. A changed ENCRYPTION_SECRET would make every
 * value encrypted with the old one unreadable.
 *
 * 1. The source. In every chart template, an env value written as one
 *    template action goes through `oneuptime.envValue`, or ends its pipeline
 *    with `quote`, or with `squote`, which the charts keep for numbers and
 *    switches. A value built from several pieces, a Service's address from
 *    the release name, the namespace and the cluster domain, is not one
 *    action, and is left as it is: those are DNS names, which hold none of
 *    YAML's syntax.
 * 2. The render (helm on PATH; CI has it). The oneuptime chart, with every
 *    workload on and in each database layout, renders with every credential
 *    and free-text setting it hands its pods set to a value full of YAML's
 *    syntax, then to values YAML would read as a number, a boolean or null,
 *    and then wrapped in whitespace and a final newline. Every env entry of
 *    every workload that carries one of them holds it exactly (without the
 *    whitespace around it), and the exporter's headers reach every workload
 *    that sends OneUptime's own telemetry.
 *
 * The chart's helm-unittest suite tests/telemetry-exporter-isolation_test.yaml
 * holds the exporter's settings in the app, the worker, the probes and the
 * global runner case by case.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HELM_DIR = "HelmChart";
const ONEUPTIME_CHART = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "oneuptime",
);

// `value: <anything>` as an env entry writes it, on its own line or as the
// first key of a list item.
const VALUE_LINE = /^\s*(?:-\s+)?value:\s*(.*?)\s*$/;
// The whole value is one template action: `{{ ... }}` with no other `}}`.
const ONE_ACTION = /^\{\{-?\s*((?:(?!\}\}).)*?)\s*-?\}\}$/;
// The action ends its pipeline in quote or squote.
const QUOTED = /\|\s*s?quote$/;
// The action is the oneuptime chart's env value helper, given one argument.
const ENV_VALUE_HELPER = /^include "oneuptime\.envValue" \S/;
const HELPERS = "HelmChart/Public/oneuptime/templates/_helpers.tpl";
// `{{- $pairs := list -}}`: a variable declared on the value line, the value
// itself built over the lines that follow (the agent's ONEUPTIME_LABELS,
// which quotes what it joins).
const DECLARATION = /^\$\w+\s*:?=/;
const TEMPLATE_FILE = /\.(ya?ml|tpl)$/;
// Every template action of a value, with the text before and after it.
const ACTION = /\{\{-?\s*((?:(?!\}\}).)*?)\s*-?\}\}/g;
// An action that writes nothing itself: a branch, the end of one, a comment,
// or a variable declared for later.
const CONTROL_ACTION =
  /^(?:(?:if|else|end|with|range|define|block|template)\b|\/\*|\$\w+\s*:?=)/;
// An action that reads a setting from the values.
const READS_SETTING = /\.Values\b/;
/*
 * The settings a Service's address is built from, which are written as they
 * are: the cluster's DNS domain and the ports. A DNS name and a port number
 * hold none of YAML's syntax.
 */
const ADDRESS_SETTING =
  /^\$?\.Values\.(?:global\.clusterDomain|(?:\w+\.)+ports\.\w+)$/;
const WHITESPACE_ONLY = /^\s*$/;

const WORKLOAD_KINDS = ["Deployment", "StatefulSet", "Job", "DaemonSet"];

// Every template file of every chart under HelmChart/: the files in each
// `templates` directory and its subdirectories.
function templateFiles() {
  const found = [];

  function walk(directory, inTemplates) {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, directory), {
      withFileTypes: true,
    })) {
      const relative = `${directory}/${entry.name}`;

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          walk(relative, inTemplates || entry.name === "templates");
        }
      } else if (inTemplates && TEMPLATE_FILE.test(entry.name)) {
        found.push(relative);
      }
    }
  }

  walk(HELM_DIR, false);

  return found.sort();
}

/*
 * The env values of a template's text that are one template action and are
 * not quoted, as "<line number>: <line>". Counts the values it read as one
 * action in `seen`, so a caller can tell a scan that found nothing from one
 * that read nothing.
 */
function unquotedValues(source, seen = { actions: 0, quoted: 0 }) {
  const found = [];

  source.split("\n").forEach((line, index) => {
    const value = VALUE_LINE.exec(line);
    const action = value ? ONE_ACTION.exec(value[1]) : null;

    if (!action || DECLARATION.test(action[1])) {
      return;
    }

    seen.actions += 1;

    if (QUOTED.test(action[1]) || ENV_VALUE_HELPER.test(action[1])) {
      seen.quoted += 1;
    } else {
      found.push(`${index + 1}: ${line.trim()}`);
    }
  });

  return found;
}

/*
 * The values of a template's text that are built from several pieces and
 * splice a setting in where YAML reads it by its own rules, as "<line
 * number>: <line>". A piece that reads a setting is fine when it is part of a
 * Service's address (the cluster's DNS domain or a port), or when it is a
 * whole value of its own: quoted, with no text of the value before or after
 * it, as each branch of `{{ if x }}{{ $.Values.a | quote }}{{ else }}""{{ end
 * }}` is. Anything else is the shape #7336 found:
 * `value: "kubernetes-agent-{{ .Values.clusterName }}"` ends its string early
 * at a '"' in the setting and reads a '\' as an escape, and the same piece
 * without the literal quotes meets ': ' and ' #' as an unquoted one does.
 * Counts the setting pieces it read in `seen`.
 */
function splicedSettings(source, seen = { pieces: 0 }) {
  const found = [];

  source.split("\n").forEach((line, index) => {
    const value = VALUE_LINE.exec(line);

    if (!value || !value[1].includes("{{") || ONE_ACTION.test(value[1])) {
      return;
    }

    const text = value[1];
    const actions = [...text.matchAll(ACTION)];
    // Every piece is read (no short cut at the first refusal), so `seen`
    // counts them all.
    const refused = actions.filter((action, position) => {
      const body = action[1];

      if (CONTROL_ACTION.test(body) || !READS_SETTING.test(body)) {
        return false;
      }

      seen.pieces += 1;

      if (ADDRESS_SETTING.test(body)) {
        return false;
      }

      const previous = actions[position - 1];
      const next = actions[position + 1];
      const before = text.slice(
        previous ? previous.index + previous[0].length : 0,
        action.index,
      );
      const after = text.slice(
        action.index + action[0].length,
        next ? next.index : text.length,
      );

      return !(
        QUOTED.test(body) &&
        WHITESPACE_ONLY.test(before) &&
        WHITESPACE_ONLY.test(after)
      );
    });

    if (refused.length > 0) {
      found.push(`${index + 1}: ${line.trim()}`);
    }
  });

  return found;
}

describe("the scan of values built from several pieces finds a setting spliced in", () => {
  const sample = [
    "  - name: A",
    '    value: "kubernetes-agent-{{ .Values.clusterName }}"',
    "  - name: B",
    '    value: "k8s.cluster.name={{ .Values.clusterName }}"',
    "  - name: C",
    "    value: kubernetes-agent-{{ .Values.clusterName }}",
    "  - name: D",
    '    value: "kubernetes-agent-{{ .Values.clusterName | quote }}"',
    "  - name: E",
    "    value: prefix-{{ $.Values.a | quote }}",
    "  - name: F",
    "    value: {{ $.Values.a | quote }}-suffix",
    "  - name: G",
    '    value: "{{ $.Values.a }}{{ $.Values.b }}"',
    "  - name: H",
    "    value: {{ $.Release.Name }}-app.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}",
    "  - name: I",
    "    value: http://{{ $.Release.Name }}-vllm.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}:{{ $.Values.vllm.ports.http }}/v1",
    "  - name: J",
    '    value: "http://{{ include "kubernetes-agent.fullname" . }}-otlp.{{ .Release.Namespace }}.svc.cluster.local:4318"',
    "  - name: K",
    '    value: "app.kubernetes.io/instance={{ .Release.Name }}"',
    "  - name: L",
    "    value: {{ if $.Values.a }}{{ $.Values.a | quote }}{{ else }}{{ $.Values.b | quote }}{{ end }}",
    "  - name: M",
    '    value: {{ if kindIs "bool" ($.Values.c).d }}{{ ternary "true" "false" ($.Values.c).d | quote }}{{ else }}""{{ end }}',
    "  - name: N",
    '    value: {{ if kindIs "invalid" $enabled }}"true"{{ else }}{{ ternary "true" "false" $enabled | quote }}{{ end }}',
    "  - name: O",
    '    value: {{ printf "kubernetes-agent-%s" (include "kubernetes-agent.clusterName" .) | quote }}',
    "  - name: P",
    "    value: http://{{ $.Release.Name }}:{{ $.Values.app.port }}",
    "  - name: Q",
    "    value: {{ if $.Values.a }}x-{{ $.Values.a | quote }}{{ end }}",
  ].join("\n");

  test("refuses a setting inside literal quotes, or joined to other text of the value", () => {
    expect(splicedSettings(sample)).toEqual([
      '2: value: "kubernetes-agent-{{ .Values.clusterName }}"',
      '4: value: "k8s.cluster.name={{ .Values.clusterName }}"',
      "6: value: kubernetes-agent-{{ .Values.clusterName }}",
      '8: value: "kubernetes-agent-{{ .Values.clusterName | quote }}"',
      "10: value: prefix-{{ $.Values.a | quote }}",
      "12: value: {{ $.Values.a | quote }}-suffix",
      '14: value: "{{ $.Values.a }}{{ $.Values.b }}"',
      // A port named `port` rather than under `ports` is not an address
      // setting it knows, so it is refused rather than guessed at.
      "32: value: http://{{ $.Release.Name }}:{{ $.Values.app.port }}",
      "34: value: {{ if $.Values.a }}x-{{ $.Values.a | quote }}{{ end }}",
    ]);
  });

  test("keeps a Service's address, the release's own names, and a quoted setting that is a whole branch", () => {
    const kept = splicedSettings(sample);

    for (const name of ["H", "I", "J", "K", "L", "M", "N", "O"]) {
      const line = sample.split("\n").indexOf(`  - name: ${name}`) + 2;

      expect({
        name,
        refused: kept.some((entry) => {
          return entry.startsWith(`${line}: `);
        }),
      }).toEqual({ name, refused: false });
    }
  });

  test("counts the setting pieces it read", () => {
    const seen = { pieces: 0 };

    splicedSettings(sample, seen);

    // A, B, C, D, E, F, G twice, H, I twice, L twice, M, P and Q.
    expect(seen.pieces).toBe(16);
  });
});

describe("the scan of env values reads the lines it is meant to", () => {
  const sample = [
    "env:",
    "  - name: A",
    "    value: {{ $.Values.a }}",
    "  - name: B",
    "    value: {{ $.Values.b | quote }}",
    "  - name: C",
    "    value: {{ $.Values.c | default 3 | squote }}",
    "- name: D",
    "  value: {{- $.Values.d -}}",
    "  - name: E",
    "    value: http://{{ $.Release.Name }}-app.{{ $.Release.Namespace }}:3000",
    "  - name: F",
    "    value: {{- $pairs := list -}}",
    "  - name: G",
    '    value: {{ include "chart.host" . }}',
    "  - { name: H, value: plain }",
    "  - name: I",
    "    value: {{ $val.key | quote | indent 2 }}",
    "  - name: J",
    "    value: {{ $.Release.Namespace }}",
    "  - name: K",
    '    value: "3874"',
    "  - name: L",
    '    value: {{ include "oneuptime.envValue" $.Values.l }}',
    "  - name: M",
    '    value: {{ include "oneuptime.envValue" ($val.m | default "x") }}',
    "  - name: N",
    '    value: {{ include "oneuptime.envValueX" $.Values.n }}',
    "  - name: O",
    '    value: {{ include "oneuptime.envValue" }}',
  ].join("\n");

  test("finds each single-action value that is neither quoted nor written by the helper", () => {
    expect(unquotedValues(sample)).toEqual([
      "3: value: {{ $.Values.a }}",
      "9: value: {{- $.Values.d -}}",
      '15: value: {{ include "chart.host" . }}',
      "18: value: {{ $val.key | quote | indent 2 }}",
      "20: value: {{ $.Release.Namespace }}",
      '28: value: {{ include "oneuptime.envValueX" $.Values.n }}',
      '30: value: {{ include "oneuptime.envValue" }}',
    ]);
  });

  test("counts the quoted ones it accepts", () => {
    const seen = { actions: 0, quoted: 0 };

    unquotedValues(sample, seen);

    expect(seen).toEqual({ actions: 11, quoted: 4 });
  });
});

describe("the oneuptime chart's env value helper quotes what it is given", () => {
  const helpers = fs.readFileSync(path.join(REPO_ROOT, HELPERS), "utf8");

  test("renders nothing for an unset value, and the value trimmed and quoted otherwise", () => {
    expect(helpers).toContain(
      [
        '{{- define "oneuptime.envValue" -}}',
        '{{- if not (kindIs "invalid" .) -}}',
        "{{- toString . | trim | quote -}}",
        "{{- end -}}",
        "{{- end -}}",
      ].join("\n"),
    );
  });
});

describe("every env value a chart template writes as one action is quoted", () => {
  const files = templateFiles();

  test("the scan reads the templates of both published charts", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        "HelmChart/Public/oneuptime/templates/_helpers.tpl",
        "HelmChart/Public/oneuptime/templates/probe.yaml",
        "HelmChart/Public/oneuptime/templates/global-runner.yaml",
        "HelmChart/Public/kubernetes-agent/templates/_helpers.tpl",
        "HelmChart/Public/kubernetes-agent/templates/deployment-logs-api.yaml",
      ]),
    );
  });

  test("no template writes one unquoted", () => {
    const seen = { actions: 0, quoted: 0 };
    const unquoted = files.flatMap((file) => {
      return unquotedValues(
        fs.readFileSync(path.join(REPO_ROOT, file), "utf8"),
        seen,
      ).map((line) => {
        return `${file}:${line}`;
      });
    });

    expect(unquoted).toEqual([]);
    // Hundreds of env values are written so today; far fewer would mean the
    // scan stopped reading them.
    expect(seen.quoted).toBeGreaterThan(300);
  });

  test("no template splices a setting into a value built from several pieces", () => {
    const seen = { pieces: 0 };
    const spliced = files.flatMap((file) => {
      return splicedSettings(
        fs.readFileSync(path.join(REPO_ROOT, file), "utf8"),
        seen,
      ).map((line) => {
        return `${file}:${line}`;
      });
    });

    expect(spliced).toEqual([]);
    // The Service addresses of the oneuptime chart read the cluster domain
    // and ports this way; none would mean the scan stopped reading them.
    expect(seen.pieces).toBeGreaterThan(10);
  });

  test("the exporter's settings are quoted wherever a template hands them over", () => {
    const lines = files.flatMap((file) => {
      return fs
        .readFileSync(path.join(REPO_ROOT, file), "utf8")
        .split("\n")
        .filter((line) => {
          return line.includes("$.Values.openTelemetryExporter.");
        })
        .map((line) => {
          return `${file}: ${line.trim()}`;
        });
    });
    const values = lines.filter((line) => {
      return line.includes(" value: ");
    });

    expect(values.sort()).toEqual(
      [
        'HelmChart/Public/oneuptime/templates/_helpers.tpl: value: {{ include "oneuptime.envValue" $.Values.openTelemetryExporter.endpoint }}',
        'HelmChart/Public/oneuptime/templates/_helpers.tpl: value: {{ include "oneuptime.envValue" $.Values.openTelemetryExporter.headers }}',
        'HelmChart/Public/oneuptime/templates/global-runner.yaml: value: {{ include "oneuptime.envValue" $.Values.openTelemetryExporter.endpoint }}',
        'HelmChart/Public/oneuptime/templates/global-runner.yaml: value: {{ include "oneuptime.envValue" $.Values.openTelemetryExporter.headers }}',
        'HelmChart/Public/oneuptime/templates/probe.yaml: value: {{ include "oneuptime.envValue" $.Values.openTelemetryExporter.endpoint }}',
        'HelmChart/Public/oneuptime/templates/probe.yaml: value: {{ include "oneuptime.envValue" $.Values.openTelemetryExporter.headers }}',
      ].sort(),
    );
  });
});

/*
 * The render. Each setting gets a value of its own, so one that lands in the
 * wrong env entry is caught too, and each value opens with a different
 * character YAML reads as syntax at the start of an unquoted scalar, then
 * holds ': ', ' #', both quote characters and a backslash.
 */
const OPENERS = [
  "*",
  "&",
  "!",
  "%",
  "@",
  "`",
  "|",
  ">",
  "{",
  "[",
  "- ",
  "? ",
  "'",
  '"',
  "#",
  ",",
];

function syntaxValue(index, name) {
  return `${OPENERS[index % OPENERS.length]}${name}=key: value #kept 'single' "double" \\back`;
}

// Values YAML would read as something other than the string they are.
const LOOKALIKES = [
  "123456",
  "0x1F",
  "1e3",
  "yes",
  "on",
  "true",
  "null",
  "~",
  "0755",
  ".inf",
];

function lookalikeValue(index) {
  return LOOKALIKES[index % LOOKALIKES.length];
}

// The settings the chart hands its pods as plain env values, by the dotted
// path a values file sets, with the env entry each one is written into.
const SETTINGS = {
  "openTelemetryExporter.headers": "OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
  "openTelemetryExporter.endpoint": "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
  "browserOpenTelemetryExporter.endpoint":
    "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
  "browserOpenTelemetryExporter.browserIngestionKey":
    "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY",
  "microsoftTeamsApp.clientId": "MICROSOFT_TEAMS_APP_CLIENT_ID",
  "microsoftTeamsApp.tenantId": "MICROSOFT_TEAMS_APP_TENANT_ID",
  "microsoftTeamsApp.clientSecret": "MICROSOFT_TEAMS_APP_CLIENT_SECRET",
  "statusPage.cnameRecord": "STATUS_PAGE_CNAME_RECORD",
  "dashboard.cnameRecord": "DASHBOARD_CNAME_RECORD",
  "billing.publicKey": "BILLING_PUBLIC_KEY",
  "billing.privateKey": "BILLING_PRIVATE_KEY",
  "billing.webhookSecret": "BILLING_WEBHOOK_SECRET",
  "subscriptionPlan.basic": "SUBSCRIPTION_PLAN_BASIC",
  "subscriptionPlan.growth": "SUBSCRIPTION_PLAN_GROWTH",
  "subscriptionPlan.scale": "SUBSCRIPTION_PLAN_SCALE",
  "subscriptionPlan.enterprise": "SUBSCRIPTION_PLAN_ENTERPRISE",
  "analytics.key": "ANALYTICS_KEY",
  "analytics.host": "ANALYTICS_HOST",
  "vapid.publicKey": "VAPID_PUBLIC_KEY",
  "vapid.subject": "VAPID_SUBJECT",
  "vapid.privateKey": "VAPID_PRIVATE_KEY",
  // The server's Twilio account, rendered once accountSid is set (#7515).
  "twilio.accountSid": "GLOBAL_TWILIO_ACCOUNT_SID",
  "twilio.authToken": "GLOBAL_TWILIO_AUTH_TOKEN",
  "twilio.primaryPhoneNumber": "GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER",
  "twilio.secondaryPhoneNumbers": "GLOBAL_TWILIO_SECONDARY_PHONE_NUMBERS",
  "twilio.smsPhoneNumbers": "GLOBAL_TWILIO_SMS_PHONE_NUMBERS",
  // The server's email settings, rendered once email.serverType is set
  // (#7738): EMAIL_ON sets it, since it is one of the names the app knows.
  "email.fromEmail": "GLOBAL_EMAIL_FROM_EMAIL",
  "email.fromName": "GLOBAL_EMAIL_FROM_NAME",
  "email.smtp.host": "GLOBAL_EMAIL_SMTP_HOST",
  "email.smtp.port": "GLOBAL_EMAIL_SMTP_PORT",
  "email.smtp.username": "GLOBAL_EMAIL_SMTP_USERNAME",
  "email.smtp.password": "GLOBAL_EMAIL_SMTP_PASSWORD",
  "email.smtp.oauth.clientId": "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID",
  "email.smtp.oauth.clientSecret": "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET",
  "email.smtp.oauth.tokenUrl": "GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL",
  "email.smtp.oauth.scope": "GLOBAL_EMAIL_SMTP_OAUTH_SCOPE",
  "email.sendgrid.apiKey": "GLOBAL_EMAIL_SENDGRID_API_KEY",
  "email.amazonSes.accessKeyId": "GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID",
  "email.amazonSes.secretAccessKey":
    "GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY",
  "email.amazonSes.region": "GLOBAL_EMAIL_AMAZON_SES_REGION",
  "email.mailgun.apiKey": "GLOBAL_EMAIL_MAILGUN_API_KEY",
  "email.mailgun.domain": "GLOBAL_EMAIL_MAILGUN_DOMAIN",
  "email.postmark.serverToken": "GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN",
  "email.resend.apiKey": "GLOBAL_EMAIL_RESEND_API_KEY",
  oneuptimeSecret: "ONEUPTIME_SECRET",
  registerProbeKey: "REGISTER_PROBE_KEY",
  encryptionSecret: "ENCRYPTION_SECRET",
  "slackApp.clientSecret": "SLACK_APP_CLIENT_SECRET",
  "gitHubApp.clientSecret": "GITHUB_APP_CLIENT_SECRET",
  "gitHubApp.webhookSecret": "GITHUB_APP_WEBHOOK_SECRET",
  "notifications.webhooks.slack.onCreateUser":
    "NOTIFICATION_SLACK_WEBHOOK_ON_CREATED_USER",
  "notifications.webhooks.slack.onCreateProject":
    "NOTIFICATION_SLACK_WEBHOOK_ON_CREATED_PROJECT",
  "notifications.webhooks.slack.onDeleteProject":
    "NOTIFICATION_SLACK_WEBHOOK_ON_DELETED_PROJECT",
  "notifications.webhooks.slack.onSubscriptionUpdate":
    "NOTIFICATION_SLACK_WEBHOOK_ON_SUBSCRIPTION_UPDATE",
  "notifications.webhooks.slack.onAiFeedback":
    "NOTIFICATION_SLACK_WEBHOOK_ON_AI_FEEDBACK",
  "letsEncrypt.email": "LETS_ENCRYPT_NOTIFICATION_EMAIL",
  "letsEncrypt.accountKey": "LETS_ENCRYPT_ACCOUNT_KEY",
  "probes.one.name": "PROBE_NAME",
  "probes.one.description": "PROBE_DESCRIPTION",
  "probes.one.key": "PROBE_KEY",
};

// The email settings in SETTINGS are handed to the pods only with a server
// type, which the schema takes from the names the app knows, so it is set
// here rather than to a value full of syntax: an SMTP server, signed in to
// with the username and password SETTINGS sets.
const EMAIL_ON = { email: { serverType: "custom-smtp" } };

// The database settings, which only one database layout reads.
const BUILT_IN_DATABASE_SETTINGS = {
  "clickhouse.auth.username": "CLICKHOUSE_USER",
};

const EXTERNAL_DATABASE_SETTINGS = {
  "externalPostgres.host": "DATABASE_HOST",
  "externalPostgres.username": "DATABASE_USERNAME",
  "externalPostgres.database": "DATABASE_NAME",
  "externalClickhouse.host": "CLICKHOUSE_HOST",
  "externalClickhouse.username": "CLICKHOUSE_USER",
  "externalClickhouse.database": "CLICKHOUSE_DATABASE",
};

// Every workload the chart runs, switched on at once.
const ALL_ON = {
  worker: { enabled: true },
  home: { enabled: true },
  telemetryWriter: { enabled: true },
  testServer: { enabled: true },
  vllm: { enabled: true },
  cronJobs: { cleanup: { enabled: true }, e2e: { enabled: true } },
};

// The external databases: the built-in ones off, pgbouncer off so the app
// connects to the database itself.
const EXTERNAL_DATABASES = {
  postgresql: { enabled: false },
  clickhouse: { enabled: false },
  pgbouncer: { enabled: false },
};

// The workloads that send OneUptime's own telemetry, and so get the
// exporter's settings. A workload added to or dropped from this set fails
// below, so the change is looked at.
const EXPORTER_WORKLOADS = [
  "CronJob/e2e-cron",
  "Deployment/oneuptime-app",
  "Deployment/oneuptime-global-runner",
  "Deployment/oneuptime-home",
  "Deployment/oneuptime-nginx",
  "Deployment/oneuptime-probe-one",
  "Deployment/oneuptime-telemetry-writer",
  "Deployment/oneuptime-test-server",
  "Deployment/oneuptime-worker",
  "Job/oneuptime-migrate-1",
];

// { "a.b.c": value } into { a: { b: { c: value } } }, merged into `into`.
function nest(flat, into = {}) {
  for (const [dotted, value] of Object.entries(flat)) {
    const parts = dotted.split(".");
    let node = into;

    parts.slice(0, -1).forEach((part) => {
      node[part] = node[part] || {};
      node = node[part];
    });
    node[parts[parts.length - 1]] = value;
  }

  return into;
}

function deepMerge(...objects) {
  const merged = {};

  for (const object of objects) {
    for (const [key, value] of Object.entries(object)) {
      merged[key] =
        value && typeof value === "object" && !Array.isArray(value)
          ? deepMerge(merged[key] || {}, value)
          : value;
    }
  }

  return merged;
}

// { setting: value } for a map of settings, each from valueOf(index, env).
function assign(settings, valueOf, offset = 0) {
  return Object.fromEntries(
    Object.keys(settings).map((setting, index) => {
      return [setting, valueOf(index + offset, settings[setting])];
    }),
  );
}

const HELM_PROBE = spawnSync("helm", ["version", "--short"], {
  encoding: "utf8",
});
const HELM_MISSING = Boolean(HELM_PROBE.error) || HELM_PROBE.status !== 0;

if (HELM_MISSING && !process.env.CI) {
  // eslint-disable-next-line no-console
  console.warn(
    "Helm env value renders skipped: helm is not on PATH (CI has it, see .github/workflows/test.ops.yaml).",
  );
}

const testWithHelm = HELM_MISSING && !process.env.CI ? test.skip : test;

// `args` adds helm template flags, such as --is-upgrade for the upgrade
// branch of templates/secrets.yaml.
function render(values, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "helm-env-quoted-"));
  const file = path.join(dir, "values.json");

  try {
    fs.writeFileSync(file, JSON.stringify(values));

    const result = spawnSync(
      "helm",
      [
        "template",
        "oneuptime",
        ONEUPTIME_CHART,
        "--namespace",
        "oneuptime",
        "--values",
        file,
        ...args,
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );

    // Helm's stderr only on a failure: it also warns there, of a kubeconfig's mode.
    expect({
      status: result.status,
      error: result.status === 0 ? "" : result.stderr,
    }).toEqual({ status: 0, error: "" });

    return yaml.loadAll(result.stdout).filter(Boolean);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// [workload, env entry] for every env entry of every container of every
// workload of a render.
function envEntries(documents) {
  const entries = [];

  for (const document of documents) {
    let pod = null;

    if (WORKLOAD_KINDS.includes(document.kind)) {
      pod = document.spec.template.spec;
    } else if (document.kind === "CronJob") {
      pod = document.spec.jobTemplate.spec.template.spec;
    }

    if (!pod) {
      continue;
    }

    const workload = `${document.kind}/${document.metadata.name}`;

    for (const container of [
      ...(pod.initContainers || []),
      ...(pod.containers || []),
    ]) {
      for (const entry of container.env || []) {
        entries.push([workload, entry]);
      }
    }
  }

  return entries;
}

/*
 * What each env entry named in `expected` holds, where it does not hold the
 * expected value exactly, as "<workload> <name>: <what it holds>"; and the
 * names no workload got at all, as "<name>: in no workload". `skip` leaves
 * out the workloads it is true for.
 */
function misread(
  documents,
  expected,
  skip = () => {
    return false;
  },
) {
  const wrong = [];
  const seen = new Set();

  for (const [workload, entry] of envEntries(documents)) {
    if (!(entry.name in expected) || skip(workload)) {
      continue;
    }

    seen.add(entry.name);

    if (entry.value !== expected[entry.name] || entry.valueFrom) {
      wrong.push(
        `${workload} ${entry.name}: ${JSON.stringify(
          entry.valueFrom ? { valueFrom: entry.valueFrom } : entry.value,
        )}`,
      );
    }
  }

  for (const name of Object.keys(expected)) {
    if (!seen.has(name)) {
      wrong.push(`${name}: in no workload`);
    }
  }

  return wrong.sort();
}

// { env name: value } for settings set from `values`.
function byEnvName(settings, values) {
  return Object.fromEntries(
    Object.entries(settings).map(([setting, env]) => {
      return [env, values[setting]];
    }),
  );
}

describe("the oneuptime chart hands every credential and free-text setting to its pods whole", () => {
  testWithHelm(
    "with the built-in databases, a value full of YAML syntax reaches every env entry exactly",
    () => {
      const settings = { ...SETTINGS, ...BUILT_IN_DATABASE_SETTINGS };
      const values = assign(settings, syntaxValue);
      const documents = render(deepMerge(ALL_ON, EMAIL_ON, nest(values)));

      expect(misread(documents, byEnvName(settings, values))).toEqual([]);
    },
  );

  testWithHelm(
    "with the built-in databases, a value YAML would read as a number, a boolean or null stays that string",
    () => {
      const settings = { ...SETTINGS, ...BUILT_IN_DATABASE_SETTINGS };
      // Two of them, offset so each setting meets a second lookalike.
      for (const offset of [0, 5]) {
        const values = assign(
          settings,
          (index) => {
            return lookalikeValue(index);
          },
          offset,
        );
        const documents = render(deepMerge(ALL_ON, EMAIL_ON, nest(values)));

        expect({
          offset,
          misread: misread(documents, byEnvName(settings, values)),
        }).toEqual({ offset, misread: [] });
      }
    },
  );

  testWithHelm(
    "with external databases, the database settings reach every env entry exactly",
    () => {
      const syntax = assign(EXTERNAL_DATABASE_SETTINGS, syntaxValue, 3);
      const lookalike = assign(
        EXTERNAL_DATABASE_SETTINGS,
        (index) => {
          return lookalikeValue(index);
        },
        2,
      );

      for (const values of [syntax, lookalike]) {
        const documents = render(
          deepMerge(ALL_ON, EXTERNAL_DATABASES, nest(values)),
        );

        expect(
          misread(documents, byEnvName(EXTERNAL_DATABASE_SETTINGS, values)),
        ).toEqual([]);
      }
    },
  );

  /*
   * YAML always left the whitespace around an unquoted value out, so a value
   * read from a file with its final newline reached the pods without it. The
   * helper keeps it so: an ENCRYPTION_SECRET that gained a newline would
   * leave every value encrypted with the old one unreadable. The built-in
   * ClickHouse's own StatefulSet is held to it too: it creates the user the
   * app connects as, so it gets the user the app gets (#7337).
   */
  testWithHelm(
    "a value wrapped in whitespace and a final newline reaches every env entry without them, as it always did",
    () => {
      const wrap = (value) => {
        return ` \t ${value} \n`;
      };

      for (const [settings, layout] of [
        [{ ...SETTINGS, ...BUILT_IN_DATABASE_SETTINGS }, EMAIL_ON],
        [EXTERNAL_DATABASE_SETTINGS, EXTERNAL_DATABASES],
      ]) {
        const values = assign(settings, syntaxValue, 7);
        const wrapped = Object.fromEntries(
          Object.entries(values).map(([setting, value]) => {
            return [setting, wrap(value)];
          }),
        );
        const documents = render(deepMerge(ALL_ON, layout, nest(wrapped)));

        expect(misread(documents, byEnvName(settings, values))).toEqual([]);
      }
    },
  );

  testWithHelm(
    "an unset setting renders an empty env value, never the word for nothing",
    () => {
      const documents = render(ALL_ON);
      const words = [];
      const empty = new Set();

      for (const [workload, entry] of envEntries(documents)) {
        if (["<nil>", "<no value>", "null"].includes(entry.value)) {
          words.push(`${workload} ${entry.name}: ${entry.value}`);
        }
        if (entry.value === null || entry.value === undefined) {
          empty.add(entry.name);
        }
      }

      expect(words).toEqual([]);
      // Settings the chart ships unset, each written through the helper.
      expect([...empty]).toEqual(
        expect.arrayContaining([
          "OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
          "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
          "STATUS_PAGE_CNAME_RECORD",
          "DASHBOARD_CNAME_RECORD",
          "ANALYTICS_KEY",
          "BILLING_PRIVATE_KEY",
          "LETS_ENCRYPT_ACCOUNT_KEY",
          "NOTIFICATION_SLACK_WEBHOOK_ON_CREATED_USER",
        ]),
      );
    },
  );

  testWithHelm(
    "the exporter's headers reach every workload that sends OneUptime's own telemetry",
    () => {
      const headers =
        "x-tenant=region: eu #primary;Authorization=Basic dXNlcjpwYXNzd29yZA==";
      const documents = render(
        deepMerge(ALL_ON, {
          openTelemetryExporter: {
            endpoint: "https://collector.example.com:4318/otlp",
            headers,
          },
        }),
      );
      const holders = new Set();

      for (const [workload, entry] of envEntries(documents)) {
        if (entry.name === "OPENTELEMETRY_EXPORTER_OTLP_HEADERS") {
          expect({ workload, value: entry.value }).toEqual({
            workload,
            value: headers,
          });
          holders.add(workload);
        }
      }

      expect([...holders].sort()).toEqual(EXPORTER_WORKLOADS);
    },
  );
});

/*
 * The copies of a setting the chart keeps beside the pods' env: the keys
 * templates/secrets.yaml stores, the cluster key KEDA presents, the global
 * Runner's key, vLLM's Secret, and the user and database the built-in and
 * operator-run databases create. Each must be the value the pods use, or the
 * two sides disagree: KEDA's TriggerAuthentication presented "key\n" to an
 * app that compared it with "key", and taking an inline key out of the values
 * later switched the pods to the Secret's copy, newline and all (#7337).
 */

// A value as a file leaves it: whitespace around it and a final newline.
function fromAFile(value) {
  return ` \t ${value} \r\n`;
}

// { key: value } of the Secret of that name in a render, data decoded.
function secretValues(documents, name) {
  const secret = documents.find((document) => {
    return document.kind === "Secret" && document.metadata.name === name;
  });

  if (!secret) {
    return null;
  }

  const values = { ...(secret.stringData || {}) };

  for (const [key, encoded] of Object.entries(secret.data || {})) {
    values[key] = Buffer.from(encoded, "base64").toString("utf8");
  }

  return values;
}

// What a pod reads from an env entry: its value, or the Secret key it names.
function podValue(documents, entry) {
  if (!entry.valueFrom) {
    return entry.value;
  }

  const ref = entry.valueFrom.secretKeyRef;
  const values = ref ? secretValues(documents, ref.name) : null;

  if (!values || !(ref.key in values)) {
    return `<${JSON.stringify(entry.valueFrom)}, not in the render>`;
  }

  return values[ref.key];
}

/*
 * Each env entry named in `expected` whose pod would not read the expected
 * value, as "<workload> <name>: <what it reads>", and the names no workload
 * has, as "<name>: in no workload".
 */
function podsMisread(documents, expected) {
  const wrong = [];
  const seen = new Set();

  for (const [workload, entry] of envEntries(documents)) {
    if (!(entry.name in expected)) {
      continue;
    }

    seen.add(entry.name);

    const read = podValue(documents, entry);

    if (read !== expected[entry.name]) {
      wrong.push(`${workload} ${entry.name}: ${JSON.stringify(read)}`);
    }
  }

  for (const name of Object.keys(expected)) {
    if (!seen.has(name)) {
      wrong.push(`${name}: in no workload`);
    }
  }

  return wrong.sort();
}

function documentOf(documents, kind, name) {
  return documents.find((document) => {
    return document.kind === kind && document.metadata.name === name;
  });
}

// The four keys templates/secrets.yaml stores when set inline, by setting:
// the release Secret's key and the env entry the pods read it as.
const STORED_KEYS = {
  oneuptimeSecret: ["oneuptime-secret", "ONEUPTIME_SECRET"],
  encryptionSecret: ["encryption-secret", "ENCRYPTION_SECRET"],
  registerProbeKey: ["register-probe-key", "REGISTER_PROBE_KEY"],
  "probes.one.key": ["probe-one", "PROBE_KEY"],
};

const KEDA = {
  keda: { enabled: true },
  app: { keda: { enabled: true } },
};

describe("every copy of a setting the chart keeps beside the pods' env holds what the pods use", () => {
  for (const [branch, args] of [
    ["install", []],
    ["upgrade", ["--is-upgrade"]],
  ]) {
    testWithHelm(
      `on ${branch}, the release Secret stores each inline key as every pod gets it`,
      () => {
        const values = assign(STORED_KEYS, syntaxValue, 3);
        const wrapped = Object.fromEntries(
          Object.entries(values).map(([setting, value]) => {
            return [setting, fromAFile(value)];
          }),
        );
        const documents = render(deepMerge(ALL_ON, nest(wrapped)), args);
        const stored = secretValues(documents, "oneuptime-secrets");

        expect(
          Object.fromEntries(
            Object.entries(STORED_KEYS).map(([, [key]]) => {
              return [key, stored[key]];
            }),
          ),
        ).toEqual(
          Object.fromEntries(
            Object.entries(STORED_KEYS).map(([setting, [key]]) => {
              return [key, values[setting]];
            }),
          ),
        );
        expect(
          podsMisread(
            documents,
            Object.fromEntries(
              Object.entries(STORED_KEYS).map(([setting, [, env]]) => {
                return [env, values[setting]];
              }),
            ),
          ),
        ).toEqual([]);
      },
    );
  }

  testWithHelm(
    "without an inline key, every pod reads the key the release Secret keeps",
    () => {
      const documents = render(ALL_ON, ["--is-upgrade"]);
      const stored = secretValues(documents, "oneuptime-secrets");

      expect(
        podsMisread(
          documents,
          Object.fromEntries(
            Object.values(STORED_KEYS).map(([key, env]) => {
              return [env, stored[key]];
            }),
          ),
        ),
      ).toEqual([]);
    },
  );

  /*
   * KEDA presents the cluster key it reads to the app, which compares it with
   * its own ONEUPTIME_SECRET; an inline key wins over a Secret of the user's
   * for the app, and so for KEDA.
   */
  for (const [layout, values] of [
    [
      "an inline key read from a file",
      { oneuptimeSecret: fromAFile("k: v #1") },
    ],
    [
      "an inline key beside a Secret of the user's",
      {
        oneuptimeSecret: fromAFile("k: v #1"),
        externalSecrets: {
          oneuptimeSecret: {
            existingSecret: { name: "my-keys", passwordKey: "cluster-key" },
          },
        },
      },
    ],
    [
      "a Secret of the user's",
      {
        externalSecrets: {
          oneuptimeSecret: {
            existingSecret: { name: "my-keys", passwordKey: "cluster-key" },
          },
        },
      },
    ],
    ["the generated key", {}],
  ]) {
    testWithHelm(
      `with ${layout}, KEDA presents the cluster key the app compares`,
      () => {
        const documents = render(deepMerge(KEDA, values));
        const app = envEntries(documents).find(([workload, entry]) => {
          return (
            workload === "Deployment/oneuptime-app" &&
            entry.name === "ONEUPTIME_SECRET"
          );
        })[1];
        const auth = documentOf(
          documents,
          "TriggerAuthentication",
          "oneuptime-app-trigger-auth",
        );
        const [ref] = auth.spec.secretTargetRef;

        expect(ref.parameter).toBe("clusterkey");

        if (app.valueFrom) {
          // The app reads a Secret too: the same one, by the same key.
          expect({ name: ref.name, key: ref.key }).toEqual(
            app.valueFrom.secretKeyRef,
          );
        } else {
          expect(secretValues(documents, ref.name)[ref.key]).toBe(app.value);
          expect(app.value).toBe("k: v #1");
        }
      },
    );
  }

  testWithHelm(
    "the global Runner presents the key the server keeps its row from",
    () => {
      const documents = render(
        deepMerge(ALL_ON, { globalRunner: { key: fromAFile("runner #key") } }),
      );

      expect(
        podsMisread(documents, {
          GLOBAL_RUNNER_KEY: "runner #key",
          ONEUPTIME_RUNNER_KEY: "runner #key",
        }),
      ).toEqual([]);
    },
  );

  testWithHelm(
    "vLLM and the server read the API key vLLM's Secret stores, without the whitespace around it",
    () => {
      const documents = render(
        deepMerge(ALL_ON, {
          vllm: {
            apiKey: fromAFile("vllm-api-key"),
            huggingFace: { token: fromAFile("hf_token") },
          },
        }),
      );

      expect(secretValues(documents, "oneuptime-vllm")).toEqual({
        "api-key": "vllm-api-key",
        "hf-token": "hf_token",
      });
      expect(
        podsMisread(documents, {
          VLLM_API_KEY: "vllm-api-key",
          GLOBAL_LLM_PROVIDER_API_KEY: "vllm-api-key",
          HF_TOKEN: "hf_token",
        }),
      ).toEqual([]);
    },
  );

  testWithHelm(
    "the built-in databases create the user and the database the app connects as and to",
    () => {
      const documents = render(
        deepMerge(ALL_ON, {
          clickhouse: { auth: { username: fromAFile("oneuptime-user") } },
          postgresql: { auth: { database: fromAFile("oneuptime-db") } },
        }),
      );
      const postgres = documentOf(
        documents,
        "StatefulSet",
        "oneuptime-postgresql",
      ).spec.template.spec.containers[0];

      expect(
        podsMisread(documents, {
          CLICKHOUSE_USER: "oneuptime-user",
          POSTGRES_DB: "oneuptime-db",
          DATABASE_NAME: "oneuptime-db",
        }),
      ).toEqual([]);
      expect([
        postgres.livenessProbe.exec.command[2],
        postgres.readinessProbe.exec.command[2],
      ]).toEqual([
        'exec pg_isready -U "postgres" -d "dbname=oneuptime-db" -h 127.0.0.1 -p 5432',
        'exec pg_isready -U "postgres" -d "dbname=oneuptime-db" -h 127.0.0.1 -p 5432',
      ]);
    },
  );

  testWithHelm("CloudNativePG creates the database the app connects to", () => {
    const documents = render(
      deepMerge(ALL_ON, {
        postgresOperator: {
          cnpg: { enabled: true, database: fromAFile("oneuptime-db") },
        },
      }),
    );

    expect(
      documentOf(documents, "Cluster", "oneuptime-postgresql-cnpg").spec
        .bootstrap.initdb.database,
    ).toBe("oneuptime-db");
    expect(podsMisread(documents, { DATABASE_NAME: "oneuptime-db" })).toEqual(
      [],
    );
  });

  testWithHelm(
    "the Altinity installation creates the user the app connects as",
    () => {
      const documents = render(
        deepMerge(ALL_ON, {
          clickhouseOperator: {
            altinity: {
              enabled: true,
              auth: { username: fromAFile("oneuptime-user") },
            },
          },
        }),
      );
      const users = Object.keys(
        documentOf(
          documents,
          "ClickHouseInstallation",
          "oneuptime-clickhouse-altinity",
        ).spec.configuration.users,
      );

      expect(users).toEqual(
        expect.arrayContaining([
          "oneuptime-user/password",
          "oneuptime-user/networks/ip",
          "oneuptime-user/access_management",
        ]),
      );
      expect(
        users.filter((user) => {
          return !user.startsWith("oneuptime-user/");
        }),
      ).toEqual([]);
      expect(
        podsMisread(documents, { CLICKHOUSE_USER: "oneuptime-user" }),
      ).toEqual([]);
    },
  );
});

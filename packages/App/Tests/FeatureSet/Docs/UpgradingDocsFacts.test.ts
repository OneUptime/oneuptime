import { readPage } from "./DocsContentSupport";
import { escapeRegExp } from "./DocsTranslationChecks";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import StateMoveUtil, { StateMoveRecord } from "Common/Utils/StateMove";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 16: what the upgrade guide (installation/upgrading) says
 * about the upgrade itself, held to the code, scripts, compose file and chart
 * that do it. Each note of "Other changes in 14" has a suite of its own (the
 * *Docs suites that read UpgradingDocsNotes), the edition split has
 * EnterpriseEditionDocs and the license claims, and the translations have
 * UpgradingDocsTranslations. This one holds the rest: the procedure, the table
 * of notes for each version, the 12 → 13 cache rename, the 11 → 12 Runner
 * merge's Compose and Helm steps, and the server's words the page quotes.
 *
 * Markdown is not compiled and App tests read no React module, so screens are
 * read from their source files, and the scripts, compose file and chart from
 * the repository.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");

const PAGE: string = "installation/upgrading";

const CHART: string = "HelmChart/Public/oneuptime";
const ADMIN_DASHBOARD: string = "packages/App/FeatureSet/AdminDashboard/src";
const ENTERPRISE_ADMIN_HEALTH: string = "ee/AdminDashboard/Health";
const ENTERPRISE_SERVER_HEALTH: string = "ee/Server/AdminHealth";

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: { load: (text: string) => unknown } = require(
  path.join(REPO_DIR, "packages", "Common", "node_modules", "js-yaml"),
);

// The pure half of the script `npm run update` merges config.env with.
const mergeEnvScript: {
  RENAMED_FROM: Record<string, string>;
  mergeEnvTemplate: (
    templateContents: string,
    envContents: string,
  ) => { contents: string; carriedOver: Array<string> };
} = require(path.join(REPO_DIR, "Scripts", "Install", "MergeEnvTemplate.js"));
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const PLACEHOLDER_SECRET: string = "please-change-this-to-random-value";

// A line that starts a block of its own rather than continuing a paragraph.
const BLOCK_START: RegExp = /^\s*(?:#|:::|@tab|\||>|@@)/;
const LIST_ITEM: RegExp = /^\s*(?:[-*]|\d+\.)\s/;
const FENCE: RegExp = /^ {0,3}(?:```|~~~)/;

// A version section's heading: "## Upgrading from OneUptime 13 → 14".
const VERSION_HEADING: RegExp = /^## (Upgrading from OneUptime (\d+) → (\d+))$/;

// A row of the table of notes: "| [13 → 14](#upgrading-from-oneuptime-13-14) | …".
const NOTES_ROW: RegExp = /^\| \[(\d+) → (\d+)\]\(#([a-z0-9-]+)\) \|/;

const INLINE_CODE: RegExp = /`([^`]+)`/g;

interface VersionSection {
  from: number;
  to: number;
  anchor: string;
}

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_DIR, relativePath), "utf8");
}

/*
 * The enterprise Health dashboards are in ee/, which core CI removes before
 * the App tests run: the page is held to them wherever the checkout has ee/.
 * A dashboard file moved inside ee/ still fails the check.
 */
function hasEnterpriseEdition(): boolean {
  return fs.existsSync(path.join(REPO_DIR, "ee"));
}

function yamlOf(relativePath: string): Record<string, unknown> {
  return jsYaml.load(source(relativePath)) as Record<string, unknown>;
}

function objectAt(
  data: Record<string, unknown>,
  ...keys: Array<string>
): Record<string, unknown> {
  let value: unknown = data;

  for (const key of keys) {
    value = (value as Record<string, unknown>)[key];
  }

  return value as Record<string, unknown>;
}

/*
 * The English page with every paragraph and list item on one line, so a
 * sentence the source wraps can be looked for whole. Code blocks are left as
 * they are.
 */
function englishPage(): string {
  const lines: Array<string> = [];
  let inFence: boolean = false;

  for (const line of readPage("en", PAGE).split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      lines.push(line);
      continue;
    }

    const previous: string | undefined = lines[lines.length - 1];
    const continues: boolean =
      !inFence &&
      previous !== undefined &&
      previous.trim() !== "" &&
      line.trim() !== "" &&
      !FENCE.test(previous) &&
      !BLOCK_START.test(previous) &&
      !BLOCK_START.test(line) &&
      !LIST_ITEM.test(line);

    if (continues) {
      lines[lines.length - 1] = `${previous} ${line.trim()}`;
    } else {
      lines.push(line);
    }
  }

  return lines.join("\n");
}

function versionSections(page: string): Array<VersionSection> {
  return page
    .split("\n")
    .map((line: string): RegExpMatchArray | null => {
      return line.match(VERSION_HEADING);
    })
    .filter((match: RegExpMatchArray | null): match is RegExpMatchArray => {
      return match !== null;
    })
    .map((match: RegExpMatchArray): VersionSection => {
      return {
        from: Number(match[2]),
        to: Number(match[3]),
        anchor: slugifyMarkdownHeading(match[1]!),
      };
    });
}

// The rows of "Find the notes for your version", as the versions they link.
function notesTableRows(page: string): Array<VersionSection> {
  const lines: Array<string> = page.split("\n");
  const start: number = lines.indexOf("### Find the notes for your version");

  expect(start).toBeGreaterThan(-1);

  const rows: Array<VersionSection> = [];

  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("#")) {
      break;
    }

    const match: RegExpMatchArray | null = line.match(NOTES_ROW);

    if (match) {
      rows.push({
        from: Number(match[1]),
        to: Number(match[2]),
        anchor: match[3]!,
      });
    }
  }

  return rows;
}

// The inline code of the one line of the page that contains `lead`.
function codeOfLine(page: string, lead: string): Array<string> {
  const line: string | undefined = page.split("\n").find((text: string) => {
    return text.includes(lead);
  });

  expect(line).toBeDefined();

  return [...line!.matchAll(INLINE_CODE)].map((match: RegExpMatchArray) => {
    return match[1]!;
  });
}

// A source template as a pattern: each `${…}` stands for any text.
function templatePattern(template: string): RegExp {
  const pieces: Array<string> = template.split(/\$\{[^}]*\}/);

  return new RegExp(
    `^${pieces
      .map((piece: string): string => {
        return escapeRegExp(piece);
      })
      .join(".+?")}$`,
  );
}

describe("Upgrading: how to upgrade, held to what does it", () => {
  const page: string = englishPage();

  it("asks for the version at /version, which every app answers with the version and the commit", () => {
    expect(page).toContain("curl http://localhost/version");
    expect(page).toContain('`{"version":"14.0.22","commit":"..."}`');

    const versionApi: string = source(
      "packages/Common/Server/API/VersionAPI.ts",
    );

    expect(versionApi).toContain('router.get("/version"');
    expect(versionApi).toContain(
      "res.send({ version: AppVersion, commit: GitSha });",
    );

    // On each app's own root, and on "/".
    expect(source("packages/Common/Server/API/Index.ts")).toContain(
      'app.use([`/${data.appName}`, "/"], version);',
    );

    // A self-hosted ingress, billing off, sends "/" to the app.
    expect(source("packages/Nginx/default.conf.template")).toMatch(
      /if \(\$billing_enabled != true\) \{\s*proxy_pass \$\{BACKEND_APP_TARGET\};/,
    );
  });

  it("shows the running version on the edition label's This installation card, in the Admin Dashboard header", () => {
    expect(page).toContain(
      "As a master admin, open the edition label in the Admin Dashboard's header: **This installation** shows the version you run.",
    );

    const editionLabel: string = source(
      "packages/Common/UI/Components/EditionLabel/EditionLabel.tsx",
    );

    expect(editionLabel).toContain(
      'translator.translateText("This installation")',
    );
    expect(editionLabel).toContain("`v${currentVersion}`");
    expect(source(`${ADMIN_DASHBOARD}/Components/Header/Header.tsx`)).toContain(
      "<EditionLabel",
    );
  });

  it("updates Docker Compose with npm run update: settings merged in, images pulled, the stack restarted with --remove-orphans, ending with OneUptime is up!", () => {
    expect(page).toContain("git checkout release\ngit pull\nnpm run update");
    expect(page).toContain(
      "`npm run update` adds new settings to your `config.env` without changing yours, pulls the new images and restarts OneUptime.",
    );
    expect(page).toContain(
      "On Docker Compose, `npm run update` ends with **OneUptime is up!**",
    );

    const scripts: Record<string, string> = (
      JSON.parse(source("package.json")) as { scripts: Record<string, string> }
    ).scripts;

    expect(scripts["update"]).toContain("npm run prerun");
    expect(scripts["update"]).toContain("docker compose pull");
    expect(scripts["update"]).toMatch(/npm run start$/);
    expect(scripts["start"]).toContain("docker compose up --remove-orphans");
    expect(scripts["start"]).toMatch(/npm run status-check$/);
    expect(scripts["prerun"]).toContain("bash ./Scripts/Install/configure.sh");
    expect(source("Scripts/Install/configure.sh")).toContain(
      "node ./Scripts/Install/MergeEnvTemplate.js",
    );
    expect(source("Tests/Scripts/status-check.sh")).toContain(
      "OneUptime is up!",
    );

    // A new setting is added; a setting you have keeps your value.
    const merged: { contents: string } = mergeEnvScript.mergeEnvTemplate(
      "KEPT_SETTING=template-default\nNEW_SETTING=template-default",
      "KEPT_SETTING=yours",
    );

    expect(merged.contents.split("\n")).toEqual([
      "KEPT_SETTING=yours",
      "NEW_SETTING=template-default",
    ]);
  });

  it("upgrades Helm with helm upgrade, and the chart migrates the database in a Job of its own the new pods wait for", () => {
    expect(page).toContain(
      "helm repo update\nhelm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml",
    );
    expect(page).toContain(
      "The chart runs the database migrations in a Job of its own before the new pods serve traffic.",
    );
    expect(page).toContain("kubectl get pods -n <namespace>");

    const migrate: Record<string, unknown> = objectAt(
      yamlOf(`${CHART}/values.yaml`),
      "migrate",
    );

    expect(migrate["enabled"]).toBe(true);
    expect(migrate["hook"]).toBe(false);
    // The new pods wait, unready, for the schema their code needs.
    expect(migrate["runtimeWaitTimeoutSeconds"]).toBeGreaterThan(0);

    const job: string = source(`${CHART}/templates/migrate-job.yaml`);

    expect(job.startsWith("{{- if and .Values.migrate.enabled")).toBe(true);
    expect(job).toContain("kind: Job");
  });

  it("makes the migrations a blocking pre-upgrade hook with migrate.hook: true", () => {
    expect(page).toContain(
      "On Helm with `migrate.hook: true`, `helm upgrade` waits for the migrations, by default for 5 minutes.",
    );

    const job: string = source(`${CHART}/templates/migrate-job.yaml`);

    expect(job).toContain("{{- $useHook := .Values.migrate.hook }}");
    expect(job).toContain(
      '"helm.sh/hook": {{ ternary "post-install" "pre-upgrade" .Release.IsInstall }}',
    );
  });

  it("backs Kubernetes up with volume snapshots or the chart's CloudNativePG backups", () => {
    expect(page).toContain(
      "On Kubernetes, use your volume snapshots or the chart's CloudNativePG backups.",
    );

    const backup: Record<string, unknown> = objectAt(
      yamlOf(`${CHART}/values.yaml`),
      "postgresOperator",
      "cnpg",
      "backup",
    );

    expect(typeof backup["enabled"]).toBe("boolean");
    expect(typeof backup["volumeSnapshotClassName"]).toBe("string");

    const scheduledBackup: string = source(
      `${CHART}/templates/postgresql-cnpg-scheduledbackup.yaml`,
    );

    expect(scheduledBackup).toContain("kind: ScheduledBackup");
    expect(scheduledBackup).toContain(
      "{{- if and $cnpg.enabled $backup.enabled }}",
    );
  });
});

describe("Upgrading: the notes for each version", () => {
  const page: string = englishPage();
  const sections: Array<VersionSection> = versionSections(page);

  it("has a section for every major version, newest first, one major at a time", () => {
    expect(sections.length).toBeGreaterThanOrEqual(7);

    sections.forEach((section: VersionSection, index: number) => {
      expect(section.to).toBe(section.from + 1);

      if (index > 0) {
        expect(section.from).toBe(sections[index - 1]!.from - 1);
      }
    });
  });

  it("links every version section from the table, in the sections' order, under the versions each names", () => {
    expect(notesTableRows(page)).toEqual(sections);
  });

  it("opens with a card to the newest version section", () => {
    const newest: VersionSection = sections[0]!;

    expect(page).toContain(
      `- [Upgrading from OneUptime ${newest.from} → ${newest.to}](#${newest.anchor}): The newest major version.`,
    );
  });
});

describe("Upgrading from 12 → 13: the cache rename, held to the code", () => {
  const page: string = englishPage();

  it("runs valkey/valkey:9.1-alpine on both deployment paths, holding nothing on disk", () => {
    expect(page).toContain(
      "| Engine | `redis:7.0.12` | `valkey/valkey:9.1-alpine` |",
    );
    expect(page).toContain(
      'It holds nothing on disk (`appendonly no`, `save ""`), so it comes back cold',
    );

    const compose: string = source("docker-compose.base.yml");

    expect(compose).toContain("image: valkey/valkey:9.1-alpine");
    expect(compose).toContain('--save "" --appendonly no');

    const valkey: Record<string, unknown> = objectAt(
      yamlOf(`${CHART}/values.yaml`),
      "valkey",
    );
    const image: Record<string, unknown> = objectAt(valkey, "image");

    expect(`${image["repository"]}:${image["tag"]}`).toBe(
      "valkey/valkey:9.1-alpine",
    );
    expect(String(valkey["commonConfiguration"])).toContain("appendonly no");
    expect(String(valkey["commonConfiguration"])).toContain('save ""');
  });

  it("names the ten settings the update merge knows as renames, and keeps your old values where they are", () => {
    const renamed: Array<string> = codeOfLine(
      page,
      "The ten renamed settings are",
    ).filter((code: string): boolean => {
      // The settings by name, not the `VALKEY_*` spelling the line also names.
      return code.startsWith("VALKEY_") && !code.includes("*");
    });

    expect(renamed).toHaveLength(10);
    expect(renamed).toEqual(Object.keys(mergeEnvScript.RENAMED_FROM));

    for (const name of renamed) {
      expect(mergeEnvScript.RENAMED_FROM[name]).toBe(
        name.replace(/^VALKEY_/, "REDIS_"),
      );
    }

    expect(page).toContain(
      "but it recognises these ten as renames and leaves your values — including your `REDIS_PASSWORD` — exactly where they are. It prints which ones it kept.",
    );

    const merged: { contents: string; carriedOver: Array<string> } =
      mergeEnvScript.mergeEnvTemplate(
        `VALKEY_PASSWORD=${PLACEHOLDER_SECRET}`,
        "REDIS_PASSWORD=yours",
      );

    expect(merged.contents).toBe("REDIS_PASSWORD=yours");
    expect(merged.carriedOver).toEqual([
      "REDIS_PASSWORD (kept in place of VALKEY_PASSWORD)",
    ]);
    expect(source("Scripts/Install/MergeEnvTemplate.js")).toContain(
      "renamed setting(s) at their existing values",
    );
  });

  it("answers to the hostname redis too, and reads REDIS_HOST when VALKEY_HOST is unset", () => {
    expect(page).toContain(
      "| Compose service | `redis` | `valkey` — still answers to the hostname `redis` |",
    );
    expect(page).toContain(
      "The base file now sets `VALKEY_HOST` from your `REDIS_HOST`, and the app reads `VALKEY_HOST` first",
    );

    const services: Record<string, unknown> = objectAt(
      yamlOf("docker-compose.base.yml"),
      "services",
    );
    const networks: Record<string, unknown> = objectAt(
      services,
      "valkey",
      "networks",
      "oneuptime",
    );

    expect(networks["aliases"]).toContain("redis");
    expect(source("docker-compose.base.yml")).toContain(
      "VALKEY_HOST: ${VALKEY_HOST:-${REDIS_HOST}}",
    );
  });

  it("carries the password over from <release>-redis, keeps the old Secrets and serves the old Service name until legacyServiceAlias is off", () => {
    expect(page).toContain(
      "The chart reads the password out of your existing `<release>-redis` Secret and carries it into `<release>-valkey`, rather than minting a new one.",
    );
    expect(page).toContain("are annotated `helm.sh/resource-policy: keep`");
    expect(page).toContain(
      "Set `valkey.legacyServiceAlias: false` to drop it once every workload has rolled.",
    );

    const secrets: string = source(`${CHART}/templates/secrets.yaml`);

    expect(secrets).toContain(
      '(lookup "v1" "Secret" $.Release.Namespace (printf "%s-redis" $.Release.Name))',
    );
    expect(secrets).toContain(
      'valkey-password: {{ index $existingRedisSecretData "redis-password" | b64dec | quote }}',
    );
    expect(secrets).toContain('"helm.sh/resource-policy": "keep"');

    expect(
      objectAt(yamlOf(`${CHART}/values.yaml`), "valkey")["legacyServiceAlias"],
    ).toBe(true);

    const service: string = source(`${CHART}/templates/valkey-service.yaml`);

    expect(service).toContain("{{- if $valkey.legacyServiceAlias }}");
    expect(service).toContain("-redis-master");
  });

  it("prints DEPRECATED VALUES for the old keys on helm upgrade", () => {
    expect(page).toContain(
      "and `helm upgrade` prints a `DEPRECATED VALUES` notice listing the old keys it found.",
    );
    expect(source(`${CHART}/templates/NOTES.txt`)).toContain(
      "DEPRECATED VALUES:",
    );
  });

  it("reads Connected and a memory figure on Admin Dashboard → OneUptime Health → Valkey", () => {
    expect(page).toContain(
      "**Admin Dashboard → OneUptime Health → Valkey** should read Connected, with a memory figure.",
    );

    const adminLocale: { breadcrumbs: Record<string, string> } = JSON.parse(
      source(`${ADMIN_DASHBOARD}/Locales/en.json`),
    ) as { breadcrumbs: Record<string, string> };

    expect(adminLocale.breadcrumbs["adminDashboard"]).toBe("Admin Dashboard");
    expect(source(`${ADMIN_DASHBOARD}/Components/NavBar/NavBar.tsx`)).toContain(
      'title: "OneUptime Health"',
    );

    const healthPage: string = source(
      `${ADMIN_DASHBOARD}/Pages/Health/HealthPage.tsx`,
    );

    expect(healthPage).toContain('title: t("breadcrumbs.adminDashboard")');
    expect(healthPage).toContain('title: "OneUptime Health"');
    expect(source(`${ADMIN_DASHBOARD}/Pages/Health/Redis.tsx`)).toContain(
      'title="Valkey"',
    );

    if (!hasEnterpriseEdition()) {
      return;
    }

    const valkeyHealth: string = source(
      `${ENTERPRISE_ADMIN_HEALTH}/RedisHealth.tsx`,
    );

    expect(valkeyHealth).toContain('connected ? "Connected" : "Unreachable"');
    expect(valkeyHealth).toContain('"Memory used"');
  });

  it("diagnoses the cache's memory and evictions under its old and new names", () => {
    expect(page).toContain(
      "`HelmChart/Public/diagnose.sh` reports cache memory, evictions and connectivity, and understands both the old and new object names.",
    );

    const diagnose: string = source("HelmChart/Public/diagnose.sh");

    expect(diagnose).toContain('first_ready_pod "app=${RELEASE}-valkey"');
    expect(diagnose).toContain('first_ready_pod "app=${RELEASE}-redis"');
    expect(diagnose).toContain(
      'secret_value "${RELEASE}-redis" "redis-password"',
    );
    expect(diagnose).toContain("used_memory");
    expect(diagnose).toContain("evicted_keys");
    expect(diagnose).toContain("Could not query the cache");
  });

  it("keeps the API's redis keys, route and Query Console engine", () => {
    expect(page).toContain(
      "`components.redis` and `summary.redis` in the instance health payload, the `/api/admin/health/redis` route, and the `redis` engine value in the admin Query Console are wire keys, not display text.",
    );

    expect(source("packages/App/API/AdminHealth.ts")).toMatch(
      /components: \{[\s\S]*?redis: redisStats,/,
    );

    if (!hasEnterpriseEdition()) {
      return;
    }

    const dashboards: string = source(
      `${ENTERPRISE_SERVER_HEALTH}/HealthDashboards.ts`,
    );

    expect(dashboards).toMatch(
      /redis: \{\s*connected: Boolean\(redis\["connected"\]\)/,
    );
    expect(dashboards).toMatch(/router\.get\(\s*"\/redis",/);
    expect(source(`${ENTERPRISE_SERVER_HEALTH}/QueryConsole.ts`)).toContain(
      'engine: "redis",',
    );
  });
});

describe("Upgrading from 11 → 12: the Runner merge's Compose and Helm steps", () => {
  const page: string = englishPage();

  it("appends ONEUPTIME_RUNNER_KEY with the placeholder, and does not carry AI_AGENT_KEY over", () => {
    expect(page).toContain(
      "The template merge appends it with the literal placeholder `please-change-this-to-random-value`; your old `AI_AGENT_KEY` value is **not** carried over.",
    );
    expect(source("config.example.env")).toContain(
      `ONEUPTIME_RUNNER_KEY=${PLACEHOLDER_SECRET}`,
    );
    expect(mergeEnvScript.RENAMED_FROM["ONEUPTIME_RUNNER_KEY"]).toBeUndefined();

    const merged: { contents: string } = mergeEnvScript.mergeEnvTemplate(
      `ONEUPTIME_RUNNER_KEY=${PLACEHOLDER_SECRET}`,
      "AI_AGENT_KEY=yours",
    );

    expect(merged.contents.split("\n")).toEqual([
      "AI_AGENT_KEY=yours",
      `ONEUPTIME_RUNNER_KEY=${PLACEHOLDER_SECRET}`,
    ]);
  });

  it("fails helm upgrade's validation on an aiAgent: block, and keeps the KEDA metric's name", () => {
    expect(page).toContain(
      "the chart schema rejects unknown keys, so `helm upgrade` **fails validation** while an `aiAgent:` block remains.",
    );
    expect(page).toContain(
      "the KEDA scaling metric is still named `oneuptime_ai_agent_queue_size`",
    );

    const schema: {
      additionalProperties: unknown;
      properties: Record<string, unknown>;
    } = JSON.parse(source(`${CHART}/values.schema.json`)) as {
      additionalProperties: unknown;
      properties: Record<string, unknown>;
    };

    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toContain("runner");
    expect(Object.keys(schema.properties)).not.toContain("aiAgent");
    expect(source(`${CHART}/templates/keda-scaledobjects.yaml`)).toMatch(
      /\.Values\.runner\.keda\.enabled[^\n]*"query" "oneuptime_ai_agent_queue_size"/,
    );
  });
});

describe("Upgrading: what the server prints, as the page quotes it", () => {
  const page: string = englishPage();

  it("quotes a refused move back up an episode's or a maintenance event's states as the state move refuses it", () => {
    const episode: string | null = StateMoveUtil.getMoveRefusal({
      record: StateMoveRecord.IncidentEpisode,
      from: { id: "resolved", name: "Resolved", order: 3 },
      to: { id: "acknowledged", name: "Acknowledged", order: 2 },
    });
    const maintenance: string | null = StateMoveUtil.getMoveRefusal({
      record: StateMoveRecord.ScheduledMaintenance,
      from: { id: "ongoing", name: "Ongoing", order: 2 },
      to: { id: "scheduled", name: "Scheduled", order: 1 },
    });

    expect(episode).toBe(
      "Episode cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of incident states.",
    );
    expect(maintenance).toBe(
      "Scheduled Maintenance cannot transition to Scheduled state from Ongoing state because Scheduled is before Ongoing in the order of scheduled maintenance states.",
    );
    expect(page).toContain(`("${episode}")`);
    expect(page).toContain(`"${maintenance}"`);
  });

  /*
   * The other words the page quotes, each with the source file that prints
   * it and the template there it comes from.
   */
  it.each([
    {
      quoted: "... is already acknowledged.",
      file: "packages/Common/Utils/AcknowledgedState.ts",
      template: "${data.subject} is already acknowledged.",
    },
    {
      quoted: "There is no later state to move this incident to.",
      file: "packages/Common/Server/Utils/Workspace/WorkspaceMemberActions.ts",
      template:
        "There is no later state to move this ${this.getNoun(type)} to.",
    },
    {
      quoted: "All labels removed.",
      file: "packages/Common/Server/Utils/EventFieldChange.ts",
      template: "All labels removed.",
    },
    {
      quoted: "No other affected resources.",
      file: "packages/Common/Server/Utils/ScheduledMaintenance/ScheduledMaintenanceFieldChange.ts",
      template: "No other affected resources.",
    },
    {
      quoted:
        "Looking up phone numbers needs permission to read incoming call policies and call and SMS settings.",
      file: "packages/Common/Utils/IncomingCall/IncomingCallPhoneNumberAccess.ts",
      template:
        "Looking up phone numbers needs permission to read incoming call policies and call and SMS settings.",
    },
  ])(
    'quotes "$quoted" as $file prints it',
    (example: { quoted: string; file: string; template: string }) => {
      expect(page).toContain(`"${example.quoted}"`);
      expect(source(example.file)).toContain(example.template);
      expect(example.quoted.replace(/^\.\.\. /, "Alert ")).toMatch(
        templatePattern(example.template),
      );
    },
  );

  it("quotes the OTLP refusal as the ingest services answer it", () => {
    expect(page).toContain(
      "14 answers `503` with `Telemetry queue unavailable. Please retry.` instead",
    );

    for (const file of [
      "packages/App/FeatureSet/Telemetry/GrpcServer.ts",
      "packages/App/FeatureSet/Telemetry/Services/OtelMetricsIngestService.ts",
      "packages/App/FeatureSet/Telemetry/Services/OtelProfilesIngestService.ts",
    ]) {
      expect(source(file)).toContain(
        "Telemetry queue unavailable. Please retry.",
      );
    }
  });
});

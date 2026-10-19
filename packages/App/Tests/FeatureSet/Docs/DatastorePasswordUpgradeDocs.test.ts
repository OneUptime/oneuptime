import { inlineCode } from "./DocsTranslationChecks";
import {
  flattened,
  otherChangesItemAtEnglishPlace,
  otherChangesItems,
} from "./UpgradingDocsNotes";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note that says the secrets the install steps used to leave at
 * their placeholders now get values of their own, or are refused, or named -
 * held to the code that makes it true.
 *
 * The note (installation/upgrading, "Other changes in 14") sits after the
 * note on redirects (KeyCarryingRedirectsUpgradeDocs) and before the note on
 * the inbound email webhook secret (InboundEmailWebhookSecretUpgradeDocs), and
 * every translation carries it in the English note's place with the English
 * note's code. What it claims is what the code does:
 *
 *   - Scripts/Install/ReplacePlaceholderSecrets gives a placeholder
 *     CLICKHOUSE_PASSWORD or VALKEY_PASSWORD a random value on any start, but
 *     only for the datastores Docker Compose runs, and is a step of npm start
 *     and of npm run update;
 *   - the app says at startup when REGISTER_PROBE_KEY or a datastore password
 *     still holds a value the repository ships;
 *   - a probe's, a Runner's or an AI agent's key is never stored as such a
 *     value, and the runbook protocol refuses one;
 *   - the Helm chart gives the Altinity operator's own user a random password
 *     on a new install, keeps an existing install's, and helm upgrade says how
 *     to change one still at the operator chart's.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const NOTE_LEAD: string =
  "**The bundled ClickHouse and Valkey get passwords of their own.**";
// The note before it (KeyCarryingRedirectsUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**Probes, Runners, the infrastructure agent and OneUptime's own services follow redirects only on the server they call.**";
// The note after it (InboundEmailWebhookSecretUpgradeDocs).
const NEXT_LEAD: string =
  "**Incoming email needs a webhook secret of your own.**";

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on the bundled datastores' passwords", () => {
  it("is a note of the 13 → 14 changes, once, after the note on redirects and before the note on the inbound email webhook secret", () => {
    expect(NOTE_INDEX).toBeGreaterThan(0);
    expect(
      ENGLISH_ITEMS.filter((item: string): boolean => {
        return flattened(item).includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX - 1]!).startsWith(
        `- ${PREVIOUS_LEAD}`,
      ),
    ).toBe(true);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX + 1]!).startsWith(`- ${NEXT_LEAD}`),
    ).toBe(true);
  });

  it("names the settings it is about, what fills them and the commands an operator runs", () => {
    // inlineCode lists a text's code spans sorted, each as often as it appears.
    expect(inlineCode(ENGLISH_NOTE)).toEqual(
      [
        "CLICKHOUSE_PASSWORD",
        "VALKEY_PASSWORD",
        "config.env",
        "config.example.env",
        "npm start",
        "npm run update",
        "CLICKHOUSE_HOST",
        "VALKEY_HOST",
        "config.env",
        "npm start",
        "REGISTER_PROBE_KEY",
        "clickhouseOperator.altinity.enabled",
        "helm upgrade",
      ].sort(),
    );
  });

  it("says what changes for an existing install, and what is left to the operator", () => {
    for (const claim of [
      "now give it a random value, on an existing install too",
      "That is done only while `CLICKHOUSE_HOST` or `VALKEY_HOST` names the ClickHouse or Valkey that Docker Compose runs",
      "both take their password each time they start, so the same start recreates them with the new one, and ClickHouse keeps its data",
      "A tool of your own that signs in to either needs the new value from `config.env`",
      "A placeholder for a ClickHouse or cache you run elsewhere is left as it is, and `npm start` says so",
      "the app now also warns when `REGISTER_PROBE_KEY` is unset or a value the repository ships, or a datastore password is one",
      "A probe's, a Runner's or an AI agent's key can no longer be set to such a value",
      "a Runner of yours that has one stops connecting until you reset its key in the dashboard and give the Runner the new one",
      "a new install gives the operator's own ClickHouse user a random password instead of the one its chart ships to every installation",
      "An existing install keeps its password, and `helm upgrade` says how to change it",
    ]) {
      expect({ claim, said: ENGLISH_NOTE.includes(claim) }).toEqual({
        claim,
        said: true,
      });
    }
  });
});

describe("the note is true to the code", () => {
  it("the install step gives the placeholder passwords of the datastores Docker Compose runs a random value, and leaves the others", () => {
    const script: string = source(
      "Scripts/Install/ReplacePlaceholderSecrets.js",
    );
    const list: string = script.slice(
      script.indexOf("const BUNDLED_DATASTORE_PASSWORDS = ["),
      script.indexOf("];", script.indexOf("const BUNDLED_DATASTORE_PASSWORDS")),
    );

    for (const fragment of [
      'passwordSettings: ["CLICKHOUSE_PASSWORD"]',
      'hostSettings: ["CLICKHOUSE_HOST"]',
      'bundledHosts: ["clickhouse"]',
      'passwordSettings: ["VALKEY_PASSWORD", "REDIS_PASSWORD"]',
      'hostSettings: ["VALKEY_HOST", "REDIS_HOST"]',
      'bundledHosts: ["valkey", "redis"]',
    ]) {
      expect(list).toContain(fragment);
    }

    // A placeholder for a datastore elsewhere is left, and the operator told.
    expect(script).toContain(
      'decision: isBundledDatastore(settings, entry) ? "generate" : "external"',
    );
    expect(script).toContain("warn(describeExternalDatastorePassword(entry));");
  });

  it("a new install's config.env names the datastores Docker Compose runs", () => {
    const template: string = source("config.example.env");

    expect(template.split("\n")).toContain("CLICKHOUSE_HOST=clickhouse");
    expect(template.split("\n")).toContain("VALKEY_HOST=valkey");
  });

  it("the step runs in npm start and in npm run update", () => {
    const packageJson: { scripts: Record<string, string> } = JSON.parse(
      source("package.json"),
    );

    expect(packageJson.scripts["start"]).toContain(
      "node ./Scripts/Install/ReplacePlaceholderSecrets.js",
    );
    expect(packageJson.scripts["update"]).toContain("npm run start");
    expect(source("Scripts/Install/configure.sh")).toContain(
      "node ./Scripts/Install/ReplacePlaceholderSecrets.js",
    );
  });

  it("the app warns at startup about REGISTER_PROBE_KEY and the datastore passwords", () => {
    const environmentConfig: string = source(
      "packages/Common/Server/EnvironmentConfig.ts",
    );
    expect(environmentConfig).toContain(
      "export const RegisterProbeKeyWarning: string | null = IsRegisterProbeKeyShipped",
    );
    expect(environmentConfig).toContain(
      "export const DatastorePasswordWarning: string | null =",
    );

    const boot: string = source("packages/App/Index.ts");
    expect(boot).toContain("logger.warn(RegisterProbeKeyWarning);");
    expect(boot).toContain("logger.warn(DatastorePasswordWarning);");
  });

  it("a probe's, a Runner's and an AI agent's key is never stored as a shipped value, and the runbook protocol refuses one", () => {
    for (const [service, component] of [
      ["ProbeService", "a probe"],
      ["RunnerService", "a Runner"],
      ["AIAgentService", "an AI agent"],
    ] as Array<[string, string]>) {
      const code: string = source(
        `packages/Common/Server/Services/${service}.ts`,
      );

      expect(code).toContain(
        `ComponentKeyWrite.assertCreatedKey(createBy.data.key, "${component}");`,
      );
      expect(code).toContain(
        `ComponentKeyWrite.assertUpdatedKey(updateBy.data, "${component}");`,
      );
    }

    expect(
      source("packages/Common/Server/Services/RunnerService.ts"),
    ).toContain(
      "if (isShippedSecretValue(data.agentKey)) {\n      return null;\n    }",
    );
  });

  it("the Helm chart renders the operator's credentials itself: a new install's random, an existing one's kept, and says how to change the shipped one", () => {
    const values: string = source("HelmChart/Public/oneuptime/values.yaml");
    const block: string = values.slice(
      values.indexOf("\naltinity-clickhouse-operator:"),
    );

    expect(block).toContain(
      'secret:\n    create: false\n    username: clickhouse_operator\n    password: ""',
    );
    expect(block).not.toContain("clickhouse_operator_password");

    const secrets: string = source(
      "HelmChart/Public/oneuptime/templates/secrets.yaml",
    );
    expect(secrets).toContain(
      'password: {{ include "oneuptime.altinityOperator.password" . | default (randAlphaNum 32) | quote }}',
    );

    const helpers: string = source(
      "HelmChart/Public/oneuptime/templates/_helpers.tpl",
    );
    // The stored password is read back, so an upgrade keeps it.
    expect(helpers).toContain(
      '{{- $stored := ((lookup "v1" "Secret" (include "oneuptime.altinityOperator.namespace" .) (include "oneuptime.altinityOperator.fullname" .)).data) | default dict -}}',
    );

    const notes: string = source(
      "HelmChart/Public/oneuptime/templates/NOTES.txt",
    );
    expect(notes).toContain(
      "ACTION RECOMMENDED -- the ClickHouse operator's own user still has the password",
    );
  });
});

describe("every translation carries the note", () => {
  it.each(TRANSLATIONS)(
    "%s has the note in the English note's place, with the English code",
    (language: string) => {
      const note: string = flattened(
        otherChangesItemAtEnglishPlace(
          language,
          "The bundled ClickHouse and Valkey get passwords of their own.",
        ),
      );

      expect(inlineCode(note)).toEqual(inlineCode(ENGLISH_NOTE));

      // A translated lead, not the English words.
      expect(note.startsWith(`- ${NOTE_LEAD}`)).toBe(false);
      expect(note.startsWith("- **")).toBe(true);
    },
  );
});

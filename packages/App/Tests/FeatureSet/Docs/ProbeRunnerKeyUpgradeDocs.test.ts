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
 * The upgrade note that says a global probe and the bundled Runner no longer
 * authenticate with a key the repository ships, held to the code that makes
 * it true.
 *
 * A global probe runs every project's monitors and the bundled Runner serves
 * every project's AI code fixes, so a key that is public in the repository
 * must never let a caller be one of them. The note (installation/upgrading,
 * "Other changes in 14") sits after the wrong-two-factor-codes note and
 * before the note on redirects (KeyCarryingRedirectsUpgradeDocs), names the
 * four keys it is about and where an operator sets them, and every
 * translation carries it in the English note's place with the English
 * note's code. What it claims is what the server and the install script do:
 *
 *   - ProbeIngest/Register refuses to register a global probe when
 *     REGISTER_PROBE_KEY is a shipped value, and refuses a shipped probe key;
 *   - ProbeService.verifyProbeKey refuses a shipped probe key on every probe
 *     request;
 *   - CodeFixAgentAuth and the AI agent heartbeat refuse a shipped agent key;
 *   - Scripts/Install/ReplacePlaceholderSecrets gives each of the four keys a
 *     random value in config.env when it still holds a placeholder.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const NOTE_LEAD: string =
  "**A global probe and the bundled Runner no longer authenticate with a key the repository ships.**";
// The note before it (the wrong-two-factor-codes note, TwoFactorWrongCodesDocs).
const PREVIOUS_LEAD: string =
  "**Wrong two-factor codes are counted for the account, wherever they come from.**";
// The note after it (KeyCarryingRedirectsUpgradeDocs).
const NEXT_LEAD: string =
  "**Probes, Runners, the infrastructure agent and OneUptime's own services follow redirects only on the server they call.**";

const KEYS: Array<string> = [
  "REGISTER_PROBE_KEY",
  "GLOBAL_PROBE_1_KEY",
  "GLOBAL_PROBE_2_KEY",
  "ONEUPTIME_RUNNER_KEY",
];

const SECRETS_LINK: string =
  "/docs/installation/docker-compose#generate-random-secrets";

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

describe("the English upgrade note on the global-probe and Runner keys", () => {
  it("is a note of the 13 → 14 changes, once, after the wrong-two-factor-codes note and before the note on redirects", () => {
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

  it("names the four keys an operator sets, and the values it refuses", () => {
    const code: Array<string> = inlineCode(ENGLISH_NOTE);

    for (const key of KEYS) {
      expect(code).toContain(key);
    }

    // The shipped values it refuses, in the installation's own words.
    for (const span of ["secret", "config.example.env", "please-change-this"]) {
      expect(code).toContain(span);
    }

    // What fills them on Docker Compose.
    for (const span of ["npm start", "npm run update", "config.env"]) {
      expect(code).toContain(span);
    }
  });

  it("links to Generate random secrets on the Docker Compose page", () => {
    expect(ENGLISH_NOTE).toContain(`(${SECRETS_LINK})`);
  });

  it("says the bundled probe keeps its monitors, and the Helm chart already generates the keys", () => {
    expect(ENGLISH_NOTE).toContain(
      "the bundled probe re-registers under its new key without losing its monitors",
    );
    expect(ENGLISH_NOTE).toContain(
      "The Helm chart already generates random values for all of them",
    );
    expect(ENGLISH_NOTE).toContain(
      "an installation that set its own keys, see no change",
    );
  });
});

describe("the note is true to the code", () => {
  it("the register route refuses a shipped register key and a shipped probe key", () => {
    const register: string = source(
      "packages/App/FeatureSet/Telemetry/API/ProbeIngest/Register.ts",
    );

    expect(register).toContain("if (IsRegisterProbeKeyShipped) {");
    expect(register).toContain("isShippedSecretValue(registerProbeKey)");
    expect(register).toContain("isShippedSecretValue(probeKey)");
    // The register key is compared in constant time, never with ===.
    expect(register).toContain("SecretKeyComparison.timingSafeEqual(");
    expect(register).toContain("RegisterProbeKey.toString()");
    expect(register.includes("registerProbeKey !== RegisterProbeKey")).toBe(
      false,
    );
  });

  it("the bundled probe keeps its monitors: it takes over only the global probe of its name that holds a shipped key", () => {
    const register: string = source(
      "packages/App/FeatureSet/Telemetry/API/ProbeIngest/Register.ts",
    );
    expect(register).toContain("ProbeService.findGlobalProbeToTakeOver({");

    const takeover: string = source(
      "packages/Common/Server/Utils/ShippedKeyTakeover.ts",
    );
    expect(takeover).toContain("return isShippedSecretValue(row.key);");

    /*
     * The bundled Runner took over its global agent the same way until
     * global Runners took its work: nothing registers an agent any more.
     */
    const aiAgentApi: string = source(
      "packages/Common/Server/API/AIAgentAPI.ts",
    );
    expect(aiAgentApi).not.toContain("findGlobalAIAgentToTakeOver");
    expect(aiAgentApi).not.toContain("/register`");
  });

  it("verifyProbeKey refuses a shipped probe key before it reads the cache or the database", () => {
    const probeService: string = source(
      "packages/Common/Server/Services/ProbeService.ts",
    );

    expect(probeService).toContain(
      "if (isShippedSecretValue(data.probeKey)) {\n      return false;\n    }",
    );
  });

  it("the code-fix protocol and the AI agent heartbeat refuse a shipped agent key", () => {
    const codeFixAuth: string = source(
      "packages/Common/Server/Utils/AI/CodeFix/CodeFixAgentAuth.ts",
    );
    // A shipped key proves no identity, whatever the registries hold.
    expect(codeFixAuth).toContain(
      "if (isShippedSecretValue(agentKey)) {\n      return { identity: null, agentId: agentId, isKeyRight: false };\n    }",
    );

    const aiAgentApi: string = source(
      "packages/Common/Server/API/AIAgentAPI.ts",
    );
    // The heartbeat refuses a shipped key; there is no registration any more.
    expect(
      aiAgentApi.split("if (isShippedSecretValue(aiAgentKey)) {").length - 1,
    ).toBe(1);
  });

  it("EnvironmentConfig reads REGISTER_PROBE_KEY with no shipped fallback", () => {
    const environmentConfig: string = source(
      "packages/Common/Server/EnvironmentConfig.ts",
    );

    expect(environmentConfig).toContain(
      'process.env["REGISTER_PROBE_KEY"] || "",',
    );
    expect(environmentConfig).toContain(
      "export const IsRegisterProbeKeyShipped: boolean = isShippedSecretValue(",
    );
  });

  it("the install script generates the probe keys and the global Runner's key, beside the cluster key", () => {
    const script: string = source(
      "Scripts/Install/ReplacePlaceholderSecrets.js",
    );

    // The generated-secrets list, read from the source so no module is run here.
    const block: string = script.slice(
      script.indexOf("const GENERATED_SECRETS = ["),
      script.indexOf("]", script.indexOf("const GENERATED_SECRETS = [")) + 1,
    );
    for (const key of [
      "ONEUPTIME_SECRET",
      "REGISTER_PROBE_KEY",
      "GLOBAL_PROBE_1_KEY",
      "GLOBAL_PROBE_2_KEY",
      "GLOBAL_RUNNER_KEY",
    ]) {
      expect(block).toContain(`"${key}"`);
    }

    // The shared Runner's key went with the shared Runner.
    expect(block).not.toContain('"ONEUPTIME_RUNNER_KEY"');

    // It is a step of the start script, not a prestart hook ignore-scripts skips.
    const packageJson: { scripts: Record<string, string> } = JSON.parse(
      source("package.json"),
    );
    expect(packageJson.scripts["prestart"]).toBeUndefined();
    expect(packageJson.scripts["start"]).toContain(
      "node ./Scripts/Install/ReplacePlaceholderSecrets.js",
    );
  });
});

describe("every translation carries the note", () => {
  it.each(TRANSLATIONS)(
    "%s has the note in the English note's place, with the English code and the secrets link",
    (language: string) => {
      const note: string = flattened(
        otherChangesItemAtEnglishPlace(
          language,
          "A global probe and the bundled Runner no longer authenticate with a key the repository ships.",
        ),
      );

      // The same code spans as the English note, nothing dropped or added.
      expect(inlineCode(note).sort()).toEqual(inlineCode(ENGLISH_NOTE).sort());

      // The secrets link, to the same page (the anchor is localized per page).
      expect(note).toContain("(/docs/installation/docker-compose#");

      // A translated lead, not the English words.
      expect(note.startsWith(`- ${NOTE_LEAD}`)).toBe(false);
    },
  );
});

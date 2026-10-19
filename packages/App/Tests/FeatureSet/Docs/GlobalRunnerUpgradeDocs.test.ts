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
 * The upgrade note that says every install now runs a global Runner of its
 * own - the bundled global Runner that runs every project's JavaScript steps
 * that pick no Runner - held to the code that makes it true.
 *
 * The note (installation/upgrading, "Other changes in 14") sits after the
 * note that wrong probe and Runner keys are counted
 * (SharedRunnerOwnKeyUpgradeDocs) and before the note that visitors keep
 * their own address (VisitorAddressesUpgradeDocs), and every translation carries it in the
 * English note's place, with the English note's code and a link to the
 * Global Runners section in the reader's language. What it claims is what
 * the install does:
 *
 *   - Docker Compose runs a global-runner service, and the Helm chart a
 *     globalRunner deployment, on by default;
 *   - its key is GLOBAL_RUNNER_KEY, which npm start (ReplacePlaceholderSecrets)
 *     gives a random value and the chart generates;
 *   - it is turned off with GLOBAL_RUNNER_REPLICAS=0 or globalRunner.enabled;
 *   - an existing runbook secret reaches it only once switched on: the
 *     column starts off for every secret that existed before.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const NOTE_LEAD: string = "**Every install runs a global Runner of its own.**";
// The note before it (SharedRunnerOwnKeyUpgradeDocs).
const PREVIOUS_LEAD: string = "**Wrong probe and Runner keys are counted.**";
// The note after it (VisitorAddressesUpgradeDocs).
const NEXT_LEAD: string = "**Visitors keep their own address in more setups.**";

const SECTION_LINK: string = "(/docs/runbooks/agents#";

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

describe("the English upgrade note on the bundled global Runner", () => {
  it("is a note of the 13 → 14 changes, once, after the note that wrong probe and Runner keys are counted and before the note that visitors keep their own address", () => {
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

  it("says what runs, what it holds, and how it is turned off", () => {
    for (const claim of [
      "A new `global-runner` service in Docker Compose, and a `globalRunner` deployment in the Helm chart, run the JavaScript steps of every project that picks no Runner of its own, each in a sandbox that reaches the internet only.",
      "It holds its own key, `GLOBAL_RUNNER_KEY`, which `npm start` and `npm run update` give a random value and the chart generates, and nothing else of the server's.",
      "Steps that pick a Runner keep it, and an existing runbook secret reaches it only once you turn its **Global Runners can use this secret** switch on.",
      "To turn it off, set `GLOBAL_RUNNER_REPLICAS=0` in `config.env`, or `globalRunner.enabled` to `false` in the chart.",
    ]) {
      expect({ claim, said: ENGLISH_NOTE.includes(claim) }).toEqual({
        claim,
        said: true,
      });
    }

    expect(ENGLISH_NOTE).toContain(
      "[Global Runners](/docs/runbooks/agents#global-runners)",
    );
  });
});

describe("the note is true to the install", () => {
  it("Docker Compose runs the global-runner service unless GLOBAL_RUNNER_REPLICAS is 0", () => {
    expect(source("docker-compose.yml")).toContain(
      "  global-runner:\n    image: oneuptime/runner:${APP_TAG}\n",
    );
    expect(source("docker-compose.base.yml")).toContain(
      "      replicas: ${GLOBAL_RUNNER_REPLICAS:-1}\n",
    );
  });

  it("the Helm chart runs its globalRunner deployment by default, and generates its key", () => {
    expect(source("HelmChart/Public/oneuptime/values.yaml")).toContain(
      "globalRunner:\n  enabled: true\n",
    );
    expect(
      source("HelmChart/Public/oneuptime/templates/secrets.yaml"),
    ).toContain("global-runner-key: {{ randAlphaNum 32 | quote }}");
  });

  it("npm start gives GLOBAL_RUNNER_KEY a random value", () => {
    const script: string = source(
      "Scripts/Install/ReplacePlaceholderSecrets.js",
    );
    const block: string = script.slice(
      script.indexOf("const GENERATED_SECRETS = ["),
      script.indexOf("]", script.indexOf("const GENERATED_SECRETS = [")) + 1,
    );

    expect(block).toContain('"GLOBAL_RUNNER_KEY"');
    expect(source("config.example.env").split("\n")).toContain(
      "GLOBAL_RUNNER_KEY=please-change-this-to-random-value",
    );
  });

  it("a runbook secret that existed before reaches no global Runner until switched on", () => {
    const migration: string = source(
      "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1803950000000-AddGlobalRunners.ts",
    );

    expect(migration).toContain(
      'ALTER TABLE "RunbookSecret" ADD "isAvailableToGlobalRunners" boolean NOT NULL DEFAULT false',
    );
  });
});

describe("every translation carries the note", () => {
  it.each(TRANSLATIONS)(
    "%s has the note in the English note's place, with the English code and the section link",
    (language: string) => {
      const note: string = flattened(
        otherChangesItemAtEnglishPlace(
          language,
          "Every install runs a global Runner of its own.",
        ),
      );

      // The same code spans as the English note, nothing dropped or added.
      expect(inlineCode(note).sort()).toEqual(inlineCode(ENGLISH_NOTE).sort());

      // The section link, to the same page (the anchor is localized per page).
      expect(note).toContain(SECTION_LINK);

      // A translated lead, not the English words.
      expect(note.startsWith(`- ${NOTE_LEAD}`)).toBe(false);
    },
  );
});

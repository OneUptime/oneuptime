import { inlineCode } from "./DocsTranslationChecks";
import {
  flattened,
  otherChangesItemAtEnglishPlace,
  otherChangesItems,
} from "./UpgradingDocsNotes";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  WRONG_COMPONENT_KEYS_PER_ADDRESS,
  WRONG_COMPONENT_KEY_WINDOW_SECONDS,
} from "Common/Server/Utils/RateLimit/WrongComponentKeyLimit";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The two upgrade notes on the keys the bundled Runner and the probes
 * present (installation/upgrading, "Other changes in 14"), held to the code
 * and the deployment files that make them true:
 *
 *   - the bundled Runner registers with its own ONEUPTIME_RUNNER_KEY, which
 *     docker-compose.yml and the Helm chart give the app too, and holds no
 *     ONEUPTIME_SECRET; a deployment of its own sets ONEUPTIME_RUNNER_SHARED
 *     on it; a Runner that still presents the cluster key keeps registering,
 *     and the app logs that it should be updated;
 *   - wrong probe, Runner and AI agent keys, and wrong REGISTER_PROBE_KEY and
 *     ONEUPTIME_RUNNER_KEY values, are counted: ten different ones from one
 *     address in a quarter of an hour, then 429 until it ends.
 *
 * The notes sit after the note on the inbound email webhook secret
 * (InboundEmailWebhookSecretUpgradeDocs) and before the endpoint pointer,
 * and every translation carries them in the English notes' places, under
 * leads of its own, with the English notes' code.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const RUNNER_KEY_LEAD: string =
  "The bundled Runner registers with its own key, and holds no `ONEUPTIME_SECRET`.";
const WRONG_KEYS_LEAD: string = "Wrong probe and Runner keys are counted.";
// The note before them (InboundEmailWebhookSecretUpgradeDocs).
const PREVIOUS_LEAD: string =
  "Incoming email needs a webhook secret of your own.";
const POINTER_START: string = "- See [API and endpoint changes]";

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");

function indexOfNote(lead: string): number {
  return ENGLISH_ITEMS.findIndex((item: string): boolean => {
    return flattened(item).startsWith(`- **${lead}**`);
  });
}

const RUNNER_KEY_INDEX: number = indexOfNote(RUNNER_KEY_LEAD);
const WRONG_KEYS_INDEX: number = indexOfNote(WRONG_KEYS_LEAD);
const RUNNER_KEY_NOTE: string = flattened(
  ENGLISH_ITEMS[RUNNER_KEY_INDEX] || "",
);
const WRONG_KEYS_NOTE: string = flattened(
  ENGLISH_ITEMS[WRONG_KEYS_INDEX] || "",
);

describe("where the two notes sit", () => {
  it("each is a note of the 13 → 14 changes, once, after the inbound email note and before the endpoint pointer, the Runner's key first", () => {
    for (const lead of [RUNNER_KEY_LEAD, WRONG_KEYS_LEAD]) {
      expect(
        ENGLISH_ITEMS.filter((item: string): boolean => {
          return flattened(item).includes(`**${lead}**`);
        }),
      ).toHaveLength(1);
    }

    expect(RUNNER_KEY_INDEX).toBeGreaterThan(0);
    expect(
      flattened(ENGLISH_ITEMS[RUNNER_KEY_INDEX - 1]!).startsWith(
        `- **${PREVIOUS_LEAD}**`,
      ),
    ).toBe(true);
    expect(WRONG_KEYS_INDEX).toBe(RUNNER_KEY_INDEX + 1);
    expect(ENGLISH_ITEMS[WRONG_KEYS_INDEX + 1]!.startsWith(POINTER_START)).toBe(
      true,
    );
  });
});

describe("the note on the bundled Runner's own key", () => {
  it("names the settings, files and commands it is about", () => {
    expect(inlineCode(RUNNER_KEY_NOTE)).toEqual(
      [
        "ONEUPTIME_SECRET",
        "runner",
        "runner.enabled",
        "ONEUPTIME_RUNNER_KEY",
        "ONEUPTIME_SECRET",
        "npm run update",
        "helm upgrade",
        "ONEUPTIME_RUNNER_KEY",
        "ONEUPTIME_RUNNER_SHARED",
        "true",
        "ONEUPTIME_SECRET",
        "ONEUPTIME_SECRET",
      ].sort(),
    );
  });

  it("says what changes, what an operator does, and what keeps working", () => {
    for (const claim of [
      "now registers with its `ONEUPTIME_RUNNER_KEY`, which the app is given too, so its container no longer holds `ONEUPTIME_SECRET`",
      "`npm run update` and `helm upgrade` set this up.",
      "If you start the containers another way, give the app the Runner's `ONEUPTIME_RUNNER_KEY`, set `ONEUPTIME_RUNNER_SHARED` to `true` on the Runner, and take `ONEUPTIME_SECRET` out of its environment.",
      "A Runner of an earlier release, or one that is still given `ONEUPTIME_SECRET`, keeps registering with it, and the app logs that it should be updated.",
    ]) {
      expect({ claim, said: RUNNER_KEY_NOTE.includes(claim) }).toEqual({
        claim,
        said: true,
      });
    }
  });

  it("is what docker-compose.yml does: the app gets the Runner's key, the Runner is marked shared and holds no cluster key", () => {
    const compose: string = source("docker-compose.base.yml");
    const runnerService: string =
      compose.split("\n  runner:\n")[1]?.split("\n  fluentd:\n")[0] || "";
    const runnerAnchor: string =
      compose
        .split("x-common-runner-variables: &common-runner-variables\n")[1]
        ?.split("\nx-common-runtime-variables")[0] || "";
    const appService: string =
      compose.split("\n  app:\n")[1]?.split("\n  home:\n")[0] || "";

    expect(runnerService).toContain('ONEUPTIME_RUNNER_SHARED: "true"');
    expect(runnerService).toContain(
      "ONEUPTIME_RUNNER_KEY: ${ONEUPTIME_RUNNER_KEY}",
    );
    expect(runnerService).not.toContain("ONEUPTIME_SECRET:");
    expect(runnerAnchor).not.toContain("ONEUPTIME_SECRET:");
    expect(appService).toContain(
      "ONEUPTIME_RUNNER_KEY: ${ONEUPTIME_RUNNER_KEY}",
    );
  });

  it("is what the Helm chart does: the app gets the Runner's key from the same place, the Runner is marked shared and given no cluster key", () => {
    const runner: string = source(
      "HelmChart/Public/oneuptime/templates/runner.yaml",
    );
    const app: string = source("HelmChart/Public/oneuptime/templates/app.yaml");

    expect(runner).toContain(
      '- name: ONEUPTIME_RUNNER_SHARED\n              value: "true"',
    );
    expect(runner).toContain('include "oneuptime.env.runnerKey"');
    expect(runner).not.toContain('include "oneuptime.env.oneuptimeSecret"');
    expect(app).toContain("{{- if $.Values.runner.enabled }}");
    expect(app).toContain('include "oneuptime.env.runnerKey"');
  });

  it("is what the Runner and the app do: only true marks the shared Runner, and a Runner that still sends the cluster key is told to update", () => {
    expect(source("packages/Runner/Config.ts")).toContain(
      'return (value || "").trim().toLowerCase() === "true";',
    );
    expect(
      source("packages/Common/Server/Middleware/ClusterKeyAuthorization.ts"),
    ).toContain("export const RUNNER_CLUSTER_KEY_MESSAGE: string =");
  });
});

describe("the note on wrong probe and Runner keys", () => {
  it("names the keys it is about and the answer a client gets", () => {
    expect(inlineCode(WRONG_KEYS_NOTE)).toEqual(
      ["REGISTER_PROBE_KEY", "ONEUPTIME_RUNNER_KEY", "429"].sort(),
    );
  });

  it("states the limit the code keeps: ten different wrong keys in a quarter of an hour, then 429", () => {
    expect(WRONG_COMPONENT_KEYS_PER_ADDRESS).toBe(10);
    expect(WRONG_COMPONENT_KEY_WINDOW_SECONDS).toBe(15 * 60);
    expect(ExceptionCode.TooManyRequestsException).toBe(429);

    for (const claim of [
      "One address may send only ten different wrong keys for one probe, Runner or AI agent in a quarter of an hour, and only ten different wrong values of `REGISTER_PROBE_KEY` or of the bundled Runner's `ONEUPTIME_RUNNER_KEY`.",
      "are answered with `429` until the quarter of an hour ends, the right key included.",
      "A probe or Runner that still sends the key it had before a reset sends one wrong key however often it calls, so it is never refused for it.",
    ]) {
      expect({ claim, said: WRONG_KEYS_NOTE.includes(claim) }).toEqual({
        claim,
        said: true,
      });
    }
  });
});

describe("every translation carries both notes", () => {
  it.each(TRANSLATIONS)(
    "%s has each in the English note's place, under a lead of its own, with the English code",
    (language: string) => {
      for (const [lead, english] of [
        [RUNNER_KEY_LEAD, RUNNER_KEY_NOTE],
        [WRONG_KEYS_LEAD, WRONG_KEYS_NOTE],
      ] as Array<[string, string]>) {
        const note: string = flattened(
          otherChangesItemAtEnglishPlace(language, lead),
        );

        expect(note.startsWith("- **")).toBe(true);
        expect(note.startsWith(`- **${lead}`)).toBe(false);
        expect({ language, lead, code: inlineCode(note) }).toEqual({
          language,
          lead,
          code: inlineCode(english),
        });
      }
    },
  );
});

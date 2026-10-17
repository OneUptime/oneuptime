import {
  HUNTRESS_SETUP_STEPS,
  HUNTRESS_SIGNING_SECRET_PROBLEM,
  HUNTRESS_TRIGGER_POLL_FOR_MS,
  HUNTRESS_TRIGGER_POLL_INTERVAL_MS,
  HUNTRESS_TRIGGER_STATE_LABELS,
  HuntressSetupStep,
  HuntressSetupStepStatus,
  HuntressTriggerFacts,
  HuntressTriggerPanelCopy,
  HuntressTriggerState,
  getHuntressSetupStepStatuses,
  getHuntressSigningSecretProblem,
  getHuntressTriggerState,
  isWaitingForHuntress,
} from "../../../../UI/Components/Workflow/HuntressTriggerState";
import { WORKFLOW_ENABLED_SWITCH_LABEL } from "../../../../Types/Workflow/WorkflowEnabled";
import StandardWebhookSignature from "../../../../Server/Utils/Webhook/StandardWebhookSignature";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { drawHuntressSigningSecret } from "../../../Types/Huntress/HuntressWebhookFixtures";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Where a Huntress trigger stands, from what its workflow keeps of the last
 * request Huntress sent - and every sentence its panel says, which the
 * dashboard looks up by its English text in seventeen locale files.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LOCALES: Array<string> = [
  "en",
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

const HOUR: number = 60 * 60 * 1000;
const NOW: number = new Date("2026-10-09T10:00:00.000Z").getTime();

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

describe("where the trigger stands", () => {
  test("no secret and nothing received: the signing secret is needed", () => {
    expect(getHuntressTriggerState({})).toBe(
      HuntressTriggerState.NeedsSigningSecret,
    );
    expect(getHuntressTriggerState({ isWebhookSigningSecretSet: false })).toBe(
      HuntressTriggerState.NeedsSigningSecret,
    );
  });

  test("a secret, nothing received yet: waiting for Huntress", () => {
    expect(getHuntressTriggerState({ isWebhookSigningSecretSet: true })).toBe(
      HuntressTriggerState.Waiting,
    );
  });

  test("a request let in: receiving reports", () => {
    expect(
      getHuntressTriggerState({
        isWebhookSigningSecretSet: true,
        lastWebhookRequestAt: new Date(NOW),
      }),
    ).toBe(HuntressTriggerState.Receiving);
  });

  test("a refusal newer than the last request let in, or with none let in: refusing", () => {
    expect(
      getHuntressTriggerState({
        isWebhookSigningSecretSet: true,
        lastWebhookRequestAt: new Date(NOW - HOUR),
        lastWebhookError: "The request's signature does not match.",
        lastWebhookErrorAt: new Date(NOW),
      }),
    ).toBe(HuntressTriggerState.Failing);
    expect(
      getHuntressTriggerState({
        isWebhookSigningSecretSet: false,
        lastWebhookError: "No signing secret is saved.",
        lastWebhookErrorAt: new Date(NOW),
      }),
    ).toBe(HuntressTriggerState.Failing);
  });

  test("a refusal older than the last request let in was put right since", () => {
    expect(
      getHuntressTriggerState({
        isWebhookSigningSecretSet: true,
        lastWebhookRequestAt: new Date(NOW),
        lastWebhookError: "The request body is not valid JSON.",
        lastWebhookErrorAt: new Date(NOW - HOUR),
      }),
    ).toBe(HuntressTriggerState.Receiving);
  });

  test("dates as the API sends them, strings, read the same; an unreadable one is none", () => {
    expect(
      getHuntressTriggerState({
        isWebhookSigningSecretSet: true,
        lastWebhookRequestAt: new Date(NOW).toISOString(),
      }),
    ).toBe(HuntressTriggerState.Receiving);
    expect(
      getHuntressTriggerState({
        isWebhookSigningSecretSet: true,
        lastWebhookRequestAt: "not a date",
      }),
    ).toBe(HuntressTriggerState.Waiting);
  });

  test("the panel reads the workflow again until Huntress arrives, every few seconds, for a while", () => {
    expect(isWaitingForHuntress(HuntressTriggerState.NeedsSigningSecret)).toBe(
      true,
    );
    expect(isWaitingForHuntress(HuntressTriggerState.Waiting)).toBe(true);
    expect(isWaitingForHuntress(HuntressTriggerState.Failing)).toBe(true);
    expect(isWaitingForHuntress(HuntressTriggerState.Receiving)).toBe(false);
    expect(HUNTRESS_TRIGGER_POLL_INTERVAL_MS).toBe(5000);
    expect(HUNTRESS_TRIGGER_POLL_FOR_MS).toBe(10 * 60 * 1000);
  });
});

/*
 * The panel's three steps: which are done, and which one to do next. The
 * next one is drawn filled in, so there is one obvious place to start.
 */
describe("which setup step is done, and which one is next", () => {
  const { Done, Current, Upcoming } = HuntressSetupStepStatus;

  function statuses(facts: HuntressTriggerFacts): Array<string> {
    const byStep: Record<HuntressSetupStep, HuntressSetupStepStatus> =
      getHuntressSetupStepStatuses(facts);

    return HUNTRESS_SETUP_STEPS.map((step: HuntressSetupStep): string => {
      return byStep[step];
    });
  }

  test("in Huntress's order: the endpoint, its signing secret, a test", () => {
    expect(HUNTRESS_SETUP_STEPS).toEqual([
      HuntressSetupStep.Endpoint,
      HuntressSetupStep.Secret,
      HuntressSetupStep.Test,
    ]);
  });

  test("nothing done: the endpoint is next, the rest after it", () => {
    expect(statuses({})).toEqual([Current, Upcoming, Upcoming]);
    expect(statuses({ isWebhookSigningSecretSet: false })).toEqual([
      Current,
      Upcoming,
      Upcoming,
    ]);
  });

  test("a request refused for want of a secret: Huntress reached the URL, so the secret is next", () => {
    expect(
      statuses({
        isWebhookSigningSecretSet: false,
        lastWebhookError: "No signing secret is saved.",
        lastWebhookErrorAt: new Date(NOW),
      }),
    ).toEqual([Done, Current, Upcoming]);
  });

  /*
   * Saving the secret clears the refusal it fixed (WorkflowService), which
   * took away the only sign Huntress had reached the URL: the endpoint's
   * step went back to undone the moment its secret was saved. Huntress
   * issues a secret only for an endpoint it has, so the secret is that sign.
   */
  test("a saved secret means the endpoint exists: both are done, and the test is next", () => {
    expect(statuses({ isWebhookSigningSecretSet: true })).toEqual([
      Done,
      Done,
      Current,
    ]);
  });

  test("a request let in: every step is done, none is next", () => {
    expect(
      statuses({
        isWebhookSigningSecretSet: true,
        lastWebhookRequestAt: new Date(NOW),
      }),
    ).toEqual([Done, Done, Done]);
  });

  test("a refusal after the secret, before any request let in: the test is still next", () => {
    expect(
      statuses({
        isWebhookSigningSecretSet: true,
        lastWebhookError: "A request arrived while this workflow is off.",
        lastWebhookErrorAt: new Date(NOW),
      }),
    ).toEqual([Done, Done, Current]);
  });

  test("an unreadable date is no request let in", () => {
    expect(
      statuses({
        isWebhookSigningSecretSet: true,
        lastWebhookRequestAt: "not a date",
      }),
    ).toEqual([Done, Done, Current]);
  });

  test("in every case, one next step at most, every step before it done and none after it", () => {
    const cases: Array<HuntressTriggerFacts> = [];

    for (const isWebhookSigningSecretSet of [false, true]) {
      for (const requestAt of [null, NOW - HOUR, NOW]) {
        for (const errorAt of [null, NOW - HOUR, NOW]) {
          cases.push({
            isWebhookSigningSecretSet,
            ...(requestAt === null
              ? {}
              : { lastWebhookRequestAt: new Date(requestAt) }),
            ...(errorAt === null
              ? {}
              : {
                  lastWebhookError: "Refused.",
                  lastWebhookErrorAt: new Date(errorAt),
                }),
          });
        }
      }
    }

    expect(cases).toHaveLength(18);

    for (const facts of cases) {
      const drawn: Array<string> = statuses(facts);
      const current: Array<number> = drawn
        .map((status: string, index: number): number => {
          return status === Current ? index : -1;
        })
        .filter((index: number): boolean => {
          return index >= 0;
        });

      expect(current.length).toBeLessThanOrEqual(1);

      if (current.length === 1) {
        expect(drawn.slice(0, current[0])).not.toContain(Upcoming);
        expect(drawn.slice(current[0]! + 1)).not.toContain(Current);
      } else {
        expect(drawn).not.toContain(Upcoming);
      }
    }
  });
});

describe("a pasted signing secret, looked at before it is sent", () => {
  test("one Huntress issues passes, as the server would take it", () => {
    const random: SeededRandom = seededRandom(1510);

    for (const secret of [
      drawHuntressSigningSecret(random),
      `  ${drawHuntressSigningSecret(random, 32)}  `,
    ]) {
      expect(getHuntressSigningSecretProblem(secret)).toBeNull();
      expect(StandardWebhookSignature.isValidSecret(secret.trim())).toBe(true);
    }
  });

  test("nothing yet is no problem: the field says it is required", () => {
    expect(getHuntressSigningSecretProblem("")).toBeNull();
    expect(getHuntressSigningSecretProblem(undefined)).toBeNull();
    expect(getHuntressSigningSecretProblem("   ")).toBeNull();
  });

  test.each([
    ["the URL pasted back", "https://oneuptime.com/workflow/huntress/abc"],
    ["a secret cut short", "whsec_abc"],
    ["two words", "whsec_abcdefghijklmnop qrstuvwxyz"],
    ["an enormous paste", `whsec_${"A".repeat(5000)}`],
  ])("%s says what to copy instead", (_name: string, secret: string) => {
    expect(getHuntressSigningSecretProblem(secret)).toBe(
      HUNTRESS_SIGNING_SECRET_PROBLEM,
    );
  });
});

describe("every sentence the panel says, in every dashboard language", () => {
  const strings: Array<string> = Array.from(
    new Set([
      ...Object.values(HuntressTriggerPanelCopy),
      ...Object.values(HUNTRESS_TRIGGER_STATE_LABELS),
      HUNTRESS_SIGNING_SECRET_PROBLEM,
    ]),
  );

  test("the scan found them, so the check below is not vacuous", () => {
    expect(strings.length).toBeGreaterThan(20);
    expect(strings).toContain("Add a webhook endpoint in Huntress");
    expect(strings).toContain("Receiving reports");
  });

  test.each(LOCALES)("%s has every one, worded", (locale: string) => {
    const words: Record<string, string> = readLocale(locale);

    const missing: Array<string> = strings.filter((text: string): boolean => {
      const value: unknown = words[text];
      return typeof value !== "string" || !value.trim();
    });

    expect({ locale, missing }).toEqual({ locale, missing: [] });
  });

  /*
   * The turn-on step names the Enabled switch through a slot, drawn in bold
   * with the switch's own label: a translation that lost the slot would fall
   * back to English, and one that wrote the label out would not be bold.
   */
  test.each(LOCALES)(
    "%s keeps the switch's slot in the turn-on step, once",
    (locale: string) => {
      const sentence: string =
        readLocale(locale)[HuntressTriggerPanelCopy.stepTurnOnBody] || "";

      expect({
        locale,
        slots: sentence.split("{{switch}}").length - 1,
        others: sentence.replace("{{switch}}", "").includes("{{"),
      }).toEqual({ locale, slots: 1, others: false });
    },
  );

  test("the turn-on step's slot is filled with the Enabled switch's label, which every language words", () => {
    expect(WORKFLOW_ENABLED_SWITCH_LABEL).toBe("Enabled");

    for (const locale of LOCALES) {
      expect({
        locale,
        worded: Boolean(readLocale(locale)[WORKFLOW_ENABLED_SWITCH_LABEL]),
      }).toEqual({ locale, worded: true });
    }
  });

  // English reads these the same, so every other language must word them.
  test.each(
    LOCALES.filter((locale: string): boolean => {
      return locale !== "en";
    }),
  )(
    "%s words the turn-on step and the read error in its own language",
    (locale: string) => {
      const words: Record<string, string> = readLocale(locale);

      for (const text of [
        HuntressTriggerPanelCopy.stepTurnOnTitle,
        HuntressTriggerPanelCopy.stepTurnOnBody,
        HuntressTriggerPanelCopy.loadError,
      ]) {
        expect({ locale, text, translated: words[text] !== text }).toEqual({
          locale,
          text,
          translated: true,
        });
      }
    },
  );
});

import {
  HUNTRESS_SIGNING_SECRET_PROBLEM,
  HUNTRESS_TRIGGER_POLL_FOR_MS,
  HUNTRESS_TRIGGER_POLL_INTERVAL_MS,
  HUNTRESS_TRIGGER_STATE_LABELS,
  HuntressTriggerPanelCopy,
  HuntressTriggerState,
  getHuntressSigningSecretProblem,
  getHuntressTriggerState,
  isWaitingForHuntress,
} from "../../../../UI/Components/Workflow/HuntressTriggerState";
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
});

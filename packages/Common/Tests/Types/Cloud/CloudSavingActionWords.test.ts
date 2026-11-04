import {
  AWS_SAVING_ACTIONS,
  describeAwsSavingAction,
} from "../../../Server/Utils/CloudConnection/Aws/AwsCosts";
import { describeGcpSavingAction } from "../../../Server/Utils/CloudConnection/Gcp/GcpCosts";
import {
  CLOUD_SAVING_ACTION_WORDS,
  CLOUD_SAVING_KIND_LABELS,
  CloudSavingKind,
  getCloudSavingActionText,
} from "../../../Types/Cloud/CloudCost";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A WAY TO SPEND LESS ASKS, IN THE READER'S LANGUAGE (#5646's review).
 *
 * A recommendation's action is stored in English: OneUptime's words for
 * AWS Cost Optimization Hub's action types ("Rightsize", "Purchase Savings
 * Plans") and Google Cloud's recommendation subtypes ("Stop VM"), or Azure
 * Advisor's own sentence. A German or Persian reader read "Rightsize" and
 * "Purchase Savings Plans" on the Overview, Savings and an account's Costs.
 * OneUptime's words are drawn in the reader's language now, old rows too;
 * a recommender's own sentence is drawn as it wrote it.
 */

// Google Cloud's subtypes, of the recommenders a connection reads (GCP_COST_RECOMMENDERS).
const GCP_SUBTYPES: ReadonlyArray<string> = [
  "CHANGE_MACHINE_TYPE",
  "STOP_VM",
  "SNAPSHOT_AND_DELETE_DISK",
  "DELETE_DISK",
  "DELETE_ADDRESS",
  "DELETE_IMAGE",
];

function textIn(
  language: string,
  action: string | undefined,
  kind: CloudSavingKind = CloudSavingKind.Rightsize,
): string {
  const translator: Translator = dashboardTranslator(language);

  return getCloudSavingActionText({
    action,
    kind,
    translateText: translator.translateText,
  });
}

describe("the words OneUptime gives a recommendation's action", () => {
  test("every action AWS Cost Optimization Hub can ask is one of them", () => {
    const words: Set<string> = new Set<string>(CLOUD_SAVING_ACTION_WORDS);

    expect(Object.keys(AWS_SAVING_ACTIONS).length).toBeGreaterThanOrEqual(8);
    for (const actionType of Object.keys(AWS_SAVING_ACTIONS)) {
      expect({
        actionType,
        worded: words.has(describeAwsSavingAction(actionType)),
      }).toEqual({ actionType, worded: true });
    }
  });

  test("every subtype of the Google Cloud recommenders read is one of them", () => {
    const words: Set<string> = new Set<string>(CLOUD_SAVING_ACTION_WORDS);

    for (const subtype of GCP_SUBTYPES) {
      expect({
        subtype,
        worded: words.has(describeGcpSavingAction(subtype)),
      }).toEqual({ subtype, worded: true });
    }
  });

  test("so is the action a recommender left unsaid", () => {
    expect(CLOUD_SAVING_ACTION_WORDS).toContain("Review");
  });

  test.each(DASHBOARD_LANGUAGES)("each reads in %s", (language: string) => {
    const unworded: Array<string> = CLOUD_SAVING_ACTION_WORDS.filter(
      (word: string): boolean => {
        return !isWordedInDashboardLocale(word, language);
      },
    );

    expect(unworded).toEqual([]);
  });
});

describe("getCloudSavingActionText", () => {
  test("OneUptime's words in the reader's language", () => {
    expect(textIn("de", "Rightsize")).toBe("Größe anpassen");
    expect(textIn("de", "Purchase Savings Plans")).toBe("Savings Plans kaufen");
    expect(textIn("fa", "Purchase Savings Plans")).toBe("خرید Savings Plans");
    expect(textIn("ja", "Stop VM")).toBe("VM を停止");
    expect(textIn("fr", "Snapshot and delete disk")).toBe(
      "Créer un instantané et supprimer le disque",
    );
  });

  test("in English, as stored", () => {
    expect(textIn("en", "Purchase Savings Plans")).toBe(
      "Purchase Savings Plans",
    );
    expect(textIn("en", "Rightsize")).toBe("Rightsize");
  });

  test("a recommender's own sentence as it wrote it, even one the Dashboard has words for", () => {
    const azure: string =
      "Right-size or shutdown underutilized virtual machines";

    expect(textIn("de", azure)).toBe(azure);
    expect(textIn("fa", azure)).toBe(azure);
    // A kind's label is a Dashboard key, but no action OneUptime words.
    expect(textIn("de", "Stop or delete")).toBe("Stop or delete");
    // Surrounding space is not a sentence of its own.
    expect(textIn("de", "  Rightsize  ")).toBe("Größe anpassen");
  });

  test("no action at all: what kind of saving it is, in the reader's language", () => {
    expect(textIn("en", undefined, CloudSavingKind.Idle)).toBe(
      CLOUD_SAVING_KIND_LABELS[CloudSavingKind.Idle],
    );
    expect(textIn("de", "", CloudSavingKind.Rightsize)).toBe("Größe anpassen");
    expect(
      getCloudSavingActionText({
        action: null,
        kind: null,
        translateText: (): undefined => {
          return undefined;
        },
      }),
    ).toBe(CLOUD_SAVING_KIND_LABELS[CloudSavingKind.Other]);
  });
});

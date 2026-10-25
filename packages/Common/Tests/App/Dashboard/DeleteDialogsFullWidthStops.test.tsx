import "@testing-library/jest-dom";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import { describeEscalationRuleDeletion } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRules";

/*
 * The Dashboard's own Delete dialogs that say more than the shared question:
 * an escalation level's (who it notifies, that it cannot be undone) and the
 * status and state timelines'. In Japanese and Chinese, sentences run on
 * with no space after a full-width stop; these dialogs put one there.
 */

const DASHBOARD: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const readLocale: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(DASHBOARD, "Locales", `${language}.json`), "utf8"),
  ) as Record<string, string>;
};

const NOTIFIES_NO_ONE: string = '"{{name}}" currently notifies no one.';
const ONLY_LEVEL: string =
  "This is the only escalation level on this policy. Deleting it leaves the policy with nobody to notify, so an incident routed here would page no one.";
const CANNOT_BE_UNDONE: string = "This action cannot be undone.";

beforeAll(async () => {
  const ja: Record<string, string> = readLocale("ja");

  await i18next.init({
    lng: "ja",
    fallbackLng: false,
    resources: {
      ja: {
        translation: {
          [NOTIFIES_NO_ONE]: ja[NOTIFIES_NO_ONE]!,
          [ONLY_LEVEL]: ja[ONLY_LEVEL]!,
          [CANNOT_BE_UNDONE]: ja[CANNOT_BE_UNDONE]!,
        },
      },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("deleting an escalation level, in Japanese", () => {
  test("its sentences run on with no space after each full stop", async () => {
    await i18next.changeLanguage("ja");

    const sentence: string = describeEscalationRuleDeletion("Weekend Cover", {
      userCount: 0,
      teamCount: 0,
      scheduleCount: 0,
      usersNamedNowhereElse: [],
      isLastRule: true,
    });

    expect(sentence).toBe(
      "「Weekend Cover」は現在誰にも通知しません。これはこのポリシーで唯一のエスカレーションレベルです。削除するとポリシーに通知先がいなくなるため、ここにルーティングされたインシデントは誰も呼び出しません。この操作は元に戻せません。",
    );
    expect(sentence).not.toContain("。 ");
  });

  test("in English they keep their spaces", async () => {
    await i18next.changeLanguage("en");

    expect(
      describeEscalationRuleDeletion("Weekend Cover", {
        userCount: 0,
        teamCount: 0,
        scheduleCount: 0,
        usersNamedNowhereElse: [],
        isLastRule: false,
      }),
    ).toBe(
      '"Weekend Cover" currently notifies no one. This action cannot be undone.',
    );
  });
});

describe("the status and state timelines' Delete questions", () => {
  test.each([
    ["the monitor's status timeline", "Pages/Monitor/View/StatusTimeline.tsx"],
    [
      "the incident, alert, maintenance and episode state timelines",
      "Components/StateTimeline/StateTimelineRowDelete.tsx",
    ],
  ])(
    "%s say the question and that it cannot be undone with IrreversibleQuestion",
    (_what: string, file: string) => {
      const source: string = fs.readFileSync(path.join(DASHBOARD, file), "utf8");

      expect(source).toContain(
        'import IrreversibleQuestion from "Common/UI/Components/DeleteConfirmation/IrreversibleQuestion";',
      );
      expect(source).toContain("<IrreversibleQuestion");
      // No sentence glued on with a hard space after the question.
      expect(source).not.toContain('/>{" "}');
    },
  );
});

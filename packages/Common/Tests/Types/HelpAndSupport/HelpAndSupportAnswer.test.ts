import {
  HelpAndSupportProblems,
  HelpChoice,
  HelpItem,
  getDefaultHelpAndSupportSettings,
  HelpAndSupportSettings,
} from "../../../Types/HelpAndSupport/HelpAndSupport";
import {
  HelpAndSupportAnswer,
  parseHelpAndSupportAnswer,
  toHelpAndSupportAnswerJSON,
} from "../../../Types/HelpAndSupport/HelpAndSupportAnswer";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT ADMIN DASHBOARD > SETTINGS > HELP AND SUPPORT IS TOLD (#10864-#10866):
 * the settings, and what the page needs to say truly what each default does.
 * The page reads the settings by the rules the server keeps them by.
 */

const answer: (
  extra?: Partial<HelpAndSupportAnswer>,
) => HelpAndSupportAnswer = (
  extra?: Partial<HelpAndSupportAnswer>,
): HelpAndSupportAnswer => {
  return {
    settings: getDefaultHelpAndSupportSettings(),
    isOneUptimeCloud: false,
    adminNotificationEmail: null,
    canSendEmail: true,
    isProductRenamed: false,
    seededItems: [],
    seedProblems: [],
    ...(extra || {}),
  };
};

/*
 * What came from the server's configuration (#10938): the places seeded and
 * not changed since, and the values it sets that were refused, carried to
 * the page and read back by the same rules.
 */
describe("what came from the server's configuration", () => {
  const base: HelpAndSupportAnswer = answer({
    seededItems: [HelpItem.SupportEmail, HelpItem.GitHub],
    seedProblems: [
      {
        item: HelpItem.Chat,
        variable: "HELP_AND_SUPPORT_CHAT",
        problem: HelpAndSupportProblems.linkScheme,
      },
    ],
  });

  test("goes to the page and is read back as it was", () => {
    const read: HelpAndSupportAnswer | null = parseHelpAndSupportAnswer(
      JSON.parse(JSON.stringify(toHelpAndSupportAnswerJSON(base))),
    );

    expect(read?.seededItems).toEqual([HelpItem.SupportEmail, HelpItem.GitHub]);
    expect(read?.seedProblems).toEqual(base.seedProblems);
  });

  test("an answer from before it reads as nothing seeded and nothing refused", () => {
    const json: JSONObject = toHelpAndSupportAnswerJSON(base);

    delete json["seededItems"];
    delete json["seedProblems"];

    const read: HelpAndSupportAnswer | null = parseHelpAndSupportAnswer(json);

    expect(read?.seededItems).toEqual([]);
    expect(read?.seedProblems).toEqual([]);
  });

  test("reads only known places, each once, in the page's order", () => {
    const read: HelpAndSupportAnswer | null = parseHelpAndSupportAnswer({
      ...toHelpAndSupportAnswerJSON(base),
      seededItems: ["gitHub", "notAPlace", "supportEmail", "gitHub", 7],
    });

    expect(read?.seededItems).toEqual([HelpItem.SupportEmail, HelpItem.GitHub]);
  });

  test("names a refused value by its place's own variable, never one the answer made up", () => {
    const read: HelpAndSupportAnswer | null = parseHelpAndSupportAnswer({
      ...toHelpAndSupportAnswerJSON(base),
      seedProblems: [
        {
          item: "chat",
          variable: "<script>",
          problem: HelpAndSupportProblems.linkScheme,
        },
        { item: "notAPlace", variable: "X", problem: "?" },
        { item: "helpLink", problem: "" },
        "not an entry",
      ],
    });

    expect(read?.seedProblems).toEqual([
      {
        item: HelpItem.Chat,
        variable: "HELP_AND_SUPPORT_CHAT",
        problem: HelpAndSupportProblems.linkScheme,
      },
    ]);
  });
});

describe("the answer", () => {
  test("round-trips, the settings sent as kept", () => {
    const settings: HelpAndSupportSettings = getDefaultHelpAndSupportSettings();
    settings[HelpItem.Chat] = {
      choice: HelpChoice.Link,
      value: "https://chat.example.com",
    };
    settings[HelpItem.GitHub] = { choice: HelpChoice.Hidden, value: null };

    const sent: HelpAndSupportAnswer = answer({
      settings: settings,
      adminNotificationEmail: "admins@example.com",
      canSendEmail: false,
      isProductRenamed: true,
    });
    const json: JSONObject = toHelpAndSupportAnswerJSON(sent);

    expect(json["settings"]).toEqual({
      chat: { choice: "link", value: "https://chat.example.com" },
      gitHub: { choice: "hidden" },
    });
    expect(parseHelpAndSupportAnswer(JSON.parse(JSON.stringify(json)))).toEqual(
      sent,
    );
  });

  test("is not one without the facts the page needs", () => {
    for (const value of [
      null,
      undefined,
      "answer",
      [],
      {},
      { isOneUptimeCloud: false },
      { canSendEmail: true },
      { isOneUptimeCloud: "no", canSendEmail: true },
    ]) {
      expect(parseHelpAndSupportAnswer(value)).toBeNull();
    }
  });

  test("an unsafe stored value is read as its default by the page too", () => {
    const parsed: HelpAndSupportAnswer | null = parseHelpAndSupportAnswer({
      settings: {
        helpLink: { choice: "link", value: "javascript:alert(1)" },
        inviteMessage: { choice: "text", value: "<script>x</script>" },
      },
      isOneUptimeCloud: false,
      canSendEmail: true,
      adminNotificationEmail: "  ",
    });

    expect(parsed?.settings).toEqual(getDefaultHelpAndSupportSettings());
    expect(parsed?.adminNotificationEmail).toBeNull();
    expect(parsed?.isProductRenamed).toBe(false);
  });
});

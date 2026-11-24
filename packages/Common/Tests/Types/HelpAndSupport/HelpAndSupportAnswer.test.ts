import {
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
    ...(extra || {}),
  };
};

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

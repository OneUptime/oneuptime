import {
  BACK_TO_SLACK,
  ConnectRequestNoticeText,
  getConnectingNotice,
  getConnectLinkGoneNotice,
  getConnectRequestNotice,
  getWorkspaceName,
} from "../../FeatureSet/Dashboard/src/Utils/Workspace/ConnectRequestMessage";
import {
  getLocalePath,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  ConnectProvider,
  ConnectRequestOutcome,
} from "Common/Types/Workspace/ConnectCallback";
import {
  createTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";

/*
 * What the Slack and Microsoft Teams settings pages say about a connection
 * started from a Connect button in the chat: while they take the browser to
 * sign in, when the sign-in comes back with what became of the press
 * (`?pressed=`), and when the button can no longer be used. Each is the
 * page's own sentence in the reader's language - never words the address
 * carries - and every one is in every locale.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const CHAT_PROVIDERS: Array<ConnectProvider> = [
  ConnectProvider.Slack,
  ConnectProvider.MicrosoftTeams,
];

describe("what became of the press", () => {
  test.each([
    [
      ConnectRequestOutcome.Answered,
      "OneUptime finished what you pressed in Slack and answered you there.",
    ],
    [
      ConnectRequestOutcome.PressAgain,
      "Go back to Slack and press the button again.",
    ],
    [
      ConnectRequestOutcome.Expired,
      "The button you pressed in Slack expired before you connected. Go back to Slack and press it again.",
    ],
    [
      ConnectRequestOutcome.NotAnswered,
      "OneUptime could not answer you in Slack. Open the record in OneUptime to see where it stands.",
    ],
  ])("%s, on the Slack page", (pressed: string, message: string) => {
    expect(
      getConnectRequestNotice({
        provider: ConnectProvider.Slack,
        pressed: pressed,
        translator: ENGLISH,
      }),
    ).toEqual({ title: "Your Slack account is connected", message: message });
  });

  test("the Microsoft Teams page names Microsoft Teams", () => {
    expect(
      getConnectRequestNotice({
        provider: ConnectProvider.MicrosoftTeams,
        pressed: ConnectRequestOutcome.Answered,
        translator: ENGLISH,
      }),
    ).toEqual({
      title: "Your Microsoft Teams account is connected",
      message:
        "OneUptime finished what you pressed in Microsoft Teams and answered you there.",
    });
  });

  test.each([
    null,
    undefined,
    "",
    "done",
    "ANSWERED",
    "<script>alert(1)</script>",
    "answered&slackChannel=C0EVIL",
  ])(
    "%p is no notice: the page shows nothing it did not write",
    (pressed: string | null | undefined) => {
      expect(
        getConnectRequestNotice({
          provider: ConnectProvider.Slack,
          pressed: pressed,
          translator: ENGLISH,
        }),
      ).toBeNull();
    },
  );
});

describe("the other notices", () => {
  test("while the page takes the browser to sign in", () => {
    expect(
      getConnectingNotice({
        provider: ConnectProvider.MicrosoftTeams,
        translator: ENGLISH,
      }),
    ).toEqual({
      title: "Connecting your Microsoft Teams account…",
      message: "Taking you to Microsoft Teams to confirm it's you.",
    });
  });

  test("a Connect button that can no longer be used", () => {
    expect(
      getConnectLinkGoneNotice({
        provider: ConnectProvider.Slack,
        translator: ENGLISH,
      }),
    ).toEqual({
      title: "This Connect button has expired",
      message:
        "Press the button in Slack again for a new one, or connect your account here.",
    });
  });

  test("each chat page names its own chat", () => {
    expect(getWorkspaceName(ConnectProvider.Slack)).toBe("Slack");
    expect(getWorkspaceName(ConnectProvider.MicrosoftTeams)).toBe(
      "Microsoft Teams",
    );
  });
});

describe("the sentences are in every locale", () => {
  // Every sentence the notices can show, as its translation key.
  function everyKey(): Array<string> {
    const keys: Set<string> = new Set<string>([BACK_TO_SLACK]);
    const recording: Translator = {
      ...ENGLISH,
      translateTemplate: (template: string): string => {
        keys.add(template);
        return template;
      },
    };

    for (const provider of CHAT_PROVIDERS) {
      for (const pressed of Object.values(ConnectRequestOutcome)) {
        const notice: ConnectRequestNoticeText | null = getConnectRequestNotice(
          {
            provider: provider,
            pressed: pressed,
            translator: recording,
          },
        );

        expect(notice).not.toBeNull();
      }

      getConnectingNotice({ provider: provider, translator: recording });
      getConnectLinkGoneNotice({ provider: provider, translator: recording });
    }

    return Array.from(keys);
  }

  const keys: Array<string> = everyKey();

  test("every outcome has a sentence, and the notices their titles", () => {
    // 4 outcomes, 3 titles, 2 messages, and "Back to Slack".
    expect(keys).toHaveLength(Object.values(ConnectRequestOutcome).length + 6);
  });

  test("en.json has every one", () => {
    const english: Record<string, unknown> = JSON.parse(
      fs.readFileSync(getLocalePath("en"), "utf8"),
    );

    for (const key of keys) {
      expect([key, english[key]]).toEqual([key, key]);
    }
  });

  test.each(TRANSLATED_LOCALES)(
    "%s has its own wording of every one, keeping its {{workspace}}",
    (code: string) => {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(getLocalePath(code), "utf8"),
      );

      for (const key of keys) {
        const value: unknown = locale[key];

        expect([key, typeof value]).toEqual([key, "string"]);
        expect([key, value === key]).toEqual([key, false]);
        expect([key, (value as string).includes("{{workspace}}")]).toEqual([
          key,
          key.includes("{{workspace}}"),
        ]);
      }
    },
  );
});

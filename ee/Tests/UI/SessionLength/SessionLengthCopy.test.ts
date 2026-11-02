import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  DEFAULT_CHOICE_VALUE,
  fromChoiceValue,
  getChoiceText,
  getDurationLabel,
  getIdleChoices,
  getIdleDescription,
  getLengthChoices,
  getLengthDescription,
  getSeparateDescription,
  getSessionLengthRowTestId,
  getSsoFoldedItem,
  SessionLengthChoice,
  SessionLengthCopy,
  toIdleChoiceValue,
  toLengthChoiceValue,
} from "../../../AdminDashboard/SessionLength/SessionLengthCopy";
import {
  previewSessionLengthSettings,
  toPreviewBody,
} from "../../../AdminDashboard/SessionLength/SessionLengthSettingsAPI";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES,
  SessionLengthSettings,
} from "Common/Types/UserSession/SessionLength";
import { FOLDED_SECTION_ON } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import API from "Common/UI/Utils/API/API";
import {
  createTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The Session Length page's words and values, kept apart from React
 * (AdminDashboard/SessionLength/SessionLengthCopy and SessionLengthSettingsAPI):
 * how a length reads, what each dropdown offers and writes, and what the
 * preview is asked and how its answer is read. The page itself is driven in
 * SessionLengthSettingsPage.test.tsx.
 */

const SETTINGS: SessionLengthSettings = {
  sessionLengthInMinutes: 480,
  sessionIdleTimeoutInMinutes: null,
  useSeparateSsoSessionLengths: true,
  ssoSessionLengthInMinutes: 60,
  ssoSessionIdleTimeoutInMinutes: 15,
};

const values: (choices: Array<SessionLengthChoice>) => Array<number> = (
  choices: Array<SessionLengthChoice>,
): Array<number> => {
  return choices.map((choice: SessionLengthChoice): number => {
    return choice.value;
  });
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("how a length reads", () => {
  test.each([
    [15, "{{count}} minutes", { count: "15" }],
    [45, "{{count}} minutes", { count: "45" }],
    [60, "1 hour", undefined],
    [8 * 60, "{{count}} hours", { count: "8" }],
    [24 * 60, "1 day", undefined],
    [36 * 60, "{{count}} hours", { count: "36" }],
    [30 * 24 * 60, "{{count}} days", { count: "30" }],
  ])(
    "%p minutes: %p",
    (
      minutes: number,
      label: string,
      labelValues: Record<string, string> | undefined,
    ) => {
      expect(getDurationLabel(minutes)).toEqual(
        labelValues ? { label, labelValues } : { label },
      );
    },
  );
});

describe("a length's words in the reader's language", () => {
  // The Admin Dashboard's Persian words for the lengths, as its locale has them.
  const PERSIAN: Record<string, string> = {
    "1 hour": "۱ ساعت",
    "{{count}} hours": "{{count}} ساعت",
    "{{count}} days": "{{count}} روز",
  };

  const persian: Translator = createTranslator((text: string) => {
    return PERSIAN[text];
  }, "fa");

  test("writes its number as the language writes numbers, as the words with no number already do", () => {
    expect(getChoiceText(getDurationLabel(12 * 60), persian)).toBe("۱۲ ساعت");
    expect(getChoiceText(getDurationLabel(30 * 24 * 60), persian)).toBe(
      "۳۰ روز",
    );
    expect(getChoiceText(getDurationLabel(60), persian)).toBe("۱ ساعت");
  });

  test("in English, as written", () => {
    const english: Translator = createTranslator(undefined, "en");

    expect(getChoiceText(getDurationLabel(12 * 60), english)).toBe("12 hours");
    expect(getChoiceText(getDurationLabel(60), english)).toBe("1 hour");
    expect(getChoiceText({ label: "No limit" }, english)).toBe("No limit");
  });
});

describe("what the dropdowns offer and write", () => {
  test("a session length: No limit first, then from an hour to 90 days", () => {
    expect(values(getLengthChoices(null))).toEqual([
      DEFAULT_CHOICE_VALUE,
      60,
      240,
      480,
      720,
      1440,
      4320,
      10080,
      20160,
      43200,
      129600,
    ]);
  });

  test("an idle timeout: from 15 minutes to 14 days, then the default's 30 days, last", () => {
    const choices: Array<SessionLengthChoice> = getIdleChoices(null);

    expect(values(choices)).toEqual([
      15,
      30,
      60,
      120,
      240,
      480,
      720,
      1440,
      4320,
      10080,
      20160,
      DEFAULT_CHOICE_VALUE,
    ]);
    expect(choices[choices.length - 1]).toEqual({
      value: DEFAULT_CHOICE_VALUE,
      label: "{{count}} days",
      labelValues: { count: "30" },
    });
  });

  test("a value set through the API is offered too, in its place, once", () => {
    expect(values(getLengthChoices(90)).slice(0, 4)).toEqual([
      DEFAULT_CHOICE_VALUE,
      60,
      90,
      240,
    ]);
    expect(
      values(getLengthChoices(480)).filter((value: number): boolean => {
        return value === 480;
      }),
    ).toHaveLength(1);
    expect(values(getIdleChoices(45))).toContain(45);
  });

  test("30 days of idle timeout, written out or not, is the default: never offered twice", () => {
    expect(toIdleChoiceValue(null)).toBe(DEFAULT_CHOICE_VALUE);
    expect(toIdleChoiceValue(DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES)).toBe(
      DEFAULT_CHOICE_VALUE,
    );
    expect(toIdleChoiceValue(60)).toBe(60);
    expect(
      values(getIdleChoices(DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES)),
    ).toEqual(values(getIdleChoices(null)));
  });

  test("a pick of the default writes nothing; any other its minutes", () => {
    expect(fromChoiceValue(DEFAULT_CHOICE_VALUE)).toBeNull();
    expect(fromChoiceValue(480)).toBe(480);
    expect(toLengthChoiceValue(null)).toBe(DEFAULT_CHOICE_VALUE);
    expect(toLengthChoiceValue(480)).toBe(480);
  });
});

describe("what the page says of each", () => {
  test("a session length, set or not", () => {
    expect(getLengthDescription(null)).toBe(
      SessionLengthCopy.lengthNoLimitDescription,
    );
    expect(getLengthDescription(60)).toBe(
      SessionLengthCopy.lengthSetDescription,
    );
  });

  test("an idle timeout, set or the default", () => {
    expect(getIdleDescription(null)).toBe(
      SessionLengthCopy.idleDefaultDescription,
    );
    expect(getIdleDescription(DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES)).toBe(
      SessionLengthCopy.idleDefaultDescription,
    );
    expect(getIdleDescription(15)).toBe(SessionLengthCopy.idleSetDescription);
  });

  test("the SSO switch, and More settings' header", () => {
    expect(getSeparateDescription(false)).toBe(
      SessionLengthCopy.separateOffDescription,
    );
    expect(getSeparateDescription(true)).toBe(
      SessionLengthCopy.separateOnDescription,
    );
    expect(getSsoFoldedItem(false)).toEqual(
      expect.objectContaining({
        title: SessionLengthCopy.ssoCardTitle,
        isSet: false,
      }),
    );
    expect(getSsoFoldedItem(true)).toEqual(
      expect.objectContaining({
        title: SessionLengthCopy.ssoCardTitle,
        isSet: true,
        value: FOLDED_SECTION_ON,
      }),
    );
  });

  test("each row's test id names its column", () => {
    expect(getSessionLengthRowTestId("sessionLengthInMinutes")).toBe(
      "session-length-row-sessionLengthInMinutes",
    );
  });

  test("never names a brand, and never ties SSO to the license", () => {
    for (const text of Object.values(SessionLengthCopy)) {
      expect(text).not.toMatch(/Okta|Azure|Google|Enterprise|license/i);
    }
  });
});

describe("the preview", () => {
  test("is asked with every column of the setting the change would leave", () => {
    expect(toPreviewBody(SETTINGS)).toEqual({
      sessionLengthInMinutes: 480,
      sessionIdleTimeoutInMinutes: null,
      useSeparateSsoSessionLengths: true,
      ssoSessionLengthInMinutes: 60,
      ssoSessionIdleTimeoutInMinutes: 15,
    });
  });

  test.each([
    [
      { peopleSignedOut: 3, includesYou: true },
      { peopleSignedOut: 3, includesYou: true },
    ],
    [
      { peopleSignedOut: 0, includesYou: false },
      { peopleSignedOut: 0, includesYou: false },
    ],
    [
      { peopleSignedOut: -2, includesYou: "yes" },
      { peopleSignedOut: 0, includesYou: false },
    ],
    [{ peopleSignedOut: 2.5 }, { peopleSignedOut: 0, includesYou: false }],
    [{}, { peopleSignedOut: 0, includesYou: false }],
  ])(
    "an answer of %p is read as %p",
    async (answer: JSONObject, read: JSONObject) => {
      jest
        .spyOn(API, "post")
        .mockResolvedValue(
          new HTTPResponse<JSONObject>(200, answer, {}) as never,
        );

      await expect(previewSessionLengthSettings(SETTINGS)).resolves.toEqual(
        read,
      );
    },
  );

  test("a server that cannot say throws, so the page asks in general words", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPErrorResponse(
          500,
          { message: "Something went wrong" },
          {},
        ) as never,
      );

    await expect(previewSessionLengthSettings(SETTINGS)).rejects.toThrow();
  });
});

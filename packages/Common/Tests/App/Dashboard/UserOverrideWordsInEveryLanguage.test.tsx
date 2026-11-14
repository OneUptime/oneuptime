/** @timezone UTC */
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * EDITING AN OVERRIDE, AND ITS OVERLAPS, IN THE READER'S LANGUAGE (issues
 * #7630 and #7631).
 *
 * Every word the Edit dialog, the overlap check and the "Overlaps" mark
 * say is a key of the Dashboard's English and is worded in every language
 * the Dashboard offers, with the same {{placeholders}}. Filled in, each
 * sentence keeps no placeholder and no English. And on the real
 * components, in German and Arabic: the conflict said under Ends with
 * "Edit that override", the note on a global override under a policy's
 * own, and the mark - its word on the row, the whole of what it says read
 * out. In Japanese the mark's two sentences run together with no space
 * after the first one's full stop, as Japanese writes them.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import UserOverrideOverlapNotice, {
  USER_OVERRIDE_EDIT_THAT_OVERRIDE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideOverlapNotice";
import UserOverrideOverlapsMark, {
  getUserOverrideOverlapsText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideOverlapsMark";
import {
  USER_OVERRIDE_AWAY_LOCKED_TEXT,
  USER_OVERRIDE_END_NOW_TEXT,
  USER_OVERRIDE_START_LOCKED_TEXT,
  USER_OVERRIDE_START_MOVABLE_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideForm";
import { formatHandOffInstant } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerSummary";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import User from "../../../Models/DatabaseModels/User";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { GLOBAL_USER_OVERRIDE_EDIT_REFUSAL } from "../../../Types/OnCallDutyPolicy/GlobalUserOverrideAccess";
import {
  USER_OVERRIDE_END_IN_PAST_REFUSAL,
  USER_OVERRIDE_ENDED_REFUSAL,
  USER_OVERRIDE_START_IN_PAST_REFUSAL,
  USER_OVERRIDE_STARTED_REFUSAL,
} from "../../../Types/OnCallDutyPolicy/UserOverrideEdit";
import UserOverrideOverlap, {
  USER_OVERRIDE_CONFLICT_COVERED_GLOBALLY,
  USER_OVERRIDE_CONFLICT_COVERED_ON_POLICY,
  USER_OVERRIDE_CONFLICT_SKIPPED_GLOBALLY,
  USER_OVERRIDE_CONFLICT_SKIPPED_ON_POLICY,
  USER_OVERRIDE_CONFLICT_WHAT_TO_DO,
  USER_OVERRIDE_NOTE_GLOBAL_UNDER_POLICY,
  USER_OVERRIDE_NOTE_POLICY_OVER_GLOBAL,
  USER_OVERRIDE_NOTE_UNNAMED_POLICY_OVER_GLOBAL,
  USER_OVERRIDE_OVERLAPS_COVERED,
  USER_OVERRIDE_OVERLAPS_LABEL,
  USER_OVERRIDE_OVERLAPS_SKIPPED,
  UserOverrideOverlapNote,
  UserOverrideSentence,
  UserOverrideTimes,
  UserOverrideUseReason,
} from "../../../Types/OnCallDutyPolicy/UserOverrideOverlap";
import { Translator } from "../../../Types/Translator";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

jest.setTimeout(30000);

const PROJECT_ID: string = "7631b000-0000-4000-8000-000000000001";
const POLICY_ID: string = "7631b000-0000-4000-8000-000000000002";
const ALEX: string = "7631b000-0000-4000-8000-0000000000a1";
const SAM: string = "7631b000-0000-4000-8000-0000000000b1";

const PEOPLE: Record<string, string> = {
  [ALEX]: "Alex Chen",
  [SAM]: "Sam Rivera",
};

const EN: Record<string, string> = readDashboardLocale("en");

const OTHER_LANGUAGES: ReadonlyArray<string> = DASHBOARD_LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const REASONS: ReadonlyArray<UserOverrideUseReason> = [
  UserOverrideUseReason.NamesCover,
  UserOverrideUseReason.StartsFirst,
  UserOverrideUseReason.AddedFirst,
];

// Two overrides of Alex on the policy, one 13:00 to 17:00, one 15:00 to 19:00.
const THIS_ONE: UserOverrideTimes = {
  id: "7631b000-0000-4000-8000-000000000101",
  overrideUserId: ALEX,
  routeAlertsToUserId: SAM,
  onCallDutyPolicyId: POLICY_ID,
  startsAt: OneUptimeDate.fromString("2026-11-20T13:00:00.000Z"),
  endsAt: OneUptimeDate.fromString("2026-11-20T17:00:00.000Z"),
};

const THAT_ONE: UserOverrideTimes = {
  ...THIS_ONE,
  id: "7631b000-0000-4000-8000-000000000102",
  startsAt: OneUptimeDate.fromString("2026-11-20T15:00:00.000Z"),
  endsAt: OneUptimeDate.fromString("2026-11-20T19:00:00.000Z"),
};

// The mark's two sentences, for each reason and for either one used.
const MARK_SENTENCES: ReadonlyArray<{
  name: string;
  sentences: Array<UserOverrideSentence>;
}> = REASONS.flatMap(
  (
    reason: UserOverrideUseReason,
  ): Array<{ name: string; sentences: Array<UserOverrideSentence> }> => {
    return [true, false].map(
      (
        isOtherUsed: boolean,
      ): { name: string; sentences: Array<UserOverrideSentence> } => {
        const note: UserOverrideOverlapNote<UserOverrideTimes> = {
          other: isOtherUsed
            ? THAT_ONE
            : { ...THAT_ONE, routeAlertsToUserId: null },
          isOtherUsed: isOtherUsed,
          reason: reason,
        };

        return {
          name: `${reason}, ${isOtherUsed ? "that one" : "this one"} used`,
          sentences: UserOverrideOverlap.getOverlapNoteSentences({
            note: note,
            awayName: "Alex Chen",
            otherCoverName: "Sam Rivera",
            from: "20 Nov 15:00",
            until: "20 Nov 19:00",
          }),
        };
      },
    );
  },
);

// Every conflict the server refuses, and the dialog says under Ends.
const CONFLICT_SENTENCES: ReadonlyArray<UserOverrideSentence> = [
  THAT_ONE,
  { ...THAT_ONE, routeAlertsToUserId: null },
  { ...THAT_ONE, onCallDutyPolicyId: null },
  { ...THAT_ONE, onCallDutyPolicyId: null, routeAlertsToUserId: null },
].map((conflict: UserOverrideTimes): UserOverrideSentence => {
  return UserOverrideOverlap.getConflictSentence({
    conflict: conflict,
    awayName: "Alex Chen",
    coverName: "Sam Rivera",
    from: "20 Nov 15:00",
    until: "20 Nov 19:00",
  });
});

// Every note on an overlap the rule allows.
const NOTE_SENTENCES: ReadonlyArray<UserOverrideSentence> = [
  { other: { ...THAT_ONE, onCallDutyPolicyId: null }, policyName: "" },
  { other: THAT_ONE, policyName: "Primary On-Call" },
  { other: THAT_ONE, policyName: "" },
].map(
  (data: {
    other: UserOverrideTimes;
    policyName: string;
  }): UserOverrideSentence => {
    return UserOverrideOverlap.getOtherScopeNote({
      other: data.other,
      awayName: "Alex Chen",
      policyName: data.policyName,
      from: "20 Nov 15:00",
      until: "20 Nov 19:00",
    });
  },
);

// Every word the Edit dialog, the overlap check and the mark say.
const NEW_WORDS: ReadonlyArray<string> = Array.from(
  new Set<string>([
    GLOBAL_USER_OVERRIDE_EDIT_REFUSAL,
    USER_OVERRIDE_ENDED_REFUSAL,
    USER_OVERRIDE_STARTED_REFUSAL,
    USER_OVERRIDE_START_IN_PAST_REFUSAL,
    USER_OVERRIDE_END_IN_PAST_REFUSAL,
    USER_OVERRIDE_AWAY_LOCKED_TEXT,
    USER_OVERRIDE_START_LOCKED_TEXT,
    USER_OVERRIDE_START_MOVABLE_TEXT,
    USER_OVERRIDE_END_NOW_TEXT,
    USER_OVERRIDE_EDIT_THAT_OVERRIDE,
    "Edit the override for {{name}}",
    USER_OVERRIDE_CONFLICT_COVERED_ON_POLICY,
    USER_OVERRIDE_CONFLICT_SKIPPED_ON_POLICY,
    USER_OVERRIDE_CONFLICT_COVERED_GLOBALLY,
    USER_OVERRIDE_CONFLICT_SKIPPED_GLOBALLY,
    USER_OVERRIDE_CONFLICT_WHAT_TO_DO,
    USER_OVERRIDE_NOTE_GLOBAL_UNDER_POLICY,
    USER_OVERRIDE_NOTE_POLICY_OVER_GLOBAL,
    USER_OVERRIDE_NOTE_UNNAMED_POLICY_OVER_GLOBAL,
    USER_OVERRIDE_OVERLAPS_LABEL,
    USER_OVERRIDE_OVERLAPS_COVERED,
    USER_OVERRIDE_OVERLAPS_SKIPPED,
    ...MARK_SENTENCES.flatMap(
      (mark: { sentences: Array<UserOverrideSentence> }): Array<string> => {
        return mark.sentences.map((sentence: UserOverrideSentence): string => {
          return sentence.template;
        });
      },
    ),
    new OnCallDutyPolicyUserOverride().tableDescription!,
    // The policy feed's filter: an override's times, or who covers, changed.
    "User Override Changed",
  ]),
);

/*
 * English a sentence must not keep once it is translated. Not "policy" or
 * "rotation": Italian and Swedish say policy, German and French rotation.
 */
const ENGLISH_WORDS: RegExp =
  /\b(already|overlaps?|overrides?|covers|covered|while|where|is used)\b/i;

const fill: (
  translator: Translator,
  sentence: UserOverrideSentence,
) => string = (
  translator: Translator,
  sentence: UserOverrideSentence,
): string => {
  return translator.translateTemplate(sentence.template, sentence.values);
};

describe("the words of editing an override and of its overlaps", () => {
  test("are the thirty keys this change adds, each a key of the Dashboard's English", () => {
    expect(NEW_WORDS).toHaveLength(30);

    for (const key of NEW_WORDS) {
      expect({ key: key, english: EN[key] }).toEqual({
        key: key,
        english: key,
      });
    }
  });

  test.each(OTHER_LANGUAGES)(
    "%s: each is worded in the language, with the same placeholders",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of NEW_WORDS) {
        expect({
          key: key,
          worded: isWordedInDashboardLocale(key, language),
          placeholders: placeholdersOf(words[key] || ""),
        }).toEqual({
          key: key,
          worded: true,
          placeholders: placeholdersOf(key),
        });
      }
    },
  );

  test.each(OTHER_LANGUAGES)(
    "%s: each conflict, note and mark, filled in, names who and when, and keeps no English",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const sentences: Array<UserOverrideSentence> = [
        ...CONFLICT_SENTENCES,
        ...NOTE_SENTENCES,
        ...MARK_SENTENCES.flatMap(
          (mark: {
            sentences: Array<UserOverrideSentence>;
          }): Array<UserOverrideSentence> => {
            return mark.sentences;
          },
        ),
      ];

      for (const sentence of sentences) {
        const text: string = fill(translator, sentence);
        const withoutValues: string = Object.values(sentence.values)
          .map((value: unknown): string => {
            return String(value);
          })
          .reduce((rest: string, value: string): string => {
            return rest.split(value).join("");
          }, text);

        expect({ template: sentence.template, text: text }).toEqual({
          template: sentence.template,
          text: expect.not.stringContaining("{{"),
        });

        for (const value of Object.values(sentence.values)) {
          expect({ template: sentence.template, text: text }).toEqual({
            template: sentence.template,
            text: expect.stringContaining(String(value)),
          });
        }

        expect({
          template: sentence.template,
          english: ENGLISH_WORDS.test(withoutValues),
        }).toEqual({ template: sentence.template, english: false });
      }
    },
  );
});

describe("on the dialog and the lists, in German, Arabic and Japanese", () => {
  const RESOURCES: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["de", "ar", "ja"]) {
    RESOURCES[language] = { translation: readDashboardLocale(language) };
  }

  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "de",
      fallbackLng: "en",
      resources: RESOURCES,
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  // What React said was drawn wrong: a div in a paragraph, and the like.
  let nestingWarnings: Array<string> = [];

  beforeEach(() => {
    getListMock.mockReset();
    nestingWarnings = [];
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(OneUptimeDate.fromString("2026-11-13T12:00:00.000Z"));
    // Every other complaint still reaches the test's output.
    // eslint-disable-next-line no-console
    const consoleError: typeof console.error = console.error;
    jest
      .spyOn(console, "error")
      .mockImplementation((...args: Array<unknown>): void => {
        const message: string = args.map(String).join(" ");

        if (message.includes("validateDOMNesting")) {
          nestingWarnings.push(message);
          return;
        }

        consoleError(...args);
      });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    // Every notice and mark is drawn as valid HTML.
    expect(nestingWarnings).toEqual([]);
  });

  afterAll(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  async function inLanguage(language: string): Promise<void> {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage(language);
    });
  }

  function person(id: string): User {
    const user: User = new User();
    user._id = id;
    user.name = new Name(PEOPLE[id]!);
    user.email = new Email("person@example.com");
    return user;
  }

  // An override as the API answers with it.
  function saved(times: UserOverrideTimes): OnCallDutyPolicyUserOverride {
    const model: OnCallDutyPolicyUserOverride =
      new OnCallDutyPolicyUserOverride();
    model._id = times.id!;
    model.projectId = new ObjectID(PROJECT_ID);
    model.overrideUserId = new ObjectID(times.overrideUserId);
    model.overrideUser = person(times.overrideUserId);

    if (times.routeAlertsToUserId) {
      model.routeAlertsToUserId = new ObjectID(times.routeAlertsToUserId);
      model.routeAlertsToUser = person(times.routeAlertsToUserId);
    }

    if (times.onCallDutyPolicyId) {
      model.onCallDutyPolicyId = new ObjectID(times.onCallDutyPolicyId);
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy._id = times.onCallDutyPolicyId;
      policy.name = "Primary On-Call";
      model.onCallDutyPolicy = policy;
    }

    model.startsAt = times.startsAt;
    model.endsAt = times.endsAt;
    model.createdAt = OneUptimeDate.fromString("2026-11-01T00:00:00.000Z");
    return model;
  }

  function answer(overrides: Array<OnCallDutyPolicyUserOverride>): void {
    getListMock.mockResolvedValue({
      data: overrides,
      count: overrides.length,
      skip: 0,
      limit: 50,
    });
  }

  /*
   * A time as the dialog writes it, in the reader's language: no zone - Starts
   * and Ends say it - and no year while it is this year.
   */
  function shown(date: Date): string {
    return formatHandOffInstant(
      date,
      undefined,
      OneUptimeDate.getCurrentDate(),
    );
  }

  // Being added: Alex away on the policy, 13:00 to 17:00, Sam covering.
  const CANDIDATE: UserOverrideTimes = { ...THIS_ONE, id: null };

  test.each(["de", "ar"])(
    "%s: a conflict under Ends is the reader's, and so is Edit that override",
    async (language: string) => {
      await inLanguage(language);
      answer([saved(THAT_ONE)]);
      const onEditOverride: MockFunction = getJestMockFunction();

      render(
        <UserOverrideOverlapNotice
          candidate={CANDIDATE}
          onEditOverride={(override: OnCallDutyPolicyUserOverride) => {
            onEditOverride(override._id?.toString());
          }}
        />,
      );

      const conflict: HTMLElement = await screen.findByTestId(
        "user-override-overlap-conflict",
        undefined,
        { timeout: 5000 },
      );
      const translator: Translator = dashboardTranslator(language);

      expect(conflict.querySelector("p")?.textContent).toBe(
        translator.translateTemplate(USER_OVERRIDE_CONFLICT_COVERED_ON_POLICY, {
          away: "Alex Chen",
          cover: "Sam Rivera",
          from: shown(THAT_ONE.startsAt),
          until: shown(THAT_ONE.endsAt),
        }),
      );
      expect(conflict.textContent).not.toMatch(/already|covered/);

      const edit: HTMLElement = screen.getByTestId(
        "user-override-overlap-edit",
      );

      expect(edit).toHaveTextContent(
        readDashboardLocale(language)[USER_OVERRIDE_EDIT_THAT_OVERRIDE]!,
      );

      fireEvent.click(edit);

      expect(onEditOverride).toHaveBeenCalledWith(THAT_ONE.id);
    },
  );

  test.each(["de", "ar"])(
    "%s: a global override under the policy's own is said, in the reader's words",
    async (language: string) => {
      await inLanguage(language);
      const global: UserOverrideTimes = {
        ...THAT_ONE,
        onCallDutyPolicyId: null,
      };
      answer([saved(global)]);

      render(<UserOverrideOverlapNotice candidate={CANDIDATE} />);

      const note: HTMLElement = await screen.findByTestId(
        "user-override-overlap-note",
        undefined,
        { timeout: 5000 },
      );

      expect(note).toHaveTextContent(
        dashboardTranslator(language).translateTemplate(
          USER_OVERRIDE_NOTE_GLOBAL_UNDER_POLICY,
          {
            away: "Alex Chen",
            from: shown(global.startsAt),
            until: shown(global.endsAt),
          },
        ),
      );
      expect(note.textContent).not.toMatch(/also has|while both/);
      expect(screen.queryByTestId("user-override-overlap-conflict")).toBeNull();
    },
  );

  test.each(["de", "ar", "ja"])(
    "%s: the Overlaps mark shows the reader's word, and reads out the whole of what it says",
    async (language: string) => {
      await inLanguage(language);
      const translator: Translator = dashboardTranslator(language);
      const words: Record<string, string> = readDashboardLocale(language);
      const note: UserOverrideOverlapNote<UserOverrideTimes> = {
        other: THAT_ONE,
        isOtherUsed: false,
        reason: UserOverrideUseReason.StartsFirst,
      };
      const text: string = getUserOverrideOverlapsText({
        translator: translator,
        note: note,
        awayName: "Alex Chen",
        otherCoverName: "Sam Rivera",
        from: "20 Nov 15:00",
        until: "20 Nov 19:00",
      });
      const sentences: Array<string> =
        UserOverrideOverlap.getOverlapNoteSentences({
          note: note,
          awayName: "Alex Chen",
          otherCoverName: "Sam Rivera",
          from: "20 Nov 15:00",
          until: "20 Nov 19:00",
        }).map((sentence: UserOverrideSentence): string => {
          return fill(translator, sentence);
        });
      const first: string = sentences[0]!;
      const second: string = sentences[1]!;

      // Japanese runs sentences together after its full stop; the others leave a space.
      expect(text).toBe(
        language === "ja" ? `${first}${second}` : `${first} ${second}`,
      );
      expect(second).toBe(
        words["Where they overlap, this one is used, as it starts first."],
      );

      render(<UserOverrideOverlapsMark text={text} />);

      const mark: HTMLElement = screen.getByTestId("user-override-overlaps");

      expect(mark).toHaveTextContent(words[USER_OVERRIDE_OVERLAPS_LABEL]!);
      expect(mark.textContent?.trim()).toBe(
        words[USER_OVERRIDE_OVERLAPS_LABEL],
      );
      expect(mark).toHaveAttribute("role", "img");
      expect(mark).toHaveAttribute("aria-label", text);
    },
  );
});

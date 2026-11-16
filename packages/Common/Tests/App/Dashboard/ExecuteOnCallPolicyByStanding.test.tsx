import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";

/*
 * EXECUTE ON-CALL POLICY, BY WHERE THE RECORD STANDS (issue #7839).
 *
 * A person who starts an on-call policy by hand on a resolved incident,
 * alert or episode is refused by the server ("This incident is resolved, so
 * no on-call policy was started."), and was told so only after filling in
 * and sending the form. On an acknowledged one, a policy started by hand
 * goes on paging, level by level, until somebody it paged answers - and the
 * form said only that it would "start the on-call process".
 *
 * Now each of the four feeds' Actions menu locks Execute On-Call Policy on a
 * resolved record, with the reason, and its form says, on an acknowledged
 * one, that the policy still pages its people until one of them answers.
 *
 * The four REAL feeds are rendered with their REAL Actions menu; only the
 * network (ModelAPI), the markdown-rendering FeedItem, the runbook picker
 * and the form itself are stubbed - the form as a dialog that shows the
 * title and description it is handed, which the real one translates and
 * draws.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (): Promise<{ data: Array<unknown>; count: number }> => {
        return Promise.resolve({ data: [], count: 0 });
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Components/Feed/FeedItem", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

// What the form was last handed: its fields.
let mockFormFields: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: {
      title: string;
      description?: string;
      name?: string;
      formProps?: { fields?: Array<Record<string, unknown>> };
    }): React.ReactElement => {
      mockFormFields = props.formProps?.fields || [];

      return React.createElement(
        "div",
        { role: "dialog", "aria-label": props.title, "data-name": props.name },
        React.createElement(
          "p",
          { "data-testid": "execute-policy-description" },
          props.description,
        ),
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookPicker",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import IncidentFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentFeed";
import AlertFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertFeed";
import IncidentEpisodeFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodeFeed";
import AlertEpisodeFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/AlertEpisode/AlertEpisodeFeed";
import {
  EXECUTE_ON_CALL_POLICY_WORDS,
  getExecuteOnCallPolicyDescription,
  getExecuteOnCallPolicyMenuLock,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutePolicy/ExecuteOnCallPolicyWords";
import { EventStanding } from "../../../../App/FeatureSet/Dashboard/src/Utils/EventDuration";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallPageRecordType,
  getOnCallPageRecordNoun,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import { getOnCallPolicyStartedOnResolvedRecordMessage } from "../../../Types/OnCallDutyPolicy/OnCallPolicyStartedByHand";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

const ACTION: string = "Execute On-Call Policy";

const RECORD_ID: ObjectID = new ObjectID(
  "79390000-0000-4000-8000-000000000001",
);

interface FeedCase {
  name: string;
  recordType: OnCallPageRecordType;
  render: (standing: EventStanding | undefined) => React.ReactElement;
  // The menu's other action that any reader is offered, when it has one.
  otherAction?: string | undefined;
}

const FEEDS: Array<FeedCase> = [
  {
    name: "an incident's feed",
    recordType: OnCallPageRecordType.Incident,
    render: (standing: EventStanding | undefined): React.ReactElement => {
      return <IncidentFeedElement incidentId={RECORD_ID} standing={standing} />;
    },
    otherAction: "Execute Runbook",
  },
  {
    name: "an alert's feed",
    recordType: OnCallPageRecordType.Alert,
    render: (standing: EventStanding | undefined): React.ReactElement => {
      return <AlertFeedElement alertId={RECORD_ID} standing={standing} />;
    },
    otherAction: "Execute Runbook",
  },
  {
    name: "an incident episode's feed",
    recordType: OnCallPageRecordType.IncidentEpisode,
    render: (standing: EventStanding | undefined): React.ReactElement => {
      return (
        <IncidentEpisodeFeedElement
          incidentEpisodeId={RECORD_ID}
          standing={standing}
        />
      );
    },
  },
  {
    name: "an alert episode's feed",
    recordType: OnCallPageRecordType.AlertEpisode,
    render: (standing: EventStanding | undefined): React.ReactElement => {
      return (
        <AlertEpisodeFeedElement
          alertEpisodeId={RECORD_ID}
          standing={standing}
        />
      );
    },
  },
];

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

// The feed, rendered, with its Actions menu open: its Execute On-Call Policy.
async function executeItem(
  feed: FeedCase,
  standing: EventStanding | undefined,
): Promise<HTMLElement> {
  render(feed.render(standing));
  await flush();

  const trigger: HTMLElement = screen
    .getByText("Actions")
    .closest('[aria-haspopup="menu"]') as HTMLElement;

  fireEvent.click(trigger);

  return await screen.findByRole("menuitem", { name: ACTION });
}

// Presses it: the form's description when one opens, null when none does.
async function press(item: HTMLElement): Promise<string | null> {
  fireEvent.click(item);
  await flush();

  const dialog: HTMLElement | null = screen.queryByRole("dialog", {
    name: ACTION,
  });

  return dialog
    ? screen.getByTestId("execute-policy-description").textContent
    : null;
}

beforeEach(() => {
  window.localStorage.clear();
  mockFormFields = [];
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(FEEDS)("Execute On-Call Policy on $name", (feed: FeedCase) => {
  const words: {
    open: string;
    acknowledged: string;
    resolved: string;
  } = EXECUTE_ON_CALL_POLICY_WORDS[feed.recordType];

  test("resolved: locked, saying why, and pressing it opens no form", async () => {
    const item: HTMLElement = await executeItem(feed, EventStanding.Resolved);

    expect(item).toHaveAttribute("aria-disabled", "true");
    // Still reachable, so the reason can be read: locked with why.
    expect(item).not.toBeDisabled();
    expect(item).toHaveAccessibleDescription(words.resolved);

    expect(await press(item)).toBeNull();
  });

  test("open: offered, and its form says the policy pages until one of its people answers", async () => {
    const item: HTMLElement = await executeItem(feed, EventStanding.Open);

    expect(item).not.toHaveAttribute("aria-disabled", "true");
    expect(await press(item)).toBe(words.open);
  });

  test("acknowledged: offered, and its form says the acknowledgement does not stop it", async () => {
    const item: HTMLElement = await executeItem(
      feed,
      EventStanding.Acknowledged,
    );

    expect(item).not.toHaveAttribute("aria-disabled", "true");
    expect(await press(item)).toBe(words.acknowledged);
  });

  /*
   * An archived policy pages no one (OnCallDutyPolicyArchive): picked, its
   * run was written with the reason and nobody was paged. The form offers
   * live policies only, as Slack's and Microsoft Teams' own forms do.
   */
  test("its form offers live policies only: an archived one would page no one", async () => {
    const item: HTMLElement = await executeItem(feed, EventStanding.Open);

    await press(item);

    const policyField: Record<string, unknown> | undefined =
      mockFormFields.find((field: Record<string, unknown>): boolean => {
        return Boolean(
          (field["field"] as Record<string, unknown> | undefined)?.[
            "onCallDutyPolicy"
          ],
        );
      });

    expect(policyField).toBeDefined();
    expect(
      (policyField!["dropdownModal"] as { query?: unknown }).query,
    ).toEqual({ isArchived: false });
  });

  test("where it stands not known yet: offered as it always was, the server keeping the last word", async () => {
    const item: HTMLElement = await executeItem(feed, undefined);

    expect(item).not.toHaveAttribute("aria-disabled", "true");
    expect(item).not.toHaveAttribute("aria-describedby");
    expect(await press(item)).toBe(words.open);
  });

  test("only it is locked for the record being resolved: the menu's other actions stay as they were", async () => {
    await executeItem(feed, EventStanding.Resolved);

    const others: Array<HTMLElement> = screen
      .getAllByRole("menuitem")
      .filter((item: HTMLElement): boolean => {
        return item.textContent !== ACTION;
      });

    for (const other of others) {
      const reasonId: string | null = other.getAttribute("aria-describedby");

      expect({
        item: other.textContent,
        reason: reasonId
          ? document.getElementById(reasonId)?.textContent
          : null,
      }).not.toEqual(expect.objectContaining({ reason: words.resolved }));
    }

    if (feed.otherAction) {
      const other: HTMLElement = screen.getByRole("menuitem", {
        name: feed.otherAction,
      });

      expect(other).not.toHaveAttribute("aria-disabled", "true");
    }
  });
});

describe("the words, for every record", () => {
  const RECORD_TYPES: Array<OnCallPageRecordType> = Object.values(
    OnCallPageRecordType,
  ) as Array<OnCallPageRecordType>;

  test("every record kind has its three sentences, each different", () => {
    expect(Object.keys(EXECUTE_ON_CALL_POLICY_WORDS).sort()).toEqual(
      [...RECORD_TYPES].sort(),
    );

    for (const recordType of RECORD_TYPES) {
      const words: { open: string; acknowledged: string; resolved: string } =
        EXECUTE_ON_CALL_POLICY_WORDS[recordType];

      expect(
        new Set([words.open, words.acknowledged, words.resolved]).size,
      ).toBe(3);
    }
  });

  test("each names its own record, and none says another's", () => {
    for (const recordType of RECORD_TYPES) {
      const noun: string = getOnCallPageRecordNoun(recordType);
      const words: { open: string; acknowledged: string; resolved: string } =
        EXECUTE_ON_CALL_POLICY_WORDS[recordType];

      expect(words.open).toContain(`about this ${noun},`);
      expect(
        words.acknowledged.startsWith(`This ${noun} is acknowledged already.`),
      ).toBe(true);
      expect(words.resolved.startsWith(`This ${noun} is resolved,`)).toBe(true);
    }
  });

  test("open and acknowledged say how long it pages: until one of its people answers or the record is resolved", () => {
    for (const recordType of RECORD_TYPES) {
      const words: { open: string; acknowledged: string } =
        EXECUTE_ON_CALL_POLICY_WORDS[recordType];

      for (const sentence of [words.open, words.acknowledged]) {
        expect(sentence).toContain("level by level, until one of them answers");
        expect(sentence).toMatch(
          /or the (incident|alert|episode) is resolved\.$/,
        );
      }

      // Acknowledged: it still pages, the acknowledgement there or not.
      expect(words.acknowledged).toContain("still pages its people");
    }
  });

  test("the resolved reason says what the server and the chats say: no on-call policy for a resolved record", () => {
    for (const recordType of RECORD_TYPES) {
      const noun: string = getOnCallPageRecordNoun(recordType);
      const refusal: string =
        getOnCallPolicyStartedOnResolvedRecordMessage(noun);

      // "This incident is resolved, so no on-call policy" ... was started / can be started.
      expect(
        refusal.startsWith(`This ${noun} is resolved, so no on-call policy`),
      ).toBe(true);
      expect(EXECUTE_ON_CALL_POLICY_WORDS[recordType].resolved).toBe(
        `This ${noun} is resolved, so no on-call policy can be started for it.`,
      );
    }
  });

  test.each([
    [EventStanding.Resolved, true],
    [EventStanding.Acknowledged, false],
    [EventStanding.Open, false],
    [undefined, false],
  ])(
    "the menu is locked on %p: %p",
    (standing: EventStanding | undefined, isLocked: boolean) => {
      for (const recordType of RECORD_TYPES) {
        expect(
          getExecuteOnCallPolicyMenuLock({ recordType, standing }),
        ).toEqual({
          isDisabled: isLocked,
          tooltip: isLocked
            ? EXECUTE_ON_CALL_POLICY_WORDS[recordType].resolved
            : undefined,
        });
      }
    },
  );

  test("the form says what fits where the record stands, and the open words when that is not known", () => {
    for (const recordType of RECORD_TYPES) {
      const words: { open: string; acknowledged: string; resolved: string } =
        EXECUTE_ON_CALL_POLICY_WORDS[recordType];

      expect(
        getExecuteOnCallPolicyDescription({
          recordType,
          standing: EventStanding.Open,
        }),
      ).toBe(words.open);
      expect(
        getExecuteOnCallPolicyDescription({
          recordType,
          standing: undefined,
        }),
      ).toBe(words.open);
      expect(
        getExecuteOnCallPolicyDescription({
          recordType,
          standing: EventStanding.Acknowledged,
        }),
      ).toBe(words.acknowledged);
      // A record resolved while its form was open: why nothing starts.
      expect(
        getExecuteOnCallPolicyDescription({
          recordType,
          standing: EventStanding.Resolved,
        }),
      ).toBe(words.resolved);
    }
  });

  test("no feed says the old words any more", () => {
    const dashboard: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src",
    );

    for (const file of [
      "Components/Incident/IncidentFeed.tsx",
      "Components/Alert/AlertFeed.tsx",
      "Components/IncidentEpisode/IncidentEpisodeFeed.tsx",
      "Components/AlertEpisode/AlertEpisodeFeed.tsx",
    ]) {
      expect({
        file,
        oldWords: fs
          .readFileSync(path.join(dashboard, file), "utf8")
          .includes(
            "This will notify the on-call team members and start the on-call process.",
          ),
      }).toEqual({ file, oldWords: false });
    }
  });
});

/*
 * Every Dashboard language words each sentence itself: a missing or English
 * one fails here, as does a translation that drops the record or the policy.
 */
describe("in every Dashboard language", () => {
  type Locale = Record<string, string>;

  const LOCALES_DIRECTORY: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );

  const LANGUAGES: Array<string> = fs
    .readdirSync(LOCALES_DIRECTORY)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    })
    .sort();

  const readLocale: (language: string) => Locale = (
    language: string,
  ): Locale => {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
    ) as Locale;
  };

  const SENTENCES: Array<string> = Object.values(
    EXECUTE_ON_CALL_POLICY_WORDS,
  ).flatMap(
    (words: { open: string; acknowledged: string; resolved: string }) => {
      return [words.open, words.acknowledged, words.resolved];
    },
  );

  test("are the seventeen the Dashboard is translated into", () => {
    expect(LANGUAGES).toEqual(
      [
        "ar",
        "da",
        "de",
        "es",
        "fa",
        "fr",
        "hi",
        "it",
        "ja",
        "ko",
        "nl",
        "no",
        "pt",
        "ru",
        "sv",
        "zh-CN",
        "zh-TW",
      ].sort(),
    );
  });

  test("en.json has every sentence as itself", () => {
    const english: Locale = readLocale("en");

    for (const sentence of SENTENCES) {
      expect({ sentence, english: english[sentence] }).toEqual({
        sentence,
        english: sentence,
      });
    }
  });

  test.each(LANGUAGES)("%s words every sentence itself", (language: string) => {
    const locale: Locale = readLocale(language);

    for (const sentence of SENTENCES) {
      const translated: string | undefined = locale[sentence];

      expect({ sentence, isWorded: Boolean(translated) }).toEqual({
        sentence,
        isWorded: true,
      });
      expect({ sentence, isEnglish: translated === sentence }).toEqual({
        sentence,
        isEnglish: false,
      });
    }
  });

  test.each(LANGUAGES)(
    "%s keeps each sentence apart: the three of one record differ, and no two records read alike",
    (language: string) => {
      const locale: Locale = readLocale(language);
      const translated: Array<string> = SENTENCES.map(
        (sentence: string): string => {
          return locale[sentence] as string;
        },
      );

      expect(new Set(translated).size).toBe(SENTENCES.length);
    },
  );

  test("a German reader's form reads the German sentence, whole", () => {
    const german: Locale = readLocale("de");
    const translator: Translator = createTranslator((text: string) => {
      return german[text];
    }, "de");

    expect(
      translator.translateText(
        getExecuteOnCallPolicyDescription({
          recordType: OnCallPageRecordType.Incident,
          standing: EventStanding.Acknowledged,
        }),
      ),
    ).toBe(
      "Dieser Vorfall ist bereits bestätigt. Die gewählte Richtlinie alarmiert ihre Personen trotzdem, Stufe für Stufe, bis eine von ihnen antwortet oder der Vorfall behoben ist.",
    );
    expect(
      translator.translateText(
        getExecuteOnCallPolicyMenuLock({
          recordType: OnCallPageRecordType.Alert,
          standing: EventStanding.Resolved,
        }).tooltip as string,
      ),
    ).toBe(
      "Diese Warnung ist behoben, daher kann keine Bereitschaftsdienst-Richtlinie für sie gestartet werden.",
    );
  });
});

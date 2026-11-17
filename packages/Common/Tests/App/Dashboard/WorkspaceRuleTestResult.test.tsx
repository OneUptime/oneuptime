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
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { ReactElement } from "react";
import Toast from "../../../UI/Utils/Toast";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import URL from "../../../Types/API/URL";
import API from "../../../UI/Utils/API/API";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated } from "../../Helpers/IsolateMarks";
import { FIRST_STRONG_ISOLATE } from "../../../Types/ReadingDirection";

/*
 * #7114: Test Rule on a workspace notification rule says what the test
 * came to, as a summary's Send Test Now does (#6920).
 *
 * A failed test - a channel that does not exist, a project not connected,
 * a channel that could not be created - was shown inside the Test Rule
 * dialog, under its Test button: it read as if the test had not run yet,
 * and pressing Test again could post a second test into the channels that
 * had got the first. The dialog meant for the result had a Test Failed
 * title that never showed, as it opened only on success, and it said the
 * test was executed successfully whatever happened.
 *
 * Now the Test Rule dialog closes on any answer, and one result dialog
 * opens: Test Notification Sent, or Test Failed with what the server said
 * and what to do next. Either has one way out, Close, which leaves nothing
 * of the test behind.
 *
 * Both name the rule in quotes, set apart in a sentence read right to
 * left: a name such as "Page the database team" ran into the sentence
 * around it. The success said where to look only after repeating its own
 * title ("Test executed successfully."), and ten languages drew the Test
 * Rule button as a noun - "a test rule" - where their Test Monitor is an
 * action.
 *
 * The production rules table runs; only the list around it is replaced,
 * by one rule row with the table's own action buttons. The test route
 * answers as each test says.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "71140000-0000-4000-8000-0000000000a1",
);
const RULE_ID: ObjectID = new ObjectID("71140000-0000-4000-8000-0000000000a2");

const RULE_NAME: string = "Page the database team";

/*
 * What the rule does, when a test says: a rule that creates a channel for
 * each event (#7265). None: a rule as the other tests have it.
 */
let mockRuleConfig: Record<string, unknown> | undefined = undefined;

// The rule row the stand-in table shows.
function ruleRow(): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule._id = RULE_ID.toString();
  rule.name = RULE_NAME;

  if (mockRuleConfig) {
    rule.notificationRule = mockRuleConfig as never;
  }

  return rule;
}

/*
 * The stand-in table: the rule row's action buttons, each as the real
 * table draws it - locked when it says so - and pressed as the real table
 * presses it.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  const StandInTable: (
    props: ModelTableProps<WorkspaceNotificationRule>,
  ) => ReactElement = (
    props: ModelTableProps<WorkspaceNotificationRule>,
  ): ReactElement => {
    return (
      <div data-testid="rule-row">
        {(props.actionButtons || []).map(
          (button: {
            title: string;
            disabled?: boolean | undefined;
            onClick: (
              item: WorkspaceNotificationRule,
              onCompleteAction: () => void,
              onError: (error: Error) => void,
            ) => void;
          }): ReactElement => {
            return (
              <button
                key={button.title}
                type="button"
                disabled={Boolean(button.disabled)}
                onClick={() => {
                  button.onClick(
                    ruleRow(),
                    () => {},
                    () => {},
                  );
                }}
              >
                {button.title}
              </button>
            );
          },
        )}
      </div>
    );
  };

  return {
    __esModule: true,
    default: StandInTable,
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return PROJECT_ID;
      },
    },
  };
});

import WorkspaceNotificationRuleTable from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceNotificationRulesTable";
import {
  TEST_RULE_CHANNEL_WARNING_TEST_ID,
  TEST_RULE_CREATES_CHANNEL_WARNING,
  TEST_RULE_CREATES_TEAMS_CHANNEL_WARNING,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceRuleTestChannel";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

// What the server refuses a test of a rule naming a channel Slack has not.
const NOT_FOUND: string =
  "The Slack channel #does-not-exist was not found. If it is a private channel, invite OneUptime's bot to it in Slack.";

// The words of the two dialogs, as the Dashboard looks them up.
const CONFIRM_TITLE: string = "Test Rule";
const CONFIRM_DESCRIPTION: string =
  'Send a test notification for the rule "{{rule}}" to {{workspace}}.';
const SUCCESS_TITLE: string = "Test Notification Sent";
const SUCCESS_DESCRIPTION: string =
  'Check {{workspace}} to confirm the test notification for the rule "{{rule}}" arrived.';
const FAILURE_TITLE: string = "Test Failed";
const NEXT_STEP: string = "Fix the problem above, then test the rule again.";

const DIALOG_KEYS: Array<string> = [
  CONFIRM_TITLE,
  CONFIRM_DESCRIPTION,
  "Cancel",
  "Test",
  SUCCESS_TITLE,
  SUCCESS_DESCRIPTION,
  FAILURE_TITLE,
  NEXT_STEP,
  "Close",
];

const DE: Record<string, string> = readDashboardLocale("de");
const AR: Record<string, string> = readDashboardLocale("ar");
const FA: Record<string, string> = readDashboardLocale("fa");

/*
 * The languages the dialogs are drawn in below, and how their sentences
 * hold a value in Latin letters - the rule's name, "Slack": as it is in a
 * German one, set apart in an Arabic or Persian one, which reads from the
 * right (Translator's setsValuesApart).
 */
const READERS: Array<
  [string, Record<string, string>, (value: string) => string]
> = [
  [
    "de",
    DE,
    (value: string): string => {
      return value;
    },
  ],
  ["ar", AR, isolated],
  ["fa", FA, isolated],
];

// What the test route answers next: a send, a refusal, or no answer at all.
let testAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse | Error =
  new HTTPResponse<JSONObject>(200, {}, {});

const testRoutesCalled: Array<string> = [];

function dialogs(): Array<HTMLElement> {
  return screen.queryAllByRole("dialog");
}

function onlyDialog(): HTMLElement {
  expect(dialogs()).toHaveLength(1);
  return dialogs()[0]!;
}

function titleOf(dialog: HTMLElement): string {
  return within(dialog).getByTestId("modal-title").textContent || "";
}

function descriptionOf(dialog: HTMLElement): string {
  return (
    within(dialog).getByTestId("confirm-modal-description").textContent || ""
  );
}

function buttonsOf(dialog: HTMLElement): Array<string> {
  return within(dialog)
    .queryAllByRole("button")
    .map((button: HTMLElement): string => {
      return (
        button.getAttribute("aria-label") ||
        button.textContent ||
        ""
      ).trim();
    });
}

function fill(
  template: string | undefined,
  values: Record<string, string>,
): string {
  let text: string = template || "";

  for (const name of Object.keys(values)) {
    text = text.split(`{{${name}}}`).join(values[name]!);
  }

  return text;
}

async function renderTable(
  workspaceType: WorkspaceType = WorkspaceType.Slack,
  eventType: NotificationRuleEventType = NotificationRuleEventType.Incident,
): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <WorkspaceNotificationRuleTable
        workspaceType={workspaceType}
        eventType={eventType}
      />,
    );
  });

  await screen.findByTestId("rule-row", {}, { timeout: 10000 });
}

// The row's Test Rule button: what opens the Test Rule dialog.
function pressTestRule(): HTMLElement {
  fireEvent.click(
    within(screen.getByTestId("rule-row")).getAllByRole("button")[0]!,
  );

  return onlyDialog();
}

// Test Rule, then the dialog's Test: the dialog after it.
async function testTheRule(): Promise<HTMLElement> {
  const confirm: HTMLElement = pressTestRule();

  await act(async (): Promise<void> => {
    fireEvent.click(within(confirm).getByTestId("modal-footer-submit-button"));
  });

  // The result dialog has no Cancel: the Test Rule dialog is gone.
  await waitFor(() => {
    expect(
      within(onlyDialog()).queryByTestId("modal-footer-close-button"),
    ).toBeNull();
  });

  return onlyDialog();
}

/*
 * Test Rule, then the dialog's Test, for a test the server sent: no dialog
 * after it, a toast (#9120). Its title and words.
 */
async function testTheRuleThatWorks(): Promise<{
  title: string;
  description: string;
}> {
  Toast.dismissAll();

  const confirm: HTMLElement = pressTestRule();

  await act(async (): Promise<void> => {
    fireEvent.click(within(confirm).getByTestId("modal-footer-submit-button"));
  });

  await waitFor(() => {
    expect(Toast.getToasts()).toHaveLength(1);
  });

  // The Test Rule dialog is gone, and nothing opened in its place.
  expect(dialogs()).toHaveLength(0);

  return {
    title: Toast.getToasts()[0]!.title,
    description: String(Toast.getToasts()[0]!.description),
  };
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: AR },
      fa: { translation: FA },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

beforeEach(() => {
  testAnswer = new HTTPResponse<JSONObject>(200, {}, {});
  testRoutesCalled.length = 0;
  mockRuleConfig = undefined;

  // What the page reads as it loads: nothing it needs to show a rule.
  jest.spyOn(API, "get").mockImplementation((async (): Promise<
    HTTPResponse<JSONObject> | HTTPErrorResponse
  > => {
    return new HTTPErrorResponse(500, { message: "Not answered" }, {});
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: URL;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    testRoutesCalled.push(new globalThis.URL(options.url.toString()).pathname);

    if (testAnswer instanceof Error) {
      throw testAnswer;
    }

    return testAnswer;
  }) as never);
});

afterEach(async () => {
  Toast.dismissAll();
  cleanup();
  jest.restoreAllMocks();
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

describe("Test Rule on a workspace notification rule says what the test came to", () => {
  test("Test Rule asks first, naming the rule in quotes and the workspace, with Cancel - and Cancel sends nothing", async () => {
    await renderTable();

    const confirm: HTMLElement = pressTestRule();

    expect(titleOf(confirm)).toBe("Test Rule");
    expect(descriptionOf(confirm)).toBe(
      `Send a test notification for the rule "${RULE_NAME}" to Slack.`,
    );
    // An English sentence holds a name in Latin letters as it is.
    expect(descriptionOf(confirm)).not.toContain(FIRST_STRONG_ISOLATE);
    expect(buttonsOf(confirm)).toEqual(["Close", "Cancel", "Test"]);
    expect(within(confirm).queryByTestId("modal-error")).toBeNull();

    fireEvent.click(within(confirm).getByTestId("modal-footer-close-button"));

    expect(dialogs()).toHaveLength(0);
    expect(testRoutesCalled).toEqual([]);
  });

  test("a test the server sent: the Test Rule dialog closes, and a Test Notification Sent toast says where to look for which rule's test", async () => {
    await renderTable();

    const result: { title: string; description: string } =
      await testTheRuleThatWorks();

    // The rule's own test route, once.
    expect(testRoutesCalled).toHaveLength(1);
    expect(
      testRoutesCalled[0]!.endsWith(
        `/workspace-notification-rule/test/${RULE_ID.toString()}`,
      ),
    ).toBe(true);
    expect(result.title).toBe("Test Notification Sent");
    expect(result.description).toBe(
      `Check Slack to confirm the test notification for the rule "${RULE_NAME}" arrived.`,
    );
    // It says something its title does not: it began by repeating it.
    expect(result.description.toLowerCase()).not.toContain(
      result.title.toLowerCase(),
    );
  });

  test("a test the server refused: the Test Rule dialog closes, and Test Failed says why in the server's words, then what to do next - with no Test to press again", async () => {
    testAnswer = new HTTPErrorResponse(400, { message: NOT_FOUND }, {});

    await renderTable();

    const result: HTMLElement = await testTheRule();

    expect(titleOf(result)).toBe("Test Failed");
    expect(within(result).getByTestId("modal-error").textContent).toBe(
      NOT_FOUND,
    );
    expect(descriptionOf(result)).toBe(NEXT_STEP);
    // Why, then what to do about it.
    expect(
      within(result)
        .getByTestId("modal-error")
        .compareDocumentPosition(
          within(result).getByTestId("confirm-modal-description"),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Nothing offers the test again: the channels that got it are not sent it twice.
    expect(buttonsOf(result)).toEqual(["Close"]);
    expect(screen.queryByRole("button", { name: "Test" })).toBeNull();
    // Nor does it say the test was sent, or where to look for it.
    expect(screen.queryByText(SUCCESS_TITLE)).toBeNull();
    expect(screen.queryByText(/to confirm the test notification/i)).toBeNull();
    expect(testRoutesCalled).toHaveLength(1);
  });

  test("a test that never reached the server: Test Failed, with why", async () => {
    testAnswer = new Error("Network Error");

    await renderTable();

    const result: HTMLElement = await testTheRule();

    expect(titleOf(result)).toBe("Test Failed");
    expect(within(result).getByTestId("modal-error")).toHaveTextContent(
      "Network Error",
    );
    expect(descriptionOf(result)).toBe(NEXT_STEP);
    expect(buttonsOf(result)).toEqual(["Close"]);
  });

  test("a refusal of another kind - a project not connected - is said in its own words too", async () => {
    const notConnected: string =
      "This project is not connected to Slack. Please ask a Project Admin to connect Slack in Project Settings > Workspace > Slack.";
    testAnswer = new HTTPErrorResponse(400, { message: notConnected }, {});

    await renderTable();

    const result: HTMLElement = await testTheRule();

    expect(titleOf(result)).toBe("Test Failed");
    expect(within(result).getByTestId("modal-error").textContent).toBe(
      notConnected,
    );
  });

  test("closing a failed test leaves nothing of it behind: Test Rule asks again with no error, and a test that then succeeds says so", async () => {
    testAnswer = new HTTPErrorResponse(400, { message: NOT_FOUND }, {});

    await renderTable();

    const failed: HTMLElement = await testTheRule();
    expect(titleOf(failed)).toBe("Test Failed");

    fireEvent.click(within(failed).getByTestId("modal-footer-submit-button"));
    expect(dialogs()).toHaveLength(0);

    testAnswer = new HTTPResponse<JSONObject>(200, {}, {});

    const confirm: HTMLElement = pressTestRule();
    expect(titleOf(confirm)).toBe("Test Rule");
    expect(within(confirm).queryByTestId("modal-error")).toBeNull();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    fireEvent.click(within(confirm).getByTestId("modal-footer-close-button"));

    expect((await testTheRuleThatWorks()).title).toBe("Test Notification Sent");
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(NEXT_STEP)).toBeNull();
    expect(testRoutesCalled).toHaveLength(2);
  });

  test("a success after a success, and a failure after a success: each dialog says only its own test", async () => {
    await renderTable();

    expect((await testTheRuleThatWorks()).title).toBe("Test Notification Sent");
    expect((await testTheRuleThatWorks()).title).toBe("Test Notification Sent");
    expect(screen.queryByTestId("modal-error")).toBeNull();
    Toast.dismissAll();

    testAnswer = new HTTPErrorResponse(400, { message: NOT_FOUND }, {});

    const failed: HTMLElement = await testTheRule();
    expect(titleOf(failed)).toBe("Test Failed");
    expect(screen.queryByText(SUCCESS_TITLE)).toBeNull();
    expect(screen.queryByText(/to confirm the test notification/i)).toBeNull();
    expect(testRoutesCalled).toHaveLength(3);
  });
});

describe("in the reader's language", () => {
  test.each(READERS)(
    "%s: Test Failed, what to do next and Close in the reader's words; the server's reason as it was written",
    async (language: string, words: Record<string, string>) => {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });
      testAnswer = new HTTPErrorResponse(400, { message: NOT_FOUND }, {});

      await renderTable();

      const result: HTMLElement = await testTheRule();

      expect(titleOf(result)).toBe(words[FAILURE_TITLE]);
      expect(within(result).getByTestId("modal-error").textContent).toBe(
        NOT_FOUND,
      );
      expect(descriptionOf(result)).toBe(words[NEXT_STEP]);
      expect(
        within(result).getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent(words["Close"]!);
      expect(screen.queryByText(FAILURE_TITLE)).toBeNull();
      expect(screen.queryByText(NEXT_STEP)).toBeNull();
    },
  );

  test.each(READERS)(
    "%s: Test Notification Sent and where to look for which rule's test, in the reader's words",
    async (
      language: string,
      words: Record<string, string>,
      inSentence: (value: string) => string,
    ) => {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });

      await renderTable();

      const result: { title: string; description: string } =
        await testTheRuleThatWorks();

      expect(result.title).toBe(words[SUCCESS_TITLE]);
      // The rule's name and the workspace's, each where the sentence puts it.
      expect(result.description).toBe(
        fill(words[SUCCESS_DESCRIPTION], {
          workspace: inSentence("Slack"),
          rule: inSentence(RULE_NAME),
        }),
      );
      expect(result.title).not.toBe(SUCCESS_TITLE);
    },
  );

  test.each(READERS)(
    "%s: Test Rule asks in the reader's words - its title, what it sends, Cancel and Test",
    async (
      language: string,
      words: Record<string, string>,
      inSentence: (value: string) => string,
    ) => {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });

      await renderTable();

      const confirm: HTMLElement = pressTestRule();

      expect(titleOf(confirm)).toBe(words[CONFIRM_TITLE]);
      expect(descriptionOf(confirm)).toBe(
        fill(words[CONFIRM_DESCRIPTION], {
          rule: inSentence(RULE_NAME),
          workspace: inSentence("Slack"),
        }),
      );
      expect(
        within(confirm).getByTestId("modal-footer-close-button"),
      ).toHaveTextContent(words["Cancel"]!);
      expect(
        within(confirm).getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent(words["Test"]!);
    },
  );

  test("a Latin rule name keeps its place in a Persian sentence: set apart, inside Persian quotes", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("fa");
    });

    await renderTable();

    const description: string = descriptionOf(pressTestRule());

    expect(description).toContain(`«${isolated(RULE_NAME)}»`);
    expect(description).not.toContain(`"${RULE_NAME}"`);
  });

  test("German, Arabic and Persian say the dialogs as their readers would", () => {
    expect(DE[NEXT_STEP]).toBe(
      "Beheben Sie das oben genannte Problem und testen Sie die Regel dann erneut.",
    );
    expect(DE[SUCCESS_TITLE]).toBe("Testbenachrichtigung gesendet");
    expect(DE[CONFIRM_DESCRIPTION]).toBe(
      "Eine Testbenachrichtigung für die Regel „{{rule}}“ an {{workspace}} senden.",
    );
    expect(AR[NEXT_STEP]).toBe(
      "أصلح المشكلة المذكورة أعلاه، ثم اختبر القاعدة مرة أخرى.",
    );
    expect(FA[CONFIRM_TITLE]).toBe("آزمایش قاعده");
  });
});

/*
 * The row's Test Rule button runs a test of the rule: each language says
 * it as an action, as it says Test Monitor. Ten drew it as a noun - "a test
 * rule", a kind of rule - and their guides named it so; the guides name it
 * as the Dashboard draws it (the docs' label checks).
 */
const TEST_RULE_NOUNS: Array<[string, string, string]> = [
  ["nl", "Testregel", "Regel testen"],
  ["fa", "قاعده آزمایش", "آزمایش قاعده"],
  ["it", "Regola di test", "Testa la regola"],
  ["hi", "परीक्षण नियम", "नियम का परीक्षण करें"],
  ["da", "Testregel", "Test regel"],
  ["no", "Testregel", "Test regel"],
  ["ko", "테스트 규칙", "규칙 테스트"],
  ["sv", "Testregel", "Testa regel"],
  ["ru", "Тестовое правило", "Протестировать правило"],
  ["pt", "Regra de teste", "Testar regra"],
];

describe("the Test Rule button says what it does", () => {
  test.each(TEST_RULE_NOUNS)(
    "%s: not %s (a test rule) but %s",
    (language: string, noun: string, action: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(words[CONFIRM_TITLE]).toBe(action);
      expect(words[CONFIRM_TITLE]).not.toBe(noun);
    },
  );
});

describe("every Dashboard language words the two dialogs", () => {
  test.each(DASHBOARD_LANGUAGES)("%s", (language: string) => {
    const unworded: Array<string> = DIALOG_KEYS.filter(
      (key: string): boolean => {
        return !isWordedInDashboardLocale(key, language);
      },
    );

    expect(unworded).toEqual([]);
  });

  test("the English the check reads is the English the dialogs say", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of DIALOG_KEYS) {
      expect(english[key]).toBe(key);
    }
  });

  test("a text no locale has is not counted as worded (the check can fail)", () => {
    expect(
      isWordedInDashboardLocale(
        "A sentence no Dashboard locale has, for this check.",
        "de",
      ),
    ).toBe(false);
  });
});

/*
 * #7265: testing a rule that creates a channel for each event creates a
 * real channel - named as the rule names its channels, with a few random
 * letters - and invites the person testing to it. The Test Rule dialog
 * says so before the test runs, naming the channel; for a rule that only
 * posts it says nothing more.
 */
describe("Test Rule on a rule that creates channels says what the test creates, before it runs", () => {
  const CREATES: string = TEST_RULE_CREATES_CHANNEL_WARNING;
  const CREATES_IN_TEAMS: string = TEST_RULE_CREATES_TEAMS_CHANNEL_WARNING;

  function warningOf(dialog: HTMLElement): HTMLElement | null {
    return within(dialog).queryByTestId(TEST_RULE_CHANNEL_WARNING_TEST_ID);
  }

  test("a Slack rule that creates channels: the channel it creates, by its prefix, and that you are invited", async () => {
    mockRuleConfig = {
      shouldCreateNewChannel: true,
      newChannelTemplateName: "prod-",
    };

    await renderTable();

    const confirm: HTMLElement = pressTestRule();

    expect(warningOf(confirm)).toHaveTextContent(
      fill(CREATES, { workspace: "Slack", channel: "#prod-abcde" }),
    );
    // Asked before the test runs: nothing is sent yet.
    expect(testRoutesCalled).toEqual([]);
    expect(descriptionOf(confirm)).toBe(
      `Send a test notification for the rule "${RULE_NAME}" to Slack.`,
    );
  });

  test("a rule without a prefix names its test channel test-, as the server does", async () => {
    mockRuleConfig = { shouldCreateNewChannel: true };

    await renderTable();

    expect(warningOf(pressTestRule())).toHaveTextContent("#test-abcde");
  });

  test("REGRESSION: a rule that only posts in existing channels says nothing more", async () => {
    mockRuleConfig = {
      shouldPostToExistingChannel: true,
      existingChannelNames: "incidents",
    };

    await renderTable();

    const confirm: HTMLElement = pressTestRule();

    expect(warningOf(confirm)).toBeNull();
    expect(confirm).not.toHaveTextContent("abcde");
  });

  test("a rule that has no settings yet says nothing more either", async () => {
    await renderTable();

    expect(warningOf(pressTestRule())).toBeNull();
  });

  test("a kind of rule that never has a channel of its own says nothing more, whatever it holds", async () => {
    mockRuleConfig = { shouldCreateNewChannel: true };

    await renderTable(
      WorkspaceType.Slack,
      NotificationRuleEventType.ServiceLevelObjective,
    );

    expect(warningOf(pressTestRule())).toBeNull();
  });

  test("Mattermost: the channel and the invite, without Slack's #", async () => {
    mockRuleConfig = {
      shouldCreateNewChannel: true,
      newChannelTemplateName: "prod-",
    };

    await renderTable(WorkspaceType.Mattermost);

    expect(warningOf(pressTestRule())).toHaveTextContent(
      fill(CREATES, { workspace: "Mattermost", channel: "prod-abcde" }),
    );
  });

  test("Microsoft Teams: the channel in the rule's team, which everyone in it sees - nobody is invited to one", async () => {
    mockRuleConfig = {
      shouldCreateNewChannel: true,
      newChannelTemplateName: "prod-",
    };

    // A Microsoft Teams page reads the connection's teams and chats first.
    jest.spyOn(API, "get").mockImplementation((async (options: {
      url: URL;
    }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const route: string = new globalThis.URL(options.url.toString()).pathname;

      if (route.endsWith("/microsoft-teams/teams")) {
        return new HTTPResponse<JSONObject>(200, { teams: [] }, {});
      }

      if (route.endsWith("/microsoft-teams/chats")) {
        return new HTTPResponse<JSONObject>(200, { chats: [] }, {});
      }

      return new HTTPErrorResponse(500, { message: "Not answered" }, {});
    }) as never);

    await renderTable(WorkspaceType.MicrosoftTeams);

    const warning: HTMLElement | null = warningOf(pressTestRule());

    expect(warning).toHaveTextContent(
      fill(CREATES_IN_TEAMS, { channel: "prod-abcde" }),
    );
    expect(warning).not.toHaveTextContent("invites you");
  });

  test.each(READERS)(
    "%s: the warning in the reader's words, the channel's name set apart as it is",
    async (
      language: string,
      words: Record<string, string>,
      inSentence: (value: string) => string,
    ) => {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });
      mockRuleConfig = {
        shouldCreateNewChannel: true,
        newChannelTemplateName: "prod-",
      };

      await renderTable();

      const warning: HTMLElement | null = warningOf(pressTestRule());

      expect(words[CREATES]).toBeTruthy();
      expect(warning?.textContent).toBe(
        fill(words[CREATES], {
          workspace: inSentence("Slack"),
          channel: inSentence("#prod-abcde"),
        }),
      );
      expect(warning).not.toHaveTextContent("invites you");
    },
  );

  test("every Dashboard language words the warning, keeping its placeholders", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of [CREATES, CREATES_IN_TEAMS]) {
        const worded: string = words[key] || "";

        expect({
          language,
          key,
          worded: worded !== "" && worded !== key,
          placeholders: placeholdersOf(worded).sort(),
        }).toEqual({
          language,
          key,
          worded: true,
          placeholders: placeholdersOf(key).sort(),
        });
      }
    }
  });
});

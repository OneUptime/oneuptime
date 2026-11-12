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
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import URL from "../../../Types/API/URL";
import API from "../../../UI/Utils/API/API";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * #6920: Send Test Now on a workspace summary says what the test came to.
 * The server fails a test that a channel did not get, naming each such
 * channel and why; the dialog said "Summary Sent" whatever happened, as
 * the server never failed one, and showed a failure - when one came - in
 * the confirm dialog, under its Send Now, as if to send it again into the
 * channels that had got it.
 *
 * The confirm dialog closes once the test is sent, and one result dialog
 * says what it came to: Summary Sent, or Test Failed with the server's
 * words above what to do next. Either has one way out, Close.
 *
 * The production table runs; only the list around it is replaced, by one
 * summary row with the table's own action buttons. The test route answers
 * as each test says.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "69200000-0000-4000-8000-0000000000d1",
);
const SUMMARY_ID: ObjectID = new ObjectID(
  "69200000-0000-4000-8000-0000000000d2",
);

// The summary row the stand-in table shows.
function summaryRow(): WorkspaceNotificationSummary {
  const summary: WorkspaceNotificationSummary =
    new WorkspaceNotificationSummary();
  summary._id = SUMMARY_ID.toString();
  summary.name = "Daily incidents";
  summary.numberOfDaysOfData = 1;
  return summary;
}

/*
 * The stand-in table: the summary row's action buttons, each as the real
 * table draws it - locked when it says so - and pressed as the real table
 * presses it.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  const StandInTable: (
    props: ModelTableProps<WorkspaceNotificationSummary>,
  ) => ReactElement = (
    props: ModelTableProps<WorkspaceNotificationSummary>,
  ): ReactElement => {
    return (
      <div data-testid="summary-row">
        {(props.actionButtons || []).map(
          (button: {
            title: string;
            disabled?: boolean | undefined;
            onClick: (
              item: WorkspaceNotificationSummary,
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
                    summaryRow(),
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

import WorkspaceSummaryTable from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSummaryTable";
import WorkspaceNotificationSummaryType from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

// What the server answers when a channel did not get the test.
const NOT_POSTED: string =
  "The test summary was not posted in 1 of its 2 channels. #gone: The Slack channel #gone was not found. If it is a private channel, invite OneUptime's bot to it in Slack.";

const NEXT_STEP: string =
  "Fix the cause named above, then send the test again.";

const SENT: string =
  "The test summary was sent successfully. Check your Slack channel to see how it looks.";

// What Send Test Now asks to send, as the Dashboard looks it up.
const CONFIRM_DESCRIPTION: string =
  'Send the "{{name}}" summary to {{workspace}} now, with the last {{count}} days of data. The regular schedule is not affected.';

// The words of the two dialogs, as the Dashboard looks them up.
const DIALOG_KEYS: Array<string> = [
  "Send Test Now",
  "Send Test Summary Now",
  "Send Now",
  "Cancel",
  "Summary Sent",
  "Test Failed",
  NEXT_STEP,
  "The test summary was sent successfully. Check your {{workspace}} channel to see how it looks.",
  "Close",
];

const DE: Record<string, string> = readDashboardLocale("de");
const AR: Record<string, string> = readDashboardLocale("ar");

// What the test route answers next: a send, or a refusal.
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

async function renderTable(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <WorkspaceSummaryTable
        workspaceType={WorkspaceType.Slack}
        summaryType={WorkspaceNotificationSummaryType.Incident}
      />,
    );
  });

  await screen.findByTestId("summary-row");
}

// Send Test Now, then the confirm dialog's submit: the dialog after it.
async function sendTest(): Promise<HTMLElement> {
  fireEvent.click(
    within(screen.getByTestId("summary-row")).getAllByRole("button")[0]!,
  );

  const confirm: HTMLElement = onlyDialog();

  await act(async (): Promise<void> => {
    fireEvent.click(within(confirm).getByTestId("modal-footer-submit-button"));
  });

  await waitFor(() => {
    expect(
      within(onlyDialog()).queryByTestId("modal-footer-close-button"),
    ).toBeNull();
  });

  return onlyDialog();
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: AR },
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
  cleanup();
  jest.restoreAllMocks();
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

describe("Send Test Now on a summary says what the test came to", () => {
  test("Send Test Now asks first, with Cancel, and Cancel sends nothing", async () => {
    await renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Send Test Now" }));

    const confirm: HTMLElement = onlyDialog();
    expect(titleOf(confirm)).toBe("Send Test Summary Now");
    expect(buttonsOf(confirm)).toEqual(["Close", "Cancel", "Send Now"]);

    fireEvent.click(within(confirm).getByTestId("modal-footer-close-button"));

    expect(dialogs()).toHaveLength(0);
    expect(testRoutesCalled).toEqual([]);
  });

  test("a test the server says reached every channel: Summary Sent, and Close is its one way out", async () => {
    await renderTable();

    const result: HTMLElement = await sendTest();

    // The summary's own test route, once.
    expect(testRoutesCalled).toHaveLength(1);
    expect(
      testRoutesCalled[0]!.endsWith(
        `/workspace-notification-summary/test/${SUMMARY_ID.toString()}`,
      ),
    ).toBe(true);
    expect(titleOf(result)).toBe("Summary Sent");
    expect(
      within(result).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(SENT);
    expect(within(result).queryByTestId("modal-error")).toBeNull();
    expect(buttonsOf(result)).toEqual(["Close"]);

    fireEvent.click(within(result).getByTestId("modal-footer-submit-button"));

    expect(dialogs()).toHaveLength(0);
  });

  test("a test the server refuses: Test Failed, the server's words above what to do next - the confirm dialog gone, nothing to send again", async () => {
    testAnswer = new HTTPErrorResponse(400, { message: NOT_POSTED }, {});

    await renderTable();

    const result: HTMLElement = await sendTest();

    expect(titleOf(result)).toBe("Test Failed");
    expect(within(result).getByTestId("modal-error")).toHaveTextContent(
      NOT_POSTED,
    );
    expect(
      within(result).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(NEXT_STEP);

    // The server's words come first, then what to do about them.
    expect(
      within(result)
        .getByTestId("modal-error")
        .compareDocumentPosition(
          within(result).getByTestId("confirm-modal-description"),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // No Send Now under the failure: the channels that got it are not sent it again.
    expect(buttonsOf(result)).toEqual(["Close"]);
    expect(screen.queryByText("Send Now")).toBeNull();
    expect(screen.queryByText(SENT)).toBeNull();
    expect(testRoutesCalled).toHaveLength(1);
  });

  test("a test that never reached the server: Test Failed, with why", async () => {
    testAnswer = new Error("Network Error");

    await renderTable();

    const result: HTMLElement = await sendTest();

    expect(titleOf(result)).toBe("Test Failed");
    expect(within(result).getByTestId("modal-error")).toHaveTextContent(
      "Network Error",
    );
    expect(buttonsOf(result)).toEqual(["Close"]);
  });

  test("closing a failed test leaves nothing of it behind: the next test asks again, and can say it was sent", async () => {
    testAnswer = new HTTPErrorResponse(400, { message: NOT_POSTED }, {});

    await renderTable();

    const failed: HTMLElement = await sendTest();
    fireEvent.click(within(failed).getByTestId("modal-footer-submit-button"));
    expect(dialogs()).toHaveLength(0);

    testAnswer = new HTTPResponse<JSONObject>(200, {}, {});

    fireEvent.click(screen.getByRole("button", { name: "Send Test Now" }));

    const confirm: HTMLElement = onlyDialog();
    expect(titleOf(confirm)).toBe("Send Test Summary Now");
    expect(within(confirm).queryByTestId("modal-error")).toBeNull();

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(confirm).getByTestId("modal-footer-submit-button"),
      );
    });

    await waitFor(() => {
      expect(titleOf(onlyDialog())).toBe("Summary Sent");
    });
    expect(within(onlyDialog()).queryByTestId("modal-error")).toBeNull();
    expect(screen.queryByText(NOT_POSTED)).toBeNull();
  });
});

describe("in the reader's language", () => {
  test.each([
    ["de", DE],
    ["ar", AR],
  ])(
    "%s: Test Failed, what to do next and Close in the reader's words, the server's as it said them",
    async (language: string, words: Record<string, string>) => {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });
      testAnswer = new HTTPErrorResponse(400, { message: NOT_POSTED }, {});

      await renderTable();

      const result: HTMLElement = await sendTest();

      expect(titleOf(result)).toBe(words["Test Failed"]);
      expect(
        within(result).getByTestId("confirm-modal-description"),
      ).toHaveTextContent(words[NEXT_STEP]!);
      expect(
        within(result).getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent(words["Close"]!);
      expect(within(result).getByTestId("modal-error")).toHaveTextContent(
        NOT_POSTED,
      );
      expect(screen.queryByText("Test Failed")).toBeNull();
      expect(screen.queryByText(NEXT_STEP)).toBeNull();
    },
  );

  test.each([
    ["de", DE],
    ["ar", AR],
  ])(
    "%s: Summary Sent in the reader's words",
    async (language: string, words: Record<string, string>) => {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });

      await renderTable();

      const result: HTMLElement = await sendTest();

      expect(titleOf(result)).toBe(words["Summary Sent"]);
      expect(screen.queryByText("Summary Sent")).toBeNull();
    },
  );

  test.each([
    ["de", DE],
    ["ar", AR],
  ])(
    "%s: Send Test Now asks in the reader's words - its title, what it sends, Cancel and Send Now",
    async (language: string, words: Record<string, string>) => {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });

      await renderTable();

      fireEvent.click(
        within(screen.getByTestId("summary-row")).getAllByRole("button")[0]!,
      );

      const confirm: HTMLElement = onlyDialog();

      expect(titleOf(confirm)).toBe(words["Send Test Summary Now"]);

      // The summary covers 1 day: the one form, with its name and workspace.
      expect(
        within(confirm).getByTestId("confirm-modal-description").textContent,
      ).toBe(
        words[`${CONFIRM_DESCRIPTION}_one`]!.replace(
          "{{name}}",
          "Daily incidents",
        )
          .replace("{{workspace}}", "Slack")
          .replace("{{count}}", "1"),
      );
      expect(
        within(confirm).getByTestId("modal-footer-close-button"),
      ).toHaveTextContent(words["Cancel"]!);
      expect(
        within(confirm).getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent(words["Send Now"]!);
      expect(screen.queryByText("Send Test Summary Now")).toBeNull();
      expect(screen.queryByText("Send Now")).toBeNull();
      expect(
        screen.queryByText(/The regular schedule is not affected/),
      ).toBeNull();
    },
  );

  test("German reads the dialogs as a German speaker would", () => {
    expect(DE["Test Failed"]).toBe("Test fehlgeschlagen");
    expect(DE[NEXT_STEP]).toBe(
      "Beheben Sie die oben genannte Ursache und senden Sie den Test dann erneut.",
    );
  });
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

  test("a text no locale has is not counted as worded (the check can fail)", () => {
    expect(
      isWordedInDashboardLocale(
        "A sentence no Dashboard locale has, for this check.",
        "de",
      ),
    ).toBe(false);
  });
});

import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Copy Link on a log row itself (#9944): a line's link, copied from its row
 * in the logs explorer's list without opening it - the link its details'
 * Copy Link copies (#9794), built with the same getLogLink as it is
 * pressed. It sits beside the row's Copy log message, drawn like it, shown
 * under the pointer, to the keyboard as Tab reaches it, and always on a
 * screen with no pointer to hover; Enter and Space press it; pressing it
 * leaves the row as it was; and what happened is said in the toast the
 * details' Copy Link says it in. The keyboard has `l` for the row it is
 * on, listed in the explorer's shortcuts. A row the app cannot link has
 * none, as its details have none.
 */

const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import LogsViewer, {
  getShortcutLog,
} from "../../../../UI/Components/LogsViewer/LogsViewer";
import LogsTable, {
  LOGS_TABLE_ROW_ACTIONS_CLASS_NAME,
  LOGS_TABLE_ROW_ACTIONS_TEST_ID,
  LOGS_TABLE_ROW_ACTION_CLASS_NAME,
  resolveLogIdentifier,
} from "../../../../UI/Components/LogsViewer/components/LogsTable";
import {
  COPY_LOG_LINE_LINK,
  COPY_LOG_LINE_LINK_TEST_ID,
  COPY_LOG_ROW_LINK_TEST_ID,
  LOG_LINE_LINK_COPIED,
  LOG_LINE_LINK_COPY_BY_HAND,
  LOG_LINE_LINK_FIELD_TEST_ID,
  LOG_LINE_LINK_NOT_COPIED,
} from "../../../../UI/Components/LogsViewer/components/CopyLogLineLinkButton";
import KeyboardShortcutsHelp, {
  KEYBOARD_SHORTCUTS_HELP_TEST_ID,
} from "../../../../UI/Components/LogsViewer/components/KeyboardShortcutsHelp";
import { LOGS_VIEWER_TOOLBAR_TEST_ID } from "../../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import { getCopyTextButtonClassName } from "../../../../UI/Components/CopyTextButton/CopyTextButton";
import ToastRegion from "../../../../UI/Components/Toast/ToastRegion";
import Clipboard from "../../../../UI/Utils/Clipboard";
import Toast from "../../../../UI/Utils/Toast";
import { ClipboardCopyStatus } from "../../../../UI/Utils/UseClipboardCopy";
import Log from "../../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../../Types/Log/LogSeverity";
import ObjectID from "../../../../Types/ObjectID";
import TimeRange from "../../../../Types/Time/TimeRange";

const FIRST_ID: string = "0192f1a0-0000-7000-8000-000000000001";
const SECOND_ID: string = "0192f1a0-0000-7000-8000-000000000002";
const SERVICE_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const LOGS_PAGE: string =
  "https://oneuptime.example.com/dashboard/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/logs";

function makeLog(id: string, body: string): Log {
  const log: Log = new Log();
  log.body = body;
  log.time = new Date("2026-10-27T06:45:12.345Z");
  log.severityText = LogSeverity.Warning;
  log.primaryEntityId = SERVICE_ID;
  log.setColumnValue("_id", id);

  return log;
}

// The app's link to a line, as the Dashboard builds one: the Logs page naming it.
function linkTo(log: Log): string | null {
  const id: string = log.getColumnValue("_id")?.toString() || "";

  return id
    ? `${LOGS_PAGE}?log=${id}&logTime=2026-10-27T06%3A45%3A12.345Z`
    : null;
}

let copy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  getListMock.mockReset();
  postMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 });
  postMock.mockResolvedValue({ data: { before: [], after: [] } });
  copy = jest
    .spyOn(Clipboard, "copyToClipboard")
    .mockResolvedValue(true as never);
});

afterEach(() => {
  act(() => {
    Toast.dismissAll();
  });
  cleanup();
  jest.restoreAllMocks();
});

function renderTable(data: {
  logs?: Array<Log>;
  getLogLink?: ((log: Log) => string | null) | undefined;
  onRowClick?: ((log: Log, rowId: string) => void) | undefined;
  selectedColumns?: Array<string> | undefined;
}): { rerender: (logs: Array<Log>) => void } {
  const logs: Array<Log> = data.logs || [
    makeLog(FIRST_ID, "GET /admin 403"),
    makeLog(SECOND_ID, "GET /etc/passwd 404"),
  ];
  const element: (rows: Array<Log>) => React.ReactElement = (
    rows: Array<Log>,
  ): React.ReactElement => {
    return (
      <>
        <LogsTable
          logs={rows}
          serviceMap={{}}
          isLoading={false}
          onRowClick={data.onRowClick || jest.fn()}
          getLogLink={data.getLogLink}
          selectedColumns={data.selectedColumns}
        />
        <ToastRegion />
      </>
    );
  };
  const result: ReturnType<typeof render> = render(element(logs));

  return {
    rerender: (rows: Array<Log>): void => {
      result.rerender(element(rows));
    },
  };
}

function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest("tr") as HTMLElement;
}

function rowLink(text: string): HTMLElement {
  return within(rowOf(text)).getByTestId(COPY_LOG_ROW_LINK_TEST_ID);
}

describe("Copy Link on a log row", () => {
  test("is a button named Copy Link, beside the row's Copy log message, in the row's actions", () => {
    renderTable({ getLogLink: linkTo });

    const row: HTMLElement = rowOf("GET /admin 403");
    const actions: HTMLElement = within(row).getByTestId(
      LOGS_TABLE_ROW_ACTIONS_TEST_ID,
    );
    const buttons: Array<HTMLElement> = within(actions).getAllByRole("button");

    expect(COPY_LOG_LINE_LINK).toBe("Copy Link");
    expect(
      buttons.map((button: HTMLElement): string => {
        return button.getAttribute("aria-label") || "";
      }),
    ).toEqual(["Copy log message", "Copy Link"]);

    const button: HTMLElement = rowLink("GET /admin 403");

    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAccessibleName("Copy Link");
    expect(button).toHaveAttribute("title", "Copy Link");
    // Every row has its own.
    expect(screen.getAllByTestId(COPY_LOG_ROW_LINK_TEST_ID)).toHaveLength(2);
  });

  test("is drawn like Copy log message: the same small box, shown and hidden the same way", () => {
    renderTable({ getLogLink: linkTo });

    const link: HTMLElement = rowLink("GET /admin 403");
    const message: HTMLElement = within(rowOf("GET /admin 403")).getByRole(
      "button",
      { name: "Copy log message" },
    );

    const box: Array<string> = getCopyTextButtonClassName({
      size: "xs",
      variant: "ghost",
      status: ClipboardCopyStatus.Idle,
    }).split(" ");

    for (const className of [
      ...box,
      ...LOGS_TABLE_ROW_ACTION_CLASS_NAME.split(" "),
    ]) {
      expect(link).toHaveClass(className);
      expect(message).toHaveClass(className);
    }

    expect(link.parentElement).toHaveClass(
      ...LOGS_TABLE_ROW_ACTIONS_CLASS_NAME.split(" "),
    );
  });

  /*
   * Two actions take more of the row than one did: beside the whole cell
   * they pushed a trace's id and its span's onto two lines at 1440px. They
   * sit beside the message's line alone, and the ids under it keep the
   * cell's whole width.
   */
  test("sits beside the message's line: the trace and span under it keep the cell's width", () => {
    const log: Log = makeLog(FIRST_ID, "GET /admin 403");
    log.traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    log.spanId = "00f067aa0ba902b7";

    renderTable({ logs: [log], getLogLink: linkTo });

    const actions: HTMLElement = screen.getByTestId(
      LOGS_TABLE_ROW_ACTIONS_TEST_ID,
    );
    const messageLine: HTMLElement = actions.parentElement!;

    expect(messageLine).toHaveTextContent("GET /admin 403");
    expect(messageLine).not.toHaveTextContent("Trace:");
    expect(messageLine.parentElement).toHaveTextContent(
      "Trace: 4bf92f3577b34da6a3ce929d0e0e4736",
    );
    expect(messageLine.parentElement!.closest("td")).toBe(
      messageLine.closest("td"),
    );
  });

  test("shows on a screen with no pointer to hover, a finger's size, with room between", () => {
    const classes: Array<string> = LOGS_TABLE_ROW_ACTION_CLASS_NAME.split(" ");

    // Under the pointer, or the keyboard's focus in the row: as before.
    expect(classes).toEqual(
      expect.arrayContaining([
        "opacity-0",
        "group-hover:opacity-100",
        "group-focus-within:opacity-100",
        "focus-visible:opacity-100",
        // A phone or a tablet: always, since nothing would reveal it.
        "[@media(hover:none)]:opacity-100",
        // 32px across under a finger.
        "[@media(pointer:coarse)]:min-h-8",
        "[@media(pointer:coarse)]:min-w-8",
      ]),
    );
    expect(LOGS_TABLE_ROW_ACTIONS_CLASS_NAME.split(" ")).toContain(
      "[@media(pointer:coarse)]:gap-2",
    );
  });

  test("a click copies the link its details copy, says Link copied where a screen reader hears it, and leaves the row closed", async () => {
    const onRowClick: MockFunction = getJestMockFunction();
    const getLogLink: MockFunction = getJestMockFunction();
    getLogLink.mockImplementation((log: unknown) => {
      return linkTo(log as Log);
    });

    renderTable({
      getLogLink: getLogLink as never,
      onRowClick: onRowClick as never,
    });

    const user: UserEvent = userEvent.setup({ delay: null });
    const calls: number = getLogLink.mock.calls.length;

    await user.click(rowLink("GET /etc/passwd 404"));

    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith(
      `${LOGS_PAGE}?log=${SECOND_ID}&logTime=2026-10-27T06%3A45%3A12.345Z`,
    );
    // Built as it is pressed, for the row it is pressed on.
    expect(getLogLink.mock.calls.length).toBe(calls + 1);
    expect(
      (getLogLink.mock.calls[calls]![0] as Log)
        .getColumnValue("_id")
        ?.toString(),
    ).toBe(SECOND_ID);

    const status: HTMLElement = screen.getByTestId("toast-region-status");

    expect(status).toHaveAttribute("role", "status");
    expect(
      await within(status).findByText(LOG_LINE_LINK_COPIED),
    ).toBeInTheDocument();
    // A press on the row's own action is not a press on the row.
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test("turns to a tick for a moment once the link is on the clipboard, for the eye", async () => {
    renderTable({ getLogLink: linkTo });

    const button: HTMLElement = rowLink("GET /admin 403");

    expect(button).toHaveAttribute("data-copy-state", ClipboardCopyStatus.Idle);

    await userEvent.setup({ delay: null }).click(button);

    await waitFor(() => {
      expect(rowLink("GET /admin 403")).toHaveAttribute(
        "data-copy-state",
        ClipboardCopyStatus.Copied,
      );
    });
    // The toast says it; the tick says nothing a screen reader hears twice.
    expect(
      within(rowLink("GET /admin 403")).queryByText(LOG_LINE_LINK_COPIED),
    ).toBeNull();
  });

  test("a copy the browser refuses says so, never Link copied, and shows the link to copy by hand", async () => {
    copy.mockResolvedValue(false as never);

    renderTable({ getLogLink: linkTo });

    await userEvent.setup({ delay: null }).click(rowLink("GET /admin 403"));

    const errors: HTMLElement = screen.getByTestId("toast-region-errors");

    expect(
      await within(errors).findByText(LOG_LINE_LINK_NOT_COPIED),
    ).toBeInTheDocument();
    expect(screen.queryByText(LOG_LINE_LINK_COPIED)).toBeNull();

    const field: HTMLInputElement = within(errors).getByTestId(
      LOG_LINE_LINK_FIELD_TEST_ID,
    ) as HTMLInputElement;

    expect(field).toHaveValue(linkTo(makeLog(FIRST_ID, "x")));
    expect(field).toHaveAccessibleName(LOG_LINE_LINK_COPY_BY_HAND);
    expect(rowLink("GET /admin 403")).toHaveAttribute(
      "data-copy-state",
      ClipboardCopyStatus.Failed,
    );
  });

  test("from the keyboard: Tab reaches it right after Copy log message, and Enter or Space presses it", async () => {
    renderTable({ getLogLink: linkTo });

    const user: UserEvent = userEvent.setup({ delay: null });
    const message: HTMLElement = within(rowOf("GET /admin 403")).getByRole(
      "button",
      { name: "Copy log message" },
    );
    const link: HTMLElement = rowLink("GET /admin 403");

    while (document.activeElement !== message) {
      await user.tab();

      if (document.activeElement === document.body) {
        break;
      }
    }

    expect(message).toHaveFocus();

    await user.tab();

    expect(link).toHaveFocus();
    // Its row is the group whose focus shows it.
    expect(link.closest("tr")).toHaveClass("group");

    await user.keyboard("{Enter}");
    expect(copy).toHaveBeenCalledTimes(1);

    await user.keyboard(" ");
    expect(copy).toHaveBeenCalledTimes(2);
  });

  test("is not drawn where the viewer gives no link, nor for a line the link cannot name", () => {
    renderTable({ getLogLink: undefined });

    expect(screen.queryByTestId(COPY_LOG_ROW_LINK_TEST_ID)).toBeNull();
    // Copy log message stays, as it always was.
    expect(
      within(rowOf("GET /admin 403")).getByRole("button", {
        name: "Copy log message",
      }),
    ).toBeInTheDocument();

    cleanup();

    renderTable({
      getLogLink: (log: Log): string | null => {
        return log.getColumnValue("_id")?.toString() === FIRST_ID
          ? null
          : linkTo(log);
      },
    });

    expect(
      within(rowOf("GET /admin 403")).queryByTestId(COPY_LOG_ROW_LINK_TEST_ID),
    ).toBeNull();
    expect(rowLink("GET /etc/passwd 404")).toBeInTheDocument();
  });

  test("a list drawn again as the keyboard moves builds no row's link again", () => {
    const getLogLink: MockFunction = getJestMockFunction();
    getLogLink.mockImplementation((log: unknown) => {
      return linkTo(log as Log);
    });
    const logs: Array<Log> = [
      makeLog(FIRST_ID, "GET /admin 403"),
      makeLog(SECOND_ID, "GET /etc/passwd 404"),
    ];

    const table: { rerender: (logs: Array<Log>) => void } = renderTable({
      logs,
      getLogLink: getLogLink as never,
    });
    const drawn: number = getLogLink.mock.calls.length;

    expect(drawn).toBe(2);

    table.rerender(logs);
    table.rerender(logs);

    expect(getLogLink.mock.calls.length).toBe(drawn);
  });

  test("holds no control inside another: the row is no control, and the actions sit side by side", () => {
    renderTable({ getLogLink: linkTo });

    const row: HTMLElement = rowOf("GET /admin 403");

    expect(row).not.toHaveAttribute("role", "button");
    expect(row).not.toHaveAttribute("tabindex");

    for (const button of within(
      within(row).getByTestId(LOGS_TABLE_ROW_ACTIONS_TEST_ID),
    ).getAllByRole("button")) {
      expect(button.querySelector("button, a, input, [role='button']")).toBe(
        null,
      );
      expect(button.parentElement!.closest("button, a, [role='button']")).toBe(
        null,
      );
    }
  });
});

describe("Copy Link on a row of the logs explorer", () => {
  // The list scrolls the row under the keyboard into view, which jsdom does not draw.
  beforeEach(() => {
    Element.prototype.scrollIntoView = jest.fn() as never;
  });

  function renderExplorer(logs: Array<Log>): void {
    render(
      <>
        <LogsViewer
          logs={logs}
          isLoading={false}
          filterData={{}}
          onFilterChanged={jest.fn()}
          showFilters={true}
          page={1}
          pageSize={100}
          totalCount={logs.length}
          hasMore={false}
          onPageChange={jest.fn()}
          onPageSizeChange={jest.fn()}
          timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
          getLogLink={linkTo}
        />
        <ToastRegion />
      </>,
    );
  }

  test("copies the very link the row's details copy", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });

    renderExplorer([
      makeLog(FIRST_ID, "GET /admin 403"),
      makeLog(SECOND_ID, "GET /etc/passwd 404"),
    ]);
    await screen.findByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);

    await user.click(rowLink("GET /etc/passwd 404"));

    // Not opened by the press.
    expect(screen.queryByTestId(COPY_LOG_LINE_LINK_TEST_ID)).toBeNull();

    fireEvent.click(screen.getByText("GET /etc/passwd 404"));

    await user.click(await screen.findByTestId(COPY_LOG_LINE_LINK_TEST_ID));

    expect(copy).toHaveBeenCalledTimes(2);
    expect(copy.mock.calls[0]![0]).toBe(copy.mock.calls[1]![0]);
    expect(copy.mock.calls[0]![0]).toContain(`log=${SECOND_ID}`);
  });

  test("Enter on it presses it, and opens no row", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });

    renderExplorer([makeLog(FIRST_ID, "GET /admin 403")]);
    await screen.findByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);

    // j: the list's own focus on the row, which Enter would open.
    await user.keyboard("j");

    act(() => {
      rowLink("GET /admin 403").focus();
    });
    await user.keyboard("{Enter}");

    expect(copy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(COPY_LOG_LINE_LINK_TEST_ID)).toBeNull();
  });

  test("l copies the link of the row the keyboard is on, as its Copy Link does", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });

    renderExplorer([
      makeLog(FIRST_ID, "GET /admin 403"),
      makeLog(SECOND_ID, "GET /etc/passwd 404"),
    ]);
    await screen.findByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);

    await user.keyboard("j");
    await user.keyboard("j");
    await user.keyboard("l");

    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith(linkTo(makeLog(SECOND_ID, "x")));
    expect(
      await within(screen.getByTestId("toast-region-status")).findByText(
        LOG_LINE_LINK_COPIED,
      ),
    ).toBeInTheDocument();
    // The row stays closed.
    expect(screen.queryByTestId(COPY_LOG_LINE_LINK_TEST_ID)).toBeNull();
  });

  test("l with no row under the keyboard copies the open row's link", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });

    renderExplorer([
      makeLog(FIRST_ID, "GET /admin 403"),
      makeLog(SECOND_ID, "GET /etc/passwd 404"),
    ]);
    await screen.findByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);

    fireEvent.click(screen.getByText("GET /etc/passwd 404"));
    await screen.findByTestId(COPY_LOG_LINE_LINK_TEST_ID);

    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await user.keyboard("l");

    expect(copy).toHaveBeenCalledWith(linkTo(makeLog(SECOND_ID, "x")));
  });

  test("l does nothing with no row to copy, with a modifier, or while typing", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });

    renderExplorer([makeLog(FIRST_ID, "GET /admin 403")]);
    await screen.findByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);

    // No row under the keyboard, none open.
    await user.keyboard("l");
    expect(copy).not.toHaveBeenCalled();

    await user.keyboard("j");

    // Ctrl+L and ⌘L stay the browser's: its address bar.
    await user.keyboard("{Control>}l{/Control}");
    await user.keyboard("{Meta>}l{/Meta}");
    await user.keyboard("{Alt>}l{/Alt}");
    expect(copy).not.toHaveBeenCalled();

    // An l typed in the search is a letter of the search.
    const search: HTMLElement = screen.getAllByRole("textbox")[0]!;
    act(() => {
      search.focus();
    });
    await user.keyboard("l");
    expect(copy).not.toHaveBeenCalled();
  });

  test("the shortcuts panel lists l, after Enter", () => {
    const anchor: HTMLButtonElement = document.createElement("button");
    document.body.appendChild(anchor);

    render(
      <KeyboardShortcutsHelp
        anchorRef={{ current: anchor }}
        onClose={jest.fn()}
      />,
    );

    const panel: HTMLElement = screen.getByTestId(
      KEYBOARD_SHORTCUTS_HELP_TEST_ID,
    );
    const said: string = panel.textContent || "";
    const line: HTMLElement = within(panel).getByText(
      "Copy link to selected log",
    );

    expect(said.indexOf("Expand / collapse selected log")).toBeLessThan(
      said.indexOf("Copy link to selected log"),
    );
    expect(said.indexOf("Copy link to selected log")).toBeLessThan(
      said.indexOf("Close detail panel"),
    );
    // Its key beside it, drawn as a key cap is (j and k are drawn J and K).
    expect(
      within(line.parentElement!).getByText("L", { selector: "kbd" }),
    ).toBeInTheDocument();

    anchor.remove();
  });
});

describe("the line a row shortcut acts on", () => {
  const logs: Array<Log> = [
    makeLog(FIRST_ID, "GET /admin 403"),
    makeLog(SECOND_ID, "GET /etc/passwd 404"),
  ];

  test("is the row the keyboard is on, first", () => {
    expect(
      getShortcutLog({
        logs,
        focusedRowIndex: 1,
        selectedLogId: resolveLogIdentifier(logs[0]!, 0),
      }),
    ).toBe(logs[1]);
  });

  test("else the open row, else none", () => {
    expect(
      getShortcutLog({
        logs,
        focusedRowIndex: -1,
        selectedLogId: resolveLogIdentifier(logs[0]!, 0),
      }),
    ).toBe(logs[0]);
    expect(
      getShortcutLog({ logs, focusedRowIndex: -1, selectedLogId: null }),
    ).toBeUndefined();
    // A row the list no longer has.
    expect(
      getShortcutLog({ logs, focusedRowIndex: 5, selectedLogId: "gone" }),
    ).toBeUndefined();
  });
});

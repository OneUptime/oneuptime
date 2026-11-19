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
 * Copy Link, for one log line (#9794): a row's details and the line a link
 * opened above the list both copy the address that opens that very line.
 * Tab reaches it, Enter and Space press it, and what happened is said in a
 * toast a screen reader hears: "Link copied" only once the link is on the
 * clipboard, and otherwise that it could not be, with the link to copy by
 * hand. Enter on it presses it and nothing else: it never also opens or
 * closes the row the list's own focus is on.
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
  isPressableControl,
} from "../../../../UI/Components/LogsViewer/LogsViewer";
import LogDetailsPanel from "../../../../UI/Components/LogsViewer/components/LogDetailsPanel";
import {
  COPY_LOG_LINE_LINK,
  COPY_LOG_LINE_LINK_TEST_ID,
  LOG_LINE_LINK_COPIED,
  LOG_LINE_LINK_COPY_BY_HAND,
  LOG_LINE_LINK_FIELD_TEST_ID,
  LOG_LINE_LINK_NOT_COPIED,
} from "../../../../UI/Components/LogsViewer/components/CopyLogLineLinkButton";
import { OPENED_LOG_LINE_TEST_ID } from "../../../../UI/Components/LogsViewer/components/OpenedLogLine";
import { LOGS_VIEWER_TOOLBAR_TEST_ID } from "../../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import ToastRegion from "../../../../UI/Components/Toast/ToastRegion";
import Clipboard from "../../../../UI/Utils/Clipboard";
import Toast from "../../../../UI/Utils/Toast";
import Log from "../../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../../Types/Log/LogSeverity";
import ObjectID from "../../../../Types/ObjectID";
import TimeRange from "../../../../Types/Time/TimeRange";

const LOG_ID: string = "0192f1a0-0000-7000-8000-000000000001";
const SERVICE_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const LINK: string = `https://oneuptime.example.com/dashboard/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/logs?log=${LOG_ID}&logTime=2026-10-27T06%3A45%3A12.345Z`;

function makeLog(id: string = LOG_ID, body: string = "GET /admin 403"): Log {
  const log: Log = new Log();
  log.body = body;
  log.time = new Date("2026-10-27T06:45:12.345Z");
  log.severityText = LogSeverity.Warning;
  log.primaryEntityId = SERVICE_ID;
  log.setColumnValue("_id", id);

  return log;
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

function renderPanel(
  getLogLink?: ((log: Log) => string | null) | undefined,
): UserEvent {
  render(
    <>
      <LogDetailsPanel
        log={makeLog()}
        serviceMap={{}}
        onClose={jest.fn()}
        getLogLink={getLogLink}
      />
      <ToastRegion />
    </>,
  );

  return userEvent.setup({ delay: null });
}

describe("Copy Link on a line's details", () => {
  test("is a button named Copy Link, beside the panel's Close", () => {
    renderPanel(() => {
      return LINK;
    });

    const button: HTMLElement = screen.getByTestId(COPY_LOG_LINE_LINK_TEST_ID);

    expect(COPY_LOG_LINE_LINK).toBe("Copy Link");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAccessibleName("Copy Link");
    expect(screen.getByTitle("Close details")).toBeInTheDocument();
  });

  test("is not offered for a line the app cannot link to, or with no link to build", () => {
    renderPanel(() => {
      return null;
    });
    expect(screen.queryByTestId(COPY_LOG_LINE_LINK_TEST_ID)).toBeNull();

    cleanup();
    renderPanel(undefined);
    expect(screen.queryByTestId(COPY_LOG_LINE_LINK_TEST_ID)).toBeNull();
  });

  test("builds the link for the line it shows", () => {
    const getLogLink: MockFunction = getJestMockFunction();
    getLogLink.mockReturnValue(LINK);

    renderPanel(getLogLink as never);

    const log: Log = getLogLink.mock.calls[0]![0] as Log;

    expect(log.getColumnValue("_id")?.toString()).toBe(LOG_ID);
  });

  test("a click copies the link, and a toast a screen reader hears says so", async () => {
    const user: UserEvent = renderPanel(() => {
      return LINK;
    });

    await user.click(screen.getByTestId(COPY_LOG_LINE_LINK_TEST_ID));

    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith(LINK);

    // The polite region: read when the reader is free.
    const status: HTMLElement = screen.getByTestId("toast-region-status");

    expect(status).toHaveAttribute("role", "status");
    expect(
      await within(status).findByText(LOG_LINE_LINK_COPIED),
    ).toBeInTheDocument();
    expect(LOG_LINE_LINK_COPIED).toBe("Link copied");
  });

  test("from the keyboard: Tab reaches it, and Enter or Space presses it", async () => {
    const user: UserEvent = renderPanel(() => {
      return LINK;
    });

    // Tab from the top of the panel: Copy Link comes before Close.
    await user.tab();

    expect(screen.getByTestId(COPY_LOG_LINE_LINK_TEST_ID)).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(copy).toHaveBeenCalledTimes(1);

    await user.keyboard(" ");
    expect(copy).toHaveBeenCalledTimes(2);
    expect(copy).toHaveBeenLastCalledWith(LINK);
  });

  test("a copy the browser refuses says so, never Link copied, and shows the link to copy by hand", async () => {
    copy.mockResolvedValue(false as never);

    const user: UserEvent = renderPanel(() => {
      return LINK;
    });

    await user.click(screen.getByTestId(COPY_LOG_LINE_LINK_TEST_ID));

    // The assertive region: an error is read at once, and stays.
    const errors: HTMLElement = screen.getByTestId("toast-region-errors");

    expect(errors).toHaveAttribute("role", "alert");
    expect(
      await within(errors).findByText(LOG_LINE_LINK_NOT_COPIED),
    ).toBeInTheDocument();
    expect(screen.queryByText(LOG_LINE_LINK_COPIED)).toBeNull();

    const field: HTMLInputElement = within(errors).getByTestId(
      LOG_LINE_LINK_FIELD_TEST_ID,
    ) as HTMLInputElement;

    expect(field).toHaveValue(LINK);
    expect(field).toHaveAttribute("readonly");
    expect(field).toHaveAccessibleName(LOG_LINE_LINK_COPY_BY_HAND);

    // Taking the focus, it is selected whole, to copy with the keyboard.
    act(() => {
      field.focus();
    });

    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(LINK.length);
  });
});

describe("Copy Link in the logs explorer", () => {
  function renderExplorer(data: {
    logs: Array<Log>;
    openedLog?: Log | undefined;
  }): void {
    render(
      <>
        <LogsViewer
          logs={data.logs}
          isLoading={false}
          filterData={{}}
          onFilterChanged={jest.fn()}
          showFilters={true}
          page={1}
          pageSize={100}
          totalCount={data.logs.length}
          hasMore={false}
          onPageChange={jest.fn()}
          onPageSizeChange={jest.fn()}
          timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
          getLogLink={(log: Log): string => {
            return `${LINK.split("?")[0]}?log=${log.getColumnValue("_id")?.toString()}`;
          }}
          openedLog={
            data.openedLog
              ? {
                  log: data.openedLog,
                  isLoading: false,
                  isNotFound: false,
                  error: "",
                  onClose: jest.fn(),
                  onRetry: jest.fn(),
                }
              : undefined
          }
        />
        <ToastRegion />
      </>,
    );
  }

  test("an opened row's details copy the link to that row's line", async () => {
    const second: string = "0192f1a0-0000-7000-8000-000000000002";

    renderExplorer({ logs: [makeLog(), makeLog(second, "GET /etc/passwd")] });
    await screen.findByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);

    fireEvent.click(screen.getByText("GET /etc/passwd"));

    const button: HTMLElement = await screen.findByTestId(
      COPY_LOG_LINE_LINK_TEST_ID,
    );

    await userEvent.setup({ delay: null }).click(button);

    expect(copy).toHaveBeenCalledWith(`${LINK.split("?")[0]}?log=${second}`);
  });

  test("the line a link opened above the list has Copy Link too", async () => {
    renderExplorer({ logs: [], openedLog: makeLog() });
    await screen.findByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);

    const opened: HTMLElement = screen.getByTestId(OPENED_LOG_LINE_TEST_ID);

    await userEvent
      .setup({ delay: null })
      .click(within(opened).getByTestId(COPY_LOG_LINE_LINK_TEST_ID));

    expect(copy).toHaveBeenCalledWith(`${LINK.split("?")[0]}?log=${LOG_ID}`);
  });

  /*
   * Regression: the list's Enter (open or close the row its j/k focus is
   * on) also ran on Enter pressed on a button, so Copy Link on an opened
   * row copied the link and closed the row it was pressed in.
   */
  test("Enter on Copy Link presses it, and leaves the opened row open", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });

    renderExplorer({ logs: [makeLog()] });
    await screen.findByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);

    // j to the row, Enter to open it: as the keyboard shortcuts say.
    await user.keyboard("j");
    await user.keyboard("{Enter}");

    const button: HTMLElement = await screen.findByTestId(
      COPY_LOG_LINE_LINK_TEST_ID,
    );

    act(() => {
      button.focus();
    });
    await user.keyboard("{Enter}");

    expect(copy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(
        screen.getByTestId(COPY_LOG_LINE_LINK_TEST_ID),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId(COPY_LOG_LINE_LINK_TEST_ID)).toHaveFocus();
  });

  test("what Enter presses by itself: a button, a link, a control drawn as one - not a row's text", () => {
    const button: HTMLButtonElement = document.createElement("button");
    const link: HTMLAnchorElement = document.createElement("a");
    const grip: HTMLDivElement = document.createElement("div");
    const icon: HTMLSpanElement = document.createElement("span");
    const text: HTMLParagraphElement = document.createElement("p");

    link.href = "https://oneuptime.example.com";
    grip.setAttribute("role", "button");
    button.appendChild(icon);

    expect(isPressableControl(button)).toBe(true);
    expect(isPressableControl(link)).toBe(true);
    expect(isPressableControl(grip)).toBe(true);
    expect(isPressableControl(icon)).toBe(true);
    expect(isPressableControl(text)).toBe(false);
    expect(isPressableControl(document.body)).toBe(false);
    expect(isPressableControl(null)).toBe(false);
  });
});

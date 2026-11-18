import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "Create monitor" in the logs explorer's toolbar: a monitor watching what
 * the explorer shows. The shared logs viewer draws the button only for a
 * host that hands it a way to create one (the Dashboard's Logs page and a
 * service's Logs tab, for a reader who may create monitors) - every other
 * logs view (an incident's, an embedded one) shows no such button.
 */

const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
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

getListMock.mockImplementation(() => {
  return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
});

postMock.mockImplementation(() => {
  return Promise.resolve({ data: {} });
});

import LogsViewer from "../../../UI/Components/LogsViewer/LogsViewer";
import {
  LOGS_VIEWER_DISPLAY_CONTROLS_CLASS_NAME,
  LOGS_VIEWER_DISPLAY_CONTROLS_TEST_ID,
  LOGS_VIEWER_TOOLBAR_CLASS_NAME,
  LOGS_VIEWER_TOOLBAR_TEST_ID,
} from "../../../UI/Components/LogsViewer/components/LogsViewerToolbar";

async function renderViewer(
  props: Partial<React.ComponentProps<typeof LogsViewer>> = {},
): Promise<void> {
  render(
    <LogsViewer
      logs={[]}
      isLoading={false}
      filterData={{}}
      onFilterChanged={jest.fn()}
      showFilters={true}
      viewMode="list"
      onViewModeChange={jest.fn()}
      selectedColumns={["time", "severity", "body"]}
      onSelectedColumnsChange={jest.fn()}
      liveOptions={{ isLive: false, onToggle: jest.fn() }}
      {...props}
    />,
  );

  await screen.findByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);
}

afterEach(() => {
  cleanup();
});

describe("Create monitor in the logs explorer's toolbar", () => {
  test("is offered to a host that can create a monitor, in the toolbar", async () => {
    const onCreateMonitor: MockFunction = getJestMockFunction();

    await renderViewer({
      onCreateMonitor: () => {
        onCreateMonitor();
      },
    });

    const button: HTMLElement = screen.getByTestId("logs-create-monitor");

    expect(button).toHaveTextContent("Create monitor");
    expect(button).toHaveAttribute("type", "button");
    expect(screen.getByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID)).toContainElement(
      button,
    );

    fireEvent.click(button);

    expect(onCreateMonitor).toHaveBeenCalledTimes(1);
  });

  /*
   * #9455: from md up until the toolbar was 77rem wide, its words were
   * hidden and the bell alone stood for it, named only by its tooltip - a
   * service's Logs tab drew it so at 1280px, and a newcomer found it by
   * hovering. Its words now show at every width, and the row makes room for
   * them by wrapping: the display controls take a row of their own, whole.
   */
  test("says Create monitor in words at every width, with no class that hides them", async () => {
    await renderViewer({
      onCreateMonitor: () => {},
    });

    const button: HTMLElement = screen.getByRole("button", {
      name: "Create monitor",
    });
    const label: HTMLElement = screen.getByTestId("logs-create-monitor-label");

    expect(button).toBe(screen.getByTestId("logs-create-monitor"));
    expect(button).toContainElement(label);
    expect(label).toHaveTextContent("Create monitor");
    // Its name is its words: nothing but them names it.
    expect(button).not.toHaveAttribute("aria-label");

    // No width, the window's or the toolbar's, hides them.
    expect(label.getAttribute("class") || "").toBe("");
    expect(
      button.className.split(/\s+/).filter((token: string): boolean => {
        return token === "hidden" || token.endsWith(":hidden");
      }),
    ).toEqual([]);
  });

  test("the row makes room by wrapping: the display controls go onto a row of their own, at its end from md up", async () => {
    await renderViewer({
      onCreateMonitor: () => {},
    });

    const toolbar: HTMLElement = screen.getByTestId(
      LOGS_VIEWER_TOOLBAR_TEST_ID,
    );
    const displayControls: HTMLElement = screen.getByTestId(
      LOGS_VIEWER_DISPLAY_CONTROLS_TEST_ID,
    );

    expect(toolbar).toHaveClass(...LOGS_VIEWER_TOOLBAR_CLASS_NAME.split(" "));
    expect(LOGS_VIEWER_TOOLBAR_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["flex", "flex-wrap", "justify-between"]),
    );
    // Held to one row from md up, each group broke into ragged lines.
    expect(toolbar.className).not.toContain("nowrap");
    // Nothing in it asks how wide it is any more.
    expect(toolbar.className).not.toContain("container-type");

    expect(displayControls).toBe(toolbar.lastElementChild);
    expect(displayControls).toContainElement(
      screen.getByTestId("logs-create-monitor"),
    );
    expect(displayControls).toHaveClass(
      ...LOGS_VIEWER_DISPLAY_CONTROLS_CLASS_NAME.split(" "),
    );
    expect(LOGS_VIEWER_DISPLAY_CONTROLS_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["md:ms-auto", "md:justify-end", "min-w-0"]),
    );
  });

  test("its tooltip says what the monitor will watch", async () => {
    await renderViewer({
      onCreateMonitor: () => {},
    });

    fireEvent.mouseEnter(screen.getByTestId("logs-create-monitor"));

    expect(
      await screen.findByText(
        "Create monitor: get alerted about logs like these.",
      ),
    ).toBeInTheDocument();
  });

  test("is not drawn for any other logs view", async () => {
    await renderViewer();

    expect(screen.queryByTestId("logs-create-monitor")).not.toBeInTheDocument();
    expect(screen.queryByText("Create monitor")).not.toBeInTheDocument();
  });
});

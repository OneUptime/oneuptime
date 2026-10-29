import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "Create monitor" in the logs explorer's toolbar: a monitor watching what
 * the explorer shows. The shared logs viewer draws the button only for a
 * host that hands it a way to create one (the Dashboard's Logs page, for a
 * reader who may create monitors) - every other logs view (a service's
 * logs, an incident's, an embedded one) shows no such button.
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
  LOGS_VIEWER_CREATE_MONITOR_LABEL_CLASS_NAME,
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

  test("is named Create monitor even where only its bell shows, and says so when hovered", async () => {
    await renderViewer({
      onCreateMonitor: () => {},
    });

    const toolbar: HTMLElement = screen.getByTestId(
      LOGS_VIEWER_TOOLBAR_TEST_ID,
    );
    const button: HTMLElement = screen.getByRole("button", {
      name: "Create monitor",
    });
    const label: HTMLElement = screen.getByTestId("logs-create-monitor-label");

    expect(button).toBe(screen.getByTestId("logs-create-monitor"));
    expect(button).toContainElement(label);

    /*
     * Its words on a phone (the toolbar wraps there) and on a toolbar of
     * 77rem and more, the toolbar being the container; the bell alone
     * between the two, so a 1280px window keeps the row on one line.
     */
    expect(toolbar.className).toContain("[container-type:inline-size]");
    expect(label.className).toBe(LOGS_VIEWER_CREATE_MONITOR_LABEL_CLASS_NAME);
    expect(LOGS_VIEWER_CREATE_MONITOR_LABEL_CLASS_NAME.split(" ")).toEqual([
      "md:hidden",
      "[@container(min-width:77rem)]:inline",
    ]);

    // The tooltip names it, for whoever sees only the bell.
    fireEvent.mouseEnter(button);

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

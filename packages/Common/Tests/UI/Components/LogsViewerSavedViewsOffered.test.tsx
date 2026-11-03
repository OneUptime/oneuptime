import { LogsSavedViewOption } from "../../../UI/Components/LogsViewer/types";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A Logs viewer offers saved views only where they belong (issue #5549).
 *
 * The Dashboard's viewer hands this container the saved views of its own
 * page - the Logs page's, or one resource's Logs tab's - and hands it none
 * at all (`savedViews` undefined) on a panel about one moment: an incident's
 * or an alert's logs, a trace's, an exception's. Its handlers are passed
 * either way, so it is the list alone that decides. These pin what the
 * container draws for each:
 *
 * - no list: no Saved Views control in the toolbar and no section in the
 *   sidebar, so nothing on the panel offers a view from somewhere else;
 * - an empty list (a page nobody saved a view on yet): the control is there,
 *   to save the first one, and the sidebar has nothing to list;
 * - a list: the control and the sidebar both offer the page's views.
 */

/*
 * Declared before jest.mock but dereferenced inside the factories: ts-jest
 * hoists the jest.mock calls above these initializers.
 */
const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
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

jest.mock("../../../UI/Utils/API/API", () => {
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

getListMock.mockImplementation(() => {
  return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
});

postMock.mockImplementation(() => {
  return Promise.resolve({ data: {} });
});

// Imported after the mock so the container picks the mocked ModelAPI up.
import LogsViewer from "../../../UI/Components/LogsViewer/LogsViewer";

const CLUSTER_VIEWS: Array<LogsSavedViewOption> = [
  { id: "payments", name: "Payments namespace", isDefault: true },
  { id: "ingress", name: "Ingress errors" },
];

// Every control named Saved Views: the toolbar's, and the sidebar section's.
function savedViewsControls(): Array<HTMLElement> {
  return screen.queryAllByRole("button", { name: /Saved Views/ });
}

async function renderViewer(
  savedViews: Array<LogsSavedViewOption> | undefined,
): Promise<void> {
  render(
    <LogsViewer
      logs={[]}
      isLoading={false}
      filterData={{}}
      onFilterChanged={jest.fn()}
      facetData={{}}
      showFilters={true}
      savedViews={savedViews}
      selectedSavedViewId={null}
      onSavedViewSelect={jest.fn()}
      onClearSavedView={jest.fn()}
      onCreateSavedView={jest.fn()}
      onEditSavedView={jest.fn()}
      onDeleteSavedView={jest.fn()}
      onUpdateCurrentSavedView={jest.fn()}
    />,
  );

  // The container renders a loader until its service lookup resolves.
  await waitFor(() => {
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });
}

describe("LogsViewer offers saved views only where it is handed some", () => {
  afterEach(() => {
    cleanup();
  });

  test("a panel handed no saved views shows no Saved Views control and no saved-view section", async () => {
    await renderViewer(undefined);

    expect(savedViewsControls()).toHaveLength(0);
    expect(screen.queryByText("Saved Views")).not.toBeInTheDocument();
    expect(screen.queryByText("+ Save Current View")).not.toBeInTheDocument();
  });

  test("a page with no saved views yet still offers to save the first one", async () => {
    await renderViewer([]);

    // The toolbar's control only: the sidebar has nothing to list.
    expect(savedViewsControls()).toHaveLength(1);
    expect(screen.queryByText("Payments namespace")).not.toBeInTheDocument();
  });

  test("a page with saved views offers them in the toolbar and the sidebar", async () => {
    await renderViewer(CLUSTER_VIEWS);

    // The toolbar's control, and the sidebar's section beside it.
    expect(savedViewsControls().length).toBeGreaterThan(1);
    // The sidebar lists the page's views as soon as the viewer renders.
    expect(
      screen.getAllByRole("button", { name: /Payments namespace/ }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /Ingress errors/ }).length,
    ).toBeGreaterThan(0);
  });
});

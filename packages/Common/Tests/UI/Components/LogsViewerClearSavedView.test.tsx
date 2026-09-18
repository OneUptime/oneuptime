import { LogsSavedViewOption } from "../../../UI/Components/LogsViewer/types";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * LogsViewer is the container between the logs explorer and the two places a
 * saved view can be picked — the toolbar dropdown and the facet sidebar. Both
 * of those are covered directly in LogsSavedViewsDropdown.test.tsx, and the
 * host's clearSavedView is covered in App/Tests/Dashboard. This file is the
 * middle link: the passthrough that connects them.
 *
 * It is worth its own file because that link is invisible when it breaks.
 * Deleting `onClearSavedView: props.onClearSavedView` from the toolbar props
 * object leaves the dropdown rendering, the host handler defined, every other
 * test green — and the "Clear view" row simply never appears again, which is
 * the original bug back in place.
 *
 * The container loads services and log attributes on mount, so both API
 * surfaces are mocked out; nothing here depends on what they return beyond
 * their resolving.
 */

/*
 * Declared before jest.mock but dereferenced inside the factories: ts-jest
 * hoists the jest.mock calls above these initializers, so naming the mocks
 * directly in a factory would capture undefined.
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

const VIEWS: Array<LogsSavedViewOption> = [
  { id: "errors", name: "Errors only" },
  { id: "checkout", name: "Checkout service", isDefault: true },
];

const CLEAR_LABEL: string = "Clear view";

interface RenderedViewer {
  onClearSavedView: () => void;
  onSavedViewSelect: (viewId: string) => void;
}

async function renderViewer(
  withClearHandler: boolean,
): Promise<RenderedViewer> {
  const onClearSavedView: () => void = jest.fn();
  const onSavedViewSelect: (viewId: string) => void = jest.fn();

  render(
    <LogsViewer
      logs={[]}
      isLoading={false}
      filterData={{}}
      onFilterChanged={jest.fn()}
      facetData={{}}
      savedViews={VIEWS}
      selectedSavedViewId="errors"
      onSavedViewSelect={onSavedViewSelect}
      {...(withClearHandler ? { onClearSavedView: onClearSavedView } : {})}
    />,
  );

  // The container renders a loader until its service lookup resolves.
  await waitFor(() => {
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });

  return {
    onClearSavedView: onClearSavedView,
    onSavedViewSelect: onSavedViewSelect,
  };
}

function savedViewButtons(): Array<HTMLElement> {
  return screen.getAllByRole("button", { name: /Errors only/ });
}

describe("LogsViewer forwards the clear handler to both saved-view surfaces", () => {
  afterEach(() => {
    cleanup();
  });

  test("the toolbar dropdown offers Clear view and it reaches the host", async () => {
    const { onClearSavedView, onSavedViewSelect } = await renderViewer(true);

    /*
     * The sidebar lists the view too, so the trigger is picked by its
     * dropdown, not by name alone: the toolbar's trigger is the one that
     * opens a panel containing the clear row.
     */
    for (const button of savedViewButtons()) {
      fireEvent.click(button);
    }

    const clearRow: HTMLElement = screen.getByRole("button", {
      name: CLEAR_LABEL,
    });

    fireEvent.click(clearRow);

    expect(onClearSavedView).toHaveBeenCalled();
    expect(onSavedViewSelect).not.toHaveBeenCalled();
  });

  test("the facet sidebar's applied row toggles off through the same handler", async () => {
    const { onClearSavedView, onSavedViewSelect } = await renderViewer(true);

    /*
     * The sidebar's entry is a plain row rather than a dropdown trigger, so
     * clicking it is the clear. It is the first of the two matches because
     * the sidebar renders before the table column.
     */
    fireEvent.click(savedViewButtons()[0]!);

    expect(onClearSavedView).toHaveBeenCalled();
    expect(onSavedViewSelect).not.toHaveBeenCalled();
  });

  test("a host that passes no clear handler still gets the old behaviour", async () => {
    const { onClearSavedView, onSavedViewSelect } = await renderViewer(false);

    fireEvent.click(savedViewButtons()[0]!);

    expect(screen.queryByText(CLEAR_LABEL)).toBeNull();
    expect(onClearSavedView).not.toHaveBeenCalled();
    expect(onSavedViewSelect).toHaveBeenCalledWith("errors");
  });
});

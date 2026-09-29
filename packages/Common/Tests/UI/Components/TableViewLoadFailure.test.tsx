import { describe, expect, jest, test, beforeEach } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The saved-views control is mounted by every ModelTable in the dashboard that
 * passes a tableId - around 180 of them - and it fetches the user's saved views
 * on mount, before anybody has gone looking for one.
 *
 * In issue #3305 that fetch was refused for a member whose team granted only
 * "Monitor Viewer", and the component answered by rendering a ConfirmModal
 * titled "Something went wrong..." over the page. A control nobody had touched
 * took down the table it was sitting on, on every list in the product.
 *
 * The permission list that caused it is fixed. What is pinned here is the
 * blast radius: a failed list load costs the control and nothing else, while a
 * failure from an action the user actually took still gets a dialog.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

/*
 * Both halves of the hook. ConfirmModal calls `translateValue`, and a mock that
 * omits it makes the modal throw on render - which would let the assertion
 * below pass for the wrong reason against a component that still shows it.
 */
jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so naming the mocks directly would capture them before their
 * initializers have run.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      deleteItem: () => {
        return Promise.resolve();
      },
    },
  };
});

const projectId: string = "e6c4b9a0-1a2b-4c3d-8e5f-6a7b8c9d0e1f";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return {
          toString: () => {
            return projectId;
          },
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return {
          toString: () => {
            return "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f";
          },
        };
      },
      isMasterAdmin: (): boolean => {
        return false;
      },
    },
  };
});

import TableViewElement from "../../../UI/Components/ModelTable/TableView";
import Monitor from "../../../Models/DatabaseModels/Monitor";

const PERMISSION_ERROR: string =
  "You do not have permissions to read Table View. You need one of these permissions: Project Owner, Project Admin, Project Member, Viewer, Read Table View";

type RenderControlFunction = (options?: {
  hasSavableState?: boolean;
}) => ReactElement;

const renderControl: RenderControlFunction = (options?: {
  hasSavableState?: boolean;
}): ReactElement => {
  return (
    <TableViewElement<Monitor>
      tableId="all-monitors-table"
      onViewChange={() => {
        // the parent's business, not this test's
      }}
      currentQuery={
        options?.hasSavableState ? ({ isDisabled: true } as any) : ({} as any)
      }
      currentSortOrder={null}
      currentSortBy={null}
      currentItemsOnPage={10}
      tableView={null}
    />
  );
};

describe("Saved views when the list cannot be loaded", () => {
  beforeEach(() => {
    getListMock.mockReset();
  });

  /*
   * Waiting for the message to land before asserting is the load-bearing part.
   * The list request is issued during mount, so a test that only waits for the
   * call to have happened runs its assertions before the rejection is handled,
   * and passes against a component that goes on to render the modal a tick
   * later.
   */
  test("a refused list does not put a dialog over the page", async () => {
    getListMock.mockRejectedValue(new Error(PERMISSION_ERROR) as never);

    render(renderControl({ hasSavableState: true }));

    fireEvent.click(await screen.findByText("Saved Views"));

    await waitFor(() => {
      expect(screen.getByText(PERMISSION_ERROR)).toBeInTheDocument();
    });

    /*
     * The exact dialog the user in #3305 got, on every table they opened.
     */
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Something went wrong..."),
    ).not.toBeInTheDocument();

    // And the control it belongs to is still on the page.
    expect(screen.getByText("Saved Views")).toBeInTheDocument();
  });

  /*
   * The failure is not swallowed either - it is moved inside the control it
   * belongs to, so somebody who opens the menu is told why it is empty.
   */
  test("the reason is kept, inside the control", async () => {
    getListMock.mockRejectedValue(new Error(PERMISSION_ERROR) as never);

    render(renderControl({ hasSavableState: true }));

    // The menu renders its contents only once opened.
    fireEvent.click(await screen.findByText("Saved Views"));

    await waitFor(() => {
      expect(screen.getByText(PERMISSION_ERROR)).toBeInTheDocument();
    });

    expect(screen.getByText(PERMISSION_ERROR)).toBeInTheDocument();
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  /*
   * A user with nothing to save and no views to show never learns anything
   * went wrong, because there was nothing to offer them either way.
   */
  test("nothing renders at all when there was nothing to offer", async () => {
    getListMock.mockRejectedValue(new Error(PERMISSION_ERROR) as never);

    const { container } = render(renderControl({ hasSavableState: false }));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  test("a successful load still lists the views", async () => {
    getListMock.mockResolvedValue({
      data: [
        {
          name: "My view",
          id: {
            toString: () => {
              return "view-1";
            },
          },
        },
      ],
      count: 1,
      skip: 0,
      limit: 10,
    } as never);

    render(renderControl({ hasSavableState: true }));

    await waitFor(() => {
      expect(screen.getByText("Saved Views")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Saved Views"));

    await waitFor(() => {
      expect(screen.getByText("My view")).toBeInTheDocument();
    });

    expect(
      screen.queryByText("Something went wrong..."),
    ).not.toBeInTheDocument();
  });
});

import "@testing-library/jest-dom";
import {
  afterEach,
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
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The exceptions list's saved views through the real saved-views control
 * and ModelFormModal on the list's own table (ExceptionSavedView), with the
 * network stubbed and the menu reduced to its buttons: the project's views
 * listed, Save storing the list's state, the project's default view and a
 * view a link names opening the list, picking one, and Clear view. What the
 * list does with each is ExceptionsSavedViews.test.
 */

const PROJECT_ID_STRING: string = "00000000-0000-4000-8000-0000000000e1";
const CHECKOUT_ID: string = "00000000-0000-4000-8000-0000000000c1";
const TRIAGE_ID: string = "00000000-0000-4000-8000-0000000000c2";

const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: async (): Promise<Record<string, unknown>> => {
        return {};
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

// Every column permission the form checks, so every field is drawn.
jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: (): null => {
        return null;
      },
      isMasterAdmin: (): boolean => {
        return true;
      },
    },
  };
});

interface SavedViewsMenuProps {
  savedViews: Array<{ id: string; name: string; isDefault: boolean }>;
  selectedSavedViewId?: string | null | undefined;
  onSelect: (viewId: string) => void;
  onClear?: (() => void) | undefined;
  onCreate?: (() => void) | undefined;
}

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/SavedViewsDropdown",
  () => {
    return {
      __esModule: true,
      default: (props: SavedViewsMenuProps): ReactElement => {
        return (
          <div>
            {props.savedViews.map(
              (view: { id: string; name: string }): ReactElement => {
                return (
                  <button
                    key={view.id}
                    type="button"
                    onClick={() => {
                      props.onSelect(view.id);
                    }}
                  >
                    {`Open ${view.name}`}
                  </button>
                );
              },
            )}
            <span data-testid="selected-view">
              {props.selectedSavedViewId || "none"}
            </span>
            <button type="button" onClick={props.onClear}>
              Clear view
            </button>
            <button type="button" onClick={props.onCreate}>
              Save current view
            </button>
          </div>
        );
      },
    };
  },
);

import TelemetrySavedViewsControl from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl";
import { buildExceptionsUrlScopeOverrides } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionSavedView";
import { ExceptionListSort } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionAssignment";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ExceptionSavedView from "../../../Models/DatabaseModels/ExceptionSavedView";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TelemetrySavedViewState from "../../../Types/Telemetry/TelemetrySavedViewState";
import TimeRange from "../../../Types/Time/TimeRange";
import ProjectUtil from "../../../UI/Utils/Project";

const LIST_NOW: TelemetrySavedViewState = {
  search: "type:TypeError",
  filters: [["resource.service.name", "checkout"]],
  timeRange: { range: TimeRange.PAST_ONE_WEEK },
  pageSize: 50,
  exceptionStatus: "archived",
  exceptionClassScope: "all",
  exceptionAssignedToMe: true,
  exceptionSort: "most-events",
};

const CHECKOUT_QUERY: TelemetrySavedViewState = {
  search: "",
  filters: [["resource.service.name", "checkout"]],
  timeRange: { range: TimeRange.PAST_ONE_WEEK },
  pageSize: 25,
  exceptionStatus: "resolved",
  exceptionClassScope: "issues",
  exceptionAssignedToMe: false,
  exceptionSort: "first-seen",
};

const TRIAGE_QUERY: TelemetrySavedViewState = {
  search: "",
  filters: [],
  timeRange: { range: TimeRange.PAST_ONE_DAY },
  pageSize: 25,
  exceptionStatus: "unresolved",
  exceptionClassScope: "issues",
  exceptionAssignedToMe: true,
  exceptionSort: "last-seen",
};

function savedView(
  id: string,
  name: string,
  query: TelemetrySavedViewState,
  isDefault: boolean,
): ExceptionSavedView {
  const view: ExceptionSavedView = new ExceptionSavedView();
  view.id = new ObjectID(id);
  view.name = name;
  view.query = query;
  view.isDefault = isDefault;
  return view;
}

const applyStateMock: MockFunction = getJestMockFunction();
const onSelectionChangeMock: MockFunction = getJestMockFunction();

async function mount(props: {
  hasInitialUrlState?: boolean;
  initialSavedViewId?: string | null;
  initialStateOverrides?: Partial<TelemetrySavedViewState> | undefined;
}): Promise<void> {
  // Inside act: the control lists the project's saved views as it mounts.
  await act(async (): Promise<void> => {
    render(
      <TelemetrySavedViewsControl<ExceptionSavedView>
        modelType={ExceptionSavedView}
        savedViewNoun="Exception"
        explorerLabel="exceptions"
        hasInitialUrlState={Boolean(props.hasInitialUrlState)}
        initialSavedViewId={props.initialSavedViewId}
        initialStateOverrides={props.initialStateOverrides}
        onSelectionChange={(id: string | null): void => {
          onSelectionChangeMock(id);
        }}
        captureCurrentState={(): TelemetrySavedViewState => {
          return LIST_NOW;
        }}
        applyState={(state: TelemetrySavedViewState): void => {
          applyStateMock(state);
        }}
      />,
    );
  });
}

function applied(): Array<TelemetrySavedViewState> {
  return applyStateMock.mock.calls.map(
    (call: Array<unknown>): TelemetrySavedViewState => {
      return call[0] as TelemetrySavedViewState;
    },
  );
}

beforeEach(() => {
  getListMock.mockReset();
  createOrUpdateMock.mockReset();
  applyStateMock.mockReset();
  onSelectionChangeMock.mockReset();

  getListMock.mockImplementation(async () => {
    return {
      data: [
        savedView(CHECKOUT_ID, "Checkout", CHECKOUT_QUERY, false),
        savedView(TRIAGE_ID, "My triage", TRIAGE_QUERY, true),
      ],
      count: 2,
      skip: 0,
      limit: 100,
    };
  });

  createOrUpdateMock.mockImplementation(async (data: unknown) => {
    const model: ExceptionSavedView = (data as { model: ExceptionSavedView })
      .model;
    model.id = new ObjectID("00000000-0000-4000-8000-0000000000c3");
    return { data: model };
  });

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID_STRING));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the exceptions list's saved views, through the control", () => {
  test("are the project's views of the list's own table", async () => {
    await mount({ hasInitialUrlState: true });

    expect(getListMock).toHaveBeenCalledTimes(1);
    const args: { modelType: unknown; query: Record<string, unknown> } =
      getListMock.mock.calls[0]![0] as {
        modelType: unknown;
        query: Record<string, unknown>;
      };
    expect(args.modelType).toBe(ExceptionSavedView);
    expect(String(args.query["projectId"])).toBe(PROJECT_ID_STRING);
  });

  test("the project's default view opens a bare list, as saved", async () => {
    await mount({ hasInitialUrlState: false });

    await waitFor(() => {
      expect(applied()).toEqual([TRIAGE_QUERY]);
    });
    expect(screen.getByTestId("selected-view")).toHaveTextContent(TRIAGE_ID);
    expect(onSelectionChangeMock).toHaveBeenLastCalledWith(TRIAGE_ID);
  });

  test("a list opened somewhere of its own is left there", async () => {
    await mount({ hasInitialUrlState: true });

    expect(applied()).toEqual([]);
    expect(screen.getByTestId("selected-view")).toHaveTextContent("none");
  });

  test("a view a link names opens under what else the link said", async () => {
    const overrides: Partial<TelemetrySavedViewState> | undefined =
      buildExceptionsUrlScopeOverrides({
        search: "",
        filters: [],
        timeRange: { range: TimeRange.PAST_TWO_DAYS },
        hasRange: true,
        status: "archived",
        classScope: null,
        assignedToMe: false,
        sort: ExceptionListSort.LastSeen,
      });

    await mount({
      hasInitialUrlState: true,
      initialSavedViewId: CHECKOUT_ID,
      initialStateOverrides: overrides,
    });

    await waitFor(() => {
      expect(applied()).toEqual([
        {
          ...CHECKOUT_QUERY,
          timeRange: { range: TimeRange.PAST_TWO_DAYS },
          exceptionStatus: "archived",
        },
      ]);
    });
    expect(screen.getByTestId("selected-view")).toHaveTextContent(CHECKOUT_ID);
  });

  test("a link naming a view that is gone stops naming it", async () => {
    await mount({
      hasInitialUrlState: true,
      initialSavedViewId: "00000000-0000-4000-8000-0000000000ff",
    });

    await waitFor(() => {
      expect(onSelectionChangeMock).toHaveBeenCalledWith(null);
    });
    expect(applied()).toEqual([]);
  });

  test("picking a view applies it, and Clear view applies the empty state", async () => {
    await mount({ hasInitialUrlState: true });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Checkout" }));
    });
    expect(applied()).toEqual([CHECKOUT_QUERY]);
    expect(onSelectionChangeMock).toHaveBeenLastCalledWith(CHECKOUT_ID);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear view" }));
    });
    expect(applied()).toEqual([CHECKOUT_QUERY, {}]);
    expect(onSelectionChangeMock).toHaveBeenLastCalledWith(null);
  });

  test("Save stores the list as it is on an exception view, and picks it", async () => {
    await mount({ hasInitialUrlState: true });

    await act(async (): Promise<void> => {
      fireEvent.click(
        await screen.findByRole("button", { name: "Save current view" }),
      );
    });

    // The form names the list it saves.
    expect(
      await screen.findByText(
        "Save the current exceptions explorer state as a reusable view.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(await screen.findByPlaceholderText("Errors in checkout"), {
      target: { value: "Checkout regressions" },
    });

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Save View" }));
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: ExceptionSavedView = (
      createOrUpdateMock.mock.calls[0]![0] as { model: ExceptionSavedView }
    ).model;
    expect(model).toBeInstanceOf(ExceptionSavedView);

    const sent: JSONObject = BaseModel.toJSONObject(model, ExceptionSavedView);
    expect(sent["name"]).toBe("Checkout regressions");
    expect(sent["query"]).toEqual(LIST_NOW);
    // Unticked, the service decides whether it is the default.
    expect(sent).not.toHaveProperty("isDefault");

    // The view just saved is the one picked.
    await waitFor(() => {
      expect(applied()).toEqual([LIST_NOW]);
    });
  });
});

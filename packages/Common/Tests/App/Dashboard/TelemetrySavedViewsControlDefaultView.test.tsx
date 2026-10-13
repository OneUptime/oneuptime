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
 * A new saved view asks to be its project's default only when "Set as
 * default" is ticked; otherwise it says nothing, and the service makes a
 * project's first saved view its default (LogSavedViewService and the
 * Metric and Trace ones decide when the create leaves isDefault out).
 *
 * A Create form now starts a checkbox on its column's off and sends it
 * (BasicFormFalsyDefaults). Sent as is, that off would say "not the
 * default", and a project's first saved view would no longer open by
 * default: the form leaves it out instead
 * (leaveSavedViewDefaultOutUnlessTicked).
 *
 * Through the real control, ModelFormModal, ModelForm and BasicForm, with
 * the network stubbed and the saved views menu reduced to its Save button.
 */

const PROJECT_ID_STRING: string = "00000000-0000-4000-8000-0000000000a1";

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
  onCreate: () => void;
}

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/SavedViewsDropdown",
  () => {
    return {
      __esModule: true,
      default: (props: SavedViewsMenuProps): ReactElement => {
        return (
          <button type="button" onClick={props.onCreate}>
            Save current view
          </button>
        );
      },
    };
  },
);

import TelemetrySavedViewsControl from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MetricSavedView from "../../../Models/DatabaseModels/MetricSavedView";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TelemetrySavedViewState from "../../../Types/Telemetry/TelemetrySavedViewState";
import ProjectUtil from "../../../UI/Utils/Project";

beforeEach(() => {
  getListMock.mockReset();
  createOrUpdateMock.mockReset();

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });

  createOrUpdateMock.mockImplementation(async (data: unknown) => {
    return { data: (data as { model: MetricSavedView }).model };
  });

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID_STRING));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openSaveForm(): Promise<void> {
  // Inside act: the control lists the project's saved views as it mounts.
  await act(async (): Promise<void> => {
    render(
      <TelemetrySavedViewsControl<MetricSavedView>
        modelType={MetricSavedView}
        savedViewNoun="Metric"
        explorerLabel="metrics"
        hasInitialUrlState={false}
        captureCurrentState={(): TelemetrySavedViewState => {
          return { search: "checkout" };
        }}
        applyState={(): void => {
          // Not asserted on.
        }}
      />,
    );
  });

  await act(async (): Promise<void> => {
    fireEvent.click(
      await screen.findByRole("button", { name: "Save current view" }),
    );
  });

  fireEvent.change(await screen.findByPlaceholderText("Errors in checkout"), {
    target: { value: "Checkout errors" },
  });
}

function defaultCheckbox(): HTMLElement {
  return screen.getByRole("checkbox", { name: /Set as default/ });
}

// What the API is asked to create, as it sends it to the server.
async function save(): Promise<JSONObject> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Save View" }));
  });

  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });

  const model: MetricSavedView = (
    createOrUpdateMock.mock.calls[0]![0] as { model: MetricSavedView }
  ).model;

  return BaseModel.toJSONObject(model, MetricSavedView);
}

describe("saving a new metrics view", () => {
  test("left unticked, it does not say whether it is the default - the service decides", async () => {
    await openSaveForm();

    expect(defaultCheckbox()).not.toBeChecked();

    const sent: JSONObject = await save();

    expect(sent["name"]).toBe("Checkout errors");
    expect(sent).not.toHaveProperty("isDefault");
  });

  test("ticked, it asks to be the default", async () => {
    await openSaveForm();

    fireEvent.click(defaultCheckbox());
    expect(defaultCheckbox()).toBeChecked();

    const sent: JSONObject = await save();

    expect(sent["isDefault"]).toBe(true);
  });

  test("ticked and unticked again, it says nothing either", async () => {
    await openSaveForm();

    fireEvent.click(defaultCheckbox());
    fireEvent.click(defaultCheckbox());
    expect(defaultCheckbox()).not.toBeChecked();

    const sent: JSONObject = await save();

    expect(sent).not.toHaveProperty("isDefault");
  });
});

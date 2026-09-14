import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { act } from "react";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import DashboardTextComponentUtil from "../../../Utils/Dashboard/Components/DashboardTextComponent";

/*
 * "Discard Changes" on a dashboard has to put the board back exactly as the
 * server has it, and dashboard variables were the one part of it that survived
 * the discard.
 *
 * The restore lived behind `if (config.variables)`. A dashboard that had never
 * saved a variable therefore hit no branch at all on discard: a variable added
 * in edit mode stayed in React state, kept its selector on the toolbar, kept
 * being handed to every widget as a filter, kept its `var-` param in the URL,
 * and — because the Variables modal seeds itself from the live list — came
 * back the next time the modal was opened. Only a page reload cleared it, and
 * in the meantime the board was scoped by a variable that did not exist
 * server-side.
 *
 * These tests drive the real DashboardViewer against a fake dashboard API, so
 * they assert what a person actually ends up with after the discard: what the
 * canvas is filtered by, what the toolbar renders, what the URL says, and what
 * the Variables modal shows when it is opened again.
 *
 * The canvas is stubbed — it is ~60 widget implementations deep and none of
 * them are under test here — but it publishes the `variables` prop it received
 * so the runtime list is directly observable.
 */

/*
 * Mounting the real DashboardViewer costs a few hundred milliseconds of module
 * work per test on an idle machine and several seconds on a loaded CI box. The
 * default 5s budget is a machine-speed check, not an assertion about the code.
 */
jest.setTimeout(120000);

const DASHBOARD_ID: string = "22222222-2222-4222-8222-222222222222";

/**
 * The fake server's copy of the dashboard. `updateById` writes to it and
 * `getItem` reads from it, so a save followed by a re-fetch behaves the way
 * the real API does.
 */
const serverState: { dashboardViewConfig: JSONObject | null } = {
  dashboardViewConfig: null,
};

const getItemMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;
const updateByIdMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

/*
 * Editing the board is permission-gated (issue #3550), so the toolbar only
 * offers "Edit Dashboard" to somebody who may write to it. These tests are
 * about variables, not permissions, so they run as a user who can edit.
 */
jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      /*
       * Permission.ProjectAdmin - a literal, because a jest.mock factory is
       * hoisted above the imports and cannot close over the enum.
       */
      getAllPermissions: (): Array<string> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (err: Error) => {
        return err.message;
      },
      getFriendlyMessage: (err: Error) => {
        return err.message;
      },
    },
  };
});

/*
 * The attribute values the telemetry-backed selector offers. Fixed here so a
 * <select> in the toolbar has real options to choose between.
 */
const ATTRIBUTE_VALUE: string = "prod";

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryAttributes: [] });
        },
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve(["prod", "staging"]);
        },
      },
    };
  },
);

/*
 * The canvas stub. It renders nothing visible and publishes the variable names
 * it was handed on a data attribute, so asserting on it never collides with
 * the same name rendered by the toolbar selector.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index",
  () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;
    return {
      __esModule: true,
      default: (props: {
        variables?: Array<DashboardVariable> | undefined;
      }) => {
        return reactModule.createElement("div", {
          "data-testid": "canvas-stub",
          "data-variable-names": (props.variables || [])
            .map((variable: DashboardVariable) => {
              return variable.name;
            })
            .join(","),
          "data-variable-selections": (props.variables || [])
            .map((variable: DashboardVariable) => {
              return `${variable.name}=${
                variable.selectedValues
                  ? variable.selectedValues.join("|")
                  : variable.selectedValue || ""
              }`;
            })
            .join(","),
        });
      },
    };
  },
);

import DashboardViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView";

type MakeVariableFunction = (
  data: Partial<DashboardVariable>,
) => DashboardVariable;

const makeVariable: MakeVariableFunction = (
  data: Partial<DashboardVariable>,
): DashboardVariable => {
  return {
    id: data.id || `var-id-${data.name || "unnamed"}`,
    name: data.name || "cluster",
    type: data.type || DashboardVariableType.TelemetryAttribute,
    attributeKey: data.attributeKey || "k8s.cluster.name",
    ...data,
  };
};

type MakeConfigFunction = (
  variables?: Array<DashboardVariable> | undefined,
) => DashboardViewConfig;

/**
 * A saved dashboard with exactly one widget on it. The widget matters: the
 * toolbar only renders variable selectors for a board that has components.
 */
const makeConfig: MakeConfigFunction = (
  variables?: Array<DashboardVariable> | undefined,
): DashboardViewConfig => {
  const config: DashboardViewConfig = {
    _type: ObjectType.DashboardViewConfig,
    components: [DashboardTextComponentUtil.getDefaultComponent()],
    heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
  };

  if (variables) {
    config.variables = variables;
  }

  return config;
};

type SeedServerFunction = (config: DashboardViewConfig) => void;

const seedServer: SeedServerFunction = (config: DashboardViewConfig): void => {
  serverState.dashboardViewConfig = config as unknown as JSONObject;
};

type SetUrlFunction = (search: string) => void;

const setUrl: SetUrlFunction = (search: string): void => {
  window.history.replaceState({}, "", `/dashboard/${DASHBOARD_ID}${search}`);
};

type CurrentVarParamsFunction = () => Record<string, string>;

/** Every `var-*` param currently in the browser URL. */
const currentVarParams: CurrentVarParamsFunction = (): Record<
  string,
  string
> => {
  const params: URLSearchParams = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  params.forEach((value: string, key: string) => {
    if (key.startsWith("var-")) {
      out[key] = value;
    }
  });
  return out;
};

type CanvasVariableNamesFunction = () => Array<string>;

/** The variable names the canvas — i.e. every widget — is scoped by. */
const canvasVariableNames: CanvasVariableNamesFunction = (): Array<string> => {
  const raw: string =
    screen.getByTestId("canvas-stub").getAttribute("data-variable-names") || "";
  return raw === "" ? [] : raw.split(",");
};

type CanvasVariableSelectionsFunction = () => Array<string>;

const canvasVariableSelections: CanvasVariableSelectionsFunction =
  (): Array<string> => {
    const raw: string =
      screen
        .getByTestId("canvas-stub")
        .getAttribute("data-variable-selections") || "";
    return raw === "" ? [] : raw.split(",");
  };

type SettleFunction = () => Promise<void>;

/*
 * Drain the promise chain a fetch kicked off and flush the React updates it
 * schedules. A bare `act` only drains the microtasks queued at the moment it
 * runs, which is not enough for `loadPage` — it awaits `Promise.all` and then
 * sets state, so the updates land several turns later. Awaiting real macrotask
 * turns is what makes that deterministic instead of a race the test wins only
 * on an idle machine.
 */
const settle: SettleFunction = async (): Promise<void> => {
  await act(async () => {
    for (let turn: number = 0; turn < 5; turn++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
};

type RenderDashboardFunction = () => Promise<void>;

const renderDashboard: RenderDashboardFunction = async (): Promise<void> => {
  render(<DashboardViewer dashboardId={new ObjectID(DASHBOARD_ID)} />);
  /*
   * The canvas only mounts once `isLoading` flips false, which happens after
   * the whole load chain — including the variable restore — has run. Waiting
   * for it is therefore the gate for "the dashboard is ready to assert on".
   */
  await waitFor(() => {
    expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
  });
};

type EnterEditModeFunction = () => Promise<void>;

const enterEditMode: EnterEditModeFunction = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText("More dashboard options"));
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Edit Dashboard"));
  });
};

type OpenVariablesModalFunction = () => Promise<void>;

const openVariablesModal: OpenVariablesModalFunction =
  async (): Promise<void> => {
    await act(async () => {
      fireEvent.click(screen.getByTitle("Variables"));
    });
  };

type VariableNameInputsFunction = () => Array<HTMLInputElement>;

/** The Name field of every row in the open Variables modal, in DOM order. */
const variableNameInputs: VariableNameInputsFunction =
  (): Array<HTMLInputElement> => {
    return screen.queryAllByPlaceholderText(
      "cluster",
    ) as Array<HTMLInputElement>;
  };

type AddVariableInModalFunction = (name: string) => Promise<void>;

const addVariableInModal: AddVariableInModalFunction = async (
  name: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByText("Add Variable"));
  });
  const inputs: Array<HTMLInputElement> = variableNameInputs();
  const newRow: HTMLInputElement = inputs[
    inputs.length - 1
  ] as HTMLInputElement;
  await act(async () => {
    fireEvent.change(newRow, { target: { value: name } });
  });
};

type SaveVariablesModalFunction = () => Promise<void>;

const saveVariablesModal: SaveVariablesModalFunction =
  async (): Promise<void> => {
    await act(async () => {
      fireEvent.click(screen.getByText("Save Variables"));
    });
  };

type DiscardEditsFunction = () => Promise<void>;

const discardEdits: DiscardEditsFunction = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTitle("Cancel"));
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Discard Changes"));
  });
  /*
   * `onCancelEditClick` re-fetches and applies the result asynchronously, and
   * nothing visible flips once it lands, so there is no element to wait on.
   */
  await settle();
};

type KeepEditingFunction = () => Promise<void>;

/** Open the cancel confirmation and then back out of it. */
const keepEditing: KeepEditingFunction = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTitle("Cancel"));
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Keep Editing"));
  });
};

type SaveDashboardFunction = () => Promise<void>;

const saveDashboard: SaveDashboardFunction = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByText("Save Changes"));
  });
  await settle();
};

beforeEach(() => {
  serverState.dashboardViewConfig = null;
  setUrl("");

  getItemMock.mockImplementation(() => {
    return Promise.resolve({
      dashboardViewConfig: serverState.dashboardViewConfig,
      name: "Test Dashboard",
      description: "A dashboard",
      pageTitle: null,
      pageDescription: null,
    });
  });

  updateByIdMock.mockImplementation((args: any) => {
    serverState.dashboardViewConfig = args.data
      .dashboardViewConfig as JSONObject;
    return Promise.resolve();
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("DashboardView — discarding edits reconciles dashboard variables", () => {
  describe("a dashboard that saved no variables", () => {
    beforeEach(() => {
      seedServer(makeConfig());
    });

    test("drops a variable that was added and then discarded", async () => {
      await renderDashboard();
      expect(canvasVariableNames()).toEqual([]);

      await enterEditMode();
      await openVariablesModal();
      await addVariableInModal("cluster");
      await saveVariablesModal();

      // The variable is live while the edit is still in progress.
      expect(canvasVariableNames()).toEqual(["cluster"]);

      await discardEdits();

      expect(canvasVariableNames()).toEqual([]);
    });

    test("strips the discarded variable's var- param from the URL", async () => {
      await renderDashboard();
      await enterEditMode();
      await openVariablesModal();
      await addVariableInModal("cluster");
      await saveVariablesModal();
      await discardEdits();

      expect(currentVarParams()).toEqual({});
      expect(window.location.search).not.toContain("var-");
    });

    test("stops rendering a toolbar selector for the discarded variable", async () => {
      await renderDashboard();
      await enterEditMode();
      await openVariablesModal();
      await addVariableInModal("cluster");
      await saveVariablesModal();
      await discardEdits();

      /*
       * Back in view mode the selector's label is the only place the name
       * would appear — the canvas stub keeps it in a data attribute.
       */
      expect(screen.queryByText("cluster")).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    test("does not resurrect the discarded definition when the Variables modal is reopened", async () => {
      await renderDashboard();
      await enterEditMode();
      await openVariablesModal();
      await addVariableInModal("cluster");
      await saveVariablesModal();
      await discardEdits();

      await enterEditMode();
      await openVariablesModal();

      expect(screen.getByText("No variables yet")).toBeInTheDocument();
      expect(variableNameInputs()).toHaveLength(0);
    });

    test("keeps the new variable when the user backs out with Keep Editing", async () => {
      /*
       * The re-fetch has to hang off the confirmation's submit, not off
       * leaving edit mode. If it ever moves to a `dashboardMode` effect,
       * every mode transition would silently discard — and every other
       * test here would still pass.
       */
      await renderDashboard();
      expect(getItemMock).toHaveBeenCalledTimes(1);

      await enterEditMode();
      await openVariablesModal();
      await addVariableInModal("cluster");
      await saveVariablesModal();

      await keepEditing();

      expect(getItemMock).toHaveBeenCalledTimes(1);
      expect(canvasVariableNames()).toEqual(["cluster"]);
      // Still editing: the edit-mode action bar is up.
      expect(screen.getByText("Save Changes")).toBeInTheDocument();
    });

    test("keeps the new variable when the edit is saved rather than discarded", async () => {
      await renderDashboard();
      await enterEditMode();
      await openVariablesModal();
      await addVariableInModal("cluster");
      await saveVariablesModal();
      await saveDashboard();

      expect(updateByIdMock).toHaveBeenCalledTimes(1);
      expect(canvasVariableNames()).toEqual(["cluster"]);

      /*
       * And the save actually persisted the definition: a fresh mount of the
       * same dashboard finds it on the server.
       */
      cleanup();
      await renderDashboard();
      expect(canvasVariableNames()).toEqual(["cluster"]);
    });

    test("clears the runtime list when the saved config has an empty variables array", async () => {
      seedServer(makeConfig([]));

      await renderDashboard();
      await enterEditMode();
      await openVariablesModal();
      await addVariableInModal("cluster");
      await saveVariablesModal();
      await discardEdits();

      expect(canvasVariableNames()).toEqual([]);
    });
  });

  describe("a dashboard that already saved variables", () => {
    beforeEach(() => {
      seedServer(
        makeConfig([makeVariable({ id: "saved-cluster", name: "cluster" })]),
      );
    });

    test("keeps the saved variable and drops only the newly added one", async () => {
      await renderDashboard();
      expect(canvasVariableNames()).toEqual(["cluster"]);

      await enterEditMode();
      await openVariablesModal();
      await addVariableInModal("namespace");
      await saveVariablesModal();
      expect(canvasVariableNames()).toEqual(["cluster", "namespace"]);

      await discardEdits();

      expect(canvasVariableNames()).toEqual(["cluster"]);
    });

    test("strips the discarded variable's var- param while preserving the saved one's selection", async () => {
      setUrl("?var-cluster=prod&team=platform");

      await renderDashboard();
      expect(canvasVariableSelections()).toEqual(["cluster=prod"]);

      await enterEditMode();
      await openVariablesModal();
      await addVariableInModal("namespace");
      await saveVariablesModal();
      await discardEdits();

      expect(currentVarParams()).toEqual({ "var-cluster": "prod" });
      // Query state that has nothing to do with variables is left alone.
      expect(new URLSearchParams(window.location.search).get("team")).toBe(
        "platform",
      );
    });

    test("restores a variable that was deleted in edit mode", async () => {
      await renderDashboard();
      await enterEditMode();
      await openVariablesModal();

      await act(async () => {
        fireEvent.click(screen.getByTitle("Remove variable"));
      });
      await saveVariablesModal();
      expect(canvasVariableNames()).toEqual([]);

      await discardEdits();

      expect(canvasVariableNames()).toEqual(["cluster"]);
    });

    test("restores the saved name after a rename in edit mode", async () => {
      await renderDashboard();
      await enterEditMode();
      await openVariablesModal();

      const nameInput: HTMLInputElement =
        variableNameInputs()[0] as HTMLInputElement;
      await act(async () => {
        fireEvent.change(nameInput, { target: { value: "region" } });
      });
      await saveVariablesModal();
      expect(canvasVariableNames()).toEqual(["region"]);

      await discardEdits();

      expect(canvasVariableNames()).toEqual(["cluster"]);
      expect(currentVarParams()).toEqual({});
    });

    test("strips the URL param a discarded rename left pointing at a variable that no longer exists", async () => {
      /*
       * Renaming a variable carries its selection over to the new name and
       * rewrites the URL to match. Discarding the rename puts the definition
       * back, so the `var-region` param has nothing left to address — leaving
       * it would hand anyone the link a selection for a variable that is not
       * on the dashboard.
       */
      setUrl("?var-cluster=prod");

      await renderDashboard();
      expect(canvasVariableSelections()).toEqual(["cluster=prod"]);

      await enterEditMode();
      await openVariablesModal();
      const nameInput: HTMLInputElement =
        variableNameInputs()[0] as HTMLInputElement;
      await act(async () => {
        fireEvent.change(nameInput, { target: { value: "region" } });
      });
      await saveVariablesModal();
      expect(currentVarParams()).toEqual({ "var-region": "prod" });

      await discardEdits();

      expect(canvasVariableNames()).toEqual(["cluster"]);
      expect(currentVarParams()).toEqual({});
      /*
       * The selection itself does not come back. `var-` params are keyed by
       * name (VariableUrlState.ts:6-9), so the rename moved the only record
       * of it and the discard removed that record. Restoring the definition
       * is the contract; the selection is view state the rename destroyed.
       */
      expect(canvasVariableSelections()).toEqual(["cluster="]);
    });

    test("a selection made in view mode survives an unrelated edit-and-discard cycle", async () => {
      await renderDashboard();

      /*
       * The selector fetches its options, and a <select> silently ignores a
       * change to a value it has no <option> for — so picking before they
       * arrive would assert nothing.
       */
      await screen.findByRole("option", { name: ATTRIBUTE_VALUE });
      await act(async () => {
        fireEvent.change(screen.getByRole("combobox"), {
          target: { value: ATTRIBUTE_VALUE },
        });
      });
      expect(canvasVariableSelections()).toEqual(["cluster=prod"]);

      await enterEditMode();
      await discardEdits();

      expect(canvasVariableNames()).toEqual(["cluster"]);
      expect(canvasVariableSelections()).toEqual(["cluster=prod"]);
      expect(currentVarParams()).toEqual({ "var-cluster": "prod" });
    });
  });

  describe("shared links", () => {
    test("applies a var- selection from the URL to the saved variable on load", async () => {
      seedServer(
        makeConfig([makeVariable({ id: "saved-cluster", name: "cluster" })]),
      );
      setUrl("?var-cluster=staging");

      await renderDashboard();

      expect(canvasVariableSelections()).toEqual(["cluster=staging"]);
      expect(currentVarParams()).toEqual({ "var-cluster": "staging" });
    });

    test("strips a var- param naming a variable the dashboard does not have", async () => {
      seedServer(
        makeConfig([makeVariable({ id: "saved-cluster", name: "cluster" })]),
      );
      setUrl("?var-cluster=prod&var-ghost=whatever");

      await renderDashboard();

      expect(canvasVariableNames()).toEqual(["cluster"]);
      expect(currentVarParams()).toEqual({ "var-cluster": "prod" });
    });

    test("strips every var- param on a dashboard that has no variables at all", async () => {
      seedServer(makeConfig());
      setUrl("?var-ghost=whatever&keep=me");

      await renderDashboard();

      expect(canvasVariableNames()).toEqual([]);
      expect(currentVarParams()).toEqual({});
      expect(new URLSearchParams(window.location.search).get("keep")).toBe(
        "me",
      );
    });
  });
});

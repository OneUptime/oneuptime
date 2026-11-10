import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
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
import React, { ReactElement } from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import type { Mock } from "jest-mock";

/*
 * Status Page > Resources: the Edit resource dialog of a row (issue #6540).
 *
 * Edit opened the monitor picker on every resource - the picker the page's
 * Add Monitor was last left on - so a resource that shows a monitor group
 * opened with an empty Monitor field, and saving it wrote a monitor beside
 * the group. The pane now opens Edit on the picker for what the clicked row
 * shows, with what it shows picked; the form's own link swaps the picker for
 * that form alone, and the Add form's choice stays the page's.
 *
 * Through the real pane, list, modal, ModelForm and EntityDropdown, with the
 * network stubbed and the dashboard's route-aware row elements drawn plain.
 */

const STATUS_PAGE_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194166001";
const PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194166002";

const MONITOR_A_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194166101";
const MONITOR_B_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194166102";
const MONITOR_GROUP_A_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194166201";
const MONITOR_GROUP_B_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194166202";

const MONITOR_ROW_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194166301";
const GROUP_ROW_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194166302";

const MONITOR_NAMES: Array<string> = ["Checkout API", "Billing Worker"];
const MONITOR_GROUP_NAMES: Array<string> = ["Payments Stack", "Search Stack"];

// The status page's resources, as the server stores them.
const ROWS: Array<JSONObject> = [
  {
    _id: MONITOR_ROW_ID,
    displayName: "Checkout API",
    order: 1,
    monitor: { _id: MONITOR_A_ID, name: "Checkout API" },
    showCurrentStatus: true,
    showUptimePercent: false,
    showStatusHistoryChart: true,
  },
  {
    _id: GROUP_ROW_ID,
    displayName: "Payments Stack",
    order: 2,
    monitorGroup: { _id: MONITOR_GROUP_A_ID, name: "Payments Stack" },
    showCurrentStatus: true,
    showUptimePercent: false,
    showStatusHistoryChart: true,
  },
];

interface CapturedSave {
  model: JSONObject;
  formType: unknown;
}

let capturedSaves: Array<CapturedSave> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  type ModelClass = new () => {
    _id?: string | undefined;
    name?: string | undefined;
  };

  const modelOf: (path: string) => ModelClass = (path: string): ModelClass => {
    return (jest.requireActual(path) as { default: ModelClass }).default;
  };

  type NamedListFunction = (
    path: string,
    entries: Array<[string, string]>,
  ) => Array<unknown>;

  const namedList: NamedListFunction = (
    path: string,
    entries: Array<[string, string]>,
  ): Array<unknown> => {
    const Model: ModelClass = modelOf(path);

    return entries.map(([id, name]: [string, string]): unknown => {
      const model: InstanceType<ModelClass> = new Model();
      model._id = id;
      model.name = name;
      return model;
    });
  };

  return {
    __esModule: true,
    default: {
      getList: async (data: {
        modelType: { name?: string };
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        let items: Array<unknown> = [];

        if (data.modelType.name === "StatusPageResource") {
          const StatusPageResourceModel: {
            fromJSON: (json: JSONObject, type: unknown) => unknown;
          } = (
            jest.requireActual(
              "../../../Models/DatabaseModels/StatusPageResource",
            ) as {
              default: {
                fromJSON: (json: JSONObject, type: unknown) => unknown;
              };
            }
          ).default;

          items = ROWS.map((row: JSONObject): unknown => {
            return StatusPageResourceModel.fromJSON(
              row,
              StatusPageResourceModel,
            );
          });
        } else if (data.modelType.name === "MonitorGroup") {
          items = namedList("../../../Models/DatabaseModels/MonitorGroup", [
            [MONITOR_GROUP_A_ID, "Payments Stack"],
            [MONITOR_GROUP_B_ID, "Search Stack"],
          ]);
        } else if (data.modelType.name === "Monitor") {
          items = namedList("../../../Models/DatabaseModels/Monitor", [
            [MONITOR_A_ID, "Checkout API"],
            [MONITOR_B_ID, "Billing Worker"],
          ]);
        }

        return { data: items, count: items.length, skip: 0, limit: 50 };
      },
      getItem: async (data: {
        id: { toString: () => string };
      }): Promise<JSONObject | null> => {
        const row: JSONObject | undefined = ROWS.find(
          (candidate: JSONObject): boolean => {
            return candidate["_id"] === data.id.toString();
          },
        );

        return row ? { ...row } : null;
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: JSONObject;
        formType: unknown;
      }): Promise<{ data: JSONObject }> => {
        capturedSaves.push({ model: data.model, formType: data.formType });
        return { data: data.model };
      },
      updateById: async (): Promise<void> => {
        // Not asserted on.
      },
      deleteItem: async (): Promise<void> => {
        // Not asserted on.
      },
    },
  };
});

/*
 * The dashboard's row elements link into its routes; a row here only has
 * to say what it shows.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Monitor",
  () => {
    return {
      __esModule: true,
      default: (props: { monitor: { name?: string } }): ReactElement => {
        return <span>{props.monitor.name}</span>;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupElement",
  () => {
    return {
      __esModule: true,
      default: (props: { monitorGroup: { name?: string } }): ReactElement => {
        return <span>{props.monitorGroup.name}</span>;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitorsModal",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <></>;
      },
    };
  },
);

import StatusPageResourcePanel from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageResourcePanel";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import { StatusPageResourceSelectionType } from "../../../Utils/StatusPage/ResourceExplorer";

type NoopFunction = () => void;

const noop: NoopFunction = (): void => {
  // Not asserted on.
};

interface RenderPanelOptions {
  isAddingMonitorGroup?: boolean | undefined;
  isMonitorGroupsFeatureEnabled?: boolean | undefined;
  onIsAddingMonitorGroupChange?:
    | ((isAddingMonitorGroup: boolean) => void)
    | undefined;
}

type RenderPanelFunction = (
  options?: RenderPanelOptions,
) => Promise<ReturnType<typeof userEvent.setup>>;

const renderPanel: RenderPanelFunction = async (
  options?: RenderPanelOptions,
): Promise<ReturnType<typeof userEvent.setup>> => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

  await act(async (): Promise<void> => {
    render(
      <StatusPageResourcePanel
        statusPageId={new ObjectID(STATUS_PAGE_ID)}
        projectId={new ObjectID(PROJECT_ID)}
        selection={{
          type: StatusPageResourceSelectionType.Ungrouped,
          statusPageGroupId: null,
        }}
        breadcrumbSteps={[]}
        onBreadcrumbClick={noop}
        subGroups={[]}
        onSelectGroup={noop}
        hasGroups={false}
        isMonitorGroupsFeatureEnabled={
          options?.isMonitorGroupsFeatureEnabled ?? true
        }
        canCreate={true}
        canEdit={true}
        canDelete={true}
        canCreateGroup={false}
        canEditGroup={false}
        canDeleteGroup={false}
        onCreateGroup={noop}
        onEditGroup={noop}
        onAddSubGroup={noop}
        onDeleteGroup={noop}
        canMoveGroupUp={false}
        canMoveGroupDown={false}
        onMoveGroupUp={noop}
        onMoveGroupDown={noop}
        onShowGroupId={noop}
        isAddingMonitorGroup={options?.isAddingMonitorGroup ?? false}
        onIsAddingMonitorGroupChange={
          options?.onIsAddingMonitorGroupChange || noop
        }
        onResourceCountLoaded={noop}
      />,
    );
  });

  await waitFor(() => {
    expect(screen.getAllByTestId("status-page-resource-row")).toHaveLength(2);
  });

  return user;
};

type RowOfFunction = (name: string) => HTMLElement;

// The list row that shows `name`.
const rowOf: RowOfFunction = (name: string): HTMLElement => {
  const row: HTMLElement | undefined = screen
    .getAllByTestId("status-page-resource-row")
    .find((candidate: HTMLElement): boolean => {
      return (
        within(candidate)
          .getByTestId("status-page-resource-row-name")
          .textContent?.trim() === name
      );
    });

  if (!row) {
    throw new Error(`No row shows ${name}`);
  }

  return row;
};

type OpenEditFunction = (
  user: ReturnType<typeof userEvent.setup>,
  rowName: string,
) => Promise<void>;

const openEdit: OpenEditFunction = async (
  user: ReturnType<typeof userEvent.setup>,
  rowName: string,
): Promise<void> => {
  await user.click(
    within(rowOf(rowName)).getByTestId("status-page-resource-row-edit"),
  );

  await screen.findByText("Edit resource");

  await waitFor(() => {
    expect(
      (screen.getByPlaceholderText("Display Name") as HTMLInputElement).value,
    ).toBe(rowName);
  });
};

type ShownValueFunction = (names: Array<string>) => HTMLElement | undefined;

// The value a single-select shows once something is picked: a button.
const shownValue: ShownValueFunction = (
  names: Array<string>,
): HTMLElement | undefined => {
  return screen
    .queryAllByRole("button")
    .find((button: HTMLElement): boolean => {
      return (
        names.includes((button.textContent || "").trim()) &&
        !button.closest("[data-testid='status-page-resource-row']")
      );
    });
};

type ShownPickFunction = (names: Array<string>) => Promise<string>;

const shownPick: ShownPickFunction = async (
  names: Array<string>,
): Promise<string> => {
  return waitFor((): string => {
    const value: HTMLElement | undefined = shownValue(names);
    expect(value).toBeDefined();
    return (value!.textContent || "").trim();
  });
};

type SwitchTextFunction = () => string | null;

const switchText: SwitchTextFunction = (): string | null => {
  return (
    screen.queryByTestId("status-page-resource-target-switch")?.textContent ||
    null
  );
};

describe("Status page resources, Edit resource", () => {
  afterEach(() => {
    cleanup();
    capturedSaves = [];
  });

  // The reported case.
  test("opens a monitor group's row on the monitor group picker, with its group picked", async () => {
    const user: ReturnType<typeof userEvent.setup> = await renderPanel({
      isAddingMonitorGroup: false,
    });

    await openEdit(user, "Payments Stack");

    expect(await shownPick(MONITOR_GROUP_NAMES)).toBe("Payments Stack");
    expect(screen.queryByRole("combobox", { name: "Monitor" })).toBeNull();
    expect(switchText()).toBe("Show a Monitor instead.");
  });

  test("opens a monitor's row on the monitor picker, though Add was left on monitor groups", async () => {
    const user: ReturnType<typeof userEvent.setup> = await renderPanel({
      isAddingMonitorGroup: true,
    });

    await openEdit(user, "Checkout API");

    expect(await shownPick(MONITOR_NAMES)).toBe("Checkout API");
    expect(shownValue(MONITOR_GROUP_NAMES)).toBeUndefined();
    expect(switchText()).toBe("Show a Monitor Group instead.");
  });

  test("saves a monitor group's row with its group, and no monitor", async () => {
    const user: ReturnType<typeof userEvent.setup> = await renderPanel();

    await openEdit(user, "Payments Stack");
    await shownPick(MONITOR_GROUP_NAMES);

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      expect(capturedSaves).toHaveLength(1);
    });

    const saved: Record<string, unknown> = capturedSaves[0]!.model;

    expect(capturedSaves[0]!.formType).toBe(FormType.Update);
    expect(
      (saved["monitorGroup"] as { _id?: unknown } | undefined)?._id?.toString(),
    ).toBe(MONITOR_GROUP_A_ID);
    expect(saved["monitor"]).toBeUndefined();
  });

  /*
   * "Show a Monitor instead." points the resource at a monitor: its name
   * follows the monitor picked, the save sends the monitor alone (the
   * server clears the group), and the page's Add choice is left as it was.
   */
  test("swaps to the monitor picker for this form alone, and points the resource at the monitor picked", async () => {
    const onIsAddingMonitorGroupChange: Mock<
      (isAddingMonitorGroup: boolean) => void
    > = jest.fn<(isAddingMonitorGroup: boolean) => void>();

    const user: ReturnType<typeof userEvent.setup> = await renderPanel({
      onIsAddingMonitorGroupChange: onIsAddingMonitorGroupChange,
    });

    await openEdit(user, "Payments Stack");
    await shownPick(MONITOR_GROUP_NAMES);

    await user.click(screen.getByText("Show a Monitor instead."));

    const monitorPicker: HTMLElement = await screen.findByRole("combobox", {
      name: "Monitor",
    });

    expect(switchText()).toBe("Show a Monitor Group instead.");
    expect(onIsAddingMonitorGroupChange).not.toHaveBeenCalled();

    await user.click(monitorPicker);
    await user.click(
      await screen.findByRole("option", { name: "Billing Worker" }),
    );

    const displayName: HTMLInputElement = screen.getByPlaceholderText(
      "Display Name",
    ) as HTMLInputElement;

    await waitFor(() => {
      expect(displayName.value).toBe("Billing Worker");
    });

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      expect(capturedSaves).toHaveLength(1);
    });

    const saved: Record<string, unknown> = capturedSaves[0]!.model;

    expect(
      (saved["monitor"] as { _id?: unknown } | undefined)?._id?.toString(),
    ).toBe(MONITOR_B_ID);
    expect(saved["monitorGroup"]).toBeUndefined();
    expect(saved["displayName"]).toBe("Billing Worker");
  });

  test("opens the next Edit on what its row shows, whatever the last one was swapped to", async () => {
    const user: ReturnType<typeof userEvent.setup> = await renderPanel();

    await openEdit(user, "Checkout API");
    await shownPick(MONITOR_NAMES);
    await user.click(screen.getByText("Show a Monitor Group instead."));
    await screen.findByText("Show a Monitor instead.");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByText("Edit resource")).toBeNull();
    });

    await openEdit(user, "Checkout API");

    expect(await shownPick(MONITOR_NAMES)).toBe("Checkout API");
    expect(switchText()).toBe("Show a Monitor Group instead.");
  });

  test("offers no swap on a project without monitor groups, and still opens a group's row on its group", async () => {
    const user: ReturnType<typeof userEvent.setup> = await renderPanel({
      isMonitorGroupsFeatureEnabled: false,
    });

    await openEdit(user, "Payments Stack");

    expect(await shownPick(MONITOR_GROUP_NAMES)).toBe("Payments Stack");
    expect(switchText()).toBeNull();
  });
});

describe("Status page resources, Add Monitor", () => {
  afterEach(() => {
    cleanup();
    capturedSaves = [];
  });

  test("opens on the picker the page chose, and its link tells the page", async () => {
    const onIsAddingMonitorGroupChange: Mock<
      (isAddingMonitorGroup: boolean) => void
    > = jest.fn<(isAddingMonitorGroup: boolean) => void>();

    const user: ReturnType<typeof userEvent.setup> = await renderPanel({
      isAddingMonitorGroup: false,
      onIsAddingMonitorGroupChange: onIsAddingMonitorGroupChange,
    });

    await user.click(screen.getByTestId("status-page-resource-panel-add"));

    expect(
      await screen.findByRole("combobox", { name: "Monitor" }),
    ).toBeVisible();
    expect(switchText()).toBe("Add a Monitor Group instead.");

    await user.click(screen.getByText("Add a Monitor Group instead."));

    expect(onIsAddingMonitorGroupChange).toHaveBeenCalledWith(true);
  });

  test("opens on the monitor group picker when the page chose it", async () => {
    const user: ReturnType<typeof userEvent.setup> = await renderPanel({
      isAddingMonitorGroup: true,
    });

    await user.click(screen.getByTestId("status-page-resource-panel-add"));

    expect(
      await screen.findByRole("combobox", { name: "Monitor Group" }),
    ).toBeVisible();
    expect(switchText()).toBe("Add a Monitor instead.");
  });
});

describe("Status page resources, a row's published name", () => {
  afterEach(() => {
    cleanup();
  });

  test("says a monitor group's row repeats its group's name, and a monitor's row its monitor's", async () => {
    await renderPanel();

    expect(
      within(rowOf("Payments Stack")).getByTestId(
        "status-page-resource-row-same-name",
      ),
    ).toHaveTextContent("Same as the monitor group name");

    expect(
      within(rowOf("Checkout API")).getByTestId(
        "status-page-resource-row-same-name",
      ),
    ).toHaveTextContent("Same as the monitor name");
  });
});

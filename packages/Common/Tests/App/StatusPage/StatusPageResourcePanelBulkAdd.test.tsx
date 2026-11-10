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
import React, { ReactElement } from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * Status Page > Resources: where Add Multiple Monitor Groups (issue #6544)
 * is offered.
 *
 * Several monitors could be added in one action from the resource menu's
 * "Add multiple monitors"; a monitor group only one dialog at a time. The
 * menu now has "Add multiple monitor groups" beside it on projects with
 * monitor groups, opening the same dialog on its monitor group picker; an
 * empty group's "Add Multiple" opens on the picker its "Add Monitor" does.
 *
 * Through the real pane and menu, with the network stubbed and the dialog
 * reduced to what it was opened with.
 */

const STATUS_PAGE_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194168001";
const PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194168002";
const STATUS_PAGE_GROUP_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194168003";

// The status page's resources, as the server stores them.
let rows: Array<JSONObject> = [];
let resourceReads: number = 0;

const ONE_ROW: Array<JSONObject> = [
  {
    _id: "0198c8ec-2a1d-7f0c-9e75-384194168101",
    displayName: "Checkout API",
    order: 1,
    monitor: {
      _id: "0198c8ec-2a1d-7f0c-9e75-384194168201",
      name: "Checkout API",
    },
  },
];

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
          resourceReads++;

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

          items = rows.map((row: JSONObject): unknown => {
            return StatusPageResourceModel.fromJSON(
              row,
              StatusPageResourceModel,
            );
          });
        }

        return { data: items, count: items.length, skip: 0, limit: 50 };
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: JSONObject;
      }): Promise<{ data: JSONObject }> => {
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

interface OpenedDialog {
  targetType?: string | undefined;
  canSwitchTarget?: boolean | undefined;
  statusPageGroupId?: { toString: () => string } | undefined;
  gridPlacement?: unknown;
  onClose: () => void;
  onComplete: (result: unknown) => void;
}

// What the bulk add dialog was last drawn with.
let openedDialog: OpenedDialog | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitorsModal",
  () => {
    return {
      __esModule: true,
      default: (props: OpenedDialog): ReactElement => {
        openedDialog = props;

        return (
          <div data-testid="bulk-add-dialog">
            <span data-testid="bulk-add-dialog-target">{props.targetType}</span>
            <button
              type="button"
              onClick={() => {
                props.onComplete({ succeeded: [], failed: [], skipped: [] });
              }}
            >
              Finish bulk add
            </button>
            <button type="button" onClick={props.onClose}>
              Close bulk add
            </button>
          </div>
        );
      },
    };
  },
);

import StatusPageResourcePanel from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageResourcePanel";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupViewMode from "../../../Types/StatusPage/StatusPageGroupViewMode";
import { StatusPageResourceSelectionType } from "../../../Utils/StatusPage/ResourceExplorer";

type NoopFunction = () => void;

const noop: NoopFunction = (): void => {
  // Not asserted on.
};

interface RenderPanelOptions {
  isMonitorGroupsFeatureEnabled?: boolean | undefined;
  isAddingMonitorGroup?: boolean | undefined;
  canCreate?: boolean | undefined;
  statusPageGroup?: StatusPageGroup | undefined;
  // A grid has no empty state: what shows the cells have been drawn.
  waitForText?: string | undefined;
}

type RenderPanelFunction = (options?: RenderPanelOptions) => Promise<void>;

const renderPanel: RenderPanelFunction = async (
  options?: RenderPanelOptions,
): Promise<void> => {
  await act(async (): Promise<void> => {
    render(
      <StatusPageResourcePanel
        statusPageId={new ObjectID(STATUS_PAGE_ID)}
        projectId={new ObjectID(PROJECT_ID)}
        selection={
          options?.statusPageGroup
            ? {
                type: StatusPageResourceSelectionType.Group,
                statusPageGroupId: STATUS_PAGE_GROUP_ID,
              }
            : {
                type: StatusPageResourceSelectionType.Ungrouped,
                statusPageGroupId: null,
              }
        }
        statusPageGroup={options?.statusPageGroup}
        breadcrumbSteps={[]}
        onBreadcrumbClick={noop}
        subGroups={[]}
        onSelectGroup={noop}
        hasGroups={Boolean(options?.statusPageGroup)}
        isMonitorGroupsFeatureEnabled={
          options?.isMonitorGroupsFeatureEnabled ?? true
        }
        canCreate={options?.canCreate ?? true}
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
        onIsAddingMonitorGroupChange={noop}
        onResourceCountLoaded={noop}
      />,
    );
  });

  await waitFor(() => {
    expect(
      options?.waitForText
        ? screen.queryAllByText(options.waitForText)[0] || null
        : screen.queryByTestId("status-page-resource-row") ||
            screen.queryByTestId("status-page-resource-panel-empty"),
    ).toBeInTheDocument();
  });
};

type OpenMenuFunction = () => Promise<Array<string>>;

// Opens the pane's More actions menu, and says what it lists.
const openMenu: OpenMenuFunction = async (): Promise<Array<string>> => {
  fireEvent.click(screen.getByTestId("status-page-resource-panel-more"));

  const menu: HTMLElement = await screen.findByRole("menu");

  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
};

type ClickMenuItemFunction = (text: string) => Promise<void>;

const clickMenuItem: ClickMenuItemFunction = async (
  text: string,
): Promise<void> => {
  await openMenu();

  await act(async (): Promise<void> => {
    fireEvent.click(within(screen.getByRole("menu")).getByText(text));
  });
};

type DialogTargetFunction = () => string | null;

const dialogTarget: DialogTargetFunction = (): string | null => {
  return screen.queryByTestId("bulk-add-dialog-target")?.textContent || null;
};

describe("Status page resources, adding several at once", () => {
  afterEach(() => {
    cleanup();
    rows = [];
    resourceReads = 0;
    openedDialog = null;
  });

  describe("the More actions menu", () => {
    test("offers monitor groups beside monitors on a project with monitor groups", async () => {
      rows = ONE_ROW;
      await renderPanel();

      const items: Array<string> = await openMenu();

      expect(items.slice(0, 2)).toEqual([
        "Add multiple monitors",
        "Add multiple monitor groups",
      ]);
    });

    test("opens the bulk add on monitor groups, with the link to swap to monitors", async () => {
      rows = ONE_ROW;
      await renderPanel();

      expect(screen.queryByTestId("bulk-add-dialog")).toBeNull();

      await clickMenuItem("Add multiple monitor groups");

      expect(screen.getByTestId("bulk-add-dialog")).toBeInTheDocument();
      expect(dialogTarget()).toBe("MonitorGroup");
      expect(openedDialog?.canSwitchTarget).toBe(true);
    });

    test("opens the bulk add on monitors from Add multiple monitors", async () => {
      rows = ONE_ROW;
      await renderPanel();

      await clickMenuItem("Add multiple monitors");

      expect(dialogTarget()).toBe("Monitor");
      expect(openedDialog?.canSwitchTarget).toBe(true);
    });

    // Add Monitor's "Add a Monitor Group instead." is not offered there either.
    test("offers only monitors on a project without monitor groups", async () => {
      rows = ONE_ROW;
      await renderPanel({ isMonitorGroupsFeatureEnabled: false });

      const items: Array<string> = await openMenu();

      expect(items).toContain("Add multiple monitors");
      expect(items).not.toContain("Add multiple monitor groups");

      await act(async (): Promise<void> => {
        fireEvent.click(
          within(screen.getByRole("menu")).getByText("Add multiple monitors"),
        );
      });

      expect(dialogTarget()).toBe("Monitor");
      expect(openedDialog?.canSwitchTarget).toBe(false);
    });

    test("offers neither to someone who may not add resources", async () => {
      rows = ONE_ROW;
      await renderPanel({ canCreate: false });

      const items: Array<string> = await openMenu();

      expect(items).not.toContain("Add multiple monitors");
      expect(items).not.toContain("Add multiple monitor groups");
    });

    /*
     * Whatever Add Monitor was last switched to: the menu item says which
     * picker it opens, so that is the one it opens.
     */
    test("opens monitors from Add multiple monitors though Add Monitor was switched to monitor groups", async () => {
      rows = ONE_ROW;
      await renderPanel({ isAddingMonitorGroup: true });

      await clickMenuItem("Add multiple monitors");

      expect(dialogTarget()).toBe("Monitor");
    });
  });

  describe("the bulk add dialog", () => {
    test("adds to the group the pane shows", async () => {
      const group: StatusPageGroup = new StatusPageGroup();
      group._id = STATUS_PAGE_GROUP_ID;
      group.name = "Payments";
      rows = ONE_ROW;

      await renderPanel({ statusPageGroup: group });

      await clickMenuItem("Add multiple monitor groups");

      expect(openedDialog?.statusPageGroupId?.toString()).toBe(
        STATUS_PAGE_GROUP_ID,
      );
      expect(openedDialog?.gridPlacement).toBeUndefined();
    });

    test("asks a grid group's cell, with the group's own axes", async () => {
      const group: StatusPageGroup = new StatusPageGroup();
      group._id = STATUS_PAGE_GROUP_ID;
      group.name = "Regions";
      group.viewMode = StatusPageGroupViewMode.Grid;
      group.rowAxisLabel = "Service";
      // Stored as the group form writes them: one comma-separated string.
      group.rowAxisValues = "Core, Edge";
      group.columnAxisLabel = "Region";
      group.columnAxisValues = "EU,US";
      rows = [];

      await renderPanel({ statusPageGroup: group, waitForText: "Edge" });

      await clickMenuItem("Add multiple monitor groups");

      expect(dialogTarget()).toBe("MonitorGroup");
      expect(openedDialog?.gridPlacement).toEqual({
        rowLabel: "Service",
        rowValues: ["Core", "Edge"],
        columnLabel: "Region",
        columnValues: ["EU", "US"],
      });
    });

    test("closes, and opens again on the picker asked for next", async () => {
      rows = ONE_ROW;
      await renderPanel();

      await clickMenuItem("Add multiple monitor groups");
      expect(dialogTarget()).toBe("MonitorGroup");

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByRole("button", { name: "Close bulk add" }));
      });
      expect(screen.queryByTestId("bulk-add-dialog")).toBeNull();

      await clickMenuItem("Add multiple monitors");
      expect(dialogTarget()).toBe("Monitor");
    });

    test("reads the group's resources again once the add is done", async () => {
      rows = ONE_ROW;
      await renderPanel();

      await clickMenuItem("Add multiple monitor groups");

      const readsBefore: number = resourceReads;

      await act(async (): Promise<void> => {
        fireEvent.click(
          screen.getByRole("button", { name: "Finish bulk add" }),
        );
      });

      await waitFor(() => {
        expect(resourceReads).toBeGreaterThan(readsBefore);
      });
      // The summary is still the dialog's to show: it stays open.
      expect(screen.getByTestId("bulk-add-dialog")).toBeInTheDocument();
    });
  });

  /*
   * An empty group offers Add Monitor and Add Multiple side by side, so
   * Add Multiple opens on the picker Add Monitor opens on: the page's.
   */
  describe("an empty group's Add Multiple", () => {
    test("opens on monitors while Add Monitor adds monitors", async () => {
      rows = [];
      await renderPanel();

      await act(async (): Promise<void> => {
        fireEvent.click(
          screen.getByTestId("status-page-resource-panel-empty-bulk-add"),
        );
      });

      expect(dialogTarget()).toBe("Monitor");
      expect(openedDialog?.canSwitchTarget).toBe(true);
    });

    test("opens on monitor groups once Add Monitor was switched to them", async () => {
      rows = [];
      await renderPanel({ isAddingMonitorGroup: true });

      await act(async (): Promise<void> => {
        fireEvent.click(
          screen.getByTestId("status-page-resource-panel-empty-bulk-add"),
        );
      });

      expect(dialogTarget()).toBe("MonitorGroup");
    });
  });
});

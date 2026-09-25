import "@testing-library/jest-dom";
import { cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The schema BaseModelTable hands the bulk action bar for its default Delete,
 * with and without `bulkActions.deleteVerb`. The rendered behaviour (menu,
 * dialog, deleting) is covered end to end in BaseModelTableBulkDelete.test;
 * this pins the parts that are not visible as text - the icon and the style -
 * and the exact sentences for both shapes, by capturing what Table receives.
 * The per-row delete action is captured too, for its icon and for the tooltip
 * a viewer who cannot delete sees on both.
 */

let permissionsForTest: Array<unknown> = ["ProjectAdmin"];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
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

jest.mock("../../../../UI/Utils/User", () => {
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

jest.mock("../../../../UI/Utils/Translation", () => {
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

type CapturedBulkActions = {
  buttons: Array<Record<string, any>>;
};

let capturedBulkActions: Array<CapturedBulkActions> = [];
let capturedRowActions: Array<Array<Record<string, any>>> = [];

jest.mock("../../../../UI/Components/Table/Table", () => {
  return {
    __esModule: true,
    default: (props: {
      bulkActions?: CapturedBulkActions | undefined;
      actionButtons?: Array<Record<string, any>> | undefined;
    }): React.ReactElement => {
      if (props.bulkActions) {
        capturedBulkActions.push(props.bulkActions);
      }
      if (props.actionButtons) {
        capturedRowActions.push(props.actionButtons);
      }
      return <div data-testid="table" />;
    },
  };
});

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
  ModalTableBulkDefaultActions,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import IncidentAlert from "../../../../Models/DatabaseModels/IncidentAlert";
import IconProp from "../../../../Types/Icon/IconProp";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";

const WARNING: string = "Only the links are removed.";

type TableOptions = {
  deleteVerb?: string | undefined;
  deleteIcon?: IconProp | undefined;
  deleteConfirmationWarning?: string | undefined;
  deleteButtonText?: string | undefined;
};

type MakePropsFunction = (
  options: TableOptions,
) => BaseModelTableProps<IncidentAlert>;

const makeProps: MakePropsFunction = (
  options: TableOptions,
): BaseModelTableProps<IncidentAlert> => {
  const callbacks: BaseTableCallbacks<IncidentAlert> = {
    deleteItem: async (): Promise<void> => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject): IncidentAlert => {
      return item as unknown as IncidentAlert;
    },
    getJSONFromModel: (item: IncidentAlert): JSONObject => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown): unknown => {
      return select;
    },
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<IncidentAlert>> => {
      return { data: [], count: 0, skip: data.skip, limit: data.limit };
    },
    toJSONArray: (): Array<JSONObject> => {
      return [];
    },
    updateById: async (): Promise<void> => {
      return undefined;
    },
    showCreateEditModal: (): React.ReactElement => {
      return <div />;
    },
  } as unknown as BaseTableCallbacks<IncidentAlert>;

  return {
    modelType: IncidentAlert,
    id: "links-table",
    name: "Links",
    userPreferencesKey: "links-table",
    urlStateKey: "links-table",
    singularName: "Alert",
    pluralName: "Alerts",
    columns: [
      { field: { createdAt: true }, title: "At", type: FieldType.Text },
    ],
    filters: [],
    cardProps: { title: "Links", description: "Links" },
    isCreateable: false,
    isEditable: false,
    isDeleteable: true,
    isViewable: false,
    deleteButtonText: options.deleteButtonText,
    callbacks: callbacks,
    bulkActions: {
      buttons: [ModalTableBulkDefaultActions.Delete],
      deleteVerb: options.deleteVerb,
      deleteIcon: options.deleteIcon,
      deleteConfirmationWarning: options.deleteConfirmationWarning,
    },
  } as unknown as BaseModelTableProps<IncidentAlert>;
};

type DeleteActionFunction = (
  options: TableOptions,
) => Promise<Record<string, any>>;

const deleteAction: DeleteActionFunction = async (
  options: TableOptions,
): Promise<Record<string, any>> => {
  render(<BaseModelTable<IncidentAlert> {...makeProps(options)} />);

  await waitFor(() => {
    expect(capturedBulkActions.length).toBeGreaterThan(0);
  });

  const buttons: Array<Record<string, any>> =
    capturedBulkActions[capturedBulkActions.length - 1]!.buttons;

  // Exactly one delete action, whatever it is called.
  expect(buttons).toHaveLength(1);

  return buttons[0]!;
};

type RowDeleteActionFunction = (title: string) => Promise<Record<string, any>>;

/*
 * The per-row delete action from the table rendered last. Its title is
 * deleteButtonText, or "Delete".
 */
const rowDeleteAction: RowDeleteActionFunction = async (
  title: string,
): Promise<Record<string, any>> => {
  let action: Record<string, any> | undefined = undefined;

  await waitFor(() => {
    const rowActions: Array<Record<string, any>> =
      capturedRowActions[capturedRowActions.length - 1] || [];

    action = rowActions.find((rowAction: Record<string, any>): boolean => {
      return rowAction["title"] === title;
    });

    expect(action).toBeDefined();
  });

  return action!;
};

const TWO: Array<IncidentAlert> = [new IncidentAlert(), new IncidentAlert()];
const ONE: Array<IncidentAlert> = [new IncidentAlert()];

describe("BaseModelTable bulk delete verb", () => {
  beforeEach(() => {
    capturedBulkActions = [];
    capturedRowActions = [];
    permissionsForTest = ["ProjectAdmin"];
    PermissionGate.clearPermissionPropsCache();
    window.history.replaceState(window.history.state, "", "/dashboard/links");
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("without a verb the default Delete is unchanged", async () => {
    const action: Record<string, any> = await deleteAction({
      deleteConfirmationWarning: WARNING,
    });

    expect(action["title"]).toBe("Delete");
    expect(action["icon"]).toBe(IconProp.Trash);
    expect(action["buttonStyleType"]).toBe(ButtonStyleType.DANGER);
    expect(action["confirmTitle"](TWO)).toBe("Delete 2 Alerts");
    expect(action["confirmTitle"](ONE)).toBe("Delete 1 Alert");
    expect(action["confirmMessage"](TWO)).toBe(
      `Are you sure you want to delete 2 Alerts? This action cannot be undone. ${WARNING}`,
    );
  });

  test("a deleteIcon on its own changes nothing", async () => {
    const action: Record<string, any> = await deleteAction({
      deleteIcon: IconProp.LinkSlash,
    });

    expect(action["title"]).toBe("Delete");
    expect(action["icon"]).toBe(IconProp.Trash);
  });

  test("with a verb, the title, icon and both sentences use it", async () => {
    const action: Record<string, any> = await deleteAction({
      deleteVerb: "Unlink",
      deleteIcon: IconProp.LinkSlash,
      deleteConfirmationWarning: WARNING,
    });

    expect(action["title"]).toBe("Unlink");
    expect(action["icon"]).toBe(IconProp.LinkSlash);
    expect(action["confirmTitle"](TWO)).toBe("Unlink 2 Alerts");
    expect(action["confirmTitle"](ONE)).toBe("Unlink 1 Alert");
    expect(action["confirmMessage"](TWO)).toBe(
      `Are you sure you want to unlink 2 alerts? ${WARNING}`,
    );
    expect(action["confirmMessage"](ONE)).toBe(
      `Are you sure you want to unlink 1 alert? ${WARNING}`,
    );
  });

  test("with a verb and no icon, keeps the trash can", async () => {
    const action: Record<string, any> = await deleteAction({
      deleteVerb: "Remove",
    });

    expect(action["title"]).toBe("Remove");
    expect(action["icon"]).toBe(IconProp.Trash);
    expect(action["confirmMessage"](TWO)).toBe(
      "Are you sure you want to remove 2 alerts?",
    );
  });

  test("with a verb and an icon, the row action wears the same icon", async () => {
    await deleteAction({
      deleteVerb: "Unlink",
      deleteIcon: IconProp.LinkSlash,
      deleteButtonText: "Unlink",
    });

    const row: Record<string, any> = await rowDeleteAction("Unlink");

    expect(row["icon"]).toBe(IconProp.LinkSlash);
  });

  test("without a verb the row action keeps the trash can", async () => {
    await deleteAction({ deleteIcon: IconProp.LinkSlash });

    const row: Record<string, any> = await rowDeleteAction("Delete");

    expect(row["icon"]).toBe(IconProp.Trash);
  });

  /*
   * A viewer who can read the links but not remove them sees both Unlinks
   * locked. The tooltip must not say the locked button deletes the Alert -
   * that is the confusion the verb exists to remove.
   */
  test("a viewer's locked Unlink says unlink, not delete this Alert", async () => {
    permissionsForTest = [Permission.Viewer];

    const bulk: Record<string, any> = await deleteAction({
      deleteVerb: "Unlink",
      deleteIcon: IconProp.LinkSlash,
      deleteButtonText: "Unlink",
    });
    const row: Record<string, any> = await rowDeleteAction("Unlink");

    for (const action of [bulk, row]) {
      expect(action["disabled"]).toBe(true);
      expect(action["tooltip"]).toContain(
        "You do not have permission to unlink this Alert.",
      );
      expect(action["tooltip"]).toContain("Delete Incident Alert");
      expect(action["tooltip"]).not.toContain("delete this Alert");
    }
  });

  test("a viewer's locked Delete without a verb still says delete", async () => {
    permissionsForTest = [Permission.Viewer];

    const bulk: Record<string, any> = await deleteAction({
      deleteButtonText: "Remove",
    });
    const row: Record<string, any> = await rowDeleteAction("Remove");

    for (const action of [bulk, row]) {
      expect(action["disabled"]).toBe(true);
      expect(action["tooltip"]).toContain(
        "You do not have permission to delete this Alert.",
      );
    }
  });
});

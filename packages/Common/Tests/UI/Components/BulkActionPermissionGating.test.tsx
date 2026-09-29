import "@testing-library/jest-dom";
import { renderHook } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The bulk-action hooks were the widest hole left in the table gating.
 *
 * BaseModelTable checks delete permission before it auto-injects the bulk
 * Delete, but it spreads whatever the caller passed in `bulkActions.buttons`
 * straight through untouched - and these three hooks are what nearly every
 * table passes. So a viewer could select every row on a table that correctly
 * refused them a per-row Edit, and still relabel, reassign or archive the lot
 * from the action bar.
 *
 * Labels and archive state live on the record, so those are updates.
 * Ownership lives in a junction table, so adding an owner is a create there
 * and removing one is a delete - which is why the owner hook checks two
 * different permissions rather than one.
 */

let isMasterAdminForTest: boolean = false;
let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      create: async (): Promise<null> => {
        return null;
      },
    },
  };
});

import useBulkLabelActions, {
  BulkLabelActionsResult,
} from "../../../UI/Components/BulkUpdate/BulkLabelActions";
import useBulkArchiveActions, {
  BulkArchiveActionsResult,
} from "../../../UI/Components/BulkUpdate/BulkArchiveActions";
import useBulkOwnerActions, {
  BulkOwnerActionsResult,
} from "../../../UI/Components/BulkUpdate/BulkOwnerActions";
import { BulkActionButtonSchema } from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorOwnerTeam from "../../../Models/DatabaseModels/MonitorOwnerTeam";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import Permission from "../../../Types/Permission";

type FindActionFunction = (
  actions: Array<BulkActionButtonSchema<never>>,
  title: string,
) => BulkActionButtonSchema<never> | undefined;

const findAction: FindActionFunction = (
  actions: Array<BulkActionButtonSchema<never>>,
  title: string,
): BulkActionButtonSchema<never> | undefined => {
  return actions.find((action: BulkActionButtonSchema<never>) => {
    return action.title === title;
  });
};

describe("bulk action permission gating", () => {
  beforeEach(() => {
    isMasterAdminForTest = false;
    permissionsForTest = [];
    PermissionGate.clearPermissionPropsCache();
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("useBulkLabelActions", () => {
    type RenderFunction = () => BulkLabelActionsResult<Monitor>;

    const renderActions: RenderFunction =
      (): BulkLabelActionsResult<Monitor> => {
        return renderHook(() => {
          return useBulkLabelActions<Monitor>({ modelType: Monitor });
        }).result.current;
      };

    test("leaves the label actions working for someone who may update", () => {
      permissionsForTest = [Permission.ProjectAdmin];

      const actions: Array<BulkActionButtonSchema<never>> = renderActions()
        .bulkActions as unknown as Array<BulkActionButtonSchema<never>>;

      expect(findAction(actions, "Add Labels")?.disabled).toBeFalsy();
      expect(findAction(actions, "Remove Labels")?.disabled).toBeFalsy();
    });

    test("locks both label actions for a viewer, with a reason", () => {
      permissionsForTest = [Permission.Viewer];

      const actions: Array<BulkActionButtonSchema<never>> = renderActions()
        .bulkActions as unknown as Array<BulkActionButtonSchema<never>>;

      for (const title of ["Add Labels", "Remove Labels"]) {
        const action: BulkActionButtonSchema<never> | undefined = findAction(
          actions,
          title,
        );

        expect(action?.disabled).toBe(true);
        expect(action?.tooltip).toContain(
          "You do not have permission to update this Monitor.",
        );
      }
    });

    /*
     * The actions still have to be handed to the table - Table derives the row
     * checkboxes from this array being non-empty, and a viewer losing the
     * selection column would be a layout change nobody asked for.
     */
    test("keeps the actions in the array rather than dropping them", () => {
      permissionsForTest = [Permission.Viewer];

      expect(renderActions().bulkActions.length).toBe(2);
    });

    test("leaves them working for a master admin", () => {
      isMasterAdminForTest = true;
      permissionsForTest = [];

      const actions: Array<BulkActionButtonSchema<never>> = renderActions()
        .bulkActions as unknown as Array<BulkActionButtonSchema<never>>;

      expect(findAction(actions, "Add Labels")?.disabled).toBeFalsy();
    });
  });

  describe("useBulkArchiveActions", () => {
    type RenderFunction = () => BulkArchiveActionsResult<PodmanHost>;

    const renderActions: RenderFunction =
      (): BulkArchiveActionsResult<PodmanHost> => {
        return renderHook(() => {
          return useBulkArchiveActions<PodmanHost>({
            modelType: PodmanHost,
          });
        }).result.current;
      };

    test("locks Archive and Unarchive for a viewer", () => {
      permissionsForTest = [Permission.Viewer];

      const result: BulkArchiveActionsResult<PodmanHost> = renderActions();

      expect(result.archiveBulkActions[0]?.disabled).toBe(true);
      expect(result.archiveBulkActions[0]?.tooltip).toContain(
        "You do not have permission to update",
      );
      expect(result.unarchiveBulkActions[0]?.disabled).toBe(true);
    });

    test("leaves them working for someone who may update", () => {
      permissionsForTest = [Permission.ProjectAdmin];

      const result: BulkArchiveActionsResult<PodmanHost> = renderActions();

      expect(result.archiveBulkActions[0]?.disabled).toBeFalsy();
      expect(result.unarchiveBulkActions[0]?.disabled).toBeFalsy();
    });
  });

  describe("useBulkOwnerActions", () => {
    type RenderFunction = () => BulkOwnerActionsResult<Monitor>;

    const renderActions: RenderFunction =
      (): BulkOwnerActionsResult<Monitor> => {
        return renderHook(() => {
          return useBulkOwnerActions<Monitor>({
            ownerUserModelType: MonitorOwnerUser,
            ownerTeamModelType: MonitorOwnerTeam,
            resourceIdField: "monitorId",
          });
        }).result.current;
      };

    test("locks adding and removing owners for a viewer", () => {
      permissionsForTest = [Permission.Viewer];

      const actions: Array<BulkActionButtonSchema<never>> = renderActions()
        .bulkActions as unknown as Array<BulkActionButtonSchema<never>>;

      expect(findAction(actions, "Add Owner")?.disabled).toBe(true);
      expect(findAction(actions, "Remove Owner")?.disabled).toBe(true);
    });

    /*
     * Add and Remove are checked against different permissions on the junction
     * table, so a grant that covers one need not cover the other.
     */
    test("checks Add against create and Remove against delete", () => {
      permissionsForTest = [Permission.Viewer];

      const actions: Array<BulkActionButtonSchema<never>> = renderActions()
        .bulkActions as unknown as Array<BulkActionButtonSchema<never>>;

      expect(findAction(actions, "Add Owner")?.tooltip).toContain(
        "permission to create",
      );
      expect(findAction(actions, "Remove Owner")?.tooltip).toContain(
        "permission to delete",
      );
    });

    test("leaves them working for someone who may manage owners", () => {
      permissionsForTest = [Permission.ProjectAdmin];

      const actions: Array<BulkActionButtonSchema<never>> = renderActions()
        .bulkActions as unknown as Array<BulkActionButtonSchema<never>>;

      expect(findAction(actions, "Add Owner")?.disabled).toBeFalsy();
      expect(findAction(actions, "Remove Owner")?.disabled).toBeFalsy();
    });
  });
});

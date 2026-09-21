import { mockRouter } from "./Helpers";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * CommonAPI.assertCanReadTable: "could this caller read <model> through its
 * CRUD endpoint?", for custom routes that then read as root.
 *
 * The CRUD read has two table-level halves and both are applied: an Allow
 * grant from the model's read list, and no unlabelled team BLOCK row on
 * any permission in that list (a block overrides every Allow). Master
 * admins bypass both. The rule used to live in OnCallScheduleTimelineAPI;
 * it moved here so the monitor uptime-summary route can share it, and the
 * on-call export became a delegate so its callers did not change.
 *
 * MonitorStatusTimeline is the model under test because it is the one the
 * uptime-summary route guards: MonitorViewer and ReadMonitorStatusTimeline
 * are on its read list, ReadProjectMonitor is not.
 */

// OnCallScheduleTimelineAPI registers its route at import time.
jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(() => {
        return null;
      }),
      isConnected: jest.fn(() => {
        return false;
      }),
    },
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import { assertCanReadTable as onCallAssertCanReadTable } from "../../../Server/API/OnCallScheduleTimelineAPI";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const LABEL_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");

function buildProps(data: {
  permissions?: Array<Permission> | undefined;
  blocks?: Array<Permission> | undefined;
  blockLabelIds?: Array<ObjectID> | undefined;
}): DatabaseCommonInteractionProps {
  const grants: Array<UserPermission> = [
    ...(data.permissions || []).map(
      (permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        };
      },
    ),
    ...(data.blocks || []).map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: data.blockLabelIds || [],
        isBlockPermission: true,
      };
    }),
  ];

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: grants,
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

function refusal(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }

  return undefined;
}

describe("CommonAPI.assertCanReadTable", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("admits an Allow grant", () => {
    for (const permission of [
      Permission.MonitorViewer,
      Permission.ReadMonitorStatusTimeline,
      Permission.ProjectMember,
      Permission.Viewer,
    ]) {
      expect(() => {
        CommonAPI.assertCanReadTable({
          modelType: MonitorStatusTimeline,
          props: buildProps({ permissions: [permission] }),
        });
      }).not.toThrow();
    }
  });

  test("refuses without an Allow grant", () => {
    const withMessage: unknown = refusal(() => {
      CommonAPI.assertCanReadTable({
        modelType: MonitorStatusTimeline,
        props: buildProps({ permissions: [Permission.ReadProjectMonitor] }),
        errorMessage: "No history for you.",
      });
    });

    expect(withMessage).toBeInstanceOf(NotAuthorizedException);
    expect((withMessage as Exception).message).toBe("No history for you.");

    // Without a message of its own, the generic refusal is used.
    const withoutMessage: unknown = refusal(() => {
      CommonAPI.assertCanReadTable({
        modelType: MonitorStatusTimeline,
        props: buildProps({ permissions: [Permission.ReadProjectMonitor] }),
      });
    });

    expect(withoutMessage).toBeInstanceOf(NotAuthorizedException);
    expect((withoutMessage as Exception).message).toBe(
      "You do not have permission to access this project's data.",
    );
  });

  test("does not count a BLOCK row as a grant", () => {
    const thrown: unknown = refusal(() => {
      CommonAPI.assertCanReadTable({
        modelType: MonitorStatusTimeline,
        props: buildProps({ blocks: [Permission.ReadMonitorStatusTimeline] }),
      });
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
  });

  test("refuses a team BLOCK row", () => {
    const thrown: unknown = refusal(() => {
      CommonAPI.assertCanReadTable({
        modelType: MonitorStatusTimeline,
        props: buildProps({
          permissions: [Permission.MonitorViewer],
          blocks: [Permission.ReadMonitorStatusTimeline],
        }),
        errorMessage: "No history for you.",
      });
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    // The block says which permission was blocked, not the Allow message.
    expect((thrown as Exception).message).toContain(
      "ReadMonitorStatusTimeline is in your team's permission block list",
    );
  });

  test("leaves a labelled BLOCK row to the row-level rules", () => {
    /*
     * A block scoped to labels only hides the labelled rows. That is
     * enforced by the caller-scoped read, not here, so the table check
     * must let it through.
     */
    expect(() => {
      CommonAPI.assertCanReadTable({
        modelType: MonitorStatusTimeline,
        props: buildProps({
          permissions: [Permission.MonitorViewer],
          blocks: [Permission.ReadMonitorStatusTimeline],
          blockLabelIds: [LABEL_ID],
        }),
      });
    }).not.toThrow();
  });

  test("refuses an anonymous caller with 401", () => {
    const thrown: unknown = refusal(() => {
      CommonAPI.assertCanReadTable({
        modelType: MonitorStatusTimeline,
        props: {},
      });
    });

    expect(thrown).toBeInstanceOf(NotAuthenticatedException);
  });

  test("master admin bypasses", () => {
    expect(() => {
      CommonAPI.assertCanReadTable({
        modelType: MonitorStatusTimeline,
        props: {
          ...buildProps({
            permissions: [],
            blocks: [Permission.ReadMonitorStatusTimeline],
          }),
          isMasterAdmin: true,
          userType: UserType.MasterAdmin,
        },
      });
    }).not.toThrow();
  });

  test("OnCallScheduleTimelineAPI.assertCanReadTable still delegates", () => {
    const delegate: jest.SpyInstance = jest.spyOn(
      CommonAPI,
      "assertCanReadTable",
    );
    const props: DatabaseCommonInteractionProps = buildProps({
      permissions: [Permission.MonitorViewer],
    });

    onCallAssertCanReadTable({
      modelType: MonitorStatusTimeline,
      props: props,
      errorMessage: "No history for you.",
    });

    expect(delegate).toHaveBeenCalledTimes(1);

    const args: {
      modelType: unknown;
      props: DatabaseCommonInteractionProps;
      errorMessage?: string;
    } = delegate.mock.calls[0]![0] as {
      modelType: unknown;
      props: DatabaseCommonInteractionProps;
      errorMessage?: string;
    };

    expect(args.modelType).toBe(MonitorStatusTimeline);
    expect(args.props).toBe(props);
    expect(args.errorMessage).toBe("No history for you.");

    // And it refuses exactly what the shared rule refuses.
    delegate.mockRestore();

    const thrown: unknown = refusal(() => {
      onCallAssertCanReadTable({
        modelType: MonitorStatusTimeline,
        props: buildProps({ permissions: [Permission.ReadProjectMonitor] }),
        errorMessage: "No history for you.",
      });
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Exception).message).toBe("No history for you.");
  });
});

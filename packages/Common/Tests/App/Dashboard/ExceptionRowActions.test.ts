import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Resolve or Reopen, Archive or Unarchive in each exception's ⋯ menu on the
 * exceptions list (ExceptionRowActions) - the two triage actions the
 * exception's own page offers in its header, with its words, one click
 * each (each is undone from the same menu), and the same lock for someone
 * who may not update exceptions. Only the switch is sent: the server
 * records who turned it, and when. The list reads its rows again after.
 */

let permissionsForTest: Array<unknown> = [];
const updateCalls: Array<{ id: string; data: unknown }> = [];
let refusalForTest: string = "";

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
      updateById: async (request: {
        id: { toString: () => string };
        data: unknown;
      }): Promise<void> => {
        if (refusalForTest) {
          throw new Error(refusalForTest);
        }

        updateCalls.push({ id: request.id.toString(), data: request.data });
      },
    },
  };
});

import {
  EXCEPTION_ROW_TRIAGE_ORDER,
  getExceptionRowActions,
  getExceptionTriageWrite,
  isExceptionTriageActionOffered,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionRowActions";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import IconProp from "../../../Types/Icon/IconProp";
import Permission from "../../../Types/Permission";

const EXCEPTION_ID: string = "99999999-9999-4999-8999-999999999991";

const exception: (state: {
  isResolved: boolean;
  isArchived: boolean;
}) => TelemetryException = (state: {
  isResolved: boolean;
  isArchived: boolean;
}): TelemetryException => {
  const row: TelemetryException = new TelemetryException();
  row._id = EXCEPTION_ID;
  row.isResolved = state.isResolved;
  row.isArchived = state.isArchived;

  return row;
};

const offered: (row: TelemetryException) => Array<string> = (
  row: TelemetryException,
): Array<string> => {
  return getExceptionRowActions({ onChanged: (): void => {} })
    .filter((action: ActionButtonSchema<TelemetryException>): boolean => {
      return action.isVisible ? Boolean(action.isVisible(row)) : true;
    })
    .map((action: ActionButtonSchema<TelemetryException>): string => {
      return action.title;
    });
};

beforeEach(() => {
  permissionsForTest = [Permission.ProjectOwner];
  PermissionGate.clearPermissionPropsCache();
  updateCalls.length = 0;
  refusalForTest = "";
});

describe("which triage actions a row offers", () => {
  test("the two its state leads to, as the exception's page offers them", () => {
    expect(
      offered(exception({ isResolved: false, isArchived: false })),
    ).toEqual(["Resolve", "Archive"]);
    expect(offered(exception({ isResolved: true, isArchived: false }))).toEqual(
      ["Reopen", "Archive"],
    );
    expect(offered(exception({ isResolved: false, isArchived: true }))).toEqual(
      ["Resolve", "Unarchive"],
    );
    expect(offered(exception({ isResolved: true, isArchived: true }))).toEqual([
      "Reopen",
      "Unarchive",
    ]);
  });

  test("an exception that does not say is a live, unresolved one", () => {
    const row: TelemetryException = new TelemetryException();

    expect(isExceptionTriageActionOffered(row, "resolve")).toBe(true);
    expect(isExceptionTriageActionOffered(row, "unresolve")).toBe(false);
    expect(isExceptionTriageActionOffered(row, "archive")).toBe(true);
    expect(isExceptionTriageActionOffered(row, "unarchive")).toBe(false);
  });
});

describe("the actions", () => {
  test("sit in the ⋯ menu - the row opens the exception - in the page's order, with icons", () => {
    const actions: Array<ActionButtonSchema<TelemetryException>> =
      getExceptionRowActions({ onChanged: (): void => {} });

    expect(EXCEPTION_ROW_TRIAGE_ORDER).toEqual([
      "resolve",
      "unresolve",
      "archive",
      "unarchive",
    ]);
    expect(
      actions.map((action: ActionButtonSchema<TelemetryException>) => {
        return [action.title, action.icon, action.placement];
      }),
    ).toEqual([
      ["Resolve", IconProp.Check, ActionButtonPlacement.MoreMenu],
      ["Reopen", IconProp.Refresh, ActionButtonPlacement.MoreMenu],
      ["Archive", IconProp.Archive, ActionButtonPlacement.MoreMenu],
      ["Unarchive", IconProp.Unarchive, ActionButtonPlacement.MoreMenu],
    ]);
  });

  test("each sends the one switch it turns", () => {
    expect(getExceptionTriageWrite("resolve")).toEqual({ isResolved: true });
    expect(getExceptionTriageWrite("unresolve")).toEqual({
      isResolved: false,
    });
    expect(getExceptionTriageWrite("archive")).toEqual({ isArchived: true });
    expect(getExceptionTriageWrite("unarchive")).toEqual({
      isArchived: false,
    });
  });

  test("Resolve writes the exception's switch, and the list is read again", async () => {
    let changed: number = 0;
    let completed: number = 0;
    const [resolve] = getExceptionRowActions({
      onChanged: (): void => {
        changed++;
      },
    });

    await resolve!.onClick(
      exception({ isResolved: false, isArchived: false }),
      (): void => {
        completed++;
      },
      (): void => {},
    );

    expect(updateCalls).toEqual([
      { id: EXCEPTION_ID, data: { isResolved: true } },
    ]);
    expect(changed).toBe(1);
    expect(completed).toBe(1);
  });

  test("a refusal is handed back in the server's words, and nothing is read again", async () => {
    refusalForTest = "You do not have permission to update this exception.";

    let changed: number = 0;
    const errors: Array<string> = [];
    const archive: ActionButtonSchema<TelemetryException> =
      getExceptionRowActions({
        onChanged: (): void => {
          changed++;
        },
      })[2]!;

    await archive.onClick(
      exception({ isResolved: false, isArchived: false }),
      (): void => {},
      (error: Error): void => {
        errors.push(error.message);
      },
    );

    expect(errors).toEqual([
      "You do not have permission to update this exception.",
    ]);
    expect(changed).toBe(0);
  });

  test("someone who may not update exceptions finds all four locked, saying why", () => {
    permissionsForTest = [Permission.Viewer];

    for (const action of getExceptionRowActions({
      onChanged: (): void => {},
    })) {
      expect(action.disabled).toBe(true);
      expect(action.tooltip).toContain("permission");
    }
  });
});

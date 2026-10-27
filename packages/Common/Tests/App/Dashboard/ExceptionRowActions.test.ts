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
  EXCEPTION_ALREADY_THERE,
  EXCEPTION_BULK_LOCK_SENTENCE,
  EXCEPTION_NAME_MAX_LENGTH,
  EXCEPTION_RESULT_LABELS,
  EXCEPTION_ROW_TRIAGE_ORDER,
  getExceptionBulkActions,
  getExceptionId,
  getExceptionName,
  getExceptionRowActions,
  getExceptionTriageWrite,
  isExceptionTriageActionOffered,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionRowActions";
import {
  BulkActionButtonSchema,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { ActionMenuGroup } from "../../../UI/Components/ActionButton/ActionMenuGroup";
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

    // onClick is typed as returning nothing; the action's write is awaited.
    await Promise.resolve(
      resolve!.onClick(
        exception({ isResolved: false, isArchived: false }),
        (): void => {
          completed++;
        },
        (): void => {},
      ),
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

    await Promise.resolve(
      archive.onClick(
        exception({ isResolved: false, isArchived: false }),
        (): void => {},
        (error: Error): void => {
          errors.push(error.message);
        },
      ),
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

/*
 * ---------------------------------------------------------------------------
 * The same four on a selection: Bulk Actions on the exceptions list
 * ---------------------------------------------------------------------------
 *
 * The list's rows each had a ⋯ and there was no selection (#5248's
 * follow-up). Bulk Actions offers each while one selected exception can
 * take it, writes every exception as its row's action would - the one
 * switch, one request each - and leaves one that is there already alone,
 * saying so.
 */

const SECOND_ID: string = "99999999-9999-4999-8999-999999999992";

const exceptionWithId: (
  id: string,
  state: { isResolved: boolean; isArchived: boolean },
) => TelemetryException = (
  id: string,
  state: { isResolved: boolean; isArchived: boolean },
): TelemetryException => {
  const row: TelemetryException = exception(state);
  row._id = id;
  row.exceptionType = "TypeError";
  row.message = `Cannot read properties of undefined (${id.slice(-1)})\n    at handler (app.js:10:5)`;

  return row;
};

interface BulkRun {
  succeeded: Array<string>;
  unchanged: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; message: string }>;
}

const runBulk: (
  title: string,
  items: Array<TelemetryException>,
) => Promise<BulkRun> = async (
  title: string,
  items: Array<TelemetryException>,
): Promise<BulkRun> => {
  const action: BulkActionButtonSchema<TelemetryException> | undefined =
    getExceptionBulkActions().find(
      (candidate: BulkActionButtonSchema<TelemetryException>): boolean => {
        return candidate.title === title;
      },
    );

  expect(action).toBeDefined();

  let last: ProgressInfo<TelemetryException> | null = null;

  await action!.onClick({
    items: items,
    onProgressInfo: (info: ProgressInfo<TelemetryException>): void => {
      last = info;
    },
    onBulkActionStart: (): void => {},
    onBulkActionEnd: (): void => {},
  });

  const final: ProgressInfo<TelemetryException> =
    last as unknown as ProgressInfo<TelemetryException>;

  return {
    succeeded: final.successItems.map((row: TelemetryException): string => {
      return getExceptionId(row);
    }),
    unchanged: (final.unchanged || []).map(
      (entry: {
        item: TelemetryException;
        reason: unknown;
      }): { id: string; reason: string } => {
        return { id: getExceptionId(entry.item), reason: String(entry.reason) };
      },
    ),
    failed: final.failed.map(
      (entry: {
        item: TelemetryException;
        failedMessage: unknown;
      }): { id: string; message: string } => {
        return {
          id: getExceptionId(entry.item),
          message: String(entry.failedMessage),
        };
      },
    ),
  };
};

describe("Bulk Actions on the exceptions list", () => {
  test("offers the four triage actions, in the row's order, with the row's icons, grouped as a record's own state", () => {
    const bulk: Array<BulkActionButtonSchema<TelemetryException>> =
      getExceptionBulkActions();
    const rowActions: Array<ActionButtonSchema<TelemetryException>> =
      getExceptionRowActions({ onChanged: (): void => {} });

    expect(
      bulk.map((action: BulkActionButtonSchema<TelemetryException>) => {
        return action.title;
      }),
    ).toEqual(["Resolve", "Reopen", "Archive", "Unarchive"]);
    expect(
      bulk.map((action: BulkActionButtonSchema<TelemetryException>) => {
        return action.icon;
      }),
    ).toEqual(
      rowActions.map((action: ActionButtonSchema<TelemetryException>) => {
        return action.icon;
      }),
    );
    for (const action of bulk) {
      expect(action.menuGroup).toBe(ActionMenuGroup.Change);
    }
    expect(EXCEPTION_ROW_TRIAGE_ORDER).toHaveLength(4);
  });

  test("the result says what was done to each, in an incident list's words for Resolve", () => {
    const bulk: Array<BulkActionButtonSchema<TelemetryException>> =
      getExceptionBulkActions();

    expect(
      bulk.map((action: BulkActionButtonSchema<TelemetryException>) => {
        return [
          action.title,
          action.resultLabels?.succeeded.other,
          action.resultLabels?.failed.other,
        ];
      }),
    ).toEqual([
      [
        "Resolve",
        "{{count}} {{itemsName}} resolved",
        "{{count}} {{itemsName}} not resolved",
      ],
      [
        "Reopen",
        "{{count}} {{itemsName}} reopened",
        "{{count}} {{itemsName}} not reopened",
      ],
      [
        "Archive",
        "{{count}} {{itemsName}} archived",
        "{{count}} {{itemsName}} not archived",
      ],
      [
        "Unarchive",
        "{{count}} {{itemsName}} unarchived",
        "{{count}} {{itemsName}} not unarchived",
      ],
    ]);

    // Each one's singular is its plural's sentence about one exception.
    for (const id of EXCEPTION_ROW_TRIAGE_ORDER) {
      const labels: (typeof EXCEPTION_RESULT_LABELS)[typeof id] =
        EXCEPTION_RESULT_LABELS[id];

      expect(labels.succeeded.one).toBe(
        labels.succeeded.other.replace("{{itemsName}}", "{{itemName}}"),
      );
      expect(labels.failed.one).toBe(
        labels.failed.other.replace("{{itemsName}}", "{{itemName}}"),
      );
    }
  });

  test("each is offered while one selected exception can take it", () => {
    const open: TelemetryException = exceptionWithId(EXCEPTION_ID, {
      isResolved: false,
      isArchived: false,
    });
    const resolvedArchived: TelemetryException = exceptionWithId(SECOND_ID, {
      isResolved: true,
      isArchived: true,
    });

    const offeredFor: (rows: Array<TelemetryException>) => Array<string> = (
      rows: Array<TelemetryException>,
    ): Array<string> => {
      return getExceptionBulkActions()
        .filter((action: BulkActionButtonSchema<TelemetryException>) => {
          return action.isVisible ? action.isVisible(rows) !== false : true;
        })
        .map((action: BulkActionButtonSchema<TelemetryException>) => {
          return action.title;
        });
    };

    expect(offeredFor([open])).toEqual(["Resolve", "Archive"]);
    expect(offeredFor([resolvedArchived])).toEqual(["Reopen", "Unarchive"]);
    expect(offeredFor([open, resolvedArchived])).toEqual([
      "Resolve",
      "Reopen",
      "Archive",
      "Unarchive",
    ]);
    // Nothing selected yet: the menu lists every one.
    expect(offeredFor([])).toHaveLength(4);
  });

  test("Resolve writes each open exception's switch, one request each, and leaves a resolved one alone, saying so", async () => {
    const run: BulkRun = await runBulk("Resolve", [
      exceptionWithId(EXCEPTION_ID, { isResolved: false, isArchived: false }),
      exceptionWithId(SECOND_ID, { isResolved: true, isArchived: false }),
    ]);

    expect(updateCalls).toEqual([
      { id: EXCEPTION_ID, data: { isResolved: true } },
    ]);
    expect(run.succeeded).toEqual([EXCEPTION_ID]);
    expect(run.unchanged).toEqual([
      { id: SECOND_ID, reason: "Already resolved." },
    ]);
    expect(run.failed).toEqual([]);
  });

  test("Reopen, Archive and Unarchive each send their one switch, and say why they left one alone", async () => {
    const cases: Array<{
      title: string;
      take: { isResolved: boolean; isArchived: boolean };
      leave: { isResolved: boolean; isArchived: boolean };
      data: unknown;
      reason: string;
    }> = [
      {
        title: "Reopen",
        take: { isResolved: true, isArchived: false },
        leave: { isResolved: false, isArchived: false },
        data: { isResolved: false },
        reason: "Not resolved.",
      },
      {
        title: "Archive",
        take: { isResolved: false, isArchived: false },
        leave: { isResolved: false, isArchived: true },
        data: { isArchived: true },
        reason: "Already archived.",
      },
      {
        title: "Unarchive",
        take: { isResolved: false, isArchived: true },
        leave: { isResolved: false, isArchived: false },
        data: { isArchived: false },
        reason: "Not archived.",
      },
    ];

    for (const each of cases) {
      updateCalls.length = 0;

      const run: BulkRun = await runBulk(each.title, [
        exceptionWithId(EXCEPTION_ID, each.take),
        exceptionWithId(SECOND_ID, each.leave),
      ]);

      expect([each.title, updateCalls]).toEqual([
        each.title,
        [{ id: EXCEPTION_ID, data: each.data }],
      ]);
      expect([each.title, run.unchanged]).toEqual([
        each.title,
        [{ id: SECOND_ID, reason: each.reason }],
      ]);
    }

    expect(EXCEPTION_ALREADY_THERE).toEqual({
      resolve: "Already resolved.",
      unresolve: "Not resolved.",
      archive: "Already archived.",
      unarchive: "Not archived.",
    });
  });

  test("a refusal fails only its own exception, in the server's words", async () => {
    refusalForTest = "You do not have permission to update this exception.";

    const run: BulkRun = await runBulk("Archive", [
      exceptionWithId(EXCEPTION_ID, { isResolved: false, isArchived: false }),
    ]);

    expect(run.succeeded).toEqual([]);
    expect(run.failed).toEqual([
      {
        id: EXCEPTION_ID,
        message: "You do not have permission to update this exception.",
      },
    ]);
  });

  test("someone who may not update exceptions finds all four locked in Bulk Actions too, saying why about the selection", () => {
    permissionsForTest = [Permission.Viewer];

    for (const action of getExceptionBulkActions()) {
      expect(action.disabled).toBe(true);
      // About the exceptions selected, then the permissions that allow it.
      expect(action.tooltip?.startsWith(EXCEPTION_BULK_LOCK_SENTENCE)).toBe(
        true,
      );
      expect(action.tooltip).not.toContain("this Exception");
    }

    expect(EXCEPTION_BULK_LOCK_SENTENCE).toBe(
      "You do not have permission to update these exceptions.",
    );
  });

  test("someone who may update exceptions finds all four unlocked", () => {
    for (const action of getExceptionBulkActions()) {
      expect([action.title, action.disabled, action.tooltip]).toEqual([
        action.title,
        undefined,
        undefined,
      ]);
    }
  });

  test("a run with nothing to change sends nothing and lists every exception as left alone", async () => {
    const run: BulkRun = await runBulk("Unarchive", [
      exceptionWithId(EXCEPTION_ID, { isResolved: false, isArchived: false }),
      exceptionWithId(SECOND_ID, { isResolved: true, isArchived: false }),
    ]);

    expect(updateCalls).toEqual([]);
    expect(run.succeeded).toEqual([]);
    expect(run.unchanged).toEqual([
      { id: EXCEPTION_ID, reason: "Not archived." },
      { id: SECOND_ID, reason: "Not archived." },
    ]);
  });

  test("an exception the list read without an id fails alone, and the others are written", async () => {
    const nameless: TelemetryException = exceptionWithId(SECOND_ID, {
      isResolved: false,
      isArchived: false,
    });
    delete nameless._id;

    const run: BulkRun = await runBulk("Resolve", [
      exceptionWithId(EXCEPTION_ID, { isResolved: false, isArchived: false }),
      nameless,
    ]);

    expect(updateCalls).toEqual([
      { id: EXCEPTION_ID, data: { isResolved: true } },
    ]);
    expect(run.succeeded).toEqual([EXCEPTION_ID]);
    expect(run.failed).toEqual([{ id: "", message: "Exception not found" }]);
  });

  test("a selected exception is named by its type and its message's first line", () => {
    const row: TelemetryException = exceptionWithId(EXCEPTION_ID, {
      isResolved: false,
      isArchived: false,
    });

    expect(getExceptionName(row)).toBe(
      "TypeError: Cannot read properties of undefined (1)",
    );

    const bare: TelemetryException = exception({
      isResolved: false,
      isArchived: false,
    });
    bare.fingerprint = "fp-123";
    expect(getExceptionName(bare)).toBe("fp-123");

    const typeOnly: TelemetryException = exceptionWithId(SECOND_ID, {
      isResolved: false,
      isArchived: false,
    });
    typeOnly.message = "";
    expect(getExceptionName(typeOnly)).toBe("TypeError");

    // Only the message's first line, trimmed; a message alone names it too.
    const messageOnly: TelemetryException = exceptionWithId(SECOND_ID, {
      isResolved: false,
      isArchived: false,
    });
    messageOnly.exceptionType = "";
    messageOnly.message = "  socket hang up  \n    at TLSSocket.onclose";
    expect(getExceptionName(messageOnly)).toBe("socket hang up");
  });

  test("a long message is cut to a name a box's label and the result can hold", () => {
    const long: TelemetryException = exceptionWithId(EXCEPTION_ID, {
      isResolved: false,
      isArchived: false,
    });
    long.message = "x".repeat(5000);

    const name: string = getExceptionName(long);

    expect(name.length).toBe(EXCEPTION_NAME_MAX_LENGTH);
    expect(name.startsWith("TypeError: xxx")).toBe(true);
    expect(name.endsWith("…")).toBe(true);
    expect(EXCEPTION_NAME_MAX_LENGTH).toBe(200);
  });

  test("an exception is known by its id, as a row or a read carries it", () => {
    const row: TelemetryException = exceptionWithId(EXCEPTION_ID, {
      isResolved: false,
      isArchived: false,
    });

    expect(getExceptionId(row)).toBe(EXCEPTION_ID);

    delete row._id;
    expect(getExceptionId(row)).toBe("");
  });
});

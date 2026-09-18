import "@testing-library/jest-dom";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";

/*
 * The SLO tables' Archive / Unarchive, rendered through the real shared hook.
 *
 * App/Tests/Dashboard/SloBulkActionsWiring.test.ts pins, by reading source,
 * that the hook hands useBulkArchiveActions the SLO copy and that each table
 * picks the right action. This renders the hook and pins what a user actually
 * gets: SLO-worded titles and confirmations, the right column written on the
 * right model, archive kept apart from the label and owner actions, and the
 * permission gate still in force.
 */

let permissionsForTest: Array<unknown> = [];

const updateByIdMock: Mock<(args: unknown) => Promise<void>> =
  jest.fn<(args: unknown) => Promise<void>>();

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
      updateById: (args: unknown): Promise<void> => {
        return updateByIdMock(args);
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

import useSloBulkActions, {
  SloBulkActionsResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/useSloBulkActions";
import {
  SLO_BULK_ARCHIVE_CONFIRM_MESSAGE,
  SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloArchiveCopy";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

type SloAction = BulkActionButtonSchema<ServiceLevelObjective>;

function renderSloActions(): SloBulkActionsResult {
  return renderHook(() => {
    return useSloBulkActions();
  }).result.current;
}

function slos(count: number): Array<ServiceLevelObjective> {
  const items: Array<ServiceLevelObjective> = [];

  for (let index: number = 0; index < count; index++) {
    items.push(new ServiceLevelObjective(ObjectID.generate()));
  }

  return items;
}

function onlyAction(actions: Array<SloAction>): SloAction {
  expect(actions).toHaveLength(1);
  return actions[0]!;
}

function clickProps(
  items: Array<ServiceLevelObjective>,
): BulkActionOnClickProps<ServiceLevelObjective> {
  return {
    items: items,
    onProgressInfo: (() => {
      return undefined;
    }) as unknown as BulkActionOnClickProps<ServiceLevelObjective>["onProgressInfo"],
    onBulkActionStart: (() => {
      return undefined;
    }) as unknown as BulkActionOnClickProps<ServiceLevelObjective>["onBulkActionStart"],
    onBulkActionEnd: (() => {
      return undefined;
    }) as unknown as BulkActionOnClickProps<ServiceLevelObjective>["onBulkActionEnd"],
  };
}

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  updateByIdMock.mockReset().mockResolvedValue(undefined);
});

describe("useSloBulkActions — Archive and Unarchive", () => {
  test("Archive is titled and confirmed in SLO words, for one SLO or many", () => {
    const archive: SloAction = onlyAction(
      renderSloActions().archiveBulkActions,
    );

    expect(archive.title).toBe("Archive");
    expect(archive.confirmTitle!(slos(1))).toBe("Archive 1 SLO?");
    expect(archive.confirmTitle!(slos(3))).toBe("Archive 3 SLOs?");
    expect(archive.confirmMessage!(slos(1))).toBe(
      SLO_BULK_ARCHIVE_CONFIRM_MESSAGE,
    );
    expect(archive.confirmMessage!(slos(3))).toBe(
      SLO_BULK_ARCHIVE_CONFIRM_MESSAGE,
    );
    expect(archive.confirmMessage!(slos(3))).not.toContain("telemetry");
  });

  test("Unarchive is titled and confirmed in SLO words", () => {
    const unarchive: SloAction = onlyAction(
      renderSloActions().unarchiveBulkActions,
    );

    expect(unarchive.title).toBe("Unarchive");
    expect(unarchive.confirmTitle!(slos(2))).toBe("Unarchive 2 SLOs?");
    expect(unarchive.confirmMessage!(slos(2))).toBe(
      SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE,
    );
  });

  test("archive and unarchive are kept out of the label and owner actions", () => {
    const titles: Array<string> = renderSloActions().bulkActions.map(
      (action: SloAction): string => {
        return action.title;
      },
    );

    expect(titles.length).toBeGreaterThan(0);
    expect(titles).not.toContain("Archive");
    expect(titles).not.toContain("Unarchive");
  });

  test("Archive writes isArchived: true to each selected SLO; Unarchive writes false", async () => {
    const result: SloBulkActionsResult = renderSloActions();
    const items: Array<ServiceLevelObjective> = slos(2);

    await onlyAction(result.archiveBulkActions).onClick(clickProps(items));

    expect(updateByIdMock).toHaveBeenCalledTimes(2);
    for (const item of items) {
      expect(updateByIdMock).toHaveBeenCalledWith({
        id: item.id,
        modelType: ServiceLevelObjective,
        data: { isArchived: true },
      });
    }

    updateByIdMock.mockClear();

    await onlyAction(result.unarchiveBulkActions).onClick(
      clickProps([items[1]!]),
    );

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateByIdMock).toHaveBeenCalledWith({
      id: items[1]!.id,
      modelType: ServiceLevelObjective,
      data: { isArchived: false },
    });
  });

  test("a viewer cannot archive or unarchive SLOs", () => {
    permissionsForTest = [Permission.Viewer];

    const result: SloBulkActionsResult = renderSloActions();

    expect(onlyAction(result.archiveBulkActions).disabled).toBe(true);
    expect(onlyAction(result.archiveBulkActions).tooltip).toContain(
      "You do not have permission to update",
    );
    expect(onlyAction(result.unarchiveBulkActions).disabled).toBe(true);
  });

  test("someone who may edit SLOs can", () => {
    permissionsForTest = [Permission.ProjectAdmin];

    const result: SloBulkActionsResult = renderSloActions();

    expect(onlyAction(result.archiveBulkActions).disabled).toBeFalsy();
    expect(onlyAction(result.unarchiveBulkActions).disabled).toBeFalsy();
  });

  test("still hands back the label and owner modals for the tables to mount", () => {
    expect(renderSloActions().modals).toBeTruthy();
  });
});

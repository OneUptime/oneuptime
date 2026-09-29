import "@testing-library/jest-dom";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";

/*
 * useBulkArchiveActions' copy overrides.
 *
 * The default confirmation copy is written for telemetry resources ("will keep
 * collecting telemetry") and is relied on, word for word, by every archivable
 * table in the product - so it must not move. A model whose archive does more
 * (an archived SLO stops being evaluated) passes its own confirmation bodies,
 * which replace the defaults outright, for one item or many, without changing
 * the titles, the permission gate, or what is actually written.
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
      updateById: (args: unknown): Promise<void> => {
        return updateByIdMock(args);
      },
    },
  };
});

import useBulkArchiveActions, {
  BulkArchiveActionsConfig,
  BulkArchiveActionsResult,
} from "../../../UI/Components/BulkUpdate/BulkArchiveActions";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

const ARCHIVE_OVERRIDE: string =
  "Archived hosts stop doing the special thing. You can unarchive them anytime.";
const UNARCHIVE_OVERRIDE: string =
  "Unarchived hosts start doing the special thing again.";

type ExtraConfig = Omit<BulkArchiveActionsConfig<PodmanHost>, "modelType">;

function renderActions(
  config: ExtraConfig = {},
): BulkArchiveActionsResult<PodmanHost> {
  return renderHook(() => {
    return useBulkArchiveActions<PodmanHost>({
      modelType: PodmanHost,
      singularName: "host",
      pluralName: "hosts",
      ...config,
    });
  }).result.current;
}

function hosts(count: number): Array<PodmanHost> {
  const items: Array<PodmanHost> = [];

  for (let index: number = 0; index < count; index++) {
    items.push(new PodmanHost(ObjectID.generate()));
  }

  return items;
}

function onlyAction(
  actions: Array<BulkActionButtonSchema<PodmanHost>>,
): BulkActionButtonSchema<PodmanHost> {
  expect(actions).toHaveLength(1);
  return actions[0]!;
}

interface ClickHarness {
  props: BulkActionOnClickProps<PodmanHost>;
  onProgressInfo: Mock<(info: unknown) => void>;
  onBulkActionStart: Mock<() => void>;
  onBulkActionEnd: Mock<() => void>;
}

function clickHarness(items: Array<PodmanHost>): ClickHarness {
  const onProgressInfo: Mock<(info: unknown) => void> =
    jest.fn<(info: unknown) => void>();
  const onBulkActionStart: Mock<() => void> = jest.fn<() => void>();
  const onBulkActionEnd: Mock<() => void> = jest.fn<() => void>();

  return {
    props: {
      items: items,
      onProgressInfo:
        onProgressInfo as unknown as BulkActionOnClickProps<PodmanHost>["onProgressInfo"],
      onBulkActionStart:
        onBulkActionStart as unknown as BulkActionOnClickProps<PodmanHost>["onBulkActionStart"],
      onBulkActionEnd:
        onBulkActionEnd as unknown as BulkActionOnClickProps<PodmanHost>["onBulkActionEnd"],
    },
    onProgressInfo: onProgressInfo,
    onBulkActionStart: onBulkActionStart,
    onBulkActionEnd: onBulkActionEnd,
  };
}

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  updateByIdMock.mockReset().mockResolvedValue(undefined);
});

describe("useBulkArchiveActions default copy", () => {
  test("stays word for word what every archivable table already shows", () => {
    const result: BulkArchiveActionsResult<PodmanHost> = renderActions();
    const archive: BulkActionButtonSchema<PodmanHost> = onlyAction(
      result.archiveBulkActions,
    );
    const unarchive: BulkActionButtonSchema<PodmanHost> = onlyAction(
      result.unarchiveBulkActions,
    );

    expect(archive.confirmMessage!(hosts(1))).toBe(
      "Are you sure you want to archive the selected host? They will be hidden from the list but will keep collecting telemetry. You can unarchive them anytime from the Archived tab.",
    );
    expect(archive.confirmMessage!(hosts(2))).toBe(
      "Are you sure you want to archive the selected hosts? They will be hidden from the list but will keep collecting telemetry. You can unarchive them anytime from the Archived tab.",
    );
    expect(unarchive.confirmMessage!(hosts(1))).toBe(
      "Are you sure you want to unarchive the selected host? They will reappear in the main list.",
    );
    expect(unarchive.confirmMessage!(hosts(3))).toBe(
      "Are you sure you want to unarchive the selected hosts? They will reappear in the main list.",
    );
  });

  test("an empty override is ignored rather than confirming with a blank body", () => {
    const result: BulkArchiveActionsResult<PodmanHost> = renderActions({
      archiveConfirmMessage: "",
      unarchiveConfirmMessage: "",
    });

    expect(
      onlyAction(result.archiveBulkActions).confirmMessage!(hosts(1)),
    ).toContain("will keep collecting telemetry");
    expect(
      onlyAction(result.unarchiveBulkActions).confirmMessage!(hosts(1)),
    ).toContain("They will reappear in the main list.");
  });
});

describe("useBulkArchiveActions copy overrides", () => {
  test("replace the confirmation bodies outright, for one item or many", () => {
    const result: BulkArchiveActionsResult<PodmanHost> = renderActions({
      archiveConfirmMessage: ARCHIVE_OVERRIDE,
      unarchiveConfirmMessage: UNARCHIVE_OVERRIDE,
    });

    for (const count of [1, 4]) {
      expect(
        onlyAction(result.archiveBulkActions).confirmMessage!(hosts(count)),
      ).toBe(ARCHIVE_OVERRIDE);
      expect(
        onlyAction(result.unarchiveBulkActions).confirmMessage!(hosts(count)),
      ).toBe(UNARCHIVE_OVERRIDE);
    }
  });

  test("leave the titles, which carry the count, as they were", () => {
    const result: BulkArchiveActionsResult<PodmanHost> = renderActions({
      archiveConfirmMessage: ARCHIVE_OVERRIDE,
      unarchiveConfirmMessage: UNARCHIVE_OVERRIDE,
    });

    const archive: BulkActionButtonSchema<PodmanHost> = onlyAction(
      result.archiveBulkActions,
    );
    const unarchive: BulkActionButtonSchema<PodmanHost> = onlyAction(
      result.unarchiveBulkActions,
    );

    expect(archive.title).toBe("Archive");
    expect(archive.confirmTitle!(hosts(1))).toBe("Archive 1 host?");
    expect(archive.confirmTitle!(hosts(3))).toBe("Archive 3 hosts?");
    expect(unarchive.title).toBe("Unarchive");
    expect(unarchive.confirmTitle!(hosts(2))).toBe("Unarchive 2 hosts?");
  });

  test("overriding one leaves the other's default untouched", () => {
    const result: BulkArchiveActionsResult<PodmanHost> = renderActions({
      archiveConfirmMessage: ARCHIVE_OVERRIDE,
    });

    expect(
      onlyAction(result.archiveBulkActions).confirmMessage!(hosts(1)),
    ).toBe(ARCHIVE_OVERRIDE);
    expect(
      onlyAction(result.unarchiveBulkActions).confirmMessage!(hosts(1)),
    ).toBe(
      "Are you sure you want to unarchive the selected host? They will reappear in the main list.",
    );
  });

  test("change nothing about what is written: archive sends isArchived true, unarchive false", async () => {
    const result: BulkArchiveActionsResult<PodmanHost> = renderActions({
      archiveConfirmMessage: ARCHIVE_OVERRIDE,
      unarchiveConfirmMessage: UNARCHIVE_OVERRIDE,
    });
    const items: Array<PodmanHost> = hosts(2);

    const archiveClick: ClickHarness = clickHarness(items);
    await onlyAction(result.archiveBulkActions).onClick(archiveClick.props);

    expect(updateByIdMock).toHaveBeenCalledTimes(2);
    expect(updateByIdMock).toHaveBeenNthCalledWith(1, {
      id: items[0]!.id,
      modelType: PodmanHost,
      data: { isArchived: true },
    });
    expect(updateByIdMock).toHaveBeenNthCalledWith(2, {
      id: items[1]!.id,
      modelType: PodmanHost,
      data: { isArchived: true },
    });
    expect(archiveClick.onBulkActionStart).toHaveBeenCalledTimes(1);
    expect(archiveClick.onBulkActionEnd).toHaveBeenCalledTimes(1);
    expect(archiveClick.onProgressInfo).toHaveBeenCalledTimes(2);

    updateByIdMock.mockClear();

    const unarchiveClick: ClickHarness = clickHarness([items[0]!]);
    await onlyAction(result.unarchiveBulkActions).onClick(unarchiveClick.props);

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateByIdMock).toHaveBeenCalledWith({
      id: items[0]!.id,
      modelType: PodmanHost,
      data: { isArchived: false },
    });
  });

  test("do not unlock the actions for someone who may not update", () => {
    permissionsForTest = [Permission.Viewer];

    const result: BulkArchiveActionsResult<PodmanHost> = renderActions({
      archiveConfirmMessage: ARCHIVE_OVERRIDE,
      unarchiveConfirmMessage: UNARCHIVE_OVERRIDE,
    });

    expect(onlyAction(result.archiveBulkActions).disabled).toBe(true);
    expect(onlyAction(result.archiveBulkActions).tooltip).toContain(
      "You do not have permission to update",
    );
    expect(onlyAction(result.unarchiveBulkActions).disabled).toBe(true);
    // The copy survives the gate, so the locked item still says what it would do.
    expect(
      onlyAction(result.archiveBulkActions).confirmMessage!(hosts(1)),
    ).toBe(ARCHIVE_OVERRIDE);
  });
});

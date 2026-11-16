import GlobalConfigService, {
  RESOLVED_RECORD_RETENTION_LIMIT_COLUMNS,
  ResolvedRecordRetentionLimitColumns,
  Service as GlobalConfigServiceClass,
} from "../../../Server/Services/GlobalConfigService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import {
  RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
  ResolvedRecordKind,
} from "../../../Types/Retention/ResolvedRecordRetention";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE SERVER'S LIMITS ON RESOLVED INCIDENTS AND ALERTS (issue #6941), as
 * GlobalConfig stores them: Admin Dashboard > Settings > Data Retention's
 * maximum and new-project default for each kind. What is pinned: every
 * server starts with none (empty columns), only one of the project choices
 * or empty is stored, a default never exceeds its maximum - refused when it
 * is written so, taken down with the maximum when that is lowered under it -
 * and only master admins write them.
 */

const apply: (
  data: Record<string, unknown>,
  stored?: Record<string, unknown>,
) => Record<string, unknown> = (
  data: Record<string, unknown>,
  stored: Record<string, unknown> = {},
): Record<string, unknown> => {
  GlobalConfigServiceClass.applyResolvedRecordRetentionLimitRules(data, stored);
  return data;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the columns", () => {
  test("two a kind, each named for what it holds", () => {
    expect(RESOLVED_RECORD_RETENTION_LIMIT_COLUMNS).toEqual([
      {
        kind: ResolvedRecordKind.Incident,
        maximumColumn: "maxIncidentRetentionInDays",
        defaultColumn: "defaultIncidentRetentionInDays",
      },
      {
        kind: ResolvedRecordKind.Alert,
        maximumColumn: "maxAlertRetentionInDays",
        defaultColumn: "defaultAlertRetentionInDays",
      },
    ]);
  });

  test.each(
    RESOLVED_RECORD_RETENTION_LIMIT_COLUMNS.flatMap(
      (limit: ResolvedRecordRetentionLimitColumns): Array<string> => {
        return [limit.maximumColumn, limit.defaultColumn];
      },
    ),
  )(
    "%s: an empty number on every server, which only a master admin writes",
    (column: string) => {
      const config: GlobalConfig = new GlobalConfig();
      const metadata: { type: TableColumnType; required?: boolean } =
        config.getTableColumnMetadata(column) as unknown as {
          type: TableColumnType;
          required?: boolean;
        };

      expect(metadata.type).toBe(TableColumnType.Number);
      expect(metadata.required).toBeFalsy();
      expect(config.getColumnAccessControlFor(column)).toEqual({
        create: [],
        read: [],
        update: [],
      });
    },
  );
});

describe("GlobalConfigService.applyResolvedRecordRetentionLimitRules", () => {
  test("a choice is stored as its number, and empty, 0 or blank as null", () => {
    expect(
      apply({
        maxIncidentRetentionInDays: "365",
        defaultIncidentRetentionInDays: 90,
        maxAlertRetentionInDays: 0,
        defaultAlertRetentionInDays: "",
      }),
    ).toEqual({
      maxIncidentRetentionInDays: 365,
      defaultIncidentRetentionInDays: 90,
      maxAlertRetentionInDays: null,
      defaultAlertRetentionInDays: null,
    });
  });

  test.each([45, -1, 4000, "soon", true])(
    "a maximum of %p is refused with the choices",
    (value: unknown) => {
      expect(() => {
        apply({ maxAlertRetentionInDays: value });
      }).toThrow(
        "Pick the longest a project keeps a resolved alert: 30, 60, 90, 180, 365, 730 or 1095 days, or leave it empty for no maximum.",
      );
    },
  );

  test.each([45, -1, 4000, "soon"])(
    "a default of %p is refused with the choices",
    (value: unknown) => {
      expect(() => {
        apply({ defaultIncidentRetentionInDays: value });
      }).toThrow(
        "Pick how long a new project keeps a resolved incident: 30, 60, 90, 180, 365, 730 or 1095 days, or leave it empty for Never.",
      );
    },
  );

  test("a default longer than the maximum written with it is refused", () => {
    expect(() => {
      apply({
        maxIncidentRetentionInDays: 90,
        defaultIncidentRetentionInDays: 365,
      });
    }).toThrow(
      "A new project can keep a resolved incident for at most 90 days, the server's maximum. Pick that or less.",
    );
  });

  test("a default longer than the stored maximum is refused", () => {
    expect(() => {
      apply(
        { defaultAlertRetentionInDays: 1095 },
        { maxAlertRetentionInDays: 730 },
      );
    }).toThrow("at most 730 days");
  });

  test("a default up to the maximum, or Never, is stored", () => {
    for (const days of [30, 90, 365]) {
      expect(
        apply(
          { defaultIncidentRetentionInDays: days },
          { maxIncidentRetentionInDays: 365 },
        ),
      ).toEqual({ defaultIncidentRetentionInDays: days });
    }

    expect(
      apply(
        { defaultIncidentRetentionInDays: null },
        { maxIncidentRetentionInDays: 30 },
      ),
    ).toEqual({ defaultIncidentRetentionInDays: null });
  });

  test("removing the maximum lets a longer default be written with it", () => {
    expect(
      apply(
        {
          maxIncidentRetentionInDays: null,
          defaultIncidentRetentionInDays: 1095,
        },
        { maxIncidentRetentionInDays: 90 },
      ),
    ).toEqual({
      maxIncidentRetentionInDays: null,
      defaultIncidentRetentionInDays: 1095,
    });
  });

  test("lowering the maximum under the stored default takes the default down with it", () => {
    expect(
      apply(
        { maxAlertRetentionInDays: 90 },
        { maxAlertRetentionInDays: null, defaultAlertRetentionInDays: 365 },
      ),
    ).toEqual({
      maxAlertRetentionInDays: 90,
      defaultAlertRetentionInDays: 90,
    });
  });

  test("a maximum above the stored default, or a default of Never, leaves the default alone", () => {
    expect(
      apply(
        { maxAlertRetentionInDays: 365 },
        { defaultAlertRetentionInDays: 90 },
      ),
    ).toEqual({ maxAlertRetentionInDays: 365 });
    expect(
      apply(
        { maxAlertRetentionInDays: 30 },
        { defaultAlertRetentionInDays: null },
      ),
    ).toEqual({ maxAlertRetentionInDays: 30 });
  });

  test("each kind is judged on its own columns", () => {
    expect(
      apply(
        { maxIncidentRetentionInDays: 30 },
        { defaultAlertRetentionInDays: 1095 },
      ),
    ).toEqual({ maxIncidentRetentionInDays: 30 });
  });

  test("a write that names none of them is not judged on them", () => {
    expect(apply({ monitorLogRetentionInDays: 7 })).toEqual({
      monitorLogRetentionInDays: 7,
    });
  });

  test("every choice is a maximum and a default", () => {
    for (const days of RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS) {
      expect(
        apply({
          maxIncidentRetentionInDays: days,
          defaultIncidentRetentionInDays: days,
        }),
      ).toEqual({
        maxIncidentRetentionInDays: days,
        defaultIncidentRetentionInDays: days,
      });
    }
  });
});

describe("on every update of the config", () => {
  interface HookAccess {
    onBeforeUpdate(
      updateBy: UpdateBy<GlobalConfig>,
    ): Promise<OnUpdate<GlobalConfig>>;
  }

  const hooks: HookAccess = GlobalConfigService as unknown as HookAccess;

  test("the stored limits are read only when a write names one, as OneUptime, and the rule holds the write to them", async () => {
    const stored: GlobalConfig = new GlobalConfig();
    stored.maxIncidentRetentionInDays = 90;

    const find: SpyInstance<typeof GlobalConfigService.findOneById> = jest
      .spyOn(GlobalConfigService, "findOneById")
      .mockResolvedValue(stored);

    await expect(
      hooks.onBeforeUpdate({
        query: { _id: ObjectID.getZeroObjectID().toString() },
        data: { defaultIncidentRetentionInDays: 365 },
        props: { isRoot: true },
      } as unknown as UpdateBy<GlobalConfig>),
    ).rejects.toThrow("at most 90 days");

    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0]![0].props).toEqual({ isRoot: true });
    expect(find.mock.calls[0]![0].id.toString()).toBe(
      ObjectID.getZeroObjectID().toString(),
    );
  });

  test("an update of anything else reads nothing for them", async () => {
    const find: SpyInstance<typeof GlobalConfigService.findOneById> = jest
      .spyOn(GlobalConfigService, "findOneById")
      .mockResolvedValue(null);

    await hooks.onBeforeUpdate({
      query: { _id: ObjectID.getZeroObjectID().toString() },
      data: { monitorLogRetentionInDays: 3 },
      props: { isRoot: true },
    } as unknown as UpdateBy<GlobalConfig>);

    expect(find).not.toHaveBeenCalled();
  });
});

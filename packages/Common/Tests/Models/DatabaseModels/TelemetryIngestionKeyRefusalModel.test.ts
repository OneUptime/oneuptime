import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyRefusal from "../../../Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import { TELEMETRY_INGEST_REFUSAL_REASON_FOR_KEY_REFUSAL } from "../../../Server/Utils/Telemetry/TelemetryIngestionKeyGuard";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Permission from "../../../Types/Permission";
import {
  ALL_TELEMETRY_INGEST_REFUSAL_REASONS,
  PROJECT_WIDE_TELEMETRY_INGEST_REFUSAL_REASONS,
  TelemetryIngestRefusalReason,
  UNNAMED_TELEMETRY_INGEST_SURFACE,
  getTelemetryIngestRefusalReasonForBudget,
  isTelemetryIngestRefusalReason,
} from "../../../Types/Telemetry/TelemetryIngestRefusal";
import {
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";
import { describe, expect, test } from "@jest/globals";

/*
 * Refused telemetry, counted per ingestion key (issue #6378): the table the
 * RUM setup check and the key's page read, and the reasons it stores.
 *
 *   - registered, on its own route, a project's;
 *   - read by whoever may read the key - the rows name it - and written by
 *     nobody through the API: the ingest endpoints count, nobody edits;
 *   - one row per key, reason and surface (the upsert's ON CONFLICT target);
 *   - the reasons are stored values: they never change, and each one is
 *     either the project's (any key would have been refused) or the key's.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

describe("TelemetryIngestionKeyRefusal", () => {
  const model: TelemetryIngestionKeyRefusal =
    new TelemetryIngestionKeyRefusal();

  test("is registered, on a route of its own, and is a project's", () => {
    expect(MODEL_TYPES).toContain(TelemetryIngestionKeyRefusal);
    expect(model.tableName).toBe("TelemetryIngestionKeyRefusal");
    expect(model.getCrudApiPath()!.toString()).toBe(
      "/telemetry-ingestion-key-refusal",
    );
    expect(
      MODEL_TYPES.filter((modelType: ModelType): boolean => {
        return (
          new modelType().getCrudApiPath()?.toString() ===
          "/telemetry-ingestion-key-refusal"
        );
      }),
    ).toEqual([TelemetryIngestionKeyRefusal]);
    expect(model.getTenantColumn()).toBe("projectId");
  });

  test("is read by whoever may read the key, and by nobody else", () => {
    expect(model.getReadPermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadTelemetryIngestionKey,
    ]);

    const keyReads: Array<Permission> =
      new TelemetryIngestionKey().getReadPermissions();

    for (const permission of model.getReadPermissions()) {
      expect({
        permission,
        readsTheKey: keyReads.includes(permission),
      }).toEqual({ permission, readsTheKey: true });
    }
  });

  test("nobody writes it through the API: no create, update or delete, on the table or any column", () => {
    expect(model.getCreatePermissions()).toEqual([]);
    expect(model.getUpdatePermissions()).toEqual([]);
    expect(model.getDeletePermissions()).toEqual([]);

    const columnAccess: Record<string, ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    expect(Object.keys(columnAccess).length).toBeGreaterThan(0);

    for (const [column, access] of Object.entries(columnAccess)) {
      expect({ column, create: access.create, update: access.update }).toEqual({
        column,
        create: [],
        update: [],
      });
    }
  });

  test("holds the key, the reason, the surface, the count and the first and latest refusal", () => {
    const columns: Array<string> = model.getTableColumns().columns;

    for (const column of [
      "projectId",
      "telemetryIngestionKeyId",
      "reason",
      "surface",
      "refusedCount",
      "firstRefusedAt",
      "lastRefusedAt",
    ]) {
      expect({ column, present: columns.includes(column) }).toEqual({
        column,
        present: true,
      });
      expect({
        column,
        required: model.getTableColumnMetadata(column).required,
      }).toEqual({ column, required: true });
    }

    expect(
      model.getTableColumnMetadata("telemetryIngestionKey").modelType,
    ).toBe(TelemetryIngestionKey);
  });
});

describe("the refusal reasons it stores", () => {
  test("are these values, which never change (a new reason is a new value)", () => {
    expect([...ALL_TELEMETRY_INGEST_REFUSAL_REASONS]).toEqual([
      "key-disabled",
      "key-expired",
      "origin-not-allowed",
      "browser-key-not-allowed-here",
      "pinned-key-not-allowed-here",
      "key-requests-per-minute",
      "key-daily-budget",
      "key-ingestion-rate",
      "project-daily-budget",
      "project-ingestion-rate",
      "payment-required",
      "project-blocked",
    ]);
  });

  test("each fits the column (100 characters), and so does every surface name", () => {
    for (const reason of ALL_TELEMETRY_INGEST_REFUSAL_REASONS) {
      expect(reason.length).toBeLessThanOrEqual(100);
    }

    for (const surface of [
      ...Object.values(TelemetryIngestSurface),
      UNNAMED_TELEMETRY_INGEST_SURFACE,
    ]) {
      expect(surface.length).toBeLessThanOrEqual(100);
    }

    // The legacy guard's name is no surface's.
    expect(Object.values(TelemetryIngestSurface)).not.toContain(
      UNNAMED_TELEMETRY_INGEST_SURFACE,
    );
  });

  test("the project's own: budgets and rate of the project, billing, a block", () => {
    expect(
      ALL_TELEMETRY_INGEST_REFUSAL_REASONS.filter(
        (reason: TelemetryIngestRefusalReason): boolean => {
          return PROJECT_WIDE_TELEMETRY_INGEST_REFUSAL_REASONS.has(reason);
        },
      ),
    ).toEqual([
      TelemetryIngestRefusalReason.ProjectDailyBudget,
      TelemetryIngestRefusalReason.ProjectIngestionRate,
      TelemetryIngestRefusalReason.PaymentRequired,
      TelemetryIngestRefusalReason.ProjectBlocked,
    ]);
  });

  test("a value read back is told apart from anything else", () => {
    for (const reason of ALL_TELEMETRY_INGEST_REFUSAL_REASONS) {
      expect(isTelemetryIngestRefusalReason(reason)).toBe(true);
    }

    for (const value of [
      "",
      "KeyDisabled",
      "key-disabled ",
      "unknown-reason",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isTelemetryIngestRefusalReason(value)).toBe(false);
    }
  });

  test("an ingestion budget refusal is the key's or the project's, by its scope, and a rate or a daily budget, by its kind", () => {
    const answers: Array<[string, string, TelemetryIngestRefusalReason]> = [];

    for (const kind of Object.values(TelemetryIngestionBudgetRefusalKind)) {
      for (const scope of Object.values(TelemetryIngestionBudgetScope)) {
        answers.push([
          kind,
          scope,
          getTelemetryIngestRefusalReasonForBudget({ kind, scope }),
        ]);
      }
    }

    expect(answers).toEqual([
      [
        TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
        TelemetryIngestionBudgetScope.Project,
        TelemetryIngestRefusalReason.ProjectDailyBudget,
      ],
      [
        TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
        TelemetryIngestionBudgetScope.IngestionKey,
        TelemetryIngestRefusalReason.KeyDailyBudget,
      ],
      [
        TelemetryIngestionBudgetRefusalKind.RateLimited,
        TelemetryIngestionBudgetScope.Project,
        TelemetryIngestRefusalReason.ProjectIngestionRate,
      ],
      [
        TelemetryIngestionBudgetRefusalKind.RateLimited,
        TelemetryIngestionBudgetScope.IngestionKey,
        TelemetryIngestRefusalReason.KeyIngestionRate,
      ],
    ]);
  });

  test("the key guard's refusals (gRPC, MQTT) are each the key's own reason, none shared", () => {
    const reasons: Array<TelemetryIngestRefusalReason> = Object.values(
      TELEMETRY_INGEST_REFUSAL_REASON_FOR_KEY_REFUSAL,
    );

    expect(new Set(reasons).size).toBe(reasons.length);

    for (const reason of reasons) {
      expect(PROJECT_WIDE_TELEMETRY_INGEST_REFUSAL_REASONS.has(reason)).toBe(
        false,
      );
    }
  });
});

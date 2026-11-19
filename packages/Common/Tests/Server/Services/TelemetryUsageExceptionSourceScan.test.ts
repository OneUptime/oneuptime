import AnalyticsDatabaseService, {
  TelemetryUsageAttributeFilter,
} from "../../../Server/Services/AnalyticsDatabaseService";
import { ExceptionInstanceService } from "../../../Server/Services/ExceptionInstanceService";
import { LogService } from "../../../Server/Services/LogService";
import { Service as MonitorLogService } from "../../../Server/Services/MonitorLogService";
import { SpanService } from "../../../Server/Services/SpanService";
import { getBilledExceptionsFilter } from "../../../Server/Services/TelemetryUsageBillingService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import {
  EXCEPTION_BILLING_PRODUCT_TYPES,
  EXCEPTION_SOURCE_ATTRIBUTE,
  EXCEPTION_SOURCE_PRODUCT_TYPES,
  ExceptionSource,
  getExceptionSourceBilledBy,
  isExceptionBillingProductType,
} from "../../../Types/Telemetry/ExceptionSource";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #6590: one table (ExceptionInstance) holds the exceptions found in
 * spans and the ones found in logs, and each is billed by the product that
 * found it. The usage scans tell them apart by the `exception.source`
 * attribute, inside the WHERE, before anything is counted or sized. These
 * pin the SQL with no ClickHouse in the loop, as
 * GroupTelemetryUsageExcludeNames.test.ts does for the metric names.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "65900000-1111-4111-8111-111111111111",
);
const START: Date = new Date("2026-10-22T00:00:00.000Z");
const END: Date = new Date("2026-10-22T23:59:59.999Z");

const UNFILTERED_SCAN: string =
  "SELECT primaryEntityId AS primaryEntityId, primaryEntityType AS primaryEntityType, count() AS rowCount, sum(byteSize(*)) AS estimatedBytes FROM {p0:Identifier}.{p1:Identifier} WHERE projectId = {p2:String} AND {p3:Identifier} >= {p4:DateTime64(9)} AND {p5:Identifier} <= {p6:DateTime64(9)} GROUP BY primaryEntityId, primaryEntityType";

interface Captured {
  query: string | null;
  params: Record<string, unknown> | null;
}

function capture<TBaseModel extends AnalyticsBaseModel>(
  service: AnalyticsDatabaseService<TBaseModel>,
): Captured {
  const captured: Captured = { query: null, params: null };

  service.executeQuery = ((statement: Statement): Promise<unknown> => {
    captured.query = statement.query;
    captured.params = statement.query_params;

    return Promise.resolve({
      json: (): Promise<{ data: Array<unknown> }> => {
        return Promise.resolve({ data: [] });
      },
    });
  }) as unknown as typeof service.executeQuery;

  return captured;
}

function beforeSettings(query: string | null): string {
  expect(query).not.toBeNull();

  return query!.slice(0, query!.indexOf(" SETTINGS "));
}

describe("the exception sources", () => {
  test("each source is billed by one product, and the two products are Traces and Logs", () => {
    expect(EXCEPTION_SOURCE_ATTRIBUTE).toBe("exception.source");
    expect(EXCEPTION_SOURCE_PRODUCT_TYPES).toEqual({
      [ExceptionSource.Span]: ProductType.Traces,
      [ExceptionSource.Log]: ProductType.Logs,
    });
    expect(getExceptionSourceBilledBy(ProductType.Traces)).toBe(
      ExceptionSource.Span,
    );
    expect(getExceptionSourceBilledBy(ProductType.Logs)).toBe(
      ExceptionSource.Log,
    );
    expect([...EXCEPTION_BILLING_PRODUCT_TYPES]).toEqual([
      ProductType.Traces,
      ProductType.Logs,
    ]);

    for (const productType of Object.values(ProductType)) {
      const billsExceptions: boolean =
        productType === ProductType.Traces || productType === ProductType.Logs;

      expect({
        productType,
        billsExceptions: isExceptionBillingProductType(productType),
        source: getExceptionSourceBilledBy(productType),
      }).toEqual({
        productType,
        billsExceptions,
        source: billsExceptions
          ? productType === ProductType.Traces
            ? ExceptionSource.Span
            : ExceptionSource.Log
          : null,
      });
    }
  });
});

describe("a usage scan by an exception source", () => {
  test.each([
    [ProductType.Logs, "="],
    [ProductType.Traces, "!="],
  ])(
    "reads the rows %s bills: the source attribute %s 'log', as parameters",
    async (productType: ProductType, operator: string) => {
      const service: ExceptionInstanceService = new ExceptionInstanceService();
      const captured: Captured = capture(service);

      await service.groupTelemetryUsageByService({
        projectId: PROJECT_ID,
        timestampColumnName: "time",
        startDate: START,
        endDate: END,
        attributeFilter: getBilledExceptionsFilter(productType),
      });

      expect(beforeSettings(captured.query)).toBe(
        UNFILTERED_SCAN.replace(
          " GROUP BY",
          ` AND attributes[{p7:String}] ${operator} {p8:String} GROUP BY`,
        ),
      );
      expect(captured.params!["p1"]).toBe("ExceptionItemV3");
      expect(captured.params!["p7"]).toBe(EXCEPTION_SOURCE_ATTRIBUTE);
      expect(captured.params!["p8"]).toBe(ExceptionSource.Log);
    },
  );

  test("without a filter, the statement is exactly what it was", async () => {
    const service: ExceptionInstanceService = new ExceptionInstanceService();
    const captured: Captured = capture(service);

    await service.groupTelemetryUsageByService({
      projectId: PROJECT_ID,
      timestampColumnName: "time",
      startDate: START,
      endDate: END,
    });

    expect(beforeSettings(captured.query)).toBe(UNFILTERED_SCAN);
    expect(Object.keys(captured.params!)).toHaveLength(7);
  });

  test("the days with rows read the same filter", async () => {
    const service: ExceptionInstanceService = new ExceptionInstanceService();
    const captured: Captured = capture(service);

    await service.getDaysWithRows({
      projectId: PROJECT_ID,
      timestampColumnName: "time",
      startDate: START,
      endDate: END,
      attributeFilter: getBilledExceptionsFilter(ProductType.Logs),
    });

    // Its first parameter is the day's column, so the filter's come later.
    expect(captured.query).toContain(
      " AND attributes[{p8:String}] = {p9:String} GROUP BY day ORDER BY day",
    );
    expect(captured.params!["p8"]).toBe(EXCEPTION_SOURCE_ATTRIBUTE);
    expect(captured.params!["p9"]).toBe(ExceptionSource.Log);
  });

  test("a key or a value is never SQL: an odd one travels as a parameter", async () => {
    const service: ExceptionInstanceService = new ExceptionInstanceService();
    const captured: Captured = capture(service);
    const filter: TelemetryUsageAttributeFilter = {
      key: "x'] OR 1=1 --",
      value: "' OR '1'='1",
      isEqual: true,
    };

    await service.groupTelemetryUsageByService({
      projectId: PROJECT_ID,
      timestampColumnName: "time",
      startDate: START,
      endDate: END,
      attributeFilter: filter,
    });

    // Both travel as parameters (one with a quote hex-encoded), never as SQL.
    expect(captured.query).not.toContain("OR 1=1");
    expect(captured.query).not.toContain("'1'='1");
    expect(captured.query).toContain(
      " AND attributes[{p7:String}] = unhex({p8:String}) GROUP BY",
    );
    expect(captured.params!["p7"]).toBeDefined();
    expect(captured.params!["p8"]).toBeDefined();
  });

  test("refuses a table with no attributes map, before the scan", async () => {
    const service: MonitorLogService = new MonitorLogService();
    const captured: Captured = capture(service);

    expect(service.model.getTableColumn("attributes")).toBeNull();

    await expect(
      service.groupTelemetryUsageByService({
        projectId: PROJECT_ID,
        timestampColumnName: "time",
        startDate: START,
        endDate: END,
        attributeFilter: getBilledExceptionsFilter(ProductType.Traces),
      }),
    ).rejects.toThrow(BadDataException);
    await expect(
      service.getDaysWithRows({
        projectId: PROJECT_ID,
        timestampColumnName: "time",
        startDate: START,
        endDate: END,
        attributeFilter: getBilledExceptionsFilter(ProductType.Logs),
      }),
    ).rejects.toThrow(
      "attributeFilter needs a required attributes map, and MonitorLogV3 has none",
    );
    expect(captured.query).toBeNull();
  });

  test("reads a span or log table's attributes map as readily", async () => {
    for (const service of [new SpanService(), new LogService()]) {
      const captured: Captured = capture(
        service as AnalyticsDatabaseService<AnalyticsBaseModel>,
      );

      await service.groupTelemetryUsageByService({
        projectId: PROJECT_ID,
        timestampColumnName:
          service instanceof SpanService ? "startTime" : "time",
        startDate: START,
        endDate: END,
        attributeFilter: { key: "k", value: "v", isEqual: true },
      });

      expect(captured.query).toContain(
        "AND attributes[{p7:String}] = {p8:String}",
      );
    }
  });

  test("refuses a filter with no key", async () => {
    const service: LogService = new LogService();
    const captured: Captured = capture(service);

    await expect(
      service.groupTelemetryUsageByService({
        projectId: PROJECT_ID,
        timestampColumnName: "time",
        startDate: START,
        endDate: END,
        attributeFilter: { key: "", value: "log", isEqual: true },
      }),
    ).rejects.toThrow("attributeFilter needs a key.");
    expect(captured.query).toBeNull();
  });
});

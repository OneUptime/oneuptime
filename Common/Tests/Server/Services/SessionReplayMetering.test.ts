import { describe, expect, it } from "@jest/globals";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import AllMeteredPlans, {
  MeteredPlanUtil,
  SessionReplayDataIngestMeteredPlan,
} from "../../../Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import ServerMeteredPlan from "../../../Server/Types/Billing/MeteredPlan/ServerMeteredPlan";
import TelemetryMeteredPlan from "../../../Server/Types/Billing/MeteredPlan/TelemetryMeteredPlan";
import { RumSessionService as RumSessionServiceType } from "../../../Server/Services/RumSessionService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";

/*
 * Session replay has to be a first-class metered product alongside logs,
 * traces, metrics and profiles.
 *
 * Several sites in this path throw on an unrecognised ProductType, so a
 * half-finished registration does not degrade gracefully - it breaks the
 * telemetry billing run for every pillar. Each of those sites is pinned here.
 */

describe("Session replay metered plan registration", () => {
  it("is a ProductType", () => {
    expect(ProductType.SessionReplay).toBe("Session Replay");
  });

  it("resolves through MeteredPlanUtil instead of throwing", () => {
    /*
     * getMeteredPlanByProductType throws BadDataException on an unknown type.
     * Adding the enum member without this branch would make every metered
     * billing run fail the moment it reached session replay.
     */
    const plan: ServerMeteredPlan = MeteredPlanUtil.getMeteredPlanByProductType(
      ProductType.SessionReplay,
    );

    expect(plan).toBe(SessionReplayDataIngestMeteredPlan);
    expect(plan.getProductType()).toBe(ProductType.SessionReplay);
  });

  it("is registered in the AllMeteredPlans array", () => {
    const productTypes: Array<ProductType> = AllMeteredPlans.map(
      (plan: ServerMeteredPlan): ProductType => {
        return plan.getProductType();
      },
    );

    expect(productTypes).toContain(ProductType.SessionReplay);
  });

  it("is a telemetry metered plan, so it bills on GB x retention-days", () => {
    expect(SessionReplayDataIngestMeteredPlan).toBeInstanceOf(
      TelemetryMeteredPlan,
    );
  });

  it("is priced above the other telemetry pillars", () => {
    /*
     * At telemetry parity (0.1 / 15) a project recording 100k sessions a month
     * bills under a dollar, which does not cover cost. This asserts the
     * deliberate divergence rather than the exact number, so a future price
     * change does not have to touch this test unless it drops back to parity.
     */
    const telemetryParityRate: number = 0.1 / 15;
    const sessionReplayPlan: TelemetryMeteredPlan =
      SessionReplayDataIngestMeteredPlan;

    expect(sessionReplayPlan.unitCostInUSD).toBeGreaterThan(
      telemetryParityRate,
    );
  });

  it("every registered plan resolves back to itself", () => {
    /*
     * Guards the enum and the util from drifting apart in either direction.
     */
    for (const plan of AllMeteredPlans) {
      expect(
        MeteredPlanUtil.getMeteredPlanByProductType(plan.getProductType()),
      ).toBe(plan);
    }
  });
});

describe("Session replay usage aggregation SQL", () => {
  /*
   * This query is the one place a mistake becomes unrecoverable revenue loss
   * rather than a visible error, so its shape is pinned rather than trusted.
   *
   * stageTelemetryUsageForProject always targets YESTERDAY, rethrows, and the
   * caller only logs - nothing ever re-stages an older date. So if this query
   * times out, that day is billed as zero permanently.
   */
  async function captureUsageQuery(): Promise<string> {
    const service: RumSessionServiceType = new RumSessionServiceType();

    let captured: string = "";

    /*
     * Capture the statement instead of running it: this asserts the SQL we
     * generate, with no ClickHouse in the loop.
     */
    service.executeQuery = ((statement: Statement): Promise<unknown> => {
      captured = `${statement.query} :: ${JSON.stringify(
        statement.query_params,
      )}`;

      return Promise.resolve({
        json: (): Promise<{ data: Array<JSONObject> }> => {
          return Promise.resolve({ data: [] });
        },
      });
    }) as unknown as typeof service.executeQuery;

    await service.groupSessionReplayUsageByEntity({
      projectId: new ObjectID("6512f3a9b7c4d2e108f5a3b9"),
      startDate: OneUptimeDate.getCurrentDate(),
      endDate: OneUptimeDate.getCurrentDate(),
    });

    return captured;
  }

  it("meters off the session header table", async () => {
    expect(await captureUsageQuery()).toContain("RumSessionV1");
  });

  it("NEVER touches the chunk table", async () => {
    /*
     * Chunks are partitioned by expiry date, so a "yesterday" window over them
     * cannot prune partitions. It would full-scan a multi-gigabyte blob table
     * under the 120s cap and bill the day as zero.
     */
    expect(await captureUsageQuery()).not.toContain("RumSessionChunkV1");
  });

  it("sums the exact payloadBytes rather than byteSize(*)", async () => {
    const sql: string = await captureUsageQuery();

    expect(sql).toContain("sum(payloadBytes)");
    expect(sql).not.toContain("byteSize");
  });

  it("excludes provisional headers, whose aggregates are still zero", async () => {
    expect(await captureUsageQuery()).toContain("isFinalized = 1");
  });

  it("collapses ReplacingMergeTree versions, since this repo has no FINAL", async () => {
    /*
     * Without the dedupe an un-merged duplicate header would be summed twice
     * and the project over-billed.
     */
    const sql: string = await captureUsageQuery();

    expect(sql).toContain("LIMIT 1 BY");
    expect(sql).toContain("ORDER BY version DESC");
  });

  it("does not let a partial aggregation look like a complete one", async () => {
    /*
     * Deliberately no timeout_overflow_mode='break': that returns partial
     * results WITHOUT erroring, which would silently undercount.
     */
    expect(await captureUsageQuery()).not.toContain("timeout_overflow_mode");
  });

  it("groups by the owning entity so usage is attributable", async () => {
    expect(await captureUsageQuery()).toContain(
      "GROUP BY primaryEntityId, primaryEntityType",
    );
  });
});

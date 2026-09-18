import { describe, expect, it } from "@jest/globals";
import {
  SESSION_REPLAY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_RETENTION_IN_DAYS,
} from "../../../../Types/Billing/PayAsYouGoPricing";
import {
  LogDataIngestMeteredPlan,
  MetricsDataIngestMeteredPlan,
  ProfilesDataIngestMeteredPlan,
  SessionReplayDataIngestMeteredPlan,
  TracesDataIngestMetredPlan,
} from "../../../../Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import TelemetryMeteredPlan from "../../../../Server/Types/Billing/MeteredPlan/TelemetryMeteredPlan";

/*
 * The dashboard now quotes the telemetry rate to Free plan users before they
 * create an ingestion key. A quoted price that does not match the metered one
 * is a promise we break on the invoice, so the two are pinned together here:
 * the metered plans must charge exactly the advertised per-GB rate at the
 * advertised retention.
 */

/*
 * Session replay rides on the same ingestion key at its own, much higher rate,
 * so it is listed here with its own expected figure rather than left out - a
 * plan missing from this table is a plan whose price the UI can misquote.
 */
const TELEMETRY_PLANS: Array<{
  name: string;
  plan: TelemetryMeteredPlan;
  pricePerGB: number;
}> = [
  {
    name: "logs",
    plan: LogDataIngestMeteredPlan,
    pricePerGB: TELEMETRY_PRICE_IN_USD_PER_GB,
  },
  {
    name: "metrics",
    plan: MetricsDataIngestMeteredPlan,
    pricePerGB: TELEMETRY_PRICE_IN_USD_PER_GB,
  },
  {
    name: "traces",
    plan: TracesDataIngestMetredPlan,
    pricePerGB: TELEMETRY_PRICE_IN_USD_PER_GB,
  },
  {
    name: "profiles",
    plan: ProfilesDataIngestMeteredPlan,
    pricePerGB: TELEMETRY_PRICE_IN_USD_PER_GB,
  },
  {
    name: "session replay",
    plan: SessionReplayDataIngestMeteredPlan,
    pricePerGB: SESSION_REPLAY_PRICE_IN_USD_PER_GB,
  },
];

describe("Telemetry metered plans charge the advertised pay as you go rate", () => {
  it.each(TELEMETRY_PLANS)(
    "$name: 1 GB retained for the advertised window costs the advertised per-GB price",
    ({
      plan,
      pricePerGB,
    }: {
      plan: TelemetryMeteredPlan;
      pricePerGB: number;
    }) => {
      expect(
        plan.getTotalCostInUSD({
          dataIngestedInGB: 1,
          retentionInDays: TELEMETRY_PRICE_RETENTION_IN_DAYS,
        }),
      ).toBeCloseTo(pricePerGB, 10);
    },
  );

  it("prices session replay well above the other pillars, as intended", () => {
    /*
     * Not incidental: the gap is why in-app copy cannot quote one rate for
     * "data sent with this ingestion key".
     */
    expect(SESSION_REPLAY_PRICE_IN_USD_PER_GB).toBeGreaterThan(
      TELEMETRY_PRICE_IN_USD_PER_GB,
    );
    expect(SESSION_REPLAY_PRICE_IN_USD_PER_GB).toBe(2);
  });

  it.each(TELEMETRY_PLANS)(
    "$name: cost scales linearly with volume and retention",
    ({
      plan,
      pricePerGB,
    }: {
      plan: TelemetryMeteredPlan;
      pricePerGB: number;
    }) => {
      expect(
        plan.getTotalCostInUSD({
          dataIngestedInGB: 10,
          retentionInDays: TELEMETRY_PRICE_RETENTION_IN_DAYS,
        }),
      ).toBeCloseTo(pricePerGB * 10, 10);

      // Twice the advertised retention is twice the advertised price.
      expect(
        plan.getTotalCostInUSD({
          dataIngestedInGB: 1,
          retentionInDays: TELEMETRY_PRICE_RETENTION_IN_DAYS * 2,
        }),
      ).toBeCloseTo(pricePerGB * 2, 10);
    },
  );

  it("charges nothing for no data", () => {
    expect(
      LogDataIngestMeteredPlan.getTotalCostInUSD({
        dataIngestedInGB: 0,
        retentionInDays: TELEMETRY_PRICE_RETENTION_IN_DAYS,
      }),
    ).toBe(0);
  });
});

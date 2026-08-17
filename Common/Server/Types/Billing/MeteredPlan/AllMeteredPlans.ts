import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import ActiveMonitoringMeteredPlanType from "./ActiveMonitoringMeteredPlan";
import ServerMeteredPlan from "./ServerMeteredPlan";
import TelemetryMeteredPlanType from "./TelemetryMeteredPlan";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import {
  SESSION_REPLAY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_RETENTION_IN_DAYS,
} from "../../../../Types/Billing/PayAsYouGoPricing";

/*
 * Per GB per day, derived from the advertised per-GB-per-15-days rate so the
 * price the dashboard quotes a Free plan user and the price we actually meter
 * cannot drift apart.
 */
const TELEMETRY_UNIT_COST_IN_USD: number =
  TELEMETRY_PRICE_IN_USD_PER_GB / TELEMETRY_PRICE_RETENTION_IN_DAYS;

export const ActiveMonitoringMeteredPlan: ActiveMonitoringMeteredPlanType =
  new ActiveMonitoringMeteredPlanType();

export const LogDataIngestMeteredPlan: TelemetryMeteredPlanType =
  new TelemetryMeteredPlanType({
    productType: ProductType.Logs,
    unitCostInUSD: TELEMETRY_UNIT_COST_IN_USD, // 0.10 per 15 days per GB
  });

export const MetricsDataIngestMeteredPlan: TelemetryMeteredPlanType =
  new TelemetryMeteredPlanType({
    productType: ProductType.Metrics,
    unitCostInUSD: TELEMETRY_UNIT_COST_IN_USD, // 0.10 per 15 days per GB
  });

export const TracesDataIngestMetredPlan: TelemetryMeteredPlanType =
  new TelemetryMeteredPlanType({
    productType: ProductType.Traces,
    unitCostInUSD: TELEMETRY_UNIT_COST_IN_USD, // 0.10 per 15 days per GB
  });

export const ProfilesDataIngestMeteredPlan: TelemetryMeteredPlanType =
  new TelemetryMeteredPlanType({
    productType: ProductType.Profiles,
    unitCostInUSD: TELEMETRY_UNIT_COST_IN_USD, // 0.10 per 15 days per GB
  });

/*
 * Session replay is priced above the other pillars on purpose.
 *
 * At telemetry parity (0.1 / 15) a project recording 100k sessions a month
 * bills well under a dollar, which does not cover the cost and mis-signals the
 * value of the feature. This rate is still far below comparable products while
 * scaling with the actual driver, which is bytes of recording retained.
 */
export const SessionReplayDataIngestMeteredPlan: TelemetryMeteredPlanType =
  new TelemetryMeteredPlanType({
    productType: ProductType.SessionReplay,
    unitCostInUSD:
      SESSION_REPLAY_PRICE_IN_USD_PER_GB / TELEMETRY_PRICE_RETENTION_IN_DAYS, // 2.00 per 15 days per GB
  });

const AllMeteredPlans: Array<ServerMeteredPlan> = [
  ActiveMonitoringMeteredPlan,
  LogDataIngestMeteredPlan,
  MetricsDataIngestMeteredPlan,
  TracesDataIngestMetredPlan,
  ProfilesDataIngestMeteredPlan,
  SessionReplayDataIngestMeteredPlan,
];

export class MeteredPlanUtil {
  @CaptureSpan()
  public static getMeteredPlanByProductType(
    productType: ProductType,
  ): ServerMeteredPlan {
    if (productType === ProductType.Logs) {
      return LogDataIngestMeteredPlan;
    } else if (productType === ProductType.Metrics) {
      return MetricsDataIngestMeteredPlan;
    } else if (productType === ProductType.Traces) {
      return TracesDataIngestMetredPlan;
    } else if (productType === ProductType.Profiles) {
      return ProfilesDataIngestMeteredPlan;
    } else if (productType === ProductType.SessionReplay) {
      return SessionReplayDataIngestMeteredPlan;
    } else if (productType === ProductType.ActiveMonitoring) {
      return ActiveMonitoringMeteredPlan;
    }

    throw new BadDataException(`Unknown product type ${productType}`);
  }
}

export default AllMeteredPlans;

import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import ActiveMonitoringMeteredPlanType from "./ActiveMonitoringMeteredPlan";
import ServerMeteredPlan from "./ServerMeteredPlan";
import TelemetryMeteredPlanType from "./TelemetryMeteredPlan";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ProductType from "../../../../Types/MeteredPlan/ProductType";

export const ActiveMonitoringMeteredPlan: ActiveMonitoringMeteredPlanType =
  new ActiveMonitoringMeteredPlanType();

export const LogDataIngestMeteredPlan: TelemetryMeteredPlanType =
  new TelemetryMeteredPlanType({
    productType: ProductType.Logs,
    unitCostInUSD: 0.1 / 15, // 0.10 per 15 days per GB
  });

export const MetricsDataIngestMeteredPlan: TelemetryMeteredPlanType =
  new TelemetryMeteredPlanType({
    productType: ProductType.Metrics,
    unitCostInUSD: 0.1 / 15, // 0.10 per 15 days per GB
  });

export const TracesDataIngestMetredPlan: TelemetryMeteredPlanType =
  new TelemetryMeteredPlanType({
    productType: ProductType.Traces,
    unitCostInUSD: 0.1 / 15, // 0.10 per 15 days per GB
  });

export const ProfilesDataIngestMeteredPlan: TelemetryMeteredPlanType =
  new TelemetryMeteredPlanType({
    productType: ProductType.Profiles,
    unitCostInUSD: 0.1 / 15, // 0.10 per 15 days per GB
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
    unitCostInUSD: 2.0 / 15, // 2.00 per 15 days per GB
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

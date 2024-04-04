import ActiveMonitoringMeteredPlanType from './ActiveMonitoringMeteredPlan';
import ServerMeteredPlan from './ServerMeteredPlan';
import TelemetryMeteredPlanType from './TelemetryMeteredPlan';
import { ProductType as TelemetryProductType } from 'Model/Models/TelemetryUsageBilling';
import BadDataException from 'Common/Types/Exception/BadDataException';

export const ActiveMonitoringMeteredPlan: ActiveMonitoringMeteredPlanType =
    new ActiveMonitoringMeteredPlanType();

export const LogDataIngestMeteredPlan: TelemetryMeteredPlanType =
    new TelemetryMeteredPlanType({
        productType: TelemetryProductType.Logs,
        unitCostInUSD: 0.10 / 15, // 0.10 per 15 days per GB
    });

export const MetricsDataIngestMeteredPlan: TelemetryMeteredPlanType =
    new TelemetryMeteredPlanType({
        productType: TelemetryProductType.Metrics,
        unitCostInUSD: 0.10 / 15, // 0.10 per 15 days per GB
    });

export const TracesDataIngestMetredPlan: TelemetryMeteredPlanType =
    new TelemetryMeteredPlanType({
        productType: TelemetryProductType.Traces,
        unitCostInUSD: 0.10 / 15, // 0.10 per 15 days per GB
    });

const AllMeteredPlans: Array<ServerMeteredPlan> = [
    ActiveMonitoringMeteredPlan,
    LogDataIngestMeteredPlan,
    MetricsDataIngestMeteredPlan,
    TracesDataIngestMetredPlan,
];

export class MeteredPlanUtil {
    public static getTelemetryMeteredPlanByProductType(
        productType: TelemetryProductType
    ): TelemetryMeteredPlanType {
        if (productType === TelemetryProductType.Logs) {
            return LogDataIngestMeteredPlan;
        } else if (productType === TelemetryProductType.Metrics) {
            return MetricsDataIngestMeteredPlan;
        } else if (productType === TelemetryProductType.Traces) {
            return TracesDataIngestMetredPlan;
        }
        throw new BadDataException(`Unknown product type ${productType}`);
    }
}

export default AllMeteredPlans;

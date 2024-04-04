import ActiveMonitoringMeteredPlanType from './ActiveMonitoringMeteredPlan';
import ServerMeteredPlan from './ServerMeteredPlan';
import TelemetryMeteredPlanType from './TelemetryMeteredPlan';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ProductType from 'Common/Types/MeteredPlan/ProductType';

export const ActiveMonitoringMeteredPlan: ActiveMonitoringMeteredPlanType =
    new ActiveMonitoringMeteredPlanType();

export const LogDataIngestMeteredPlan: TelemetryMeteredPlanType =
    new TelemetryMeteredPlanType({
        productType: ProductType.Logs,
        unitCostInUSD: 0.10 / 15, // 0.10 per 15 days per GB
    });

export const MetricsDataIngestMeteredPlan: TelemetryMeteredPlanType =
    new TelemetryMeteredPlanType({
        productType: ProductType.Metrics,
        unitCostInUSD: 0.10 / 15, // 0.10 per 15 days per GB
    });

export const TracesDataIngestMetredPlan: TelemetryMeteredPlanType =
    new TelemetryMeteredPlanType({
        productType: ProductType.Traces,
        unitCostInUSD: 0.10 / 15, // 0.10 per 15 days per GB
    });

const AllMeteredPlans: Array<ServerMeteredPlan> = [
    ActiveMonitoringMeteredPlan,
    LogDataIngestMeteredPlan,
    MetricsDataIngestMeteredPlan,
    TracesDataIngestMetredPlan,
];

export class MeteredPlanUtil {
    public static getMeteredPlanByProductType(
        productType: ProductType
    ): ServerMeteredPlan {
        if (productType === ProductType.Logs) {
            return LogDataIngestMeteredPlan;
        } else if (productType === ProductType.Metrics) {
            return MetricsDataIngestMeteredPlan;
        } else if (productType === ProductType.Traces) {
            return TracesDataIngestMetredPlan;
        } else if (productType === ProductType.ActiveMonitoring) {
           return ActiveMonitoringMeteredPlan;
        }

        throw new BadDataException(`Unknown product type ${productType}`);
    }
}

export default AllMeteredPlans;

import ActiveMonitoringMeteredPlanType from './ActiveMonitoringMeteredPlan';
import ServerMeteredPlan from './ServerMeteredPlan';
import TelemetryMeteredPlanType from './TelemetryMeteredPlan';
import { ProductType } from 'Model/Models/UsageBilling';
import BadDataException from 'Common/Types/Exception/BadDataException';

export const ActiveMonitoringMeteredPlan: ActiveMonitoringMeteredPlanType =
    new ActiveMonitoringMeteredPlanType();
export const LogDataIngestMeteredPlan: TelemetryMeteredPlanType =
    new TelemetryMeteredPlanType(ProductType.Logs);
export const MetricsDataIngestMeteredPlan: TelemetryMeteredPlanType =
    new TelemetryMeteredPlanType(ProductType.Metrics);
export const TracesDataIngestMetredPlan: TelemetryMeteredPlanType =
    new TelemetryMeteredPlanType(ProductType.Traces);

const AllMeteredPlans: Array<ServerMeteredPlan> = [
    ActiveMonitoringMeteredPlan,
    LogDataIngestMeteredPlan,
    MetricsDataIngestMeteredPlan,
    TracesDataIngestMetredPlan,
];

export class MeteredPlanUtil {
    public static getServerMeteredPlanByProductType(
        productType: ProductType
    ): ServerMeteredPlan {
        if (productType === ProductType.Logs) {
            return LogDataIngestMeteredPlan;
        } else if (productType === ProductType.Metrics) {
            return MetricsDataIngestMeteredPlan;
        } else if (productType === ProductType.Traces) {
            return TracesDataIngestMetredPlan;
        }
        throw new BadDataException(`Unknown product type ${productType}`);
    }
}

export default AllMeteredPlans;

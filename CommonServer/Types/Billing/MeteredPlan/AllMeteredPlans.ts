import ActiveMonitoringMeteredPlanType from './ActiveMonitoringMeteredPlan';
import ServerMeteredPlan from './ServerMeteredPlan';
import TelemetryMeteredPlanType from './TelemetryMeteredPlan';
import { ProductType } from 'Model/Models/UsageBilling';

export const ActiveMonitoringMeteredPlan:ActiveMonitoringMeteredPlanType  = new ActiveMonitoringMeteredPlanType();
export const LogDataIngestMeteredPlan:TelemetryMeteredPlanType =  new TelemetryMeteredPlanType(ProductType.Logs);
export const MetricsDataIngestMeteredPlan: TelemetryMeteredPlanType =  new TelemetryMeteredPlanType(ProductType.Metrics);
export const TracesDataIngestMetredPlan: TelemetryMeteredPlanType =     new TelemetryMeteredPlanType(ProductType.Traces);

const AllMeteredPlans: Array<ServerMeteredPlan> = [
    ActiveMonitoringMeteredPlan, 
    LogDataIngestMeteredPlan,
    MetricsDataIngestMeteredPlan,
    TracesDataIngestMetredPlan
];

export default AllMeteredPlans;

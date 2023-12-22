import ActiveMonitoringMeteredPlan from './ActiveMonitoringMeteredPlan';
import ServerMeteredPlan from './ServerMeteredPlan';
import TelemetryMeteredPlan from './TelemetryMeteredPlan';
import { ProductType } from 'Model/Models/UsageBilling';

const AllMeteredPlans: Array<ServerMeteredPlan> = [
    new ActiveMonitoringMeteredPlan(),
    new TelemetryMeteredPlan(ProductType.Logs),
    new TelemetryMeteredPlan(ProductType.Metrics),
    new TelemetryMeteredPlan(ProductType.Traces),
];

export default AllMeteredPlans;

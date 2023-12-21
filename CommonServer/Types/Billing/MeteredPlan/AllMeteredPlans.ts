import ActiveMonitoringMeteredPlan from './ActiveMonitoringMeteredPlan';
import LogsDataIngestMeteredPlan from './LogsDataIngestMeteredPlan';
import ServerMeteredPlan from './ServerMeteredPlan';

const AllMeteredPlans: Array<typeof ServerMeteredPlan> = [
    ActiveMonitoringMeteredPlan,
    LogsDataIngestMeteredPlan
];

export default AllMeteredPlans;

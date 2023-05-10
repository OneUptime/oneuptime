import ActiveMonitoringMeteredPlan from './ActiveMonitoringMeteredPlan';
import ServerMeteredPlan from './ServerMeteredPlan';

const AllMeteredPlans: Array<typeof ServerMeteredPlan> = [
    ActiveMonitoringMeteredPlan,
];

export default AllMeteredPlans;

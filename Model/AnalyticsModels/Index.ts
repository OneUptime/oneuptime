import Log from './Log';
import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import Span from './Span';
import MonitorMetricsByMinute from './MonitorMetricsByMinute';
import Metric from './Metric';

const AnalyticsModels: Array<typeof AnalyticsBaseModel> = [
    Log,
    Span,
    Metric,
    MonitorMetricsByMinute,
];

export default AnalyticsModels;

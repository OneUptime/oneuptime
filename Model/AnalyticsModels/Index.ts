import Log from './Log';
import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import Span from './Span';
import MetricHistogram from './MetricHistogram';
import MetricSum from './MetricSum';
import MetricGauge from './MetricGauge';
import MonitorMetricsByMinute from './MonitorMetricsByMinute';

const AnalyticsModels: Array<typeof AnalyticsBaseModel> = [
    Log,
    Span,
    MetricHistogram,
    MetricSum,
    MetricGauge,
    MonitorMetricsByMinute
];

export default AnalyticsModels;

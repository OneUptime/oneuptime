import Log from './Log';
import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import Span from './Span';
import MetricHistogram from './MetricHistogram';
import MetricSum from './MetricSum';

const AnalyticsModels: Array<typeof AnalyticsBaseModel> = [
    Log,
    Span,
    MetricHistogram,
    MetricSum,
];

export default AnalyticsModels;

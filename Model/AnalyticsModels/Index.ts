import Log from './Log';
import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import Span from './Span';
import Metric from './Metric';

const AnalyticsModels: Array<typeof AnalyticsBaseModel> = [Log, Span, Metric];

export default AnalyticsModels;

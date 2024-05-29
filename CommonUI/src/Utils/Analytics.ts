import { AnalyticsHost, AnalyticsKey } from '../Config';
import Analytics from 'Common/Utils/Analytics';

const UiAnalytics: Analytics = new Analytics(AnalyticsHost, AnalyticsKey);

export default UiAnalytics;

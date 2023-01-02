import Analytics from 'Common/Utils/Analytics';
import { AnalyticsHost, AnalyticsKey } from '../Config';

const UiAnalytics: Analytics = new Analytics(AnalyticsHost, AnalyticsKey);

export default UiAnalytics;

/*
 * The monitors a recommendation makes are built in Common
 * (Types/Monitor/Recommendation/MonitorRecommendationCreateUtil), where Ask
 * AI's set_up_service_monitor builds its monitor too (#7243), so the
 * Recommendations tabs, the telemetry guided setup and Ask AI make the
 * same records. This module keeps the Dashboard's own import path for it.
 */
export { default } from "Common/Types/Monitor/Recommendation/MonitorRecommendationCreateUtil";
export type { MonitorRecommendationCreatePlanItem } from "Common/Types/Monitor/Recommendation/MonitorRecommendationCreateUtil";

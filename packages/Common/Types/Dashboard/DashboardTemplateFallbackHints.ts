import { MetricQueryFallbackHint } from "../Metrics/MetricQueryFallback";

/*
 * What the dashboard templates' charts say while they draw a fallback query
 * (Types/Metrics/MetricQueryFallback): why the chart shows the older
 * metric, and where the fix is.
 *
 * A template's legends and titles are stored in a dashboard as written, in
 * English, and drawn that way. These hints are stored the same way, but the
 * chart looks each one up when it draws it, so they read in the reader's
 * language: their text is a key of the Dashboard's locales.
 *
 * Docs links are written whole, so DocsLinksResolve holds each one to a
 * heading of the page it names.
 */

/*
 * Marks an English sentence as a key of the Dashboard's locales - the same
 * marker as Common/UI/Utils/TranslateTemplate's translationKey, kept here so
 * this file stays free of the UI. It returns the text unchanged.
 *
 * The Dashboard's locale extractor reads this file for what it marks and
 * nothing else (a "keys" root of its SOURCE_ROOTS,
 * App/FeatureSet/Dashboard/scripts/i18n/ExtractStrings.ts).
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

// Where the Kubernetes agent's upgrade is explained.
export const KUBERNETES_AGENT_UPGRADE_DOCS_URL: string =
  "/docs/monitor/kubernetes-agent#upgrading";

/*
 * The Kubernetes dashboard's restarts chart, while it draws the running
 * count (k8s.container.restarts) because the agent sends no restarts per
 * interval (k8s.container.restarts.increase, from kubernetes-agent chart
 * 0.7.1).
 */
export const KUBERNETES_RESTARTS_FALLBACK_HINT: MetricQueryFallbackHint = {
  text: translationKey(
    "Older Kubernetes agents send only the running restart count.",
  ),
  linkText: translationKey("Upgrade the agent"),
  linkUrl: KUBERNETES_AGENT_UPGRADE_DOCS_URL,
};

export const DASHBOARD_TEMPLATE_FALLBACK_HINTS: ReadonlyArray<MetricQueryFallbackHint> =
  [KUBERNETES_RESTARTS_FALLBACK_HINT];

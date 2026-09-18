import PageComponentProps from "../../PageComponentProps";
import SloAlertMetrics from "../../../Components/Slo/SloAlertMetrics";
import SloHistoryCharts from "../../../Components/Slo/SloHistoryCharts";
import SloIncidentMetrics from "../../../Components/Slo/SloIncidentMetrics";
import SloMetricsElement from "../../../Components/Slo/SloMetrics";
import { SloMetricsTab } from "../../../Components/Slo/SloMetricsQueryConfig";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import ObjectID from "Common/Types/ObjectID";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * Everything measurable about one SLO, laid out like a monitor's Metrics page:
 *
 *   - SLO Metrics: the oneuptime.slo.* series the evaluation worker posts
 *     (SLI and target, error budget, burn rate, status), in the same embedded
 *     metric cards - with Explorer links - as every other metric page.
 *   - Error Budget History: the long-range SloHistory charts with the target,
 *     at-risk and burn-rule thresholds drawn as reference lines (the former
 *     Charts page).
 *   - Incident / Alert Metrics: the incidents and alerts affecting this SLO,
 *     matched on the serviceLevelObjectiveIds attribute their metrics carry.
 *
 * The banner sits above the tabs so a disabled, archived or misconfigured SLO
 * explains its empty charts on every tab.
 */
const SloMetrics: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [, setCurrentTab] = useState<Tab | null>(null);

  /*
   * Tabs mounts only the selected tab's children, so the history charts and
   * the incident / alert queries do not run until their tab is opened.
   */
  const tabs: Array<Tab> = [
    {
      name: SloMetricsTab.SloMetrics,
      children: <SloMetricsElement sloId={modelId} />,
    },
    {
      name: SloMetricsTab.ErrorBudgetHistory,
      children: <SloHistoryCharts sloId={modelId} />,
    },
    {
      name: SloMetricsTab.IncidentMetrics,
      children: <SloIncidentMetrics sloId={modelId} />,
    },
    {
      name: SloMetricsTab.AlertMetrics,
      children: <SloAlertMetrics sloId={modelId} />,
    },
  ];

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} />
      <Tabs
        tabs={tabs}
        onTabChange={(tab: Tab) => {
          setCurrentTab(tab);
        }}
      />
    </Fragment>
  );
};

export default SloMetrics;

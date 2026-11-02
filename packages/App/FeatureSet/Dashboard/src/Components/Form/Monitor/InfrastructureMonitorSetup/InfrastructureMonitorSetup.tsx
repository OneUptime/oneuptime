import React, { FunctionComponent, ReactElement, useState } from "react";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import {
  INFRASTRUCTURE_ALERT_SECTION_TITLE,
  INFRASTRUCTURE_CUSTOM_METRIC_TAB,
  INFRASTRUCTURE_MORE_FIELDS_SUMMARY,
  INFRASTRUCTURE_QUERY_BUILDER_TAB,
  InfrastructureWatchWay,
} from "./InfrastructureMonitorSetupText";

/*
 * The one shape every infrastructure monitor's setup takes: what to watch,
 * then what to alert on, with the do-it-yourself ways folded away.
 *
 * It replaces three tabs of equal weight (Quick Setup, Custom Metric,
 * Advanced), which asked a first-time user to choose between a template
 * list and a query builder before they knew what either was. The alert
 * templates now come first and start on the type's default alert; a metric
 * of your own and the query builder wait under More fields - open from the
 * start when the monitor already reads a query no template made.
 */

export interface ComponentProps {
  // What to watch (InfrastructureResourceField).
  resourceField: ReactElement;
  // The type's alert templates, with what a picked one still asks for.
  alertTemplates: ReactElement;
  // One metric from the type's catalog.
  customMetric: ReactElement;
  // The query builder.
  queryBuilder: ReactElement;
  initialWay: InfrastructureWatchWay;
}

const InfrastructureMonitorSetup: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isMoreFieldsCollapsed, setIsMoreFieldsCollapsed] = useState<boolean>(
    props.initialWay === InfrastructureWatchWay.AlertTemplate,
  );

  const tabs: Array<Tab> = [
    {
      name: INFRASTRUCTURE_CUSTOM_METRIC_TAB,
      children: props.customMetric,
    },
    {
      name: INFRASTRUCTURE_QUERY_BUILDER_TAB,
      children: props.queryBuilder,
    },
  ];

  return (
    <div data-testid="infrastructure-monitor-setup">
      {props.resourceField}

      <div className="mb-6" data-testid="infrastructure-monitor-alert-section">
        <FieldLabelElement title={INFRASTRUCTURE_ALERT_SECTION_TITLE} />
        {props.alertTemplates}
      </div>

      <FoldedSection
        title={MORE_FIELDS_SECTION_TITLE}
        summary={INFRASTRUCTURE_MORE_FIELDS_SUMMARY}
        isCollapsed={isMoreFieldsCollapsed}
        onToggle={(isCollapsed: boolean) => {
          setIsMoreFieldsCollapsed(isCollapsed);
        }}
      >
        <div data-testid="infrastructure-monitor-more-fields">
          <Tabs
            tabs={tabs}
            onTabChange={() => {}}
            wrap={true}
            initialTabName={
              props.initialWay === InfrastructureWatchWay.QueryBuilder
                ? INFRASTRUCTURE_QUERY_BUILDER_TAB
                : INFRASTRUCTURE_CUSTOM_METRIC_TAB
            }
          />
        </div>
      </FoldedSection>
    </div>
  );
};

export default InfrastructureMonitorSetup;

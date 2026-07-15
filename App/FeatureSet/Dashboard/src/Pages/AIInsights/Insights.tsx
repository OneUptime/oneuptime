import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Color from "Common/Types/Color";
import {
  Blue500,
  Gray500,
  Green500,
  Orange500,
  Purple500,
  Red500,
  Yellow500,
} from "Common/Types/BrandColors";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import AIInsight from "Common/Models/DatabaseModels/AIInsight";
import AIInsightSeverity from "Common/Types/AI/AIInsightSeverity";
import AIInsightStatus from "Common/Types/AI/AIInsightStatus";
import AIInsightType from "Common/Types/AI/AIInsightType";
import Link from "Common/UI/Components/Link/Link";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import AIPlanGate from "../../Components/AI/AIPlanGate";

// Human labels for the wire-contract enum values (e.g. "NewException").
const INSIGHT_TYPE_LABELS: Record<AIInsightType, string> = {
  [AIInsightType.NewException]: "New Exception",
  [AIInsightType.ExceptionSpike]: "Exception Spike",
  [AIInsightType.ErrorLogSpike]: "Error Log Spike",
  [AIInsightType.TraceLatencyRegression]: "Latency Regression",
  [AIInsightType.MetricDrift]: "Metric Drift",
};

const SEVERITY_COLORS: Record<AIInsightSeverity, Color> = {
  [AIInsightSeverity.High]: Red500,
  [AIInsightSeverity.Medium]: Yellow500,
  [AIInsightSeverity.Low]: Blue500,
};

/*
 * ActionRequired is the attention state, FixOpened means the AI agent is on
 * it, the terminal human states are calm (green/gray), and Detected — a
 * transient state the scanner routes out of in the same tick — stays gray.
 */
const STATUS_COLORS: Record<AIInsightStatus, Color> = {
  [AIInsightStatus.Detected]: Gray500,
  [AIInsightStatus.ActionRequired]: Orange500,
  [AIInsightStatus.FixOpened]: Purple500,
  [AIInsightStatus.Resolved]: Green500,
  [AIInsightStatus.Dismissed]: Gray500,
};

export function getInsightTypeLabel(
  insightType: AIInsightType | undefined,
): string {
  if (!insightType) {
    return "-";
  }
  return INSIGHT_TYPE_LABELS[insightType] || insightType;
}

export function getInsightTypeElement(
  insightType: AIInsightType | undefined,
): ReactElement {
  if (!insightType) {
    return <></>;
  }
  return (
    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
      {getInsightTypeLabel(insightType)}
    </span>
  );
}

export function getSeverityElement(
  severity: AIInsightSeverity | undefined,
): ReactElement {
  if (!severity) {
    return <></>;
  }
  return <Pill text={severity} color={SEVERITY_COLORS[severity] || Gray500} />;
}

export function getStatusElement(
  status: AIInsightStatus | undefined,
): ReactElement {
  if (!status) {
    return <></>;
  }
  return <Pill text={status} color={STATUS_COLORS[status] || Gray500} />;
}

const AIInsightsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.AI_INSIGHTS_SETTINGS] as Route,
  );

  return (
    <>
      <AIPlanGate />

      <ModelTable<AIInsight>
        modelType={AIInsight}
        id="ai-insights-table"
        userPreferencesKey="ai-insights-table"
        saveFilterProps={{
          tableId: "ai-insights-table",
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        name="AI Insights"
        isViewable={true}
        cardProps={{
          title: "AI Insights",
          description:
            "Proactive findings from OneUptime AI's deterministic telemetry sensors — new or spiking exceptions, error-log spikes, latency regressions and metric drift. Insights never page and never open incidents.",
        }}
        noItemsMessage={
          <span>
            No insights yet. When AI Insights is enabled, OneUptime AI
            continuously watches this project&apos;s telemetry and files a quiet
            insight whenever a deterministic sensor finds something — without
            paging anyone or opening incidents. Turn it on in{" "}
            <Link to={settingsRoute} className="underline">
              Insights Settings
            </Link>
            .
          </span>
        }
        showRefreshButton={true}
        searchableFields={["title", "serviceName"]}
        viewPageRoute={Navigation.getCurrentRoute()}
        sortBy="lastSeenAt"
        sortOrder={SortOrder.Descending}
        filters={[
          {
            field: {
              insightType: true,
            },
            title: "Type",
            type: FieldType.Dropdown,
            filterDropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(AIInsightType),
          },
          {
            field: {
              status: true,
            },
            title: "Status",
            type: FieldType.Dropdown,
            filterDropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(AIInsightStatus),
          },
          {
            field: {
              severity: true,
            },
            title: "Severity",
            type: FieldType.Dropdown,
            filterDropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(AIInsightSeverity),
          },
          {
            field: {
              serviceName: true,
            },
            title: "Service",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              insightType: true,
            },
            title: "Type",
            type: FieldType.Element,
            getElement: (item: AIInsight): ReactElement => {
              return getInsightTypeElement(item.insightType);
            },
          },
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: {
              serviceName: true,
            },
            title: "Service",
            type: FieldType.Text,
          },
          {
            field: {
              severity: true,
            },
            title: "Severity",
            type: FieldType.Element,
            getElement: (item: AIInsight): ReactElement => {
              return getSeverityElement(item.severity);
            },
          },
          {
            field: {
              status: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: AIInsight): ReactElement => {
              return getStatusElement(item.status);
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.Date,
          },
          {
            field: {
              occurrenceCount: true,
            },
            title: "Occurrences",
            type: FieldType.Number,
          },
        ]}
      />
    </>
  );
};

export default AIInsightsPage;

import {
  AIChatCitationTarget,
  AIChatWidget,
  AIChatWidgetType,
} from "Common/Types/AI/AIChatTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";
import { navigateToCitationTarget } from "../CitationTargetNav";
import ChartWidget from "./ChartWidget";
import DataTableWidget from "./DataTableWidget";
import EntityListWidget from "./EntityListWidget";
import ResourceCardWidget from "./ResourceCardWidget";
import StatCardsWidget from "./StatCardsWidget";
import TraceWaterfallWidget from "./TraceWaterfallWidget";

export interface ComponentProps {
  widgets: Array<AIChatWidget>;
}

const iconForType: { [key in AIChatWidgetType]: IconProp } = {
  [AIChatWidgetType.TimeSeriesChart]: IconProp.ChartBar,
  [AIChatWidgetType.BarChart]: IconProp.ChartBar,
  [AIChatWidgetType.Table]: IconProp.List,
  [AIChatWidgetType.TraceWaterfall]: IconProp.Activity,
  [AIChatWidgetType.IncidentList]: IconProp.Alert,
  [AIChatWidgetType.AlertList]: IconProp.Bell,
  [AIChatWidgetType.ExceptionList]: IconProp.Error,
  [AIChatWidgetType.StatCards]: IconProp.ChartBar,
  [AIChatWidgetType.ResourceCard]: IconProp.CheckCircle,
};

function renderBody(widget: AIChatWidget): ReactElement {
  switch (widget.type) {
    case AIChatWidgetType.TimeSeriesChart:
    case AIChatWidgetType.BarChart:
      return <ChartWidget widget={widget} />;
    case AIChatWidgetType.Table:
      return <DataTableWidget widget={widget} />;
    case AIChatWidgetType.TraceWaterfall:
      return <TraceWaterfallWidget widget={widget} />;
    case AIChatWidgetType.IncidentList:
    case AIChatWidgetType.AlertList:
    case AIChatWidgetType.ExceptionList:
      return <EntityListWidget widget={widget} />;
    case AIChatWidgetType.StatCards:
      return <StatCardsWidget widget={widget} />;
    case AIChatWidgetType.ResourceCard:
      return <ResourceCardWidget widget={widget} />;
    default:
      return <></>;
  }
}

const WidgetCard: FunctionComponent<{ widget: AIChatWidget }> = ({
  widget,
}: {
  widget: AIChatWidget;
}): ReactElement => {
  // The resource card is self-contained (its own styled surface).
  if (widget.type === AIChatWidgetType.ResourceCard) {
    return renderBody(widget);
  }

  const link: AIChatCitationTarget | undefined = widget.data.link;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/60 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            icon={iconForType[widget.type] || IconProp.ChartBar}
            className="h-3.5 w-3.5 flex-shrink-0 text-gray-500"
          />
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-gray-900">
              {widget.title}
            </div>
            {widget.description && (
              <div className="truncate text-[10px] text-gray-400">
                {widget.description}
              </div>
            )}
          </div>
        </div>
        {link && (
          <button
            type="button"
            onClick={() => {
              navigateToCitationTarget(link);
            }}
            className="flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            Open
            <Icon icon={IconProp.ExternalLink} className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="p-3.5">{renderBody(widget)}</div>
    </div>
  );
};

/*
 * Renders the inline widgets (charts, tables, trace waterfalls, resource cards)
 * an assistant message produced from its tool results.
 */
const WidgetRenderer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.widgets || props.widgets.length === 0) {
    return <></>;
  }

  return (
    <div className="space-y-2.5">
      {props.widgets.map((widget: AIChatWidget) => {
        return <WidgetCard key={widget.id} widget={widget} />;
      })}
    </div>
  );
};

export default WidgetRenderer;

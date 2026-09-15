import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SloOverviewActionLink from "./SloOverviewActionLink";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import Card from "Common/UI/Components/Card/Card";
import { formatDurationCompact } from "Common/Utils/Slo/SloDuration";
import { SLO_EVALUATION_CADENCE_MINUTES } from "Common/Utils/Slo/SloEvaluation";
import {
  getSliTypeText,
  getSloAtRiskText,
  getSloDowntimeStatusesText,
  getSloMultiMonitorModeText,
  getSloWindowText,
  SloMultiMonitorModeText,
} from "Common/Utils/Slo/SloOverviewText";
import {
  getSloAllowedDowntime,
  SloAllowedDowntime,
} from "Common/Utils/Slo/SloProjection";
import { formatSloPercent } from "Common/Utils/Slo/SloWidgetFormat";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  sloId: ObjectID;
  slo: ServiceLevelObjective;
  now: Date;
}

interface ConfigurationRow {
  key: string;
  label: string;
  value: ReactElement | string;
  description?: string | undefined;
}

/*
 * How this SLO is set up, read-only and in plain words.
 *
 * Editing lives on the Settings page now; the overview's job is to make the
 * numbers above interpretable. So the target is restated as the downtime it
 * allows, the multi-monitor mode as what it does rather than its enum name,
 * and an empty downtime-status list as the rule it falls back to — instead
 * of the raw column values the old details card printed.
 */
const SloConfigurationSummaryCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const slo: ServiceLevelObjective = props.slo;

  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SLO_VIEW_SETTINGS] as Route,
    { modelId: props.sloId },
  );

  const allowedDowntime: SloAllowedDowntime | null = getSloAllowedDowntime({
    targetPercentage: slo.targetPercentage,
    windowType: slo.windowType,
    windowDays: slo.windowDays,
    timezone: slo.timezone,
    now: props.now,
  });

  const multiMonitorModeText: SloMultiMonitorModeText =
    getSloMultiMonitorModeText(slo.multiMonitorMode);

  const downtimeStatuses: Array<MonitorStatus> =
    (slo.downtimeMonitorStatuses as Array<MonitorStatus> | undefined) || [];

  const rows: Array<ConfigurationRow> = [
    {
      key: "objective",
      label: "Objective",
      value: formatSloPercent(slo.targetPercentage)
        ? `${formatSloPercent(slo.targetPercentage)} uptime`
        : "No target set",
      description: allowedDowntime
        ? `${formatDurationCompact(allowedDowntime.seconds)} of downtime allowed ${allowedDowntime.periodText}`
        : undefined,
    },
    {
      key: "window",
      label: "Compliance window",
      value: getSloWindowText({
        windowType: slo.windowType,
        windowDays: slo.windowDays,
        timezone: slo.timezone,
      }),
      description:
        slo.windowType === SloWindowType.CalendarMonth
          ? "The budget resets to full at the start of every month."
          : "Old downtime ages out of the window, returning its budget.",
    },
    {
      key: "at-risk",
      label: "At risk",
      value: getSloAtRiskText(slo.atRiskThresholdPercentage),
    },
    {
      key: "downtime-statuses",
      label: "Counts as downtime",
      value:
        downtimeStatuses.length === 0 ? (
          getSloDowntimeStatusesText([])
        ) : (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {downtimeStatuses.map((status: MonitorStatus, index: number) => {
              return (
                <span
                  key={status._id?.toString() || `status-${index}`}
                  className="inline-flex items-center gap-1.5"
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{
                      backgroundColor: status.color
                        ? status.color.toString()
                        : undefined,
                    }}
                  ></span>
                  {status.name || "Unnamed status"}
                </span>
              );
            })}
          </span>
        ),
    },
    {
      key: "multi-monitor-mode",
      label: "Multiple monitors",
      value: multiMonitorModeText.title,
      description: multiMonitorModeText.description,
    },
    {
      key: "indicator",
      label: "Indicator",
      value: getSliTypeText(slo.sliType),
      description: `Evaluated every ${SLO_EVALUATION_CADENCE_MINUTES} minutes.`,
    },
  ];

  return (
    <Card
      title="Configuration"
      description="How this SLO measures, in plain words."
      headerLayout="stacked"
      rightElement={
        <SloOverviewActionLink
          title="Edit in Settings"
          icon={IconProp.Settings}
          to={settingsRoute}
        />
      }
    >
      <dl
        data-testid="slo-configuration-summary"
        className="divide-y divide-gray-100"
      >
        {rows.map((row: ConfigurationRow) => {
          return (
            <div
              key={row.key}
              data-testid={`slo-configuration-${row.key}`}
              className="py-3 first:pt-0 last:pb-0"
            >
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {row.label}
              </dt>
              <dd className="mt-1 text-sm text-gray-900">{row.value}</dd>
              {row.description ? (
                <dd className="mt-0.5 text-xs text-gray-500">
                  {row.description}
                </dd>
              ) : (
                <></>
              )}
            </div>
          );
        })}
      </dl>
    </Card>
  );
};

export default SloConfigurationSummaryCard;

import OneUptimeDate from "Common/Types/Date";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import DatabaseMonitorResponse, {
  DatabaseMetricGroupStatus,
  DatabaseMetricGroupUnavailableReason,
} from "Common/Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import {
  DatabaseMetricCategory,
  DatabaseMetricDefinition,
  DatabaseMetricGroup,
  getDatabaseMetricCategoryDescription,
  getDatabaseMetricCategoryOrder,
  getDatabaseMetricsByCategory,
} from "Common/Types/Monitor/DatabaseMetricCatalog";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import ValueFormatter from "Common/Utils/ValueFormatter";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import React, { FunctionComponent, ReactElement } from "react";
import ProbeAttemptsView from "./ProbeAttemptsView";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

/*
 * A value the engine did not report is absent from the payload, and absence
 * is the ordinary case: a group the operator switched off, a counter the
 * engine does not keep, a grant that was never made. Rendering the row as
 * "Not collected" rather than dropping it is the whole point of this view -
 * an operator chasing a blank chart needs to see which series is blank.
 */
const NOT_COLLECTED: string = "Not collected";

const formatMetricValue: (
  definition: DatabaseMetricDefinition,
  value: number | undefined,
) => string = (
  definition: DatabaseMetricDefinition,
  value: number | undefined,
): string => {
  /*
   * The payload arrives over the wire, so a key can be present and null as
   * well as simply missing. Both mean the same thing here, and neither may
   * be shown as a zero.
   */
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return NOT_COLLECTED;
  }

  return ValueFormatter.formatValue(value, definition.unit);
};

/*
 * One line per grant, not one per group. A login missing pg_monitor loses
 * five groups at once, and five copies of the same GRANT reads as five
 * separate problems.
 */
const groupStatusesByRemediation: (
  statuses: Array<DatabaseMetricGroupStatus>,
) => Array<Array<DatabaseMetricGroupStatus>> = (
  statuses: Array<DatabaseMetricGroupStatus>,
): Array<Array<DatabaseMetricGroupStatus>> => {
  const buckets: Map<string, Array<DatabaseMetricGroupStatus>> = new Map<
    string,
    Array<DatabaseMetricGroupStatus>
  >();

  for (const status of statuses) {
    const key: string = status.remediation || `no-remediation:${status.group}`;
    const bucket: Array<DatabaseMetricGroupStatus> = buckets.get(key) || [];
    bucket.push(status);
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values());
};

const DatabaseMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dbResponse: DatabaseMonitorResponse | undefined =
    props.probeMonitorResponse?.databaseMonitorResponse;

  const isOnline: boolean = Boolean(
    dbResponse ? dbResponse.isOnline : props.probeMonitorResponse.isOnline,
  );

  let responseTimeInMs: number = dbResponse?.responseTimeInMs || 0;

  if (responseTimeInMs > 0) {
    responseTimeInMs = Math.round(responseTimeInMs);
  }

  const metrics: Partial<Record<MonitorMetricType, number>> =
    dbResponse?.metrics || {};

  const collectedGroups: Array<DatabaseMetricGroup> =
    dbResponse?.collectedGroups || [];

  const unavailableGroups: Array<DatabaseMetricGroupStatus> =
    dbResponse?.unavailableGroups || [];

  /*
   * A group the probe never attempted - disabled by the operator, or gated
   * out by engine version - contributes no rows at all. Only a group that
   * ran, or that ran and failed, has metrics worth accounting for.
   */
  const attemptedGroups: Set<DatabaseMetricGroup> =
    new Set<DatabaseMetricGroup>([
      ...collectedGroups,
      ...unavailableGroups.map((status: DatabaseMetricGroupStatus) => {
        return status.group;
      }),
    ]);

  const degradedStatuses: Array<DatabaseMetricGroupStatus> =
    unavailableGroups.filter((status: DatabaseMetricGroupStatus) => {
      return (
        status.reason !==
        DatabaseMetricGroupUnavailableReason.NotSupportedByEngine
      );
    });

  const unsupportedStatuses: Array<DatabaseMetricGroupStatus> =
    unavailableGroups.filter((status: DatabaseMetricGroupStatus) => {
      return (
        status.reason ===
        DatabaseMetricGroupUnavailableReason.NotSupportedByEngine
      );
    });

  const probeAttempts: Array<ProbeAttempt> =
    props.probeMonitorResponse.probeAttempts || [];
  const totalAttempts: number =
    props.probeMonitorResponse.totalAttempts ?? probeAttempts.length;
  const hadRetries: boolean = totalAttempts > 1;

  /*
   * A check that never connected collected nothing, and reporting that as
   * "Healthy" - which an empty unavailableGroups list would - reads as the
   * opposite of what happened.
   */
  const collectionSummary: string = !isOnline
    ? "Not attempted"
    : unavailableGroups.length === 0
      ? "Healthy"
      : `${unavailableGroups.length} group${
          unavailableGroups.length === 1 ? "" : "s"
        } unavailable`;

  const getMetricRows: (
    category: DatabaseMetricCategory,
  ) => Array<DatabaseMetricDefinition> = (
    category: DatabaseMetricCategory,
  ): Array<DatabaseMetricDefinition> => {
    return getDatabaseMetricsByCategory(category).filter(
      (definition: DatabaseMetricDefinition) => {
        return (
          metrics[definition.metricType] !== undefined ||
          attemptedGroups.has(definition.group)
        );
      },
    );
  };

  const renderGroupStatus: (
    status: DatabaseMetricGroupStatus,
  ) => ReactElement = (status: DatabaseMetricGroupStatus): ReactElement => {
    return (
      <div key={status.group}>
        <span className="font-medium">{status.group}</span>
        <span className="mx-2 text-gray-400">—</span>
        <span>{status.message}</span>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex space-x-3">
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
          title="Probe"
          value={props.probeName || "-"}
        />
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
          title="Status"
          value={isOnline ? "Online" : "Offline"}
        />
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
          title="Engine"
          value={dbResponse?.engineVersion || "-"}
        />
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
          title="Response Time"
          value={responseTimeInMs ? responseTimeInMs + " ms" : "-"}
        />
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
          title="Collection"
          value={collectionSummary}
        />
      </div>

      <div className="flex space-x-3">
        <InfoCard
          className="w-1/2 shadow-none border-2 border-gray-100"
          title="Metric Groups Collected"
          value={
            collectedGroups.length > 0 ? collectedGroups.join(", ") : "None"
          }
        />
        <InfoCard
          className="w-1/2 shadow-none border-2 border-gray-100"
          title="Monitored At"
          value={
            props.probeMonitorResponse?.monitoredAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  props.probeMonitorResponse.monitoredAt,
                )
              : "-"
          }
        />
      </div>

      {(dbResponse?.connectionError ||
        props.probeMonitorResponse.failureCause) && (
        <div className="flex space-x-3">
          <InfoCard
            className="w-full shadow-none border-2 border-gray-100"
            title="Error"
            value={
              dbResponse?.connectionError ||
              props.probeMonitorResponse.failureCause?.toString() ||
              "-"
            }
          />
        </div>
      )}

      {unavailableGroups.length > 0 && (
        <div className="rounded-md border-2 border-amber-200 bg-amber-50 p-4">
          <div className="text-sm font-medium text-amber-900 mb-1">
            Some metrics were not collected
          </div>
          <div className="text-xs text-amber-800 mb-3">
            The database answered, so the monitor stays online. These groups are
            missing from this check, and their charts have a gap here.
          </div>

          {degradedStatuses.length > 0 && (
            <div className="space-y-3">
              {groupStatusesByRemediation(degradedStatuses).map(
                (
                  statuses: Array<DatabaseMetricGroupStatus>,
                  index: number,
                ): ReactElement => {
                  const remediation: string | undefined =
                    statuses[0]?.remediation;

                  return (
                    <div key={index} className="text-sm text-amber-900">
                      {statuses.map(renderGroupStatus)}
                      {remediation && (
                        <code className="mt-1 block select-all rounded bg-amber-100 px-2 py-1 font-mono text-xs text-amber-900 break-all">
                          {remediation}
                        </code>
                      )}
                    </div>
                  );
                },
              )}
            </div>
          )}

          {unsupportedStatuses.length > 0 && (
            <div
              className={`text-xs text-gray-500 ${
                degradedStatuses.length > 0
                  ? "mt-4 border-t border-amber-200 pt-3"
                  : ""
              }`}
            >
              <div className="mb-1 font-medium text-gray-600">
                Not available on this engine
              </div>
              {unsupportedStatuses.map(renderGroupStatus)}
            </div>
          )}
        </div>
      )}

      {getDatabaseMetricCategoryOrder().map(
        (category: DatabaseMetricCategory): ReactElement | null => {
          const definitions: Array<DatabaseMetricDefinition> =
            getMetricRows(category);

          if (definitions.length === 0) {
            return null;
          }

          return (
            <div key={category} className="space-y-3">
              <div>
                <h3 className="text-sm font-medium text-gray-700">
                  {category}
                </h3>
                <p className="text-xs text-gray-500">
                  {getDatabaseMetricCategoryDescription(category)}
                </p>
              </div>
              <div className="border rounded-md overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Metric
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {definitions.map(
                      (definition: DatabaseMetricDefinition): ReactElement => {
                        const formatted: string = formatMetricValue(
                          definition,
                          metrics[definition.metricType],
                        );

                        return (
                          <tr key={definition.id}>
                            <td className="px-4 py-2 text-sm text-gray-500">
                              {definition.friendlyName}
                            </td>
                            <td
                              className={`px-4 py-2 text-sm ${
                                formatted === NOT_COLLECTED
                                  ? "text-gray-400 italic"
                                  : "text-gray-900 font-mono"
                              }`}
                            >
                              {formatted}
                            </td>
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        },
      )}

      {hadRetries && (
        <ProbeAttemptsView
          attempts={probeAttempts}
          totalAttempts={totalAttempts}
        />
      )}
    </div>
  );
};

export default DatabaseMonitorView;

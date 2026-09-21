import PageMap from "../../../Utils/PageMap";
import { OverviewSection } from "../../../Utils/OverviewSection";
import RelativeTime from "../../EpisodeView/RelativeTime";
import SloOverviewActionLink from "../../Slo/SloOverviewActionLink";
import { getMonitorPageRoute } from "./MonitorOverviewLinks";
import { PROBE_HEALTH_TEXT_CLASS } from "./MonitorOverviewTones";
import { MonitorOverviewProbeData } from "./MonitorOverviewTypes";
import Probe from "Common/Models/DatabaseModels/Probe";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import {
  MonitorOverviewProbeHealth,
  MonitorOverviewProbeRow,
  MonitorOverviewProbeSummary,
} from "Common/Utils/Monitor/MonitorOverviewProbeUtil";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorId: ObjectID;
  probes: OverviewSection<MonitorOverviewProbeData>;
  // Null when the probes could not be read.
  summary: MonitorOverviewProbeSummary | null;
  /*
   * The moment the summary was judged at (the presentation input's now, on
   * the server's clock). Whether a probe's next check is still ahead is
   * decided against it, never the browser's clock, so the card and the
   * hero cannot disagree about it.
   */
  now: Date;
  minimumProbeAgreement?: number | undefined;
}

// The words on the right of a probe row.
export const getProbeHealthText: (row: MonitorOverviewProbeRow) => string = (
  row: MonitorOverviewProbeRow,
): string => {
  switch (row.health) {
    case MonitorOverviewProbeHealth.Up: {
      const responseTimeInMs: number | undefined =
        row.latestResult?.responseTimeInMs;

      return responseTimeInMs !== undefined
        ? `Up · ${Math.round(responseTimeInMs)} ms`
        : "Up";
    }
    case MonitorOverviewProbeHealth.Down:
      return "Down";
    case MonitorOverviewProbeHealth.Disconnected:
      return "Disconnected";
    case MonitorOverviewProbeHealth.Late:
      return "Late";
    case MonitorOverviewProbeHealth.NoResultYet:
      return "No result yet";
    case MonitorOverviewProbeHealth.TurnedOff:
      return "Turned off for this monitor";
    default:
      return "Reported";
  }
};

/*
 * The probe agreement rule, worked out the way the server applies it
 * (MonitorResourceUtil.checkProbeAgreement): only enabled, connected probes
 * take part, an unset minimum means all of them must agree, and the minimum
 * is capped at how many take part. So 3 required with one of three probes
 * disconnected is 2 of 2, never "3 of 2". A probe whose connection is not
 * known counts as connected, as it does everywhere else on this card.
 * Null when no agreement is needed: one probe, or a minimum of one.
 */
export const getProbeAgreementText: (data: {
  rows: Array<MonitorOverviewProbeRow>;
  minimumProbeAgreement: number | null | undefined;
}) => string | null = (data: {
  rows: Array<MonitorOverviewProbeRow>;
  minimumProbeAgreement: number | null | undefined;
}): string | null => {
  const activeCount: number = data.rows.filter(
    (row: MonitorOverviewProbeRow) => {
      return row.isEnabled && row.isConnected !== false;
    },
  ).length;

  const minimum: number | null | undefined = data.minimumProbeAgreement;
  const requiredCount: number = Math.min(
    typeof minimum === "number" && Number.isFinite(minimum)
      ? minimum
      : activeCount,
    activeCount,
  );

  if (activeCount < 2 || requiredCount < 2) {
    return null;
  }

  if (requiredCount < activeCount) {
    return `A status change needs ${requiredCount} of ${activeCount} connected probes to agree.`;
  }

  return activeCount === 2
    ? "A status change needs both connected probes to agree."
    : `A status change needs all ${activeCount} connected probes to agree.`;
};

const toProbeModel: (row: MonitorOverviewProbeRow) => Probe = (
  row: MonitorOverviewProbeRow,
): Probe => {
  const probe: Probe = new Probe();
  probe._id = row.probeId;
  probe.name = row.name;

  if (row.iconFileId) {
    probe.iconFileId = new ObjectID(row.iconFileId);
  }

  return probe;
};

/*
 * Where this monitor is checked from, one row per attached probe, with the
 * ones that need attention first: down, disconnected, late, then those that
 * have not reported, then the healthy ones, and the switched-off ones last.
 * "Checked" is when the probe's last result reached the server, not when it
 * claimed the job.
 */
const MonitorProbesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const probesRoute: Route = getMonitorPageRoute({
    pageMap: PageMap.MONITOR_VIEW_PROBES,
    monitorId: props.monitorId,
  });

  type GetRowFunction = (
    row: MonitorOverviewProbeRow,
    now: Date,
  ) => ReactElement;

  const getRow: GetRowFunction = (
    row: MonitorOverviewProbeRow,
    now: Date,
  ): ReactElement => {
    const monitoredAt: Date | undefined = row.latestResult?.monitoredAt;
    const isNextInFuture: boolean = Boolean(
      row.isEnabled &&
        row.nextPingAt &&
        row.nextPingAt.getTime() > now.getTime(),
    );
    const failureCause: string | undefined =
      row.health === MonitorOverviewProbeHealth.Down
        ? row.latestResult?.failureCause
        : undefined;

    return (
      <li
        key={row.probeId}
        data-testid="monitor-probe-row"
        className="flex items-start justify-between gap-3 py-2.5"
      >
        <div className="min-w-0">
          <ProbeElement probe={toProbeModel(row)} />
          <p className="mt-1 text-xs text-gray-500">
            {monitoredAt ? (
              <>
                {"Checked "}
                <RelativeTime date={monitoredAt} />
              </>
            ) : (
              <>No result yet</>
            )}
            {isNextInFuture && row.nextPingAt ? (
              <>
                {" · next "}
                <RelativeTime date={row.nextPingAt} />
              </>
            ) : (
              <></>
            )}
          </p>
          {failureCause ? (
            <p
              className="mt-0.5 line-clamp-2 break-words text-xs text-gray-500"
              title={failureCause}
            >
              {failureCause}
            </p>
          ) : (
            <></>
          )}
        </div>
        <span
          data-testid="monitor-probe-health"
          className={`flex-shrink-0 text-right text-xs font-medium ${
            PROBE_HEALTH_TEXT_CLASS[row.health]
          }`}
        >
          {getProbeHealthText(row)}
        </span>
      </li>
    );
  };

  type GetBodyFunction = () => ReactElement;

  const getBody: GetBodyFunction = (): ReactElement => {
    if (!props.probes.value) {
      if (props.probes.status === "forbidden") {
        return (
          <p className="text-sm text-gray-500">
            {
              "Probes are hidden: you need permission to read this monitor's probes."
            }
          </p>
        );
      }

      if (props.probes.status === "error") {
        return (
          <p className="text-sm text-red-700">
            {`Couldn't load probes. ${props.probes.error}`}
          </p>
        );
      }

      return (
        <div
          role="status"
          aria-label="Loading probes"
          className="space-y-2 animate-pulse"
        >
          <div className="h-4 w-5/6 rounded bg-gray-100"></div>
          <div className="h-4 w-2/3 rounded bg-gray-100"></div>
        </div>
      );
    }

    const rows: Array<MonitorOverviewProbeRow> = props.summary?.rows || [];

    if (rows.length === 0) {
      return (
        <div className="text-sm text-gray-500">
          <p>No probes attached.</p>
          <div className="mt-2">
            <SloOverviewActionLink
              variant="text"
              title="Add a probe"
              to={probesRoute}
            />
          </div>
        </div>
      );
    }

    const now: Date = props.now;
    const agreementText: string | null = getProbeAgreementText({
      rows: rows,
      minimumProbeAgreement: props.minimumProbeAgreement,
    });

    return (
      <div>
        <ul aria-label="Probes" className="divide-y divide-gray-100">
          {rows.map((row: MonitorOverviewProbeRow) => {
            return getRow(row, now);
          })}
        </ul>
        {agreementText ? (
          <p
            data-testid="monitor-probe-agreement"
            className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500"
          >
            {agreementText}
          </p>
        ) : (
          <></>
        )}
        {props.probes.refreshError ? (
          <p className="mt-2 text-xs text-gray-500">
            {`Couldn't refresh probes. ${props.probes.refreshError}`}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Card
      title="Probes"
      description="Where this monitor is checked from."
      headerLayout="stacked"
      rightElement={
        <SloOverviewActionLink variant="text" title="Manage" to={probesRoute} />
      }
    >
      {getBody()}
    </Card>
  );
};

export default MonitorProbesCard;

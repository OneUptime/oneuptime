import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import MonitorSummarySnapshot, {
  MonitorSummarySnapshotSource,
} from "Common/Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Card from "Common/UI/Components/Card/Card";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import MonitorSummarySnapshotUtil, {
  MonitorSummaryInfoProps,
} from "Common/Utils/Monitor/MonitorSummarySnapshotUtil";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import SummaryInfo from "./SummaryView/SummaryInfo";

/*
 * The "Monitor Summary" card, as of the moment this incident / alert was
 * opened.
 *
 * The monitor page shows the live version of this card. Until now an
 * incident showed nothing at all, so "what did the monitor actually see?"
 * had no answer on the page that raised the question - and no answer
 * anywhere at all once the check aged out (MonitorLog's retention is one
 * day by default, and MonitorProbe.lastMonitoringLog is overwritten by
 * the next check). The snapshot is written to the incident / alert row at
 * creation time so it outlives both.
 *
 * Renders nothing at all when there is no summary to show: manual
 * monitors, incidents opened by hand, and pre-snapshot rows whose
 * createdStateLog cannot be reconstructed.
 */

export interface ComponentProps {
  // Exactly one of these.
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
}

const MonitorSummarySnapshotCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [snapshot, setSnapshot] = useState<MonitorSummarySnapshot | null>(null);

  const fetchSnapshot: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const stored: {
        monitorSummary?: JSONObject | undefined;
        createdStateLog?: JSONObject | undefined;
        createdAt?: Date | undefined;
        monitor?: Monitor | undefined;
      } | null = props.incidentId
        ? await fetchFromIncident(props.incidentId)
        : props.alertId
          ? await fetchFromAlert(props.alertId)
          : null;

      if (!stored) {
        setSnapshot(null);
        return;
      }

      /*
       * The stored capture is authoritative. It knows the monitor type it
       * was taken for, so a monitor whose type was changed afterwards
       * still renders the check that actually fired.
       */
      let resolved: MonitorSummarySnapshot | null =
        MonitorSummarySnapshotUtil.deserialize(stored.monitorSummary);

      if (!resolved) {
        /*
         * Incidents and alerts created before the snapshot column
         * existed. createdStateLog holds the same evaluated payload,
         * so the card is reconstructed from it plus the attached
         * monitor's type - best effort, and blank if the monitor is
         * gone or its type has since changed.
         */
        resolved = MonitorSummarySnapshotUtil.fromLegacyCreatedStateLog({
          createdStateLog: stored.createdStateLog,
          monitorType: stored.monitor?.monitorType as MonitorType | undefined,
          monitorId: stored.monitor?._id?.toString(),
          monitorName: stored.monitor?.name?.toString(),
          capturedAt: stored.createdAt,
        });
      }

      setSnapshot(
        MonitorSummarySnapshotUtil.hasRenderableContent(resolved)
          ? resolved
          : null,
      );
    } catch (err) {
      /*
       * Not worth surfacing: the card just does not render. A viewer
       * without read access to monitors gets a hard failure from the
       * relation select rather than a hidden row, and the page's own
       * detail cards already report anything that matters.
       */
      API.getFriendlyMessage(err);
      setSnapshot(null);
    }
  };

  useEffect(() => {
    fetchSnapshot().catch(() => {
      // handled inside fetchSnapshot
    });
  }, [props.incidentId?.toString(), props.alertId?.toString()]);

  if (!snapshot) {
    return <Fragment />;
  }

  const summaryInfoProps: MonitorSummaryInfoProps =
    MonitorSummarySnapshotUtil.toSummaryInfoProps(snapshot);

  const capturedAtText: string = snapshot.capturedAt
    ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        snapshot.capturedAt,
      )
    : "";

  const description: string =
    snapshot.source === MonitorSummarySnapshotSource.Legacy
      ? "What the monitor reported when this was created, reconstructed from the stored evaluation."
      : capturedAtText
        ? `What the monitor reported at ${capturedAtText}, when this was created.`
        : "What the monitor reported when this was created.";

  return (
    <Fragment>
      <Card title="Monitor Summary" description={description}>
        <div className="space-y-5">
          {snapshot.telemetryMonitorSummary?.observedCount !== undefined && (
            <div className="flex">
              <InfoCard
                className="w-full shadow-none border-2 border-gray-100"
                title={
                  snapshot.telemetryMonitorSummary.observedCountTitle ||
                  "Observed"
                }
                value={snapshot.telemetryMonitorSummary.observedCount.toString()}
              />
            </div>
          )}

          <SummaryInfo {...summaryInfoProps} />

          {snapshot.areScreenshotsOmitted && (
            <div className="text-sm text-gray-500">
              Screenshots from this check were not stored because the capture
              was too large. They are on the monitor page while the check is
              still retained.
            </div>
          )}

          {snapshot.isResponseBodyTruncated && (
            <div className="text-sm text-gray-500">
              The response body shown above was truncated because the capture
              was too large.
            </div>
          )}
        </div>
      </Card>
    </Fragment>
  );
};

type FetchStored = {
  monitorSummary?: JSONObject | undefined;
  createdStateLog?: JSONObject | undefined;
  createdAt?: Date | undefined;
  monitor?: Monitor | undefined;
};

async function fetchFromIncident(
  incidentId: ObjectID,
): Promise<FetchStored | null> {
  const incident: Incident | null = await ModelAPI.getItem({
    modelType: Incident,
    id: incidentId,
    select: {
      monitorSummary: true,
      createdStateLog: true,
      createdAt: true,
      /*
       * Only used by the legacy reconstruction, which needs a monitor
       * type from somewhere. `monitorType` and `name` both allow reads
       * through a relation query; nothing deeper is selectable here.
       */
      monitors: {
        _id: true,
        name: true,
        monitorType: true,
      },
    },
  });

  if (!incident) {
    return null;
  }

  return {
    monitorSummary: incident.monitorSummary as JSONObject | undefined,
    createdStateLog: incident.createdStateLog as JSONObject | undefined,
    createdAt: incident.createdAt,
    // An incident can span several monitors; the summary belongs to the first.
    monitor: incident.monitors?.[0],
  };
}

async function fetchFromAlert(alertId: ObjectID): Promise<FetchStored | null> {
  const alert: Alert | null = await ModelAPI.getItem({
    modelType: Alert,
    id: alertId,
    select: {
      monitorSummary: true,
      createdStateLog: true,
      createdAt: true,
      monitor: {
        _id: true,
        name: true,
        monitorType: true,
      },
    },
  });

  if (!alert) {
    return null;
  }

  return {
    monitorSummary: alert.monitorSummary as JSONObject | undefined,
    createdStateLog: alert.createdStateLog as JSONObject | undefined,
    createdAt: alert.createdAt,
    monitor: alert.monitor,
  };
}

export default MonitorSummarySnapshotCard;

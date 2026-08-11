import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useAsyncEffect } from "use-async-effect";

export interface ComponentProps {
  monitorId: ObjectID;
  /**
   * Bump to re-fetch — e.g. after the Dependencies form saves, so a banner
   * the user just fixed disappears without a page reload.
   */
  refreshToggle?: string | undefined;
}

/**
 * Warns that this monitor's alerts and incidents are currently being
 * suppressed because a parent monitor it depends on is in a suppressing
 * status.
 *
 * Mirrors the backend decision rule in
 * Common/Server/Utils/Monitor/MonitorDependencySuppression.getSuppressingParents:
 * when the monitor configures suppression statuses, a parent suppresses
 * while its current status is in that list; otherwise while its current
 * status is flagged offline. A parent with no current status never
 * suppresses.
 *
 * It fetches its own monitor rather than taking one as a prop so every
 * monitor sub-page can drop it in with only the model id — the same shape
 * as the sibling Components/Monitor/DisabledWarning. A failed fetch
 * renders nothing: the banner is supplementary, and the page's own error
 * surface already owns real failures.
 */
const DependencySuppressionWarning: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [suppressingParents, setSuppressingParents] = useState<Array<Monitor>>(
    [],
  );

  useAsyncEffect(async () => {
    try {
      const monitor: Monitor | null = await ModelAPI.getItem<Monitor>({
        modelType: Monitor,
        id: props.monitorId,
        select: {
          dependsOnMonitors: {
            _id: true,
            name: true,
          },
          suppressAlertsWhenParentMonitorStatuses: {
            _id: true,
          },
        },
      });

      const parentIds: Array<ObjectID> = (monitor?.dependsOnMonitors || [])
        .filter((parent: Monitor) => {
          return Boolean(parent._id);
        })
        .map((parent: Monitor) => {
          return new ObjectID(parent._id as string);
        });

      if (parentIds.length === 0) {
        setSuppressingParents([]);
        return;
      }

      const configuredStatusIds: Set<string> = new Set<string>(
        (monitor?.suppressAlertsWhenParentMonitorStatuses || [])
          .map((status: MonitorStatus) => {
            return status._id?.toString() || "";
          })
          .filter((id: string) => {
            return id.length > 0;
          }),
      );

      const parents: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
        modelType: Monitor,
        query: {
          _id: new Includes(parentIds),
        },
        select: {
          name: true,
          currentMonitorStatus: {
            _id: true,
            name: true,
            isOfflineState: true,
          },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: {
          name: SortOrder.Ascending,
        },
      });

      const suppressing: Array<Monitor> = parents.data.filter(
        (parent: Monitor) => {
          if (configuredStatusIds.size > 0) {
            const statusId: string | undefined =
              parent.currentMonitorStatus?._id?.toString();

            return Boolean(statusId && configuredStatusIds.has(statusId));
          }

          return Boolean(parent.currentMonitorStatus?.isOfflineState);
        },
      );

      setSuppressingParents(suppressing);
    } catch {
      // Advisory only — a failed fetch renders nothing.
      setSuppressingParents([]);
    }
  }, [props.monitorId.toString(), props.refreshToggle]);

  if (suppressingParents.length === 0) {
    return <></>;
  }

  const parentDescriptions: string = suppressingParents
    .map((parent: Monitor) => {
      return `Parent monitor "${parent.name || "Unnamed monitor"}" is ${
        parent.currentMonitorStatus?.name || "in a suppressing status"
      }.`;
    })
    .join(" ");

  return (
    <Alert
      type={AlertType.WARNING}
      strongTitle="Alerts are suppressed by a monitor dependency"
      title={`${parentDescriptions} New alerts and incidents from this monitor are suppressed until the ${
        suppressingParents.length === 1 ? "parent recovers" : "parents recover"
      }; monitoring and status updates continue.`}
    />
  );
};

export default DependencySuppressionWarning;

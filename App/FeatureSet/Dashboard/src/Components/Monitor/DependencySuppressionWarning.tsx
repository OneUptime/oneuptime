import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorDependencyRule, {
  ParentMonitorStatusRef,
  SuppressingParent,
} from "Common/Utils/Monitor/MonitorDependencyRule";
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
 * The decision itself is MonitorDependencyRule.getSuppressingParents —
 * the same pure rule the backend enforces — so the banner cannot drift
 * from what the server actually suppresses.
 *
 * It fetches its own monitor rather than taking one as a prop so every
 * monitor sub-page can drop it in with only the model id — the same shape
 * as the sibling Components/Monitor/DisabledWarning. A failed fetch
 * renders nothing: the banner is supplementary, and the page's own error
 * surface already owns real failures.
 *
 * Caveat this component can detect but not resolve: the backend decides
 * with root access while this fetch runs under the viewer's permissions,
 * so a label-scoped viewer may not be able to read some parents. Parents
 * the viewer cannot see are reported as a softer "may be suppressed"
 * notice instead of being silently treated as healthy.
 */
const DependencySuppressionWarning: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [suppressingParents, setSuppressingParents] = useState<
    Array<SuppressingParent>
  >([]);
  const [hiddenParentCount, setHiddenParentCount] = useState<number>(0);

  useAsyncEffect(
    async (isMounted: () => boolean) => {
      try {
        const monitor: Monitor | null = await ModelAPI.getItem<Monitor>({
          modelType: Monitor,
          id: props.monitorId,
          select: {
            monitorType: true,
            dependsOnMonitors: {
              _id: true,
              name: true,
            },
            suppressAlertsWhenParentMonitorStatuses: {
              _id: true,
            },
          },
        });

        /*
         * Manual monitors never traverse the evaluation pipeline, so
         * suppression can never apply — mirror DisabledWarning's guard.
         */
        if (monitor?.monitorType === MonitorType.Manual) {
          if (isMounted()) {
            setSuppressingParents([]);
            setHiddenParentCount(0);
          }
          return;
        }

        const parentIds: Array<ObjectID> = (monitor?.dependsOnMonitors || [])
          .filter((parent: Monitor) => {
            return Boolean(parent._id);
          })
          .map((parent: Monitor) => {
            return new ObjectID(parent._id as string);
          });

        if (parentIds.length === 0) {
          if (isMounted()) {
            setSuppressingParents([]);
            setHiddenParentCount(0);
          }
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

        const parentRefs: Array<ParentMonitorStatusRef> = parents.data.map(
          (parent: Monitor) => {
            return {
              monitorId: parent._id?.toString() || "",
              monitorName: parent.name || "Unnamed monitor",
              statusId: parent.currentMonitorStatus?._id?.toString(),
              statusName: parent.currentMonitorStatus?.name,
              isOfflineState: Boolean(
                parent.currentMonitorStatus?.isOfflineState,
              ),
            };
          },
        );

        if (!isMounted()) {
          return;
        }

        setSuppressingParents(
          MonitorDependencyRule.getSuppressingParents({
            parents: parentRefs,
            configuredSuppressionStatusIds: configuredStatusIds,
          }),
        );

        /*
         * The backend evaluates parents with root access; this list is
         * scoped to what the viewer may read. Parents dropped by access
         * control must not silently read as "healthy".
         */
        setHiddenParentCount(
          Math.max(0, parentIds.length - parents.data.length),
        );
      } catch {
        // Advisory only — a failed fetch renders nothing.
        if (isMounted()) {
          setSuppressingParents([]);
          setHiddenParentCount(0);
        }
      }
    },
    [props.monitorId.toString(), props.refreshToggle],
  );

  if (suppressingParents.length > 0) {
    const parentDescriptions: string = suppressingParents
      .map((parent: SuppressingParent) => {
        return `Parent monitor "${parent.monitorName}" is ${parent.statusName}.`;
      })
      .join(" ");

    return (
      <Alert
        type={AlertType.WARNING}
        strongTitle="Alerts are suppressed by a monitor dependency"
        title={`${parentDescriptions} New alerts and incidents from this monitor are suppressed until the ${
          suppressingParents.length === 1
            ? "parent recovers"
            : "parents recover"
        }; monitoring and status updates continue.`}
      />
    );
  }

  if (hiddenParentCount > 0) {
    return (
      <Alert
        type={AlertType.INFO}
        strongTitle="This monitor depends on monitors you cannot view"
        title={`${hiddenParentCount} parent ${
          hiddenParentCount === 1 ? "monitor is" : "monitors are"
        } outside your access scope. Alerts from this monitor may be suppressed while a hidden parent is offline.`}
      />
    );
  }

  return <></>;
};

export default DependencySuppressionWarning;

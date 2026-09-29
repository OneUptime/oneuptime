import PageMap from "../../../Utils/PageMap";
import SloOverviewActionLink from "../../Slo/SloOverviewActionLink";
import { getMonitorPageRoute } from "./MonitorOverviewLinks";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorId: ObjectID;
}

/*
 * A manual monitor has no checks, no probes and no pulse, so the side column
 * explains how its status does change, and links to where to change it.
 */
const MonitorManualGuideCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Card
      title="Manual monitor"
      description="Status is set by people, not by checks."
      headerLayout="stacked"
    >
      <ul className="space-y-2 text-sm text-gray-700">
        <li>
          <p>Change the status from the status timeline.</p>
          <SloOverviewActionLink
            variant="text"
            title="Open status timeline"
            to={getMonitorPageRoute({
              pageMap: PageMap.MONITOR_VIEW_STATUS_TIMELINE,
              monitorId: props.monitorId,
            })}
          />
        </li>
        <li>
          <p>Incidents and scheduled maintenance can change it too.</p>
          <SloOverviewActionLink
            variant="text"
            title="View incidents"
            to={getMonitorPageRoute({
              pageMap: PageMap.MONITOR_VIEW_INCIDENTS,
              monitorId: props.monitorId,
            })}
          />
        </li>
        <li>
          <p>Uptime counts time spent in operational statuses.</p>
        </li>
      </ul>
    </Card>
  );
};

export default MonitorManualGuideCard;

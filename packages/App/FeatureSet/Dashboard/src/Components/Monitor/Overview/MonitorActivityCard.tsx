import { shouldAttemptRead } from "../../../Utils/OverviewSection";
import SloOverviewEmptyState from "../../Slo/SloOverviewEmptyState";
import MonitorFeedElement from "../MonitorFeed";
import MonitorFeed from "Common/Models/DatabaseModels/MonitorFeed";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorId: ObjectID;
  // Bumped by the page when something it knows about changed the feed.
  refreshToken: number;
}

export const MONITOR_ACTIVITY_TITLE: string = "Recent activity";

/*
 * The monitor's feed, under the overview's name for it. A user who may not
 * read the feed is told so, instead of being shown a feed that errors.
 */
const MonitorActivityCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const gate: PermissionGateResult = PermissionGate.check(
    new MonitorFeed(),
    ModelAction.Read,
  );

  if (!shouldAttemptRead(gate)) {
    return (
      <Card title={MONITOR_ACTIVITY_TITLE}>
        <SloOverviewEmptyState
          dataTestId="monitor-activity-hidden"
          icon={IconProp.Lock}
          title="Activity is hidden"
          description="You need permission to read this monitor's feed."
        />
      </Card>
    );
  }

  return (
    <MonitorFeedElement
      monitorId={props.monitorId}
      title={MONITOR_ACTIVITY_TITLE}
      description="Everything that has happened to this monitor, newest first."
      refreshToken={props.refreshToken}
    />
  );
};

export default MonitorActivityCard;

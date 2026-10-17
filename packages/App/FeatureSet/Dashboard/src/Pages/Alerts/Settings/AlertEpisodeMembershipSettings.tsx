import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";
import EpisodeSingleMembershipCard from "../../../Components/EpisodeMembers/EpisodeSingleMembershipCard";
import { ALERT_EPISODE_SETTINGS_COPY } from "../../../Components/EpisodeMembers/EpisodeSingleMembershipCopy";

export type ComponentProps = PageComponentProps;

/*
 * Alerts -> Settings -> Episode Membership: whether an alert can be in only
 * one episode (EpisodeSingleMembership), as Incidents -> Settings ->
 * Episode Membership says it for incidents.
 */
const AlertEpisodeMembershipSettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return <></>;
  }

  return (
    <EpisodeSingleMembershipCard
      copy={ALERT_EPISODE_SETTINGS_COPY}
      projectId={projectId}
    />
  );
};

export default AlertEpisodeMembershipSettings;

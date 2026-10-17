import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";
import EpisodeSingleMembershipCard from "../../../Components/EpisodeMembers/EpisodeSingleMembershipCard";
import { INCIDENT_EPISODE_SETTINGS_COPY } from "../../../Components/EpisodeMembers/EpisodeSingleMembershipCopy";

export type ComponentProps = PageComponentProps;

/*
 * Incidents -> Settings -> Episodes: whether an incident can be in only one
 * episode (EpisodeSingleMembership). A page of its own, named for what it
 * is about, as Linked Alerts is - so someone looking for how episodes
 * behave finds it by name in the menu or the search.
 */
const IncidentEpisodeSettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return <></>;
  }

  return (
    <EpisodeSingleMembershipCard
      copy={INCIDENT_EPISODE_SETTINGS_COPY}
      projectId={projectId}
    />
  );
};

export default IncidentEpisodeSettings;

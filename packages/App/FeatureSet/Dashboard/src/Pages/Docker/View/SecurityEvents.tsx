import PageComponentProps from "../../PageComponentProps";
import ResourceSecurityEventsPage from "../../../Components/ResourceSecurity/ResourceSecurityEventsPage";
import { SecurityConnectionKind } from "Common/Types/SecurityCase/SecurityConnection";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One Docker host's Security Events (#9628): the Security Events explorer on
 * the events read from its containers' logs - the lines its Logs page shows,
 * by the host name the Docker agent stamps on them - and the events naming
 * the host, the ones its Security card on Overview counts, beside its Logs
 * (ResourceSecurityEventsPage).
 */
const DockerHostSecurityEvents: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceSecurityEventsPage
      {...props}
      kind={SecurityConnectionKind.DockerHost}
    />
  );
};

export default DockerHostSecurityEvents;

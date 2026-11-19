import PageComponentProps from "../../PageComponentProps";
import ResourceSecurityEventsPage from "../../../Components/ResourceSecurity/ResourceSecurityEventsPage";
import { SecurityConnectionKind } from "Common/Types/SecurityCase/SecurityConnection";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One host's Security Events (#9547): the Security Events explorer on the
 * events naming this host - its host name, or a public address no other
 * host or device of the project holds - the ones its Security card on
 * Overview counts, beside its Logs (ResourceSecurityEventsPage).
 */
const HostSecurityEvents: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceSecurityEventsPage {...props} kind={SecurityConnectionKind.Host} />
  );
};

export default HostSecurityEvents;

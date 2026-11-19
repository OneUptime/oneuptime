import PageComponentProps from "../../PageComponentProps";
import ResourceSecurityEventsPage from "../../../Components/ResourceSecurity/ResourceSecurityEventsPage";
import { SecurityConnectionKind } from "Common/Types/SecurityCase/SecurityConnection";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One service's Security Events (#9628): the Security Events explorer on the
 * events read from its own logs and traces - an attack in a request it
 * answers, a failed sign-in, a prompt injection - the ones its Security card
 * on Overview counts, beside its Logs (ResourceSecurityEventsPage). A
 * service is not named by security events the way a host is, so nothing
 * else is read under its name.
 */
const ServiceViewSecurityEvents: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceSecurityEventsPage
      {...props}
      kind={SecurityConnectionKind.Service}
    />
  );
};

export default ServiceViewSecurityEvents;

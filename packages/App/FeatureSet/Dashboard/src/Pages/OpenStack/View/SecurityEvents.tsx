import PageComponentProps from "../../PageComponentProps";
import ResourceSecurityEventsPage from "../../../Components/ResourceSecurity/ResourceSecurityEventsPage";
import { SecurityConnectionKind } from "Common/Types/SecurityCase/SecurityConnection";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One OpenStack cloud's Security Events (#9628): the Security Events explorer
 * on its own audit trail - Keystone's notifications and the audit filter on
 * its APIs, read from the logs the OpenStack agent files under the cloud -
 * and the events naming it, the ones its Security card on Overview counts,
 * beside its Logs (ResourceSecurityEventsPage).
 */
const OpenStackCloudSecurityEvents: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceSecurityEventsPage
      {...props}
      kind={SecurityConnectionKind.OpenStackCloud}
    />
  );
};

export default OpenStackCloudSecurityEvents;

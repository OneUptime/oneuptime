import PageComponentProps from "../../PageComponentProps";
import DeviceSecurityEventsEmptyState from "../../../Components/NetworkDevice/DeviceSecurityEventsEmptyState";
import {
  DEVICE_SECURITY_EVENTS_CHIP_KEY,
  DEVICE_SECURITY_EVENTS_NO_SEARCH_REASON,
  DEVICE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTION,
  DEVICE_SECURITY_EVENTS_SCOPE_SUMMARY,
} from "../../../Components/NetworkDevice/DeviceSecurityEventsScope";
import ResourceSecurityEventsPage from "../../../Components/ResourceSecurity/ResourceSecurityEventsPage";
import { ResourceSecurityEventsChipWords } from "../../../Components/ResourceSecurity/ResourceSecurityEventsScope";
import ObjectID from "Common/Types/ObjectID";
import { SecurityConnectionKind } from "Common/Types/SecurityCase/SecurityConnection";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One device's Security Events (issue #5769): the Security Events explorer
 * on the security events about this device, as its Logs page is the Logs
 * explorer on its logs - the record's own Security Events page every
 * resource shares (ResourceSecurityEventsPage).
 *
 * The events about it are those read from the syslog it sends the probe
 * (a firewall's blocked connections and threats, a VPN's and an
 * administrator's sign-ins) and those from any other source naming it -
 * the ones its Security card on Overview counts. Its chip says so in a
 * device's words, and its empty state names the two steps that bring them:
 * its syslog to a probe, and Your logs.
 */

const DEVICE_SECURITY_EVENTS_READ_FAILED: string = translationKey(
  "The security events of this device could not be read.",
);

const DEVICE_CHIP_WORDS: ResourceSecurityEventsChipWords = {
  chipKey: DEVICE_SECURITY_EVENTS_CHIP_KEY,
  summary: DEVICE_SECURITY_EVENTS_SCOPE_SUMMARY,
  ownLogsDescription: DEVICE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTION,
  noSearchReason: DEVICE_SECURITY_EVENTS_NO_SEARCH_REASON,
};

const NetworkDeviceSecurityEvents: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceSecurityEventsPage
      {...props}
      kind={SecurityConnectionKind.NetworkDevice}
      chipWords={DEVICE_CHIP_WORDS}
      emptyContent={<DeviceSecurityEventsEmptyState modelId={modelId} />}
      failedReadMessage={DEVICE_SECURITY_EVENTS_READ_FAILED}
    />
  );
};

export default NetworkDeviceSecurityEvents;

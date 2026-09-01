import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  oidTemplate?: NetworkDeviceOidTemplate | undefined;
}

/**
 * The OID Collection Template a network device is linked to, as a table cell.
 *
 * Most devices are not linked to one — device-specific OIDs on the device
 * itself remain the default — so the empty case is the common one and has to
 * read as "no template" rather than as a value that failed to load, hence a
 * dash rather than a blank cell.
 *
 * Deliberately not a link, unlike MonitorTemplateElement: OID Collection
 * Templates are edited in the modal on their settings list, and there is no
 * per-template view page to send anyone to. A link to the list would land the
 * reader on the same table they are already looking at.
 */
const OidTemplateElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const templateName: string = props.oidTemplate?.name || "";

  if (!templateName) {
    return <span className="text-sm text-gray-400">—</span>;
  }

  return <span className="text-sm text-gray-900">{templateName}</span>;
};

export default OidTemplateElement;

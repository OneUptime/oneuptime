import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import ResourcePartReadError from "../../ResourcePart/ResourcePartReadError";

export const OPENSTACK_PART_READ_ERROR_TEST_ID: string =
  "openstack-part-read-error";

/*
 * What a part's page says when the read of its inventory failed: that it could not be
 * loaded, the server's answer, and Try again. Never "not reported yet", which would send
 * an operator to an agent that may be working fine while OneUptime could not answer.
 */
export const OPENSTACK_PART_READ_ERROR_TITLES: Partial<
  Record<OpenStackResourceKind, string>
> = {
  [OpenStackResourceKind.Api]: translationKey("Couldn't load this API"),
  [OpenStackResourceKind.Hypervisor]: translationKey(
    "Couldn't load this hypervisor",
  ),
  [OpenStackResourceKind.Instance]: translationKey(
    "Couldn't load this instance",
  ),
  [OpenStackResourceKind.Flavor]: translationKey("Couldn't load this flavor"),
  [OpenStackResourceKind.Network]: translationKey("Couldn't load this network"),
  [OpenStackResourceKind.Subnet]: translationKey("Couldn't load this subnet"),
  [OpenStackResourceKind.Router]: translationKey("Couldn't load this router"),
  [OpenStackResourceKind.FloatingIp]: translationKey(
    "Couldn't load this floating IP",
  ),
  [OpenStackResourceKind.Service]: translationKey("Couldn't load this agent"),
  [OpenStackResourceKind.Volume]: translationKey("Couldn't load this volume"),
  [OpenStackResourceKind.StoragePool]: translationKey(
    "Couldn't load this storage pool",
  ),
  [OpenStackResourceKind.Image]: translationKey("Couldn't load this image"),
};

export interface ComponentProps {
  kind: OpenStackResourceKind;
  // The server's answer, as API.getFriendlyMessage words it.
  message: string;
  onRetry: () => void;
}

const OpenStackPartReadError: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ResourcePartReadError
      testId={OPENSTACK_PART_READ_ERROR_TEST_ID}
      title={
        OPENSTACK_PART_READ_ERROR_TITLES[props.kind] ||
        translationKey("Couldn't load this part")
      }
      message={props.message}
      onRetry={props.onRetry}
    />
  );
};

export default OpenStackPartReadError;

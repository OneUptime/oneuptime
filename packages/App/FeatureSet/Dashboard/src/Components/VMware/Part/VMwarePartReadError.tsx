import React, { FunctionComponent, ReactElement } from "react";
import { VMwareResourceKind } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import ResourcePartReadError from "../../ResourcePart/ResourcePartReadError";
import { VMwarePartHeroKind } from "./VMwarePartHero";

export const VMWARE_PART_READ_ERROR_TEST_ID: string = "vmware-part-read-error";

/*
 * What an ESXi host's, a VM's, a datastore's or a cluster's page says when
 * the read of its inventory failed: that it could not be loaded, the
 * server's answer and Try again (the shared ResourcePartReadError) - never
 * "Not in inventory" or "No data yet", which would send an administrator to
 * a vCenter that was working while OneUptime could not answer.
 */
export const VMWARE_PART_READ_ERROR_TITLES: Readonly<
  Record<VMwarePartHeroKind, string>
> = {
  [VMwareResourceKind.Host]: translationKey("Couldn't load this ESXi host"),
  [VMwareResourceKind.VirtualMachine]: translationKey(
    "Couldn't load this virtual machine",
  ),
  [VMwareResourceKind.Datastore]: translationKey(
    "Couldn't load this datastore",
  ),
  [VMwareResourceKind.Cluster]: translationKey("Couldn't load this cluster"),
};

export interface ComponentProps {
  kind: VMwarePartHeroKind;
  // The server's answer, as API.getFriendlyMessage words it.
  message: string;
  // Reads the part again.
  onRetry: () => void;
}

const VMwarePartReadError: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ResourcePartReadError
      testId={VMWARE_PART_READ_ERROR_TEST_ID}
      title={VMWARE_PART_READ_ERROR_TITLES[props.kind]}
      message={props.message}
      onRetry={props.onRetry}
    />
  );
};

export default VMwarePartReadError;

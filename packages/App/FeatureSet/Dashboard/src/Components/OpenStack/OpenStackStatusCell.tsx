import React, { FunctionComponent, ReactElement } from "react";
import ResourceStatusCell from "../Infrastructure/ResourceStatusCell";
import {
  InfrastructureResource,
  ResourceStatusReason,
  ResourceStatusTone,
} from "../Infrastructure/ResourceTable";
import {
  OpenStackStatusInput,
  OpenStackStatusReading,
  getOpenStackStatusReading,
} from "./OpenStackStatus";

/*
 * A row's state in an OpenStack list: the shared status pill (ResourceStatusCell),
 * with OpenStack's own word in it and the tone OpenStackStatus gives it. A word
 * goes in as a template with no words of its own, so it reads as written in every
 * language; only "Disabled" is ours to translate.
 */

export interface ComponentProps extends OpenStackStatusInput {
  // A list with a Reason column of its own leaves the line under the pill out.
  showReason?: boolean | undefined;
  /*
   * What the health rules say about the row, in their own words and at the alert
   * templates' lines. They speak under the pill, and they colour it: a router ACTIVE
   * in green over "No alive L3 agent" would be a list contradicting itself.
   */
  reasons?: Array<ResourceStatusReason> | undefined;
  tone?: ResourceStatusTone | undefined;
  /*
   * The word to draw in place of the row's own, for a part that has none to read: a
   * storage pool's "Nearly full".
   */
  label?: string | undefined;
  isOpenStackWord?: boolean | undefined;
}

export function toOpenStackStatusResource(
  reading: OpenStackStatusReading,
  showReason: boolean,
): Pick<
  InfrastructureResource,
  "status" | "statusTone" | "statusText" | "statusReasons"
> {
  const reasons: NonNullable<InfrastructureResource["statusReasons"]> = [];

  if (showReason && reading.writtenReason) {
    reasons.push({
      text: "{{reason}}",
      values: { reason: reading.writtenReason },
    });
  }
  if (showReason && reading.reasonKey) {
    reasons.push({ text: reading.reasonKey });
  }

  return {
    status: reading.label,
    statusTone: reading.tone,
    statusText: reading.isOpenStackWord
      ? { text: "{{status}}", values: { status: reading.label } }
      : { text: reading.label },
    statusReasons: reasons,
  };
}

const OpenStackStatusCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const ownReading: OpenStackStatusReading | null =
    getOpenStackStatusReading(props);

  const reading: OpenStackStatusReading | null = props.label
    ? {
        ...(ownReading || {}),
        label: props.label,
        tone: props.tone || ownReading?.tone || "neutral",
        isOpenStackWord: Boolean(props.isOpenStackWord),
      }
    : ownReading;

  if (!reading) {
    return <span className="text-gray-400">-</span>;
  }

  const resource: ReturnType<typeof toOpenStackStatusResource> =
    toOpenStackStatusResource(reading, props.showReason !== false);

  return (
    <ResourceStatusCell
      resource={{
        ...resource,
        statusTone: props.tone || resource.statusTone,
        statusReasons: [
          ...(resource.statusReasons || []),
          ...(props.reasons || []),
        ],
      }}
    />
  );
};

export default OpenStackStatusCell;

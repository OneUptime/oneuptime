import React, { FunctionComponent, ReactElement } from "react";
import ResourceStatusCell from "../Infrastructure/ResourceStatusCell";
import { InfrastructureResource } from "../Infrastructure/ResourceTable";
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
  const reading: OpenStackStatusReading | null =
    getOpenStackStatusReading(props);

  if (!reading) {
    return <span className="text-gray-400">-</span>;
  }

  return (
    <ResourceStatusCell
      resource={toOpenStackStatusResource(reading, props.showReason !== false)}
    />
  );
};

export default OpenStackStatusCell;

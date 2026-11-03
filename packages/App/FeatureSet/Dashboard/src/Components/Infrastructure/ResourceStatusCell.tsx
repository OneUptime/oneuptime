import React, { FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  InfrastructureResource,
  RESOURCE_STATUS_REASON_CLASS_NAME,
  RESOURCE_STATUS_TONE_CLASS_NAMES,
  ResourceStatusReason,
  getResourceStatusLabel,
  getResourceStatusReasonText,
  getStatusBadgeClass,
} from "./ResourceTable";

/*
 * A row's state in a resource list: its word in a pill, coloured by the
 * product's own rules, and under it why - the first reason, the rest
 * counted ("+1 more"). ResourceTable draws its Status column with it, and a
 * list with a table of its own (a Docker or Podman host's containers) draws
 * the same cell, so a state reads the same in every list.
 */
export interface ComponentProps {
  resource: Pick<
    InfrastructureResource,
    "status" | "statusTone" | "statusText" | "statusReasons"
  >;
}

const ResourceStatusCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const resource: ComponentProps["resource"] = props.resource;

  if (!resource.status) {
    return <span className="text-gray-400">-</span>;
  }

  const pill: ReactElement = (
    <span
      data-tone={resource.statusTone}
      className={`inline-flex whitespace-nowrap px-2 py-0.5 text-xs font-medium rounded ${
        resource.statusTone
          ? RESOURCE_STATUS_TONE_CLASS_NAMES[resource.statusTone]
          : getStatusBadgeClass(resource.status)
      }`}
    >
      {getResourceStatusLabel(resource, translator)}
    </span>
  );
  const reasons: Array<ResourceStatusReason> = resource.statusReasons || [];

  if (reasons.length === 0) {
    return pill;
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      {pill}
      <div
        data-testid="resource-status-reason"
        className={RESOURCE_STATUS_REASON_CLASS_NAME}
      >
        {getResourceStatusReasonText(reasons[0]!, translator)}
        {reasons.length > 1 ? (
          <>
            {/* A space, so "+1 more" may move to a line of its own. */}{" "}
            <span className="whitespace-nowrap text-gray-500">
              {translator.translatePlural(
                { one: "+{{count}} more", other: "+{{count}} more" },
                reasons.length - 1,
              )}
            </span>
          </>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default ResourceStatusCell;

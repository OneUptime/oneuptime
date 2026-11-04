import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { TraceSpanType } from "Common/Types/Telemetry/TraceSpanType";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  OPENSTACK_CLOUD_SPAN_ATTRIBUTE,
  OPENSTACK_TRACE_RESOURCE_ATTRIBUTES,
  OpenStackTraceAttribute,
  getOpenStackTracedServiceOfApi,
} from "Common/Utils/OpenStack/OpenStackTraces";
import {
  keyForOpenStackCloud,
  keyForOpenStackResource,
} from "Common/Utils/Telemetry/EntityKey";
import React, { FunctionComponent, ReactElement } from "react";
import { isOpenStackNetworkAgent } from "../../../Pages/OpenStack/Utils/OpenStackPartFacts";
import TracesViewer from "../../Traces/TracesViewer";
import { OpenStackPart } from "./UseOpenStackPart";

/*
 * A part's Traces tab. An instance's, a volume's or a network's shows the spans whose request
 * named it, by the key ingest gave them, so it is found without scanning every span. A
 * service's and an API's shows the spans it sent. Nothing else has one: a span says nothing
 * about a hypervisor, a Neutron agent or a flavor that OneUptime could join on.
 *
 * It stays even with no traces: a part's tabs should not change when someone signs a request,
 * and an empty one says what would fill it.
 */

const EMPTY_MESSAGE: string =
  "No traced request has named this. Requests signed with your OSProfiler key appear here: this cloud's Traces page says how.";

const EMPTY_SERVICE_MESSAGE: string =
  "No traced request has reached this service. Requests signed with your OSProfiler key appear here: this cloud's Traces page says how.";

// The word a trace knows this service by, when it is one a trace can name.
export function getOpenStackPartTracedService(
  part: Pick<OpenStackPart, "kind">,
  row: OpenStackResource,
): string {
  if (part.kind === OpenStackResourceKind.Api) {
    return getOpenStackTracedServiceOfApi(row.name || "");
  }

  if (part.kind === OpenStackResourceKind.Service) {
    return isOpenStackNetworkAgent(row) ? "" : row.name || "";
  }

  return "";
}

function isNamedBySpans(kind: OpenStackResourceKind): boolean {
  return OPENSTACK_TRACE_RESOURCE_ATTRIBUTES.some(
    (known: { kind: OpenStackResourceKind }): boolean => {
      return known.kind === kind;
    },
  );
}

// Whether this part has a Traces tab at all.
export function hasOpenStackPartTraces(
  part: Pick<OpenStackPart, "kind">,
  row: OpenStackResource,
): boolean {
  return (
    isNamedBySpans(part.kind) ||
    Boolean(getOpenStackPartTracedService(part, row))
  );
}

export interface ComponentProps {
  part: OpenStackPart;
  row: OpenStackResource;
}

const OpenStackPartTraces: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { part, row } = props;
  const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();
  const service: string = getOpenStackPartTracedService(part, row);

  if (service) {
    return (
      <TracesViewer
        attributeFilters={{
          [OPENSTACK_CLOUD_SPAN_ATTRIBUTE]: part.cloudName,
          [OpenStackTraceAttribute.Service]: service,
        }}
        attributeFilterDisplayKeys={{
          [OPENSTACK_CLOUD_SPAN_ATTRIBUTE]: "Cloud",
          [OpenStackTraceAttribute.Service]: "Service",
        }}
        entityScope={{
          entityKeys: [keyForOpenStackCloud(projectId, part.cloudName)],
          attributeKey: OPENSTACK_CLOUD_SPAN_ATTRIBUTE,
          attributeValue: part.cloudName,
        }}
        disableUrlSync={true}
        emptyMessage={EMPTY_SERVICE_MESSAGE}
      />
    );
  }

  const key: string = keyForOpenStackResource(projectId, {
    cloudName: part.cloudName,
    kind: part.kind,
    id: part.externalId,
  });

  return (
    <TracesViewer
      entityKeysFilter={[key]}
      entityKeyDisplays={{
        [key]: {
          displayKey: part.kind,
          displayValue: row.name || part.externalId,
        },
      }}
      /*
       * A request's first span names a part, and so can what it calls, in any kind of span:
       * every span.
       */
      defaultSpanType={TraceSpanType.All}
      disableUrlSync={true}
      emptyMessage={EMPTY_MESSAGE}
    />
  );
};

export default OpenStackPartTraces;

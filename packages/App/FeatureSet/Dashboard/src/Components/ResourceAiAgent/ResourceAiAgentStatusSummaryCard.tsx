import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AiAgentStatusSummaryCard from "../AiAccess/AiAgentStatusSummaryCard";
import useAiAgentAccessStatus, {
  AiAgentAccessStatusRead,
} from "../AiAccess/useAiAgentAccessStatus";
import { ResourceAiAgentDescriptor } from "./ResourceAiAgentDescriptors";
import {
  RESOURCE_AI_ACCESS_STATUS_ROUTE,
  getResourceAiAccessRequestBody,
  getResourceAiAgentPageSubtitle,
  parseResourceAiAccessStatus,
} from "./ResourceAiAgentStatus";
import { getResourceAiAgentStatusSummary } from "./ResourceAiAgentStatusSummary";
import AgentVersion from "../../Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../Components/AgentVersion/AgentKind";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  ResourceAiAccessStatus,
  ResourceAiAgentSummary,
} from "Common/Types/ResourceAiAgent/ResourceAiAccess";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The "AI agent" card at the bottom of the Overview of a resource a
 * resource AI agent serves — Docker, Podman and Docker Swarm hosts, Proxmox
 * and Ceph clusters, VMware vCenters, database servers and hosts: the
 * agent's connection, the investigation switch and the fixes mode, read
 * from the status route the resource's AI agent page reads, with a link to
 * that page.
 */
export interface ComponentProps {
  descriptor: ResourceAiAgentDescriptor;
  resourceId: ObjectID;
  // The Overview's refresh signal: the status is read again when it changes.
  refreshToken?: number | undefined;
}

const ResourceAiAgentStatusSummaryCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const read: AiAgentAccessStatusRead<ResourceAiAccessStatus> =
    useAiAgentAccessStatus<ResourceAiAccessStatus>({
      route: RESOURCE_AI_ACCESS_STATUS_ROUTE,
      body: getResourceAiAccessRequestBody(
        props.descriptor,
        props.resourceId.toString(),
      ),
      parse: parseResourceAiAccessStatus,
      refreshToken: props.refreshToken,
    });
  const agent: ResourceAiAgentSummary | null = read.status?.agent || null;
  const hasAgentVersion: boolean =
    Boolean(agent?.agentVersion) || Boolean(agent?.posture?.agentVersion);
  const versionElement: ReactElement | undefined = hasAgentVersion ? (
    <AgentVersion
      kind={AgentKind.ResourceAiAgent}
      version={agent?.agentVersion || agent?.posture?.agentVersion}
      upgradeGuideContext={{
        resourceType: props.descriptor.resourceType,
      }}
    />
  ) : undefined;

  return (
    <AiAgentStatusSummaryCard
      description={getResourceAiAgentPageSubtitle(props.descriptor)}
      agentPageRoute={RouteUtil.populateRouteParams(
        RouteMap[props.descriptor.agentPage] as Route,
        { modelId: props.resourceId },
      )}
      summary={
        read.status
          ? getResourceAiAgentStatusSummary(read.status, props.descriptor)
          : null
      }
      isLoading={read.isLoading}
      versionElement={versionElement}
    />
  );
};

export default ResourceAiAgentStatusSummaryCard;

import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { toOpenStackRow } from "../../../Components/ResourceTopology/Builders/OpenStackTopologyAnswer";

/*
 * What the Projects and Domains pages read. Each is one indexed read
 * on the server (OpenStackResourceService), asked for a page of projects at a time.
 */

export interface OpenStackProjectSummary {
  projectId: string;
  instanceCount: number;
  activeInstanceCount: number;
  volumeCount: number;
  networkCount: number;
  routerCount: number;
  floatingIpCount: number;
}

export interface OpenStackProjectSummaries {
  summaries: Array<OpenStackProjectSummary>;
  // The parts of those projects that may need someone. OpenStackHealth has the last word.
  attentionRows: Array<OpenStackResource>;
}

export interface OpenStackProjectHostDown {
  hypervisorName: string;
  regionName: string | null;
  externalId: string;
  instanceCount: number;
}

export interface OpenStackProjectLabel {
  key: string;
  value: string;
  instanceCount: number;
}

export interface OpenStackProjectOverview {
  summary: OpenStackProjectSummary;
  attentionRows: Array<OpenStackResource>;
  attentionTotals: Record<string, number>;
  hostsDown: Array<OpenStackProjectHostDown>;
  labels: Array<OpenStackProjectLabel>;
}

export interface OpenStackDomainSummary {
  domainId: string;
  projectCount: number;
  enabledProjectCount: number;
}

async function post(
  path: string,
  openStackCloudId: ObjectID,
  data: JSONObject,
): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString())
        .addRoute(`/openstack-resource/${path}/`)
        .addRoute(openStackCloudId.toString()),
      data: data,
      headers: { ...ModelAPI.getCommonHeaders() },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response.data;
}

function rowsOf(attention: JSONObject | undefined): Array<OpenStackResource> {
  return ((attention?.["rows"] as Array<JSONObject> | undefined) || []).map(
    toOpenStackRow,
  );
}

export async function fetchOpenStackProjectSummaries(data: {
  openStackCloudId: ObjectID;
  projectIds: Array<string>;
}): Promise<OpenStackProjectSummaries> {
  if (data.projectIds.length === 0) {
    return { summaries: [], attentionRows: [] };
  }

  const answer: JSONObject = await post(
    "project-summaries",
    data.openStackCloudId,
    { projectIds: data.projectIds },
  );

  return {
    summaries:
      (answer["summaries"] as unknown as Array<OpenStackProjectSummary>) || [],
    attentionRows: rowsOf(answer["attention"] as JSONObject | undefined),
  };
}

export async function fetchOpenStackProjectOverview(data: {
  openStackCloudId: ObjectID;
  projectId: string;
}): Promise<OpenStackProjectOverview> {
  const answer: JSONObject = await post(
    "project-overview",
    data.openStackCloudId,
    { projectId: data.projectId },
  );
  const attention: JSONObject | undefined = answer["attention"] as
    | JSONObject
    | undefined;

  return {
    summary: answer["summary"] as unknown as OpenStackProjectSummary,
    attentionRows: rowsOf(attention),
    attentionTotals:
      (attention?.["totalsByKind"] as Record<string, number> | undefined) || {},
    hostsDown:
      (answer["hostsDown"] as unknown as Array<OpenStackProjectHostDown>) || [],
    labels: (answer["labels"] as unknown as Array<OpenStackProjectLabel>) || [],
  };
}

export async function fetchOpenStackDomainSummaries(
  openStackCloudId: ObjectID,
): Promise<Array<OpenStackDomainSummary>> {
  const answer: JSONObject = await post(
    "domain-summaries",
    openStackCloudId,
    {},
  );

  return (
    (answer["summaries"] as unknown as Array<OpenStackDomainSummary>) || []
  );
}

export async function fetchOpenStackProjectIdsOfDomain(data: {
  openStackCloudId: ObjectID;
  domainId: string;
}): Promise<Array<string>> {
  const answer: JSONObject = await post(
    "domain-projects",
    data.openStackCloudId,
    { domainId: data.domainId },
  );

  return (answer["projectIds"] as Array<string> | undefined) || [];
}

// A domain's choice, for the filter every list offers. Its name is Keystone's.
export async function fetchOpenStackDomainOptions(
  openStackCloudId: ObjectID,
): Promise<Array<DropdownOption>> {
  const result: ListResult<OpenStackResource> =
    await ModelAPI.getList<OpenStackResource>({
      modelType: OpenStackResource,
      query: {
        openStackCloudId: openStackCloudId,
        kind: OpenStackResourceKind.Domain,
      },
      limit: 500,
      skip: 0,
      select: { name: true, externalId: true },
      sort: { name: SortOrder.Ascending },
    });

  const options: Array<DropdownOption> = [];

  for (const row of result.data) {
    if (row.externalId) {
      options.push({
        value: row.externalId,
        label: row.name || row.externalId,
        isUserContent: true,
      });
    }
  }

  return options;
}

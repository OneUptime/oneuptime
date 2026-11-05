import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackMaintenancePart } from "Common/Types/OpenStack/OpenStackMaintenancePart";
import { OpenStackProjectNotToldReason } from "Common/Types/OpenStack/OpenStackProjectNotice";
import {
  OpenStackProjectPagePlan,
  OpenStackStatusPagePlan,
} from "Common/Types/OpenStack/OpenStackStatusPagePlan";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * What a cloud's status pages and notices ask the server: OpenStackProjectNoticeAPI. Each throws what the
 * server answered when it fails, so whatever asked can say so in its own frame, in the server's words.
 */

const BASE_ROUTE: string = "/openstack-project-notice";

async function post(data: {
  route: string;
  id: ObjectID;
  body?: JSONObject | undefined;
}): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString())
        .addRoute(`${BASE_ROUTE}/${data.route}`)
        .addRoute(data.id.toString()),
      data: data.body || {},
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response.data;
}

export interface OpenStackStatusPagePlanAnswer {
  plan: OpenStackStatusPagePlan;
  planKey: string;
}

export async function fetchOpenStackStatusPagePlan(
  openStackCloudId: ObjectID,
): Promise<OpenStackStatusPagePlanAnswer> {
  const answer: JSONObject = await post({
    route: "status-page-plan",
    id: openStackCloudId,
  });

  return {
    plan: answer["plan"] as unknown as OpenStackStatusPagePlan,
    planKey: String(answer["planKey"] || ""),
  };
}

export interface OpenStackStatusPageMadeAnswer {
  statusPageId: string;
  monitorsMade: number;
}

export async function makeOpenStackStatusPage(data: {
  openStackCloudId: ObjectID;
  planKey: string;
  name: string;
  isPublic: boolean;
}): Promise<OpenStackStatusPageMadeAnswer> {
  return (await post({
    route: "make-status-page",
    id: data.openStackCloudId,
    body: { planKey: data.planKey, name: data.name, isPublic: data.isPublic },
  })) as unknown as OpenStackStatusPageMadeAnswer;
}

export interface OpenStackObjectivesMadeAnswer {
  objectivesMade: number;
  objectivesLeft: number;
  monitorsMade: number;
}

export async function makeOpenStackObjectives(data: {
  openStackCloudId: ObjectID;
  planKey: string;
}): Promise<OpenStackObjectivesMadeAnswer> {
  return (await post({
    route: "make-objectives",
    id: data.openStackCloudId,
    body: { planKey: data.planKey },
  })) as unknown as OpenStackObjectivesMadeAnswer;
}

export type OpenStackProjectPagePlanAnswer = OpenStackProjectPagePlan & {
  isProjectInCloud: boolean;
};

export async function fetchOpenStackProjectPagePlan(data: {
  openStackCloudId: ObjectID;
  openStackProjectId: string;
}): Promise<OpenStackProjectPagePlanAnswer> {
  return (await post({
    route: "project-page-plan",
    id: data.openStackCloudId,
    body: { openStackProjectId: data.openStackProjectId },
  })) as unknown as OpenStackProjectPagePlanAnswer;
}

export async function makeOpenStackProjectPage(data: {
  openStackCloudId: ObjectID;
  openStackProjectId: string;
}): Promise<OpenStackStatusPageMadeAnswer> {
  return (await post({
    route: "make-project-page",
    id: data.openStackCloudId,
    body: { openStackProjectId: data.openStackProjectId },
  })) as unknown as OpenStackStatusPageMadeAnswer;
}

export interface OpenStackNoticePreview {
  previewToken: string;
  channel: string | null;
  address: string;
  projectId: string;
  projectName: string | null;
  isProjectInCloud: boolean;
  instanceCount: number;
  example: { subject: string; markdown: string };
}

export async function fetchOpenStackNoticePreview(
  noticeId: ObjectID,
): Promise<OpenStackNoticePreview> {
  return (await post({
    route: "preview",
    id: noticeId,
  })) as unknown as OpenStackNoticePreview;
}

export async function turnOnOpenStackNotice(data: {
  noticeId: ObjectID;
  previewToken: string;
}): Promise<void> {
  await post({
    route: "turn-on",
    id: data.noticeId,
    body: { previewToken: data.previewToken },
  });
}

export async function turnOffOpenStackNotice(
  noticeId: ObjectID,
): Promise<void> {
  await post({ route: "turn-off", id: noticeId });
}

export interface OpenStackWhoWouldBeTold {
  summary: string;
  isReachKnown: boolean;
  told: Array<{
    projectId: string;
    name: string | null;
    channel: string | null;
    address: string;
    instanceCount: number;
    volumeCount: number;
    routerCount: number;
    floatingIpCount: number;
  }>;
  notTold: Array<{ reason: OpenStackProjectNotToldReason; count: number }>;
  ofNoProject: JSONObject;
}

export async function fetchOpenStackWhoWouldBeTold(data: {
  openStackCloudId: ObjectID;
  part:
    | { kind: string; externalId: string }
    | { parts: Array<OpenStackMaintenancePart> };
}): Promise<OpenStackWhoWouldBeTold> {
  return (await post({
    route: "who-would-be-told",
    id: data.openStackCloudId,
    body: data.part as unknown as JSONObject,
  })) as unknown as OpenStackWhoWouldBeTold;
}

export async function fetchOpenStackMaintenanceCovering(data: {
  openStackCloudId: ObjectID;
  hostName: string;
  regionName: string | null;
}): Promise<Array<{ id: string; title: string }>> {
  const answer: JSONObject = await post({
    route: "maintenance-covering",
    id: data.openStackCloudId,
    body: { hostName: data.hostName, regionName: data.regionName },
  });

  return (
    (answer["events"] as unknown as Array<{
      id: string;
      title: string;
    }>) || []
  );
}

import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  OpenStackPlacement,
  OpenStackReachAcrossProducts,
  OpenStackServicePlacement,
  OpenStackStoragePoolCephLink,
  getEmptyOpenStackReachAcrossProducts,
} from "Common/Types/OpenStack/OpenStackLinks";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Which part of a cloud something in the rest of OneUptime is, and what a part of a cloud is
 * elsewhere. Each read is one of the server's joins (OpenStackAcrossProducts), which says
 * what makes a match a match.
 */

async function post(
  path: string,
  id: ObjectID,
  body?: JSONObject,
): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString())
        .addRoute(`/openstack-resource/${path}/`)
        .addRoute(id.toString()),
      data: body || {},
      headers: { ...ModelAPI.getCommonHeaders() },
    },
  );
  if (response instanceof HTTPErrorResponse) {
    throw response;
  }
  return response.data;
}

export async function fetchOpenStackPlacementOfHost(
  hostId: ObjectID,
): Promise<OpenStackPlacement | null> {
  const answer: JSONObject = await post("placement-of-host", hostId);
  return (answer["placement"] as unknown as OpenStackPlacement) || null;
}

export async function fetchOpenStackPlacementOfKubernetesNode(data: {
  clusterId: ObjectID;
  nodeName: string;
}): Promise<OpenStackPlacement | null> {
  const answer: JSONObject = await post(
    "placement-of-kubernetes-node",
    data.clusterId,
    { nodeName: data.nodeName },
  );
  return (answer["placement"] as unknown as OpenStackPlacement) || null;
}

export async function fetchOpenStackPlacementsOfService(
  serviceId: ObjectID,
): Promise<Array<OpenStackServicePlacement>> {
  const answer: JSONObject = await post("placement-of-service", serviceId);
  return (
    (answer["placements"] as unknown as Array<OpenStackServicePlacement>) || []
  );
}

export async function fetchOpenStackReachOfInstance(data: {
  openStackCloudId: ObjectID;
  instanceId: string;
}): Promise<OpenStackReachAcrossProducts> {
  const answer: JSONObject = await post(
    "reach-of-instance",
    data.openStackCloudId,
    { instanceId: data.instanceId },
  );
  return {
    ...getEmptyOpenStackReachAcrossProducts(),
    ...(answer as unknown as OpenStackReachAcrossProducts),
  };
}

export interface OpenStackStoragePoolCephRead {
  link: OpenStackStoragePoolCephLink;
  clusters: Array<{ id: string; name: string }>;
  health: number | null;
  capacityUsedPercent: number | null;
}

export async function fetchOpenStackStoragePoolCeph(data: {
  openStackCloudId: ObjectID;
  externalId: string;
}): Promise<OpenStackStoragePoolCephRead> {
  return (await post("storage-pool-ceph", data.openStackCloudId, {
    externalId: data.externalId,
  })) as unknown as OpenStackStoragePoolCephRead;
}

export async function confirmOpenStackStoragePoolCeph(data: {
  openStackCloudId: ObjectID;
  externalId: string;
  cephClusterId?: string | undefined;
  isNotCeph?: boolean | undefined;
  // Take the answer back, so the pool asks again.
  forget?: boolean | undefined;
}): Promise<void> {
  await post("storage-pool-ceph-confirm", data.openStackCloudId, {
    externalId: data.externalId,
    ...(data.cephClusterId ? { cephClusterId: data.cephClusterId } : {}),
    ...(data.isNotCeph ? { isNotCeph: true } : {}),
    ...(data.forget ? { forget: true } : {}),
  });
}

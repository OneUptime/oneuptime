import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  KubernetesComplianceResponse,
  getKubernetesComplianceRoute,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Dashboard's side of a cluster's compliance route (#9627,
 * Server/API/KubernetesResourceAPI.ts): how the cluster itself stands
 * against the Pod Security Standards and the CIS Kubernetes Benchmark.
 * Through the refresh-aware client with the project's headers, like every
 * other page's reads.
 */

export class KubernetesComplianceApiError extends Error {
  public readonly statusCode: number;

  public constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export default class KubernetesComplianceApi {
  public static async getClusterCompliance(
    clusterId: ObjectID,
  ): Promise<KubernetesComplianceResponse> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          getKubernetesComplianceRoute(clusterId.toString()),
        ),
        data: {},
        headers: { ...ModelAPI.getCommonHeaders() },
      });

    if (response instanceof HTTPErrorResponse) {
      throw new KubernetesComplianceApiError(
        API.getFriendlyMessage(response),
        response.statusCode,
      );
    }

    const body: JSONValue = response.data as JSONValue;
    const answer: Partial<KubernetesComplianceResponse> =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as unknown as Partial<KubernetesComplianceResponse>)
        : {};

    // An answer read defensively: lists as lists, whatever an older server sends.
    return {
      clusterId: answer.clusterId || clusterId.toString(),
      kubernetesVersion: answer.kubernetesVersion || null,
      standardVersion: answer.standardVersion || "",
      provider: answer.provider || null,
      isManagedControlPlane: answer.isManagedControlPlane === true,
      podCount: answer.podCount || 0,
      podsRead: answer.podsRead || 0,
      templateCount: answer.templateCount || 0,
      hasPolicyObjects: answer.hasPolicyObjects === true,
      policyEngine: answer.policyEngine || null,
      isTruncated: answer.isTruncated === true,
      namespaces: Array.isArray(answer.namespaces) ? answer.namespaces : [],
      frameworks: Array.isArray(answer.frameworks) ? answer.frameworks : [],
    };
  }
}

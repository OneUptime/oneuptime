import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import { LlmConnectorTransport } from "../../LlmConnectorTypes";
import LlmProviderHttp, {
  buildQueryString,
  readArray,
  readObject,
  readText,
} from "../../LlmProviderHttp";
import EntraTokenClient, {
  MicrosoftCloud,
} from "../Microsoft/EntraTokenClient";

/*
 * Microsoft Graph, the reads the Microsoft 365 Copilot connection makes as
 * an app registration with the AiEnterpriseInteraction.Read.All and
 * User.Read.All application permissions (and GroupMember.Read.All when it
 * reads one group's people):
 *
 *   GET /v1.0/users?$select=id,mail,userPrincipalName,displayName,accountEnabled&$top=999
 *   GET /v1.0/groups/{id}/transitiveMembers/microsoft.graph.user?$select=...&$top=999
 *   GET /v1.0/copilot/users/{id}/interactionHistory/getAllEnterpriseInteractions
 *       ?$filter=createdDateTime gt {start} and createdDateTime lt {end}&$top=100
 *     -> { value: [{ id, sessionId, requestId, appClass, interactionType
 *          (userPrompt | aiResponse), createdDateTime, body: { contentType,
 *          content }, attachments: [{ contentType, content }], from }],
 *          @odata.nextLink }
 *
 * From Microsoft's getAllEnterpriseInteractions reference: application
 * permission only, a filter on createdDateTime needs both bounds, $top of
 * 100 is recommended, and interactions are read one user at a time. Every
 * page is followed by its @odata.nextLink, on the Graph host only.
 */

const USERS_PAGE_SIZE: number = 999;
const INTERACTIONS_PAGE_SIZE: number = 100;
const MAX_USER_PAGES: number = 50;
const MAX_INTERACTION_PAGES: number = 20;
const PROVIDER_TITLE: string = "Microsoft 365 Copilot";

export interface GraphPerson {
  id: string;
  email: string;
  name: string;
}

export interface GraphCopilotClientOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  cloud: MicrosoftCloud;
  transport: LlmConnectorTransport;
  requestTimeoutInMs?: number | undefined;
}

export default class GraphCopilotClient {
  private options: GraphCopilotClientOptions;
  private tokens: EntraTokenClient;
  private requestCount: number = 0;

  public constructor(options: GraphCopilotClientOptions) {
    this.options = options;
    this.tokens = new EntraTokenClient({
      tenantId: options.tenantId,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      cloud: options.cloud,
      transport: options.transport,
      providerTitle: PROVIDER_TITLE,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });
  }

  public getRequestCount(): number {
    return this.requestCount + this.tokens.getRequestCount();
  }

  private getGraphBaseUrl(): string {
    return EntraTokenClient.getEndpoints(this.options.cloud).graphBaseUrl;
  }

  private async get(url: string, step: string): Promise<JSONObject> {
    const token: string = await this.tokens.getAccessToken(
      this.getGraphBaseUrl(),
    );

    this.requestCount++;

    return await LlmProviderHttp.requestJson({
      transport: this.options.transport,
      method: "GET",
      url,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      timeoutInMs: this.options.requestTimeoutInMs,
      step,
      providerTitle: PROVIDER_TITLE,
      secretValues: [this.options.clientSecret, token],
    });
  }

  // A nextLink is followed only when it stays on the Graph host.
  private nextLinkOf(response: JSONObject, current: string): string {
    const next: string = readText(response["@odata.nextLink"]);

    if (!next || next === current) {
      return "";
    }

    try {
      return new URL(next).host === new URL(this.getGraphBaseUrl()).host
        ? next
        : "";
    } catch {
      return "";
    }
  }

  private static readPerson(raw: unknown): GraphPerson | null {
    const user: JSONObject = readObject(raw);
    const id: string = readText(user["id"]);

    if (!id || user["accountEnabled"] === false) {
      return null;
    }

    return {
      id,
      email: readText(user["mail"]) || readText(user["userPrincipalName"]),
      name: readText(user["displayName"]),
    };
  }

  /*
   * The people whose Copilot use is read: everyone in the tenant, or the
   * members of one group (nested groups included), enabled accounts only.
   */
  public async listPeople(groupId: string): Promise<Array<GraphPerson>> {
    const select: Array<[string, string | number]> = [
      ["$select", "id,mail,userPrincipalName,displayName,accountEnabled"],
      ["$top", USERS_PAGE_SIZE],
    ];

    if (groupId) {
      EntraTokenClient.validateGuid(groupId, "Group object ID");
    }

    let url: string = groupId
      ? `${this.getGraphBaseUrl()}/v1.0/groups/${encodeURIComponent(
          groupId,
        )}/transitiveMembers/microsoft.graph.user?${buildQueryString(select)}`
      : `${this.getGraphBaseUrl()}/v1.0/users?${buildQueryString(select)}`;

    const people: Array<GraphPerson> = [];

    for (let index: number = 0; index < MAX_USER_PAGES && url; index++) {
      const response: JSONObject = await this.get(url, "people request");

      for (const raw of readArray(response["value"])) {
        const person: GraphPerson | null = GraphCopilotClient.readPerson(raw);

        if (person) {
          people.push(person);
        }
      }

      url = this.nextLinkOf(response, url);
    }

    return people.sort((a: GraphPerson, b: GraphPerson): number => {
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  // One person's Copilot interactions created in (startTime, endTime).
  public async listInteractions(data: {
    userId: string;
    startTime: Date;
    endTime: Date;
  }): Promise<Array<JSONObject>> {
    if (!data.userId || data.userId.includes("/") || data.userId.includes("?")) {
      throw new BadDataException("Not a Microsoft Entra user id.");
    }

    let url: string = `${this.getGraphBaseUrl()}/v1.0/copilot/users/${encodeURIComponent(
      data.userId,
    )}/interactionHistory/getAllEnterpriseInteractions?${buildQueryString([
      [
        "$filter",
        `createdDateTime gt ${data.startTime.toISOString()} and createdDateTime lt ${data.endTime.toISOString()}`,
      ],
      ["$top", INTERACTIONS_PAGE_SIZE],
    ])}`;

    const interactions: Array<JSONObject> = [];

    for (let index: number = 0; index < MAX_INTERACTION_PAGES && url; index++) {
      const response: JSONObject = await this.get(url, "interactions request");

      interactions.push(...readArray(response["value"]).map(readObject));

      url = this.nextLinkOf(response, url);
    }

    return interactions;
  }
}

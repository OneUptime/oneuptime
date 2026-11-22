import { fetchConnectorFieldChoices } from "../ConnectorFieldChoicesInput";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SecurityConnectorCheck } from "Common/Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  ConnectorFieldChoice,
  ConnectorFieldChoicesReport,
  readConnectorFieldChoiceValues,
} from "Common/Types/SecurityEvent/Connectors/ConnectorFieldChoices";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The calls the Block Addresses dialog makes (#10343): the connection's
 * blocking settings and status, read fresh; the zones the connection reads,
 * from the field-choices route the connection form uses; and the blocking
 * route's four actions (Common/Server/API/SecurityEventConnectionAPI).
 */

export function getBlockingRoute(
  connectionId: ObjectID,
  action: "check" | "turn-on" | "turn-off" | "put-back",
): string {
  return `/security-event-connection/${connectionId.toString()}/blocking/${action}`;
}

export interface BlockingCheckAnswer {
  // Whether every check passed: turn-on turned blocking on only then.
  isReady: boolean;
  checks: Array<SecurityConnectorCheck>;
}

async function postBlocking(
  connectionId: ObjectID,
  action: "check" | "turn-on" | "turn-off" | "put-back",
  body: JSONObject,
): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(
        getBlockingRoute(connectionId, action),
      ),
      headers: ModelAPI.getCommonHeaders(),
      data: body,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response.data || {};
}

function readChecks(answer: JSONObject): Array<SecurityConnectorCheck> {
  return Array.isArray(answer["checks"])
    ? (answer["checks"] as unknown as Array<SecurityConnectorCheck>)
    : [];
}

// The zones and a new token, as the route reads them.
export function getBlockingBody(data: {
  zoneIds: Array<string>;
  apiToken: string;
}): JSONObject {
  return {
    zoneIds: data.zoneIds,
    ...(data.apiToken.trim()
      ? { secrets: { apiToken: data.apiToken.trim() } }
      : {}),
  };
}

export async function checkBlocking(
  connectionId: ObjectID,
  body: JSONObject,
): Promise<BlockingCheckAnswer> {
  const answer: JSONObject = await postBlocking(connectionId, "check", body);

  return { isReady: answer["isReady"] === true, checks: readChecks(answer) };
}

export async function turnBlockingOn(
  connectionId: ObjectID,
  body: JSONObject,
): Promise<BlockingCheckAnswer> {
  const answer: JSONObject = await postBlocking(connectionId, "turn-on", body);

  return { isReady: answer["isOn"] === true, checks: readChecks(answer) };
}

export async function turnBlockingOff(
  connectionId: ObjectID,
  removeFromCloudflare: boolean,
): Promise<void> {
  await postBlocking(connectionId, "turn-off", { removeFromCloudflare });
}

export async function putBlockingBack(
  connectionId: ObjectID,
  zoneIds: Array<string>,
): Promise<void> {
  await postBlocking(connectionId, "put-back", { zoneIds });
}

// The connection as the dialog reads it, fresh: the table's row may be minutes old.
export async function readBlockingConnection(
  connectionId: ObjectID,
): Promise<SecurityEventConnection | null> {
  return await ModelAPI.getItem<SecurityEventConnection>({
    modelType: SecurityEventConnection,
    id: connectionId,
    select: {
      _id: true,
      projectId: true,
      name: true,
      provider: true,
      config: true,
      blockingSettings: true,
      blockingStatus: true,
    },
  });
}

/*
 * The zones the connection reads, to choose where blocking is on: the
 * token's zones of the connection's account, narrowed to the zones the
 * connection was set to read when it reads some.
 */
export async function readBlockingZoneChoices(
  connection: SecurityEventConnection,
  fetcher: (
    body: JSONObject,
  ) => Promise<ConnectorFieldChoicesReport> = fetchConnectorFieldChoices,
): Promise<Array<ConnectorFieldChoice>> {
  const report: ConnectorFieldChoicesReport = await fetcher({
    connectionId: connection.id!.toString(),
  });
  const accountId: string = String(connection.config?.["accountId"] || "")
    .trim()
    .toLowerCase();
  const readZoneIds: Array<string> = readConnectorFieldChoiceValues(
    String(connection.config?.["zoneIds"] || ""),
  ).map((zoneId: string): string => {
    return zoneId.toLowerCase();
  });

  return (report.choices["zoneIds"] || []).filter(
    (choice: ConnectorFieldChoice): boolean => {
      return (
        (!accountId ||
          !choice.parentValue ||
          choice.parentValue === accountId) &&
        (readZoneIds.length === 0 || readZoneIds.includes(choice.value))
      );
    },
  );
}

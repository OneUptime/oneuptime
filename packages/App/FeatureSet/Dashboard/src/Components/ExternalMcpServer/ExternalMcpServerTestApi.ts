import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  ExternalMcpServerConnectionCheck,
  isExternalMcpServerFailureKind,
} from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import { readExternalMcpServerTools } from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerTool";
import { isExternalMcpServerTransport } from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerTransport";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ExternalMcpServer from "Common/Models/DatabaseModels/ExternalMcpServer";
import { EXTERNAL_MCP_SERVER_TEST_REFUSED_SENTENCE } from "./ExternalMcpServerCopy";

/*
 * "Test connection" for an external MCP server: OneUptime connects with the
 * saved sign-in, reads the tools and says what it found
 * (POST /external-mcp-server/test). A server that cannot be reached is the
 * test's answer, not a failed request; a request the server refused (who
 * may test, the plan) is answered as a failed connection in its words.
 *
 * React-free so its tests read it without a browser.
 */

export const EXTERNAL_MCP_SERVER_API_PATH: string = "/external-mcp-server";

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

// The server's answer, read as the check it is - or a failure saying so.
export function readExternalMcpServerCheck(
  data: JSONObject | undefined,
): ExternalMcpServerConnectionCheck {
  if (!data || typeof data["isConnected"] !== "boolean") {
    return {
      isConnected: false,
      message:
        "The server did not return a test result. Check the API logs and try again.",
      tools: [],
      toolsLeftOut: 0,
      durationInMs: 0,
    };
  }

  const transport: unknown = data["transport"];
  const failureKind: unknown = data["failureKind"];

  return {
    isConnected: data["isConnected"] === true,
    message: readText(data["message"]) || "",
    failureKind: isExternalMcpServerFailureKind(failureKind)
      ? failureKind
      : undefined,
    transport: isExternalMcpServerTransport(transport) ? transport : undefined,
    serverName: readText(data["serverName"]),
    serverVersion: readText(data["serverVersion"]),
    protocolVersion: readText(data["protocolVersion"]),
    tools: readExternalMcpServerTools(data["tools"]),
    toolsLeftOut:
      typeof data["toolsLeftOut"] === "number" ? data["toolsLeftOut"] : 0,
    durationInMs:
      typeof data["durationInMs"] === "number" ? data["durationInMs"] : 0,
  };
}

/*
 * Whether the signed-in user may test a server: whoever may change it - its
 * update list, a team's block counted - as the server asks it. Refused, the
 * reason is the server's refusal, translated: the sentence, then who may.
 * Nothing to say until the permission snapshot has landed (hide the button
 * then).
 */
export function getExternalMcpServerTestGate(): PermissionGateResult {
  return PermissionGate.checkPermissions(
    new ExternalMcpServer().getUpdatePermissions(),
    {
      sentence: EXTERNAL_MCP_SERVER_TEST_REFUSED_SENTENCE,
    },
  );
}

export async function testExternalMcpServer(
  externalMcpServerId: string,
): Promise<ExternalMcpServerConnectionCheck> {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          `${EXTERNAL_MCP_SERVER_API_PATH}/test`,
        ),
        data: { externalMcpServerId },
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return readExternalMcpServerCheck(response.data as JSONObject);
  } catch (error) {
    return {
      isConnected: false,
      message: API.getFriendlyMessage(error),
      tools: [],
      toolsLeftOut: 0,
      durationInMs: 0,
    };
  }
}

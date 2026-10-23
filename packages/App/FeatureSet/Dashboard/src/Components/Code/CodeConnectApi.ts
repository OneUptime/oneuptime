import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import {
  CODE_REPOSITORY_CONNECTION_API_PATH,
  CodeHostConnectResultJSON,
  CodeHostConnectionJSON,
  CodeHostRepositoryListJSON,
  GitRepositoryConnectResultJSON,
} from "Common/Types/CodeRepository/CodeHostConnect";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Code's connect dialog's one door to the server: /code-repository-connection
 * (Common/Server/API/CodeRepositoryConnectionAPI). React-free, so tests and
 * the offline fixture can stand in for it. A token goes to the server and
 * nothing sends one back.
 */

// The repositories a source reaches: one of the project's connections, or a new token.
export type CodeConnectSource =
  | { connectionId: string }
  | { provider: CodeRepositoryType; hostUrl: string; token: string };

export default class CodeConnectApi {
  public static async listConnections(): Promise<
    Array<CodeHostConnectionJSON>
  > {
    const data: JSONObject = await CodeConnectApi.post("/list", {});

    return Array.isArray(data["connections"])
      ? (data["connections"] as unknown as Array<CodeHostConnectionJSON>)
      : [];
  }

  public static async listRepositories(data: {
    source: CodeConnectSource;
    search?: string | undefined;
    page?: number | undefined;
  }): Promise<CodeHostRepositoryListJSON> {
    const response: JSONObject = await CodeConnectApi.post("/repositories", {
      ...(data.source as unknown as JSONObject),
      ...(data.search ? { search: data.search } : {}),
      page: data.page || 1,
    });

    return {
      account: (response[
        "account"
      ] as unknown as CodeHostRepositoryListJSON["account"]) || {
        login: "",
        name: "",
      },
      hostUrl: (response["hostUrl"] as string) || "",
      ...(typeof response["hostProduct"] === "string"
        ? { hostProduct: response["hostProduct"] as string }
        : {}),
      repositories: Array.isArray(response["repositories"])
        ? (response[
            "repositories"
          ] as unknown as CodeHostRepositoryListJSON["repositories"])
        : [],
      hasMore: response["hasMore"] === true,
    };
  }

  public static async connect(data: {
    source: CodeConnectSource;
    repositoryIds: Array<string>;
  }): Promise<CodeHostConnectResultJSON> {
    return (await CodeConnectApi.post("/connect", {
      ...(data.source as unknown as JSONObject),
      repositoryIds: data.repositoryIds,
    })) as unknown as CodeHostConnectResultJSON;
  }

  public static async connectGitRepository(data: {
    url: string;
    username: string;
    password: string;
    connectWithoutCheck: boolean;
  }): Promise<GitRepositoryConnectResultJSON> {
    return (await CodeConnectApi.post("/connect-git", {
      url: data.url,
      username: data.username,
      password: data.password,
      connectWithoutCheck: data.connectWithoutCheck,
    })) as unknown as GitRepositoryConnectResultJSON;
  }

  public static async replaceToken(data: {
    connectionId: string;
    token: string;
    username?: string | undefined;
  }): Promise<{ accountLogin: string | null; credentialHint: string }> {
    const response: JSONObject = await CodeConnectApi.post(
      `/${data.connectionId}/token`,
      {
        token: data.token,
        ...(data.username !== undefined ? { username: data.username } : {}),
      },
    );

    return {
      accountLogin:
        typeof response["accountLogin"] === "string"
          ? (response["accountLogin"] as string)
          : null,
      credentialHint:
        typeof response["credentialHint"] === "string"
          ? (response["credentialHint"] as string)
          : "",
    };
  }

  private static async post(
    path: string,
    data: JSONObject,
  ): Promise<JSONObject> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          `${CODE_REPOSITORY_CONNECTION_API_PATH}${path}`,
        ),
        data: data,
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return (response.data as JSONObject) || {};
  }
}

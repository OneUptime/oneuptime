import BadDataException from "Common/Types/Exception/BadDataException";
import PullRequest from "Common/Types/CodeRepository/PullRequest";
import ObjectID from "Common/Types/ObjectID";
import URL from "Common/Types/API/URL";
import { GetOneUptimeURL, GetRepositorySecretKey } from "../Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import CopilotPullRequest from "Common/Models/DatabaseModels/CopilotPullRequest";
import CodeRepositoryUtil from "../Utils/CodeRepository";
import PullRequestState from "Common/Types/CodeRepository/PullRequestState";

export default class CopilotPullRequestService {
  public static async refreshPullRequestStatus(data: {
    copilotPullRequest: CopilotPullRequest;
  }): Promise<PullRequestState> {
    if (!data.copilotPullRequest.pullRequestId) {
      throw new BadDataException("Pull Request ID not found");
    }

    if (!data.copilotPullRequest.id) {
      throw new BadDataException("Copilot Pull Request ID not found");
    }

    const currentState: PullRequestState =
      await CodeRepositoryUtil.getPullRequestState({
        pullRequestId: data.copilotPullRequest.pullRequestId,
      });

    // update the status of the pull request in the database.

    const url: URL = URL.fromString(
      GetOneUptimeURL().toString() + "/api",
    ).addRoute(
      `${new CopilotPullRequest()
        .getCrudApiPath()
        ?.toString()}/update-pull-request-status/${GetRepositorySecretKey()}`,
    );

    const codeRepositoryResult: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(url, {
        copilotPullRequestId: data.copilotPullRequest.id?.toString(),
        copilotPullRequestStatus: currentState,
      });

    if (codeRepositoryResult instanceof HTTPErrorResponse) {
      throw codeRepositoryResult;
    }

    return currentState;
  }

  public static async getOpenPullRequestsFromDatabase(): Promise<
    Array<CopilotPullRequest>
  > {
    // send this to the API.
    const url: URL = URL.fromString(
      GetOneUptimeURL().toString() + "/api",
    ).addRoute(
      `${new CopilotPullRequest()
        .getCrudApiPath()
        ?.toString()}/get-pending-pull-requests/${GetRepositorySecretKey()}`,
    );

    const codeRepositoryResult: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get(url);

    if (codeRepositoryResult instanceof HTTPErrorResponse) {
      throw codeRepositoryResult;
    }

    const copilotPullRequestsJsonArray: Array<JSONObject> = codeRepositoryResult
      .data["copilotPullRequests"] as Array<JSONObject>;
    return CopilotPullRequest.fromJSONArray(
      copilotPullRequestsJsonArray,
      CopilotPullRequest,
    ) as Array<CopilotPullRequest>;
  }

  public static async addPullRequestToDatabase(data: {
    pullRequest: PullRequest;
    serviceCatalogId?: ObjectID | undefined;
    serviceRepositoryId?: ObjectID | undefined;
    isSetupPullRequest?: boolean | undefined;
  }): Promise<CopilotPullRequest> {
    let copilotPullRequest: CopilotPullRequest | null = null;

    if (data.pullRequest && data.pullRequest.pullRequestNumber) {
      copilotPullRequest = new CopilotPullRequest();
      copilotPullRequest.pullRequestId =
        data.pullRequest.pullRequestNumber.toString();
      copilotPullRequest.copilotPullRequestStatus = PullRequestState.Open;

      if (data.serviceCatalogId) {
        copilotPullRequest.serviceCatalogId = data.serviceCatalogId;
      }

      if (data.isSetupPullRequest) {
        copilotPullRequest.isSetupPullRequest = data.isSetupPullRequest;
      }

      if (data.serviceRepositoryId) {
        copilotPullRequest.serviceRepositoryId = data.serviceRepositoryId;
      }

      // send this to the API.
      const url: URL = URL.fromString(
        GetOneUptimeURL().toString() + "/api",
      ).addRoute(
        `${new CopilotPullRequest()
          .getCrudApiPath()
          ?.toString()}/add-pull-request/${GetRepositorySecretKey()}`,
      );

      const codeRepositoryResult: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post(url, {
          copilotPullRequest: CopilotPullRequest.toJSON(
            copilotPullRequest,
            CopilotPullRequest,
          ),
        });

      if (codeRepositoryResult instanceof HTTPErrorResponse) {
        throw codeRepositoryResult;
      }

      copilotPullRequest = CopilotPullRequest.fromJSON(
        codeRepositoryResult.data,
        CopilotPullRequest,
      ) as CopilotPullRequest;

      return copilotPullRequest;
    }

    throw new BadDataException("Pull Request Number not found");
  }
}

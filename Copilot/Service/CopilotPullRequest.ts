import BadDataException from "Common/Types/Exception/BadDataException";
import PullRequest from "Common/Types/CodeRepository/PullRequest";
import ObjectID from "Common/Types/ObjectID";
import URL from "Common/Types/API/URL";
import { GetOneUptimeURL, GetRepositorySecretKey } from "../Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import CopilotPullRequest from "Model/Models/CopilotPullRequest";
import CopilotPullRequestStatus from "Common/Types/Copilot/CopilotPullRequestStatus";

export default class CopilotPullRequestService {
  public static async getOpenPullRequests(): Promise<
    Array<CopilotPullRequest>
  > {
    return [];
  }

  public static async addPullRequestToDatabase(data: {
    pullRequest: PullRequest;
    serviceCatalogId?: ObjectID | undefined;
    serviceRepositoryId?: ObjectID | undefined;
  }): Promise<CopilotPullRequest> {
    let copilotPullRequest: CopilotPullRequest | null = null;

    if (data.pullRequest && data.pullRequest.pullRequestNumber) {
      copilotPullRequest = new CopilotPullRequest();
      copilotPullRequest.pullRequestId =
        data.pullRequest.pullRequestNumber.toString();
      copilotPullRequest.copilotPullRequestStatus =
        CopilotPullRequestStatus.Created;

      if (data.serviceCatalogId) {
        copilotPullRequest.serviceCatalogId = data.serviceCatalogId;
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

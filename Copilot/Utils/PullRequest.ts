import CopilotPullRequest from "Common/Models/DatabaseModels/CopilotPullRequest";
import CopilotPullRequestService from "../Service/CopilotPullRequest";
import PullRequestState from "Common/Types/CodeRepository/PullRequestState";

export default class PullRequestUtil {
  public static async getOpenPRs(): Promise<Array<CopilotPullRequest>> {
    const openPRs: Array<CopilotPullRequest> = [];

    // get all open pull requests.
    const openPullRequests: Array<CopilotPullRequest> =
      await CopilotPullRequestService.getOpenPullRequestsFromDatabase();

    for (const openPullRequest of openPullRequests) {
      // refresh status of this PR.

      if (!openPullRequest.pullRequestId) {
        continue;
      }

      const pullRequestState: PullRequestState =
        await CopilotPullRequestService.refreshPullRequestStatus({
          copilotPullRequest: openPullRequest,
        });

      if (pullRequestState === PullRequestState.Open) {
        openPRs.push(openPullRequest);
      }
    }

    return openPRs;
  }
}

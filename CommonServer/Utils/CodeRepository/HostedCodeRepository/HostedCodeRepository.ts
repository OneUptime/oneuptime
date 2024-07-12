import PullRequest from "Common/Types/CodeRepository/PullRequest";
import PullRequestState from "Common/Types/CodeRepository/PullRequestState";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotImplementedException from "Common/Types/Exception/NotImplementedException";

export default class HostedCodeRepository {
  public constructor(data: { authToken: string; username: string }) {
    if (!data.authToken) {
      throw new BadDataException("authToken is required");
    }

    if (!data.username) {
      throw new BadDataException("username is required");
    }

    this.username = data.username;

    this.authToken = data.authToken;
  }

  public authToken: string = "";
  public username: string = "";

  public async getPullRequests(_data: {
    pullRequestState: PullRequestState;
    baseBranchName?: string | undefined;
    organizationName: string;
    repositoryName: string;
  }): Promise<Array<PullRequest>> {
    throw new NotImplementedException();
  }

  public async createPullRequest(_data: {
    baseBranchName: string;
    headBranchName: string;
    organizationName: string;
    repositoryName: string;
    title: string;
    body: string;
  }): Promise<PullRequest> {
    throw new NotImplementedException();
  }

  public async pushChanges(_data: {
    branchName: string;
    organizationName: string;
    repositoryName: string;
  }): Promise<void> {
    throw new NotImplementedException();
  }

  public async addRemote(_data: {
    remoteName: string;
    organizationName: string;
    repositoryName: string;
  }): Promise<void> {
    throw new NotImplementedException();
  }
}

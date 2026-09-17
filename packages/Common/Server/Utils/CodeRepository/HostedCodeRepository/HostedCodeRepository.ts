import PullRequest from "../../../../Types/CodeRepository/PullRequest";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotImplementedException from "../../../../Types/Exception/NotImplementedException";
import CaptureSpan from "../../Telemetry/CaptureSpan";

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

  @CaptureSpan()
  public async getPullRequests(_data: {
    pullRequestState: PullRequestState;
    baseBranchName?: string | undefined;
    organizationName: string;
    repositoryName: string;
  }): Promise<Array<PullRequest>> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
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

  @CaptureSpan()
  public async pushChanges(_data: {
    branchName: string;
    organizationName: string;
    repositoryName: string;
  }): Promise<void> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public async addRemote(_data: {
    remoteName: string;
    organizationName: string;
    repositoryName: string;
  }): Promise<void> {
    throw new NotImplementedException();
  }
}

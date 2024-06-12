import URL from '../API/URL';
import PullRequestState from './PullRequestState';

export default interface PullRequest {
    url: URL;
    pullRequestId: number;
    pullRequestNumber: number;
    state: PullRequestState;
    title: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
    headRefName: string; // this is the branch name of the pull request
    repoOrganizationName: string;
    repoName: string;
}

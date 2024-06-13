import HostedCodeRepository from '../HostedCodeRepository/HostedCodeRepository';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import URL from 'Common/Types/API/URL';
import PullRequest from 'Common/Types/CodeRepository/PullRequest';
import PullRequestState from 'Common/Types/CodeRepository/PullRequestState';
import OneUptimeDate from 'Common/Types/Date';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import API from 'Common/Utils/API';
import Execute from '../../Execute';
import logger from '../../Logger';

export default class GitHubUtil extends HostedCodeRepository {

    private getPullRequestFromJSONObject(data: {
        pullRequest: JSONObject;
        organizationName: string;
        repositoryName: string;
    }): PullRequest {
        return {
            pullRequestId: data.pullRequest['id'] as number,
            pullRequestNumber: data.pullRequest['number'] as number,
            title: data.pullRequest['title'] as string,
            body: data.pullRequest['body'] as string,
            url: URL.fromString(data.pullRequest['url'] as string),
            state: data.pullRequest['state'] as PullRequestState,
            createdAt: OneUptimeDate.fromString(
                data.pullRequest['created_at'] as string
            ),
            updatedAt: OneUptimeDate.fromString(
                data.pullRequest['updated_at'] as string
            ),
            repoOrganizationName: data.organizationName,
            repoName: data.repositoryName,
            headRefName:
                data.pullRequest['head'] &&
                (data.pullRequest['head'] as JSONObject)['ref']
                    ? ((data.pullRequest['head'] as JSONObject)[
                          'ref'
                      ] as string)
                    : '',
        };
    }

    public async getPullRequestByNumber(data: {
        organizationName: string;
        repositoryName: string;
        pullRequestNumber: number;
    }): Promise<PullRequest> {
        const gitHubToken: string = this.authToken;

        const url: URL = URL.fromString(
            `https://api.github.com/repos/${data.organizationName}/${data.repositoryName}/pulls/${data.pullRequestNumber}`
        );

        const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
            await API.get(
                url,
                {},
                {
                    Authorization: `Bearer ${gitHubToken}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                }
            );

        if (result instanceof HTTPErrorResponse) {
            throw result;
        }

        return this.getPullRequestFromJSONObject({
            pullRequest: result.data,
            organizationName: data.organizationName,
            repositoryName: data.repositoryName,
        });
    }

    private async getPullRequestsByPage(data: {
        organizationName: string;
        repositoryName: string;
        pullRequestState: PullRequestState;
        baseBranchName: string;
        page: number;
    }): Promise<Array<PullRequest>> {
        const gitHubToken: string = this.authToken;

        const url: URL = URL.fromString(
            `https://api.github.com/repos/${data.organizationName}/${data.repositoryName}/pulls?base=${data.baseBranchName}&state=${data.pullRequestState}&per_page=100&page=${data.page}`
        );

        const result: HTTPErrorResponse | HTTPResponse<JSONArray> =
            await API.get(
                url,
                {},
                {
                    Authorization: `Bearer ${gitHubToken}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                }
            );

        if (result instanceof HTTPErrorResponse) {
            throw result;
        }

        const pullRequests: Array<PullRequest> = result.data.map(
            (pullRequest: JSONObject) => {
                return this.getPullRequestFromJSONObject({
                    pullRequest: pullRequest,
                    organizationName: data.organizationName,
                    repositoryName: data.repositoryName,
                });
            }
        );

        return pullRequests;
    }

    public override async getPullRequests(data: {
        pullRequestState: PullRequestState;
        baseBranchName: string;
        organizationName: string;
        repositoryName: string;
    }): Promise<Array<PullRequest>> {
        const allPullRequests: Array<PullRequest> = [];

        let page: number = 1;

        let pullRequests: Array<PullRequest> = await this.getPullRequestsByPage(
            {
                organizationName: data.organizationName,
                repositoryName: data.repositoryName,
                pullRequestState: data.pullRequestState,
                baseBranchName: data.baseBranchName,
                page: page,
            }
        );

        // Fetch all pull requests by paginating through the results
        // 100 pull requests per page is the limit of the GitHub API
        while (pullRequests.length === page * 100) {
            allPullRequests.push(...pullRequests);
            page++;
            pullRequests = await this.getPullRequestsByPage({
                organizationName: data.organizationName,
                repositoryName: data.repositoryName,
                pullRequestState: data.pullRequestState,
                baseBranchName: data.baseBranchName,
                page: page,
            });
        }

        return allPullRequests;
    }


    public override async addRemote(data: { remoteName: string; organizationName: string; repositoryName: string; }): Promise<void> {

        const url: URL = URL.fromString(
            `https://github.com/${data.organizationName}/${data.repositoryName}.git`
        );

        const command: string = `git remote add ${data.remoteName} ${url.toString()}`;

        logger.debug("Executing command: " + command);

        const result: string = await Execute.executeCommand(command);

        logger.debug(result);
    }


    public override async pushChanges(data: {
        branchName: string;
        organizationName: string;
        repoName: string;
    }){

        const branchName: string = data.branchName;

        const username: string = this.username; 
        const password: string = this.authToken;

        logger.debug("Pushing changes to remote repository with username: " + username);

        const command: string = `git push -u https://${username}:${password}@github.com/${data.organizationName}/${data.repositoryName}.git ${branchName}`;
        logger.debug("Executing command: " + command);

        const result: string = await Execute.executeCommand(command);

        logger.debug(result);
    }


    public override async createPullRequest(data: {
        baseBranchName: string;
        headBranchName: string;
        organizationName: string;
        repositoryName: string;
        title: string;
        body: string;
    }): Promise<PullRequest> {
        const gitHubToken: string = this.authToken;

        const url: URL = URL.fromString(
            `https://api.github.com/repos/${data.organizationName}/${data.repositoryName}/pulls`
        );

        const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
            await API.post(
                url,
                {
                    base: data.baseBranchName,
                    head: data.headBranchName,
                    title: data.title,
                    body: data.body,
                },
                {
                    Authorization: `Bearer ${gitHubToken}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                }
            );

        if (result instanceof HTTPErrorResponse) {
            throw result;
        }

        return this.getPullRequestFromJSONObject({
            pullRequest: result.data,
            organizationName: data.organizationName,
            repositoryName: data.repositoryName,
        });
    }
}

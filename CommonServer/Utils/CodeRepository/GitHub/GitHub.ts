import HostedCodeRepository from '../HostedCodeRepository/HostedCodeRepository';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import URL from 'Common/Types/API/URL';
import PullRequest from 'Common/Types/CodeRepository/PullRequest';
import PullRequestState from 'Common/Types/CodeRepository/PullRequestState';
import OneUptimeDate from 'Common/Types/Date';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import API from 'Common/Utils/API';

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

    public override async getPullRequests(data: {
        pullRequestState: PullRequestState;
        baseBranchName: string;
        organizationName: string;
        repositoryName: string;
    }): Promise<Array<PullRequest>> {
        const gitHubToken: string = this.authToken;

        const url: URL = URL.fromString(
            `https://api.github.com/repos/${data.organizationName}/${data.repositoryName}/pulls?base=${data.baseBranchName}&state=${data.pullRequestState}`
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
}

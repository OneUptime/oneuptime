import ServiceRepository from "Model/Models/ServiceRepository";
import HostedCodeRepository from "../HostedCodeRepository/HostedCodeRepository";
import PullRequestState from 'Common/Types/CodeRepository/PullRequestState';
import PullRequest from "Common/Types/CodeRepository/PullRequest";

export default class GitHubUtil extends HostedCodeRepository {

    public override async getPullRequestsByService(data: {
        serviceRepository: ServiceRepository;
        pullRequestState: PullRequestState;
        baseBranchName?: string | undefined;
    }): Promise<Array<PullRequest>> {
        const gitHubToken: string = this.authToken; 
        const { serviceRepository } = data;

        return []; 

        // fetch all open pull requests for the repository on github

    }

}
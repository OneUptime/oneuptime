import PullRequestState from "Common/Types/CodeRepository/PullRequestState";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotImplementedException from "Common/Types/Exception/NotImplementedException";
import ServiceRepository from "Model/Models/ServiceRepository";
import PullRequest from "Common/Types/CodeRepository/PullRequest";

export default class HostedCodeRepository { 

    public constructor(data: { authToken: string }) {

        if(!data.authToken){
            throw new BadDataException('authToken is required');
        }

        this.authToken = data.authToken;
    }

    public authToken: string = '';

    public async numberOfPullRequestsExistForService(data: {
        serviceRepository: ServiceRepository,
        pullRequestState: PullRequestState,
        baseBranchName?: string | undefined
    }): Promise<number>{
        return (await this.getPullRequestsByService({
            serviceRepository: data.serviceRepository,
            pullRequestState: data.pullRequestState,
            baseBranchName: data.baseBranchName
        })).length;
    }

    public async getPullRequestsByService(_data: {
        serviceRepository: ServiceRepository;
        pullRequestState: PullRequestState;
        baseBranchName?: string | undefined;
    }): Promise<Array<PullRequest>> {
        throw new NotImplementedException();
    }
}
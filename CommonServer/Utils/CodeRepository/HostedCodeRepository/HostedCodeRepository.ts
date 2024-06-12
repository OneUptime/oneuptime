import PullRequest from 'Common/Types/CodeRepository/PullRequest';
import PullRequestState from 'Common/Types/CodeRepository/PullRequestState';
import BadDataException from 'Common/Types/Exception/BadDataException';
import NotImplementedException from 'Common/Types/Exception/NotImplementedException';
import ServiceRepository from 'Model/Models/ServiceRepository';

export default class HostedCodeRepository {
    public constructor(data: { authToken: string }) {
        if (!data.authToken) {
            throw new BadDataException('authToken is required');
        }

        this.authToken = data.authToken;
    }

    public authToken: string = '';

    public async getNumberOfPullRequestsExistForService(data: {
        serviceRepository: ServiceRepository;
        pullRequestState: PullRequestState;
        baseBranchName: string | undefined;
        organizationName: string;
        repositoryName: string;
    }): Promise<number> {
        return (
            await this.getPullRequestsByService({
                serviceRepository: data.serviceRepository,
                pullRequestState: data.pullRequestState,
                baseBranchName: data.baseBranchName,
                organizationName: data.organizationName,
                repositoryName: data.repositoryName,
            })
        ).length;
    }

    public async getPullRequestsByService(data: {
        serviceRepository: ServiceRepository;
        pullRequestState: PullRequestState;
        baseBranchName?: string | undefined;
        organizationName: string;
        repositoryName: string;
    }): Promise<Array<PullRequest>> {
        if (!data.serviceRepository) {
            throw new BadDataException('serviceRepository is required');
        }

        if (!data.serviceRepository.serviceCatalog) {
            throw new BadDataException(
                'serviceRepository.serviceCatalog is required'
            );
        }

        if (!data.serviceRepository.serviceCatalog.name) {
            throw new BadDataException(
                'serviceRepository.serviceCatalog.name is required'
            );
        }

        const pullRequests: Array<PullRequest> = await this.getPullRequests({
            pullRequestState: data.pullRequestState,
            baseBranchName: data.baseBranchName,
            organizationName: data.organizationName,
            repositoryName: data.repositoryName,
        });

        return pullRequests.filter((pullRequest: PullRequest) => {
            return pullRequest.headRefName.includes(
                `oneuptime-${data.serviceRepository.serviceCatalog?.name?.toLowerCase()}`
            );
        });
    }

    public async getPullRequests(_data: {
        pullRequestState: PullRequestState;
        baseBranchName?: string | undefined;
        organizationName: string;
        repositoryName: string;
    }): Promise<Array<PullRequest>> {
        throw new NotImplementedException();
    }
}

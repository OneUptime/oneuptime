import {
    GetGitHubToken,
    GetGitHubUsername,
    GetLocalRepositoryPath,
    GetOneUptimeURL,
    GetRepositorySecretKey,
} from '../Config';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import URL from 'Common/Types/API/URL';
import CodeRepositoryType from 'Common/Types/CodeRepository/CodeRepositoryType';
import PullRequestState from 'Common/Types/CodeRepository/PullRequestState';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import API from 'Common/Utils/API';
import GitHubUtil from 'CommonServer/Utils/CodeRepository/GitHub/GitHub';
import logger from 'CommonServer/Utils/Logger';
import CodeRepositoryModel from 'Model/Models/CodeRepository';
import ServiceRepository from 'Model/Models/ServiceRepository';
import CodeRepositoryServerUtil from 'CommonServer/Utils/CodeRepository/CodeRepository'
import PullRequest from 'Common/Types/CodeRepository/PullRequest';

export interface CodeRepositoryResult {
    codeRepository: CodeRepositoryModel;
    servicesRepository: Array<ServiceRepository>;
}

export default class CodeRepositoryUtil {
    public static codeRepositoryResult: CodeRepositoryResult | null = null;
    public static gitHubUtil: GitHubUtil | null = null;


    public static getGitHubUtil(): GitHubUtil {
        if (!this.gitHubUtil) {
            const gitHubToken: string | null = GetGitHubToken();

            const gitHubUsername: string | null = GetGitHubUsername();

            if (!gitHubUsername) {
                throw new BadDataException('GitHub Username is required');
            }
            

            if (!gitHubToken) {
                throw new BadDataException('GitHub Token is required');
            }

        
            this.gitHubUtil = new GitHubUtil({
                authToken: gitHubToken,
                username: gitHubUsername!,
            });
        }

        return this.gitHubUtil;
    }

    public static async createBranch(data: {
        branchName: string;
        serviceRepository: ServiceRepository;
    }): Promise<void> {

        const branchName = 'oneuptime-' + (data.serviceRepository.serviceCatalog?.name?.toLowerCase()) + '-' + data.branchName;

        await CodeRepositoryServerUtil.createBranch({
            repoPath: GetLocalRepositoryPath(),
            branchName: branchName,
        })
    }

    public static async createOrCheckoutBranch(data: {
        serviceRepository: ServiceRepository;
        branchName: string;
    }): Promise<void> {

        const branchName = 'oneuptime-' + (data.serviceRepository.serviceCatalog?.name?.toLowerCase()) + '-' + data.branchName;

        await CodeRepositoryServerUtil.createOrCheckoutBranch({
            repoPath: GetLocalRepositoryPath(),
            branchName: branchName,
        })
    }

    public static async writeToFile(data: {
        filePath: string;
        content: string;
    }): Promise<void> {
        await CodeRepositoryServerUtil.writeToFile({
            repoPath: GetLocalRepositoryPath(),
            filePath: data.filePath,
            content: data.content,
        })
    }

    public static async createDirectory(data: {
        directoryPath: string;
    }): Promise<void> {
        await CodeRepositoryServerUtil.createDirectory({
            repoPath: GetLocalRepositoryPath(),
            directoryPath: data.directoryPath,
        })
    }

    public static async deleteFile(data: {
        filePath: string;
    }): Promise<void> {
        await CodeRepositoryServerUtil.deleteFile({
            repoPath: GetLocalRepositoryPath(),
            filePath: data.filePath,
        })
    }

    public static async deleteDirectory(data: {
        directoryPath: string;
    }): Promise<void> {
        await CodeRepositoryServerUtil.deleteDirectory({
            repoPath: GetLocalRepositoryPath(),
            directoryPath: data.directoryPath,
        })
    }

    public static async discardChanges(): Promise<void> {
        await CodeRepositoryServerUtil.discardChanges({
            repoPath: GetLocalRepositoryPath(),
        })
    }

    public static async checkoutBranch(data: {
        branchName: string;
    }): Promise<void> {
        await CodeRepositoryServerUtil.checkoutBranch({
            repoPath: GetLocalRepositoryPath(),
            branchName: data.branchName,
        })
    }

    public static async checkoutMainBranch(): Promise<void> {
        const codeRepository: CodeRepositoryModel = await this.getCodeRepository();

        if (!codeRepository.mainBranchName) {
            throw new BadDataException('Main Branch Name is required');
        }

        await this.checkoutBranch({
            branchName: codeRepository.mainBranchName!,
        });
    }

    public static async addFilesToGit(data: {
        filePaths: Array<string>;
    }): Promise<void> {
        await CodeRepositoryServerUtil.addFilesToGit({
            repoPath: GetLocalRepositoryPath(),
            filePaths: data.filePaths,
        })
    }

    public static async commitChanges(data: {
        message: string;
    }): Promise<void> {
        await CodeRepositoryServerUtil.commitChanges({
            repoPath: GetLocalRepositoryPath(),
            message: data.message,
        })
    }

    public static async pushChanges(data: {
        branchName: string;
    }): Promise<void> {

        const codeRepository: CodeRepositoryModel = await this.getCodeRepository();

        if (!codeRepository.mainBranchName) {
            throw new BadDataException('Main Branch Name is required');
        }


        if(!codeRepository.organizationName){
            throw new BadDataException('Organization Name is required');
        }

        if(!codeRepository.repositoryName){
            throw new BadDataException('Repository Name is required');
        }

        if (codeRepository.repositoryHostedAt === CodeRepositoryType.GitHub) {
            return await this.getGitHubUtil().pushChanges({
                branchName: data.branchName,
                organizationName: codeRepository.organizationName,
                repoName: codeRepository.repositoryName,
            });
        }
    }


    public static async createPullRequest(data: {
        branchName: string;
        title: string;
        body: string;
    }): Promise<PullRequest> {

        const codeRepository: CodeRepositoryModel = await this.getCodeRepository();

        if (!codeRepository.mainBranchName) {
            throw new BadDataException('Main Branch Name is required');
        }

        if (!codeRepository.organizationName) {
            throw new BadDataException('Organization Name is required');
        }

        if (!codeRepository.repositoryName) {
            throw new BadDataException('Repository Name is required');
        }


        if (codeRepository.repositoryHostedAt === CodeRepositoryType.GitHub) {
            return await this.getGitHubUtil().createPullRequest({
                headBranchName: data.branchName,
                baseBranchName: codeRepository.mainBranchName,
                organizationName: codeRepository.organizationName,
                repositoryName: codeRepository.repositoryName,
                title: data.title,
                body: data.body,
            });

        } else {
            throw new BadDataException('Code Repository type not supported');
        }

    }



    public static async getServicesToImproveCode(data: {
        codeRepository: CodeRepositoryModel;
        services: Array<ServiceRepository>;
    }): Promise<Array<ServiceRepository>> {
        const servicesToImproveCode: Array<ServiceRepository> = [];

        for (const service of data.services) {
            if (!data.codeRepository.mainBranchName) {
                throw new BadDataException('Main Branch Name is required');
            }

            if (!data.codeRepository.organizationName) {
                throw new BadDataException('Organization Name is required');
            }

            if (!data.codeRepository.repositoryName) {
                throw new BadDataException('Repository Name is required');
            }

            if (!service.limitNumberOfOpenPullRequestsCount) {
                throw new BadDataException(
                    'Limit Number Of Open Pull Requests Count is required'
                );
            }

            if (
                data.codeRepository.repositoryHostedAt ===
                CodeRepositoryType.GitHub
            ) {
                const gitHuhbToken: string | null = GetGitHubToken();

                if (!gitHuhbToken) {
                    throw new BadDataException('GitHub Token is required');
                }

                const numberOfPullRequestForThisService: number =
                    await this.getGitHubUtil().getNumberOfPullRequestsExistForService({
                        serviceRepository: service,
                        pullRequestState: PullRequestState.Open,
                        baseBranchName: data.codeRepository.mainBranchName,
                        organizationName: data.codeRepository.organizationName,
                        repositoryName: data.codeRepository.repositoryName,
                    });

                if (
                    numberOfPullRequestForThisService <
                    service.limitNumberOfOpenPullRequestsCount
                ) {
                    servicesToImproveCode.push(service);
                    logger.info(
                        `Service ${service.serviceCatalog?.name} has ${numberOfPullRequestForThisService} open pull requests. Limit is ${service.limitNumberOfOpenPullRequestsCount}. Adding to the list to improve code...`
                    );
                } else {
                    logger.warn(
                        `Service ${service.serviceCatalog?.name} has ${numberOfPullRequestForThisService} open pull requests. Limit is ${service.limitNumberOfOpenPullRequestsCount}. Skipping...`
                    );
                }
            }
        }

        return servicesToImproveCode;
    }

    public static async getCodeRepositoryResult(): Promise<CodeRepositoryResult> {
        if (this.codeRepositoryResult) {
            return this.codeRepositoryResult;
        }

        const repositorySecretKey: string | null = GetRepositorySecretKey();

        if (!repositorySecretKey) {
            throw new BadDataException('Repository Secret Key is required');
        }

        const url: URL = URL.fromString(
            GetOneUptimeURL().toString() + '/api'
        ).addRoute(
            `${new CodeRepositoryModel()
                .getCrudApiPath()
                ?.toString()}/get-code-repository/${repositorySecretKey}`
        );

        const codeRepositoryResult:
            | HTTPErrorResponse
            | HTTPResponse<JSONObject> = await API.get(url);

        if (codeRepositoryResult instanceof HTTPErrorResponse) {
            throw codeRepositoryResult;
        }

        const codeRepository: CodeRepositoryModel =
            CodeRepositoryModel.fromJSON(
                codeRepositoryResult.data['codeRepository'] as JSONObject,
                CodeRepositoryModel
            ) as CodeRepositoryModel;

        const servicesRepository: Array<ServiceRepository> = (
            codeRepositoryResult.data['servicesRepository'] as JSONArray
        ).map((serviceRepository: JSONObject) => {
            return ServiceRepository.fromJSON(
                serviceRepository,
                ServiceRepository
            ) as ServiceRepository;
        });

        if (!codeRepository) {
            throw new BadDataException(
                'Code Repository not found with the secret key provided.'
            );
        }

        if (!servicesRepository || servicesRepository.length === 0) {
            throw new BadDataException(
                'No services attached to this repository. Please attach services to this repository on OneUptime Dashboard.'
            );
        }

        logger.info(`Code Repository found: ${codeRepository.name}`);

        logger.info('Services found in the repository:');

        servicesRepository.forEach((serviceRepository: ServiceRepository) => {
            logger.info(`- ${serviceRepository.serviceCatalog?.name}`);
        });

        this.codeRepositoryResult = {
            codeRepository,
            servicesRepository,
        };

        return this.codeRepositoryResult;
    }

    public static async getCodeRepository(): Promise<CodeRepositoryModel> {
        if (!this.codeRepositoryResult) {
            const result: CodeRepositoryResult =
                await this.getCodeRepositoryResult();
            return result.codeRepository;
        }

        return this.codeRepositoryResult.codeRepository;
    }

    public static async getServiceRepositories(): Promise<
        Array<ServiceRepository>
    > {
        if (!this.codeRepositoryResult) {
            const result: CodeRepositoryResult =
                await this.getCodeRepositoryResult();
            return result.servicesRepository;
        }

        return this.codeRepositoryResult.servicesRepository;
    }
}

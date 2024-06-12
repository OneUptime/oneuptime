import {
    GetGitHubToken,
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

export interface CodeRepositoryResult {
    codeRepository: CodeRepositoryModel;
    servicesRepository: Array<ServiceRepository>;
}

export default class CodeRepositoryUtil {
    public static codeRepositoryResult: CodeRepositoryResult | null = null;

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
                    await new GitHubUtil({
                        authToken: gitHuhbToken,
                    }).getNumberOfPullRequestsExistForService({
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

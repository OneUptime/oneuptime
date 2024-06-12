import { GetOneUptimeURL, GetRepositorySecretKey } from '../Config';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import URL from 'Common/Types/API/URL';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import API from 'Common/Utils/API';
import logger from 'CommonServer/Utils/Logger';
import CodeRepositoryModel from 'Model/Models/CodeRepository';
import ServiceRepository from 'Model/Models/ServiceRepository';

export interface CodeRepositoryResult {
    codeRepository: CodeRepositoryModel;
    servicesRepository: Array<ServiceRepository>;
}

export default class CodeRepositoryUtil {
    public static async getCodeRepository(): Promise<CodeRepositoryResult> {
        const repositorySecretKey: string = GetRepositorySecretKey();

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

        const servicesRepository: Array<ServiceRepository> =
            (codeRepositoryResult.data['servicesRepository'] as JSONArray).map(
                (serviceRepository: JSONObject) =>
                    ServiceRepository.fromJSON(
                        serviceRepository,
                        ServiceRepository
                    ) as ServiceRepository
            );

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

        return {
            codeRepository,
            servicesRepository,
        };
    }
}

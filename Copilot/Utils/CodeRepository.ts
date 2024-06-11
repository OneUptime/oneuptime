import { GetOneUptimeURL, GetRepositorySecretKey } from '../Config';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import URL from 'Common/Types/API/URL';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';
import API from 'Common/Utils/API';
import CodeRepositoryModel from 'Model/Models/CodeRepository';

export default class CodeRepositoryUtil {
    public static async getCodeRepository(): Promise<CodeRepositoryModel> {
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
                codeRepositoryResult.data as JSONObject,
                CodeRepositoryModel
            ) as CodeRepositoryModel;

        if (!codeRepository) {
            throw new BadDataException(
                'Code Repository not found with the secret key provided.'
            );
        }

        return codeRepository;
    }
}

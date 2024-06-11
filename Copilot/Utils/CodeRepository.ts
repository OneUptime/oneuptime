import CodeRepositoryModel from 'Model/Models/CodeRepository';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import URL from 'Common/Types/API/URL';
import { OneUptimeURL, RepositorySecretKey } from '../Config';
import ObjectID from 'Common/Types/ObjectID';
import BadDataException from 'Common/Types/Exception/BadDataException';

export default class CodeRepositoryUtil {
    public static async getCodeRepository(): Promise<CodeRepositoryModel> {
        const codeRepository: CodeRepositoryModel | null =  await ModelAPI.getItem<CodeRepositoryModel>({
            modelType: CodeRepositoryModel,
            select: {},
            requestOptions: {
                overrideRequestUrl: URL.fromString(OneUptimeURL.toString()+'/api').addRoute(`${new CodeRepositoryModel().getCrudApiPath()
                    ?.toString()}/get-code-repository/${RepositorySecretKey}`),
            },
            id: ObjectID.getZeroObjectID() // we dont care about this id. 
        });

        if(!codeRepository) {
            throw new BadDataException('Code Repository not found with the secret key provided.');
        }

        return codeRepository;

    }
}

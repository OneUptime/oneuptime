import BadDataException from "Common/Types/Exception/BadDataException";
import NotImplementedException from "Common/Types/Exception/NotImplementedException";
import ServiceRepository from "Model/Models/ServiceRepository";

export default class HostedCodeRepository { 

    public constructor(data: { authToken: string }) {

        if(!data.authToken){
            throw new BadDataException('authToken is required');
        }

        this.authToken = data.authToken;
    }

    public authToken: string = '';

    public async numberOfPullRequestsExistForService(_data: {
        serviceRepository: ServiceRepository
    }): Promise<number>{
        throw new NotImplementedException();
    }
}
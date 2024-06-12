import ServiceRepository from "Model/Models/ServiceRepository";
import HostedCodeRepository from "../HostedCodeRepository";

export default class GitHubUtil extends HostedCodeRepository {
    
    public override async numberOfPullRequestsExistForService(data: {
        serviceRepository: ServiceRepository
    }): Promise<number> {
        const gitHubToken: string = this.authToken; 
        const { serviceRepository } = data;


        // fetch all open pull requests for the repository on github

    }
}
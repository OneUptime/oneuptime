import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import { GetGitHubToken, GetRepositorySecretKey, GetRepositoryType } from "../Config";
import BadDataException from "Common/Types/Exception/BadDataException";

export default class InitUtil {
    public static async validate(): Promise<void> {

        // Check if the repository type is GitHub and the GitHub token is provided
        if(GetRepositoryType() === CodeRepositoryType.GitHub && !GetGitHubToken()){
            throw new BadDataException("GitHub token is required");
        }


        if(!GetRepositorySecretKey()){
            throw new BadDataException("Repository Secret Key is required");
        }
    }
}
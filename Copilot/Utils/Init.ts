import { GetGitHubToken, GetRepositorySecretKey } from "../Config";
import CodeRepositoryUtil, { CodeRepositoryResult } from "./CodeRepository";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import BadDataException from "Common/Types/Exception/BadDataException";
import ServiceRepository from "Model/Models/ServiceRepository";

export default class InitUtil {
  public static async init(): Promise<CodeRepositoryResult> {
    if (!GetRepositorySecretKey()) {
      throw new BadDataException("Repository Secret Key is required");
    }

    const codeRepositoryResult: CodeRepositoryResult =
      await CodeRepositoryUtil.getCodeRepositoryResult();

    // Check if the repository type is GitHub and the GitHub token is provided

    if (codeRepositoryResult.servicesRepository.length === 0) {
      throw new BadDataException(
        "No services found in the repository. Please add services to the repository in OneUptime Dashboard.",
      );
    }

    if (
      codeRepositoryResult.codeRepository.repositoryHostedAt ===
        CodeRepositoryType.GitHub &&
      !GetGitHubToken()
    ) {
      throw new BadDataException(
        "GitHub token is required for this repository. Please provide the GitHub token in the environment variables.",
      );
    }

    const servicesToImrpoveCode: Array<ServiceRepository> =
      await CodeRepositoryUtil.getServicesToImproveCode({
        codeRepository: codeRepositoryResult.codeRepository,
        services: codeRepositoryResult.servicesRepository,
      });

    return {
      codeRepository: codeRepositoryResult.codeRepository,
      servicesRepository: servicesToImrpoveCode,
    };
  }
}

import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import ImproveComments from "./ImproveComments";
import Dictionary from "Common/Types/Dictionary";
import CopilotActionBase from "./CopilotActionsBase";
import BadDataException from "Common/Types/Exception/BadDataException";
import CodeRepositoryUtil, { RepoScriptType } from "../../Utils/CodeRepository";
import ServiceCopilotCodeRepository from "Common/Models/DatabaseModels/ServiceCopilotCodeRepository";
import PullRequest from "Common/Types/CodeRepository/PullRequest";
import CopilotAction from "Common/Models/DatabaseModels/CopilotAction";
import ObjectID from "Common/Types/ObjectID";
import CopilotActionStatus from "Common/Types/Copilot/CopilotActionStatus";
import logger from "Common/Server/Utils/Logger";
import CopilotPullRequest from "Common/Models/DatabaseModels/CopilotPullRequest";
import CopilotPullRequestService from "../CopilotPullRequest";
import CopilotActionUtil from "../../Utils/CopilotAction";
import { CopilotProcess } from "./Types";

export const ActionDictionary: Dictionary<typeof CopilotActionBase> = {
  [CopilotActionType.IMPROVE_COMMENTS]: ImproveComments,
};

export interface CopilotExecutionResult {
  status: CopilotActionStatus;
  pullRequest: PullRequest | null;
}

export default class CopilotActionService {
  public static async execute(data: {
    serviceRepository: ServiceCopilotCodeRepository;
    copilotAction: CopilotAction;
  }): Promise<CopilotExecutionResult> {
    await CodeRepositoryUtil.discardAllChangesOnCurrentBranch();

    await CodeRepositoryUtil.switchToMainBranch();

    await CodeRepositoryUtil.pullChanges();

    const ActionType: typeof CopilotActionBase | undefined =
      ActionDictionary[data.copilotAction.copilotActionType!];

    if (!ActionType) {
      throw new BadDataException("Invalid CopilotActionType");
    }

    const action: CopilotActionBase = new ActionType() as CopilotActionBase;

    const processResult: CopilotProcess | null = await action.execute({
      input: data.copilotAction.copilotActionProp!,
    });

    let executionResult: CopilotExecutionResult = {
      status: CopilotActionStatus.NO_ACTION_REQUIRED,
      pullRequest: null,
    };

    let pullRequest: PullRequest | null = null;

    if (
      processResult &&
      processResult.result &&
      processResult.result.files &&
      Object.keys(processResult.result.files).length > 0
    ) {
      logger.info("Obtained result from Copilot Action");
      logger.info("Committing the changes to the repository and creating a PR");

      const branchName: string = CodeRepositoryUtil.getBranchName({
        branchName: await action.getBranchName(),
      });

      // create a branch

      await CodeRepositoryUtil.createBranch({
        branchName: branchName,
      });

      // write all the modified files.
      const filePaths: string[] = Object.keys(processResult.result.files);

      // run on before commit script. This is the place where we can run tests.

      const onBeforeCommitScript: string | null =
        await CodeRepositoryUtil.getRepoScript({
          scriptType: RepoScriptType.OnBeforeCommit,
        });

      if (!onBeforeCommitScript) {
        logger.debug("No on-before-commit script found for this repository.");
      } else {
        logger.info("Executing on-before-commit script.");
        await CodeRepositoryUtil.executeScript({
          script: onBeforeCommitScript,
        });
        logger.info("on-before-commit script executed successfully.");
      }

      const commitMessage: string =
        await action.getCommitMessage(processResult);

      const onAfterCommitScript: string | null =
        await CodeRepositoryUtil.getRepoScript({
          scriptType: RepoScriptType.OnAfterCommit,
        });

      if (!onAfterCommitScript) {
        logger.debug("No on-after-commit script found for this repository.");
      }

      if (onAfterCommitScript) {
        logger.info("Executing on-after-commit script.");
        await CodeRepositoryUtil.executeScript({
          script: onAfterCommitScript,
        });
        logger.info("on-after-commit script executed successfully.");
      }

      // add files to stage

      logger.info("Adding files to stage: ");

      for (const filePath of filePaths) {
        logger.info(`- ${filePath}`);
      }

      await CodeRepositoryUtil.addFilesToGit({
        filePaths: filePaths,
      });

      // commit changes
      logger.info("Committing changes");
      await CodeRepositoryUtil.commitChanges({
        message: commitMessage,
      });

      // push changes
      logger.info("Pushing changes");
      await CodeRepositoryUtil.pushChanges({
        branchName: branchName,
      });

      // create a PR
      logger.info("Creating a PR");
      pullRequest = await CodeRepositoryUtil.createPullRequest({
        branchName: branchName,
        title: await action.getPullRequestTitle(processResult),
        body: await action.getPullRequestBody(processResult),
      });

      // switch to main branch.
      logger.info("Switching to main branch");
      await CodeRepositoryUtil.switchToMainBranch();

      //save the result to the database.
      logger.info("Saving the result to the database");
      executionResult = {
        status: CopilotActionStatus.PR_CREATED,
        pullRequest: pullRequest,
      };
    }

    if (
      !processResult ||
      !processResult.result ||
      !processResult.result.files ||
      Object.keys(processResult.result.files).length === 0
    ) {
      logger.info("No result obtained from Copilot Action");
    }

    const getCurrentCommitHash: string =
      await CodeRepositoryUtil.getCurrentCommitHash();

    await CopilotActionService.updateCopilotAction({
      serviceCatalogId: data.serviceRepository.serviceCatalog!.id!,
      serviceRepositoryId: data.serviceRepository.id!,
      commitHash: getCurrentCommitHash,
      pullRequest: pullRequest,
      copilotActionStatus: executionResult.status,
      copilotActonId: data.copilotAction.id!,
      statusMessage: processResult?.result.statusMessage || "",
      logs: processResult?.result.logs || [],
    });

    return executionResult;
  }

  private static async updateCopilotAction(data: {
    copilotActonId: ObjectID;
    serviceCatalogId: ObjectID;
    serviceRepositoryId: ObjectID;
    commitHash: string;
    pullRequest: PullRequest | null;
    statusMessage: string;
    logs: Array<string>;
    copilotActionStatus: CopilotActionStatus;
  }): Promise<void> {
    // add copilot action to the database.

    let copilotPullRequest: CopilotPullRequest | null = null;

    if (data.pullRequest) {
      copilotPullRequest =
        await CopilotPullRequestService.addPullRequestToDatabase({
          pullRequest: data.pullRequest,
          serviceCatalogId: data.serviceCatalogId,
          serviceRepositoryId: data.serviceRepositoryId,
        });
    }

    await CopilotActionUtil.updateCopilotAction({
      actionStatus: data.copilotActionStatus,
      pullRequestId: copilotPullRequest ? copilotPullRequest.id! : undefined,
      commitHash: data.commitHash,
      statusMessage: data.statusMessage,
      logs: data.logs,
      actionId: data.copilotActonId
    });
  }
}

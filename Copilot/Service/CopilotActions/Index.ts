import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import ImproveComments from "./ImproveComments";
import Dictionary from "Common/Types/Dictionary";
import CopilotActionBase, {
  CopilotActionVars,
  CopilotProcess,
} from "./CopilotActionsBase";
import BadDataException from "Common/Types/Exception/BadDataException";
import CodeRepositoryUtil, { RepoScriptType } from "../../Utils/CodeRepository";
import ServiceCopilotCodeRepository from "Common/Models/DatabaseModels/ServiceCopilotCodeRepository";
import PullRequest from "Common/Types/CodeRepository/PullRequest";
import CopilotAction from "Common/Models/DatabaseModels/CopilotAction";
import ObjectID from "Common/Types/ObjectID";
import CopilotActionStatus from "Common/Types/Copilot/CopilotActionStatus";
import URL from "Common/Types/API/URL";
import { GetOneUptimeURL, GetRepositorySecretKey } from "../../Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import FixGrammarAndSpelling from "./FixGrammarAndSpelling";
import RefactorCode from "./RefactorCode";
import WriteUnitTests from "./WriteUnitTests";
import ImproveReadme from "./ImroveReadme";
import CopilotPullRequest from "Common/Models/DatabaseModels/CopilotPullRequest";
import CopilotPullRequestService from "../CopilotPullRequest";

const actionDictionary: Dictionary<typeof CopilotActionBase> = {
  [CopilotActionType.IMPROVE_COMMENTS]: ImproveComments,
  [CopilotActionType.FIX_GRAMMAR_AND_SPELLING]: FixGrammarAndSpelling,
  [CopilotActionType.REFACTOR_CODE]: RefactorCode,
  [CopilotActionType.WRITE_UNIT_TESTS]: WriteUnitTests,
  [CopilotActionType.IMPROVE_README]: ImproveReadme,
};

export interface CopilotExecutionResult {
  status: CopilotActionStatus;
  pullRequest: PullRequest | null;
}

export default class CopilotActionService {
  public static async execute(data: {
    serviceRepository: ServiceCopilotCodeRepository;
    copilotActionType: CopilotActionType;
    input: CopilotActionVars;
  }): Promise<CopilotExecutionResult> {
    await CodeRepositoryUtil.discardAllChangesOnCurrentBranch();

    await CodeRepositoryUtil.switchToMainBranch();

    await CodeRepositoryUtil.pullChanges();

    const actionType: typeof CopilotActionBase | undefined =
      actionDictionary[data.copilotActionType];

    if (!actionType) {
      throw new BadDataException("Invalid CopilotActionType");
    }

    const action: CopilotActionBase = new actionType() as CopilotActionBase;

    const processResult: CopilotProcess | null = await action.execute({
      input: data.input,
      result: {
        files: {},
      },
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

    const fileCommitHash: string | undefined =
      data.input.files[data.input.currentFilePath]?.gitCommitHash;

    if (!fileCommitHash) {
      throw new BadDataException("File commit hash not found");
    }

    await CopilotActionService.addCopilotActionToDatabase({
      serviceCatalogId: data.serviceRepository.serviceCatalog!.id!,
      serviceRepositoryId: data.serviceRepository.id!,
      filePath: data.input.currentFilePath,
      commitHash: fileCommitHash,
      copilotActionType: data.copilotActionType,
      pullRequest: pullRequest,
      copilotActionStatus: executionResult.status,
    });

    return executionResult;
  }

  private static async addCopilotActionToDatabase(data: {
    serviceCatalogId: ObjectID;
    serviceRepositoryId: ObjectID;
    filePath: string;
    commitHash: string;
    copilotActionType: CopilotActionType;
    pullRequest: PullRequest | null;
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

    const copilotAction: CopilotAction = new CopilotAction();

    copilotAction.serviceCatalogId = data.serviceCatalogId;
    copilotAction.serviceRepositoryId = data.serviceRepositoryId;
    copilotAction.filePath = data.filePath;
    copilotAction.commitHash = data.commitHash;
    copilotAction.copilotActionType = data.copilotActionType;
    copilotAction.copilotActionStatus = data.copilotActionStatus;

    if (copilotPullRequest) {
      copilotAction.copilotPullRequestId = copilotPullRequest.id!;
    }

    // send this to the API.
    const url: URL = URL.fromString(
      GetOneUptimeURL().toString() + "/api",
    ).addRoute(
      `${new CopilotAction()
        .getCrudApiPath()
        ?.toString()}/add-copilot-action/${GetRepositorySecretKey()}`,
    );

    const codeRepositoryResult: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(url, {
        copilotAction: CopilotAction.toJSON(copilotAction, CopilotAction),
        copilotPullRequest: copilotPullRequest
          ? CopilotPullRequest.toJSON(copilotPullRequest, CopilotPullRequest)
          : null,
      });

    if (codeRepositoryResult instanceof HTTPErrorResponse) {
      throw codeRepositoryResult;
    }
  }
}

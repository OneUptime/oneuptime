import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import ImproveComments from "./ImproveComments";
import Dictionary from "Common/Types/Dictionary";
import CopilotActionBase, {
  CopilotActionRunResult,
  CopilotActionVars,
} from "./CopilotActionsBase";
import BadDataException from "Common/Types/Exception/BadDataException";
import CodeRepositoryUtil from "../../Utils/CodeRepository";
import ServiceRepository from "Model/Models/ServiceRepository";
import PullRequest from "Common/Types/CodeRepository/PullRequest";
import CopilotAction from "Model/Models/CopilotAction";
import ObjectID from "Common/Types/ObjectID";
import CopilotActionStatus from "Common/Types/Copilot/CopilotActionStatus";
import URL from "Common/Types/API/URL";
import { GetOneUptimeURL, GetRepositorySecretKey } from "../../Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "CommonServer/Utils/Logger";

const actionDictionary: Dictionary<CopilotActionBase> = {
  [CopilotActionType.IMPROVE_COMMENTS]: new ImproveComments(),
};

export interface CopilotExecutionResult {
  status: CopilotActionStatus;
  pullRequest: PullRequest | null;
}

export default class CopilotActionService {
  public static async execute(data: {
    serviceRepository: ServiceRepository;
    copilotActionType: CopilotActionType;
    vars: CopilotActionVars;
  }): Promise<CopilotExecutionResult> {
    await CodeRepositoryUtil.switchToMainBranch();

    await CodeRepositoryUtil.pullChanges();

    if (!actionDictionary[data.copilotActionType]) {
      throw new BadDataException("Invalid CopilotActionType");
    }

    logger.info("Executing Copilot Action");
    logger.info("File Path: " + data.vars.filePath);
    logger.info("Commit Hash: " + data.vars.fileCommitHash);

    const action: CopilotActionBase = actionDictionary[
      data.copilotActionType
    ] as CopilotActionBase;

    const result: CopilotActionRunResult | null = await action.execute({
      vars: data.vars,
    });

    let executionResult: CopilotExecutionResult = {
      status: CopilotActionStatus.NO_ACTION_REQUIRED,
      pullRequest: null,
    };

    const filePath: string = data.vars.filePath;
    const fileCommitHash: string = data.vars.fileCommitHash;

    let pullRequest: PullRequest | null = null;

    if (result) {
      logger.info("Obtained result from Copilot Action");
      logger.info("Committing the changes to the repository and creating a PR");

      const branchName: string = CodeRepositoryUtil.getBranchName({
        branchName: await action.getBranchName(),
        serviceRepository: data.serviceRepository,
      });

      const commitMessage: string = await action.getCommitMessage({
        vars: data.vars,
      });

      // create a branch

      await CodeRepositoryUtil.createBranch({
        serviceRepository: data.serviceRepository,
        branchName: branchName,
      });

      // write to

      const code: string = result.code;

      await CodeRepositoryUtil.writeToFile({
        filePath: filePath,
        content: code,
      });

      // commit changes

      // add files to stage

      await CodeRepositoryUtil.addFilesToGit({
        filePaths: [filePath],
      });

      await CodeRepositoryUtil.commitChanges({
        message: commitMessage,
      });

      // push changes

      await CodeRepositoryUtil.pushChanges({
        branchName: branchName,
        serviceRepository: data.serviceRepository,
      });

      // create a PR

      pullRequest = await CodeRepositoryUtil.createPullRequest({
        branchName: branchName,
        serviceRepository: data.serviceRepository,
        title: await action.getPullRequestTitle({ vars: data.vars }),
        body: await action.getPullRequestBody({ vars: data.vars }),
      });

      // switch to main branch.

      await CodeRepositoryUtil.switchToMainBranch();

      //save the result to the database.

      executionResult = {
        status: CopilotActionStatus.PR_CREATED,
        pullRequest: pullRequest,
      };
    }

    if (!result) {
      logger.info("No result obtained from Copilot Action");
    }

    await CopilotActionService.addCopilotAction({
      serviceCatalogId: data.serviceRepository.serviceCatalog!.id!,
      serviceRepositoryId: data.serviceRepository.id!,
      filePath: filePath,
      commitHash: fileCommitHash,
      copilotActionType: data.copilotActionType,
      pullRequest: pullRequest,
      copilotActionStatus: executionResult.status,
    });

    return executionResult;
  }

  private static async addCopilotAction(data: {
    serviceCatalogId: ObjectID;
    serviceRepositoryId: ObjectID;
    filePath: string;
    commitHash: string;
    copilotActionType: CopilotActionType;
    pullRequest: PullRequest | null;
    copilotActionStatus: CopilotActionStatus;
  }): Promise<void> {
    // add copilot action to the database.

    const copilotAction: CopilotAction = new CopilotAction();

    copilotAction.serviceCatalogId = data.serviceCatalogId;
    copilotAction.serviceRepositoryId = data.serviceRepositoryId;
    copilotAction.filePath = data.filePath;
    copilotAction.commitHash = data.commitHash;
    copilotAction.copilotActionType = data.copilotActionType;
    copilotAction.copilotActionStatus = data.copilotActionStatus;

    if (data.pullRequest && data.pullRequest.pullRequestNumber) {
      copilotAction.pullRequestId =
        data.pullRequest?.pullRequestNumber.toString();
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
      });

    if (codeRepositoryResult instanceof HTTPErrorResponse) {
      throw codeRepositoryResult;
    }
  }
}

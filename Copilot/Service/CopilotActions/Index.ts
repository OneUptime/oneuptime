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

const actionDictionary: Dictionary<CopilotActionBase> = {
  [CopilotActionType.IMPROVE_COMMENTS]: new ImproveComments(),
};

export enum CopilotExecuteResult {
  ActionExecuted = "ActionExecuted",
  NoActionRequired = "NoActionRequired",
}

export default class CopilotActionService {
  public static async execute(data: {
    serviceRepository: ServiceRepository;
    copilotActionType: CopilotActionType;
    vars: CopilotActionVars;
  }): Promise<CopilotExecuteResult> {
    if (!actionDictionary[data.copilotActionType]) {
      throw new BadDataException("Invalid CopilotActionType");
    }

    const action: CopilotActionBase = actionDictionary[
      data.copilotActionType
    ] as CopilotActionBase;

    const result: CopilotActionRunResult | null = await action.execute({
      vars: data.vars,
    });

    if (!result) {
      return CopilotExecuteResult.NoActionRequired; // no need to do anything
    }

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

    const filePath: string = data.vars.filePath;
    const code: string = result.code;

    await CodeRepositoryUtil.writeToFile({
      filePath: filePath,
      content: code,
    });

    // commit changes

    await CodeRepositoryUtil.commitChanges({
      message: commitMessage,
    });

    // push changes

    await CodeRepositoryUtil.pushChanges({
      branchName: branchName,
      serviceRepository: data.serviceRepository,
    });

    // create a PR

    await CodeRepositoryUtil.createPullRequest({
      branchName: branchName,
      serviceRepository: data.serviceRepository,
      title: await action.getPullRequestTitle({ vars: data.vars }),
      body: await action.getPullRequestBody({ vars: data.vars }),
    });

    // switch to main branch.

    await CodeRepositoryUtil.switchToMainBranch();

    return CopilotExecuteResult.ActionExecuted;
  }
}

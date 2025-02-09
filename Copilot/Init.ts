import CodeRepositoryUtil, {
  CodeRepositoryResult,
  RepoScriptType,
} from "./Utils/CodeRepository";
import InitUtil from "./Utils/Init";
import ServiceRepositoryUtil from "./Utils/ServiceRepository";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import logger from "Common/Server/Utils/Logger";
import CopilotActionUtil from "./Utils/CopilotAction";
import CopilotAction from "Common/Models/DatabaseModels/CopilotAction";
import {
  FixNumberOfCodeEventsInEachRun,
  GetIsCopilotDisabled,
  GetLlmType,
} from "./Config";
import CopilotActionService, {
  CopilotExecutionResult,
} from "./Service/CopilotActions/Index";
import CopilotActionStatus from "Common/Types/Copilot/CopilotActionStatus";
import PullRequest from "Common/Types/CodeRepository/PullRequest";
import ServiceCopilotCodeRepository from "Common/Models/DatabaseModels/ServiceCopilotCodeRepository";
import CopilotActionProcessingException from "./Exceptions/CopilotActionProcessingException";
import CopilotPullRequest from "Common/Models/DatabaseModels/CopilotPullRequest";
import ProcessUtil from "./Utils/Process";

let currentFixCount: number = 1;

const init: PromiseVoidFunction = async (): Promise<void> => {
  // check if copilot is disabled.

  if (GetIsCopilotDisabled()) {
    logger.info("Copilot is disabled. Exiting.");
    ProcessUtil.haltProcessWithSuccess();
  }

  logger.info(`Using ${GetLlmType()} as the AI model.`);

  await CodeRepositoryUtil.setAuthorIdentity({
    email: "copilot@oneuptime.com",
    name: "OneUptime Copilot",
  });

  const codeRepositoryResult: CodeRepositoryResult = await InitUtil.init();

  // before cloning the repo, check if there are any services to improve.
  ServiceRepositoryUtil.setCodeRepositoryResult({
    codeRepositoryResult,
  });

  const servicesToImprove: ServiceCopilotCodeRepository[] =
    await ServiceRepositoryUtil.getServicesToImprove();

  logger.debug(`Found ${servicesToImprove.length} services to improve.`);

  // if no services to improve, then exit.
  if (servicesToImprove.length === 0) {
    logger.info("No services to improve. Exiting.");
    ProcessUtil.haltProcessWithSuccess();
  }

  for (const serviceToImprove of servicesToImprove) {
    logger.debug(`- ${serviceToImprove.serviceCatalog!.name}`);
  }

  await cloneRepository({
    codeRepositoryResult,
  });

  await setUpRepository();

  for (const serviceRepository of servicesToImprove) {
    checkIfCurrentFixCountIsLessThanFixNumberOfCodeEventsInEachRun();

    const actionsToWorkOn: Array<CopilotAction> =
      await CopilotActionUtil.getActionsToWorkOn({
        serviceCatalogId: serviceRepository.serviceCatalog!.id!,
        serviceRepositoryId: serviceRepository.id!,
      });

    for (const actionToWorkOn of actionsToWorkOn) {
      checkIfCurrentFixCountIsLessThanFixNumberOfCodeEventsInEachRun();
      // check copilot events for this file.

      let executionResult: CopilotExecutionResult | null = null;

      let currentRetryCount: number = 0;
      const maxRetryCount: number = 3;

      while (currentRetryCount < maxRetryCount) {
        try {
          executionResult = await executeAction({
            serviceRepository,
            copilotAction: actionToWorkOn,
          });
          break;
        } catch (e) {
          logger.error(e);
          currentRetryCount++;
          await CodeRepositoryUtil.discardAllChangesOnCurrentBranch();
        }
      }

      if (
        executionResult &&
        executionResult.status === CopilotActionStatus.PR_CREATED
      ) {
        currentFixCount++;
      }
    }
  }
};

interface ExecuteActionData {
  serviceRepository: ServiceCopilotCodeRepository;
  copilotAction: CopilotAction;
}

type ExecutionActionFunction = (
  data: ExecuteActionData,
) => Promise<CopilotExecutionResult | null>;

const executeAction: ExecutionActionFunction = async (
  data: ExecuteActionData,
): Promise<CopilotExecutionResult | null> => {
  const { serviceRepository, copilotAction } = data;

  try {
    return await CopilotActionService.executeAction({
      serviceRepository: serviceRepository,
      copilotAction: copilotAction,
    });
  } catch (e) {
    if (e instanceof CopilotActionProcessingException) {
      // This is not a serious exception, so we just  move on to the next action.
      logger.info(e.message);
      return null;
    }
    throw e;
  }
};

type CloneRepositoryFunction = (data: {
  codeRepositoryResult: CodeRepositoryResult;
}) => Promise<void>;

const cloneRepository: CloneRepositoryFunction = async (data: {
  codeRepositoryResult: CodeRepositoryResult;
}): Promise<void> => {
  const { codeRepositoryResult } = data;

  logger.info(
    `Cloning the repository ${codeRepositoryResult.codeRepository.name} to a temporary directory.`,
  );

  // now clone this repository to a temporary directory - /repository
  await CodeRepositoryUtil.cloneRepository({
    codeRepository: codeRepositoryResult.codeRepository,
  });

  // Check if OneUptime Copilot has setup properly.

  const onAfterCloneScript: string | null =
    await CodeRepositoryUtil.getRepoScript({
      scriptType: RepoScriptType.OnAfterClone,
    });

  if (!onAfterCloneScript) {
    logger.debug("No on-after-clone script found for this repository.");
  }

  if (onAfterCloneScript) {
    logger.info("Executing on-after-clone script.");
    await CodeRepositoryUtil.executeScript({
      script: onAfterCloneScript,
    });
    logger.info("on-after-clone script executed successfully.");
  }

  logger.info(
    `Repository ${codeRepositoryResult.codeRepository.name} cloned successfully.`,
  );
};

const checkIfCurrentFixCountIsLessThanFixNumberOfCodeEventsInEachRun: VoidFunction =
  (): void => {
    if (currentFixCount <= FixNumberOfCodeEventsInEachRun) {
      return;
    }
    logger.info(
      `Copilot has fixed ${FixNumberOfCodeEventsInEachRun} code events. Thank you for using Copilot. If you wish to fix more code events, please run Copilot again.`,
    );

    ProcessUtil.haltProcessWithSuccess();
  };

const setUpRepository: PromiseVoidFunction = async (): Promise<void> => {
  const isSetupProperly: boolean =
    await CodeRepositoryUtil.isRepoSetupProperly();

  if (isSetupProperly) {
    return;
  }

  // if the repo is not set up properly, then check if there's an outstanding setup Pr for this repo.
  logger.info("Setting up the repository.");

  // check if there's an outstanding setup PR for this repo.
  const setupPullRequest: CopilotPullRequest | null =
    await CodeRepositoryUtil.getOpenSetupPullRequest();

  if (setupPullRequest) {
    logger.info(
      `There's an open setup PR for this repository: ${setupPullRequest.pullRequestId}. Please merge this PR to continue using Copilot. Exiting...`,
    );
    ProcessUtil.haltProcessWithSuccess();
    return;
  }

  // if there's no setup PR, then create a new setup PR.
  const pullRequest: PullRequest = await CodeRepositoryUtil.setUpRepo();

  logger.info(
    "Repository setup PR created - #" +
      pullRequest.pullRequestNumber +
      ". Please megre this PR to continue using Copilot. Exiting..",
  );

  ProcessUtil.haltProcessWithSuccess();
};

export default init;

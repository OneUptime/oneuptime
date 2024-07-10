import CodeRepositoryUtil, {
  CodeRepositoryResult,
  RepoScriptType,
} from "./Utils/CodeRepository";
import InitUtil from "./Utils/Init";
import ServiceCopilotCodeRepositoryUtil from "./Utils/ServiceRepository";
import Dictionary from "Common/Types/Dictionary";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import CodeRepositoryFile from "CommonServer/Utils/CodeRepository/CodeRepositoryFile";
import logger from "CommonServer/Utils/Logger";
import CopilotActionUtil from "./Utils/CopilotAction";
import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import CopilotAction from "Model/Models/CopilotAction";
import {
  FixNumberOfCodeEventsInEachRun,
  GetIsCopilotDisabled,
  GetLlmType,
} from "./Config";
import CopiotActionTypeOrder from "./Types/CopilotActionTypeOrder";
import CopilotActionService, {
  CopilotExecutionResult,
} from "./Service/CopilotActions/Index";
import CopilotActionStatus from "Common/Types/Copilot/CopilotActionStatus";
import PullRequest from "Common/Types/CodeRepository/PullRequest";
import ServiceCopilotCodeRepository from "Model/Models/ServiceCopilotCodeRepository";
import CopilotActionProcessingException from "./Exceptions/CopilotActionProcessingException";
// import ArrayUtil from "Common/Types/ArrayUtil";

let currentFixCount: number = 1;

const init: PromiseVoidFunction = async (): Promise<void> => {
  // check if copilot is disabled.
  if (GetIsCopilotDisabled()) {
    logger.info("Copilot is disabled. Exiting.");
    haltProcessWithSuccess();
  }

  logger.info(`Using ${GetLlmType()} as the AI model.`);

  await CodeRepositoryUtil.setAuthorIdentity({
    email: "copilot@oneuptime.com",
    name: "OneUptime Copilot",
  });

  const codeRepositoryResult: CodeRepositoryResult = await InitUtil.init();

  if (codeRepositoryResult.servicesToImprove.length === 0) {
    logger.info("No services to improve. Exiting.");
    haltProcessWithSuccess();
  }

  logger.info(
    `Cloning the repository ${codeRepositoryResult.codeRepository.name} to a temporary directory.`,
  );

  // now clone this repository to a temporary directory - /repository
  await CodeRepositoryUtil.cloneRepository({
    codeRepository: codeRepositoryResult.codeRepository,
  });

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

  for (const serviceToImrove of codeRepositoryResult.servicesToImprove) {
    checkIfCurrentFixCountIsLessThanFixNumberOfCodeEventsInEachRun();

    const serviceRepository: ServiceCopilotCodeRepository =
      serviceToImrove.serviceRepository;

    const filesInService: Dictionary<CodeRepositoryFile> =
      await ServiceCopilotCodeRepositoryUtil.getFilesInServiceDirectory({
        serviceRepository,
      });

    logger.info(
      `Files found in ${serviceRepository.serviceCatalog?.name}: ${
        Object.keys(filesInService).length
      }`,
    );

    // const files: Array<CodeRepositoryFile> = ArrayUtil.shuffle(
    //   Object.values(filesInService),
    // ); // shuffle the files to avoid fixing the same file in each run.

    const files: Array<CodeRepositoryFile> = Object.values(filesInService);

    for (const file of files) {
      checkIfCurrentFixCountIsLessThanFixNumberOfCodeEventsInEachRun();
      // check copilot events for this file.

      const copilotActions: Array<CopilotAction> =
        await CopilotActionUtil.getCopilotActions({
          serviceCatalogId: serviceRepository.serviceCatalog!.id!,
          filePath: file.filePath,
        });

      // check if there's an open PR for this file.

      const openPullRequests: Array<PullRequest> =
        CodeRepositoryUtil.getOpenPRForFile({
          pullRequests: serviceToImrove.pullRequests,
          filePath: file.filePath,
        });

      if (openPullRequests.length > 0) {
        const prNumbers: string = openPullRequests
          .map((pr: PullRequest) => {
            return `#${pr.pullRequestNumber.toString()}`;
          })
          .join(", ");

        // this file already has an open PR. Ignore this file and move to the next file.
        logger.info(
          `File ${file.filePath} already has an open PR ${prNumbers}. Moving to next file.`,
        );

        continue;
      }

      const eventsCompletedOnThisFile: Array<CopilotActionType> = [];

      for (const copilotAction of copilotActions) {
        if (
          copilotAction.copilotActionType &&
          eventsCompletedOnThisFile.includes(copilotAction.copilotActionType)
        ) {
          continue;
        }

        // add to eventsCompletedOnThisFile
        eventsCompletedOnThisFile.push(copilotAction.copilotActionType!);
      }

      let nextEventToFix: CopilotActionType | undefined = undefined;

      for (const copilotActionType of CopiotActionTypeOrder) {
        if (!eventsCompletedOnThisFile.includes(copilotActionType)) {
          nextEventToFix = copilotActionType;
          break;
        }
      }

      if (!nextEventToFix) {
        logger.info(
          `All fixes completed on ${file.filePath}. Moving to next file.`,
        );
        continue;
      }

      let executionResult: CopilotExecutionResult | null = null;

      let currentRetryCount: number = 0;
      const maxRetryCount: number = 3;

      while (currentRetryCount < maxRetryCount) {
        try {
          executionResult = await executeAction({
            serviceRepository,
            file,
            filesInService,
            nextEventToFix,
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
  file: CodeRepositoryFile;
  filesInService: Dictionary<CodeRepositoryFile>;
  nextEventToFix: CopilotActionType;
}

type ExecutionActionFunction = (
  data: ExecuteActionData,
) => Promise<CopilotExecutionResult | null>;

const executeAction: ExecutionActionFunction = async (
  data: ExecuteActionData,
): Promise<CopilotExecutionResult | null> => {
  const { serviceRepository, file, filesInService, nextEventToFix } = data;

  try {
    return await CopilotActionService.execute({
      serviceRepository: serviceRepository,
      copilotActionType: nextEventToFix,
      input: {
        currentFilePath: file.filePath, // this is the file path where optimization is needed or should start from.
        files: filesInService,
      },
    });
  } catch (e) {
    if (e instanceof CopilotActionProcessingException) {
      // This is not a serious exception, so we just  move on to the next file.
      logger.info(e.message);
      return null;
    }
    throw e;
  }
};

const checkIfCurrentFixCountIsLessThanFixNumberOfCodeEventsInEachRun: VoidFunction =
  (): void => {
    if (currentFixCount <= FixNumberOfCodeEventsInEachRun) {
      return;
    }
    logger.info(
      `Copilot has fixed ${FixNumberOfCodeEventsInEachRun} code events. Thank you for using Copilot. If you wish to fix more code events, please run Copilot again.`,
    );
    haltProcessWithSuccess();
  };

const haltProcessWithSuccess: VoidFunction = (): void => {
  process.exit(0);
};

export default init;

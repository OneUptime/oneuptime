import CodeRepositoryUtil, {
  CodeRepositoryResult,
} from "./Utils/CodeRepository";
import InitUtil from "./Utils/Init";
import ServiceRepositoryUtil from "./Utils/ServiceRepository";
import Dictionary from "Common/Types/Dictionary";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import CodeRepositoryFile from "CommonServer/Utils/CodeRepository/CodeRepositoryFile";
import logger from "CommonServer/Utils/Logger";
import CopilotActionUtil from "./Utils/CopilotAction";
import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import CopilotAction from "Model/Models/CopilotAction";
import { FixNumberOfCodeEventsInEachRun } from "./Config";
import CopiotActionTypeOrder from "./Types/CopilotActionTypeOrder";
import CopilotActionService, {
  CopilotExecutionResult,
} from "./Service/CopilotActions/Index";
import CopilotActionStatus from "Common/Types/Copilot/CopilotActionStatus";
import PullRequest from "Common/Types/CodeRepository/PullRequest";
import ServiceRepository from "Model/Models/ServiceRepository";
import CopilotActionProcessingException from "./Exceptions/CopilotActionProcessingException";
// import ArrayUtil from "Common/Types/ArrayUtil";

let currentFixCount: number = 1;

const init: PromiseVoidFunction = async (): Promise<void> => {
  await CodeRepositoryUtil.setAuthorIdentity({
    email: "copilot@oneuptime.com",
    name: "OneUptime Copilot",
  });

  const codeRepositoryResult: CodeRepositoryResult = await InitUtil.init();

  logger.info(
    `Cloning the repository ${codeRepositoryResult.codeRepository.name} to a temporary directory.`,
  );

  // now clone this repository to a temporary directory - /repository
  await CodeRepositoryUtil.cloneRepository({
    codeRepository: codeRepositoryResult.codeRepository,
  });

  logger.info(
    `Repository ${codeRepositoryResult.codeRepository.name} cloned successfully.`,
  );

  for (const serviceToImrove of codeRepositoryResult.servicesToImprove) {
    checkIfCurrentFixCountIsLessThanFixNumberOfCodeEventsInEachRun();

    const serviceRepository: ServiceRepository =
      serviceToImrove.serviceRepository;

    const filesInService: Dictionary<CodeRepositoryFile> =
      await ServiceRepositoryUtil.getFilesInServiceDirectory({
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
        logger.info(`All fixes completed on this file. Moving to next file.`);
        continue;
      }

      let executionResult: CopilotExecutionResult | null = null;

      try {
        executionResult = await CopilotActionService.execute({
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
          continue;
        } else {
          throw e;
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

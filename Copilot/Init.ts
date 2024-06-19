import { CodeRepositoryResult } from "./Utils/CodeRepository";
import InitUtil from "./Utils/Init";
import ServiceRepositoryUtil from "./Utils/ServiceRepository";
import Dictionary from "Common/Types/Dictionary";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import CodeRepositoryFile from "CommonServer/Utils/CodeRepository/CodeRepositoryFile";
import logger from "CommonServer/Utils/Logger";
import CopilotEventUtil from "./Utils/CopilotEvent";
import CopilotEventType from "Common/Types/Copilot/CopilotEventType";
import CopilotEvent from "Model/Models/CopilotEvent";
import { FixNumberOfCodeEventsInEachRun } from "./Config";
import CopiotEventTypeOrder from "./Types/CopilotEventTypeOrder";
import LLM from "./Service/LLM/LLM";

const currentFixCount: number = 1;

const init: PromiseVoidFunction = async (): Promise<void> => {
  const codeRepositoryResult: CodeRepositoryResult = await InitUtil.init();

  for (const serviceRepository of codeRepositoryResult.servicesRepository) {
    checkIfCurrentFixCountIsLessThanFixNumberOfCodeEventsInEachRun();

    const filesInService: Dictionary<CodeRepositoryFile> =
      await ServiceRepositoryUtil.getFilesInServiceDirectory({
        serviceRepository,
      });

    logger.info(
      `Files found in ${serviceRepository.serviceCatalog?.name}: ${
        Object.keys(filesInService).length
      }`,
    );

    for (const file of Object.values(filesInService)) {
      checkIfCurrentFixCountIsLessThanFixNumberOfCodeEventsInEachRun();
      // check copilot events for this file.

      const copilotEvents: Array<CopilotEvent> =
        await CopilotEventUtil.getCopilotEvents({
          serviceCatalogId: serviceRepository.serviceCatalog!.id!,
          filePath: file.filePath,
        });

      const eventsCompletedOnThisFile: Array<CopilotEventType> = [];

      for (const copilotEvent of copilotEvents) {
        if (
          copilotEvent.copilotEventType &&
          eventsCompletedOnThisFile.includes(copilotEvent.copilotEventType)
        ) {
          continue;
        }

        // add to eventsCompletedOnThisFile
        eventsCompletedOnThisFile.push(copilotEvent.copilotEventType!);
      }

      let nextEventToFix: CopilotEventType | undefined = undefined;

      for (const copilotEventType of CopiotEventTypeOrder) {
        if (!eventsCompletedOnThisFile.includes(copilotEventType)) {
          nextEventToFix = copilotEventType;
          break;
        }
      }

      if (!nextEventToFix) {
        logger.info(`All fixes completed on this file. Moving to next file.`);
        continue;
      }

      const code: string = await LLM.getResponseByEventType({
        copilotEventType: nextEventToFix,
        code: await ServiceRepositoryUtil.getFileContent({
          serviceRepository,
          filePath: file.filePath,
        }),
      });

      logger.info(`Code to fix: ${code}`);

      // now we have the list of all the events completed on this file.
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

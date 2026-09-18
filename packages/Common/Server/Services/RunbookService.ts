import DatabaseService from "./DatabaseService";
import RunbookLabelRuleEngineService from "./RunbookLabelRuleEngineService";
import RunbookOwnerRuleEngineService from "./RunbookOwnerRuleEngineService";
import Model from "../../Models/DatabaseModels/Runbook";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId && createdItem.id) {
      /*
       * Run label rule first so rule-added labels are persisted before
       * owner rules run. Owner rules re-fetch labels, so this lets owner
       * rules key on rule-added labels.
       */
      Promise.resolve()
        .then(async () => {
          await RunbookLabelRuleEngineService.applyRulesToRunbook(createdItem);
        })
        .then(async () => {
          await RunbookOwnerRuleEngineService.applyRulesToRunbook(createdItem);
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying runbook rules in RunbookService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              runbookId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }
}

export default new Service();

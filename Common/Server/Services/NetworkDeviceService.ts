import DatabaseService from "./DatabaseService";
import NetworkDeviceLabelRuleEngineService from "./NetworkDeviceLabelRuleEngineService";
import NetworkDeviceOwnerRuleEngineService from "./NetworkDeviceOwnerRuleEngineService";
import Model from "../../Models/DatabaseModels/NetworkDevice";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Owner/label rules fire whenever a device is created — manually or via
   * subnet discovery import. Applied out-of-band: rule failures must never
   * fail device creation.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
            createdItem,
          );
        })
        .then(async () => {
          await NetworkDeviceOwnerRuleEngineService.applyRulesToNetworkDevice(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying network device rules in NetworkDeviceService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              networkDeviceId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }
}

export default new Service();

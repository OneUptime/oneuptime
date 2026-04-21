import BaseAPI from "Common/Server/API/BaseAPI";
import TelegramLog from "Common/Models/DatabaseModels/TelegramLog";
import TelegramLogService, {
  Service as TelegramLogServiceType,
} from "Common/Server/Services/TelegramLogService";

export default class TelegramLogAPI extends BaseAPI<
  TelegramLog,
  TelegramLogServiceType
> {
  public constructor() {
    super(TelegramLog, TelegramLogService);
  }
}

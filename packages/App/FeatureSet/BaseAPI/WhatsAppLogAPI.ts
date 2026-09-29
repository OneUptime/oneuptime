import BaseAPI from "Common/Server/API/BaseAPI";
import WhatsAppLog from "Common/Models/DatabaseModels/WhatsAppLog";
import WhatsAppLogService, {
  Service as WhatsAppLogServiceType,
} from "Common/Server/Services/WhatsAppLogService";

export default class WhatsAppLogAPI extends BaseAPI<
  WhatsAppLog,
  WhatsAppLogServiceType
> {
  public constructor() {
    super(WhatsAppLog, WhatsAppLogService);
  }
}

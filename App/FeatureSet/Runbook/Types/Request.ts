import { ExpressRequest } from "Common/Server/Utils/Express";
import RunbookAgent from "Common/Models/DatabaseModels/RunbookAgent";

export interface RunbookAgentExpressRequest extends ExpressRequest {
  runbookAgent?: RunbookAgent | undefined;
}

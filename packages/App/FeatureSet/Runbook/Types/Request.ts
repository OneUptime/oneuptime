import { ExpressRequest } from "Common/Server/Utils/Express";
import Runner from "Common/Models/DatabaseModels/Runner";

export interface RunnerExpressRequest extends ExpressRequest {
  runner?: Runner | undefined;
}

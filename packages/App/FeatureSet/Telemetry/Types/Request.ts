import { ExpressRequest } from "Common/Server/Utils/Express";
import Probe from "Common/Models/DatabaseModels/Probe";

export interface ProbeExpressRequest extends ExpressRequest {
  probe?: Probe | undefined;
}

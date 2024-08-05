import { ExpressRequest } from "CommonServer/Utils/Express";
import Probe from "Common/AppModels/Models/Probe";

export interface ProbeExpressRequest extends ExpressRequest {
  probe?: Probe | undefined;
}

import { ExpressRequest } from "CommonServer/Utils/Express";
import Probe from "Model/Models/Probe";

export interface ProbeExpressRequest extends ExpressRequest {
    probe?: Probe | undefined;
}
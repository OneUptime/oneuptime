import { JSONObject } from "../../JSON";
import PositiveNumber from "../../PositiveNumber";


export default interface CustomCodeMonitorResponse {
    result: string | number | boolean | JSONObject | undefined;
    scriptError?: string | undefined;
    logMessages: string[];
    executionTimeInMS: PositiveNumber;
}
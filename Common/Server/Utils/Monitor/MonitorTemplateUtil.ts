import MonitorType from "../../../Types/Monitor/MonitorType";
import { JSONObject } from "../../../Types/JSON";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import Typeof from "../../../Types/Typeof";
import VMUtil from "../VM/VMAPI";
import DataToProcess from "./DataToProcess";
import logger from "../Logger";

/**
 * Utility for building template variable storage map and processing dynamic placeholders
 * shared between Incident and Alert auto-creation.
 */
export default class MonitorTemplateUtil {
  /**
   * Build a storage map of variables available for templating based on monitor type.
   */
  public static buildTemplateStorageMap(data: {
    monitorType: MonitorType;
    dataToProcess: DataToProcess;
  }): JSONObject {
    let storageMap: JSONObject = {};

    try {
      if (
        data.monitorType === MonitorType.API ||
        data.monitorType === MonitorType.Website
      ) {
        let responseBody: JSONObject | null = null;
        try {
          responseBody = JSON.parse(
            ((data.dataToProcess as ProbeMonitorResponse).responseBody as string) ||
              "{}",
          );
        } catch (err) {
          logger.error(err);
          responseBody = (data.dataToProcess as ProbeMonitorResponse)
            .responseBody as JSONObject;
        }

        if (typeof responseBody === Typeof.String && responseBody?.toString() === "") {
          responseBody = {};
        }

        storageMap = {
          responseBody: responseBody,
          responseHeaders: (data.dataToProcess as ProbeMonitorResponse)
            .responseHeaders,
          responseStatusCode: (data.dataToProcess as ProbeMonitorResponse)
            .responseCode,
          responseTimeInMs: (data.dataToProcess as ProbeMonitorResponse)
            .responseTimeInMs,
          isOnline: (data.dataToProcess as ProbeMonitorResponse).isOnline,
        } as JSONObject;
      }

      if (data.monitorType === MonitorType.IncomingRequest) {
        storageMap = {
          requestBody: (data.dataToProcess as IncomingMonitorRequest).requestBody,
          requestHeaders: (data.dataToProcess as IncomingMonitorRequest)
            .requestHeaders,
        } as JSONObject;
      }
    } catch (err) {
      logger.error(err);
    }

    return storageMap;
  }

  /**
   * Replace {{var}} placeholders in the given string with values from the storage map.
   */
  public static processTemplateString(data: {
    value: string | undefined,
    storageMap: JSONObject,
  }): string {

    const { value, storageMap } = data;

    if (!value) {
      return "";
    }

    let replaced: string = VMUtil.replaceValueInPlace(storageMap, value, false);
    replaced = replaced !== undefined && replaced !== null ? `${replaced}` : "";
    return replaced;
  }
}

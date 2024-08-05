import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IP from "Common/Types/IP/IP";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorSecretService from "CommonServer/Services/MonitorSecretService";
import VMUtil from "CommonServer/Utils/VM/VMAPI";
import Monitor from "Common/AppModels/Models/Monitor";
import MonitorSecret from "Common/AppModels/Models/MonitorSecret";

export default class MonitorUtil {
  public static async populateSecrets(monitor: Monitor): Promise<Monitor> {
    const isSecretsLoaded: boolean = false;
    let monitorSecrets: MonitorSecret[] = [];

    const loadSecrets: PromiseVoidFunction = async (): Promise<void> => {
      if (isSecretsLoaded) {
        return;
      }

      if (!monitor.id) {
        return;
      }

      const secrets: Array<MonitorSecret> = await MonitorSecretService.findBy({
        query: {
          monitors: [monitor.id] as any,
        },
        select: {
          secretValue: true,
          name: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      monitorSecrets = secrets;
    };

    if (!monitor.monitorSteps) {
      return monitor;
    }

    if (monitor.monitorType === MonitorType.API) {
      for (const monitorStep of monitor.monitorSteps?.data
        ?.monitorStepsInstanceArray || []) {
        if (
          monitorStep.data?.requestHeaders &&
          this.hasSecrets(
            JSONFunctions.toString(monitorStep.data.requestHeaders),
          )
        ) {
          await loadSecrets();

          monitorStep.data.requestHeaders =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.requestHeaders,
            })) as Dictionary<string>;
        } else if (
          monitorStep.data?.requestBody &&
          this.hasSecrets(JSONFunctions.toString(monitorStep.data.requestBody))
        ) {
          await loadSecrets();

          monitorStep.data.requestBody =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.requestBody,
            })) as string;
        }
      }
    }

    if (
      monitor.monitorType === MonitorType.API ||
      monitor.monitorType === MonitorType.IP ||
      monitor.monitorType === MonitorType.Ping ||
      monitor.monitorType === MonitorType.Port ||
      monitor.monitorType === MonitorType.Website ||
      monitor.monitorType === MonitorType.SSLCertificate
    ) {
      for (const monitorStep of monitor.monitorSteps?.data
        ?.monitorStepsInstanceArray || []) {
        if (
          monitorStep.data?.monitorDestination &&
          this.hasSecrets(
            JSONFunctions.toString(monitorStep.data.monitorDestination),
          )
        ) {
          // replace secret in monitorDestination.
          await loadSecrets();

          monitorStep.data.monitorDestination =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.monitorDestination,
            })) as URL | Hostname | IP;
        }
      }
    }

    if (
      monitor.monitorType === MonitorType.SyntheticMonitor ||
      monitor.monitorType === MonitorType.CustomJavaScriptCode
    ) {
      for (const monitorStep of monitor.monitorSteps?.data
        ?.monitorStepsInstanceArray || []) {
        if (
          monitorStep.data?.customCode &&
          this.hasSecrets(JSONFunctions.toString(monitorStep.data.customCode))
        ) {
          // replace secret in script
          await loadSecrets();

          monitorStep.data.customCode =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.customCode,
            })) as string;
        }
      }
    }

    return monitor;
  }

  private static hasSecrets(prepopulatedString: string): boolean {
    return prepopulatedString.includes("monitorSecrets.");
  }

  private static async fillSecretsInStringOrJSON(data: {
    secrets: MonitorSecret[];
    populateSecretsIn: string | JSONObject | URL | Hostname | IP;
  }): Promise<string | JSONObject | URL | Hostname | IP> {
    // get all secrets for this monitor.

    const secrets: MonitorSecret[] = data.secrets;

    if (secrets.length === 0) {
      return data.populateSecretsIn;
    }

    // replace all secrets in the populateSecretsIn

    const storageMap: JSONObject = {
      monitorSecrets: {},
    };

    for (const monitorSecret of secrets) {
      if (!monitorSecret.name) {
        continue;
      }

      if (!monitorSecret.secretValue) {
        continue;
      }

      (storageMap["monitorSecrets"] as JSONObject)[
        monitorSecret.name as string
      ] = monitorSecret.secretValue;
    }

    const isValueJSON: boolean = typeof data.populateSecretsIn === "object";

    return VMUtil.replaceValueInPlace(
      storageMap,
      data.populateSecretsIn as string,
      isValueJSON,
    );
  }
}

import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import IP from "Common/Types/IP/IP";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorSecretService from "Common/Server/Services/MonitorSecretService";
import VMUtil from "Common/Server/Utils/VM/VMAPI";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import ObjectID from "Common/Types/ObjectID";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";

export default class MonitorUtil {
  public static async loadMonitorSecrets(
    monitorId: ObjectID,
  ): Promise<MonitorSecret[]> {
    const secrets: Array<MonitorSecret> = await MonitorSecretService.findBy({
      query: {
        monitors: QueryHelper.inRelationArray([monitorId]),
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

    return secrets;
  }

  public static async populateSecretsInMonitorSteps(data: {
    monitorSteps: MonitorSteps;
    monitorType: MonitorType;
    monitorId: ObjectID;
  }): Promise<MonitorSteps> {
    let isSecretsLoaded: boolean = false;
    let monitorSecrets: MonitorSecret[] = [];

    const monitorSteps: MonitorSteps = data.monitorSteps;
    const monitorType: MonitorType = data.monitorType;
    const monitorId: ObjectID = data.monitorId;

    if (monitorType === MonitorType.API) {
      for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        if (
          monitorStep.data?.requestHeaders &&
          this.hasSecrets(
            JSONFunctions.toString(monitorStep.data.requestHeaders),
          )
        ) {
          if (!isSecretsLoaded) {
            monitorSecrets = await MonitorUtil.loadMonitorSecrets(monitorId);
          }

          monitorStep.data.requestHeaders =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.requestHeaders,
            })) as Dictionary<string>;
        } else if (
          monitorStep.data?.requestBody &&
          this.hasSecrets(JSONFunctions.toString(monitorStep.data.requestBody))
        ) {
          if (!isSecretsLoaded) {
            monitorSecrets = await MonitorUtil.loadMonitorSecrets(monitorId);
          }

          monitorStep.data.requestBody =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.requestBody,
            })) as string;
        }
      }
    }

    if (
      monitorType === MonitorType.API ||
      monitorType === MonitorType.IP ||
      monitorType === MonitorType.Ping ||
      monitorType === MonitorType.Port ||
      monitorType === MonitorType.Website ||
      monitorType === MonitorType.SSLCertificate
    ) {
      for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        if (
          monitorStep.data?.monitorDestination &&
          this.hasSecrets(
            JSONFunctions.toString(monitorStep.data.monitorDestination),
          )
        ) {
          // replace secret in monitorDestination.
          if (!isSecretsLoaded) {
            monitorSecrets = await MonitorUtil.loadMonitorSecrets(monitorId);
          }

          monitorStep.data.monitorDestination =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.monitorDestination,
            })) as URL | Hostname | IP;
        }
      }
    }

    if (
      monitorType === MonitorType.SyntheticMonitor ||
      monitorType === MonitorType.CustomJavaScriptCode
    ) {
      for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        if (
          monitorStep.data?.customCode &&
          this.hasSecrets(JSONFunctions.toString(monitorStep.data.customCode))
        ) {
          // replace secret in script
          if (!isSecretsLoaded) {
            monitorSecrets = await MonitorUtil.loadMonitorSecrets(monitorId);
          }

          monitorStep.data.customCode =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.customCode,
            })) as string;
        }
      }
    }

    if (monitorType === MonitorType.SNMP) {
      for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        // Handle SNMP community string secrets
        if (
          monitorStep.data?.snmpMonitor?.communityString &&
          this.hasSecrets(monitorStep.data.snmpMonitor.communityString)
        ) {
          if (!isSecretsLoaded) {
            monitorSecrets = await MonitorUtil.loadMonitorSecrets(monitorId);
            isSecretsLoaded = true;
          }

          monitorStep.data.snmpMonitor.communityString =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.snmpMonitor.communityString,
            })) as string;
        }

        // Handle SNMPv3 auth key secrets
        if (
          monitorStep.data?.snmpMonitor?.snmpV3Auth?.authKey &&
          this.hasSecrets(monitorStep.data.snmpMonitor.snmpV3Auth.authKey)
        ) {
          if (!isSecretsLoaded) {
            monitorSecrets = await MonitorUtil.loadMonitorSecrets(monitorId);
            isSecretsLoaded = true;
          }

          monitorStep.data.snmpMonitor.snmpV3Auth.authKey =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn:
                monitorStep.data.snmpMonitor.snmpV3Auth.authKey,
            })) as string;
        }

        // Handle SNMPv3 priv key secrets
        if (
          monitorStep.data?.snmpMonitor?.snmpV3Auth?.privKey &&
          this.hasSecrets(monitorStep.data.snmpMonitor.snmpV3Auth.privKey)
        ) {
          if (!isSecretsLoaded) {
            monitorSecrets = await MonitorUtil.loadMonitorSecrets(monitorId);
            isSecretsLoaded = true;
          }

          monitorStep.data.snmpMonitor.snmpV3Auth.privKey =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn:
                monitorStep.data.snmpMonitor.snmpV3Auth.privKey,
            })) as string;
        }
      }
    }

    if (monitorType === MonitorType.DNS) {
      for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        // Handle DNS hostname secrets (custom DNS server)
        if (
          monitorStep.data?.dnsMonitor?.hostname &&
          this.hasSecrets(monitorStep.data.dnsMonitor.hostname)
        ) {
          if (!isSecretsLoaded) {
            monitorSecrets = await MonitorUtil.loadMonitorSecrets(monitorId);
            isSecretsLoaded = true;
          }

          monitorStep.data.dnsMonitor.hostname =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.dnsMonitor.hostname,
            })) as string;
        }

        // Handle DNS query name secrets
        if (
          monitorStep.data?.dnsMonitor?.queryName &&
          this.hasSecrets(monitorStep.data.dnsMonitor.queryName)
        ) {
          if (!isSecretsLoaded) {
            monitorSecrets = await MonitorUtil.loadMonitorSecrets(monitorId);
            isSecretsLoaded = true;
          }

          monitorStep.data.dnsMonitor.queryName =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.dnsMonitor.queryName,
            })) as string;
        }
      }
    }

    if (monitorType === MonitorType.Domain) {
      for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        // Handle Domain name secrets
        if (
          monitorStep.data?.domainMonitor?.domainName &&
          this.hasSecrets(monitorStep.data.domainMonitor.domainName)
        ) {
          if (!isSecretsLoaded) {
            monitorSecrets = await MonitorUtil.loadMonitorSecrets(monitorId);
            isSecretsLoaded = true;
          }

          monitorStep.data.domainMonitor.domainName =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.domainMonitor.domainName,
            })) as string;
        }
      }
    }

    return monitorSteps;
  }

  public static async populateSecretsOnMonitorTest(
    monitorTest: MonitorTest,
  ): Promise<MonitorTest> {
    const monitorId: ObjectID | undefined = monitorTest.monitorId;

    if (!monitorId) {
      return monitorTest;
    }

    if (!monitorTest.monitorSteps) {
      return monitorTest;
    }

    if (!monitorTest.monitorSteps.data) {
      return monitorTest;
    }

    if (!monitorTest.monitorType) {
      return monitorTest;
    }

    monitorTest.monitorSteps = await MonitorUtil.populateSecretsInMonitorSteps({
      monitorSteps: monitorTest.monitorSteps,
      monitorType: monitorTest.monitorType,
      monitorId: monitorId,
    });

    return monitorTest;
  }

  public static async populateSecrets(monitor: Monitor): Promise<Monitor> {
    if (!monitor.id) {
      return monitor;
    }

    if (!monitor.monitorSteps) {
      return monitor;
    }

    if (!monitor.monitorSteps.data) {
      return monitor;
    }

    if (!monitor.monitorType) {
      return monitor;
    }

    monitor.monitorSteps = await MonitorUtil.populateSecretsInMonitorSteps({
      monitorSteps: monitor.monitorSteps,
      monitorType: monitor.monitorType,
      monitorId: monitor.id,
    });

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

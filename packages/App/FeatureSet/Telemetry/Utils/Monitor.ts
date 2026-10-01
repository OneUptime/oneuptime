import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
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

export default class MonitorUtil {
  /*
   * The secrets one monitor may use: the ones every monitor in its project
   * may use, the ones it is listed on, and the ones for any label it carries
   * (see MonitorSecretAccess).
   */
  public static async loadMonitorSecrets(
    monitorId: ObjectID,
  ): Promise<MonitorSecret[]> {
    const secretsByMonitorId: Map<
      string,
      Array<MonitorSecret>
    > = await MonitorUtil.loadMonitorSecretsForMonitors([monitorId]);

    return secretsByMonitorId.get(monitorId.toString()) || [];
  }

  /*
   * Batched variant of loadMonitorSecrets for a whole list of monitors (e.g.
   * every monitor claimed by a probe fetch cycle): the number of queries does
   * not grow with the list. A monitor that may use no secret has no entry, and
   * a secret only ever lands in the entry of a monitor its access mode covers.
   */
  public static async loadMonitorSecretsForMonitors(
    monitorIds: Array<ObjectID>,
  ): Promise<Map<string, Array<MonitorSecret>>> {
    return await MonitorSecretService.getSecretsForMonitors({
      monitorIds: monitorIds,
    });
  }

  /*
   * The secrets a monitor test runs with. A test names its monitor by id, and
   * that id is not checked against the test's own project when the test is
   * written, so the monitor's secrets apply only while the monitor is in the
   * test's project. A test of a monitor that is not saved yet (run from the
   * Create Monitor form) gets the secrets every monitor in the project may
   * use.
   */
  public static async loadMonitorSecretsForMonitorTest(data: {
    monitorId: ObjectID | undefined;
    projectId: ObjectID;
  }): Promise<Array<MonitorSecret>> {
    if (!data.monitorId) {
      return await MonitorSecretService.getSecretsForUnsavedMonitor({
        projectId: data.projectId,
      });
    }

    const secretsByMonitorId: Map<
      string,
      Array<MonitorSecret>
    > = await MonitorSecretService.getSecretsForMonitors({
      monitorIds: [data.monitorId],
      projectId: data.projectId,
    });

    return secretsByMonitorId.get(data.monitorId.toString()) || [];
  }

  // True when any part of the monitor steps references a {{monitorSecrets.*}} value.
  public static monitorStepsReferenceSecrets(
    monitorSteps: MonitorSteps,
  ): boolean {
    return this.hasSecrets(JSONFunctions.toString(monitorSteps.toJSON()));
  }

  public static async populateSecretsInMonitorSteps(data: {
    monitorSteps: MonitorSteps;
    monitorType: MonitorType;
    // Not needed when preloadedSecrets is given.
    monitorId?: ObjectID | undefined;
    preloadedSecrets?: Array<MonitorSecret> | undefined;
  }): Promise<MonitorSteps> {
    /*
     * Secrets are loaded lazily (only when a step actually references one)
     * and at most once per call — the promise is memoized so the many
     * populate sites below can all await it without issuing duplicate
     * queries. Callers that already batch-fetched secrets pass them in via
     * preloadedSecrets and skip the query entirely.
     */
    let monitorSecretsPromise: Promise<MonitorSecret[]> | null =
      data.preloadedSecrets ? Promise.resolve(data.preloadedSecrets) : null;

    const getSecrets: () => Promise<MonitorSecret[]> = (): Promise<
      MonitorSecret[]
    > => {
      if (!monitorSecretsPromise) {
        monitorSecretsPromise = data.monitorId
          ? MonitorUtil.loadMonitorSecrets(data.monitorId)
          : Promise.resolve([]);
      }

      return monitorSecretsPromise;
    };

    const monitorSteps: MonitorSteps = data.monitorSteps;
    const monitorType: MonitorType = data.monitorType;

    if (monitorType === MonitorType.API) {
      for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        if (
          monitorStep.data?.requestHeaders &&
          this.hasSecrets(
            JSONFunctions.toString(monitorStep.data.requestHeaders),
          )
        ) {
          const monitorSecrets: MonitorSecret[] = await getSecrets();

          monitorStep.data.requestHeaders =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.requestHeaders,
            })) as Dictionary<string>;
        }

        /*
         * Not an else: a request that sends a secret in a header can send
         * one in its body too, and used to go out with the body's
         * placeholder unfilled.
         */
        if (
          monitorStep.data?.requestBody &&
          this.hasSecrets(JSONFunctions.toString(monitorStep.data.requestBody))
        ) {
          const monitorSecrets: MonitorSecret[] = await getSecrets();

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
          const monitorSecrets: MonitorSecret[] = await getSecrets();

          monitorStep.data.monitorDestination =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.monitorDestination,
            })) as URL | Hostname | IP;
        }
      }
    }

    if (
      monitorType === MonitorType.API ||
      monitorType === MonitorType.Website
    ) {
      for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        // Resolve monitorSecrets in TLS client certificate / key / passphrase.
        if (
          monitorStep.data?.tlsClientCertificate &&
          this.hasSecrets(monitorStep.data.tlsClientCertificate)
        ) {
          const monitorSecrets: MonitorSecret[] = await getSecrets();

          monitorStep.data.tlsClientCertificate =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.tlsClientCertificate,
            })) as string;
        }

        if (
          monitorStep.data?.tlsClientKey &&
          this.hasSecrets(monitorStep.data.tlsClientKey)
        ) {
          const monitorSecrets: MonitorSecret[] = await getSecrets();

          monitorStep.data.tlsClientKey =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.tlsClientKey,
            })) as string;
        }

        if (
          monitorStep.data?.tlsClientKeyPassphrase &&
          this.hasSecrets(monitorStep.data.tlsClientKeyPassphrase)
        ) {
          const monitorSecrets: MonitorSecret[] = await getSecrets();

          monitorStep.data.tlsClientKeyPassphrase =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.tlsClientKeyPassphrase,
            })) as string;
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
          const monitorSecrets: MonitorSecret[] = await getSecrets();

          monitorStep.data.customCode =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.customCode,
            })) as string;
        }
      }
    }

    if (monitorType === MonitorType.NetworkDevice) {
      for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        // Handle SNMP community string secrets
        if (
          monitorStep.data?.snmpMonitor?.communityString &&
          this.hasSecrets(monitorStep.data.snmpMonitor.communityString)
        ) {
          const monitorSecrets: MonitorSecret[] = await getSecrets();

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
          const monitorSecrets: MonitorSecret[] = await getSecrets();

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
          const monitorSecrets: MonitorSecret[] = await getSecrets();

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
          const monitorSecrets: MonitorSecret[] = await getSecrets();

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
          const monitorSecrets: MonitorSecret[] = await getSecrets();

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
          const monitorSecrets: MonitorSecret[] = await getSecrets();

          monitorStep.data.domainMonitor.domainName =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.domainMonitor.domainName,
            })) as string;
        }
      }
    }

    if (monitorType === MonitorType.DNSSEC) {
      for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        if (
          monitorStep.data?.dnssecMonitor?.domainName &&
          this.hasSecrets(monitorStep.data.dnssecMonitor.domainName)
        ) {
          const monitorSecrets: MonitorSecret[] = await getSecrets();

          monitorStep.data.dnssecMonitor.domainName =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn: monitorStep.data.dnssecMonitor.domainName,
            })) as string;
        }
      }
    }

    if (monitorType === MonitorType.SQLQuery) {
      for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        if (!monitorStep.data?.sqlMonitor) {
          continue;
        }

        /*
         * Sensitive SQL connection fields may reference a monitor secret via
         * {{monitorSecrets.name}}. The user opts into this — OneUptime never
         * creates or populates a secret on their behalf; we only resolve a
         * reference they chose to write here.
         */
        const sqlSecretFields: Array<
          "password" | "username" | "host" | "databaseName" | "query"
        > = ["password", "username", "host", "databaseName", "query"];

        for (const field of sqlSecretFields) {
          const currentValue: string | undefined =
            monitorStep.data.sqlMonitor[field];

          if (currentValue && this.hasSecrets(currentValue)) {
            const monitorSecrets: MonitorSecret[] = await getSecrets();

            monitorStep.data.sqlMonitor[field] =
              (await MonitorUtil.fillSecretsInStringOrJSON({
                secrets: monitorSecrets,
                populateSecretsIn: currentValue,
              })) as string;
          }
        }
      }
    }

    if (monitorType === MonitorType.Database) {
      for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        if (!monitorStep.data?.databaseMonitor) {
          continue;
        }

        /*
         * Same opt-in secret references as the SQL Query monitor, minus the
         * query - Database Health has no user-authored SQL. Resolving these
         * here is what turns a stored {{monitorSecrets.name}} into a usable
         * credential before the step reaches the probe.
         */
        const databaseSecretFields: Array<
          "password" | "username" | "host" | "databaseName"
        > = ["password", "username", "host", "databaseName"];

        for (const field of databaseSecretFields) {
          const currentValue: string | undefined =
            monitorStep.data.databaseMonitor[field];

          if (currentValue && this.hasSecrets(currentValue)) {
            const monitorSecrets: MonitorSecret[] = await getSecrets();

            monitorStep.data.databaseMonitor[field] =
              (await MonitorUtil.fillSecretsInStringOrJSON({
                secrets: monitorSecrets,
                populateSecretsIn: currentValue,
              })) as string;
          }
        }
      }
    }

    if (monitorType === MonitorType.ExternalStatusPage) {
      for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        // Handle External Status Page URL secrets
        if (
          monitorStep.data?.externalStatusPageMonitor?.statusPageUrl &&
          this.hasSecrets(
            monitorStep.data.externalStatusPageMonitor.statusPageUrl,
          )
        ) {
          const monitorSecrets: MonitorSecret[] = await getSecrets();

          monitorStep.data.externalStatusPageMonitor.statusPageUrl =
            (await MonitorUtil.fillSecretsInStringOrJSON({
              secrets: monitorSecrets,
              populateSecretsIn:
                monitorStep.data.externalStatusPageMonitor.statusPageUrl,
            })) as string;
        }
      }
    }

    return monitorSteps;
  }

  public static async populateSecretsOnMonitorTest(
    monitorTest: MonitorTest,
  ): Promise<MonitorTest> {
    const projectId: ObjectID | undefined = monitorTest.projectId;

    if (!projectId) {
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

    // Most tests reference no secret; they need no query at all.
    if (!MonitorUtil.monitorStepsReferenceSecrets(monitorTest.monitorSteps)) {
      return monitorTest;
    }

    monitorTest.monitorSteps = await MonitorUtil.populateSecretsInMonitorSteps({
      monitorSteps: monitorTest.monitorSteps,
      monitorType: monitorTest.monitorType,
      preloadedSecrets: await MonitorUtil.loadMonitorSecretsForMonitorTest({
        monitorId: monitorTest.monitorId,
        projectId: projectId,
      }),
    });

    return monitorTest;
  }

  public static async populateSecrets(
    monitor: Monitor,
    preloadedSecrets?: Array<MonitorSecret> | undefined,
  ): Promise<Monitor> {
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
      preloadedSecrets: preloadedSecrets,
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

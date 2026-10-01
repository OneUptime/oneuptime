import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import IP from "Common/Types/IP/IP";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorSecretService from "Common/Server/Services/MonitorSecretService";
import MonitorService from "Common/Server/Services/MonitorService";
import VMUtil from "Common/Server/Utils/VM/VMAPI";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import ObjectID from "Common/Types/ObjectID";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import FindBy from "Common/Server/Types/Database/FindBy";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";

export default class MonitorUtil {
  public static async loadMonitorSecrets(
    monitorId: ObjectID,
  ): Promise<MonitorSecret[]> {
    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        _id: QueryHelper.any([monitorId]),
      },
      select: {
        _id: true,
        projectId: true,
        labels: {
          _id: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const secretsByMonitorId: Map<
      string,
      Array<MonitorSecret>
    > = await MonitorUtil.loadMonitorSecretsForMonitors(monitors);

    return secretsByMonitorId.get(monitorId.toString()) || [];
  }

  /*
   * Resolves the explicit, all-monitors and label grants (#1467) for a batch of
   * already-loaded monitors.
   */
  public static async loadMonitorSecretsForMonitors(
    monitors: Array<Monitor>,
  ): Promise<Map<string, Array<MonitorSecret>>> {
    const secretsByMonitorId: Map<string, Array<MonitorSecret>> = new Map();

    const usableMonitors: Array<Monitor> = [];
    const monitorIds: Array<ObjectID> = [];
    const projectIds: Set<string> = new Set<string>();
    const labelIds: Set<string> = new Set<string>();

    for (const monitor of monitors) {
      if (!monitor.id || !monitor.projectId) {
        continue;
      }

      monitorIds.push(monitor.id);
      projectIds.add(monitor.projectId.toString());

      for (const label of monitor.labels || []) {
        if (label.id) {
          labelIds.add(label.id.toString());
        }
      }

      usableMonitors.push(monitor);
    }

    if (usableMonitors.length === 0) {
      return secretsByMonitorId;
    }

    const queryProjectIds: Array<ObjectID> = [...projectIds].map(
      (id: string) => {
        return new ObjectID(id);
      },
    );

    const select: FindBy<MonitorSecret>["select"] = {
      secretValue: true,
      name: true,
      isAvailableToAllMonitors: true,
      projectId: true,
      monitors: {
        _id: true,
      },
      labels: {
        _id: true,
      },
    };

    const queries: Array<FindBy<MonitorSecret>["query"]> = [
      {
        projectId: QueryHelper.any(queryProjectIds),
        monitors: QueryHelper.inRelationArray(monitorIds),
      },
      {
        projectId: QueryHelper.any(queryProjectIds),
        isAvailableToAllMonitors: true,
      },
    ];

    if (labelIds.size > 0) {
      queries.push({
        projectId: QueryHelper.any(queryProjectIds),
        labels: QueryHelper.inRelationArray(
          [...labelIds].map((id: string) => {
            return new ObjectID(id);
          }),
        ),
      });
    }

    // The candidate queries can overlap, so dedupe by secret id.
    const secretsById: Map<string, MonitorSecret> = new Map<
      string,
      MonitorSecret
    >();

    const results: Array<Array<MonitorSecret>> = await Promise.all(
      queries.map((query: FindBy<MonitorSecret>["query"]) => {
        return MonitorSecretService.findBy({
          query: query,
          select: select,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });
      }),
    );

    for (const secrets of results) {
      for (const secret of secrets) {
        if (secret.id) {
          secretsById.set(secret.id.toString(), secret);
        }
      }
    }

    for (const secret of secretsById.values()) {
      for (const monitor of usableMonitors) {
        if (!MonitorUtil.monitorCanAccessSecret(monitor, secret)) {
          continue;
        }

        const monitorKey: string = monitor.id!.toString();
        const existing: Array<MonitorSecret> | undefined =
          secretsByMonitorId.get(monitorKey);

        if (existing) {
          existing.push(secret);
        } else {
          secretsByMonitorId.set(monitorKey, [secret]);
        }
      }
    }

    return secretsByMonitorId;
  }

  /*
   * Grants only apply within the secret's project; a missing or mismatched
   * project denies.
   */
  private static monitorCanAccessSecret(
    monitor: Monitor,
    secret: MonitorSecret,
  ): boolean {
    const monitorProjectId: string | undefined = monitor.projectId?.toString();
    const secretProjectId: string | undefined = secret.projectId?.toString();

    if (!monitorProjectId || !secretProjectId) {
      return false;
    }

    if (monitorProjectId !== secretProjectId) {
      return false;
    }

    if (secret.isAvailableToAllMonitors) {
      return true;
    }

    const monitorId: string | undefined = monitor.id?.toString();

    if (
      monitorId &&
      (secret.monitors || []).some((each: Monitor) => {
        return each.id?.toString() === monitorId;
      })
    ) {
      return true;
    }

    const monitorLabelIds: Array<string> = (monitor.labels || [])
      .map((label: Label) => {
        return label.id?.toString();
      })
      .filter((id: string | undefined): id is string => {
        return Boolean(id);
      });

    return (secret.labels || []).some((label: Label) => {
      const labelId: string | undefined = label.id?.toString();
      return labelId ? monitorLabelIds.includes(labelId) : false;
    });
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
    monitorId: ObjectID;
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
        monitorSecretsPromise = MonitorUtil.loadMonitorSecrets(data.monitorId);
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
        } else if (
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

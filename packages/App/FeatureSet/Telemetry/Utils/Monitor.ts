import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import IP from "Common/Types/IP/IP";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorSecretService from "Common/Server/Services/MonitorSecretService";
import VMUtil from "Common/Server/Utils/VM/VMAPI";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import ObjectID from "Common/Types/ObjectID";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import { MonitorSecretTypeUtil } from "Common/Types/Monitor/MonitorSecretType";
import {
  StepTotpReferences,
  callsTotpCodeFunction,
  getStepTotpReferences,
  getTotpSecretNamesNeeded,
} from "Common/Utils/Monitor/MonitorSecretReferences";
import MonitorRequestBody from "Common/Utils/Monitor/MonitorRequestBody";
import { TotpParameters, TotpSecrets } from "Common/Utils/Totp/TotpParameters";
import {
  TotpSecretReading,
  readTotpSecret,
} from "Common/Utils/Totp/TotpSecret";

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

  /*
   * True when any part of the monitor steps references a
   * {{monitorSecrets.*}} value, or a script asks for a one-time code with
   * oneuptime.getTotpCode - either needs the monitor's secrets.
   */
  public static monitorStepsReferenceSecrets(
    monitorSteps: MonitorSteps,
  ): boolean {
    const steps: string = JSONFunctions.toString(monitorSteps.toJSON());

    return this.hasSecrets(steps) || callsTotpCodeFunction(steps);
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

    /*
     * Which one-time code (TOTP) secrets each step may need, read from the
     * step as written - before any secret is filled in, so text a secret's
     * value carries is never taken for a reference (issue #9703).
     */
    const totpReferences: Map<MonitorStep, StepTotpReferences> =
      MonitorUtil.getTotpReferences(monitorSteps, monitorType);

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
         *
         * Each secret is written as its place in the body needs it
         * (#10735): escaped inside a JSON string, as it is anywhere else.
         * Written as it is everywhere, a password holding a quote ended
         * its string, and the check failed without sending anything.
         */
        if (
          typeof monitorStep.data?.requestBody === "string" &&
          this.hasSecrets(monitorStep.data.requestBody)
        ) {
          const monitorSecrets: MonitorSecret[] = await getSecrets();

          monitorStep.data.requestBody = MonitorUtil.fillSecretsInRequestBody({
            secrets: monitorSecrets,
            requestBody: monitorStep.data.requestBody,
          });
        }
      }
    }

    if (
      monitorType === MonitorType.API ||
      monitorType === MonitorType.IP ||
      monitorType === MonitorType.Ping ||
      monitorType === MonitorType.Port ||
      monitorType === MonitorType.NTP ||
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
            MonitorUtil.readFilledDestination({
              filled: await MonitorUtil.fillSecretsInStringOrJSON({
                secrets: monitorSecrets,
                populateSecretsIn: monitorStep.data.monitorDestination,
              }),
              configured: monitorStep.data.monitorDestination,
            });
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

    await MonitorUtil.attachTotpSecrets({
      references: totpReferences,
      getSecrets: getSecrets,
    });

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

  /*
   * A destination with its secrets filled in, as the URL, Hostname or IP
   * it was. Filling works on the destination's JSON and hands back that
   * JSON, {_type, value}, which is no URL: left so, the step could not be
   * written for the probe - MonitorStep.toJSON asks the destination for
   * its JSON - and every monitor in the probe's batch went unchecked with
   * it. A filled value its type cannot hold (a host a secret made invalid)
   * keeps the destination as configured, so that one check fails on its
   * own rather than the batch.
   */
  private static readFilledDestination(data: {
    filled: unknown;
    configured: URL | Hostname | IP;
  }): URL | Hostname | IP {
    const filled: unknown = data.filled;

    if (
      filled instanceof URL ||
      filled instanceof Hostname ||
      filled instanceof IP
    ) {
      return filled;
    }

    if (typeof filled === "string") {
      return URL.fromStringLenient(filled);
    }

    const json: JSONObject | null =
      filled && typeof filled === "object" ? (filled as JSONObject) : null;

    if (!json || typeof json["value"] !== "string") {
      return data.configured;
    }

    try {
      switch (json["_type"]) {
        case ObjectType.URL:
          return URL.fromJSON(json);
        case ObjectType.Hostname:
          return Hostname.fromJSON(json);
        case ObjectType.IP:
          return IP.fromJSON(json);
      }
    } catch {
      // Never logged: the value holds the secret that was filled in.
    }

    return data.configured;
  }

  /*
   * The one-time code secrets a step's probe makes codes for, where it
   * makes them (MonitorSecretReferences.getStepTotpReferences): the
   * {{monitorSecrets.NAME}} references of an API step's URL, headers and
   * body, and of a Synthetic or Custom JavaScript Code step's script - and,
   * for a script that asks with oneuptime.getTotpCode, the script itself,
   * whose quoted names say which secrets it asks for. Every other field
   * fills in Text secrets only, and leaves a reference to a one-time code
   * secret as written. The monitor forms read steps the same way, to warn
   * of a probe too old to make the codes (issue #9759).
   *
   * Every step's carried parameters are cleared here first, so a step only
   * ever carries what the monitor's own secrets give it.
   */
  private static getTotpReferences(
    monitorSteps: MonitorSteps,
    monitorType: MonitorType,
  ): Map<MonitorStep, StepTotpReferences> {
    const references: Map<MonitorStep, StepTotpReferences> = new Map();

    for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
      []) {
      if (!monitorStep.data) {
        continue;
      }

      monitorStep.data.totpSecrets = undefined;

      const stepReferences: StepTotpReferences | null = getStepTotpReferences(
        monitorStep,
        monitorType,
      );

      if (stepReferences) {
        references.set(monitorStep, stepReferences);
      }
    }

    return references;
  }

  /*
   * Hands each step the parameters of the one-time code secrets it names
   * and its monitor may use. The seed travels to the probe beside the step,
   * never inside a field: a field that takes no code keeps its reference
   * as written, as it does for a secret the monitor may not use.
   */
  private static async attachTotpSecrets(data: {
    references: Map<MonitorStep, StepTotpReferences>;
    getSecrets: () => Promise<Array<MonitorSecret>>;
  }): Promise<void> {
    if (data.references.size === 0) {
      return;
    }

    const parametersByName: Map<string, TotpParameters> = new Map();

    for (const secret of await data.getSecrets()) {
      if (
        !secret.name ||
        !MonitorSecretTypeUtil.isTotp(secret.secretType) ||
        !secret.secretValue
      ) {
        continue;
      }

      const reading: TotpSecretReading = readTotpSecret(secret.secretValue);

      // Refused when it was saved; a stored value that cannot be read gives no code.
      if (reading.parameters) {
        parametersByName.set(secret.name, reading.parameters);
      }
    }

    if (parametersByName.size === 0) {
      return;
    }

    for (const [monitorStep, references] of Array.from(
      data.references.entries(),
    )) {
      const names: Array<string> = getTotpSecretNamesNeeded(
        references,
        parametersByName.keys(),
      );

      const totpSecrets: TotpSecrets = {};

      for (const name of names) {
        const parameters: TotpParameters | undefined =
          parametersByName.get(name);

        if (parameters) {
          totpSecrets[name] = parameters;
        }
      }

      if (monitorStep.data && Object.keys(totpSecrets).length > 0) {
        monitorStep.data.totpSecrets = totpSecrets;
      }
    }
  }

  /*
   * The values a monitor's {{monitorSecrets.NAME}} references are filled
   * with, by name: its Text secrets that have one. A one-time code secret's
   * value is a seed, and a seed is never written into a monitor: its
   * reference is left for the probe, which makes the code when the check
   * uses it (attachTotpSecrets).
   */
  private static getTextSecretValues(
    secrets: Array<MonitorSecret>,
  ): Map<string, string> {
    const values: Map<string, string> = new Map();

    for (const monitorSecret of secrets) {
      if (
        !monitorSecret.name ||
        !monitorSecret.secretValue ||
        MonitorSecretTypeUtil.isTotp(monitorSecret.secretType)
      ) {
        continue;
      }

      values.set(monitorSecret.name, monitorSecret.secretValue);
    }

    return values;
  }

  /*
   * An API step's body with the monitor's Text secrets filled in, each
   * written as its place in the body needs it (MonitorRequestBody.
   * fillSecrets, #10735). A reference to a secret the monitor may not use,
   * or to a one-time code secret, is left as written. Nothing here is
   * logged or thrown: the values are the secrets'.
   */
  private static fillSecretsInRequestBody(data: {
    secrets: Array<MonitorSecret>;
    requestBody: string;
  }): string {
    return MonitorRequestBody.fillSecrets(
      data.requestBody,
      MonitorUtil.getTextSecretValues(data.secrets),
    );
  }

  private static async fillSecretsInStringOrJSON(data: {
    secrets: MonitorSecret[];
    populateSecretsIn: string | JSONObject | URL | Hostname | IP;
  }): Promise<string | JSONObject | URL | Hostname | IP> {
    const values: Map<string, string> = MonitorUtil.getTextSecretValues(
      data.secrets,
    );

    if (values.size === 0) {
      return data.populateSecretsIn;
    }

    // replace all secrets in the populateSecretsIn

    const storageMap: JSONObject = {
      monitorSecrets: Object.fromEntries(values.entries()),
    };

    const isValueJSON: boolean = typeof data.populateSecretsIn === "object";

    return VMUtil.replaceValueInPlace(
      storageMap,
      data.populateSecretsIn as string,
      isValueJSON,
    );
  }
}

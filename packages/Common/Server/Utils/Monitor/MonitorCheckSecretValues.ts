import MonitorSecretService from "../../Services/MonitorSecretService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorSecret from "../../../Models/DatabaseModels/MonitorSecret";
import MonitorTest from "../../../Models/DatabaseModels/MonitorTest";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import { MonitorSecretTypeUtil } from "../../../Types/Monitor/MonitorSecretType";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import {
  MONITOR_SECRETS_REFERENCE_PREFIX,
  getReferencedSecretNames,
} from "../../../Utils/Monitor/MonitorSecretReferences";
import MonitorRecordEvidence from "./MonitorRecordEvidence";
import MonitorSecretValueRedaction, {
  HiddenSecretValues,
} from "./MonitorSecretValueRedaction";

/*
 * THE SECRETS A CHECK RAN WITH, HIDDEN IN WHAT IT REPORTS (#10825).
 *
 * As a probe's check is taken in - a monitor's, right after the monitor is
 * read (MonitorResource.monitorResource), a Test Monitor run's, right after
 * its test is (ProcessProbeIngest.processProbeFromQueue) - the values of the
 * Text secrets its steps reference are hidden wherever they stand in it
 * (MonitorSecretValueRedaction), before anything reads it: its criteria,
 * the monitor's logs and summary, the probe's latest check, an incident's
 * root cause and notifications, the test's kept result. It is done on the
 * server, so a probe of any release - a custom probe that was never
 * updated - leaks none.
 *
 * The secrets are the ones the server filled into the steps: those the
 * monitor may use (MonitorSecretService.getSecretsForMonitors), and for a
 * test the ones it runs with (loadSecretsForMonitorTest), the same rule the
 * probe's fetch reads them by. Of those, the Text secrets the steps name as
 * {{monitorSecrets.NAME}}: a one-time code secret's seed is never filled in
 * (the probe makes a code from it, and takes every code out of what it
 * reports itself), and a secret no step names was never sent. A monitor
 * whose steps name none costs no query.
 *
 * The monitor's configuration is never changed: its steps keep the
 * placeholders as written and its secrets their values, so the next check
 * is sent the secret as before. Only the copy of the check is written.
 */
export default class MonitorCheckSecretValues {
  /*
   * The names a monitor's steps reference as {{monitorSecrets.NAME}},
   * anywhere in them, read as the server reads a placeholder
   * (MonitorSecretReferences).
   */
  public static getReferencedNames(
    monitorSteps: MonitorSteps | undefined | null,
  ): Set<string> {
    if (!monitorSteps) {
      return new Set<string>();
    }

    let text: string = "";

    try {
      text = JSONFunctions.toString(
        typeof (monitorSteps as MonitorSteps).toJSON === "function"
          ? (monitorSteps as MonitorSteps).toJSON()
          : (monitorSteps as unknown as JSONObject),
      );
    } catch {
      return new Set<string>();
    }

    if (text.indexOf(MONITOR_SECRETS_REFERENCE_PREFIX) === -1) {
      return new Set<string>();
    }

    return new Set<string>(getReferencedSecretNames(text));
  }

  /*
   * The values to hide: of these secrets, the Text ones with a value that a
   * name in `names` references. A name read from the steps' JSON is the
   * name as JSON writes it, so a name with a quote in it is matched so too.
   */
  public static getValuesToHide(input: {
    names: ReadonlySet<string>;
    secrets: Array<MonitorSecret>;
  }): Array<string> {
    const values: Array<string> = [];

    if (input.names.size === 0) {
      return values;
    }

    for (const secret of input.secrets) {
      if (
        !secret ||
        !secret.name ||
        typeof secret.secretValue !== "string" ||
        !secret.secretValue ||
        MonitorSecretTypeUtil.isTotp(secret.secretType)
      ) {
        continue;
      }

      const nameAsJsonWritesIt: string = JSON.stringify(secret.name).slice(
        1,
        -1,
      );

      if (input.names.has(secret.name) || input.names.has(nameAsJsonWritesIt)) {
        values.push(secret.secretValue);
      }
    }

    return values;
  }

  /*
   * The secrets a monitor test runs with. A test names its monitor by id,
   * and that id is not checked against the test's own project when the test
   * is written, so the monitor's secrets apply only while the monitor is in
   * the test's project. A test of a monitor that is not saved yet (run from
   * the Create Monitor form) gets the secrets every monitor in the project
   * may use. The probe's fetch reads them by this rule
   * (MonitorUtil.loadMonitorSecretsForMonitorTest), so a check is read for
   * the very secrets it was run with.
   */
  public static async loadSecretsForMonitorTest(data: {
    monitorId: ObjectID | undefined | null;
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

  // A monitor's check, its secrets' values hidden.
  public static async hideInMonitorCheck(input: {
    check: ProbeMonitorResponse;
    monitor: Monitor;
  }): Promise<ProbeMonitorResponse> {
    const names: Set<string> = MonitorCheckSecretValues.getReferencedNames(
      input.monitor.monitorSteps,
    );

    if (names.size === 0 || !input.monitor.id) {
      return input.check;
    }

    const secretsByMonitorId: Map<
      string,
      Array<MonitorSecret>
    > = await MonitorSecretService.getSecretsForMonitors({
      monitorIds: [input.monitor.id],
    });

    return MonitorCheckSecretValues.hide({
      check: input.check,
      monitorSteps: input.monitor.monitorSteps,
      values: MonitorCheckSecretValues.getValuesToHide({
        names: names,
        secrets: secretsByMonitorId.get(input.monitor.id.toString()) || [],
      }),
    });
  }

  // A Test Monitor run's check, the secrets it ran with hidden.
  public static async hideInMonitorTestCheck(input: {
    check: ProbeMonitorResponse;
    monitorTest: MonitorTest;
  }): Promise<ProbeMonitorResponse> {
    const names: Set<string> = MonitorCheckSecretValues.getReferencedNames(
      input.monitorTest.monitorSteps,
    );

    if (names.size === 0 || !input.monitorTest.projectId) {
      return input.check;
    }

    return MonitorCheckSecretValues.hide({
      check: input.check,
      monitorSteps: input.monitorTest.monitorSteps,
      values: MonitorCheckSecretValues.getValuesToHide({
        names: names,
        secrets: await MonitorCheckSecretValues.loadSecretsForMonitorTest({
          monitorId: input.monitorTest.monitorId,
          projectId: input.monitorTest.projectId,
        }),
      }),
    });
  }

  /*
   * A check with these values hidden. The destination it echoes, when it
   * holds one, becomes its step's as configured.
   */
  public static hide(input: {
    check: ProbeMonitorResponse;
    monitorSteps: MonitorSteps | undefined;
    values: Array<string>;
  }): ProbeMonitorResponse {
    const values: HiddenSecretValues | null =
      MonitorSecretValueRedaction.compile(input.values);

    if (!values) {
      return input.check;
    }

    const step: MonitorStep | undefined = MonitorRecordEvidence.findCheckStep({
      monitor: { monitorSteps: input.monitorSteps },
      check: input.check,
    });

    return MonitorSecretValueRedaction.redactCheck(input.check, values, {
      configuredDestination: step?.data?.monitorDestination,
    });
  }
}

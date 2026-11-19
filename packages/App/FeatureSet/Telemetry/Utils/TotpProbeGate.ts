import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProbeService from "Common/Server/Services/ProbeService";
import logger from "Common/Server/Utils/Logger";
import BrowserType from "Common/Types/BrowserType";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import CustomCodeMonitorResponse from "Common/Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability, {
  FIRST_PROBE_VERSION_WITH_TOTP_CODES,
  ProbeCapabilityUtil,
} from "Common/Types/Probe/ProbeCapability";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import ScreenSizeType from "Common/Types/ScreenSizeType";
import {
  ProbeFailureCause,
  writeProbeFailureCause,
} from "Common/Utils/Monitor/ProbeFailureCauses";
import TelemetryQueueService from "../Services/Queue/TelemetryQueueService";

/*
 * A STEP THAT NEEDS A ONE-TIME CODE GOES ONLY TO A PROBE THAT MAKES ONE
 * (OneUptime issue #9759).
 *
 * The server never fills a one-time code (TOTP) secret into a monitor: it
 * hands the probe the code's parameters beside the step
 * (MonitorStep.totpSecrets, MonitorUtil.attachTotpSecrets), and the probe
 * makes the code when the check uses it. A custom probe older than
 * FIRST_PROBE_VERSION_WITH_TOTP_CODES drops those parameters and sends
 * {{monitorSecrets.NAME}} as written, so the site refuses the sign-in, and
 * the check failed with a login error that said nothing of why.
 *
 * Such a probe cannot be changed: it is already deployed. What it does say,
 * on every request, is what it can do (probeCapabilities), and none before
 * 17.0.1 declares ProbeCapability.TotpCodes. So when a probe that does not
 * asks for its monitors or its monitor tests, the server keeps each step
 * that carries code parameters from it, and writes that step's result
 * itself, as the probe's: a failed check whose error says the probe is too
 * old to make one-time codes and to update it
 * (ProbeFailureCause.ProbeTooOldForOneTimeCodes). The result goes through
 * the same queue as the probe's own, so the monitor's criteria judge it
 * like any other: an API step is offline, as a request that failed is; a
 * Synthetic or Custom Code step carries the sentence as its script's error,
 * which the default criteria read as offline. The probe is handed the
 * monitor's other steps, and a monitor with none left is not handed out.
 *
 * Global probes are OneUptime's own and always current: they are handed
 * every step, as before, and never flagged.
 */

// What the server hands a probe: a monitor to check, or a monitor test.
export type ItemForProbe = Monitor | MonitorTest;

export enum ItemForProbeKind {
  Monitor = "monitor",
  MonitorTest = "monitor-test",
}

// The error a step kept from a probe too old to make one-time codes says.
export const ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE: string =
  writeProbeFailureCause(ProbeFailureCause.ProbeTooOldForOneTimeCodes, {
    version: FIRST_PROBE_VERSION_WITH_TOTP_CODES,
  });

export default class TotpProbeGate {
  /*
   * The steps of an item that need a one-time code: those the server
   * handed code parameters to while it filled in the item's secrets.
   */
  public static getStepsNeedingCodes(item: ItemForProbe): Array<MonitorStep> {
    return (item.monitorSteps?.data?.monitorStepsInstanceArray || []).filter(
      (step: MonitorStep): boolean => {
        return Object.keys(step?.data?.totpSecrets || {}).length > 0;
      },
    );
  }

  // Whether the probe's request declares that it makes one-time codes.
  public static isDeclaredByRequest(requestBody: unknown): boolean {
    const capabilities: unknown =
      requestBody && typeof requestBody === "object"
        ? (requestBody as Record<string, unknown>)["probeCapabilities"]
        : undefined;

    return ProbeCapabilityUtil.has(
      ProbeCapabilityUtil.parse(capabilities),
      ProbeCapability.TotpCodes,
    );
  }

  /*
   * The items to hand the probe that sent `requestBody`: all of them, when
   * it makes one-time codes, is a global probe, or none of them needs a
   * code; otherwise each without its steps that need a code - whose
   * results are written for the probe - and none that has no step left.
   * Called after the items' secrets are filled in, so the steps carry
   * their code parameters.
   */
  public static async keepStepsFromProbesTooOld<T extends ItemForProbe>(data: {
    items: Array<T>;
    probeId: ObjectID;
    requestBody: unknown;
    kind: ItemForProbeKind;
  }): Promise<Array<T>> {
    const needingCodes: Array<T> = data.items.filter((item: T): boolean => {
      return this.getStepsNeedingCodes(item).length > 0;
    });

    if (
      needingCodes.length === 0 ||
      this.isDeclaredByRequest(data.requestBody)
    ) {
      return data.items;
    }

    if (await this.isGlobalProbe(data.probeId)) {
      return data.items;
    }

    const handedOut: Array<T> = [];

    for (const item of data.items) {
      const stepsNeedingCodes: Array<MonitorStep> =
        this.getStepsNeedingCodes(item);

      if (stepsNeedingCodes.length === 0) {
        handedOut.push(item);
        continue;
      }

      for (const step of stepsNeedingCodes) {
        await this.writeStepNotRun({
          item: item,
          step: step,
          probeId: data.probeId,
          kind: data.kind,
        });
      }

      const otherSteps: Array<MonitorStep> = (
        item.monitorSteps?.data?.monitorStepsInstanceArray || []
      ).filter((step: MonitorStep): boolean => {
        return !stepsNeedingCodes.includes(step);
      });

      if (otherSteps.length > 0 && item.monitorSteps?.data) {
        item.monitorSteps.data.monitorStepsInstanceArray = otherSteps;
        handedOut.push(item);
      }
    }

    logger.debug(
      `Kept ${needingCodes.length} item(s) with steps that need a one-time code from probe ${data.probeId.toString()}, which does not make them.`,
    );

    return handedOut;
  }

  /*
   * The result of a step kept from a probe too old to make one-time codes,
   * as the probe would report a check that failed: an API step offline, a
   * Synthetic or Custom Code step with the sentence as its script's error
   * (for each browser and screen size it is checked on).
   */
  public static buildStepNotRun(data: {
    monitorType: MonitorType | undefined;
    step: MonitorStep;
    // The monitor's id, or a monitor test's, as the probe names it.
    monitorId: ObjectID;
    projectId: ObjectID;
    probeId: ObjectID;
    at: Date;
  }): ProbeMonitorResponse {
    const message: string = ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE;

    const response: ProbeMonitorResponse = {
      projectId: data.projectId,
      monitorId: data.monitorId,
      monitorStepId: data.step.id,
      probeId: data.probeId,
      failureCause: message,
      monitoredAt: data.at,
    };

    if (data.monitorType === MonitorType.SyntheticMonitor) {
      response.syntheticMonitorResponse = this.getBrowsersAndScreens(
        data.step,
      ).map(
        (combination: {
          browserType: BrowserType;
          screenSizeType: ScreenSizeType;
        }): SyntheticMonitorResponse => {
          return {
            ...this.getScriptError(message),
            browserType: combination.browserType,
            screenSizeType: combination.screenSizeType,
          };
        },
      );

      return response;
    }

    if (data.monitorType === MonitorType.CustomJavaScriptCode) {
      response.customCodeMonitorResponse = this.getScriptError(message);

      return response;
    }

    response.isOnline = false;

    return response;
  }

  private static async writeStepNotRun(data: {
    item: ItemForProbe;
    step: MonitorStep;
    probeId: ObjectID;
    kind: ItemForProbeKind;
  }): Promise<void> {
    if (!data.item.id || !data.item.projectId) {
      return;
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    const response: ProbeMonitorResponse = this.buildStepNotRun({
      monitorType: data.item.monitorType,
      step: data.step,
      monitorId: data.item.id,
      projectId: data.item.projectId,
      probeId: data.probeId,
      at: now,
    });

    /*
     * Never fails the probe's batch: a result that could not be queued is
     * written again at the step's next check, and the step is kept from the
     * probe either way - handed out, it would only fail without a reason.
     */
    try {
      await TelemetryQueueService.addProbeIngestJob({
        probeId: data.probeId,
        probeMonitorResponse: JSONFunctions.serialize(
          response as unknown as JSONObject,
        ),
        jobType:
          data.kind === ItemForProbeKind.MonitorTest
            ? "monitor-test"
            : "probe-response",
        testId:
          data.kind === ItemForProbeKind.MonitorTest
            ? data.item.id.toString()
            : undefined,
        receivedAt: now,
      });
    } catch (err) {
      logger.error(
        `Could not write that ${data.kind} ${data.item.id.toString()} did not run on probe ${data.probeId.toString()}, which is too old to make one-time codes.`,
      );
      logger.error(err);
    }
  }

  // A script that failed with this error, as the probe reports one.
  private static getScriptError(message: string): CustomCodeMonitorResponse {
    return {
      result: undefined,
      scriptError: message,
      logMessages: [],
      capturedMetrics: [],
      executionTimeInMS: 0,
    };
  }

  /*
   * Each browser and screen size a Synthetic step is checked on, as the
   * probe runs them; one of each when the step names none, so the step
   * still reports its error.
   */
  private static getBrowsersAndScreens(step: MonitorStep): Array<{
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
  }> {
    const browserTypes: Array<BrowserType> = step.data?.browserTypes?.length
      ? step.data.browserTypes
      : [BrowserType.Chromium];
    const screenSizeTypes: Array<ScreenSizeType> = step.data?.screenSizeTypes
      ?.length
      ? step.data.screenSizeTypes
      : [ScreenSizeType.Desktop];

    const combinations: Array<{
      browserType: BrowserType;
      screenSizeType: ScreenSizeType;
    }> = [];

    for (const browserType of browserTypes) {
      for (const screenSizeType of screenSizeTypes) {
        combinations.push({ browserType, screenSizeType });
      }
    }

    return combinations;
  }

  /*
   * Read only when a probe that does not make one-time codes is handed a
   * step that needs one - a custom probe older than 17.0.1, or a global
   * probe mid-update - so it costs nothing on any other request.
   */
  private static async isGlobalProbe(probeId: ObjectID): Promise<boolean> {
    const probe: Probe | null = await ProbeService.findOneById({
      id: probeId,
      select: {
        isGlobalProbe: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(probe?.isGlobalProbe);
  }
}

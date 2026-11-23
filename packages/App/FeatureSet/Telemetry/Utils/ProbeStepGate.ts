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
  ProbeCapabilityUtil,
} from "Common/Types/Probe/ProbeCapability";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import ScreenSizeType from "Common/Types/ScreenSizeType";
import TelemetryQueueService from "../Services/Queue/TelemetryQueueService";

/*
 * A STEP GOES ONLY TO A PROBE THAT CAN RUN IT (OneUptime issues #9759,
 * #10737).
 *
 * Some steps need what only a newer probe does: a one-time code, which a
 * probe from before 17.0.1 drops and sends {{monitorSecrets.NAME}} as
 * written (TotpProbeGate), or a request body that is a JSON array, a single
 * value or text, which a probe from before 17.2.0 fails with "Expected
 * JSONObject, but got JSONArray" (RequestBodyProbeGate). Either way the
 * check failed with an error that said nothing of why.
 *
 * Such a probe cannot be changed: it is already deployed. What it does say,
 * on every request, is what it can do (probeCapabilities), and none before
 * those releases declares what they brought. So when a probe that does not
 * asks for its monitors or its monitor tests, the server keeps each step
 * that needs more from it, and writes that step's result itself, as the
 * probe's: a failed check whose error says the probe is too old for it and
 * to update it. The result goes through the same queue as the probe's own,
 * so the monitor's criteria judge it like any other: an API step is
 * offline, as a request that failed is; a Synthetic or Custom Code step
 * carries the sentence as its script's error, which the default criteria
 * read as offline. The probe is handed the monitor's other steps, and a
 * monitor with none left is not handed out.
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

// What a step can need of the probe it is handed to.
export interface ProbeStepNeed {
  // What a probe that can do it declares.
  capability: ProbeCapability;
  /*
   * Whether a step needs it, read as the server hands the step over: after
   * the item's secrets are filled in.
   */
  isNeededBy: (data: {
    step: MonitorStep;
    monitorType: MonitorType | undefined;
  }) => boolean;
  // The error of the step's result, on a probe that cannot.
  message: string;
  // What such a probe cannot do, for the log: "make one-time codes".
  cannot: string;
}

export default class ProbeStepGate {
  // Whether the probe's request declares a capability.
  public static isDeclaredByRequest(
    requestBody: unknown,
    capability: ProbeCapability,
  ): boolean {
    const capabilities: unknown =
      requestBody && typeof requestBody === "object"
        ? (requestBody as Record<string, unknown>)["probeCapabilities"]
        : undefined;

    return ProbeCapabilityUtil.has(
      ProbeCapabilityUtil.parse(capabilities),
      capability,
    );
  }

  // The steps of an item that need this.
  public static getStepsNeeding(
    item: ItemForProbe,
    need: ProbeStepNeed,
  ): Array<MonitorStep> {
    return (item.monitorSteps?.data?.monitorStepsInstanceArray || []).filter(
      (step: MonitorStep): boolean => {
        return Boolean(step) && need.isNeededBy({
          step: step,
          monitorType: item.monitorType,
        });
      },
    );
  }

  /*
   * The items to hand the probe that sent `requestBody`: all of them, when
   * it declares every need, is a global probe, or no step needs what it
   * lacks; otherwise each without its steps that do - whose results are
   * written for the probe - and none that has no step left. A step that
   * needs more than one thing the probe lacks says the first of `needs`:
   * list the need of the newest release first, so the release one update
   * goes to runs the step. Called after the items' secrets are filled in,
   * so the steps are read as they are handed over.
   */
  public static async keepStepsFromProbesTooOld<T extends ItemForProbe>(data: {
    items: Array<T>;
    probeId: ObjectID;
    requestBody: unknown;
    kind: ItemForProbeKind;
    needs: ReadonlyArray<ProbeStepNeed>;
  }): Promise<Array<T>> {
    const unmet: Array<ProbeStepNeed> = data.needs.filter(
      (need: ProbeStepNeed): boolean => {
        return !this.isDeclaredByRequest(data.requestBody, need.capability);
      },
    );

    if (unmet.length === 0) {
      return data.items;
    }

    // Each item's steps the probe cannot run, with the first need each misses.
    const keptByItem: Map<
      T,
      Array<{ step: MonitorStep; need: ProbeStepNeed }>
    > = new Map();

    for (const item of data.items) {
      const kept: Array<{ step: MonitorStep; need: ProbeStepNeed }> = [];

      for (const step of item.monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        if (!step) {
          continue;
        }

        const need: ProbeStepNeed | undefined = unmet.find(
          (candidate: ProbeStepNeed): boolean => {
            return candidate.isNeededBy({
              step: step,
              monitorType: item.monitorType,
            });
          },
        );

        if (need) {
          kept.push({ step, need });
        }
      }

      if (kept.length > 0) {
        keptByItem.set(item, kept);
      }
    }

    if (keptByItem.size === 0) {
      return data.items;
    }

    if (await this.isGlobalProbe(data.probeId)) {
      return data.items;
    }

    const handedOut: Array<T> = [];

    for (const item of data.items) {
      const kept: Array<{ step: MonitorStep; need: ProbeStepNeed }> =
        keptByItem.get(item) || [];

      if (kept.length === 0) {
        handedOut.push(item);
        continue;
      }

      for (const entry of kept) {
        await this.writeStepNotRun({
          item: item,
          step: entry.step,
          probeId: data.probeId,
          kind: data.kind,
          need: entry.need,
        });
      }

      const keptSteps: Array<MonitorStep> = kept.map(
        (entry: { step: MonitorStep }): MonitorStep => {
          return entry.step;
        },
      );

      const otherSteps: Array<MonitorStep> = (
        item.monitorSteps?.data?.monitorStepsInstanceArray || []
      ).filter((step: MonitorStep): boolean => {
        return !keptSteps.includes(step);
      });

      if (otherSteps.length > 0 && item.monitorSteps?.data) {
        item.monitorSteps.data.monitorStepsInstanceArray = otherSteps;
        handedOut.push(item);
      }
    }

    for (const need of unmet) {
      const count: number = Array.from(keptByItem.values()).filter(
        (kept: Array<{ need: ProbeStepNeed }>): boolean => {
          return kept.some((entry: { need: ProbeStepNeed }): boolean => {
            return entry.need === need;
          });
        },
      ).length;

      if (count > 0) {
        logger.debug(
          `Kept ${count} item(s) with steps the probe cannot run from probe ${data.probeId.toString()}, which does not ${need.cannot}.`,
        );
      }
    }

    return handedOut;
  }

  /*
   * The result of a step kept from a probe too old to run it, as the probe
   * would report a check that failed: an API step offline, a Synthetic or
   * Custom Code step with the sentence as its script's error (for each
   * browser and screen size it is checked on).
   */
  public static buildStepNotRun(data: {
    monitorType: MonitorType | undefined;
    step: MonitorStep;
    // The monitor's id, or a monitor test's, as the probe names it.
    monitorId: ObjectID;
    projectId: ObjectID;
    probeId: ObjectID;
    at: Date;
    // Why it did not run: the need's message.
    message: string;
  }): ProbeMonitorResponse {
    const message: string = data.message;

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
    need: ProbeStepNeed;
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
      message: data.need.message,
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
        // A monitor test's result is filed under the test it answers.
        ...(data.kind === ItemForProbeKind.MonitorTest
          ? { testId: data.item.id.toString() }
          : {}),
        receivedAt: now,
      });
    } catch (err) {
      logger.error(
        `Could not write that ${data.kind} ${data.item.id.toString()} did not run on probe ${data.probeId.toString()}, which does not ${data.need.cannot}.`,
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
   * Read only when a probe that lacks what a step needs is handed one - a
   * custom probe older than the release that brought it, or a global probe
   * mid-update - so it costs nothing on any other request.
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

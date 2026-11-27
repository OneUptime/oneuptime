import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import MonitorAutoResolveTemplates, {
  MonitorAutoResolveTemplateIds,
} from "../../../Utils/Monitor/MonitorAutoResolveTemplates";
import CaptureSpan from "../Telemetry/CaptureSpan";
import MonitorTurnedOff, {
  MonitorTurnedOffRecordKind,
  MonitorTurnedOffResult,
} from "./MonitorTurnedOff";

/*
 * WHAT A MONITOR'S OLD CRITERIA LEAVE OPEN WHEN A TEMPLATE TAKES THEM OFF IT
 * (OneUptime issues #11260, #11266).
 *
 * An incident or alert a criteria opened, set to resolve on its own once the
 * monitor recovers, is resolved by a check that no longer meets that
 * criteria - matched by the criteria's id. Two changes take a monitor's
 * criteria off it:
 *
 *   - linking it to another template with that template's settings: the
 *     template's criteria replace the monitor's (MonitorTemplateService
 *     .linkMonitor);
 *   - unlinking it and clearing the template's settings: its criteria are
 *     removed, and it raises nothing until it is linked again
 *     (MonitorTemplateService.unlinkMonitor).
 *
 * Nothing could resolve what the removed criteria opened, then: it stayed
 * open for good, on Active Incidents and Active Alerts - the "still firing"
 * of #11266. So the change resolves it, exactly as turning a monitor's
 * monitoring off does (MonitorTurnedOff, #6400): what a check that no longer
 * met those criteria would have resolved, and nothing else - an incident a
 * person declared, or one whose criteria has auto-resolve off, stays open
 * for a person to close. A criteria the new steps keep, by its id, goes on
 * resolving its own records. Each resolve says why on its timeline, in a
 * note of OneUptime's own (StatusChangeNotes), and is credited to nobody.
 *
 * One record that fails to resolve is logged and does not stop the others;
 * nothing here fails the change.
 */

export enum CriteriaReplacedBecause {
  // Linked to another template, whose criteria replaced the monitor's.
  LinkedToTemplate = "LinkedToTemplate",
  // Unlinked from its template, and the template's criteria cleared.
  ClearedOnUnlink = "ClearedOnUnlink",
}

export default class MonitorCriteriaReplaced {
  /*
   * Why the record was resolved, on its timeline and in its feed: Markdown,
   * with the monitor's and the template's names placed as text (mdText).
   */
  public static getRootCause(data: {
    kind: MonitorTurnedOffRecordKind;
    because: CriteriaReplacedBecause;
    monitorName: string;
    templateName: string;
  }): string {
    if (data.because === CriteriaReplacedBecause.LinkedToTemplate) {
      return (
        data.kind === "incident"
          ? mdText`The monitor **${data.monitorName}** was linked to the template **${data.templateName}**, and its criteria replaced the ones that opened this incident. This incident was set to resolve on its own once the monitor recovered, and nothing can resolve it now that those criteria are gone, so it was resolved now. If the problem is still there, the monitor's new criteria open a new incident.`
          : mdText`The monitor **${data.monitorName}** was linked to the template **${data.templateName}**, and its criteria replaced the ones that opened this alert. This alert was set to resolve on its own once the monitor recovered, and nothing can resolve it now that those criteria are gone, so it was resolved now. If the problem is still there, the monitor's new criteria open a new alert.`
      ).toString();
    }

    return (
      data.kind === "incident"
        ? mdText`The monitor **${data.monitorName}** was unlinked from the template **${data.templateName}**, and the template's criteria were cleared from it. This incident was set to resolve on its own once the monitor recovered, and nothing can resolve it now that those criteria are gone, so it was resolved now.`
        : mdText`The monitor **${data.monitorName}** was unlinked from the template **${data.templateName}**, and the template's criteria were cleared from it. This alert was set to resolve on its own once the monitor recovered, and nothing can resolve it now that those criteria are gone, so it was resolved now.`
    ).toString();
  }

  /*
   * Resolves the open incidents and alerts the criteria `stepsBefore` had
   * and `stepsAfter` no longer has would have resolved on their own. Called
   * once the change is written.
   */
  @CaptureSpan()
  public static async resolveWhatRemovedCriteriaLeftOpen(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
    monitorName: string;
    templateName: string;
    stepsBefore: MonitorSteps | null | undefined;
    stepsAfter: MonitorSteps | null | undefined;
    because: CriteriaReplacedBecause;
  }): Promise<MonitorTurnedOffResult> {
    const templateIds: MonitorAutoResolveTemplateIds =
      MonitorAutoResolveTemplates.ofCriteriaRemoved({
        before: data.stepsBefore,
        after: data.stepsAfter,
      });

    if (MonitorAutoResolveTemplates.isEmpty(templateIds)) {
      return { resolvedIncidentIds: [], resolvedAlertIds: [] };
    }

    const monitor: Monitor = new Monitor();
    monitor.id = data.monitorId;
    monitor.projectId = data.projectId;
    monitor.name = data.monitorName;

    return await MonitorTurnedOff.resolveWhatItWouldResolve({
      monitor: monitor,
      templateIds: templateIds,
      why:
        data.because === CriteriaReplacedBecause.LinkedToTemplate
          ? "after its template's criteria replaced its own"
          : "after its template's criteria were cleared from it",
      getRootCause: async (kind: MonitorTurnedOffRecordKind): Promise<string> => {
        return MonitorCriteriaReplaced.getRootCause({
          kind: kind,
          because: data.because,
          monitorName: data.monitorName,
          templateName: data.templateName,
        });
      },
    });
  }
}

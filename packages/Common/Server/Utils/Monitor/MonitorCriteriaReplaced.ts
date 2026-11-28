import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import MonitorAutoResolveTemplates, {
  MonitorAutoResolveTemplateIds,
} from "../../../Utils/Monitor/MonitorAutoResolveTemplates";
import MonitorTemplateChangeProvenance from "../../../Utils/Monitor/MonitorTemplateChangeProvenance";
import UserService from "../../Services/UserService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import MonitorTurnedOff, {
  MonitorTurnedOffRecordKind,
  MonitorTurnedOffResult,
} from "./MonitorTurnedOff";
import { AsyncLocalStorage } from "async_hooks";

/*
 * WHAT A MONITOR'S OLD CRITERIA LEAVE OPEN WHEN A WRITE TAKES THEM OFF IT
 * (OneUptime issues #11260, #11266, #11453).
 *
 * An incident or alert a criteria opened, set to resolve on its own once the
 * monitor recovers, is resolved by a check that no longer meets that
 * criteria - matched by the criteria's id. A write that takes the criteria
 * off the monitor leaves nothing that could ever resolve it, and it stayed
 * open for good, on Active Incidents and Active Alerts - the "still firing"
 * of #11266. Every write that does so is one of four:
 *
 *   - linking the monitor to another template with that template's
 *     settings: the template's criteria replace the monitor's
 *     (MonitorTemplateService.linkMonitor, a Move to Another Template, a
 *     network alert policy moving its monitors to the template it names);
 *   - unlinking it and clearing the template's settings: its criteria are
 *     removed (MonitorTemplateService.unlinkMonitor);
 *   - syncing its template's criteria to it, when the template no longer has
 *     the criteria (Sync Criteria to Linked Monitors, Sync from Template);
 *   - any other change of its criteria: a person's edit, the API,
 *     Terraform, a workflow.
 *
 * All four are writes of the monitor's steps, so all four are handled in one
 * place: MonitorService reads each monitor's steps before the write and,
 * once it is written, asks resolveAfterWrite here what the steps it wrote no
 * longer have (MonitorAutoResolveTemplates.ofCriteriaRemoved). That resolves
 * exactly what a check that no longer met those criteria would have
 * resolved, as turning a monitor's monitoring off does (MonitorTurnedOff,
 * #6400), and nothing else: an incident a person declared, or one whose
 * criteria has auto-resolve off (a person decides when that one is over),
 * stays open, and so does everything a criteria the write keeps - by its id
 * - goes on resolving itself. Each resolve says why on its timeline, in a
 * note of OneUptime's own (StatusChangeNotes), and is credited to nobody.
 *
 * WHY, AND HOW MANY. A link, an unlink and a template sync run their writes
 * within a change (withinChange): the reason and the template's name the
 * note gives, and a count of what the writes resolved, for the summary the
 * person reads (the sync's, the change's progress). A write outside one is
 * read for its reason - a template written is a link, or an unlink - and is
 * otherwise a change of the monitor's criteria, by the person who made it
 * when a person did.
 *
 * One record that fails to resolve is logged and does not stop the others;
 * nothing here fails the write.
 */

export enum CriteriaReplacedBecause {
  // Linked to another template, whose criteria replaced the monitor's.
  LinkedToTemplate = "LinkedToTemplate",
  // Unlinked from its template, and the template's criteria cleared.
  ClearedOnUnlink = "ClearedOnUnlink",
  // Its template's criteria synced to it, without the criteria any more.
  SyncedFromTemplate = "SyncedFromTemplate",
  // Its criteria changed otherwise: a person, the API, Terraform.
  CriteriaChanged = "CriteriaChanged",
}

// What a change of criteria resolved, for the summary that counts it.
export interface CriteriaChangeResolved {
  resolvedIncidentCount: number;
  resolvedAlertCount: number;
}

// What a change of criteria says about its writes, and what they resolved.
interface CriteriaChangeScope {
  because: CriteriaReplacedBecause;
  templateName: string;
  resolvedIncidentIds: Array<string>;
  resolvedAlertIds: Array<string>;
}

const criteriaChangeScope: AsyncLocalStorage<CriteriaChangeScope> =
  new AsyncLocalStorage<CriteriaChangeScope>();

// What a write wrote to the monitor's template: its id, when it wrote one.
export interface WrittenMonitorTemplate {
  isWritten: boolean;
  // The template written; null when the write unlinks the monitor.
  id: ObjectID | null;
}

export default class MonitorCriteriaReplaced {
  /*
   * Why the record was resolved, on its timeline and in its feed: Markdown,
   * with the monitor's, the template's and the person's names placed as text
   * (mdText).
   */
  public static getRootCause(data: {
    kind: MonitorTurnedOffRecordKind;
    because: CriteriaReplacedBecause;
    monitorName: string;
    templateName: string;
    // CriteriaChanged: who changed them, when a person did.
    changedBy?: MarkdownText | undefined;
  }): string {
    const isIncident: boolean = data.kind === "incident";

    switch (data.because) {
      case CriteriaReplacedBecause.LinkedToTemplate:
        return (
          isIncident
            ? mdText`The monitor **${data.monitorName}** was linked to the template **${data.templateName}**, and its criteria replaced the ones that opened this incident. This incident was set to resolve on its own once the monitor recovered, and nothing can resolve it now that those criteria are gone, so it was resolved now. If the problem is still there, the monitor's new criteria open a new incident.`
            : mdText`The monitor **${data.monitorName}** was linked to the template **${data.templateName}**, and its criteria replaced the ones that opened this alert. This alert was set to resolve on its own once the monitor recovered, and nothing can resolve it now that those criteria are gone, so it was resolved now. If the problem is still there, the monitor's new criteria open a new alert.`
        ).toString();
      case CriteriaReplacedBecause.ClearedOnUnlink:
        return (
          isIncident
            ? mdText`The monitor **${data.monitorName}** was unlinked from the template **${data.templateName}**, and the template's criteria were cleared from it. This incident was set to resolve on its own once the monitor recovered, and nothing can resolve it now that those criteria are gone, so it was resolved now.`
            : mdText`The monitor **${data.monitorName}** was unlinked from the template **${data.templateName}**, and the template's criteria were cleared from it. This alert was set to resolve on its own once the monitor recovered, and nothing can resolve it now that those criteria are gone, so it was resolved now.`
        ).toString();
      case CriteriaReplacedBecause.SyncedFromTemplate:
        return (
          isIncident
            ? mdText`The criteria of the template **${data.templateName}** were synced to the monitor **${data.monitorName}**, and the template no longer has the criteria that opened this incident. This incident was set to resolve on its own once the monitor recovered, and nothing can resolve it now that those criteria are gone, so it was resolved now. If the problem is still there and the monitor's criteria still check for it, they open a new incident.`
            : mdText`The criteria of the template **${data.templateName}** were synced to the monitor **${data.monitorName}**, and the template no longer has the criteria that opened this alert. This alert was set to resolve on its own once the monitor recovered, and nothing can resolve it now that those criteria are gone, so it was resolved now. If the problem is still there and the monitor's criteria still check for it, they open a new alert.`
        ).toString();
      default:
        break;
    }

    if (data.changedBy && !data.changedBy.isEmpty()) {
      return (
        isIncident
          ? mdText`${data.changedBy} changed the criteria of the monitor **${data.monitorName}** and removed the ones that opened this incident. This incident was set to resolve on its own once the monitor recovered, and nothing can resolve it now that those criteria are gone, so it was resolved now. If the problem is still there and the monitor's criteria still check for it, they open a new incident.`
          : mdText`${data.changedBy} changed the criteria of the monitor **${data.monitorName}** and removed the ones that opened this alert. This alert was set to resolve on its own once the monitor recovered, and nothing can resolve it now that those criteria are gone, so it was resolved now. If the problem is still there and the monitor's criteria still check for it, they open a new alert.`
      ).toString();
    }

    return (
      isIncident
        ? mdText`The criteria of the monitor **${data.monitorName}** were changed, and the ones that opened this incident were removed. This incident was set to resolve on its own once the monitor recovered, and nothing can resolve it now that those criteria are gone, so it was resolved now. If the problem is still there and the monitor's criteria still check for it, they open a new incident.`
        : mdText`The criteria of the monitor **${data.monitorName}** were changed, and the ones that opened this alert were removed. This alert was set to resolve on its own once the monitor recovered, and nothing can resolve it now that those criteria are gone, so it was resolved now. If the problem is still there and the monitor's criteria still check for it, they open a new alert.`
    ).toString();
  }

  /*
   * Runs `run` - a link, an unlink, a template sync - as a change of
   * criteria: every write of a monitor's steps in it says `because` and the
   * template's name on what it resolves, and what they resolved is counted
   * for the change. A change inside another adds its count to the outer one
   * too.
   */
  public static async withinChange<T>(
    data: {
      because: CriteriaReplacedBecause;
      templateName: string;
    },
    run: () => Promise<T>,
  ): Promise<{ value: T } & CriteriaChangeResolved> {
    const outer: CriteriaChangeScope | undefined =
      criteriaChangeScope.getStore();

    const scope: CriteriaChangeScope = {
      because: data.because,
      templateName: data.templateName,
      resolvedIncidentIds: [],
      resolvedAlertIds: [],
    };

    const value: T = await criteriaChangeScope.run(scope, run);

    if (outer) {
      outer.resolvedIncidentIds.push(...scope.resolvedIncidentIds);
      outer.resolvedAlertIds.push(...scope.resolvedAlertIds);
    }

    return {
      value: value,
      resolvedIncidentCount: new Set<string>(scope.resolvedIncidentIds).size,
      resolvedAlertCount: new Set<string>(scope.resolvedAlertIds).size,
    };
  }

  /*
   * Why a write took criteria off a monitor: the change it runs in, when it
   * runs in one; a template it writes - a link to it, or an unlink; else a
   * change of the monitor's criteria.
   */
  public static getReasonOfWrite(data: {
    templateIdBefore: ObjectID | string | null | undefined;
    writtenTemplate: WrittenMonitorTemplate;
  }): {
    because: CriteriaReplacedBecause;
    // The template the note names, to read its name; null for none.
    templateId: ObjectID | null;
    // The change's own name for it, when the write runs in one.
    templateName?: string | undefined;
  } {
    const scope: CriteriaChangeScope | undefined =
      criteriaChangeScope.getStore();

    const templateBefore: ObjectID | null = data.templateIdBefore
      ? new ObjectID(data.templateIdBefore.toString())
      : null;

    if (scope) {
      return {
        because: scope.because,
        templateId:
          scope.because === CriteriaReplacedBecause.LinkedToTemplate
            ? data.writtenTemplate.id || templateBefore
            : templateBefore,
        templateName: scope.templateName,
      };
    }

    if (
      data.writtenTemplate.isWritten &&
      !MonitorTemplateChangeProvenance.isSameTemplate(
        templateBefore,
        data.writtenTemplate.id,
      )
    ) {
      return data.writtenTemplate.id
        ? {
            because: CriteriaReplacedBecause.LinkedToTemplate,
            templateId: data.writtenTemplate.id,
          }
        : {
            because: CriteriaReplacedBecause.ClearedOnUnlink,
            templateId: templateBefore,
          };
    }

    return {
      because: CriteriaReplacedBecause.CriteriaChanged,
      templateId: null,
    };
  }

  /*
   * Once a write of a monitor's steps is written (MonitorService
   * .onUpdateSuccess): resolves what the criteria it took off the monitor
   * opened and would have resolved on their own, says why, and counts it
   * for the change it runs in. Nothing is read when the write took no such
   * criteria off.
   */
  @CaptureSpan()
  public static async resolveAfterWrite(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
    monitorName: string;
    stepsBefore: MonitorSteps | null | undefined;
    stepsAfter: MonitorSteps | null | undefined;
    templateIdBefore: ObjectID | string | null | undefined;
    writtenTemplate: WrittenMonitorTemplate;
    // The person who made the write, when a person did.
    changedByUserId?: ObjectID | null | undefined;
    // A template's name, read by the caller (once per template per write).
    readTemplateName: (templateId: ObjectID) => Promise<string>;
  }): Promise<MonitorTurnedOffResult> {
    const templateIds: MonitorAutoResolveTemplateIds =
      MonitorAutoResolveTemplates.ofCriteriaRemoved({
        before: data.stepsBefore,
        after: data.stepsAfter,
      });

    if (MonitorAutoResolveTemplates.isEmpty(templateIds)) {
      return { resolvedIncidentIds: [], resolvedAlertIds: [] };
    }

    const reason: {
      because: CriteriaReplacedBecause;
      templateId: ObjectID | null;
      templateName?: string | undefined;
    } = this.getReasonOfWrite({
      templateIdBefore: data.templateIdBefore,
      writtenTemplate: data.writtenTemplate,
    });

    const result: MonitorTurnedOffResult =
      await this.resolveWhatRemovedCriteriaLeftOpen({
        monitorId: data.monitorId,
        projectId: data.projectId,
        monitorName: data.monitorName,
        templateIds: templateIds,
        because: reason.because,
        getTemplateName: async (): Promise<string> => {
          if (reason.templateName !== undefined) {
            return reason.templateName;
          }

          return reason.templateId
            ? await data.readTemplateName(reason.templateId)
            : "";
        },
        changedByUserId: data.changedByUserId,
      });

    const scope: CriteriaChangeScope | undefined =
      criteriaChangeScope.getStore();

    if (scope) {
      scope.resolvedIncidentIds.push(...result.resolvedIncidentIds);
      scope.resolvedAlertIds.push(...result.resolvedAlertIds);
    }

    return result;
  }

  /*
   * Resolves the open incidents and alerts of the monitor that `templateIds`
   * - the criteria a write took off it - would have resolved on their own.
   * The root cause is asked for once per kind, and only when there is
   * something of the kind to resolve: the template's name and the person's
   * are read then.
   */
  @CaptureSpan()
  public static async resolveWhatRemovedCriteriaLeftOpen(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
    monitorName: string;
    templateIds: MonitorAutoResolveTemplateIds;
    because: CriteriaReplacedBecause;
    getTemplateName: () => Promise<string>;
    changedByUserId?: ObjectID | null | undefined;
  }): Promise<MonitorTurnedOffResult> {
    if (MonitorAutoResolveTemplates.isEmpty(data.templateIds)) {
      return { resolvedIncidentIds: [], resolvedAlertIds: [] };
    }

    const monitor: Monitor = new Monitor();
    monitor.id = data.monitorId;
    monitor.projectId = data.projectId;
    monitor.name = data.monitorName;

    let templateName: string | null = null;
    let changedBy: MarkdownText | null = null;

    return await MonitorTurnedOff.resolveWhatItWouldResolve({
      monitor: monitor,
      templateIds: data.templateIds,
      why: MonitorCriteriaReplaced.describeForLog(data.because),
      getRootCause: async (
        kind: MonitorTurnedOffRecordKind,
      ): Promise<string> => {
        if (templateName === null) {
          templateName = await data.getTemplateName();
        }

        if (
          changedBy === null &&
          data.because === CriteriaReplacedBecause.CriteriaChanged
        ) {
          changedBy = data.changedByUserId
            ? await UserService.getUserMarkdownString({
                userId: data.changedByUserId,
                projectId: data.projectId,
              })
            : FeedMarkdown.empty();
        }

        return MonitorCriteriaReplaced.getRootCause({
          kind: kind,
          because: data.because,
          monitorName: data.monitorName,
          templateName: templateName,
          changedBy: changedBy || undefined,
        });
      },
    });
  }

  // How a failure's log line ends ("... failed after its criteria were changed").
  private static describeForLog(because: CriteriaReplacedBecause): string {
    switch (because) {
      case CriteriaReplacedBecause.LinkedToTemplate:
        return "after its template's criteria replaced its own";
      case CriteriaReplacedBecause.ClearedOnUnlink:
        return "after its template's criteria were cleared from it";
      case CriteriaReplacedBecause.SyncedFromTemplate:
        return "after its template's criteria were synced to it";
      default:
        return "after its criteria were changed";
    }
  }
}

import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionGap,
  AutoRemediationDecisionHelper,
  AutoRemediationDecisionMonitor,
  AutoRemediationDecisionStage,
  MAX_DECISION_MONITORS,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import { JSONArray } from "../../../Types/JSON";
import {
  KubernetesAiAccessGap,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import {
  ResourceAiAccessGap,
  ResourceAiAccessStatus,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import AutoRemediationDecisionService from "../../Services/AutoRemediationDecisionService";
import MonitorService from "../../Services/MonitorService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";

export interface AutoRemediationDecisionSubject {
  projectId: ObjectID;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  // The signal's monitors, named in the entries that ask for a link.
  monitorIds?: Array<ObjectID> | undefined;
}

/*
 * Collects what each fix path did with one incident or alert while the rule
 * engine evaluates it, and saves it as one AutoRemediationDecision when the
 * evaluation ends - however it ends. Saving is observability: it never
 * throws, and a failure to save never changes what the engine did.
 */
export default class AutoRemediationDecisionRecorder {
  private readonly subject: AutoRemediationDecisionSubject;
  private readonly entries: Array<AutoRemediationDecisionEntry> = [];
  private discarded: boolean = false;
  private monitors: Promise<Array<AutoRemediationDecisionMonitor>> | null =
    null;

  public constructor(subject: AutoRemediationDecisionSubject) {
    this.subject = subject;
  }

  public add(entry: AutoRemediationDecisionEntry): void {
    this.entries.push(entry);
  }

  public getEntries(): Array<AutoRemediationDecisionEntry> {
    return [...this.entries];
  }

  /*
   * Nothing is saved: the subject is gone (its project could not be read),
   * so there is nobody to explain anything to.
   */
  public discard(): void {
    this.discarded = true;
  }

  /*
   * The signal's monitors with their names, read once per evaluation and
   * only when an entry needs them - an entry that says the signal is linked
   * to nothing sends the reader to link its monitors. Never throws.
   */
  public async getSubjectMonitors(): Promise<
    Array<AutoRemediationDecisionMonitor>
  > {
    if (!this.monitors) {
      this.monitors = this.readSubjectMonitors();
    }

    return await this.monitors;
  }

  private async readSubjectMonitors(): Promise<
    Array<AutoRemediationDecisionMonitor>
  > {
    const ids: Array<ObjectID> = [];
    const seen: Set<string> = new Set<string>();

    for (const id of this.subject.monitorIds || []) {
      const key: string = id?.toString() || "";

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      ids.push(id);
    }

    if (ids.length === 0) {
      return [];
    }

    try {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          _id: QueryHelper.any(ids.slice(0, MAX_DECISION_MONITORS)),
          projectId: this.subject.projectId,
        },
        select: {
          _id: true,
          name: true,
        },
        limit: MAX_DECISION_MONITORS,
        skip: 0,
        props: { isRoot: true },
      });

      return monitors
        .filter((monitor: Monitor): boolean => {
          return Boolean(monitor.id);
        })
        .map((monitor: Monitor): AutoRemediationDecisionMonitor => {
          return {
            id: monitor.id!.toString(),
            name: monitor.name || "",
          };
        });
    } catch (error) {
      logger.error(
        `AutoRemediationDecisionRecorder: could not read the signal's monitors: ${error}`,
        { projectId: this.subject.projectId.toString() } as LogAttributes,
      );
      return [];
    }
  }

  // Saves what was collected as an Evaluated decision. Never throws.
  public async save(): Promise<void> {
    if (this.discarded) {
      return;
    }

    await AutoRemediationDecisionRecorder.saveDecision({
      subject: this.subject,
      stage: AutoRemediationDecisionStage.Evaluated,
      entries: this.entries,
    });
  }

  /*
   * Remediation for this signal waits for its AI investigation to settle
   * (RCA-first). Saved so the card can say so instead of nothing; the
   * evaluation that follows the investigation supersedes it. Never throws.
   */
  public static async recordWaitingForInvestigation(
    subject: AutoRemediationDecisionSubject,
  ): Promise<void> {
    await AutoRemediationDecisionRecorder.saveDecision({
      subject,
      stage: AutoRemediationDecisionStage.WaitingForInvestigation,
      entries: [],
    });
  }

  private static async saveDecision(data: {
    subject: AutoRemediationDecisionSubject;
    stage: AutoRemediationDecisionStage;
    entries: Array<AutoRemediationDecisionEntry>;
  }): Promise<void> {
    if (!data.subject.incidentId && !data.subject.alertId) {
      return;
    }

    try {
      const decision: AutoRemediationDecision = new AutoRemediationDecision();
      decision.projectId = data.subject.projectId;

      if (data.subject.incidentId) {
        decision.incidentId = data.subject.incidentId;
      } else if (data.subject.alertId) {
        decision.alertId = data.subject.alertId;
      }

      decision.stage = data.stage;
      decision.entries = data.entries.map(
        (entry: AutoRemediationDecisionEntry) => {
          return AutoRemediationDecisionHelper.toJSON(entry);
        },
      ) as JSONArray;

      await AutoRemediationDecisionService.create({
        data: decision,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `AutoRemediationDecisionRecorder: could not save the auto-remediation decision: ${error}`,
        {
          projectId: data.subject.projectId.toString(),
          incidentId: data.subject.incidentId?.toString(),
          alertId: data.subject.alertId?.toString(),
        } as LogAttributes,
      );
    }
  }

  // What blocks a cluster's fixes, in the words of its AI agent page.
  public static getClusterRemediationGaps(
    status: KubernetesClusterAiAccessStatus,
  ): Array<AutoRemediationDecisionGap> {
    return (status.gaps || [])
      .filter((gap: KubernetesAiAccessGap): boolean => {
        return gap.blocks === "remediation" || gap.blocks === "both";
      })
      .map((gap: KubernetesAiAccessGap): AutoRemediationDecisionGap => {
        return {
          code: gap.code,
          title: gap.title,
          description: gap.description,
          nextStep: gap.nextStep,
        };
      });
  }

  // What blocks a resource's fixes, in the words of its AI agent page.
  public static getResourceRemediationGaps(
    status: ResourceAiAccessStatus,
  ): Array<AutoRemediationDecisionGap> {
    return (status.gaps || [])
      .filter((gap: ResourceAiAccessGap): boolean => {
        return gap.blocksRemediation;
      })
      .map((gap: ResourceAiAccessGap): AutoRemediationDecisionGap => {
        return {
          code: gap.code,
          title: gap.title,
          nextStep: gap.nextStep,
        };
      });
  }
}

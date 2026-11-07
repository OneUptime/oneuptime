import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/WorkflowVersion";
import QueryHelper from "../Types/Database/QueryHelper";
import { lookUpWorkflowComponent } from "../Utils/AuditLog/AuditLogColumnSummaries";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  WorkflowVersionSeen,
  WorkflowVersionWrite,
  WorkflowVersionWriteKind,
  decideWorkflowVersionWrite,
  getOldestWorkflowVersionKept,
} from "../Utils/Workflow/WorkflowVersionPolicy";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { WorkflowVersionType } from "../../Types/Workflow/WorkflowVersion";
import {
  WorkflowGraphChanges,
  getWorkflowGraphChanges,
} from "../../Utils/Workflow/WorkflowGraphChanges";
import {
  SavedWorkflowGraph,
  getEmptyWorkflowGraph,
  getWorkflowGraphKey,
  toSavedWorkflowGraph,
} from "../../Utils/Workflow/WorkflowGraphSnapshot";
import crypto from "crypto";

// What a version says it changed: its lines, and how many changes there were.
export interface WorkflowVersionChanges {
  changes: Array<string>;
  changeCount: number;
}

/*
 * The versions of a workflow's graph (Types/Workflow/WorkflowVersion). Only
 * WorkflowService writes them, through the record* methods below, as
 * OneUptime, from the workflow it has just created or saved: every column's
 * create, update and delete list is empty, so no caller can add, change or
 * remove a version. They are read like the workflow they belong to
 * (CanAccessIfCanReadOn), and put back by saving their graph to the workflow,
 * which takes permission to edit it.
 *
 * Recording a version never fails the save that made it: WorkflowService
 * catches and logs whatever goes wrong here, and the workflow is saved
 * either way.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Its writes name only the workflow WorkflowService has just written and
   * the person who wrote it, so they are not checked again.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }

  /*
   * SHA-256 of the graph as getWorkflowGraphKey reads it: the same for two
   * graphs that are the same workflow drawn the same way, however their
   * cards, connections and keys are ordered and whichever card is selected.
   */
  public static getGraphFingerprint(graph: unknown): string {
    return crypto
      .createHash("sha256")
      .update(getWorkflowGraphKey(graph), "utf8")
      .digest("hex");
  }

  // What `after` changed from `before`, as a version says it.
  public static describeChanges(data: {
    before: unknown;
    after: unknown;
    includeMoves?: boolean | undefined;
  }): WorkflowVersionChanges {
    const changes: WorkflowGraphChanges = getWorkflowGraphChanges({
      before: data.before,
      after: data.after,
      lookup: lookUpWorkflowComponent,
      includeMoves: data.includeMoves ?? true,
    });

    return { changes: changes.lines, changeCount: changes.totalChanges };
  }

  /*
   * Version 1 of a workflow just created: its graph as it was created, from
   * scratch (empty), a template, an import or a copy, by whoever created it.
   */
  @CaptureSpan()
  public async recordCreated(data: {
    workflowId: ObjectID;
    projectId: ObjectID;
    graph: unknown;
    userId: ObjectID | undefined;
  }): Promise<void> {
    const graph: SavedWorkflowGraph = toSavedWorkflowGraph(data.graph);

    await this.writeVersion({
      workflowId: data.workflowId,
      projectId: data.projectId,
      versionNumber: 1,
      versionType: WorkflowVersionType.Created,
      restoredFromVersionNumber: null,
      graph,
      changes: Service.describeChanges({
        before: getEmptyWorkflowGraph(),
        after: graph,
        includeMoves: false,
      }),
      userId: data.userId,
    });
  }

  /*
   * A workflow saved before OneUptime kept versions has none. Before its
   * graph is first saved again, its graph as it is now becomes version 1
   * (Earlier), so the change about to be saved can be taken back. Who saved
   * it, and what it changed, are not known. Asked before every save of a
   * graph; does nothing for a workflow with a version. `readGraph` reads the
   * workflow's graph as it is before the save.
   */
  @CaptureSpan()
  public async recordEarlierVersionIfNone(data: {
    workflowId: ObjectID;
    projectId: ObjectID;
    readGraph: () => Promise<unknown>;
  }): Promise<void> {
    const count: number = (
      await this.countBy({
        query: { workflowId: data.workflowId },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      })
    ).toNumber();

    if (count > 0) {
      return;
    }

    await this.writeVersion({
      workflowId: data.workflowId,
      projectId: data.projectId,
      versionNumber: 1,
      versionType: WorkflowVersionType.Earlier,
      restoredFromVersionNumber: null,
      graph: toSavedWorkflowGraph(await data.readGraph()),
      changes: { changes: [], changeCount: 0 },
      userId: undefined,
    });
  }

  /*
   * A save of a workflow's graph, by `userId` (undefined: through the API
   * without a person): nothing, a new version, or the newest version taking
   * it in, as WorkflowVersionPolicy decides. Two saves of one workflow at the
   * same moment can both claim the next number; the one refused for it is
   * decided again from the version the other wrote.
   */
  @CaptureSpan()
  public async recordGraphSave(data: {
    workflowId: ObjectID;
    projectId: ObjectID;
    graph: unknown;
    userId: ObjectID | undefined;
    now?: Date | undefined;
  }): Promise<void> {
    const graph: SavedWorkflowGraph = toSavedWorkflowGraph(data.graph);
    const graphFingerprint: string = Service.getGraphFingerprint(graph);

    try {
      await this.writeGraphSave({ ...data, graph, graphFingerprint });
    } catch {
      await this.writeGraphSave({ ...data, graph, graphFingerprint });
    }
  }

  private async writeGraphSave(data: {
    workflowId: ObjectID;
    projectId: ObjectID;
    graph: SavedWorkflowGraph;
    graphFingerprint: string;
    userId: ObjectID | undefined;
    now?: Date | undefined;
  }): Promise<void> {
    const newest: Model | null = await this.findOneBy({
      query: { workflowId: data.workflowId },
      select: {
        _id: true,
        versionNumber: true,
        versionType: true,
        graphFingerprint: true,
        createdByUserId: true,
        createdAt: true,
      },
      sort: { versionNumber: SortOrder.Descending },
      props: { isRoot: true },
    });

    const newestSeen: WorkflowVersionSeen | null =
      newest && typeof newest.versionNumber === "number"
        ? {
            versionNumber: newest.versionNumber,
            versionType: newest.versionType,
            graphFingerprint: newest.graphFingerprint,
            savedByUserId: newest.createdByUserId?.toString() || null,
            createdAt: newest.createdAt
              ? OneUptimeDate.fromString(newest.createdAt)
              : undefined,
          }
        : null;

    const earlier: Model | null =
      newestSeen && newestSeen.graphFingerprint !== data.graphFingerprint
        ? await this.findOneBy({
            query: {
              workflowId: data.workflowId,
              graphFingerprint: data.graphFingerprint,
              versionNumber: QueryHelper.lessThan(newestSeen.versionNumber),
            },
            select: { versionNumber: true },
            sort: { versionNumber: SortOrder.Descending },
            props: { isRoot: true },
          })
        : null;

    const write: WorkflowVersionWrite = decideWorkflowVersionWrite({
      newest: newestSeen,
      graphFingerprint: data.graphFingerprint,
      earlierWithSameGraph:
        earlier && typeof earlier.versionNumber === "number"
          ? { versionNumber: earlier.versionNumber }
          : null,
      savedByUserId: data.userId?.toString() || null,
      now: data.now || OneUptimeDate.getCurrentDate(),
    });

    if (write.kind === WorkflowVersionWriteKind.Nothing) {
      return;
    }

    if (
      write.kind === WorkflowVersionWriteKind.TakeIntoNewest &&
      newest?.id &&
      newestSeen
    ) {
      // Its changes run from the version before it to the graph now.
      const previous: Model | null = await this.findOneBy({
        query: {
          workflowId: data.workflowId,
          versionNumber: QueryHelper.lessThan(newestSeen.versionNumber),
        },
        select: { graph: true },
        sort: { versionNumber: SortOrder.Descending },
        props: { isRoot: true },
      });

      const changes: WorkflowVersionChanges = Service.describeChanges({
        before: previous?.graph || getEmptyWorkflowGraph(),
        after: data.graph,
      });

      await this.updateOneById({
        id: newest.id,
        data: {
          graph: data.graph as unknown as JSONObject,
          graphFingerprint: data.graphFingerprint,
          changes: changes.changes,
          changeCount: changes.changeCount,
        } as never,
        props: { isRoot: true },
      });

      return;
    }

    if (write.kind !== WorkflowVersionWriteKind.Add) {
      return;
    }

    const newestGraph: unknown = newest?.id
      ? (
          await this.findOneById({
            id: newest.id,
            select: { graph: true },
            props: { isRoot: true },
          })
        )?.graph
      : getEmptyWorkflowGraph();

    await this.writeVersion({
      workflowId: data.workflowId,
      projectId: data.projectId,
      versionNumber: write.versionNumber,
      versionType: write.versionType,
      restoredFromVersionNumber: write.restoredFromVersionNumber,
      graph: data.graph,
      changes: Service.describeChanges({
        before: newestGraph || getEmptyWorkflowGraph(),
        after: data.graph,
      }),
      userId: data.userId,
    });

    await this.deleteBy({
      query: {
        workflowId: data.workflowId,
        versionNumber: QueryHelper.lessThan(
          getOldestWorkflowVersionKept(write.versionNumber),
        ),
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  }

  private async writeVersion(data: {
    workflowId: ObjectID;
    projectId: ObjectID;
    versionNumber: number;
    versionType: WorkflowVersionType;
    restoredFromVersionNumber: number | null;
    graph: SavedWorkflowGraph;
    changes: WorkflowVersionChanges;
    userId: ObjectID | undefined;
  }): Promise<void> {
    const version: Model = new Model();
    version.projectId = data.projectId;
    version.workflowId = data.workflowId;
    version.versionNumber = data.versionNumber;
    version.versionType = data.versionType;
    version.graph = data.graph as unknown as JSONObject;
    version.graphFingerprint = Service.getGraphFingerprint(data.graph);
    version.changes = data.changes.changes;
    version.changeCount = data.changes.changeCount;

    if (data.restoredFromVersionNumber !== null) {
      version.restoredFromVersionNumber = data.restoredFromVersionNumber;
    }

    if (data.userId) {
      version.createdByUserId = data.userId;
    }

    await this.create({
      data: version,
      props: { isRoot: true },
    });
  }
}

export default new Service();

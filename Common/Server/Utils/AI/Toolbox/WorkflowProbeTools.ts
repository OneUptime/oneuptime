import Probe, {
  ProbeConnectionStatus,
} from "../../../../Models/DatabaseModels/Probe";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import WorkflowLog from "../../../../Models/DatabaseModels/WorkflowLog";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import WorkflowStatus from "../../../../Types/Workflow/WorkflowStatus";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import MonitorProbeService from "../../../Services/MonitorProbeService";
import ProbeService from "../../../Services/ProbeService";
import WorkflowLogService from "../../../Services/WorkflowLogService";
import WorkflowService from "../../../Services/WorkflowService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import OneUptimeDate from "../../../../Types/Date";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * Derived from the model ACLs so the tool gates can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the model classes are fully wired up, so
 * calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedWorkflowReadPermissions: Array<Permission> | null = null;
const resolveWorkflowReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedWorkflowReadPermissions) {
      cachedWorkflowReadPermissions = new Workflow().getReadPermissions();
    }
    return cachedWorkflowReadPermissions;
  };

let cachedProbeReadPermissions: Array<Permission> | null = null;
const resolveProbeReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedProbeReadPermissions) {
      cachedProbeReadPermissions = new Probe().getReadPermissions();
    }
    return cachedProbeReadPermissions;
  };

// Run outcomes that count as a failure when summarizing recent workflow runs.
const RUN_FAILURE_STATUSES: Set<WorkflowStatus> = new Set<WorkflowStatus>([
  WorkflowStatus.Error,
  WorkflowStatus.Timeout,
  WorkflowStatus.WorkflowCountExceeded,
]);

/*
 * How many recent WorkflowLog rows to scan (one query, project-wide across the
 * listed workflows) when computing per-workflow run outcomes in list mode.
 */
const RECENT_RUNS_LOOKBACK: number = 50;

/*
 * The serializer caps every field at 500 chars but keeps the HEAD of an
 * over-long value — while a workflow run's failure prints at the END of its
 * log. Slice the tail ourselves, under the serializer's cap, so the error
 * line survives serialization.
 */
const LOG_TAIL_CHARS: number = 450;

function tailOfLog(logs: string | undefined): string | undefined {
  if (!logs) {
    return undefined;
  }
  if (logs.length <= LOG_TAIL_CHARS) {
    return logs;
  }
  return `… ${logs.slice(-1 * LOG_TAIL_CHARS)}`;
}

/*
 * Probe staleness threshold, in exact parity with the platform's own status
 * judgment: the Probe:UpdateConnectionStatus worker
 * (App/FeatureSet/Workers/Jobs/Probe/UpdateConnectionStatus.ts) marks a probe
 * Disconnected once lastAlive <= now - 3 minutes (or lastAlive was never set),
 * and the dashboard renders that stored status. Computing the same rule live
 * from lastAlive gives the identical verdict without the worker's up-to-a-
 * minute lag.
 */
const PROBE_STALE_CUTOFF_IN_MINUTES: number = 3;

interface WorkflowRunOutcome {
  lastRunStatus: string | undefined;
  lastRunAt: Date | undefined;
  recentRuns: number;
  recentFailures: number;
}

export const QueryWorkflowsTool: ObservabilityTool = {
  name: "query_workflows",
  description:
    "Query automation workflows in this project. List mode returns each workflow (name, description, enabled) with its recent run outcomes — last run status/time and how many of the recent runs failed. Pass workflowId (from the list mode `id` field) to get detail mode: the workflow plus its most recent runs (status, startedAt, completedAt, duration) including the tail of the run log for failed runs — use that to answer 'why did this workflow fail?'.",
  inputSchema: {
    type: "object",
    properties: {
      workflowId: {
        type: "string",
        description:
          "Get one workflow by its ID, with its recent runs and failure logs.",
      },
      runsLimit: {
        type: "number",
        description:
          "Detail mode only: maximum recent runs to return (default 10, max 20).",
      },
      limit: {
        type: "number",
        description: "Maximum workflows to return (default 10, max 25).",
      },
      skip: {
        type: "number",
        description:
          "List mode pagination: how many workflows to skip (default 0, max 500).",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveWorkflowReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const workflowId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "workflowId",
    );

    if (workflowId) {
      const workflow: Workflow | null = await WorkflowService.findOneById({
        id: workflowId,
        select: {
          _id: true,
          name: true,
          description: true,
          isEnabled: true,
          createdAt: true,
        },
        props: ctx.props,
      });

      if (!workflow) {
        const serializedEmpty: SerializedResult =
          ToolResultSerializer.serializeRows([]);

        return {
          dataForLlm: serializedEmpty.text,
          rowCount: serializedEmpty.rowCount,
          citationLabel: `Workflow ${workflowId.toString()}`,
          citationTarget: {
            type: AIChatCitationTargetType.WorkflowView,
            params: { workflowId: workflowId.toString() },
          },
          redactionCount: serializedEmpty.redactionCount,
          isTruncated: serializedEmpty.isTruncated,
        };
      }

      const runsLimit: number = ToolArgs.getNumber(args, "runsLimit", {
        defaultValue: 10,
        min: 1,
        max: 20,
      });

      /*
       * projectId is pinned to the tenant from ctx because workflowId is an
       * untrusted model argument — same defense-in-depth as the sibling tools.
       */
      const runs: Array<WorkflowLog> = await WorkflowLogService.findBy({
        query: {
          workflowId: workflowId,
          projectId: ctx.projectId,
        },
        select: {
          _id: true,
          workflowStatus: true,
          startedAt: true,
          completedAt: true,
          resumeAt: true,
          createdAt: true,
          logs: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: runsLimit,
        skip: 0,
        props: ctx.props,
      });

      const workflowRow: JSONObject = {
        record: "workflow",
        id: workflow.id?.toString(),
        name: workflow.name,
        description: workflow.description,
        enabled: Boolean(workflow.isEnabled),
        createdAt: workflow.createdAt,
      };

      const runRows: Array<JSONObject> = runs.map((run: WorkflowLog) => {
        const isFailedRun: boolean = run.workflowStatus
          ? RUN_FAILURE_STATUSES.has(run.workflowStatus)
          : false;

        return {
          record: "run",
          runId: run.id?.toString(),
          status: run.workflowStatus,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          durationSeconds:
            run.startedAt && run.completedAt
              ? OneUptimeDate.getDifferenceInSeconds(
                  run.completedAt,
                  run.startedAt,
                )
              : undefined,
          resumeAt: run.resumeAt,
          // Only failed runs carry log text: that is where the answer lives.
          logTail: isFailedRun ? tailOfLog(run.logs) : undefined,
        };
      });

      const rows: Array<JSONObject> = [workflowRow, ...runRows];

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `Workflow "${workflow.name}" (${runs.length} recent runs)`,
        citationTarget: {
          type: AIChatCitationTargetType.WorkflowView,
          params: { workflowId: workflowId.toString() },
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget:
          runRows.length > 0
            ? WidgetBuilder.table({
                title: `Workflow "${workflow.name}" — recent runs`,
                description: workflow.isEnabled
                  ? undefined
                  : "This workflow is disabled.",
                columns: [
                  { key: "status", title: "Status", type: "text" },
                  { key: "startedAt", title: "Started", type: "date" },
                  { key: "completedAt", title: "Completed", type: "date" },
                  {
                    key: "durationSeconds",
                    title: "Duration (s)",
                    type: "number",
                  },
                ],
                rows: runRows,
                link: {
                  type: AIChatCitationTargetType.WorkflowView,
                  params: { workflowId: workflowId.toString() },
                },
              })
            : WidgetBuilder.resourceCard({
                title: `Workflow "${workflow.name}"`,
                resourceType: "Workflow",
                heading: workflow.name || "Workflow",
                subheading: workflow.description,
                fields: [
                  {
                    label: "Enabled",
                    value: workflow.isEnabled ? "Yes" : "No",
                  },
                  { label: "Recent runs", value: "0" },
                ],
                link: {
                  type: AIChatCitationTargetType.WorkflowView,
                  params: { workflowId: workflowId.toString() },
                },
              }),
      };
    }

    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });
    const skip: number = ToolArgs.getNumber(args, "skip", {
      defaultValue: 0,
      min: 0,
      max: 500,
    });

    const workflows: Array<Workflow> = await WorkflowService.findBy({
      query: {},
      select: {
        _id: true,
        name: true,
        description: true,
        isEnabled: true,
        createdAt: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      limit: limit,
      skip: skip,
      props: ctx.props,
    });

    const totalCount: number = (
      await WorkflowService.countBy({
        query: {},
        props: ctx.props,
      })
    ).toNumber();

    /*
     * One project-wide query over the listed workflows' recent runs, grouped
     * in memory, instead of one WorkflowLog query per workflow.
     */
    const outcomes: Map<string, WorkflowRunOutcome> = new Map<
      string,
      WorkflowRunOutcome
    >();

    if (workflows.length > 0) {
      const workflowIds: Array<ObjectID> = workflows
        .map((workflow: Workflow) => {
          return workflow.id;
        })
        .filter((id: ObjectID | null | undefined): id is ObjectID => {
          return Boolean(id);
        });

      const recentLogs: Array<WorkflowLog> = await WorkflowLogService.findBy({
        query: {
          workflowId: QueryHelper.any(workflowIds),
          projectId: ctx.projectId,
        },
        select: {
          workflowId: true,
          workflowStatus: true,
          createdAt: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: RECENT_RUNS_LOOKBACK,
        skip: 0,
        props: ctx.props,
      });

      for (const log of recentLogs) {
        const key: string = log.workflowId?.toString() || "";
        if (!key) {
          continue;
        }

        let outcome: WorkflowRunOutcome | undefined = outcomes.get(key);
        if (!outcome) {
          outcome = {
            lastRunStatus: undefined,
            lastRunAt: undefined,
            recentRuns: 0,
            recentFailures: 0,
          };
          outcomes.set(key, outcome);
        }

        outcome.recentRuns += 1;
        if (
          log.workflowStatus &&
          RUN_FAILURE_STATUSES.has(log.workflowStatus)
        ) {
          outcome.recentFailures += 1;
        }
        // Logs are sorted most-recent-first: the first row seen is the last run.
        if (!outcome.lastRunStatus) {
          outcome.lastRunStatus = log.workflowStatus;
          outcome.lastRunAt = log.createdAt;
        }
      }
    }

    const rows: Array<JSONObject> = workflows.map((workflow: Workflow) => {
      const outcome: WorkflowRunOutcome | undefined = outcomes.get(
        workflow.id?.toString() || "",
      );

      return {
        id: workflow.id?.toString(),
        name: workflow.name,
        description: workflow.description,
        enabled: Boolean(workflow.isEnabled),
        lastRunStatus: outcome?.lastRunStatus,
        lastRunAt: outcome?.lastRunAt,
        recentRuns: outcome ? outcome.recentRuns : 0,
        recentFailures: outcome ? outcome.recentFailures : 0,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    let dataForLlm: string = serialized.text;
    if (totalCount > rows.length) {
      dataForLlm = `Showing rows ${skip + 1}–${skip + rows.length} of ${totalCount} total. Pass skip to page further.\n${dataForLlm}`;
    }

    return {
      dataForLlm: dataForLlm,
      rowCount: serialized.rowCount,
      citationLabel:
        totalCount > rows.length
          ? `Workflows (showing ${rows.length} of ${totalCount})`
          : `Workflows (${serialized.rowCount} found)`,
      citationTarget: {
        type: AIChatCitationTargetType.Workflows,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Workflows (${rows.length})`,
              description: `Run outcomes from the last ${RECENT_RUNS_LOOKBACK} runs across these workflows`,
              columns: [
                { key: "name", title: "Name", type: "text" },
                { key: "enabled", title: "Enabled", type: "text" },
                { key: "lastRunStatus", title: "Last run", type: "text" },
                { key: "lastRunAt", title: "Last run at", type: "date" },
                {
                  key: "recentFailures",
                  title: "Recent failures",
                  type: "number",
                },
              ],
              rows: rows,
              link: { type: AIChatCitationTargetType.Workflows },
            })
          : undefined,
    };
  },
};

export const QueryProbesTool: ObservabilityTool = {
  name: "query_probes",
  description:
    "Query monitoring probes and their health: name, description, probe version, lastAlive heartbeat, a connected/disconnected judgment (same 3-minute staleness rule the dashboard status uses) and how many of this project's monitors each probe serves. Use this when a monitor is not being checked or checks look stale — a disconnected probe that serves the monitor is the usual cause; then use query_monitors to inspect the monitor itself. Includes the platform's global probes as well as this project's custom probes.",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description:
          "Maximum probes to return per kind — custom and global (default 10, max 25).",
      },
      includeGlobalProbes: {
        type: "boolean",
        description:
          "Include the platform's global probes (default true). Set false to see only this project's custom probes.",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveProbeReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });
    const includeGlobalProbes: boolean =
      ToolArgs.getBoolean(args, "includeGlobalProbes") ?? true;

    /*
     * Never select `key` here: it is the probe's auth secret (read-restricted
     * to project owners/admins), and the global fetch below runs as root.
     */
    const probeSelect: {
      _id: boolean;
      name: boolean;
      description: boolean;
      probeVersion: boolean;
      lastAlive: boolean;
      connectionStatus: boolean;
    } = {
      _id: true,
      name: true,
      description: true,
      probeVersion: true,
      lastAlive: true,
      connectionStatus: true,
    };

    // This project's custom probes — tenant-scoped through ctx.props.
    const projectProbes: Array<Probe> = await ProbeService.findBy({
      query: {},
      select: probeSelect,
      sort: {
        name: SortOrder.Ascending,
      },
      limit: limit,
      skip: 0,
      props: ctx.props,
    });

    /*
     * Global probes have projectId = null, so the tenant-scoped query above
     * can never return them — yet they run most monitors on OneUptime Cloud.
     * Mirror the platform's own user-facing /probe/global-probes endpoint
     * (Common/Server/API/ProbeAPI.ts): root props with the query pinned to
     * isGlobalProbe: true, and a fixed select of the same non-secret columns
     * that endpoint serves to every authenticated user.
     */
    let globalProbes: Array<Probe> = [];
    if (includeGlobalProbes) {
      globalProbes = await ProbeService.findBy({
        query: {
          isGlobalProbe: true,
        },
        select: probeSelect,
        sort: {
          name: SortOrder.Ascending,
        },
        limit: limit,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    }

    const seenProbeIds: Set<string> = new Set<string>();
    const probesWithScope: Array<{ probe: Probe; isGlobal: boolean }> = [];

    for (const probe of projectProbes) {
      const id: string = probe.id?.toString() || "";
      if (!id || seenProbeIds.has(id)) {
        continue;
      }
      seenProbeIds.add(id);
      probesWithScope.push({ probe: probe, isGlobal: false });
    }

    for (const probe of globalProbes) {
      const id: string = probe.id?.toString() || "";
      if (!id || seenProbeIds.has(id)) {
        continue;
      }
      seenProbeIds.add(id);
      probesWithScope.push({ probe: probe, isGlobal: true });
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const staleCutoff: Date = OneUptimeDate.getSomeMinutesAgo(
      PROBE_STALE_CUTOFF_IN_MINUTES,
    );

    const rows: Array<JSONObject> = await Promise.all(
      probesWithScope.map(
        async (entry: { probe: Probe; isGlobal: boolean }) => {
          /*
           * Tenant-scoped: only THIS project's monitor assignments count —
           * projectId is pinned explicitly because global probes serve every
           * project on the platform.
           */
          const monitorCount: PositiveNumber =
            await MonitorProbeService.countBy({
              query: {
                probeId: entry.probe.id!,
                projectId: ctx.projectId,
              },
              props: ctx.props,
            });

          const lastAlive: Date | undefined = entry.probe.lastAlive
            ? OneUptimeDate.fromString(entry.probe.lastAlive)
            : undefined;

          /*
           * Same verdict the status worker writes: connected only when the
           * heartbeat is strictly fresher than the 3-minute cutoff. A probe
           * that never reported is disconnected.
           */
          const isConnected: boolean = lastAlive
            ? lastAlive.getTime() > staleCutoff.getTime()
            : false;

          return {
            id: entry.probe.id?.toString(),
            name: entry.probe.name,
            description: entry.probe.description,
            status: isConnected
              ? ProbeConnectionStatus.Connected
              : ProbeConnectionStatus.Disconnected,
            lastAlive: lastAlive,
            minutesSinceLastAlive: lastAlive
              ? OneUptimeDate.getDifferenceInMinutes(now, lastAlive)
              : undefined,
            probeVersion: entry.probe.probeVersion?.toString(),
            monitorsServed: monitorCount.toNumber(),
            isGlobalProbe: entry.isGlobal,
          };
        },
      ),
    );

    const disconnectedCount: number = rows.filter((row: JSONObject) => {
      return row["status"] === ProbeConnectionStatus.Disconnected;
    }).length;

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel:
        rows.length > 0
          ? `Probes (${serialized.rowCount} found, ${disconnectedCount} disconnected)`
          : "Probes (0 found)",
      citationTarget: {
        type: AIChatCitationTargetType.Probes,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Probes (${rows.length})`,
              description: `Disconnected = no heartbeat in the last ${PROBE_STALE_CUTOFF_IN_MINUTES} minutes`,
              columns: [
                { key: "name", title: "Name", type: "text" },
                { key: "status", title: "Status", type: "text" },
                { key: "lastAlive", title: "Last alive", type: "date" },
                { key: "probeVersion", title: "Version", type: "text" },
                { key: "monitorsServed", title: "Monitors", type: "number" },
                { key: "isGlobalProbe", title: "Global", type: "text" },
              ],
              rows: rows,
              link: { type: AIChatCitationTargetType.Probes },
            })
          : undefined,
    };
  },
};

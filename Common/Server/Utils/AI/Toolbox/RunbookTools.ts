import Runbook from "../../../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import { RunbookStep } from "../../../../Types/Runbook/RunbookStep";
import RunbookService from "../../../Services/RunbookService";
import RunbookExecutionService from "../../../Services/RunbookExecutionService";
import logger from "../../Logger";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the Runbook model class is fully wired up,
 * so calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new Runbook().getReadPermissions();
    }
    return cachedReadPermissions;
  };

// How many of the runbook's latest executions the detail mode surfaces.
const RECENT_EXECUTIONS_LIMIT: number = 5;

/*
 * Runbook.steps is an unvalidated JSON column, so every field read below is
 * defensive: a hand-edited or legacy step must degrade to a partial row, not
 * throw.
 */
function configString(config: JSONObject, key: string): string {
  const value: unknown = config[key];
  return typeof value === "string" ? value : "";
}

/*
 * One human/model-readable line describing what a step actually DOES — the
 * script, command, request or prompt behind it. Long values are fine here:
 * the serializer caps each field at its per-field limit.
 */
function describeStepInstructions(step: RunbookStep): string {
  const config: JSONObject = (step.config || {}) as unknown as JSONObject;

  switch (step.type) {
    case RunbookStepType.Manual: {
      return "Manual step — a responder performs this by hand (see the step title/description).";
    }
    case RunbookStepType.JavaScript: {
      return `Runs JavaScript on a runner: ${configString(config, "script")}`;
    }
    case RunbookStepType.Bash: {
      return `Runs bash on a runner: ${configString(config, "script")}`;
    }
    case RunbookStepType.HttpRequest: {
      const body: string = configString(config, "body");
      return `HTTP ${configString(config, "method")} ${configString(config, "url")}${
        body ? ` with body: ${body}` : ""
      }`;
    }
    case RunbookStepType.AI: {
      return `AI step with prompt: ${configString(config, "prompt")}`;
    }
    case RunbookStepType.SSH: {
      return `Runs over SSH: ${configString(config, "command")}`;
    }
    case RunbookStepType.Kubernetes: {
      const replicas: unknown = config["replicas"];
      return `Kubernetes ${configString(config, "action")} on ${configString(
        config,
        "workloadKind",
      )} ${configString(config, "namespace")}/${configString(
        config,
        "workloadName",
      )}${typeof replicas === "number" ? ` (replicas: ${replicas})` : ""}`;
    }
    default: {
      // Unknown step type (newer schema than this build) — show the raw config.
      return JSON.stringify(config);
    }
  }
}

// Steps in execution order, tolerating malformed entries in the JSON column.
function parseSteps(steps: JSONArray | undefined): Array<RunbookStep> {
  const rawSteps: Array<RunbookStep> =
    (steps as unknown as Array<RunbookStep>) || [];

  return rawSteps
    .filter((step: RunbookStep) => {
      return Boolean(step) && typeof step === "object";
    })
    .slice()
    .sort((a: RunbookStep, b: RunbookStep) => {
      return (Number(a.order) || 0) - (Number(b.order) || 0);
    });
}

export const QueryRunbooksTool: ObservabilityTool = {
  name: "query_runbooks",
  description:
    "Query runbooks (predefined response/remediation procedures) in this project. Without arguments it lists runbooks with their id, name, description, step count and whether they are enabled. Pass runbookId to read one runbook's full ordered steps — each step's title, type and the exact instructions/script/command it runs — plus its recent executions (status, when, who triggered it). Use this to answer 'what does the runbook say to do?' and to find the runbookId to pass to run_runbook.",
  inputSchema: {
    type: "object",
    properties: {
      runbookId: {
        type: "string",
        description:
          "Get one runbook by its ID — returns the full ordered step content and the runbook's most recent executions. Find the id by calling this tool without arguments first.",
      },
      limit: {
        type: "number",
        description:
          "List mode: maximum runbooks to return (default 10, max 25).",
      },
      skip: {
        type: "number",
        description:
          "List mode: how many runbooks to skip, for paging through a long list (default 0).",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const runbookId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "runbookId",
    );

    if (runbookId) {
      const runbook: Runbook | null = await RunbookService.findOneById({
        id: runbookId,
        select: {
          _id: true,
          name: true,
          description: true,
          isEnabled: true,
          steps: true,
          createdAt: true,
          labels: {
            name: true,
          },
        },
        props: ctx.props,
      });

      if (!runbook) {
        const serialized: SerializedResult = ToolResultSerializer.serializeRows(
          [],
        );

        return {
          dataForLlm: serialized.text,
          rowCount: serialized.rowCount,
          citationLabel: `Runbook ${runbookId.toString()}`,
          citationTarget: {
            type: AIChatCitationTargetType.RunbookView,
            params: { runbookId: runbookId.toString() },
          },
          redactionCount: serialized.redactionCount,
          isTruncated: serialized.isTruncated,
        };
      }

      const steps: Array<RunbookStep> = parseSteps(runbook.steps);

      const labels: string = (runbook.labels || [])
        .map((label: { name?: string }) => {
          return label.name || "";
        })
        .filter((value: string) => {
          return value.length > 0;
        })
        .join(", ");

      /*
       * Recent executions are fetched best-effort: RunbookExecution has its
       * own read ACL (ReadRunbookExecution vs ReadRunbook), so a user who can
       * read the runbook may still be denied its executions. The steps — the
       * reason this tool exists — must not be lost to that.
       */
      let executions: Array<RunbookExecution> = [];
      try {
        executions = await RunbookExecutionService.findBy({
          query: {
            runbookId: runbookId,
            /*
             * runbookId is an untrusted model argument, so the tenant is
             * pinned from ctx — same as IncidentTools' owner-table queries.
             */
            projectId: ctx.projectId,
          },
          select: {
            _id: true,
            status: true,
            createdAt: true,
            startedAt: true,
            completedAt: true,
            failureReason: true,
            triggeredByUser: {
              name: true,
            },
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
          limit: RECENT_EXECUTIONS_LIMIT,
          skip: 0,
          props: ctx.props,
        });
      } catch (error) {
        logger.debug(`query_runbooks: executions fetch skipped: ${error}`);
      }

      /*
       * One record list with a `section` discriminator: the runbook header,
       * then its steps in execution order, then the latest executions. The
       * model reads it top-to-bottom the way a responder reads the runbook.
       */
      const stepRows: Array<JSONObject> = steps.map(
        (step: RunbookStep, index: number) => {
          return {
            section: "step",
            stepNumber: index + 1,
            title: step.title,
            type: step.type,
            description: step.description,
            instructions: describeStepInstructions(step),
            requireApproval: step.requireApproval === true ? true : undefined,
            continueOnFailure:
              step.continueOnFailure === true ? true : undefined,
          };
        },
      );

      const executionRows: Array<JSONObject> = executions.map(
        (execution: RunbookExecution) => {
          return {
            section: "recent_execution",
            executionId: execution.id?.toString(),
            status: execution.status,
            triggeredBy:
              execution.triggeredByUser?.name?.toString() || "Automation",
            createdAt: execution.createdAt,
            startedAt: execution.startedAt,
            completedAt: execution.completedAt,
            failureReason: execution.failureReason,
          };
        },
      );

      const rows: Array<JSONObject> = [
        {
          section: "runbook",
          id: runbook.id?.toString(),
          name: runbook.name,
          description: runbook.description,
          enabled: runbook.isEnabled !== false,
          stepCount: steps.length,
          labels: labels || undefined,
          createdAt: runbook.createdAt,
        },
        ...stepRows,
        ...executionRows,
      ];

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      const runbookIdString: string = runbookId.toString();

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `Runbook "${runbook.name}" (${steps.length} step${
          steps.length === 1 ? "" : "s"
        })`,
        citationTarget: {
          type: AIChatCitationTargetType.RunbookView,
          params: { runbookId: runbookIdString },
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget:
          stepRows.length > 0
            ? WidgetBuilder.table({
                title: `Runbook: ${runbook.name}`,
                description: runbook.description,
                columns: [
                  { key: "stepNumber", title: "#", type: "number" },
                  { key: "title", title: "Step", type: "text" },
                  { key: "type", title: "Type", type: "text" },
                  { key: "instructions", title: "Instructions", type: "text" },
                ],
                rows: stepRows,
                link: {
                  type: AIChatCitationTargetType.RunbookView,
                  params: { runbookId: runbookIdString },
                },
              })
            : WidgetBuilder.resourceCard({
                title: "Runbook",
                resourceType: "Runbook",
                heading: runbook.name || "Runbook",
                subheading:
                  runbook.isEnabled !== false ? "Enabled" : "Disabled",
                fields: [
                  { label: "Description", value: runbook.description || "—" },
                  { label: "Steps", value: "0" },
                ],
                link: {
                  type: AIChatCitationTargetType.RunbookView,
                  params: { runbookId: runbookIdString },
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

    const runbooks: Array<Runbook> = await RunbookService.findBy({
      query: {},
      select: {
        _id: true,
        name: true,
        description: true,
        isEnabled: true,
        steps: true,
        createdAt: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      limit: limit,
      skip: skip,
      props: ctx.props,
    });

    const totalCountPositive: PositiveNumber = await RunbookService.countBy({
      query: {},
      props: ctx.props,
    });
    const totalCount: number = totalCountPositive.toNumber();

    const rows: Array<JSONObject> = runbooks.map((runbook: Runbook) => {
      return {
        id: runbook.id?.toString(),
        name: runbook.name,
        description: runbook.description,
        stepCount: parseSteps(runbook.steps).length,
        enabled: runbook.isEnabled !== false,
        createdAt: runbook.createdAt,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    // Tell the model it is looking at one page of a longer list.
    const isPaged: boolean = rows.length > 0 && totalCount > rows.length;
    const pagingPrefix: string = isPaged
      ? `Showing rows ${skip + 1}–${skip + rows.length} of ${totalCount} total. Pass skip to page further.\n`
      : "";

    return {
      dataForLlm: `${pagingPrefix}${serialized.text}`,
      rowCount: serialized.rowCount,
      citationLabel: isPaged
        ? `Runbooks (${rows.length} of ${totalCount})`
        : `Runbooks (${serialized.rowCount} found)`,
      citationTarget: {
        type: AIChatCitationTargetType.Runbooks,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Runbooks (${rows.length})`,
              description: isPaged
                ? `Showing ${rows.length} of ${totalCount} runbooks`
                : undefined,
              columns: [
                { key: "name", title: "Name", type: "text" },
                { key: "stepCount", title: "Steps", type: "number" },
                { key: "enabled", title: "Enabled", type: "text" },
                { key: "description", title: "Description", type: "text" },
              ],
              rows: rows,
              link: { type: AIChatCitationTargetType.Runbooks },
            })
          : undefined,
    };
  },
};

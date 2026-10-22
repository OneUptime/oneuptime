import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import { InvestigationEvidenceRowsResponse } from "../../../../Types/AI/InvestigationEvidence";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import AIToolbox, { ToolCallOutcome } from "../Toolbox/Index";
import { ObservabilityTool, ToolExecutionResult } from "../Toolbox/ToolTypes";
import {
  InvestigationToolCallRecord,
  findInvestigationToolCall,
  isRerunnableEvidenceTool,
} from "./InvestigationEvidence";

/*
 * "Load rows" behind an AI report's citation, for every card that lists
 * the evidence of a run: an incident's or alert's AI card
 * (POST /ai-investigation/evidence) and a security case's
 * (POST /security-case/:caseId/ai-triage/evidence). Kept apart from the
 * routes, which register themselves when their module loads.
 */

// Plain-text rows returned by the evidence route are clipped to this size.
export const MAX_EVIDENCE_TEXT_LENGTH: number = 20000;

/*
 * The original arguments of a cited tool call, with its time window pinned to
 * when the investigation ran: a tool whose schema accepts endTime (or atTime)
 * but whose call omitted it defaulted to "now" at investigation time, so the
 * re-run passes that moment explicitly. Returns a copy; the event's JSON is
 * never mutated.
 */
export function pinEvidenceArgumentsToInvestigationTime(data: {
  tool: ObservabilityTool;
  rawArguments: JSONObject;
  investigatedAt: Date | undefined;
}): { args: JSONObject; isPinnedToInvestigationTime: boolean } {
  const args: JSONObject = { ...data.rawArguments };

  const schemaProperties: unknown = data.tool.inputSchema?.["properties"];
  const properties: JSONObject =
    schemaProperties &&
    typeof schemaProperties === "object" &&
    !Array.isArray(schemaProperties)
      ? (schemaProperties as JSONObject)
      : {};

  const hasArgument: (key: string) => boolean = (key: string): boolean => {
    const value: unknown = args[key];
    return typeof value === "string" && value.trim().length > 0;
  };

  let isPinnedToInvestigationTime: boolean = false;

  for (const timeKey of ["endTime", "atTime"]) {
    if (!Object.prototype.hasOwnProperty.call(properties, timeKey)) {
      continue;
    }

    if (!hasArgument(timeKey) && data.investigatedAt) {
      args[timeKey] = data.investigatedAt.toISOString();
    }

    if (hasArgument(timeKey)) {
      isPinnedToInvestigationTime = true;
    }
  }

  return { args, isPinnedToInvestigationTime };
}

/*
 * Re-runs the query behind one citation ([C#]) of a run, from the run's own
 * recorded events, under the VIEWER's tenant-pinned props: the rows a
 * "Load rows" shows. Only a read-only toolbox tool is re-run, with the
 * arguments it ran with (its end time pinned to when it ran, where it takes
 * one). The caller has already checked the viewer may read the run's
 * subject and that the run is that subject's; the events are the run's,
 * read as root. Shared by an incident's or alert's AI card and a security
 * case's (SecurityCaseAPI).
 */
export async function rerunInvestigationEvidence(data: {
  events: Array<AIRunEvent>;
  citationId: string;
  tenantId: ObjectID;
  viewerProps: DatabaseCommonInteractionProps;
}): Promise<InvestigationEvidenceRowsResponse> {
  const { citationId } = data;

  const toolCall: InvestigationToolCallRecord | null =
    findInvestigationToolCall({ events: data.events, citationId });

  if (!toolCall) {
    throw new BadDataException("This evidence is no longer available.");
  }

  const tool: ObservabilityTool | undefined = AIToolbox.getToolByName(
    toolCall.item.toolName,
  );

  // Re-checked here rather than trusted from the item: defense in depth.
  if (
    !tool ||
    !toolCall.item.canLoadRows ||
    !isRerunnableEvidenceTool(toolCall.item.toolName)
  ) {
    throw new BadDataException("This evidence can't be re-run.");
  }

  const investigatedAt: Date | undefined = toolCall.item.executedAt
    ? new Date(toolCall.item.executedAt)
    : undefined;

  const pinned: { args: JSONObject; isPinnedToInvestigationTime: boolean } =
    pinEvidenceArgumentsToInvestigationTime({
      tool,
      rawArguments: toolCall.rawArguments,
      investigatedAt: toolCall.startedAt || investigatedAt,
    });

  const outcome: ToolCallOutcome = await AIToolbox.executeTool({
    name: toolCall.item.toolName,
    args: pinned.args,
    ctx: {
      projectId: data.tenantId,
      props: data.viewerProps,
    },
  });

  if (!outcome.success || !outcome.result) {
    throw new BadDataException(
      outcome.errorMessage || "This evidence could not be loaded.",
    );
  }

  const result: ToolExecutionResult = outcome.result;

  const rowsResponse: InvestigationEvidenceRowsResponse = {
    citationId,
    toolName: toolCall.item.toolName,
    label: result.citationLabel || toolCall.item.label,
    rowCount: result.rowCount,
    isTruncated: result.isTruncated,
    executedAt: OneUptimeDate.getCurrentDate().toISOString(),
    isPinnedToInvestigationTime: pinned.isPinnedToInvestigationTime,
  };

  if (result.widget) {
    // Mirror ChatAgentRunner: widgets carry their own id + citation.
    rowsResponse.widget = {
      ...result.widget,
      id: result.widget.id || "W1",
      citationId,
    };
  } else {
    const text: string = result.dataForLlm || "";

    if (text.length > MAX_EVIDENCE_TEXT_LENGTH) {
      rowsResponse.text = text.substring(0, MAX_EVIDENCE_TEXT_LENGTH);
      rowsResponse.isTruncated = true;
    } else {
      rowsResponse.text = text;
    }
  }

  if (toolCall.item.executedAt) {
    rowsResponse.investigatedAt = toolCall.item.executedAt;
  }

  return rowsResponse;
}

// The events a run's evidence is read from: the most read for one run.
export const MAX_EVIDENCE_EVENTS: number = 500;

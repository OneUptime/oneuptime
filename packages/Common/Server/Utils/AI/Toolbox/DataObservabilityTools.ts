import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import DataTableAnswerer, {
  DataTableAnswer,
  formatDataTableAnswer,
} from "../../DataObservability/DataTableAnswer";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * THE DATA OBSERVABILITY TOOLS: how OneUptime AI answers "is this table
 * fresh?" - in Ask AI, in an investigation, and in Slack and Microsoft Teams,
 * whose questions it answers with the same toolbox.
 *
 *   get_data_table_freshness    whether a watched table is fresh by its own
 *                               rhythm, when it last changed, its open
 *                               alerts, the pipelines that write it with
 *                               their latest run, and the data products it
 *                               is part of (DataTableAnswer)
 *
 * A table is named the way a person says it: schema.table, its name alone,
 * or its ID. A name several databases share answers with each, so nobody is
 * told the wrong table is fresh.
 */

// Who may read the watched tables: whoever may read a data asset.
const DATA_ASSET_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadDataAsset,
];

export const GetDataTableFreshnessTool: ObservabilityTool = {
  name: "get_data_table_freshness",
  description:
    'Whether a table Data Observability watches is fresh: fresh or late by its own learned rhythm, when it last changed and how often it usually does, its open alerts, the pipelines that write it with how their latest run went, and the data products it is part of. Pass table: its schema.table key (such as public.orders), its name alone (orders), or its ID; a name several databases share answers with each match. Answers "is the orders table fresh?", "when did it last load?" and "is the revenue data safe to use?".',
  inputSchema: {
    type: "object",
    properties: {
      table: {
        type: "string",
        description:
          "The table: schema.table (public.orders), its name alone (orders), or its ID.",
      },
    },
    required: ["table"],
  },
  requiredPermissions: DATA_ASSET_READ_PERMISSIONS,
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const reference: string = (ToolArgs.getString(args, "table") || "").trim();

    if (!reference) {
      throw new BadDataException(
        "table is required: a table's schema.table key, its name, or its ID.",
      );
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const tables: Array<DataAsset> = await DataTableAnswerer.findTables(
      ctx.projectId,
      reference,
    );
    const answers: Array<DataTableAnswer> = [];

    for (const table of tables) {
      const answer: DataTableAnswer | null = await DataTableAnswerer.answer(
        ctx.projectId,
        table.id!,
        now,
      );

      if (answer) {
        answers.push(answer);
      }
    }

    const text: string =
      answers.length === 0
        ? `No table Data Observability watches is called "${reference}". Data Observability watches the tables of the databases connected to it: list them under Data Observability > Tables.`
        : [
            answers.length > 1
              ? `${answers.length} watched tables are called "${reference}":`
              : "",
            ...answers.map((answer: DataTableAnswer): string => {
              return `${answers.length > 1 ? "- " : ""}${formatDataTableAnswer(answer, now)}`;
            }),
          ]
            .filter(Boolean)
            .join("\n");
    const serialized: SerializedResult = ToolResultSerializer.serializeText(
      text,
      answers.length,
    );
    const only: DataTableAnswer | undefined =
      answers.length === 1 ? answers[0] : undefined;

    return {
      dataForLlm: serialized.text,
      rowCount: answers.length,
      citationLabel: only
        ? `Data table ${only.table}`
        : `Data tables called "${reference}" - ${answers.length} found`,
      ...(only
        ? {
            citationTarget: {
              type: AIChatCitationTargetType.DataTableView,
              params: { dataAssetId: only.dataAssetId },
            },
          }
        : {}),
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
    };
  },
};

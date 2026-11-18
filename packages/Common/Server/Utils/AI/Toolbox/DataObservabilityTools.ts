import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import OneUptimeDate from "../../../../Types/Date";
import { readDataLineageDepth } from "../../../../Types/DataObservability/DataTableLineage";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import DataTableAnswerer, {
  DataTableAnswer,
  formatDataTableAnswer,
} from "../../DataObservability/DataTableAnswer";
import DataTableLineageAnswerer, {
  DataTableLineageAnswer,
  formatDataTableLineageReply,
} from "../../DataObservability/DataTableLineageAnswer";
import DataObservabilityReadScope, {
  DataObservabilityScope,
} from "../../DataObservability/DataObservabilityReadScope";
import DataAlertLineageReader from "../../DataObservability/DataAlertLineage";
import DataTableLineageReader, {
  DataLineageNamed,
  DataLineageReadable,
} from "../../DataObservability/DataTableLineage";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

import { AI_TOOL_CITATIONS } from "../../../../Types/AI/AIReadTableWords";
import { citationSentence, countFigure } from "./ReadTableWords";
/*
 * THE DATA OBSERVABILITY TOOLS: how OneUptime AI answers "is this table
 * fresh?" and "what is it built from?" - in Ask AI, in an investigation, and
 * in Slack and Microsoft Teams, whose questions it answers with the same
 * toolbox.
 *
 *   get_data_table_freshness    whether a watched table is fresh by its own
 *                               rhythm, when it last changed, its open
 *                               alerts, the pipelines that write it with
 *                               their latest run, and the data products it
 *                               is part of (DataTableAnswer)
 *   get_data_table_lineage      what a watched table is built from and what
 *                               is built from it, up to five steps each
 *                               way: the tables that are late, dropped, have
 *                               open alerts or whose pipeline failed,
 *                               nearest first, then the rest, the pipelines
 *                               that load it from outside, and the
 *                               dashboards built on it (DataTableLineageAnswer)
 *
 * A table is named the way a person says it: schema.table, its name alone,
 * or its ID. A name several databases share answers with each, so nobody is
 * told the wrong table is fresh.
 *
 * Each tells only of the tables and pipelines its caller may read
 * (getToolReadScope): a person's own, and an investigation's - read as
 * root, for everyone who may see its alert - none an owner or a label sets
 * apart (#9562).
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

// What a tool reads of the tables and pipelines, and what its alert names besides.
interface ToolReadScope {
  scope: DataObservabilityScope;
  named: DataLineageNamed | undefined;
}

/*
 * What a tool tells of the tables and pipelines (#6553, #9526, #9562):
 *
 *   - a person, or an API key, what their own grants read: a role limited
 *     to what its members own, or to some labels, is told only of those,
 *     as on Data Observability's own routes;
 *   - a run of OneUptime's own, read as root - an investigation - what
 *     nobody in particular may read: none an owner or a label sets apart,
 *     beside what the alert it investigates names itself. Its report goes
 *     where everyone who may see that alert reads it, as the context it
 *     starts from was read (DataAlertContext).
 */
async function getToolReadScope(ctx: ToolContext): Promise<ToolReadScope> {
  if (!ctx.props.isRoot) {
    return {
      scope: await DataObservabilityReadScope.get(ctx.projectId, ctx.props),
      named: undefined,
    };
  }

  return {
    scope: DataObservabilityReadScope.nobodyInParticular(ctx.projectId),
    named: ctx.subjectAlertId
      ? await DataAlertLineageReader.readNamed(
          ctx.projectId,
          ctx.subjectAlertId,
        )
      : undefined,
  };
}

/*
 * Of the tables a name matches, the ones the tool may tell of (#6553,
 * #9526, #9562) - never that another table of that name is there.
 */
async function readableTables(data: {
  tables: Array<DataAsset>;
  readable: DataLineageReadable | null;
}): Promise<Array<DataAsset>> {
  if (!data.readable || data.tables.length === 0) {
    return data.tables;
  }

  const readableIds: Set<string> = await data.readable.readableTableIds(
    data.tables
      .map((table: DataAsset): string => {
        return table.id?.toString() || "";
      })
      .filter(Boolean),
  );

  return data.tables.filter((table: DataAsset): boolean => {
    return readableIds.has(table.id?.toString() || "");
  });
}

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
    const { scope, named }: ToolReadScope = await getToolReadScope(ctx);
    const readable: DataLineageReadable | null =
      DataTableLineageReader.getNamedReadable(scope, named);
    const tables: Array<DataAsset> = await readableTables({
      tables: await DataTableAnswerer.findTables(ctx.projectId, reference),
      readable,
    });
    const answers: Array<DataTableAnswer> = [];

    for (const table of tables) {
      /*
       * Its alerts as the caller may see them: a person's - in Ask AI, an
       * investigation's thread, Slack or Microsoft Teams - their own; a run
       * of OneUptime's own, read as root, none that is private
       * (DataTableAnswer). Its writers and dashboards as the tool tells of
       * tables and pipelines.
       */
      const answer: DataTableAnswer | null = await DataTableAnswerer.answer(
        ctx.projectId,
        table.id!,
        now,
        ctx.props,
        readable,
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
      // In the reader's language (issue #8311).
      ...(only
        ? citationSentence(AI_TOOL_CITATIONS.dataTable, { table: only.table })
        : citationSentence(AI_TOOL_CITATIONS.dataTables, {
            reference,
            count: countFigure(answers.length),
          })),
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

export const GetDataTableLineageTool: ObservabilityTool = {
  name: "get_data_table_lineage",
  description:
    'What a table Data Observability watches is built from and what is built from it, several steps each way, with how each table is now: the tables upstream and downstream that are late, dropped, have open alerts, or whose pipeline failed its last run - nearest first, with how many steps away and the tables between - then the rest, the pipelines that load the upstream tables from outside what OneUptime watches with their latest run, and the BI dashboards built on it. Pass table: its schema.table key (such as public.orders), its name alone (orders), or its ID; and depth: the steps each way, 1 to 5 (default 3). A name several databases share answers with each match. Answers "what feeds the revenue table?", "is the orders table late because of something upstream?" and "what breaks if raw.orders stops loading?".',
  inputSchema: {
    type: "object",
    properties: {
      table: {
        type: "string",
        description:
          "The table: schema.table (public.orders), its name alone (orders), or its ID.",
      },
      depth: {
        type: "number",
        description:
          "How many steps each way (default 3, max 5). Ask with more when the answer says the lineage goes on.",
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
    const { scope, named }: ToolReadScope = await getToolReadScope(ctx);
    /*
     * Its tables' open alerts as the caller may see them: a person's - in
     * Ask AI, an investigation's thread, Slack or Microsoft Teams - their
     * own; a run of OneUptime's own, read as root, none that is private
     * (DataTableLineageAnswer). Its tables and pipelines as the tool tells
     * of them: an investigation's, none set apart (#9562).
     */
    const answers: Array<DataTableLineageAnswer> =
      await DataTableLineageAnswerer.answer({
        projectId: ctx.projectId,
        reference,
        depth: readDataLineageDepth(args["depth"]),
        now,
        reader: ctx.props,
        scope,
        named,
      });
    const serialized: SerializedResult = ToolResultSerializer.serializeText(
      formatDataTableLineageReply({ reference, answers, now }),
      answers.length,
    );
    const only: DataTableLineageAnswer | undefined =
      answers.length === 1 ? answers[0] : undefined;

    return {
      dataForLlm: serialized.text,
      rowCount: answers.length,
      ...(only
        ? citationSentence(AI_TOOL_CITATIONS.lineageOf, { name: only.name })
        : citationSentence(AI_TOOL_CITATIONS.lineageOfTables, {
            reference,
            count: countFigure(answers.length),
          })),
      ...(only?.dataAssetId
        ? {
            citationTarget: {
              type: AIChatCitationTargetType.DataTableLineageView,
              params: { dataAssetId: only.dataAssetId },
            },
          }
        : {}),
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
    };
  },
};

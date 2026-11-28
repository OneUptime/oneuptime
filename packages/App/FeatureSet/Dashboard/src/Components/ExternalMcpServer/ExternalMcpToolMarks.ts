import ExternalMcpToolReadOnlyMark from "Common/Models/DatabaseModels/ExternalMcpToolReadOnlyMark";
import { ExternalMcpServerTool } from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerTool";
import {
  ExternalMcpToolReadOnlyStatus,
  canExternalMcpToolBeMarked,
  getExternalMcpToolReadOnlyStatus,
} from "Common/Types/AI/ExternalMcpServer/ExternalMcpToolReadOnlyMark";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { EXTERNAL_MCP_TOOL_MARK_COPY } from "./ExternalMcpServerCopy";

/*
 * A PROJECT ADMIN'S READ-ONLY MARKS ON A SERVER'S TOOLS, as its page reads
 * and writes them (issue #11081): who may mark, the marks of a server, one
 * mark made or taken away, and each tool's row - its status by the
 * server's word and the marks, as OneUptime AI's runs work it out
 * (getExternalMcpToolReadOnlyStatus), and whether it can be marked now.
 *
 * Marking goes through the mark's own create, one tool a request: the
 * server takes the tool's definition from what it last read, and refuses
 * anyone but a Project Owner or Admin signed in (ExternalMcpToolReadOnlyMarkService).
 *
 * React-free so its tests read it without a browser.
 */

// What a page reads of a mark: the tool, the definition it holds, who and when.
export const EXTERNAL_MCP_TOOL_MARK_SELECT: {
  _id: true;
  toolName: true;
  toolFingerprint: true;
  createdAt: true;
  createdByUser: { name: true; email: true };
} = {
  _id: true,
  toolName: true,
  toolFingerprint: true,
  createdAt: true,
  createdByUser: { name: true, email: true },
};

export interface ExternalMcpToolRow {
  tool: ExternalMcpServerTool;
  status: ExternalMcpToolReadOnlyStatus;
  // The tool's newest mark, when it has one (held or lapsed).
  mark?: ExternalMcpToolReadOnlyMark | undefined;
  // A Project Admin may mark it now (the server says nothing, nothing refuses it).
  canBeMarked: boolean;
}

function getTime(mark: ExternalMcpToolReadOnlyMark): number {
  const createdAt: Date | undefined = mark.createdAt
    ? new Date(mark.createdAt)
    : undefined;

  return createdAt && !isNaN(createdAt.getTime()) ? createdAt.getTime() : 0;
}

/*
 * Each tool with its status and newest mark, in the server's order: the
 * same status a run works out, from the tools as OneUptime last read them.
 */
export function getExternalMcpToolRows(data: {
  tools: Array<ExternalMcpServerTool>;
  marks?: Array<ExternalMcpToolReadOnlyMark> | undefined;
}): Array<ExternalMcpToolRow> {
  const marksByTool: Map<string, Array<ExternalMcpToolReadOnlyMark>> = new Map<
    string,
    Array<ExternalMcpToolReadOnlyMark>
  >();

  for (const mark of data.marks || []) {
    if (!mark.toolName) {
      continue;
    }

    const forTool: Array<ExternalMcpToolReadOnlyMark> =
      marksByTool.get(mark.toolName) || [];
    forTool.push(mark);
    marksByTool.set(mark.toolName, forTool);
  }

  return data.tools.map((tool: ExternalMcpServerTool): ExternalMcpToolRow => {
    const marks: Array<ExternalMcpToolReadOnlyMark> = (
      marksByTool.get(tool.name) || []
    )
      .slice()
      .sort(
        (
          left: ExternalMcpToolReadOnlyMark,
          right: ExternalMcpToolReadOnlyMark,
        ): number => {
          return getTime(right) - getTime(left);
        },
      );

    const forStatus: Array<{ toolFingerprint: string | undefined }> = marks.map(
      (mark: ExternalMcpToolReadOnlyMark) => {
        return { toolFingerprint: mark.toolFingerprint };
      },
    );

    const status: ExternalMcpToolReadOnlyStatus =
      getExternalMcpToolReadOnlyStatus({ tool, marks: forStatus });

    // The mark that holds, when one does; else the newest.
    const mark: ExternalMcpToolReadOnlyMark | undefined =
      marks.find((candidate: ExternalMcpToolReadOnlyMark): boolean => {
        return Boolean(
          tool.fingerprint && candidate.toolFingerprint === tool.fingerprint,
        );
      }) || marks[0];

    return {
      tool,
      status,
      mark,
      canBeMarked: canExternalMcpToolBeMarked({ tool, marks: forStatus }),
    };
  });
}

// How many tools a Project Admin may mark now: the hint over the list counts them.
export function countExternalMcpToolsToMark(
  rows: Array<ExternalMcpToolRow>,
): number {
  return rows.filter((row: ExternalMcpToolRow): boolean => {
    return row.canBeMarked;
  }).length;
}

// How many tools the server marks as ones that may change things.
export function countExternalMcpToolsServerMarksAsChange(
  rows: Array<ExternalMcpToolRow>,
): number {
  return rows.filter((row: ExternalMcpToolRow): boolean => {
    return row.status === ExternalMcpToolReadOnlyStatus.ServerMarksChange;
  }).length;
}

/*
 * Whether the signed-in user may mark a tool, or take a mark away: whoever
 * may create marks - a Project Owner or Admin, a team's block counted.
 * Refused, the reason says who may. Nothing to say until the permission
 * snapshot has landed (offer nothing then).
 */
export function getExternalMcpToolMarkGate(): PermissionGateResult {
  return PermissionGate.checkPermissions(
    new ExternalMcpToolReadOnlyMark().getCreatePermissions(),
    {
      sentence: EXTERNAL_MCP_TOOL_MARK_COPY.refusedSentence,
    },
  );
}

// The marks of one server, newest first.
export async function readExternalMcpToolMarks(
  externalMcpServerId: ObjectID,
): Promise<Array<ExternalMcpToolReadOnlyMark>> {
  const result: ListResult<ExternalMcpToolReadOnlyMark> =
    await ModelAPI.getList({
      modelType: ExternalMcpToolReadOnlyMark,
      query: { externalMcpServerId: externalMcpServerId },
      select: EXTERNAL_MCP_TOOL_MARK_SELECT,
      limit: LIMIT_MAX,
      skip: 0,
      sort: { createdAt: SortOrder.Descending },
    });

  return result.data;
}

/*
 * Marks one tool read-only. Only the server and the tool are sent: the
 * definition the mark holds is the server's to take, from the tools it
 * last read.
 */
export async function markExternalMcpToolReadOnly(data: {
  externalMcpServerId: ObjectID;
  toolName: string;
}): Promise<void> {
  const mark: ExternalMcpToolReadOnlyMark = new ExternalMcpToolReadOnlyMark();
  mark.externalMcpServerId = data.externalMcpServerId;
  mark.toolName = data.toolName;

  await ModelAPI.create<ExternalMcpToolReadOnlyMark>({
    model: mark,
    modelType: ExternalMcpToolReadOnlyMark,
  });
}

// Takes one mark away: OneUptime AI asks about the tool again.
export async function removeExternalMcpToolMark(
  markId: ObjectID,
): Promise<void> {
  await ModelAPI.deleteItem<ExternalMcpToolReadOnlyMark>({
    modelType: ExternalMcpToolReadOnlyMark,
    id: markId,
  });
}

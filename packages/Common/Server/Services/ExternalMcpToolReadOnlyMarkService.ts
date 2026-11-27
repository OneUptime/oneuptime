import ProjectReferencesService from "./ProjectReferencesService";
import ExternalMcpServerService from "./ExternalMcpServerService";
import Model from "../../Models/DatabaseModels/ExternalMcpToolReadOnlyMark";
import ExternalMcpServer from "../../Models/DatabaseModels/ExternalMcpServer";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  ExternalMcpServerTool,
  readExternalMcpServerTools,
} from "../../Types/AI/ExternalMcpServer/ExternalMcpServerTool";
import {
  ExternalMcpToolMarkRefusal,
  ExternalMcpToolMarkRefusalKind,
  ExternalMcpToolReadOnlyStatus,
  getExternalMcpToolReadOnlyStatus,
} from "../../Types/AI/ExternalMcpServer/ExternalMcpToolReadOnlyMark";
import { MAX_EXTERNAL_MCP_TOOL_NAME_CHARS } from "../../Types/AI/ExternalMcpServer/ExternalMcpServerLimits";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";

/*
 * A Project Admin's read-only marks on external MCP servers' tools (issue
 * #11081, Models/DatabaseModels/ExternalMcpToolReadOnlyMark).
 *
 * A mark is made through the model's create - one tool, one request; there
 * is no way to mark several at once - and only:
 *
 *   - by a person signed in to OneUptime who may create marks: a Project
 *     Owner or Project Admin (the model's access rules, checked before any
 *     hook reads anything). An API key, a workflow or OneUptime itself
 *     never marks a tool: a mark is someone's word that they read the tool
 *     and it only reads;
 *   - for a server of the project the request is made in (the references
 *     are checked first, ProjectReferencesService), and a tool OneUptime has
 *     read on it;
 *   - for a tool its server says nothing about, and nothing about which
 *     says it changes something (getExternalMcpToolReadOnlyStatus);
 *   - holding the tool as OneUptime last read it: its fingerprint is taken
 *     from the server's tools here, never from the request.
 *
 * Marking a tool again - its mark lapsed when the server changed it -
 * makes a new mark, and the earlier ones of the same tool are taken away,
 * as the same person, so both are in the audit log. A mark is never
 * changed (the model allows no update).
 */

export const EXTERNAL_MCP_TOOL_MARK_NEEDS_A_PERSON_MESSAGE: string =
  "Only a person signed in to OneUptime can mark a tool read-only: an API key, a workflow or OneUptime itself cannot.";

export const EXTERNAL_MCP_TOOL_MARK_SERVER_REQUIRED_MESSAGE: string =
  "externalMcpServerId is required";

export const EXTERNAL_MCP_TOOL_MARK_TOOL_REQUIRED_MESSAGE: string =
  "toolName is required";

export const EXTERNAL_MCP_TOOL_MARK_SERVER_NOT_FOUND_MESSAGE: string =
  "MCP server not found, or you do not have access to it.";

export const getExternalMcpToolNotReadMessage: (toolName: string) => string = (
  toolName: string,
): string => {
  return `OneUptime has not read a tool named "${toolName}" on this server. Test the connection to read its tools again.`;
};

export const getExternalMcpToolReadsOnlyMessage: (
  toolName: string,
) => string = (toolName: string): string => {
  return `${toolName} needs no mark: its server marks it read-only already.`;
};

export const getExternalMcpToolServerMarksChangeMessage: (
  toolName: string,
) => string = (toolName: string): string => {
  return `${toolName} cannot be marked read-only: its server marks it as one that may change something (readOnlyHint false or destructiveHint true).`;
};

export const getExternalMcpToolNotFingerprintedMessage: (
  toolName: string,
) => string = (toolName: string): string => {
  return `Test the connection again first: OneUptime read ${toolName} before it kept what a mark holds.`;
};

// Why OneUptime never lets a tool be marked, in the words the server answers with.
export function describeExternalMcpToolMarkRefusal(data: {
  toolName: string;
  refusal: ExternalMcpToolMarkRefusal;
}): string {
  switch (data.refusal.kind) {
    case ExternalMcpToolMarkRefusalKind.NameSaysItChanges:
      return `${data.toolName} cannot be marked read-only: "${data.refusal.word}" in its name says it changes something.`;
    case ExternalMcpToolMarkRefusalKind.RunsWhatItIsGiven:
      return `${data.toolName} cannot be marked read-only: it runs what it is given in its ${data.refusal.word} argument.`;
    case ExternalMcpToolMarkRefusalKind.ArgumentCanChange:
      return data.refusal.argument
        ? `${data.toolName} cannot be marked read-only: its ${data.refusal.argument} argument can ask it to "${data.refusal.word}".`
        : `${data.toolName} cannot be marked read-only: its ${data.refusal.word} argument can make it change something.`;
  }
}

function readToolName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadDataException(EXTERNAL_MCP_TOOL_MARK_TOOL_REQUIRED_MESSAGE);
  }

  const name: string = value.trim();

  if (name.length > MAX_EXTERNAL_MCP_TOOL_NAME_CHARS) {
    throw new BadDataException(getExternalMcpToolNotReadMessage(name));
  }

  return name;
}

function readServerId(value: unknown): ObjectID {
  if (value instanceof ObjectID) {
    return value;
  }

  if (typeof value === "string" && ObjectID.isValidUUID(value)) {
    return new ObjectID(value);
  }

  if (value === undefined || value === null || value === "") {
    throw new BadDataException(EXTERNAL_MCP_TOOL_MARK_SERVER_REQUIRED_MESSAGE);
  }

  throw new BadDataException(EXTERNAL_MCP_TOOL_MARK_SERVER_NOT_FOUND_MESSAGE);
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Its refusals describe the server's tools, so whoever is answered may
   * create marks in the project - columns and all - before anything is
   * looked up.
   */
  protected override checksCreatePermissionFirst(): boolean {
    return true;
  }

  // A mark is a person's word: nobody else's write is one, root's included.
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    if (!createBy.props.userId) {
      throw new NotAuthorizedException(
        EXTERNAL_MCP_TOOL_MARK_NEEDS_A_PERSON_MESSAGE,
      );
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // The person, then the server's project, before anything of the mark's.
    const onCreate: OnCreate<Model> = await super.onBeforeCreate(createBy);

    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (!projectId) {
      throw new BadDataException(
        EXTERNAL_MCP_TOOL_MARK_SERVER_NOT_FOUND_MESSAGE,
      );
    }

    const serverId: ObjectID = readServerId(createBy.data.externalMcpServerId);
    const toolName: string = readToolName(createBy.data.toolName);

    const server: ExternalMcpServer | null =
      await ExternalMcpServerService.findOneBy({
        query: { _id: serverId, projectId: projectId },
        select: { _id: true, projectId: true, tools: true },
        props: { isRoot: true },
      });

    if (!server || server.projectId?.toString() !== projectId.toString()) {
      throw new BadDataException(
        EXTERNAL_MCP_TOOL_MARK_SERVER_NOT_FOUND_MESSAGE,
      );
    }

    const tool: ExternalMcpServerTool | undefined = readExternalMcpServerTools(
      server.tools,
    ).find((candidate: ExternalMcpServerTool): boolean => {
      return candidate.name === toolName;
    });

    if (!tool) {
      throw new BadDataException(getExternalMcpToolNotReadMessage(toolName));
    }

    const status: ExternalMcpToolReadOnlyStatus =
      getExternalMcpToolReadOnlyStatus({ tool });

    if (status === ExternalMcpToolReadOnlyStatus.ServerMarksReadOnly) {
      throw new BadDataException(getExternalMcpToolReadsOnlyMessage(tool.name));
    }

    if (status === ExternalMcpToolReadOnlyStatus.ServerMarksChange) {
      throw new BadDataException(
        getExternalMcpToolServerMarksChangeMessage(tool.name),
      );
    }

    if (
      status === ExternalMcpToolReadOnlyStatus.CannotBeMarked &&
      tool.markRefusal
    ) {
      throw new BadDataException(
        describeExternalMcpToolMarkRefusal({
          toolName: tool.name,
          refusal: tool.markRefusal,
        }),
      );
    }

    if (!tool.fingerprint) {
      throw new BadDataException(
        getExternalMcpToolNotFingerprintedMessage(tool.name),
      );
    }

    // The tool as OneUptime read it, whatever the request said it was.
    createBy.data.externalMcpServerId = serverId;
    createBy.data.toolName = tool.name;
    createBy.data.toolFingerprint = tool.fingerprint;

    return onCreate;
  }

  /*
   * The tool's earlier marks are taken away, as the person who marked it
   * again, so the audit log has both. A failure leaves them: a tool with
   * two marks is marked as the newest holds, and the page shows one.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const props: DatabaseCommonInteractionProps = onCreate.createBy.props;
    const data: Model = onCreate.createBy.data;

    if (!createdItem.id || !data.externalMcpServerId || !data.toolName) {
      return createdItem;
    }

    try {
      await this.deleteBy({
        query: {
          externalMcpServerId: data.externalMcpServerId,
          toolName: data.toolName,
          _id: QueryHelper.notEquals(createdItem.id),
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: props,
      });
    } catch (error) {
      logger.error(
        `External MCP server ${data.externalMcpServerId.toString()}: could not take away the earlier read-only marks of ${data.toolName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return createdItem;
  }

  /*
   * The marks of one server, as a run reads them: the tool each names and
   * the definition it holds. Read as OneUptime, for a run of the server's
   * own project.
   */
  @CaptureSpan()
  public async findMarksOfServer(data: {
    projectId: ObjectID;
    externalMcpServerId: ObjectID;
  }): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        projectId: data.projectId,
        externalMcpServerId: data.externalMcpServerId,
      },
      select: {
        _id: true,
        projectId: true,
        externalMcpServerId: true,
        toolName: true,
        toolFingerprint: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  }
}

export default new Service();

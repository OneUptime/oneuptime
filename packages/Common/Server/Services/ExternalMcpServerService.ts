import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ExternalMcpServer";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import CreateLimit from "../Types/Database/CreateLimit";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import ProjectCountLimit from "../Utils/Database/ProjectCountLimit";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ExternalMcpServerConnection, {
  EXTERNAL_MCP_SERVER_CONNECTION_SELECT,
} from "../Utils/AI/Mcp/ExternalMcpServerConnection";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import ExternalMcpServerAuthType, {
  isExternalMcpServerAuthType,
} from "../../Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import {
  ExternalMcpServerSignIn,
  getExternalMcpServerSignInProblem,
  getExternalMcpServerUrlProblem,
  readExternalMcpServerHeaders,
} from "../../Types/AI/ExternalMcpServer/ExternalMcpServerSettingsCheck";
import { MAX_EXTERNAL_MCP_SERVERS_PER_PROJECT } from "../../Types/AI/ExternalMcpServer/ExternalMcpServerLimits";
import {
  ExternalMcpServerAllowance,
  isExternalMcpServerAllowed,
} from "../../Types/AI/ExternalMcpServer/ExternalMcpServerAllowance";
import {
  ExternalMcpServerTool,
  readExternalMcpServerTools,
} from "../../Types/AI/ExternalMcpServer/ExternalMcpServerTool";

/*
 * External MCP servers: checked when saved, so a server that stores is one
 * OneUptime can try to connect to - an address with a host, and the
 * sign-in its Authentication asks for. Whether it answers is "Test
 * connection"'s to say (ExternalMcpServerAPI), and every run's.
 *
 * Secrets are write-only: an edit form cannot show them, so on an update a
 * secret left out or left empty keeps the stored one, and a value replaces
 * it. Changing Authentication removes the secrets the old one used, so a
 * token never stays behind a server that no longer sends it.
 *
 * A project has at most MAX_EXTERNAL_MCP_SERVERS_PER_PROJECT servers,
 * decided with the INSERT under the project's lock (getCreateLimit), as
 * every count limit is.
 */

export const EXTERNAL_MCP_SERVER_LIMIT_NAME: string = "external-mcp-servers";

export const EXTERNAL_MCP_SERVER_COUNT_STATEMENT: string =
  'SELECT COUNT(*)::int AS "count" FROM "ExternalMcpServer" WHERE "projectId" = $1 AND "deletedAt" IS NULL';

export const EXTERNAL_MCP_SERVER_LIMIT_MESSAGE: string = `A project can have at most ${MAX_EXTERNAL_MCP_SERVERS_PER_PROJECT} MCP servers. Remove one you no longer use first.`;

// The columns that hold a secret, written and never read back.
const SECRET_COLUMNS: Array<string> = [
  "bearerToken",
  "headers",
  "oauthClientSecret",
];

// The settings of OAuth client credentials that are not secret.
const OAUTH_SETTING_COLUMNS: Array<string> = [
  "oauthTokenUrl",
  "oauthClientId",
  "oauthScope",
  "oauthAudience",
];

// What a write may change about how OneUptime reaches the server.
const CONNECTION_COLUMNS: Array<string> = [
  "url",
  "authType",
  ...SECRET_COLUMNS,
  ...OAUTH_SETTING_COLUMNS,
];

// The columns each Authentication uses; the others are cleared when it is chosen.
const COLUMNS_OF_AUTH_TYPE: Record<ExternalMcpServerAuthType, Array<string>> = {
  [ExternalMcpServerAuthType.None]: [],
  [ExternalMcpServerAuthType.BearerToken]: ["bearerToken"],
  [ExternalMcpServerAuthType.Headers]: ["headers"],
  [ExternalMcpServerAuthType.OAuthClientCredentials]: [
    "oauthClientSecret",
    ...OAUTH_SETTING_COLUMNS,
  ],
};

const ALL_AUTH_COLUMNS: Array<string> = [
  ...SECRET_COLUMNS,
  ...OAUTH_SETTING_COLUMNS,
];

function readTrimmed(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A write's settings, read as the checks read them: texts trimmed, the
   * headers as an object (a form or an API client may send it as JSON
   * text), and empty optional settings as nothing. The headers are checked
   * as they were sent (getSettingsProblem), then stored trimmed
   * (storeHeadersTrimmed).
   */
  public static readWrite(data: Record<string, unknown>): void {
    for (const column of [
      "name",
      "url",
      "bearerToken",
      "oauthClientSecret",
      ...OAUTH_SETTING_COLUMNS,
    ]) {
      if (data[column] !== undefined && data[column] !== null) {
        data[column] = readTrimmed(data[column]);
      }
    }

    if (typeof data["headers"] === "string") {
      try {
        data["headers"] = JSON.parse(data["headers"] as string);
      } catch {
        throw new BadDataException(
          "Headers must be a JSON object of header names and values.",
        );
      }
    }

    for (const column of ["oauthScope", "oauthAudience"]) {
      if (data[column] === "") {
        data[column] = null;
      }
    }
  }

  // The checked headers, each name and value trimmed, as they are stored.
  public static storeHeadersTrimmed(data: Record<string, unknown>): void {
    if (data["headers"] !== undefined && data["headers"] !== null) {
      data["headers"] = readExternalMcpServerHeaders(
        data["headers"],
      ) as JSONObject;
    }
  }

  // Why the address or the sign-in cannot be saved, or null.
  public static getSettingsProblem(data: {
    settings: Record<string, unknown>;
  }): string | null {
    const urlProblem: string | null = getExternalMcpServerUrlProblem(
      data.settings["url"],
    );

    if (urlProblem) {
      return urlProblem;
    }

    if (
      data.settings["authType"] !== undefined &&
      data.settings["authType"] !== null &&
      !isExternalMcpServerAuthType(data.settings["authType"])
    ) {
      return "Authentication must be None, BearerToken, Headers or OAuthClientCredentials.";
    }

    return getExternalMcpServerSignInProblem({
      signIn: data.settings as ExternalMcpServerSignIn,
      isEdit: false,
    });
  }

  /*
   * The write with the columns of the other Authentications cleared: a
   * server keeps only the secrets the sign-in it uses needs.
   */
  public static clearOtherSignIns(data: Record<string, unknown>): void {
    const authType: unknown = data["authType"];

    if (!isExternalMcpServerAuthType(authType)) {
      return;
    }

    const kept: Array<string> = COLUMNS_OF_AUTH_TYPE[authType];

    for (const column of ALL_AUTH_COLUMNS) {
      if (!kept.includes(column)) {
        data[column] = null;
      }
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    if (data["authType"] === undefined || data["authType"] === null) {
      data["authType"] = ExternalMcpServerAuthType.None;
    }

    Service.readWrite(data);

    const problem: string | null = Service.getSettingsProblem({
      settings: data,
    });

    if (problem) {
      throw new BadDataException(problem);
    }

    Service.storeHeadersTrimmed(data);
    Service.clearOtherSignIns(data);

    // Told before anything else is prepared; decided again with the INSERT.
    const projectId: ObjectID | undefined = createBy.data.projectId;

    if (projectId) {
      const count: PositiveNumber = await this.countBy({
        query: { projectId: projectId },
        props: { isRoot: true },
      });

      if (count.toNumber() >= MAX_EXTERNAL_MCP_SERVERS_PER_PROJECT) {
        throw new BadDataException(EXTERNAL_MCP_SERVER_LIMIT_MESSAGE);
      }
    }

    return { createBy, carryForward: null };
  }

  protected override async getCreateLimit(
    createBy: CreateBy<Model>,
  ): Promise<CreateLimit | null> {
    const projectId: ObjectID | undefined = createBy.data.projectId;

    if (!projectId) {
      return null;
    }

    return ProjectCountLimit.getCreateLimit({
      limitName: EXTERNAL_MCP_SERVER_LIMIT_NAME,
      projectId: projectId,
      allowed: MAX_EXTERNAL_MCP_SERVERS_PER_PROJECT,
      statement: EXTERNAL_MCP_SERVER_COUNT_STATEMENT,
      parameters: [projectId.toString()],
      refusal: EXTERNAL_MCP_SERVER_LIMIT_MESSAGE,
    });
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: Record<string, unknown> = (updateBy.data || {}) as Record<
      string,
      unknown
    >;

    /*
     * A secret left empty keeps the stored one: an edit form never holds
     * it, so an empty field means "unchanged", never "remove".
     */
    for (const column of SECRET_COLUMNS) {
      const value: unknown = data[column];

      if (
        value === "" ||
        value === null ||
        (column === "headers" &&
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          Object.keys(value).length === 0)
      ) {
        delete data[column];
      }
    }

    const touchesConnection: boolean = CONNECTION_COLUMNS.some(
      (column: string): boolean => {
        return data[column] !== undefined;
      },
    );

    if (!touchesConnection) {
      return { updateBy, carryForward: null };
    }

    Service.readWrite(data);

    // The servers the update writes, and the update held to them.
    const servers: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        url: true,
        authType: true,
        bearerToken: true,
        headers: true,
        oauthTokenUrl: true,
        oauthClientId: true,
        oauthClientSecret: true,
        oauthScope: true,
        oauthAudience: true,
      },
    );

    for (const server of servers) {
      // The server as it will be: what is stored, then what the update sends.
      const merged: Record<string, unknown> = {};

      for (const column of CONNECTION_COLUMNS) {
        merged[column] =
          data[column] !== undefined
            ? data[column]
            : (server as unknown as Record<string, unknown>)[column];
      }

      const problem: string | null = Service.getSettingsProblem({
        settings: merged,
      });

      if (problem) {
        throw new BadDataException(problem);
      }
    }

    Service.storeHeadersTrimmed(data);
    Service.clearOtherSignIns(data);

    return { updateBy, carryForward: null };
  }

  /*
   * The servers of a project a run may use: on, the project's own, and
   * allowed by the rules that matched (ExternalMcpServerAllowance) - with
   * their secrets, read as OneUptime, for the run's connections alone.
   */
  @CaptureSpan()
  public async findServersForRun(data: {
    projectId: ObjectID;
    allowance: ExternalMcpServerAllowance;
  }): Promise<Array<Model>> {
    if (
      !data.allowance.isEveryServer &&
      data.allowance.serverIds.length === 0
    ) {
      return [];
    }

    const servers: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        isEnabled: true,
        ...(data.allowance.isEveryServer
          ? {}
          : {
              _id: QueryHelper.any(
                data.allowance.serverIds.filter((id: string): boolean => {
                  return ObjectID.isValidUUID(id);
                }),
              ),
            }),
      },
      select: EXTERNAL_MCP_SERVER_CONNECTION_SELECT,
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    // The query named them; the allowance is asked again, and the project.
    return servers.filter((server: Model): boolean => {
      return (
        server.projectId?.toString() === data.projectId.toString() &&
        isExternalMcpServerAllowed(data.allowance, server.id)
      );
    });
  }

  /*
   * Whether any server a fix may use could make the fix: one that is on,
   * allowed, and offers a tool that may change something - or whose tools
   * OneUptime has not read yet (the fix reads them). A project whose servers
   * only read starts no fix through them: there would be nothing to fix
   * with.
   */
  @CaptureSpan()
  public async hasServersThatMayFix(data: {
    projectId: ObjectID;
    allowance: ExternalMcpServerAllowance;
  }): Promise<boolean> {
    if (
      !data.allowance.isEveryServer &&
      data.allowance.serverIds.length === 0
    ) {
      return false;
    }

    const servers: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        isEnabled: true,
      },
      select: { _id: true, projectId: true, tools: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    return servers.some((server: Model): boolean => {
      if (
        server.projectId?.toString() !== data.projectId.toString() ||
        !isExternalMcpServerAllowed(data.allowance, server.id)
      ) {
        return false;
      }

      // Never read: the fix reads the tools, and may find one.
      if (!Array.isArray(server.tools)) {
        return true;
      }

      return readExternalMcpServerTools(server.tools).some(
        (tool: ExternalMcpServerTool): boolean => {
          return !tool.readsOnly;
        },
      );
    });
  }

  // A connection to one stored server (see ExternalMcpServerConnection).
  public getConnection(server: Model): ExternalMcpServerConnection {
    return ExternalMcpServerConnection.fromServer(server);
  }
}

export default new Service();

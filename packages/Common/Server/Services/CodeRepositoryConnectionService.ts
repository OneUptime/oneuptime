import Model from "../../Models/DatabaseModels/CodeRepositoryConnection";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../Types/CodeRepository/CodeRepositoryType";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseService from "./DatabaseService";
import CodeRepositoryService from "./CodeRepositoryService";

/*
 * What a connection's credentials hold, once read: the access token, and the
 * username Git is given with it over HTTPS (a Git repository's own, or the
 * token's account).
 */
export interface CodeRepositoryConnectionCredentials {
  token: string;
  username: string;
}

// How many of a token's last characters a person is shown, to tell tokens apart.
const CREDENTIAL_HINT_LENGTH: number = 4;

// A token shorter than this is shown no characters at all.
const MIN_TOKEN_LENGTH_FOR_HINT: number = 16;

/*
 * The connections a project reaches its Git servers with: GitLab, Forgejo
 * and Gitea servers, and plain Git repositories (see the model). Written and
 * read only by the server, as root - by Code's connect routes, and by
 * whatever reads a repository's code or hands its token to a Runner.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  // The credentials as stored: one JSON text, encrypted by the column.
  public static writeCredentials(
    credentials: CodeRepositoryConnectionCredentials,
  ): string {
    return JSON.stringify({
      token: credentials.token,
      username: credentials.username,
    });
  }

  /*
   * The credentials a connection holds, or null when it holds none that can
   * be read - which reads as not connected, never as a token of "".
   */
  public static readCredentials(
    stored: string | null | undefined,
  ): CodeRepositoryConnectionCredentials | null {
    if (!stored) {
      return null;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(stored);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const value: JSONObject = parsed as JSONObject;
    const token: unknown = value["token"];
    const username: unknown = value["username"];

    if (typeof token !== "string" || !token) {
      return null;
    }

    return {
      token,
      username: typeof username === "string" ? username : "",
    };
  }

  /*
   * The last characters of a token, to tell one token from another on the
   * page without showing it - none for a short one, whose last characters
   * would be too much of it.
   */
  public static getCredentialHint(token: string): string {
    if (!token || token.length < MIN_TOKEN_LENGTH_FOR_HINT) {
      return "";
    }

    return token.substring(token.length - CREDENTIAL_HINT_LENGTH);
  }

  /*
   * The server refused the connection's token (401 or 403 to a request it
   * would otherwise answer): its repositories are not connected until the
   * token is replaced or taken again. Written only when it changes.
   */
  @CaptureSpan()
  public async markRefused(connection: Model): Promise<void> {
    if (!connection.id || connection.refusedAt) {
      return;
    }

    try {
      await this.updateOneById({
        id: connection.id,
        data: { refusedAt: OneUptimeDate.getCurrentDate() },
        props: { isRoot: true },
      });

      connection.refusedAt = OneUptimeDate.getCurrentDate();
    } catch (error) {
      logger.error(
        `Could not mark code repository connection ${connection.id.toString()} as refused:`,
      );
      logger.error(error);
    }
  }

  // The server took the connection's token again.
  @CaptureSpan()
  public async markAccepted(connection: Model): Promise<void> {
    if (!connection.id || !connection.refusedAt) {
      return;
    }

    try {
      await this.updateOneById({
        id: connection.id,
        data: { refusedAt: null } as never,
        props: { isRoot: true },
      });

      delete connection.refusedAt;
    } catch (error) {
      logger.error(
        `Could not clear the refusal of code repository connection ${connection.id.toString()}:`,
      );
      logger.error(error);
    }
  }

  /*
   * A project's connections no repository uses any more: deleted, so a token
   * nobody needs is not kept. Called once repositories are deleted.
   */
  @CaptureSpan()
  public async deleteUnusedConnections(projectId: ObjectID): Promise<number> {
    const connections: Array<Model> = await this.findBy({
      query: { projectId: projectId },
      select: { _id: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    if (connections.length === 0) {
      return 0;
    }

    const used: Array<CodeRepository> = await CodeRepositoryService.findBy({
      query: {
        projectId: projectId,
        codeRepositoryConnectionId: QueryHelper.any(
          connections.map((connection: Model): ObjectID => {
            return connection.id!;
          }),
        ),
      },
      select: { _id: true, codeRepositoryConnectionId: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    const usedIds: Set<string> = new Set<string>(
      used
        .map((repository: CodeRepository): string => {
          return repository.codeRepositoryConnectionId?.toString() || "";
        })
        .filter((id: string): boolean => {
          return Boolean(id);
        }),
    );

    let deleted: number = 0;

    for (const connection of connections) {
      if (!connection.id || usedIds.has(connection.id.toString())) {
        continue;
      }

      try {
        await this.deleteOneById({
          id: connection.id,
          props: { isRoot: true },
        });
        deleted++;
      } catch (error) {
        logger.error(
          `Could not delete unused code repository connection ${connection.id.toString()}:`,
        );
        logger.error(error);
      }
    }

    return deleted;
  }

  // Whether a connection is of a provider that has connections at all.
  public static isConnectionProvider(
    provider: CodeRepositoryType | string | null | undefined,
  ): boolean {
    return (
      provider === CodeRepositoryType.GitLab ||
      provider === CodeRepositoryType.Forgejo ||
      provider === CodeRepositoryType.Git
    );
  }
}

export default new Service();

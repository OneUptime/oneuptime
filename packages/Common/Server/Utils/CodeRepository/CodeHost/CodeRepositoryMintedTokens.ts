import AIRunService from "../../../Services/AIRunService";
import CodeRepositoryMintedTokenService from "../../../Services/CodeRepositoryMintedTokenService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import {
  CodeRepositoryConnectionCredentials,
  Service as CodeRepositoryConnectionServiceClass,
} from "../../../Services/CodeRepositoryConnectionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeHostAccess from "./CodeHostAccess";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
  CodeHostTransport,
} from "./CodeHostHttp";
import GitLabApi, { GitLabProjectAccessToken } from "./GitLabApi";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryConnection from "../../../../Models/DatabaseModels/CodeRepositoryConnection";
import CodeRepositoryMintedToken from "../../../../Models/DatabaseModels/CodeRepositoryMintedToken";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import ObjectID from "../../../../Types/ObjectID";

/*
 * THE SHORT-LIVED TOKENS A CODE FIX PUSHES WITH, WHERE THE HOST LETS
 * ONEUPTIME MAKE ONE (issue #8912).
 *
 * A Runner that pushes a fix's branch to a GitLab repository was handed the
 * connection's own token: long-lived, and as wide as the account it was made
 * with - every project the account reaches, and GitLab's whole API. Where
 * GitLab lets it, OneUptime now makes a project access token for the run
 * instead, with the connection's token, and hands the Runner that:
 *
 *   - on the one project the run works in, which is all a project access
 *     token can reach;
 *   - with the write_repository scope alone, which pushes and pulls over Git
 *     and calls no API - OneUptime opens the run's merge request itself
 *     (CodeFixPullRequestOpener), as the connection's account, so the bot
 *     user GitLab makes for the token writes no merge request and revoking
 *     the token changes none;
 *   - with the Developer role, which pushes to the branches the project does
 *     not protect;
 *   - ending on its own at midnight UTC at least three hours from now, at
 *     most a day later (getExpiry), and revoked by OneUptime as soon as the
 *     run no longer needs it: when the Runner reports its end, when it is
 *     queued again, or - when the Runner never says - once OneUptime sees
 *     the run ended or passed to another worker (revokeEnded, every minute).
 *
 * GitLab makes one only for the token of someone with the Maintainer or
 * Owner role in the project, with the api scope, and on GitLab.com only on
 * Premium and Ultimate. Where it refuses, the refusal is kept on the
 * repository (CodeRepository.mintedTokenRefusedAt) and the run falls back
 * to the rule from before: its own Runner is handed the connection's token,
 * and a global Runner that is never handed one takes none of its fixes
 * (Types/Runner/GlobalRunnerRepositoryTokens).
 *
 * The token itself is never stored: a row keeps GitLab's id for it, its
 * project and the connection whose token revokes it (the model).
 */

// What the token may do: push and pull over Git, and nothing else.
export const MINTED_TOKEN_SCOPES: ReadonlyArray<string> = ["write_repository"];

// Its role: Developer, who pushes to the branches the project does not protect.
export const MINTED_TOKEN_ACCESS_LEVEL: number = 30;

/*
 * The least a token lives: longer than a run may take (two hours at most)
 * and its push after.
 */
export const MINTED_TOKEN_SHORTEST_LIFE_IN_HOURS: number = 3;

/*
 * How long a refusal holds before a run on one of the project's own Runners
 * asks GitLab again (a role given since, a plan that changed): such a run
 * falls back to the connection's token when GitLab refuses again, so asking
 * costs it nothing. Replacing the connection's token clears the refusal at
 * once (clearRefusalsOfConnection).
 */
export const MINTED_TOKEN_REFUSAL_HOLDS_FOR_DAYS: number = 7;

/*
 * How long after a revocation the host did not make the sweep asks again,
 * rather than every minute.
 */
export const MINTED_TOKEN_REVOCATION_RETRY_IN_MINUTES: number = 5;

// How many tokens one sweep revokes at most.
const MAX_TOKENS_PER_SWEEP: number = 100;

// A token GitLab made for a run, as the Runner is handed it.
export interface MintedRepositoryToken {
  token: string;
  // When GitLab ends it on its own.
  expiresAt: Date;
}

/*
 * What asking GitLab for a token came to:
 *
 *   - minted: the token, recorded so OneUptime revokes it;
 *   - refused: GitLab will not make one for this repository - its words, and
 *     the refusal kept on the repository;
 *   - unavailable: GitLab could not be asked now (no answer, too many
 *     requests): nothing is kept, and the next run asks again.
 */
export type CodeRepositoryMintOutcome =
  | { kind: "minted"; minted: MintedRepositoryToken }
  | { kind: "refused"; reason: string }
  | { kind: "unavailable"; reason: string };

// What revokes one token: the host's API for the connection. A test seam.
export type MintedTokenRevoker = (data: {
  connection: CodeRepositoryConnection;
  token: CodeRepositoryMintedToken;
  transport: CodeHostTransport;
}) => Promise<boolean>;

const revokeWithGitLab: MintedTokenRevoker = async (data: {
  connection: CodeRepositoryConnection;
  token: CodeRepositoryMintedToken;
  transport: CodeHostTransport;
}): Promise<boolean> => {
  const credentials: CodeRepositoryConnectionCredentials | null =
    CodeRepositoryConnectionServiceClass.readCredentials(
      data.connection.credentials,
    );

  if (!credentials || !data.connection.hostUrl) {
    throw new Error("its connection holds no token to revoke it with");
  }

  return await new GitLabApi({
    hostUrl: data.connection.hostUrl,
    token: credentials.token,
    transport: data.transport,
  }).revokeProjectAccessToken({
    project: data.token.hostProjectId || "",
    tokenId: data.token.hostTokenId || "",
  });
};

// The columns a row is read with to revoke it.
const MINTED_TOKEN_SELECT: {
  _id: true;
  projectId: true;
  aiRunId: true;
  workerId: true;
  codeRepositoryConnectionId: true;
  provider: true;
  hostProjectId: true;
  hostTokenId: true;
  expiresAt: true;
  revocationAttemptedAt: true;
} = {
  _id: true,
  projectId: true,
  aiRunId: true,
  workerId: true,
  codeRepositoryConnectionId: true,
  provider: true,
  hostProjectId: true,
  hostTokenId: true,
  expiresAt: true,
  revocationAttemptedAt: true,
};

export default class CodeRepositoryMintedTokens {
  private static revoker: MintedTokenRevoker = revokeWithGitLab;

  /*
   * The date a token made now is asked to end on, and when that is: GitLab
   * ends a token at midnight UTC at the start of its expiry date, so the day
   * after the earliest end it may have - at least
   * MINTED_TOKEN_SHORTEST_LIFE_IN_HOURS from now, at most a day more.
   */
  public static getExpiry(now: Date): { date: string; endsAt: Date } {
    const earliestEnd: Date = new Date(
      now.getTime() + MINTED_TOKEN_SHORTEST_LIFE_IN_HOURS * 60 * 60 * 1000,
    );

    const endsAt: Date = new Date(
      Date.UTC(
        earliestEnd.getUTCFullYear(),
        earliestEnd.getUTCMonth(),
        earliestEnd.getUTCDate() + 1,
      ),
    );

    return { date: endsAt.toISOString().substring(0, 10), endsAt };
  }

  /*
   * Whether a repository's refusal still holds for a run on one of its
   * project's own Runners, which asks GitLab again once it is older than
   * MINTED_TOKEN_REFUSAL_HOLDS_FOR_DAYS.
   */
  public static isRefusalHolding(
    refusedAt: Date | null | undefined,
    now: Date,
  ): boolean {
    if (!refusedAt) {
      return false;
    }

    return (
      now.getTime() - new Date(refusedAt).getTime() <
      MINTED_TOKEN_REFUSAL_HOLDS_FOR_DAYS * 24 * 60 * 60 * 1000
    );
  }

  /*
   * Make a project access token for one run in one GitLab repository, with
   * the connection's token, and record it so OneUptime revokes it. The
   * route has decided the worker holds the run and may work in the
   * repository, and that the connection is the repository's and usable.
   *
   * A token the run was handed before in this repository is revoked first:
   * a run holds one at a time. A token that could not be recorded is
   * revoked at once and never handed out - nothing would revoke it.
   *
   * Throws GitLab's refusal of the connection's token itself (401), which
   * the caller marks on the connection.
   */
  @CaptureSpan()
  public static async mintForRun(data: {
    repository: CodeRepository;
    connection: CodeRepositoryConnection;
    runId: ObjectID;
    workerId: ObjectID;
    transport: CodeHostTransport;
    now?: Date | undefined;
  }): Promise<CodeRepositoryMintOutcome> {
    const now: Date = data.now || new Date();
    const repository: CodeRepository = data.repository;
    const credentials: CodeRepositoryConnectionCredentials | null =
      CodeRepositoryConnectionServiceClass.readCredentials(
        data.connection.credentials,
      );
    const project: string =
      repository.gitLabProjectId ||
      (repository.organizationName && repository.repositoryName
        ? `${repository.organizationName}/${repository.repositoryName}`
        : "");

    if (
      !credentials ||
      !data.connection.hostUrl ||
      !project ||
      !repository.id ||
      !repository.projectId
    ) {
      return {
        kind: "refused",
        reason: "OneUptime does not know which GitLab project this is.",
      };
    }

    await CodeRepositoryMintedTokens.revokeForRun({
      runId: data.runId,
      codeRepositoryId: repository.id,
      transport: data.transport,
    });

    const expiry: { date: string; endsAt: Date } =
      CodeRepositoryMintedTokens.getExpiry(now);
    const runIdText: string = data.runId.toString();

    let made: GitLabProjectAccessToken;

    try {
      made = await new GitLabApi({
        hostUrl: data.connection.hostUrl,
        token: credentials.token,
        transport: data.transport,
      }).createProjectAccessToken({
        project,
        name: `OneUptime AI fix ${runIdText.substring(0, 8)}`,
        description: `Made by OneUptime for one AI code fix (run ${runIdText}) to push its branch. OneUptime revokes it when the fix ends.`,
        scopes: [...MINTED_TOKEN_SCOPES],
        accessLevel: MINTED_TOKEN_ACCESS_LEVEL,
        expiresAt: expiry.date,
      });
    } catch (error) {
      if (!(error instanceof CodeHostHttpError)) {
        throw error;
      }

      if (error.isCredentialRefusal()) {
        throw error;
      }

      if (
        error.kind === CodeHostHttpErrorKind.Unavailable ||
        error.kind === CodeHostHttpErrorKind.RateLimited ||
        error.kind === CodeHostHttpErrorKind.NotAllowed
      ) {
        return { kind: "unavailable", reason: error.message };
      }

      await CodeRepositoryMintedTokens.rememberRefusal({
        repositoryId: repository.id,
        now,
      });

      return { kind: "refused", reason: error.message };
    }

    try {
      const row: CodeRepositoryMintedToken = new CodeRepositoryMintedToken();
      row.projectId = repository.projectId;
      row.aiRunId = data.runId;
      row.workerId = data.workerId;
      row.codeRepositoryId = repository.id;
      row.codeRepositoryConnectionId = data.connection.id!;
      row.provider = CodeRepositoryType.GitLab;
      row.hostProjectId = project;
      row.hostTokenId = made.id;
      row.expiresAt = expiry.endsAt;

      await CodeRepositoryMintedTokenService.create({
        data: row,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `Could not record the token GitLab made for run ${runIdText}; revoking it rather than handing it out: ${error}`,
      );

      try {
        await new GitLabApi({
          hostUrl: data.connection.hostUrl,
          token: credentials.token,
          transport: data.transport,
        }).revokeProjectAccessToken({ project, tokenId: made.id });
      } catch (revokeError) {
        logger.error(
          `Could not revoke the token GitLab made for run ${runIdText} either; it ends on its own on ${expiry.date}: ${revokeError}`,
        );
      }

      throw error;
    }

    if (repository.mintedTokenRefusedAt) {
      await CodeRepositoryMintedTokens.clearRefusal(repository.id);
    }

    return {
      kind: "minted",
      minted: { token: made.token, expiresAt: expiry.endsAt },
    };
  }

  /*
   * Revoke every token a run was handed that may still be good - in one
   * repository, or in all of them. The number revoked; never throws: a
   * token not revoked now is the sweep's (revokeEnded), and ends on its own
   * by the end of the next day in UTC.
   */
  @CaptureSpan()
  public static async revokeForRun(data: {
    runId: ObjectID;
    codeRepositoryId?: ObjectID | undefined;
    transport?: CodeHostTransport | undefined;
    now?: Date | undefined;
  }): Promise<number> {
    try {
      const rows: Array<CodeRepositoryMintedToken> =
        await CodeRepositoryMintedTokenService.findBy({
          query: {
            aiRunId: data.runId,
            revokedAt: QueryHelper.isNull(),
            ...(data.codeRepositoryId
              ? { codeRepositoryId: data.codeRepositoryId }
              : {}),
          },
          select: MINTED_TOKEN_SELECT,
          limit: MAX_TOKENS_PER_SWEEP,
          skip: 0,
          props: { isRoot: true },
        });

      return await CodeRepositoryMintedTokens.revokeRows({
        rows,
        transport: data.transport || CodeHostAccess.getTransport(),
        now: data.now || new Date(),
      });
    } catch (error) {
      logger.error(
        `Could not revoke the tokens run ${data.runId.toString()} was handed; the sweep will: ${error}`,
      );
      return 0;
    }
  }

  /*
   * The sweep: revoke every token whose run no longer needs it - the run
   * ended, was queued again, is held by another worker, or is gone - and
   * mark the ones that ended on their own. A token the host did not revoke
   * is asked about again MINTED_TOKEN_REVOCATION_RETRY_IN_MINUTES later.
   * The number revoked or found ended; never throws.
   */
  @CaptureSpan()
  public static async revokeEnded(data?: {
    transport?: CodeHostTransport | undefined;
    now?: Date | undefined;
  }): Promise<number> {
    const now: Date = data?.now || new Date();

    try {
      const rows: Array<CodeRepositoryMintedToken> =
        await CodeRepositoryMintedTokenService.findBy({
          query: { revokedAt: QueryHelper.isNull() },
          select: MINTED_TOKEN_SELECT,
          limit: MAX_TOKENS_PER_SWEEP,
          skip: 0,
          sort: { createdAt: SortOrder.Ascending },
          props: { isRoot: true },
        });

      const retryBefore: number =
        now.getTime() - MINTED_TOKEN_REVOCATION_RETRY_IN_MINUTES * 60 * 1000;

      const due: Array<CodeRepositoryMintedToken> = rows.filter(
        (row: CodeRepositoryMintedToken): boolean => {
          return (
            !row.revocationAttemptedAt ||
            new Date(row.revocationAttemptedAt).getTime() <= retryBefore
          );
        },
      );

      if (due.length === 0) {
        return 0;
      }

      const runIds: Array<ObjectID> = due
        .map((row: CodeRepositoryMintedToken): ObjectID | undefined => {
          return row.aiRunId;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        });

      const runs: Map<string, AIRun> = new Map();

      if (runIds.length > 0) {
        const found: Array<AIRun> = await AIRunService.findBy({
          query: { _id: QueryHelper.any(runIds) },
          select: { _id: true, status: true, aiAgentId: true },
          limit: runIds.length,
          skip: 0,
          props: { isRoot: true },
        });

        for (const run of found) {
          if (run.id) {
            runs.set(run.id.toString(), run);
          }
        }
      }

      const ended: Array<CodeRepositoryMintedToken> = due.filter(
        (row: CodeRepositoryMintedToken): boolean => {
          return !CodeRepositoryMintedTokens.isStillNeeded({
            row,
            run: row.aiRunId ? runs.get(row.aiRunId.toString()) : undefined,
            now,
          });
        },
      );

      return await CodeRepositoryMintedTokens.revokeRows({
        rows: ended,
        transport: data?.transport || CodeHostAccess.getTransport(),
        now,
      });
    } catch (error) {
      logger.error(
        `Could not sweep the tokens code fixes were handed: ${error}`,
      );
      return 0;
    }
  }

  /*
   * Whether a token is still the one its run's worker works with: the run
   * is there, Running, held by the worker it was handed to, and the token
   * has not ended on its own.
   */
  public static isStillNeeded(data: {
    row: CodeRepositoryMintedToken;
    run: AIRun | undefined;
    now: Date;
  }): boolean {
    if (
      !data.row.expiresAt ||
      new Date(data.row.expiresAt).getTime() <= data.now.getTime()
    ) {
      return false;
    }

    return Boolean(
      data.run &&
        data.run.status === AIRunStatus.Running &&
        data.run.aiAgentId &&
        data.row.workerId &&
        data.run.aiAgentId.toString() === data.row.workerId.toString(),
    );
  }

  /*
   * A connection's token was replaced: its repositories' refusals are
   * cleared, so their next fix asks GitLab again with the new token.
   */
  @CaptureSpan()
  public static async clearRefusalsOfConnection(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
  }): Promise<void> {
    try {
      await CodeRepositoryService.updateBy({
        query: {
          projectId: data.projectId,
          codeRepositoryConnectionId: data.connectionId,
          mintedTokenRefusedAt: QueryHelper.notNull(),
        },
        data: { mintedTokenRefusedAt: null } as never,
        limit: 1000,
        skip: 0,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `Could not clear the token refusals of connection ${data.connectionId.toString()}: ${error}`,
      );
    }
  }

  // For tests: what revokes a token, or GitLab again when left out.
  public static setRevokerForTests(revoker?: MintedTokenRevoker): void {
    CodeRepositoryMintedTokens.revoker = revoker || revokeWithGitLab;
  }

  private static async revokeRows(data: {
    rows: Array<CodeRepositoryMintedToken>;
    transport: CodeHostTransport;
    now: Date;
  }): Promise<number> {
    let revoked: number = 0;
    const connections: Map<string, CodeRepositoryConnection | null> = new Map();

    for (const row of data.rows) {
      if (!row.id) {
        continue;
      }

      const expiresAt: Date | null = row.expiresAt
        ? new Date(row.expiresAt)
        : null;

      // A token that ended on its own needs nothing but saying so.
      if (!expiresAt || expiresAt.getTime() <= data.now.getTime()) {
        await CodeRepositoryMintedTokens.markRevoked(row.id, expiresAt);
        revoked++;
        continue;
      }

      const connectionKey: string =
        row.codeRepositoryConnectionId?.toString() || "";

      if (!connections.has(connectionKey)) {
        connections.set(
          connectionKey,
          row.codeRepositoryConnectionId && row.projectId
            ? (
                await CodeHostAccess.readConnections({
                  projectId: row.projectId,
                  connectionIds: [row.codeRepositoryConnectionId.toString()],
                })
              ).get(row.codeRepositoryConnectionId.toString()) || null
            : null,
        );
      }

      const connection: CodeRepositoryConnection | null =
        connections.get(connectionKey) || null;

      if (!connection) {
        await CodeRepositoryMintedTokens.markAttempt({
          id: row.id,
          now: data.now,
          error:
            "Its connection is gone, so OneUptime has no token to revoke it with: it ends on its own at its expiry.",
        });
        continue;
      }

      try {
        await CodeRepositoryMintedTokens.revoker({
          connection,
          token: row,
          transport: data.transport,
        });

        await CodeRepositoryMintedTokens.markRevoked(row.id, data.now);
        revoked++;
      } catch (error) {
        const message: string =
          error instanceof Error ? error.message : String(error);

        logger.warn(
          `GitLab did not revoke the token code-fix run ${row.aiRunId?.toString() || "(deleted)"} was handed; asking again later, and it ends on its own at its expiry: ${message}`,
        );

        await CodeRepositoryMintedTokens.markAttempt({
          id: row.id,
          now: data.now,
          error: message,
        });
      }
    }

    return revoked;
  }

  private static async markRevoked(
    id: ObjectID,
    at: Date | null,
  ): Promise<void> {
    await CodeRepositoryMintedTokenService.updateOneById({
      id,
      data: {
        revokedAt: at || new Date(),
        revocationError: null,
      } as never,
      props: { isRoot: true },
    });
  }

  private static async markAttempt(data: {
    id: ObjectID;
    now: Date;
    error: string;
  }): Promise<void> {
    await CodeRepositoryMintedTokenService.updateOneById({
      id: data.id,
      data: {
        revocationAttemptedAt: data.now,
        revocationError: data.error.substring(0, 500),
      } as never,
      props: { isRoot: true },
    });
  }

  private static async rememberRefusal(data: {
    repositoryId: ObjectID;
    now: Date;
  }): Promise<void> {
    try {
      await CodeRepositoryService.updateOneById({
        id: data.repositoryId,
        data: { mintedTokenRefusedAt: data.now } as never,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `Could not keep GitLab's refusal on repository ${data.repositoryId.toString()}: ${error}`,
      );
    }
  }

  private static async clearRefusal(repositoryId: ObjectID): Promise<void> {
    try {
      await CodeRepositoryService.updateOneById({
        id: repositoryId,
        data: { mintedTokenRefusedAt: null } as never,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `Could not clear GitLab's refusal on repository ${repositoryId.toString()}: ${error}`,
      );
    }
  }
}

import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/SecurityUserErasureRequest";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import Includes from "../../Types/BaseDatabase/Includes";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import {
  SECURITY_USER_ERASURE_MAX_REFERENCE_LENGTH,
  SecurityUserErasureRequestStatus,
  getErasureSpellings,
  getErasureUserProblem,
  isErasureToken,
} from "../../Types/SecurityEvent/SecurityUserErasure";
import { ErasedName } from "../../Utils/SecurityEvent/SecurityUserErasureUnnaming";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import { truncateLongText } from "../Utils/Database/TruncateColumnValue";
import ScrubHashToken from "../Utils/Telemetry/ScrubHashToken";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * SECURITY EVENTS' ERASURE REQUESTS (#10908): erasing one person from the
 * user vault (Models/DatabaseModels/SecurityUserErasureRequest).
 *
 * The service holds what the model cannot say on its own, as the session
 * replay erasure requests' does (RumSessionErasureRequestService):
 *
 *   - a request is born Pending, its counters at zero, whatever the client
 *     sent;
 *   - it must be something the worker can act on, or it is refused: a
 *     request accepted and never carried out is worse than one refused,
 *     because the requester believes the person is gone;
 *   - the tokens the vault refuses from now on are worked out here, while
 *     what the requester typed is in hand: the tokens a Hash rule of the
 *     project makes of each spelling it erases (Types/SecurityEvent/
 *     SecurityUserErasure.getErasureSpellings), or the token itself when
 *     the requester pasted one.
 *
 * And the worker's moves (Server/Utils/SecurityEvent/UserVault/
 * SecurityUserErasure), each as the server: a request that is over has
 * what the requester typed wiped, Completed or Failed alike.
 */

// What the worker reads of a request: the same columns for every query it makes.
export const ERASURE_REQUEST_SELECT: {
  _id: true;
  projectId: true;
  userToErase: true;
  namesToErase: true;
  tokens: true;
  status: true;
  requestedAt: true;
  attempts: true;
  vaultEntriesDeleted: true;
  eventsUnnamed: true;
  casesUnnamed: true;
  proposalsWithdrawn: true;
  failureReason: true;
  updatedAt: true;
} = {
  _id: true,
  projectId: true,
  userToErase: true,
  namesToErase: true,
  tokens: true,
  status: true,
  requestedAt: true,
  attempts: true,
  vaultEntriesDeleted: true,
  eventsUnnamed: true,
  casesUnnamed: true,
  proposalsWithdrawn: true,
  failureReason: true,
  updatedAt: true,
};

// What a request changed, as the worker counts it.
export interface SecurityUserErasureCounts {
  vaultEntriesDeleted: number;
  eventsUnnamed: number;
  casesUnnamed: number;
  proposalsWithdrawn: number;
}

/*
 * The tokens a request erases for what the requester typed, in project
 * `projectId`: the token itself when it is one, else the token a Hash rule
 * of the project makes of each spelling it erases. None for nothing.
 */
export function getErasureTokens(data: {
  projectId: ObjectID;
  user: string;
}): Array<string> {
  const typed: string = (data.user || "").trim();

  if (isErasureToken(typed)) {
    return [typed];
  }

  return Array.from(
    new Set<string>(
      getErasureSpellings(typed).map((spelling: string): string => {
        return ScrubHashToken.ofValue({
          projectId: data.projectId,
          value: spelling,
        });
      }),
    ),
  );
}

/*
 * Who the worker found a request's person named as, as the request keeps
 * them (#11044): each name with what the Hash rule left in its place.
 * Nothing that is not such a pair is read, whatever the column held.
 */
export function readErasureRequestNames(request: Model): Array<ErasedName> {
  const stored: unknown = request.namesToErase;

  if (typeof stored !== "string" || !stored.trim()) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const names: Array<ErasedName> = [];

  for (const item of parsed) {
    const named: unknown = (item as { named?: unknown } | null)?.named;
    const hashed: unknown = (item as { hashed?: unknown } | null)?.hashed;

    if (
      typeof named === "string" &&
      typeof hashed === "string" &&
      named.trim() &&
      hashed.trim() &&
      named !== hashed
    ) {
      names.push({ named, hashed });
    }
  }

  return names;
}

// The names as a request keeps them: what readErasureRequestNames reads back.
export function toStoredErasureNames(names: ReadonlyArray<ErasedName>): string {
  return JSON.stringify(
    names.map((name: ErasedName): ErasedName => {
      return { named: name.named, hashed: name.hashed };
    }),
  );
}

// A request's tokens as stored: a list of text, whatever the column held.
export function readErasureRequestTokens(request: Model): Array<string> {
  const tokens: unknown = request.tokens;

  if (!Array.isArray(tokens)) {
    return [];
  }

  return tokens.filter((token: unknown): token is string => {
    return typeof token === "string" && isErasureToken(token);
  });
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (!projectId) {
      throw new BadDataException(
        "An erasure request is filed in a project. Choose the project, then file it again.",
      );
    }

    const typed: string = (createBy.data.userToErase || "").trim();
    const problem: string | null = getErasureUserProblem(typed);

    if (problem) {
      throw new BadDataException(problem);
    }

    const tokens: Array<string> = getErasureTokens({ projectId, user: typed });

    // Never empty for what getErasureUserProblem lets through; checked all the same.
    if (tokens.length === 0) {
      throw new BadDataException(
        "Enter the user ID, email address or token of the person to erase.",
      );
    }

    const reference: string = (createBy.data.reference || "").trim();

    if (reference.length > SECURITY_USER_ERASURE_MAX_REFERENCE_LENGTH) {
      throw new BadDataException(
        `A reference is at most ${SECURITY_USER_ERASURE_MAX_REFERENCE_LENGTH} characters, such as a ticket number. Shorten it, then file the request again.`,
      );
    }

    /*
     * Everything below is overwritten, never merged with what the client
     * sent. The columns are `computed` on the model, which is what lets
     * these writes past the create-column permission check after this hook.
     */
    createBy.data.reference = reference || (null as unknown as string);
    createBy.data.tokens = tokens;
    /*
     * A pasted token needs nothing more from the requester: the worker
     * finds the person behind it by the token. Anything else is kept,
     * encrypted, until the worker is done looking for the person.
     */
    createBy.data.userToErase = isErasureToken(typed)
      ? (null as unknown as string)
      : typed;
    createBy.data.status = SecurityUserErasureRequestStatus.Pending;
    createBy.data.requestedAt = OneUptimeDate.getCurrentDate();
    createBy.data.attempts = 0;
    createBy.data.vaultEntriesDeleted = 0;
    createBy.data.eventsUnnamed = 0;
    createBy.data.casesUnnamed = 0;
    createBy.data.proposalsWithdrawn = 0;

    /*
     * Asked for by the person making the request. DatabaseService has
     * already taken out whatever requestedByUser the request named, so with
     * no person on it - an API key - nobody is named as having asked.
     */
    if (createBy.props.userId) {
      RelationIdUtil.stamp(
        createBy.data as unknown as Record<string, unknown>,
        ["requestedByUserId", "requestedByUser"],
        createBy.props.userId,
      );
    }

    return { createBy, carryForward: null };
  }

  /*
   * Every token the project's erasure requests erase, whatever their state:
   * from the moment a request is filed, the vault refuses them for good.
   */
  @CaptureSpan()
  public async getErasedTokensOfProject(
    projectId: ObjectID,
  ): Promise<Set<string>> {
    const requests: Array<Model> = await this.findBy({
      query: { projectId: projectId },
      select: { tokens: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    const tokens: Set<string> = new Set<string>();

    for (const request of requests) {
      for (const token of readErasureRequestTokens(request)) {
        tokens.add(token);
      }
    }

    return tokens;
  }

  /*
   * The requests the worker has to work on, oldest first so none is starved
   * by newer ones: filed, or started and waiting for ClickHouse to apply
   * what it was told.
   */
  @CaptureSpan()
  public async getOpenRequests(data: { limit: number }): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        status: new Includes([
          SecurityUserErasureRequestStatus.Pending,
          SecurityUserErasureRequestStatus.InProgress,
        ]),
      },
      select: ERASURE_REQUEST_SELECT,
      sort: { requestedAt: SortOrder.Ascending },
      skip: 0,
      limit: data.limit,
      props: { isRoot: true },
    });
  }

  /*
   * Started, and on its way: the counts are what this run and the ones
   * before it found and changed. A run that gets this far did not fail, so
   * why an earlier one did is cleared.
   */
  @CaptureSpan()
  public async markInProgress(data: {
    requestId: ObjectID;
    counts: SecurityUserErasureCounts;
    /*
     * Who the run found the person named as, kept encrypted until the
     * request is over (#11044): the run's names, with every name an earlier
     * run kept. Left as it is when not given.
     */
    names?: ReadonlyArray<ErasedName> | undefined;
  }): Promise<void> {
    await this.updateOneById({
      id: data.requestId,
      data: {
        status: SecurityUserErasureRequestStatus.InProgress,
        failureReason: null as unknown as string,
        ...data.counts,
        ...(data.names
          ? {
              namesToErase:
                data.names.length > 0
                  ? toStoredErasureNames(data.names)
                  : (null as unknown as string),
            }
          : {}),
      },
      props: { isRoot: true },
    });
  }

  /*
   * Checked done: nothing the request reaches names the person. What the
   * requester typed, and who the worker found them named as, are wiped,
   * and only the tokens are kept.
   */
  @CaptureSpan()
  public async markCompleted(data: {
    requestId: ObjectID;
    counts: SecurityUserErasureCounts;
  }): Promise<void> {
    await this.updateOneById({
      id: data.requestId,
      data: {
        status: SecurityUserErasureRequestStatus.Completed,
        completedAt: OneUptimeDate.getCurrentDate(),
        userToErase: null as unknown as string,
        namesToErase: null as unknown as string,
        failureReason: null as unknown as string,
        ...data.counts,
      },
      props: { isRoot: true },
    });
  }

  /*
   * A run that failed, with attempts left: back to where it was, to be
   * tried again on the next run, and why it failed shown on the request.
   */
  @CaptureSpan()
  public async markAttemptFailed(data: {
    requestId: ObjectID;
    status: SecurityUserErasureRequestStatus;
    attempts: number;
    failureReason: string;
  }): Promise<void> {
    await this.updateOneById({
      id: data.requestId,
      data: {
        status: data.status,
        attempts: data.attempts,
        // Held to the column: ClickHouse's or Postgres's own words are often longer.
        failureReason: truncateLongText(data.failureReason),
      },
      props: { isRoot: true },
    });
  }

  /*
   * Given up on, after every retry. completedAt says the request is over,
   * not that the person is gone - the status says which - and what the
   * requester typed, and who the worker found them named as, are wiped all
   * the same: a failed request is filed again.
   */
  @CaptureSpan()
  public async markFailed(data: {
    requestId: ObjectID;
    attempts: number;
    failureReason: string;
  }): Promise<void> {
    await this.updateOneById({
      id: data.requestId,
      data: {
        status: SecurityUserErasureRequestStatus.Failed,
        completedAt: OneUptimeDate.getCurrentDate(),
        attempts: data.attempts,
        userToErase: null as unknown as string,
        namesToErase: null as unknown as string,
        failureReason: truncateLongText(data.failureReason),
      },
      props: { isRoot: true },
    });
  }
}

export default new Service();

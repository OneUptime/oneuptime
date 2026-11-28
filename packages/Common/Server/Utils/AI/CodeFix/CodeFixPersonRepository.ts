import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import { ResolvableRepository } from "../../CodeRepository/StackTraceRepoResolver";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeTaskAccess from "../CodeTask/CodeTaskAccess";
import CodeTaskGate from "../CodeTask/CodeTaskGate";
import CodeFixStartGate, { CodeFixStart } from "./CodeFixStartGate";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import CodeFixTaskContext from "../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
} from "../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
} from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Exception from "../../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";
import {
  CodeFixRepositoryChoice,
  MAX_CODE_FIX_REPOSITORY_CHOICES,
  NO_REPOSITORY_YOU_MAY_USE_MESSAGE,
  PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
  PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE,
  PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
} from "../../../../Utils/Suggestions/CodeFixRepositoryPick";

/*
 * THE REPOSITORY A PERSON'S FIX WITH AI IS MADE IN (#11075, #11209).
 *
 * A Fix with AI a person asks for outside Code starts a code task on their
 * behalf, so it is held to the rule Code holds a request to: the person may
 * use the repository the fix works in, in Code - read it, and ask OneUptime
 * AI to work in it (CodeTaskAccess, what changing the repository takes) -
 * and it is connected. One rule for every such button:
 *
 *   - a trace's Fix performance with AI (FixPerformanceTaskTrigger, #11075);
 *   - an incident's or alert's Open fix pull request, Fix the Cause
 *     (FixFromIncidentTaskTrigger, #11209);
 *   - a service's Improve Logging and Improve Tracing
 *     (TelemetryImprovementTaskTrigger, #11209).
 *
 * The last two checked only that the person may read the record or the
 * service, then queued the run in whichever connected repository the
 * record's monitor or the service is named like - one the person may not
 * read, or may not ask AI in - and took no pick. Now, for each of them:
 *
 *   - a pick is refused, in a sentence that says which of the two is
 *     missing, or that it is not connected (CodeFixRepositoryPick's
 *     words), whatever the page offered;
 *   - without a pick, the run's facts are resolved among the connected
 *     repositories the person may use, never another;
 *   - and either way the run is held to that one repository, when it is
 *     queued and again when it starts (CodeFixTaskContext
 *     .pickedCodeRepositoryId, getRunRepositoryAllowance), so it is never
 *     made in one the person may not use, however the repositories change
 *     before it starts.
 *
 * Refused in Code's order (CodeTaskGate): what stops everyone in the
 * project first - the bill, the plan, which also read as "may not edit the
 * repository" and would send people to an admin who cannot help either;
 * then why this person may not use the repository; then whatever else
 * Code's gate says about it; then a pick to make, when several are theirs
 * and the run's facts match none.
 *
 * THE RUNS NO PERSON STARTED keep their own rule, as no person's
 * permissions are behind them: a fix pull request an investigation opens on
 * its own (FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation),
 * the instrumentation an inconclusive investigation adds
 * (InstrumentationTaskTrigger) - both held to the repositories the auto
 * remediation rules allow (allowedCodeRepositoryIds) - and an AI insight's
 * fix (InsightFixRouting). A run asked again carries the context it
 * started with, the pin included (CodeTaskFixRetry, CodeFixAutoRetry).
 */

/*
 * The connected repositories a person may have a fix made in
 * (getUsableRepositories), and what the run's repository is resolved among
 * for them.
 */
export interface CodeFixRepositoryUse {
  /*
   * How many connected repositories OneUptime AI can work in the project
   * has (getResolvableRepositories), whoever may use them.
   */
  connectedCount: number;
  /*
   * Of those, the ones the person may read and ask OneUptime AI to work in
   * - in that list's order.
   */
  usable: Array<ResolvableRepository>;
  /*
   * Every connected repository, when the person may use each one; those,
   * when only some; none, when none.
   */
  allowance: CodeRepositoryAllowance;
}

// What a fix's refusals say, in its own words.
export interface CodeFixPersonRepositoryRefusals {
  // No connected repository OneUptime AI can work in: nowhere to work.
  noConnectedRepository: string;
  /*
   * Several repositories the person may use, and the run's facts match
   * none: the page asks for the pick first, so people meet this through
   * the API.
   */
  pickARepository: string;
}

/*
 * What a read of the repositories by the person answers when they may read
 * none at all (their role reads nothing of Code, or the plan does not
 * include it): none of them is theirs, said in the rule's own words rather
 * than the permission layer's.
 */
function isReadRefusal(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException ||
    error instanceof NotFoundException
  );
}

export default class CodeFixPersonRepository {
  /*
   * The connected repositories a person may have a fix made in: of every
   * one OneUptime AI can work in (CodeRepositoryService
   * .getResolvableRepositories, the candidates the run's own resolution
   * reads - every one of them, #11076), those the person may read and ask
   * OneUptime AI to work in, under their own permissions: Code's rule
   * (CodeTaskAccess). Read by the candidates' ids, a read a batch, however
   * many the project has - never one repository at a time.
   */
  @CaptureSpan()
  public static async getUsableRepositories(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<CodeFixRepositoryUse> {
    const resolvable: Array<ResolvableRepository> =
      await CodeRepositoryService.getResolvableRepositories(data.projectId);

    if (resolvable.length === 0) {
      return { connectedCount: 0, usable: [], allowance: NO_CODE_REPOSITORY };
    }

    let readable: Array<CodeRepository> = [];

    try {
      readable = await CodeTaskAccess.listReadableRepositoriesByIds({
        props: data.props,
        projectId: data.projectId,
        repositoryIds: resolvable.map(
          (repository: ResolvableRepository): string => {
            return repository.id;
          },
        ),
        select: { _id: true },
      });
    } catch (error) {
      if (!isReadRefusal(error)) {
        throw error;
      }
    }

    const readableIds: Set<string> = new Set<string>(
      readable
        .map((repository: CodeRepository): string => {
          return repository.id?.toString().toLowerCase() || "";
        })
        .filter(Boolean),
    );

    const usable: Array<ResolvableRepository> =
      await CodeTaskAccess.keepAskableRepositories<ResolvableRepository>({
        props: data.props,
        projectId: data.projectId,
        repositories: resolvable.filter(
          (repository: ResolvableRepository): boolean => {
            return readableIds.has(repository.id.toLowerCase());
          },
        ),
        getId: (repository: ResolvableRepository): string => {
          return repository.id;
        },
      });

    let allowance: CodeRepositoryAllowance = EVERY_CODE_REPOSITORY;

    if (usable.length === 0) {
      allowance = NO_CODE_REPOSITORY;
    } else if (usable.length < resolvable.length) {
      allowance = {
        isEveryRepository: false,
        repositoryIds: usable.map((repository: ResolvableRepository) => {
          return repository.id.toLowerCase();
        }),
      };
    }

    return { connectedCount: resolvable.length, usable, allowance };
  }

  /*
   * What Code's gate says that stops everyone in the project - the bill and
   * the plan - and so is said before why one person may not use a
   * repository, as Code says it (CodeTaskGate): a plan below the
   * repositories' own also reads as "may not edit the repository", which
   * would send people to an admin who cannot help either.
   */
  public static isEveryonesBlocker(
    blocker: CodeTaskBlocker | null | undefined,
  ): boolean {
    return (
      blocker?.type === CodeTaskBlockerType.SubscriptionUnpaid ||
      blocker?.type === CodeTaskBlockerType.PlanRequired
    );
  }

  /*
   * The repositories a person may pick for a fix no repository was found to
   * hold for certain: the connected ones they may use (getUsableRepositories),
   * by name - the first MAX_CODE_FIX_REPOSITORY_CHOICES of them. A
   * suggestion lists them to say a pick is asked for (more than one); the
   * page's picker searches the server for the pick, held to the same
   * repositories (#10921, #11075), and a pick is checked by itself
   * (checkRepositoryPick), so one past them is never refused.
   */
  public static getRepositoryChoices(
    use: CodeFixRepositoryUse,
  ): Array<CodeFixRepositoryChoice> {
    return use.usable
      .map((repository: ResolvableRepository): CodeFixRepositoryChoice => {
        const name: string =
          repository.name.trim() ||
          [repository.organizationName, repository.repositoryName]
            .filter(Boolean)
            .join("/") ||
          repository.id;

        return { id: repository.id, name };
      })
      .sort(
        (a: CodeFixRepositoryChoice, b: CodeFixRepositoryChoice): number => {
          return (
            a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
            a.id.localeCompare(b.id)
          );
        },
      )
      .slice(0, MAX_CODE_FIX_REPOSITORY_CHOICES);
  }

  /*
   * Why the person may not have the fix made in the repository they picked,
   * or null when they may: one of the project's they may read (else "not
   * found, or no access" - never whether it exists), may ask OneUptime AI
   * to work in (what changing it takes), and that is connected so AI can
   * work in it (getResolvableRepositories' rule). Asked of that one
   * repository, under the person's own permissions - never looked for
   * among a first page of them (#10921) - and as an error of its kind.
   */
  @CaptureSpan()
  public static async checkRepositoryPick(data: {
    projectId: ObjectID;
    pickedRepositoryId?: ObjectID | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<Exception | null> {
    const pickedId: string = data.pickedRepositoryId
      ? data.pickedRepositoryId.toString().trim().toLowerCase()
      : "";

    if (!ObjectID.isValidUUID(pickedId)) {
      return new BadDataException(PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE);
    }

    // Keyed as the database writes an id: lower-cased.
    const repositoryId: ObjectID = new ObjectID(pickedId);

    let readable: CodeRepository | null = null;

    try {
      readable = await CodeTaskAccess.findReadableRepository({
        props: data.props,
        projectId: data.projectId,
        repositoryId,
      });
    } catch (error) {
      if (!isReadRefusal(error)) {
        throw error;
      }
    }

    if (!readable) {
      return new NotFoundException(PICKED_REPOSITORY_NOT_FOUND_MESSAGE);
    }

    if (
      !(await CodeTaskAccess.canAskInRepository({
        props: data.props,
        projectId: data.projectId,
        repositoryId,
      }))
    ) {
      return new NotAuthorizedException(PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE);
    }

    if (
      !(await CodeTaskGate.isRepositoryReachable({
        projectId: data.projectId,
        repositoryId,
      }))
    ) {
      return new BadDataException(PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE);
    }

    return null;
  }

  // Whether the person may have the fix made in that repository (checkRepositoryPick).
  public static async isRepositoryChoice(data: {
    projectId: ObjectID;
    pickedRepositoryId?: ObjectID | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    return (await CodeFixPersonRepository.checkRepositoryPick(data)) === null;
  }

  /*
   * The repository a person's click has the run made in, and queued on:
   * the one they picked, when they may use it - else the one the run's
   * facts resolve to among the connected repositories they may use, or the
   * only one of those. The run is held to it when it is queued and again
   * when it starts: it is written into `taskContext`
   * (pickedCodeRepositoryId), which getRunRepositoryAllowance reads both
   * times, so it is never made in a repository the person may not use,
   * however the repositories change before it starts.
   *
   * Refused, in Code's order: what stops everyone in the project (the bill,
   * the plan); then why this person may not use the repository - a pick
   * they may not read, may not ask AI in, or that is not connected, or none
   * of the connected repositories theirs to ask in; then whatever else
   * Code's gate says about the repository; then a pick to make, when
   * several could hold the code and the run's facts match none.
   */
  @CaptureSpan()
  public static async decideRepository(data: {
    projectId: ObjectID;
    taskType: CodeFixTaskType;
    // The run's context, as it will be queued: its pin is written here.
    taskContext: CodeFixTaskContext;
    // Who clicked, as their request reads.
    person: DatabaseCommonInteractionProps;
    pickedRepositoryId?: ObjectID | undefined;
    // FixFromIncident: the record whose monitor names the repository.
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    refusals: CodeFixPersonRepositoryRefusals;
    // Overrides the IsBillingEnabled flag, for tests (CodeFixStartGate's own).
    billingEnabled?: boolean | undefined;
  }): Promise<ObjectID> {
    let allowance: CodeRepositoryAllowance = NO_CODE_REPOSITORY;
    let refusal: Exception | null = null;
    let usable: Array<ResolvableRepository> = [];

    if (data.pickedRepositoryId) {
      refusal = await CodeFixPersonRepository.checkRepositoryPick({
        projectId: data.projectId,
        pickedRepositoryId: data.pickedRepositoryId,
        props: data.person,
      });

      if (!refusal) {
        // Keyed as the database writes an id: lower-cased.
        const pickedId: string = data.pickedRepositoryId
          .toString()
          .trim()
          .toLowerCase();

        data.taskContext.pickedCodeRepositoryId = pickedId;
        allowance = { isEveryRepository: false, repositoryIds: [pickedId] };
      }
    } else {
      const use: CodeFixRepositoryUse =
        await CodeFixPersonRepository.getUsableRepositories({
          projectId: data.projectId,
          props: data.person,
        });

      usable = use.usable;
      allowance = use.allowance;

      if (use.connectedCount === 0) {
        refusal = new BadDataException(data.refusals.noConnectedRepository);
      } else if (use.usable.length === 0) {
        refusal = new NotAuthorizedException(NO_REPOSITORY_YOU_MAY_USE_MESSAGE);
      }
    }

    const start: CodeFixStart = await CodeFixStartGate.check({
      projectId: data.projectId,
      taskType: data.taskType,
      taskContext: data.taskContext,
      allowance,
      incidentId: data.incidentId,
      alertId: data.alertId,
      billingEnabled: data.billingEnabled,
    });

    if (
      start.blocker &&
      (!refusal || CodeFixPersonRepository.isEveryonesBlocker(start.blocker))
    ) {
      throw CodeTaskGate.toException(start.blocker);
    }

    if (refusal) {
      throw refusal;
    }

    /*
     * Somewhere to work: the pick, the repository the run's facts resolve
     * to, or the only one the person may use. Several they may use, and the
     * facts match none: the page asks for the pick first - a run queued
     * without one would find no repository when it starts.
     */
    const repositoryId: string | null =
      data.taskContext.pickedCodeRepositoryId ||
      start.codeRepositoryId?.toString().toLowerCase() ||
      (usable.length === 1 ? usable[0]!.id.toLowerCase() : null);

    if (!repositoryId) {
      throw new BadDataException(data.refusals.pickARepository);
    }

    data.taskContext.pickedCodeRepositoryId = repositoryId;

    return start.codeRepositoryId || new ObjectID(repositoryId);
  }
}

import ObjectID from "../../../../Types/ObjectID";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext from "../../../../Types/AI/CodeFixTaskContext";
import BadDataException from "../../../../Types/Exception/BadDataException";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Service from "../../../../Models/DatabaseModels/Service";
import ServiceService from "../../../Services/ServiceService";
import AIService from "../../../Services/AIService";
import SubjectCodeFixRun from "./SubjectCodeFixRun";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeFixPersonRepository, {
  CodeFixRepositoryUse,
} from "../CodeFix/CodeFixPersonRepository";
import CodeFixStartGate, { CodeFixStart } from "../CodeFix/CodeFixStartGate";
import CodeTaskThread from "../CodeTask/CodeTaskThread";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CodeRepositoryAllowance } from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import { CodeFixRepositoryChoice } from "../../../../Utils/Suggestions/CodeFixRepositoryPick";
import {
  getTelemetryImprovementOffer,
  NO_TELEMETRY_IMPROVEMENT_SUGGESTION,
  PICK_A_REPOSITORY_FOR_THE_IMPROVEMENT_MESSAGE,
  TelemetryImprovementSuggestion,
} from "../../../../Utils/Suggestions/TelemetryImprovementSuggestion";
import SuggestionOffer from "../../../../Utils/Suggestions/SuggestionOffer";

// No repository the agent could open the pull request in.
export const NO_CONNECTED_REPOSITORY_FOR_IMPROVEMENT_MESSAGE: string =
  "No connected repository exists for this project, so the agent has nowhere to open the pull request. Connect one in Code.";

/*
 * AI SRE — the service-scoped instrumentation-improvement triggers:
 * ImproveLogging and ImproveTracing. One click on a service's Logs or
 * Traces page opens a PR that improves that service's logging or
 * tracing hygiene — parameterized log messages, correct severities, spans
 * on uninstrumented paths, proper exception recording — WITHOUT changing
 * behavior.
 *
 * Like FixFromIncident and FixPerformance these are human-triggered from a
 * user-facing endpoint (POST /ai-investigation/
 * create-telemetry-improvement-task), so there is no per-feature opt-in —
 * the human in the loop IS the gate, under the project's one AI switch —
 * and every unmet gate FAILS EARLY with a clear message. The recipe's
 * grounding is the SERVICE: repository resolution at task-details time
 * uses the service name (name-match / only-repository), the same path the
 * incident-subject recipes use.
 *
 * The service's page asks first (getSuggestion, POST /ai-investigation/
 * telemetry-improvement-suggestion) and draws the card only when these same
 * gates would let the click through - Code's own gate among them
 * (CodeFixStartGate: the plan, AI credits or an LLM provider, the daily AI
 * limit, a Runner online for the repository the run will be queued on).
 *
 * WHO MAY START ONE, AND IN WHICH REPOSITORY (#11209): the click starts a
 * code task on the person's behalf, so it is held to the repositories they
 * may use in Code - read, and ask OneUptime AI to work in - as every Fix
 * with AI is (CodeFixPersonRepository). A pick they may not use is
 * refused, without one the service's name is resolved among theirs only,
 * and the run is held to the repository decided, when it is queued and
 * when it starts. It used to be made wherever the service's name pointed,
 * for anyone who may read the service. There is no automatic form.
 */
export default class TelemetryImprovementTaskTrigger {
  /*
   * What a service's Logs or Traces page offers: the card (Act), a link to
   * the improvement already on its way (InProgress), or nothing (None) -
   * decided by the gates createTelemetryImprovementTask enforces: AI on, a
   * repository, no task of the same recipe on its way for the service (a
   * reply in Code included), and nothing Code's gate says stops the run.
   * The caller has already checked the person may read the service.
   *
   * The improvement on its way is read as its task's own page reads it,
   * for `reader`: one a reply carried a private incident or alert into,
   * which they do not see, is there - no second one is offered - and
   * nothing of it, not even the link to it (None).
   *
   * And by the rule the click is held to (CodeFixPersonRepository, #11209):
   * the run is resolved among the repositories `reader` may use in Code,
   * with the ones to pick from when the service's name matches none of
   * them, and a reader who may use none is offered nothing.
   */
  @CaptureSpan()
  public static async getSuggestion(data: {
    projectId: ObjectID;
    telemetryServiceId: ObjectID;
    taskType: CodeFixTaskType;
    reader: DatabaseCommonInteractionProps;
  }): Promise<TelemetryImprovementSuggestion> {
    if (
      data.taskType !== CodeFixTaskType.ImproveLogging &&
      data.taskType !== CodeFixTaskType.ImproveTracing
    ) {
      return NO_TELEMETRY_IMPROVEMENT_SUGGESTION;
    }

    const isAiEnabled: boolean = await AIService.isProjectAIEnabled(
      data.projectId,
    );

    if (!isAiEnabled) {
      return NO_TELEMETRY_IMPROVEMENT_SUGGESTION;
    }

    const activeRun: AIRun | null =
      await SubjectCodeFixRun.findNonTerminalRunForTelemetryService({
        projectId: data.projectId,
        taskType: data.taskType,
        telemetryServiceId: data.telemetryServiceId.toString(),
      });

    // Its task: a fix asked again or a reply is a later turn of it.
    const activeTaskId: ObjectID | null = SubjectCodeFixRun.taskIdOf(activeRun);

    if (
      activeTaskId &&
      (
        await CodeTaskThread.findTasksHiddenFrom({
          projectId: data.projectId,
          taskIds: [activeTaskId],
          reader: data.reader,
        })
      ).size > 0
    ) {
      return NO_TELEMETRY_IMPROVEMENT_SUGGESTION;
    }

    let hasConnectedRepository: boolean = activeRun
      ? true
      : await SubjectCodeFixRun.hasConnectedRepository(data.projectId);

    /*
     * The connected repositories the reader may use in Code (#11209),
     * weighed only where they decide the answer: nothing in flight, and a
     * repository to work in.
     */
    let use: CodeFixRepositoryUse | null = null;

    if (!activeRun && hasConnectedRepository) {
      use = await CodeFixPersonRepository.getUsableRepositories({
        projectId: data.projectId,
        props: data.reader,
      });
      hasConnectedRepository = use.connectedCount > 0;
    }

    /*
     * Code's gate, asked only where it decides the answer: nothing in
     * flight, and a repository to work in.
     */
    let isBlocked: boolean = false;
    // The repositories to pick from, when the service's name matches none.
    let repositories: Array<CodeFixRepositoryChoice> = [];

    if (use && hasConnectedRepository) {
      /*
       * None of them the reader's to ask AI in: nothing they could do here
       * would start the improvement (the card draws nothing for what stops
       * it, the bill and the plan included).
       */
      if (use.usable.length === 0) {
        return NO_TELEMETRY_IMPROVEMENT_SUGGESTION;
      }

      const start: CodeFixStart =
        await TelemetryImprovementTaskTrigger.checkStart({
          projectId: data.projectId,
          telemetryServiceId: data.telemetryServiceId,
          taskType: data.taskType,
          // Among the repositories the reader may use, as a click is.
          allowance: use.allowance,
        });

      isBlocked = Boolean(start.blocker);

      if (!start.codeRepositoryId) {
        repositories = CodeFixPersonRepository.getRepositoryChoices(use);
      }
    }

    const offer: SuggestionOffer = getTelemetryImprovementOffer({
      isAiEnabled: true,
      hasActiveFix: Boolean(activeRun),
      hasConnectedRepository,
      isBlocked,
    });

    return {
      offer,
      aiRunId:
        offer === SuggestionOffer.InProgress
          ? activeTaskId?.toString() || null
          : null,
      // One repository is no choice; a pick is the card's own step.
      repositories:
        offer === SuggestionOffer.Act && repositories.length > 1
          ? repositories
          : [],
    };
  }

  // The context an ImproveLogging / ImproveTracing run carries.
  public static buildTaskContext(data: {
    telemetryServiceId: ObjectID;
    serviceName?: string | undefined;
  }): CodeFixTaskContext {
    return {
      telemetryServiceId: data.telemetryServiceId.toString(),
      serviceName: data.serviceName || undefined,
    };
  }

  /*
   * What Code's gate says about the run the card would queue, and the
   * repository it would be queued on - found from the service's name, as
   * the run finds it (CodeFixRunRepository), among the repositories the
   * person may use (`allowance`, CodeFixPersonRepository). The name is read
   * as OneUptime: the caller has checked the person may read the service.
   */
  @CaptureSpan()
  public static async checkStart(data: {
    projectId: ObjectID;
    telemetryServiceId: ObjectID;
    taskType: CodeFixTaskType;
    serviceName?: string | undefined;
    // The repositories the person may use in Code (#11209).
    allowance: CodeRepositoryAllowance;
  }): Promise<CodeFixStart> {
    let serviceName: string | undefined = data.serviceName;

    if (serviceName === undefined) {
      const service: Service | null = await ServiceService.findOneById({
        id: data.telemetryServiceId,
        select: { _id: true, name: true },
        props: { isRoot: true },
      });

      serviceName = service?.name || undefined;
    }

    return CodeFixStartGate.check({
      projectId: data.projectId,
      taskType: data.taskType,
      taskContext: TelemetryImprovementTaskTrigger.buildTaskContext({
        telemetryServiceId: data.telemetryServiceId,
        serviceName,
      }),
      allowance: data.allowance,
    });
  }

  /*
   * Gate and enqueue an ImproveLogging / ImproveTracing CodeFix run for a
   * telemetry service. The caller must already have loaded the service
   * under the USER's permissions (the access check). The repository the run
   * works in is held to the ones the person may use in Code, under `props`
   * (#11209); everything else is read and written as root.
   *
   * Throws naming the failed gate: unsupported recipe, AI switched off for
   * the project, no connected repository, a duplicate active run for the
   * same service, a repository the person may not use (a pick they may not
   * read or ask AI in, or none of the connected ones theirs to ask in),
   * what Code's gate says about the run (CodeFixStartGate, as an error of
   * its kind: the plan and the bill first, as payment required), a pick to
   * make, or (via enqueueSubjectCodeFixRun) the daily fix-run budget.
   */
  @CaptureSpan()
  public static async createTelemetryImprovementTask(data: {
    projectId: ObjectID;
    telemetryServiceId: ObjectID;
    taskType: CodeFixTaskType;
    userId: ObjectID;
    // Who clicked, as their request reads: whose repositories the run may use.
    props: DatabaseCommonInteractionProps;
    /*
     * The repository the person picked, when the card asked for a pick:
     * several are theirs, and none is named like the service.
     */
    repositoryId?: ObjectID | undefined;
  }): Promise<AIRun> {
    if (
      data.taskType !== CodeFixTaskType.ImproveLogging &&
      data.taskType !== CodeFixTaskType.ImproveTracing
    ) {
      throw new BadDataException(
        `Task type "${data.taskType}" is not a telemetry-improvement recipe. Supported: ${CodeFixTaskType.ImproveLogging}, ${CodeFixTaskType.ImproveTracing}.`,
      );
    }

    // The project's one AI switch, before anything else is read.
    await AIService.assertProjectAIEnabled(data.projectId);

    const service: Service | null = await ServiceService.findOneById({
      id: data.telemetryServiceId,
      select: {
        _id: true,
        name: true,
        projectId: true,
      },
      props: { isRoot: true },
    });

    if (
      !service ||
      service.projectId?.toString() !== data.projectId.toString()
    ) {
      throw new BadDataException("Telemetry service not found.");
    }

    // Gate — a repository the agent can actually open a PR against.
    const hasConnectedRepository: boolean =
      await SubjectCodeFixRun.hasConnectedRepository(data.projectId);

    if (!hasConnectedRepository) {
      throw new BadDataException(
        NO_CONNECTED_REPOSITORY_FOR_IMPROVEMENT_MESSAGE,
      );
    }

    /*
     * Gate — per-(service, recipe) dedupe: repeated clicks must not fan
     * out into duplicate PRs.
     */
    const existingRun: AIRun | null =
      await SubjectCodeFixRun.findNonTerminalRunForTelemetryService({
        projectId: data.projectId,
        taskType: data.taskType,
        telemetryServiceId: data.telemetryServiceId.toString(),
      });

    if (existingRun) {
      throw new BadDataException(
        `An ${
          data.taskType === CodeFixTaskType.ImproveLogging
            ? "improve-logging"
            : "improve-tracing"
        } task is already queued or running for this service. Track its progress in Code.`,
      );
    }

    const taskContext: CodeFixTaskContext =
      TelemetryImprovementTaskTrigger.buildTaskContext({
        telemetryServiceId: data.telemetryServiceId,
        serviceName: service.name || undefined,
      });

    /*
     * Gate — the repository the person's click has the run made in, among
     * the ones they may use in Code, with what Code's gate says about it -
     * the bill and the plan first (CodeFixPersonRepository, #11209). The
     * run is queued on that very repository, and held to it when it starts.
     */
    const codeRepositoryId: ObjectID =
      await CodeFixPersonRepository.decideRepository({
        projectId: data.projectId,
        taskType: data.taskType,
        taskContext,
        person: data.props,
        pickedRepositoryId: data.repositoryId,
        refusals: {
          noConnectedRepository:
            NO_CONNECTED_REPOSITORY_FOR_IMPROVEMENT_MESSAGE,
          pickARepository: PICK_A_REPOSITORY_FOR_THE_IMPROVEMENT_MESSAGE,
        },
      });

    return SubjectCodeFixRun.enqueueSubjectCodeFixRun({
      projectId: data.projectId,
      taskType: data.taskType,
      userId: data.userId,
      taskContext,
      codeRepositoryId,
    });
  }
}

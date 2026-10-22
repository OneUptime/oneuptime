import Project from "../../../Models/DatabaseModels/Project";
import Runner from "../../../Models/DatabaseModels/Runner";
import ObjectID from "../../../Types/ObjectID";
import { canGlobalRunnersRunStepType } from "../../../Types/Runner/GlobalRunnerWork";
import {
  ChosenRunnerKind,
  RunnerChoiceDecision,
  RunnerDefaultOrderResult,
  decideRunnerByDefaultOrder,
  getChosenRunnerId,
  isGlobalRunnerChoice,
  isRunnerId,
  toRunnerChoiceDecision,
} from "../../../Types/Runner/RunnerChoice";
import ProjectService from "../../Services/ProjectService";
import RunnerService from "../../Services/RunnerService";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * Where work runs, on the server: the facts the one rule needs
 * (Types/Runner/RunnerChoice, the default order), read as OneUptime, then
 * the rule.
 *
 *   - the Runner the work picked, if it picked one: one of the work's own
 *     project's Runners (a pick wins), a global Runner (the Global Runner,
 *     as if it picked GLOBAL_RUNNER_CHOICE_ID), or neither - deleted, or
 *     another project's, which is refused rather than waited on;
 *   - for work that picked none: its project's default Runner
 *     (RunnerService.findProjectDefaultRunner), which runs it when there is
 *     one;
 *   - for work that ends up on the global Runners: whether global Runners
 *     may run it, whether its project uses them, and whether the server has
 *     one.
 *
 * Every Runner-run step is routed through decideForStep once, when the
 * Worker reaches it (Runbook/Services/StepExecutors). Anything else that
 * picks a Runner - an auto remediation or investigation rule - asks
 * decideByDefaultOrder with whether global Runners may run its work, and
 * words the answer itself.
 */
export default class GlobalRunnerChoice {
  @CaptureSpan()
  public static async decideForStep(data: {
    projectId: ObjectID;
    stepType: string;
    chosenRunnerId: unknown;
  }): Promise<RunnerChoiceDecision> {
    const result: RunnerDefaultOrderResult =
      await GlobalRunnerChoice.decideByDefaultOrder({
        projectId: data.projectId,
        chosenRunnerId: data.chosenRunnerId,
        canGlobalRunnersRunWork: canGlobalRunnersRunStepType(data.stepType),
      });

    return toRunnerChoiceDecision({
      result,
      stepType: data.stepType,
      chosenRunnerId: getChosenRunnerId(data.chosenRunnerId),
    });
  }

  /*
   * The default order for any work of a project that picks a Runner: its
   * own pick, its project's default Runner, the Global Runner where
   * `canGlobalRunnersRunWork` - otherwise none, with the reason. Each fact
   * is read only when the order reaches it.
   */
  @CaptureSpan()
  public static async decideByDefaultOrder(data: {
    projectId: ObjectID;
    // As stored: "", GLOBAL_RUNNER_CHOICE_ID or a Runner's id.
    chosenRunnerId: unknown;
    canGlobalRunnersRunWork: boolean;
  }): Promise<RunnerDefaultOrderResult> {
    const chosenRunnerId: string = getChosenRunnerId(data.chosenRunnerId);
    const picksGlobalRunner: boolean = isGlobalRunnerChoice(chosenRunnerId);

    let chosenRunnerKind: ChosenRunnerKind | undefined = undefined;

    if (chosenRunnerId && !picksGlobalRunner && isRunnerId(chosenRunnerId)) {
      chosenRunnerKind = await GlobalRunnerChoice.getChosenRunnerKind({
        projectId: data.projectId,
        runnerId: new ObjectID(chosenRunnerId),
      });
    }

    // Read only for work that picked none: a pick never follows it.
    const projectDefaultRunnerId: string = chosenRunnerId
      ? ""
      : await GlobalRunnerChoice.findProjectDefaultRunnerId(data.projectId);

    /*
     * The project's switch and the server's global Runners decide only
     * work that ends up on the global Runners, so they are read only for
     * such work: a pick of the project's own, a project default, or work
     * global Runners never run needs neither.
     */
    const goesGlobal: boolean =
      data.canGlobalRunnersRunWork &&
      (picksGlobalRunner ||
        chosenRunnerKind === ChosenRunnerKind.GlobalRunner ||
        (!chosenRunnerId && !projectDefaultRunnerId));

    const projectUsesGlobalRunners: boolean = goesGlobal
      ? await GlobalRunnerChoice.doesProjectUseGlobalRunners(data.projectId)
      : false;

    const hasGlobalRunner: boolean =
      goesGlobal && projectUsesGlobalRunners
        ? await RunnerService.hasGlobalRunnerForRunbooks()
        : false;

    return decideRunnerByDefaultOrder({
      chosenRunnerId,
      ...(chosenRunnerKind ? { chosenRunnerKind } : {}),
      projectDefaultRunnerId,
      canGlobalRunnersRunWork: data.canGlobalRunnersRunWork,
      projectUsesGlobalRunners,
      hasGlobalRunner,
    });
  }

  /*
   * The id of the project's default Runner, or "" when it has none that
   * may be it (RunnerService.findProjectDefaultRunner).
   */
  @CaptureSpan()
  public static async findProjectDefaultRunnerId(
    projectId: ObjectID,
  ): Promise<string> {
    const runner: Runner | null =
      await RunnerService.findProjectDefaultRunner(projectId);

    return runner?._id?.toString() || "";
  }

  /*
   * What the picked Runner is: one of `projectId`'s own, a global one, or
   * neither. Read as OneUptime and held to the project here, so a step can
   * never be pointed at another project's Runner.
   */
  @CaptureSpan()
  public static async getChosenRunnerKind(data: {
    projectId: ObjectID;
    runnerId: ObjectID;
  }): Promise<ChosenRunnerKind> {
    const runner: Runner | null = await RunnerService.findOneById({
      id: data.runnerId,
      select: {
        _id: true,
        projectId: true,
        isGlobalRunner: true,
      },
      props: { isRoot: true },
    });

    if (!runner) {
      return ChosenRunnerKind.NotFound;
    }

    if (runner.isGlobalRunner) {
      return ChosenRunnerKind.GlobalRunner;
    }

    if (
      runner.projectId &&
      runner.projectId.toString().toLowerCase() ===
        data.projectId.toString().toLowerCase()
    ) {
      return ChosenRunnerKind.ProjectRunner;
    }

    return ChosenRunnerKind.NotFound;
  }

  /*
   * Project.useGlobalRunners, on unless the project turned it off. A project
   * that cannot be read is not taken as having said yes.
   */
  @CaptureSpan()
  public static async doesProjectUseGlobalRunners(
    projectId: ObjectID,
  ): Promise<boolean> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        _id: true,
        useGlobalRunners: true,
      },
      props: { isRoot: true },
    });

    return Boolean(project) && project?.useGlobalRunners !== false;
  }
}

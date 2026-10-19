import Project from "../../../Models/DatabaseModels/Project";
import Runner from "../../../Models/DatabaseModels/Runner";
import ObjectID from "../../../Types/ObjectID";
import { canGlobalRunnersRunStepType } from "../../../Types/Runner/GlobalRunnerWork";
import {
  ChosenRunnerKind,
  RunnerChoiceDecision,
  decideRunnerChoice,
  getChosenRunnerId,
  isRunnerId,
} from "../../../Types/Runner/RunnerChoice";
import ProjectService from "../../Services/ProjectService";
import RunnerService from "../../Services/RunnerService";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * Where a step runs, on the server: the facts the one "global by default"
 * rule needs (Types/Runner/RunnerChoice), read as OneUptime, then the rule.
 *
 *   - the Runner the step picked, if it picked one: one of the step's own
 *     project's Runners (a custom pick wins), a global Runner (the global
 *     Runners, as if it picked none), or neither - deleted, or another
 *     project's, which is refused rather than waited on;
 *   - for a step that picked none and that global Runners can run: whether
 *     its project uses global Runners, and whether the server has one.
 *
 * Every Runner-run step is routed through this once, when the Worker
 * reaches it (Runbook/Services/StepExecutors), and anything else that picks
 * a Runner the same way can ask it too.
 */
export default class GlobalRunnerChoice {
  @CaptureSpan()
  public static async decideForStep(data: {
    projectId: ObjectID;
    stepType: string;
    chosenRunnerId: unknown;
  }): Promise<RunnerChoiceDecision> {
    const chosenRunnerId: string = getChosenRunnerId(data.chosenRunnerId);

    let chosenRunnerKind: ChosenRunnerKind | undefined = undefined;

    if (chosenRunnerId && isRunnerId(chosenRunnerId)) {
      chosenRunnerKind = await GlobalRunnerChoice.getChosenRunnerKind({
        projectId: data.projectId,
        runnerId: new ObjectID(chosenRunnerId),
      });
    }

    /*
     * The project's switch and the server's global Runners decide only a
     * step that ends up on the global Runners, so they are read only for
     * one: a custom pick, or a step global Runners never run, needs neither.
     */
    const mayGoGlobal: boolean =
      canGlobalRunnersRunStepType(data.stepType) &&
      (!chosenRunnerId || chosenRunnerKind === ChosenRunnerKind.GlobalRunner);

    const projectUsesGlobalRunners: boolean = mayGoGlobal
      ? await GlobalRunnerChoice.doesProjectUseGlobalRunners(data.projectId)
      : false;

    const hasGlobalRunner: boolean =
      mayGoGlobal && projectUsesGlobalRunners
        ? await RunnerService.hasGlobalRunnerForRunbooks()
        : false;

    return decideRunnerChoice({
      stepType: data.stepType,
      chosenRunnerId,
      ...(chosenRunnerKind ? { chosenRunnerKind } : {}),
      projectUsesGlobalRunners,
      hasGlobalRunner,
    });
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

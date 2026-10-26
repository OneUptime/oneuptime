import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { getRunnerLiveStatus } from "Common/Types/Runner/RunnerLiveStatus";
import { canBeProjectDefaultRunner } from "Common/Types/Runner/ProjectDefaultRunner";
import { APP_API_URL } from "Common/UI/Config";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Project from "Common/Models/DatabaseModels/Project";
import Runner from "Common/Models/DatabaseModels/Runner";
import { RunnerPickerRunner } from "./RunnerPickerModel";
import { isKubernetesAgentRunnerRow } from "../../Pages/Kubernetes/Utils/KubernetesAgentRunner";

/*
 * What a Runner picker needs to know, loaded once by the page that shows
 * one (Runbooks -> a runbook -> Steps; Code -> a repository -> Settings; and
 * any other page that lets people pick a Runner): the project's own
 * Runners - with which of them is the project's default Runner, the one a
 * step that picks no Runner runs on - the global Runners - the ones
 * OneUptime runs for every project, from their own endpoint since no
 * project owns them - and whether the project uses them
 * (Project.useGlobalRunners).
 *
 * A code repository's picker (loadForCodeRepository) keeps every global
 * Runner, whether or not it takes runbook steps now - each takes the AI work
 * of every repository on the Global Runner - and leaves out the in-cluster
 * Runners the Kubernetes agent chart installed, which never work in a
 * repository.
 */

export interface GlobalRunnerRow extends RunnerPickerRunner {
  description: string;
  runsRunbooks: boolean;
}

export interface RunnerChoices {
  projectRunners: Array<RunnerPickerRunner>;
  /*
   * The global Runners that take the work: for a step or a rule, the ones
   * that run runbook steps; for a code repository, every one.
   */
  globalRunners: Array<GlobalRunnerRow>;
  projectUsesGlobalRunners: boolean;
  /*
   * The project's own Runners could not be read - the reader may not read
   * Runners, or the read failed - so projectRunners is empty without the
   * project being known to have none. A picker then says nothing about
   * adding one.
   */
  areProjectRunnersUnread?: boolean | undefined;
}

export const GLOBAL_RUNNERS_ROUTE: string = "/runner/global-runners";

export function getGlobalRunnersUrl(): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(GLOBAL_RUNNERS_ROUTE);
}

export default class RunnerChoicesLoader {
  public static async load(projectId: ObjectID): Promise<RunnerChoices> {
    const [projectRunners, globalRunners, projectUsesGlobalRunners]: [
      Array<RunnerPickerRunner>,
      Array<GlobalRunnerRow>,
      boolean,
    ] = await Promise.all([
      RunnerChoicesLoader.loadProjectRunners(projectId),
      RunnerChoicesLoader.loadGlobalRunners(),
      RunnerChoicesLoader.loadProjectUsesGlobalRunners(projectId),
    ]);

    return {
      projectRunners,
      globalRunners: globalRunners.filter((runner: GlobalRunnerRow) => {
        return runner.runsRunbooks;
      }),
      projectUsesGlobalRunners,
    };
  }

  /*
   * A code repository's Runner picker: the project's own Runners a
   * repository may pick, every global Runner (each takes the AI work of the
   * repositories on the Global Runner, whether or not it runs runbook steps
   * now), and the project's switch for global Runners.
   *
   * Each is read on its own: someone who may change a repository's settings
   * but not read Runners (Settings Member) is still told the repository is
   * on Global Runner and how it is doing - not that the server runs none -
   * and a Runner it picks is one they do not have access to.
   */
  public static async loadForCodeRepository(
    projectId: ObjectID,
  ): Promise<RunnerChoices> {
    const [projectRunners, globalRunners, projectUsesGlobalRunners]: [
      Array<RunnerPickerRunner>,
      Array<GlobalRunnerRow>,
      boolean,
    ] = await Promise.all([
      RunnerChoicesLoader.loadProjectRunners(projectId, {
        forCodeRepository: true,
      }).catch((): Array<RunnerPickerRunner> => {
        return [];
      }),
      RunnerChoicesLoader.loadGlobalRunners(),
      RunnerChoicesLoader.loadProjectUsesGlobalRunners(projectId),
    ]);

    return {
      projectRunners,
      globalRunners,
      projectUsesGlobalRunners,
    };
  }

  /*
   * An AI rule's Runner picker: the project's own Runners a rule may pick
   * for OneUptime AI's commands - never the in-cluster Runners the
   * Kubernetes agent chart installed, which run kubectl for their own
   * cluster only - and, as for a step, the global Runners that run runbook
   * steps and the project's switch for them. A rule that picks none shows
   * the Global Runner where the project uses one: it runs none of the
   * rule's commands - a shell never runs on a host every project shares - so
   * picking it picks no Runner of the project's own
   * (RunnerPickerWork.AutoRemediation).
   *
   * Each is read on its own: someone who may change a rule but not read
   * Runners is still shown the rule's choice - the Global Runner, "No
   * Runner", or a Runner they do not have access to.
   */
  public static async loadForRemediation(
    projectId: ObjectID,
  ): Promise<RunnerChoices> {
    let areProjectRunnersUnread: boolean = false;

    const [projectRunners, globalRunners, projectUsesGlobalRunners]: [
      Array<RunnerPickerRunner>,
      Array<GlobalRunnerRow>,
      boolean,
    ] = await Promise.all([
      RunnerChoicesLoader.loadProjectRunners(projectId, {
        forCodeRepository: true,
      }).catch((): Array<RunnerPickerRunner> => {
        areProjectRunnersUnread = true;
        return [];
      }),
      RunnerChoicesLoader.loadGlobalRunners(),
      RunnerChoicesLoader.loadProjectUsesGlobalRunners(projectId),
    ]);

    return {
      projectRunners,
      globalRunners: globalRunners.filter((runner: GlobalRunnerRow) => {
        return runner.runsRunbooks;
      }),
      projectUsesGlobalRunners,
      areProjectRunnersUnread,
    };
  }

  /*
   * The project's own Runners. For a code repository - and an auto
   * remediation rule, which picks the same way - without the in-cluster
   * Runners the Kubernetes agent chart installed: they run kubectl for their
   * cluster only, and the server refuses a repository or a rule that picks
   * one.
   *
   * The project's default Runner is marked (isProjectDefault) only when it
   * may be it - the rule the server reads it by (ProjectDefaultRunner) - so
   * the picker never offers as the default a Runner the server would pass
   * over.
   */
  public static async loadProjectRunners(
    projectId: ObjectID,
    options?: { forCodeRepository?: boolean | undefined } | undefined,
  ): Promise<Array<RunnerPickerRunner>> {
    const forCodeRepository: boolean = Boolean(options?.forCodeRepository);

    const result: ListResult<Runner> = await ModelAPI.getList<Runner>({
      modelType: Runner,
      query: {
        projectId: projectId,
      },
      select: {
        _id: true,
        name: true,
        lastAlive: true,
        // Which is the default, and whether it may be it.
        isProjectDefault: true,
        canRunRunbooks: true,
        hostInfo: true,
      },
      sort: { name: SortOrder.Ascending },
      limit: LIMIT_MAX,
      skip: 0,
    });

    return result.data
      .filter((runner: Runner): boolean => {
        return !forCodeRepository || !isKubernetesAgentRunnerRow(runner);
      })
      .map((runner: Runner): RunnerPickerRunner => {
        const pickerRunner: RunnerPickerRunner = {
          id: runner._id?.toString() || "",
          name: runner.name || "Unnamed Runner",
          liveStatus: getRunnerLiveStatus(runner.lastAlive),
        };

        if (
          runner.isProjectDefault === true &&
          canBeProjectDefaultRunner(runner)
        ) {
          pickerRunner.isProjectDefault = true;
        }

        return pickerRunner;
      });
  }

  /*
   * The project's default Runner, by its id and name - what Runbooks ->
   * Runners and a Runner's own page say about it, and what the dialogs that
   * change it name - or null when the project has none (or none that may
   * be it: the rule the server reads it by, ProjectDefaultRunner). Throws
   * when the Runners cannot be read, so a page can claim nothing.
   */
  public static async loadProjectDefaultRunner(
    projectId: ObjectID,
  ): Promise<{ id: string; name: string } | null> {
    const result: ListResult<Runner> = await ModelAPI.getList<Runner>({
      modelType: Runner,
      query: {
        projectId: projectId,
        isProjectDefault: true,
      },
      select: {
        _id: true,
        name: true,
        isProjectDefault: true,
        canRunRunbooks: true,
        hostInfo: true,
      },
      sort: {},
      limit: 1,
      skip: 0,
    });

    const runner: Runner | undefined = result.data[0];

    if (
      !runner ||
      runner.isProjectDefault !== true ||
      !canBeProjectDefaultRunner(runner)
    ) {
      return null;
    }

    return {
      id: runner._id?.toString() || "",
      name: runner.name || "Unnamed Runner",
    };
  }

  /*
   * Every global Runner, whether or not it takes runbook steps right now
   * (runsRunbooks): the Runners page lists them all, and every one takes the
   * AI work of the repositories on the Global Runner. A server that cannot
   * say (an older one, or a failed read) has none to offer, so the picker
   * falls back to the project's own Runners rather than failing the page.
   */
  public static async loadGlobalRunners(): Promise<Array<GlobalRunnerRow>> {
    try {
      const result: ListResult<Runner> = await ModelAPI.getList<Runner>({
        modelType: Runner,
        query: {},
        select: {
          _id: true,
          name: true,
          description: true,
          lastAlive: true,
          canRunRunbooks: true,
        },
        sort: {},
        limit: LIMIT_MAX,
        skip: 0,
        requestOptions: {
          overrideRequestUrl: getGlobalRunnersUrl(),
        },
      });

      return result.data.map((runner: Runner): GlobalRunnerRow => {
        return {
          id: runner._id?.toString() || "",
          name: runner.name || "Global Runner",
          description: runner.description || "",
          liveStatus: getRunnerLiveStatus(runner.lastAlive),
          runsRunbooks: runner.canRunRunbooks !== false,
        };
      });
    } catch {
      return [];
    }
  }

  /*
   * Project.useGlobalRunners, which is on unless the project turned it off.
   * Read as the person reading the page; one who may not read it is shown
   * what a project starts with, and the server decides when the step runs.
   */
  public static async loadProjectUsesGlobalRunners(
    projectId: ObjectID,
  ): Promise<boolean> {
    try {
      const project: Project | null = await ModelAPI.getItem<Project>({
        modelType: Project,
        id: projectId,
        select: {
          useGlobalRunners: true,
        },
      });

      return project?.useGlobalRunners !== false;
    } catch {
      return true;
    }
  }
}

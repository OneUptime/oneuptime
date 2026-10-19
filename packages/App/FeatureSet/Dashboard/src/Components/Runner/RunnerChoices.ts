import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { getRunnerLiveStatus } from "Common/Types/Runner/RunnerLiveStatus";
import { APP_API_URL } from "Common/UI/Config";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Project from "Common/Models/DatabaseModels/Project";
import Runner from "Common/Models/DatabaseModels/Runner";
import { RunnerPickerRunner } from "./RunnerPickerModel";

/*
 * What a Runner picker needs to know, loaded once by the page that shows
 * one (Runbooks -> a runbook -> Steps; and any other page that lets people
 * pick a Runner): the project's own Runners, the global Runners - the ones
 * OneUptime runs for every project, from their own endpoint since no project
 * owns them - and whether the project uses them (Project.useGlobalRunners).
 */

export interface GlobalRunnerRow extends RunnerPickerRunner {
  description: string;
  runsRunbooks: boolean;
}

export interface RunnerChoices {
  projectRunners: Array<RunnerPickerRunner>;
  // The global Runners that run runbook steps.
  globalRunners: Array<GlobalRunnerRow>;
  projectUsesGlobalRunners: boolean;
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

  public static async loadProjectRunners(
    projectId: ObjectID,
  ): Promise<Array<RunnerPickerRunner>> {
    const result: ListResult<Runner> = await ModelAPI.getList<Runner>({
      modelType: Runner,
      query: {
        projectId: projectId,
      },
      select: {
        _id: true,
        name: true,
        lastAlive: true,
      },
      sort: { name: SortOrder.Ascending },
      limit: LIMIT_MAX,
      skip: 0,
    });

    return result.data.map((runner: Runner): RunnerPickerRunner => {
      return {
        id: runner._id?.toString() || "",
        name: runner.name || "Unnamed Runner",
        liveStatus: getRunnerLiveStatus(runner.lastAlive),
      };
    });
  }

  /*
   * Every global Runner, whether or not it takes runbook steps right now
   * (runsRunbooks): the Runners page lists them all. A server that cannot
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

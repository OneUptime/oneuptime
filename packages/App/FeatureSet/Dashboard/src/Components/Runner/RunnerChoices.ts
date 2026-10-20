import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RunnerLiveStatus, {
  getRunnerLiveStatus,
} from "Common/Types/Runner/RunnerLiveStatus";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Project from "Common/Models/DatabaseModels/Project";
import Runner from "Common/Models/DatabaseModels/Runner";
import { RunnerPickerRunner } from "./RunnerPickerModel";
import { isKubernetesAgentRunnerRow } from "../../Pages/Kubernetes/Utils/KubernetesAgentRunner";

/*
 * What a Runner picker needs to know, loaded once by the page that shows
 * one (Runbooks -> a runbook -> Steps; Code -> a repository -> Settings; and
 * any other page that lets people pick a Runner): the project's own
 * Runners, the global Runners - the ones OneUptime runs for every project,
 * from their own endpoint since no project owns them - and whether the
 * project uses them (Project.useGlobalRunners).
 *
 * A code repository's picker (loadForCodeRepository) reads the global
 * Runners for code instead - the ones that take the AI work of every
 * repository that picks none - and leaves out the in-cluster Runners the
 * Kubernetes agent chart installed, which never work in a repository.
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

// The global Runners for code (Common/Server/API/RunnerAPI).
export const GLOBAL_CODE_RUNNERS_ROUTE: string = "/runner/global-code-runners";

export function getGlobalRunnersUrl(): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(GLOBAL_RUNNERS_ROUTE);
}

export function getGlobalCodeRunnersUrl(): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    GLOBAL_CODE_RUNNERS_ROUTE,
  );
}

// A status the server named, or Never connected for one it did not.
export function readGlobalCodeRunnerLiveStatus(
  value: unknown,
): RunnerLiveStatus {
  return Object.values(RunnerLiveStatus).includes(value as RunnerLiveStatus)
    ? (value as RunnerLiveStatus)
    : RunnerLiveStatus.NeverConnected;
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
   * repository may pick, the global Runners for code, and the project's
   * switch for global Runners.
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
      RunnerChoicesLoader.loadGlobalCodeRunners(),
      RunnerChoicesLoader.loadProjectUsesGlobalRunners(projectId),
    ]);

    return {
      projectRunners,
      globalRunners,
      projectUsesGlobalRunners,
    };
  }

  /*
   * An auto remediation rule's Runner picker: the project's own Runners a
   * rule may pick for OneUptime AI's commands - never the in-cluster Runners
   * the Kubernetes agent chart installed, which run kubectl for their own
   * cluster only - and no global Runners: they never run OneUptime AI's
   * commands, so the picker's first choice is no Runner at all
   * (RunnerPickerWork.AutoRemediation).
   *
   * Someone who may change a rule but not read Runners is still shown the
   * rule's choice: none, or a Runner they do not have access to.
   */
  public static async loadForRemediation(
    projectId: ObjectID,
  ): Promise<RunnerChoices> {
    const projectRunners: Array<RunnerPickerRunner> =
      await RunnerChoicesLoader.loadProjectRunners(projectId, {
        forCodeRepository: true,
      }).catch((): Array<RunnerPickerRunner> => {
        return [];
      });

    return {
      projectRunners,
      globalRunners: [],
      projectUsesGlobalRunners: true,
    };
  }

  /*
   * The Runners a Kubernetes cluster's AI settings may bind for OneUptime
   * AI's kubectl (the cluster's AI → Agent page, an advanced binding): the
   * project's own, as rows - the page tells the in-cluster Runners the
   * Kubernetes agent chart installed from the rest by their name and
   * posture (hostInfo), and keeps a bound one it no longer offers. Never a
   * global Runner: it never runs OneUptime AI's commands. Throws when the
   * Runners cannot be read, so the page can say so and leave the binding as
   * it is.
   */
  public static async loadForKubernetesCluster(
    projectId: ObjectID,
    limit: number,
  ): Promise<Array<Runner>> {
    const result: ListResult<Runner> = await ModelAPI.getList<Runner>({
      modelType: Runner,
      query: {
        projectId: projectId,
      },
      select: {
        _id: true,
        name: true,
        // The posture: which rows the Kubernetes agent chart installed.
        hostInfo: true,
      },
      sort: { name: SortOrder.Ascending },
      limit: limit,
      skip: 0,
    });

    return result.data || [];
  }

  /*
   * The project's own Runners. For a code repository - and an auto
   * remediation rule, which picks the same way - without the in-cluster
   * Runners the Kubernetes agent chart installed: they run kubectl for their
   * cluster only, and the server refuses a repository or a rule that picks
   * one.
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
        ...(forCodeRepository ? { hostInfo: true } : {}),
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
        return {
          id: runner._id?.toString() || "",
          name: runner.name || "Unnamed Runner",
          liveStatus: getRunnerLiveStatus(runner.lastAlive),
        };
      });
  }

  /*
   * The global Runners for code, as their status only - one row each. A
   * server that cannot say (an older one, or a failed read) has none to
   * offer, so the picker falls back to the project's own Runners rather
   * than failing the page.
   */
  public static async loadGlobalCodeRunners(): Promise<Array<GlobalRunnerRow>> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: getGlobalCodeRunnersUrl(),
          data: {},
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
        return [];
      }

      const rows: unknown = (response.data as JSONObject | undefined)?.[
        "globalRunners"
      ];

      if (!Array.isArray(rows)) {
        return [];
      }

      return rows.map((row: unknown): GlobalRunnerRow => {
        return {
          id: "",
          name: "Global Runner",
          description: "",
          liveStatus: readGlobalCodeRunnerLiveStatus(
            (row as JSONObject | null)?.["liveStatus"],
          ),
          runsRunbooks: false,
        };
      });
    } catch {
      return [];
    }
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

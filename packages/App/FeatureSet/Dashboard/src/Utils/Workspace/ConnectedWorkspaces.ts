import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useSyncExternalStore } from "react";

/*
 * Which chat workspaces the project has connected: Slack, Microsoft Teams,
 * both, or neither.
 *
 * "In workspace, we always show two options: Slack and Teams, but both of
 * these are not relevant to a lot of companies ... If a company integrates
 * Slack, show Slack. If a company integrates Teams, show Teams as well.
 * Please do this everywhere else in the project." (the maintainer)
 *
 * Every place that offers Slack and Microsoft Teams asks this one store: the
 * Workspace sections of the side menus, the Slack and Microsoft Teams pages
 * behind them, and the workspace channels on a person's notification pages.
 * A page load asks the server once however many of them are on screen: the
 * answer is kept until the page is reloaded, and askers that arrive while
 * the request is out share it.
 *
 * The last answer is also remembered in the browser, per project, and stands
 * in until this page load's own answer arrives. A menu drawn from it has the
 * right entries on its first paint instead of growing or shrinking a moment
 * later. It is only ever a stand-in: `isFresh` says whether an answer is
 * this page load's, and the server's answer replaces it (and is remembered
 * in its place).
 */

/*
 * The chat tools a project can connect, in the order every list of them
 * uses: Slack, then Microsoft Teams.
 */
export const WORKSPACE_TYPES: ReadonlyArray<WorkspaceType> = [
  WorkspaceType.Slack,
  WorkspaceType.MicrosoftTeams,
];

export interface WorkspaceConnections {
  /*
   * The workspaces the project has connected, in WORKSPACE_TYPES order. Null
   * while that is not known: nothing is remembered and no answer has come
   * back yet, or the request failed with nothing remembered.
   */
  connected: ReadonlyArray<WorkspaceType> | null;
  /*
   * Whether `connected` is the server's answer for this page load, rather
   * than the one remembered from an earlier visit.
   */
  isFresh: boolean;
  /*
   * Why this page load's request failed, if it did. `connected` keeps
   * whatever was known before it.
   */
  error: string | null;
}

export type ConnectedWorkspacesFetcher = (
  projectId: ObjectID,
) => Promise<Array<WorkspaceType>>;

/*
 * The workspace types in a list of anything, each once, in WORKSPACE_TYPES
 * order. What the server or the browser's storage hands back is read through
 * this, so an unknown value never becomes a menu entry.
 */
export function toConnectedWorkspaces(
  values: ReadonlyArray<unknown>,
): Array<WorkspaceType> {
  return WORKSPACE_TYPES.filter((workspaceType: WorkspaceType): boolean => {
    return values.includes(workspaceType);
  });
}

/*
 * Whether one workspace is connected: true or false once that is known,
 * null while it is not.
 */
export function isWorkspaceConnected(
  connections: WorkspaceConnections,
  workspaceType: WorkspaceType,
): boolean | null {
  if (!connections.connected) {
    return null;
  }

  return connections.connected.includes(workspaceType);
}

/*
 * The workspaces a page should offer: the connected ones once that is known
 * (from this page load, or remembered from the last), both when asking
 * failed with nothing known, so that nothing is hidden on a guess, and null
 * while the first answer is still on its way.
 */
export function getOfferedWorkspaces(
  connections: WorkspaceConnections,
): ReadonlyArray<WorkspaceType> | null {
  if (connections.connected) {
    return connections.connected;
  }

  if (connections.error) {
    return WORKSPACE_TYPES;
  }

  return null;
}

/*
 * The project's WorkspaceProjectAuthToken rows are what "connected" means:
 * the Slack and Microsoft Teams connect flows write one per workspace, and
 * disconnecting deletes it. Every project member can read them; only their
 * type is asked for here.
 */
export const fetchConnectedWorkspaces: ConnectedWorkspacesFetcher = async (
  projectId: ObjectID,
): Promise<Array<WorkspaceType>> => {
  const result: ListResult<WorkspaceProjectAuthToken> =
    await ModelAPI.getList<WorkspaceProjectAuthToken>({
      modelType: WorkspaceProjectAuthToken,
      query: {
        projectId: projectId,
      },
      select: {
        _id: true,
        workspaceType: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: {
        createdAt: SortOrder.Descending,
      },
    });

  return toConnectedWorkspaces(
    result.data.map((token: WorkspaceProjectAuthToken): unknown => {
      return token.workspaceType;
    }),
  );
};

export const REMEMBERED_CONNECTIONS_STORAGE_KEY_PREFIX: string =
  "workspace-connections-";

type RememberedKeyFunction = (projectId: string) => string;

const rememberedKey: RememberedKeyFunction = (projectId: string): string => {
  return `${REMEMBERED_CONNECTIONS_STORAGE_KEY_PREFIX}${projectId}`;
};

/*
 * Browser storage can be missing, full or refused (a private window, blocked
 * site data), so every read and write is allowed to fail: without it the
 * store simply has nothing remembered.
 */
type ReadRememberedFunction = (
  projectId: string,
) => Array<WorkspaceType> | null;

const readRemembered: ReadRememberedFunction = (
  projectId: string,
): Array<WorkspaceType> | null => {
  try {
    const stored: string | null = window.localStorage.getItem(
      rememberedKey(projectId),
    );

    if (!stored) {
      return null;
    }

    const parsed: unknown = JSON.parse(stored);

    return Array.isArray(parsed) ? toConnectedWorkspaces(parsed) : null;
  } catch {
    return null;
  }
};

type RememberFunction = (
  projectId: string,
  connected: ReadonlyArray<WorkspaceType>,
) => void;

const remember: RememberFunction = (
  projectId: string,
  connected: ReadonlyArray<WorkspaceType>,
): void => {
  try {
    window.localStorage.setItem(
      rememberedKey(projectId),
      JSON.stringify(connected),
    );
  } catch {
    // Nothing remembered: the next page load asks before it knows.
  }
};

type ForgetAllRememberedFunction = () => void;

const forgetAllRemembered: ForgetAllRememberedFunction = (): void => {
  try {
    const keys: Array<string> = [];

    for (let index: number = 0; index < window.localStorage.length; index++) {
      const key: string | null = window.localStorage.key(index);

      if (key && key.startsWith(REMEMBERED_CONNECTIONS_STORAGE_KEY_PREFIX)) {
        keys.push(key);
      }
    }

    for (const key of keys) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage is unavailable, so there is nothing remembered to forget.
  }
};

interface ProjectEntry {
  connections: WorkspaceConnections;
  request: Promise<void> | null;
  /*
   * Bumped by every request and by setConnected, so an answer that lands
   * after a newer one was asked for (or recorded) is dropped instead of
   * overwriting it.
   */
  generation: number;
}

/*
 * Outside a project nothing can be connected or asked about. Read as a
 * failed lookup, so whatever lists the workspaces falls back to listing
 * both, as it did before this store existed.
 */
const OUTSIDE_A_PROJECT: WorkspaceConnections = Object.freeze({
  connected: null,
  isFresh: false,
  error: "No project is selected.",
});

type ProjectIdInput = ObjectID | string | null | undefined;

type ToProjectKeyFunction = (projectId: ProjectIdInput) => string;

const toProjectKey: ToProjectKeyFunction = (
  projectId: ProjectIdInput,
): string => {
  return projectId ? projectId.toString() : "";
};

export default class ConnectedWorkspaces {
  private static entries: Map<string, ProjectEntry> = new Map();
  private static listeners: Set<() => void> = new Set();
  private static fetcher: ConnectedWorkspacesFetcher = fetchConnectedWorkspaces;

  public static subscribe(listener: () => void): () => void {
    ConnectedWorkspaces.listeners.add(listener);

    return (): void => {
      ConnectedWorkspaces.listeners.delete(listener);
    };
  }

  /*
   * What is known about a project's workspaces right now. The same object
   * comes back until something changes, as useSyncExternalStore requires.
   */
  public static getConnections(
    projectId: ProjectIdInput,
  ): WorkspaceConnections {
    const key: string = toProjectKey(projectId);

    if (!key) {
      return OUTSIDE_A_PROJECT;
    }

    return ConnectedWorkspaces.entryFor(key).connections;
  }

  /*
   * Asks the server once per page load. A second call while the first is
   * out shares it; a call after a fresh answer does nothing. After a failed
   * request it asks again, so the next page a person opens can recover.
   */
  public static load(projectId: ProjectIdInput): Promise<void> {
    const key: string = toProjectKey(projectId);

    if (!key) {
      return Promise.resolve();
    }

    const entry: ProjectEntry = ConnectedWorkspaces.entryFor(key);

    if (entry.request) {
      return entry.request;
    }

    if (entry.connections.isFresh) {
      return Promise.resolve();
    }

    return ConnectedWorkspaces.ask(key, entry);
  }

  /*
   * Asks again even after a fresh answer: after a workspace is disconnected,
   * or when somebody presses Retry. What was known stays on screen until the
   * new answer replaces it.
   */
  public static refresh(projectId?: ProjectIdInput): Promise<void> {
    const key: string = toProjectKey(
      projectId === undefined ? ProjectUtil.getCurrentProjectId() : projectId,
    );

    if (!key) {
      return Promise.resolve();
    }

    return ConnectedWorkspaces.ask(key, ConnectedWorkspaces.entryFor(key));
  }

  // Records a known answer, as if the server had just given it.
  public static setConnected(
    projectId: ObjectID | string,
    connected: ReadonlyArray<WorkspaceType>,
  ): void {
    const key: string = toProjectKey(projectId);

    if (!key) {
      return;
    }

    const entry: ProjectEntry = ConnectedWorkspaces.entryFor(key);
    const known: Array<WorkspaceType> = toConnectedWorkspaces(connected);

    entry.generation++;
    entry.request = null;
    entry.connections = { connected: known, isFresh: true, error: null };
    remember(key, known);
    ConnectedWorkspaces.emit();
  }

  /*
   * Where the answers come from. Tests hand in their own; null puts the
   * server back.
   */
  public static setFetcher(fetcher: ConnectedWorkspacesFetcher | null): void {
    ConnectedWorkspaces.fetcher = fetcher || fetchConnectedWorkspaces;
  }

  // Forgets every answer, remembered ones included.
  public static reset(): void {
    ConnectedWorkspaces.entries = new Map();
    forgetAllRemembered();
    ConnectedWorkspaces.emit();
  }

  private static entryFor(key: string): ProjectEntry {
    const existing: ProjectEntry | undefined =
      ConnectedWorkspaces.entries.get(key);

    if (existing) {
      return existing;
    }

    const entry: ProjectEntry = {
      connections: {
        connected: readRemembered(key),
        isFresh: false,
        error: null,
      },
      request: null,
      generation: 0,
    };

    ConnectedWorkspaces.entries.set(key, entry);

    return entry;
  }

  private static ask(key: string, entry: ProjectEntry): Promise<void> {
    entry.generation++;

    const generation: number = entry.generation;
    const fetcher: ConnectedWorkspacesFetcher = ConnectedWorkspaces.fetcher;

    const request: Promise<void> = (async (): Promise<void> => {
      let next: WorkspaceConnections;

      try {
        const connected: Array<WorkspaceType> = toConnectedWorkspaces(
          await fetcher(new ObjectID(key)),
        );

        next = { connected, isFresh: true, error: null };

        if (entry.generation === generation) {
          remember(key, connected);
        }
      } catch (error) {
        next = {
          connected: entry.connections.connected,
          isFresh: entry.connections.isFresh,
          error:
            API.getFriendlyMessage(error) ||
            "Could not check which workspaces are connected.",
        };
      }

      // A newer request, or a recorded answer, has taken this one's place.
      if (entry.generation !== generation) {
        return;
      }

      entry.connections = next;
      entry.request = null;
      ConnectedWorkspaces.emit();
    })();

    entry.request = request;

    return request;
  }

  private static emit(): void {
    for (const listener of Array.from(ConnectedWorkspaces.listeners)) {
      listener();
    }
  }
}

/*
 * The current project's workspaces, kept up to date. The first component to
 * ask on a page starts the request; every other one shares it.
 */
export function useWorkspaceConnections(): WorkspaceConnections {
  const projectKey: string = toProjectKey(ProjectUtil.getCurrentProjectId());

  const connections: WorkspaceConnections = useSyncExternalStore(
    ConnectedWorkspaces.subscribe,
    (): WorkspaceConnections => {
      return ConnectedWorkspaces.getConnections(projectKey);
    },
  );

  useEffect(() => {
    ConnectedWorkspaces.load(projectKey).catch(() => {
      // A failed request is kept as `error`; nothing to do here.
    });
  }, [projectKey]);

  return connections;
}

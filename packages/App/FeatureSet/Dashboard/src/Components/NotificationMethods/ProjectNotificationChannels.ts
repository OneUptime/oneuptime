import Project from "Common/Models/DatabaseModels/Project";
import Select from "Common/Types/BaseDatabase/Select";
import ObjectID from "Common/Types/ObjectID";
import {
  MODEL_SWITCH_SAVED_EVENT,
  ModelSwitchSaved,
} from "Common/UI/Components/ModelSwitch/ModelSwitchEvents";
import API from "Common/UI/Utils/API/API";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useSyncExternalStore } from "react";
import {
  EnabledProjectChannels,
  getProjectNotificationChannel,
  getProjectNotificationChannelForColumn,
  PROJECT_NOTIFICATION_CHANNEL_COLUMNS,
  ProjectNotificationChannel,
  ProjectNotificationChannelColumn,
  ProjectNotificationChannelDefinition,
  readEnabledProjectChannels,
} from "./ProjectNotificationChannelsCopy";

/*
 * Which of the four notification channels (SMS, calls, WhatsApp, Telegram)
 * the current project has on, for every screen that offers a channel: a
 * person's method lists (their Add button and the panel that replaces it),
 * and the channels an admin may add for someone else.
 *
 * One read for everything on screen: the first list to ask starts the
 * request and the others share it. A list that mounts later asks again -
 * a project owner may have turned a channel on since - and shows what was
 * known meanwhile. A switch saved anywhere on the screen (the panel's, the
 * Notification Channels card's) is heard through ModelSwitchEvents, so the
 * Add button appears the moment the channel is turned on, with no reload.
 *
 * "We could not check" is never "off": a list whose read failed offers its
 * Add button as it always did, and the server has the last word.
 */

export interface ProjectNotificationChannels {
  /*
   * Whether each channel is on. Null while that is not known: the first
   * answer is on its way, or asking failed with nothing known before.
   */
  enabled: Readonly<EnabledProjectChannels> | null;
  // Why the last request failed, if it did. `enabled` keeps what was known.
  error: string | null;
}

export enum ProjectChannelState {
  On = "On",
  Off = "Off",
  // The first answer is on its way.
  Loading = "Loading",
  // Asking failed with nothing known: the server decides.
  Unknown = "Unknown",
}

export const getProjectChannelState: (
  channels: ProjectNotificationChannels,
  channel: ProjectNotificationChannel,
) => ProjectChannelState = (
  channels: ProjectNotificationChannels,
  channel: ProjectNotificationChannel,
): ProjectChannelState => {
  if (channels.enabled) {
    return channels.enabled[channel]
      ? ProjectChannelState.On
      : ProjectChannelState.Off;
  }

  if (channels.error) {
    return ProjectChannelState.Unknown;
  }

  return ProjectChannelState.Loading;
};

/*
 * Whether a list offers its Add button: while the channel is on, and when
 * asking failed (as before this existed). Not while the first answer is on
 * its way, so the button never appears and then vanishes under a reader.
 */
export const isAddingOffered: (state: ProjectChannelState) => boolean = (
  state: ProjectChannelState,
): boolean => {
  return (
    state === ProjectChannelState.On || state === ProjectChannelState.Unknown
  );
};

/*
 * Whether "Resend code" can be offered on an unverified method of this
 * channel: always, except for a channel whose code the server refuses to
 * send again while the channel is off (SMS, calls).
 */
export const isCodeResendOffered: (
  channel: ProjectNotificationChannel,
  state: ProjectChannelState,
) => boolean = (
  channel: ProjectNotificationChannel,
  state: ProjectChannelState,
): boolean => {
  const definition: ProjectNotificationChannelDefinition =
    getProjectNotificationChannel(channel);

  return !(
    definition.isCodeResendRefusedWhileOff && state === ProjectChannelState.Off
  );
};

// What a read selects: the four switches and nothing else.
export const getProjectNotificationChannelsSelect: () => Select<Project> =
  (): Select<Project> => {
    const select: Select<Project> = {};

    for (const column of PROJECT_NOTIFICATION_CHANNEL_COLUMNS) {
      select[column] = true;
    }

    return select;
  };

export type ProjectNotificationChannelsFetcher = (
  projectId: ObjectID,
) => Promise<EnabledProjectChannels>;

/*
 * Every project member may read these columns (the Project's read
 * permissions); only owners and billing managers may change them.
 */
export const fetchProjectNotificationChannels: ProjectNotificationChannelsFetcher =
  async (projectId: ObjectID): Promise<EnabledProjectChannels> => {
    const project: Project | null = await ModelAPI.getItem<Project>({
      modelType: Project,
      id: projectId,
      select: getProjectNotificationChannelsSelect(),
    });

    /*
     * No row is not the same as every channel off: it is a read that told
     * us nothing, and the lists then behave as they did before they asked.
     */
    if (!project) {
      throw new Error("Could not read this project's notification channels.");
    }

    return readEnabledProjectChannels(
      project as unknown as Partial<
        Record<ProjectNotificationChannelColumn, unknown>
      >,
    );
  };

interface ProjectEntry {
  channels: ProjectNotificationChannels;
  request: Promise<void> | null;
  /*
   * Bumped by every request and every recorded change, so an answer that
   * lands after a newer one (or after a switch was saved) is dropped instead
   * of putting an old value back.
   */
  generation: number;
}

const NOTHING_KNOWN: ProjectNotificationChannels = Object.freeze({
  enabled: null,
  error: null,
});

// Outside a project there is nothing to ask: the server decides.
const OUTSIDE_A_PROJECT: ProjectNotificationChannels = Object.freeze({
  enabled: null,
  error: "No project is selected.",
});

type ProjectIdInput = ObjectID | string | null | undefined;

const toProjectKey: (projectId: ProjectIdInput) => string = (
  projectId: ProjectIdInput,
): string => {
  return projectId ? projectId.toString() : "";
};

const PROJECT_TABLE_NAME: string = new Project().tableName || "Project";

export default class ProjectNotificationChannelsStore {
  private static entries: Map<string, ProjectEntry> = new Map();
  private static listeners: Set<() => void> = new Set();
  private static fetcher: ProjectNotificationChannelsFetcher =
    fetchProjectNotificationChannels;
  private static switchListener: ((event: CustomEvent) => void) | null = null;

  public static subscribe(listener: () => void): () => void {
    ProjectNotificationChannelsStore.listenForSwitches();
    ProjectNotificationChannelsStore.listeners.add(listener);

    return (): void => {
      ProjectNotificationChannelsStore.listeners.delete(listener);
    };
  }

  /*
   * What is known about a project's channels right now. The same object
   * comes back until something changes, as useSyncExternalStore requires.
   */
  public static getChannels(
    projectId: ProjectIdInput,
  ): ProjectNotificationChannels {
    const key: string = toProjectKey(projectId);

    if (!key) {
      return OUTSIDE_A_PROJECT;
    }

    return (
      ProjectNotificationChannelsStore.entries.get(key)?.channels ||
      NOTHING_KNOWN
    );
  }

  /*
   * Asks the server, unless a request for this project is already out, in
   * which case the caller shares it. What was known stays on screen until
   * the answer replaces it.
   */
  public static load(projectId: ProjectIdInput): Promise<void> {
    const key: string = toProjectKey(projectId);

    if (!key) {
      return Promise.resolve();
    }

    const entry: ProjectEntry = ProjectNotificationChannelsStore.entryFor(key);

    if (entry.request) {
      return entry.request;
    }

    return ProjectNotificationChannelsStore.ask(key, entry);
  }

  /*
   * Records a known answer, as if the server had just given it: a page that
   * read the switches itself, or a switch that was just saved.
   */
  public static record(
    projectId: ProjectIdInput,
    enabled: EnabledProjectChannels,
  ): void {
    const key: string = toProjectKey(projectId);

    if (!key) {
      return;
    }

    const entry: ProjectEntry = ProjectNotificationChannelsStore.entryFor(key);

    entry.generation++;
    entry.request = null;
    entry.channels = { enabled: { ...enabled }, error: null };
    ProjectNotificationChannelsStore.emit();
  }

  /*
   * One channel was switched. With the others known, it is recorded at
   * once; with nothing known yet, the project is asked again instead of
   * guessing the other three. A project nothing on the page has asked about
   * is left alone.
   */
  public static recordChannel(
    projectId: ProjectIdInput,
    channel: ProjectNotificationChannel,
    isOn: boolean,
  ): void {
    const key: string = toProjectKey(projectId);

    if (!key) {
      return;
    }

    const entry: ProjectEntry | undefined =
      ProjectNotificationChannelsStore.entries.get(key);

    if (!entry) {
      return;
    }

    if (!entry.channels.enabled) {
      void ProjectNotificationChannelsStore.ask(key, entry);
      return;
    }

    ProjectNotificationChannelsStore.record(key, {
      ...entry.channels.enabled,
      [channel]: isOn,
    });
  }

  /*
   * Where the answers come from. Tests hand in their own; null puts the
   * server back.
   */
  public static setFetcher(
    fetcher: ProjectNotificationChannelsFetcher | null,
  ): void {
    ProjectNotificationChannelsStore.fetcher =
      fetcher || fetchProjectNotificationChannels;
  }

  // Forgets every answer, and stops listening until the store is used again.
  public static reset(): void {
    ProjectNotificationChannelsStore.entries = new Map();

    if (ProjectNotificationChannelsStore.switchListener) {
      GlobalEvents.removeEventListener(
        MODEL_SWITCH_SAVED_EVENT,
        ProjectNotificationChannelsStore.switchListener,
      );
      ProjectNotificationChannelsStore.switchListener = null;
    }

    ProjectNotificationChannelsStore.emit();
  }

  private static entryFor(key: string): ProjectEntry {
    /*
     * Whatever uses the store listens: a page that only records what it read
     * (the Notification Channels card) must hear its own switches too, or the
     * lists would open on the answer from before the flip.
     */
    ProjectNotificationChannelsStore.listenForSwitches();

    const existing: ProjectEntry | undefined =
      ProjectNotificationChannelsStore.entries.get(key);

    if (existing) {
      return existing;
    }

    const entry: ProjectEntry = {
      channels: NOTHING_KNOWN,
      request: null,
      generation: 0,
    };

    ProjectNotificationChannelsStore.entries.set(key, entry);

    return entry;
  }

  private static ask(key: string, entry: ProjectEntry): Promise<void> {
    entry.generation++;

    const generation: number = entry.generation;
    const fetcher: ProjectNotificationChannelsFetcher =
      ProjectNotificationChannelsStore.fetcher;

    const request: Promise<void> = (async (): Promise<void> => {
      let next: ProjectNotificationChannels;

      try {
        next = {
          enabled: { ...(await fetcher(new ObjectID(key))) },
          error: null,
        };
      } catch (error) {
        next = {
          enabled: entry.channels.enabled,
          error:
            API.getFriendlyMessage(error) ||
            "Could not read this project's notification channels.",
        };
      }

      // A newer request, or a recorded answer, has taken this one's place.
      if (entry.generation !== generation) {
        return;
      }

      entry.channels = next;
      entry.request = null;
      ProjectNotificationChannelsStore.emit();
    })();

    entry.request = request;

    return request;
  }

  /*
   * A project switch saved anywhere on the screen - by a ModelSwitchRow on
   * the Notification Channels card or in a list's panel - moves every list
   * at once. Listened for from the store's first use on, for the life of the
   * page.
   */
  private static listenForSwitches(): void {
    if (ProjectNotificationChannelsStore.switchListener) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const listener: (event: CustomEvent) => void = (
      event: CustomEvent,
    ): void => {
      const saved: Partial<ModelSwitchSaved> =
        (event.detail as Partial<ModelSwitchSaved>) || {};

      if (
        saved.tableName !== PROJECT_TABLE_NAME ||
        !saved.modelId ||
        !saved.column ||
        typeof saved.value !== "boolean"
      ) {
        return;
      }

      const definition: ProjectNotificationChannelDefinition | undefined =
        getProjectNotificationChannelForColumn(saved.column);

      if (!definition) {
        return;
      }

      ProjectNotificationChannelsStore.recordChannel(
        saved.modelId,
        definition.channel,
        saved.value,
      );
    };

    ProjectNotificationChannelsStore.switchListener = listener;
    GlobalEvents.addEventListener(MODEL_SWITCH_SAVED_EVENT, listener);
  }

  private static emit(): void {
    for (const listener of Array.from(
      ProjectNotificationChannelsStore.listeners,
    )) {
      listener();
    }
  }
}

/*
 * The current project's channels, kept up to date. Each component that
 * mounts asks again (sharing a request that is already out), so a channel
 * an owner turned on since is picked up on the next visit.
 */
export function useProjectNotificationChannels(): ProjectNotificationChannels {
  const projectKey: string = toProjectKey(ProjectUtil.getCurrentProjectId());

  const channels: ProjectNotificationChannels = useSyncExternalStore(
    ProjectNotificationChannelsStore.subscribe,
    (): ProjectNotificationChannels => {
      return ProjectNotificationChannelsStore.getChannels(projectKey);
    },
  );

  useEffect(() => {
    ProjectNotificationChannelsStore.load(projectKey).catch(() => {
      // A failed request is kept as `error`; nothing to do here.
    });
  }, [projectKey]);

  return channels;
}

// One channel's state in the current project, kept up to date.
export function useProjectChannelState(
  channel: ProjectNotificationChannel,
): ProjectChannelState {
  return getProjectChannelState(useProjectNotificationChannels(), channel);
}

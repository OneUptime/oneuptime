import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchProjects } from "../api/projects";
import { getServerUrl } from "../storage/serverUrl";
import { useAuth } from "./useAuth";
import { useCurrentUserId } from "./useCurrentUserId";
import type { ProjectItem } from "../api/types";

interface ProjectContextValue {
  /** All memberships, used only by project management and the project switcher. */
  projectList: ProjectItem[];
  activeProject: ProjectItem | null;
  selectProject: (projectId: string) => void;
  isLoadingProjects: boolean;
  projectLoadError: Error | null;
  refreshProjects: () => Promise<void>;
}

interface ProjectState {
  owner: string | null;
  projects: ProjectItem[];
  selectedId: string | null;
  loading: boolean;
  error: Error | null;
}

const ProjectContext: React.Context<ProjectContextValue | undefined> =
  createContext<ProjectContextValue | undefined>(undefined);

/*
 * Serialize preference writes across provider mounts too. A close/reopen or
 * rapid switch must read the last queued selection, never an earlier write
 * that happened to finish later. A failed preference write must not block
 * access to the user's projects.
 */
let preferenceWrites: Promise<void> = Promise.resolve();

function persistPreference(key: string, projectId: string | null): void {
  preferenceWrites = preferenceWrites
    .then(async (): Promise<void> => {
      if (projectId) {
        await AsyncStorage.setItem(key, projectId);
      } else {
        await AsyncStorage.removeItem(key);
      }
    })
    .catch((): void => {
      /* A device storage failure must not block switching. */
    });
}

function preferenceKey(server: string, userId: string): string {
  return `oneuptime_active_project:${encodeURIComponent(server.replace(/\/+$/, ""))}:${encodeURIComponent(userId)}`;
}

export function ProjectProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const currentUserId: string | null = useCurrentUserId();
  const identity: string | null =
    isAuthenticated && !authLoading ? currentUserId : null;
  const identityRef: React.MutableRefObject<string | null> = useRef(identity);
  identityRef.current = identity;
  const [state, setState] = useState<ProjectState>({
    owner: null,
    projects: [],
    selectedId: null,
    loading: true,
    error: null,
  });
  const stateRef: React.MutableRefObject<ProjectState> = useRef(state);
  stateRef.current = state;
  const generationRef: React.MutableRefObject<number> = useRef(0);
  const storageKeyRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);
  const selectedIdRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);

  const loadProjects: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      if (!identity || identity !== identityRef.current) {
        return;
      }
      const generation: number = ++generationRef.current;
      setState((previous: ProjectState): ProjectState => {
        return previous.owner === identity
          ? { ...previous, loading: true, error: null }
          : {
              owner: identity,
              projects: [],
              selectedId: null,
              loading: true,
              error: null,
            };
      });

      try {
        const [response, server] = await Promise.all([
          fetchProjects(),
          getServerUrl(),
        ]);
        const key: string = preferenceKey(server, identity);
        await preferenceWrites;
        const storedId: string | null = key
          ? await AsyncStorage.getItem(key).catch(() => {
              return null;
            })
          : null;
        if (
          generation !== generationRef.current ||
          identity !== identityRef.current
        ) {
          return;
        }

        // Selection made while a refresh was pending takes precedence over disk.
        const preferredId: string | null =
          key === storageKeyRef.current
            ? selectedIdRef.current || storedId
            : storedId;
        const selected: ProjectItem | undefined =
          response.data.find((project: ProjectItem): boolean => {
            return project._id === preferredId;
          }) || response.data[0];
        const selectedId: string | null = selected?._id || null;
        storageKeyRef.current = key;
        selectedIdRef.current = selectedId;
        /*
         * Publish memberships and the hydrated selection together; consumers
         * cannot query the first project before the saved preference is known.
         */
        setState({
          owner: identity,
          projects: response.data,
          selectedId,
          loading: false,
          error: null,
        });
        if (key && storedId !== selectedId) {
          persistPreference(key, selectedId);
        }
      } catch (error: unknown) {
        if (
          generation === generationRef.current &&
          identity === identityRef.current
        ) {
          setState((previous: ProjectState): ProjectState => {
            return {
              ...previous,
              loading: false,
              error: error instanceof Error ? error : new Error(String(error)),
            };
          });
        }
      }
    }, [identity]);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!isAuthenticated) {
      /*
       * Keep the account/server-scoped preference for the next sign-in;
       * retire all visible tenant data and in-flight loads immediately.
       */
      storageKeyRef.current = null;
      selectedIdRef.current = null;
      setState({
        owner: null,
        projects: [],
        selectedId: null,
        loading: false,
        error: null,
      });
    } else {
      storageKeyRef.current = null;
      selectedIdRef.current = null;
      void loadProjects();
    }
    return (): void => {
      generationRef.current += 1;
    };
  }, [isAuthenticated, authLoading, loadProjects]);

  const selectProject: (projectId: string) => void = useCallback(
    (projectId: string): void => {
      if (
        !identity ||
        identity !== identityRef.current ||
        stateRef.current.owner !== identity
      ) {
        return;
      }
      if (
        !stateRef.current.projects.some((project: ProjectItem): boolean => {
          return project._id === projectId;
        })
      ) {
        return;
      }
      selectedIdRef.current = projectId;
      setState((previous: ProjectState): ProjectState => {
        return {
          ...previous,
          selectedId: projectId,
        };
      });
      if (storageKeyRef.current) {
        persistPreference(storageKeyRef.current, projectId);
      }
    },
    [identity],
  );

  const value: ProjectContextValue = useMemo((): ProjectContextValue => {
    const belongsToSession: boolean =
      Boolean(identity) && state.owner === identity;
    const projectList: ProjectItem[] = belongsToSession ? state.projects : [];
    return {
      projectList,
      activeProject:
        projectList.find((project: ProjectItem): boolean => {
          return project._id === state.selectedId;
        }) || null,
      selectProject,
      isLoadingProjects:
        authLoading ||
        (isAuthenticated && !identity) ||
        (Boolean(identity) && !belongsToSession) ||
        state.loading,
      projectLoadError: belongsToSession ? state.error : null,
      refreshProjects: loadProjects,
    };
  }, [
    state,
    identity,
    authLoading,
    isAuthenticated,
    selectProject,
    loadProjects,
  ]);

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const context: ProjectContextValue | undefined = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return context;
}

/** Operational screens can only load the currently selected project. */
export function useActiveProject(): ProjectContextValue {
  const context: ProjectContextValue = useProject();
  return useMemo((): ProjectContextValue => {
    return {
      ...context,
      projectList: context.activeProject ? [context.activeProject] : [],
    };
  }, [context]);
}

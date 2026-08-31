import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { fetchProjects } from "../api/projects";
import { useAuth } from "./useAuth";
import type { ProjectItem } from "../api/types";

interface ProjectContextValue {
  projectList: ProjectItem[];
  isLoadingProjects: boolean;

  /*
   * Why the project list is empty, when it is empty because we could not ask.
   *
   * Several screens key their empty state on projectList.length === 0, and
   * without this they cannot tell "this account has no projects" from "the
   * request for them failed". Those two want opposite copy: one is an
   * onboarding prompt, the other is a retry. Null means the last load
   * actually succeeded.
   */
  projectLoadError: Error | null;

  refreshProjects: () => Promise<void>;
}

const ProjectContext: React.Context<ProjectContextValue | undefined> =
  createContext<ProjectContextValue | undefined>(undefined);

interface ProjectProviderProps {
  children: ReactNode;
}

export function ProjectProvider({
  children,
}: ProjectProviderProps): React.JSX.Element {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [projectList, setProjectList] = useState<ProjectItem[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState<boolean>(true);
  const [projectLoadError, setProjectLoadError] = useState<Error | null>(null);

  /*
   * Which load is allowed to write to this context.
   *
   * The fetch is a network round trip and the user can sign out in the middle
   * of one - or pull to refresh twice. Both leave an in-flight promise that
   * resolves into a provider whose account has already changed, and the
   * previous responder's projects would then be sitting in front of whoever
   * is looking at the phone now, driving every per-project query behind them.
   * A load stamps its number here on the way in and only commits if that
   * number is still the current one on the way out.
   */
  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  const loadProjects: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      loadGenerationRef.current += 1;
      const generation: number = loadGenerationRef.current;

      try {
        setIsLoadingProjects(true);
        setProjectLoadError(null);
        const response: { data: ProjectItem[] } = await fetchProjects();

        if (generation !== loadGenerationRef.current) {
          return;
        }

        setProjectList(response.data);
      } catch (error: unknown) {
        if (generation !== loadGenerationRef.current) {
          return;
        }

        /*
         * Kept as an Error rather than a boolean so a screen can show what
         * actually went wrong, and normalised because a rejected axios call
         * is not guaranteed to reject with one.
         */
        setProjectLoadError(
          error instanceof Error ? error : new Error(String(error)),
        );
      } finally {
        if (generation === loadGenerationRef.current) {
          setIsLoadingProjects(false);
        }
      }
    }, []);

  useEffect((): void => {
    if (authLoading) {
      return;
    }
    if (!isAuthenticated) {
      /*
       * Retire any load still in flight before clearing, so the signed-out
       * state cannot be overwritten a moment later by the previous account's
       * response arriving.
       */
      loadGenerationRef.current += 1;
      setProjectList([]);
      setProjectLoadError(null);
      setIsLoadingProjects(false);
      return;
    }
    loadProjects();
  }, [isAuthenticated, authLoading, loadProjects]);

  return (
    <ProjectContext.Provider
      value={{
        projectList,
        isLoadingProjects,
        projectLoadError,
        refreshProjects: loadProjects,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const context: ProjectContextValue | undefined = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return context;
}

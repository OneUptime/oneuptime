import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { fetchProjects } from "../api/projects";
import type { ProjectItem } from "../api/types";

interface ProjectContextValue {
  projectList: ProjectItem[];
  isLoadingProjects: boolean;
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
  const [projectList, setProjectList] = useState<ProjectItem[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState<boolean>(true);

  const loadProjects: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        setIsLoadingProjects(true);
        const response: { data: ProjectItem[] } = await fetchProjects();
        setProjectList(response.data);
      } catch {
        // Projects will be empty, user can retry
      } finally {
        setIsLoadingProjects(false);
      }
    }, []);

  useEffect((): void => {
    loadProjects();
  }, [loadProjects]);

  return (
    <ProjectContext.Provider
      value={{
        projectList,
        isLoadingProjects,
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

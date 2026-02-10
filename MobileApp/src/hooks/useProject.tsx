import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchProjects } from "../api/projects";
import type { ProjectItem } from "../api/types";

const PROJECT_STORAGE_KEY = "oneuptime_selected_project_id";

interface ProjectContextValue {
  selectedProject: ProjectItem | null;
  projectList: ProjectItem[];
  isLoadingProjects: boolean;
  selectProject: (project: ProjectItem) => Promise<void>;
  refreshProjects: () => Promise<void>;
  clearProject: () => Promise<void>;
}

const ProjectContext: React.Context<ProjectContextValue | undefined> =
  createContext<ProjectContextValue | undefined>(undefined);

interface ProjectProviderProps {
  children: ReactNode;
}

export function ProjectProvider({
  children,
}: ProjectProviderProps): React.JSX.Element {
  const [selectedProject, setSelectedProject] = useState<ProjectItem | null>(
    null,
  );
  const [projectList, setProjectList] = useState<ProjectItem[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState<boolean>(true);

  const loadProjects = useCallback(async (): Promise<void> => {
    try {
      setIsLoadingProjects(true);
      const response: { data: ProjectItem[] } = await fetchProjects();
      setProjectList(response.data);

      // Try to restore previously selected project
      const savedId: string | null =
        await AsyncStorage.getItem(PROJECT_STORAGE_KEY);
      if (savedId) {
        const saved: ProjectItem | undefined = response.data.find(
          (p: ProjectItem): boolean => {
            return p._id === savedId;
          },
        );
        if (saved) {
          setSelectedProject(saved);
        }
      }

      // Auto-select if only one project
      if (!savedId && response.data.length === 1) {
        const project: ProjectItem = response.data[0]!;
        setSelectedProject(project);
        await AsyncStorage.setItem(PROJECT_STORAGE_KEY, project._id);
      }
    } catch {
      // Projects will be empty, user can retry
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  useEffect((): void => {
    loadProjects();
  }, [loadProjects]);

  const selectProject = useCallback(
    async (project: ProjectItem): Promise<void> => {
      setSelectedProject(project);
      await AsyncStorage.setItem(PROJECT_STORAGE_KEY, project._id);
    },
    [],
  );

  const clearProject = useCallback(async (): Promise<void> => {
    setSelectedProject(null);
    await AsyncStorage.removeItem(PROJECT_STORAGE_KEY);
  }, []);

  return (
    <ProjectContext.Provider
      value={{
        selectedProject,
        projectList,
        isLoadingProjects,
        selectProject,
        refreshProjects: loadProjects,
        clearProject,
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

import { useEffect } from "react";
import { Alert } from "react-native";
import { useProject } from "../hooks/useProject";
import type { ProjectItem } from "../api/types";
import {
  processPendingNotification,
  setProjectNavigationGuard,
  type ProjectNavigationResult,
} from "../notifications/handlers";

/** A page opens in its own project after that project's navigator has mounted. */
export default function ProjectNavigationSync(): null {
  const {
    activeProject,
    projectList,
    isLoadingProjects,
    projectLoadError,
    selectProject,
  } = useProject();
  useEffect(() => {
    setProjectNavigationGuard((projectId: string): ProjectNavigationResult => {
      if (isLoadingProjects) {
        return "switching";
      }
      if (
        !projectList.some((project: ProjectItem) => {
          return project._id === projectId;
        })
      ) {
        if (projectLoadError) {
          return "switching";
        }
        Alert.alert(
          "Project unavailable",
          "You no longer have access to the project for this notification.",
        );
        return "unavailable";
      }
      if (activeProject?._id !== projectId) {
        selectProject(projectId);
        return "switching";
      }
      return "ready";
    });
    processPendingNotification();
    return () => {
      setProjectNavigationGuard(null);
    };
  }, [
    activeProject?._id,
    projectList,
    isLoadingProjects,
    projectLoadError,
    selectProject,
  ]);
  return null;
}

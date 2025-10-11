import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as SecureStore from "expo-secure-store";
import { Project } from "@/types/models";
import { setTenantId } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";

const STORAGE_KEY_PREFIX = "oneuptime:project";

export interface ProjectContextValue {
  project: Project | null;
  isLoading: boolean;
  setProject: (project: Project | null) => Promise<void>;
  reset: () => Promise<void>;
}

export const ProjectContext = createContext<ProjectContextValue | undefined>(
  undefined,
);

export const ProjectProvider = ({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement => {
  const { user } = useAuth();
  const [project, setProjectState] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const lastStorageKeyRef = useRef<string | null>(null);

  const storageKey = user ? `${STORAGE_KEY_PREFIX}:${user.id}` : null;

  const loadStoredProject = useCallback(async () => {
    if (!storageKey) {
      setProjectState(null);
      setTenantId(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const stored = await SecureStore.getItemAsync(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Project;
        setProjectState(parsed);
        setTenantId(parsed.id);
        lastStorageKeyRef.current = storageKey;
      } else {
        setProjectState(null);
        setTenantId(null);
        lastStorageKeyRef.current = storageKey;
      }
    } catch (error) {
      setProjectState(null);
      setTenantId(null);
      await SecureStore.deleteItemAsync(storageKey).catch(() => null);
      lastStorageKeyRef.current = storageKey;
    } finally {
      setIsLoading(false);
    }
  }, [storageKey]);

  useEffect(() => {
    void loadStoredProject();
  }, [loadStoredProject]);

  useEffect(() => {
    if (!user && lastStorageKeyRef.current) {
      void SecureStore.deleteItemAsync(lastStorageKeyRef.current).catch(
        () => null,
      );
      lastStorageKeyRef.current = null;
    }
  }, [user]);

  const persistProject = useCallback(
    async (value: Project | null) => {
      if (!storageKey) {
        return;
      }

      if (!value) {
        await SecureStore.deleteItemAsync(storageKey).catch(() => null);
        return;
      }

      await SecureStore.setItemAsync(storageKey, JSON.stringify(value)).catch(() =>
        null,
      );
    },
    [storageKey],
  );

  const setProject = useCallback(
    async (value: Project | null) => {
      setProjectState(value);
      setTenantId(value ? value.id : null);
      await persistProject(value);
    },
    [persistProject],
  );

  const reset = useCallback(async () => {
    await setProject(null);
  }, [setProject]);

  const value = useMemo<ProjectContextValue>(
    () => ({
      project,
      isLoading,
      setProject,
      reset,
    }),
    [project, isLoading, setProject, reset],
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
};

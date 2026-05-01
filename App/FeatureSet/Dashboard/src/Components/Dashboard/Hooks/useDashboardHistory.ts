import * as React from "react";
import { useCallback, useRef, useState } from "react";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import HistoryStack from "Common/Utils/Dashboard/HistoryStack";

export interface DashboardHistory {
  config: DashboardViewConfig;
  setConfig: (next: DashboardViewConfig, options?: SetOptions) => void;
  reset: (next: DashboardViewConfig) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export interface SetOptions {
  /*
   * When true, replace the current entry instead of pushing onto the
   * undo stack. Useful for high-frequency updates (drag in progress)
   * that should commit a single history entry on completion.
   */
  skipHistory?: boolean | undefined;
}

const useDashboardHistory: (
  initial: DashboardViewConfig,
) => DashboardHistory = (initial: DashboardViewConfig): DashboardHistory => {
  const stackRef: React.MutableRefObject<HistoryStack<DashboardViewConfig>> =
    useRef<HistoryStack<DashboardViewConfig>>(
      new HistoryStack<DashboardViewConfig>(initial),
    );
  const [, setVersion] = useState<number>(0);
  const bumpVersion: () => void = useCallback((): void => {
    setVersion((v: number) => {
      return v + 1;
    });
  }, []);

  const setConfig: DashboardHistory["setConfig"] = useCallback(
    (next: DashboardViewConfig, options?: SetOptions): void => {
      if (options?.skipHistory) {
        stackRef.current.replace(next);
      } else {
        stackRef.current.push(next);
      }
      bumpVersion();
    },
    [bumpVersion],
  );

  const reset: DashboardHistory["reset"] = useCallback(
    (next: DashboardViewConfig): void => {
      stackRef.current.reset(next);
      bumpVersion();
    },
    [bumpVersion],
  );

  const undo: DashboardHistory["undo"] = useCallback((): void => {
    if (stackRef.current.undo()) {
      bumpVersion();
    }
  }, [bumpVersion]);

  const redo: DashboardHistory["redo"] = useCallback((): void => {
    if (stackRef.current.redo()) {
      bumpVersion();
    }
  }, [bumpVersion]);

  return {
    config: stackRef.current.getCurrent(),
    setConfig,
    reset,
    undo,
    redo,
    canUndo: stackRef.current.canUndo(),
    canRedo: stackRef.current.canRedo(),
  };
};

export default useDashboardHistory;

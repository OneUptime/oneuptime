import PermissionUtil from "./Permission";
import { useSyncExternalStore } from "react";

const subscribe: (listener: () => void) => () => void = (
  listener: () => void,
): (() => void) => {
  return PermissionUtil.subscribeToSnapshots(listener);
};

const getVersion: () => number = (): number => {
  return PermissionUtil.getSnapshotVersion();
};

/*
 * Draws the calling component again whenever a kept permission snapshot
 * changes, so every gate under it reads the snapshot that landed
 * (PermissionUtil.subscribeToSnapshots says why that takes telling).
 */
const usePermissionSnapshot: () => number = (): number => {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
};

export default usePermissionSnapshot;

import {
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatformDescriptor,
  getCloudProviderLabel,
  getManagedCloudPlatformDescriptor,
} from "Common/Types/Cloud/CloudPlatform";

/*
 * The App Platforms Overview's "Platforms" card, worked out from the
 * environments: one group per platform the project's apps run on, in the
 * catalogue's order (MANAGED_CLOUD_PLATFORMS), each with its environments -
 * the disconnected ones first, so a problem is the first thing read - and
 * whether all of them are connected. React-free, so the grouping is tested
 * without a renderer.
 */

export interface AppPlatformEnvironmentRow {
  id: string;
  name: string;
  cloudPlatform: string;
  cloudProvider: string;
  // Connected while its telemetry arrives (otelCollectorStatus).
  isConnected: boolean;
  lastSeenAt: Date | null;
}

export interface AppPlatformGroup {
  // The cloud.platform value, or "" for environments that report none yet.
  platform: string;
  // "AWS ECS / Fargate": the platform as its users call it.
  title: string;
  // "AWS": whose platform it is, or "" when unknown.
  providerLabel: string;
  // The provider value ("aws"), for its logo.
  provider: string;
  environments: Array<AppPlatformEnvironmentRow>;
  connected: number;
}

export enum AppPlatformGroupTone {
  // Every environment is connected.
  Healthy = "healthy",
  // Some are, some are not.
  Partial = "partial",
  // None is connected.
  Silent = "silent",
}

/*
 * How one environment's row reads. A connected one is quiet - its green dot
 * says it, and the word is there for a screen reader only - so the rows
 * that need a look are the ones with words beside them: one that was heard
 * from and went quiet (when it was last heard from, in amber), and one that
 * has sent nothing yet (waiting for its first data, in grey: nothing broke).
 */
export enum AppPlatformEnvironmentState {
  Connected = "connected",
  Quiet = "quiet",
  Waiting = "waiting",
}

export function getAppPlatformEnvironmentState(
  row: AppPlatformEnvironmentRow,
): AppPlatformEnvironmentState {
  if (row.isConnected) {
    return AppPlatformEnvironmentState.Connected;
  }

  return row.lastSeenAt
    ? AppPlatformEnvironmentState.Quiet
    : AppPlatformEnvironmentState.Waiting;
}

// How many of a platform's environments the card lists before "and N more".
export const ENVIRONMENTS_SHOWN_PER_PLATFORM: number = 5;

const PLATFORM_ORDER: ReadonlyArray<string> = MANAGED_CLOUD_PLATFORMS.map(
  (descriptor: ManagedCloudPlatformDescriptor): string => {
    return descriptor.platform;
  },
);

function platformRank(platform: string): number {
  const rank: number = PLATFORM_ORDER.indexOf(platform);
  // Platforms the catalogue does not know, then no platform at all, last.
  if (rank >= 0) {
    return rank;
  }
  return platform ? PLATFORM_ORDER.length : PLATFORM_ORDER.length + 1;
}

/*
 * An environment's place in its group: disconnected first, the one heard
 * from longest ago before the others, then by name, so the order is the
 * same on every read.
 */
function compareEnvironments(
  a: AppPlatformEnvironmentRow,
  b: AppPlatformEnvironmentRow,
): number {
  if (a.isConnected !== b.isConnected) {
    return a.isConnected ? 1 : -1;
  }

  if (!a.isConnected) {
    const aSeen: number = a.lastSeenAt ? a.lastSeenAt.getTime() : 0;
    const bSeen: number = b.lastSeenAt ? b.lastSeenAt.getTime() : 0;

    if (aSeen !== bSeen) {
      return aSeen - bSeen;
    }
  }

  return a.name.localeCompare(b.name);
}

export function groupEnvironmentsByPlatform(
  rows: ReadonlyArray<AppPlatformEnvironmentRow>,
): Array<AppPlatformGroup> {
  const groups: Map<string, AppPlatformGroup> = new Map<
    string,
    AppPlatformGroup
  >();

  for (const row of rows) {
    const platform: string = (row.cloudPlatform || "").trim();
    let group: AppPlatformGroup | undefined = groups.get(platform);

    if (!group) {
      const descriptor: ManagedCloudPlatformDescriptor | null =
        getManagedCloudPlatformDescriptor(platform);
      const provider: string = descriptor?.provider || row.cloudProvider || "";

      group = {
        platform: platform,
        title: descriptor?.productName || platform,
        providerLabel: getCloudProviderLabel(provider),
        provider: provider,
        environments: [],
        connected: 0,
      };
      groups.set(platform, group);
    }

    group.environments.push(row);

    if (row.isConnected) {
      group.connected = group.connected + 1;
    }
  }

  const ordered: Array<AppPlatformGroup> = Array.from(groups.values()).sort(
    (a: AppPlatformGroup, b: AppPlatformGroup): number => {
      const byRank: number =
        platformRank(a.platform) - platformRank(b.platform);
      return byRank !== 0 ? byRank : a.title.localeCompare(b.title);
    },
  );

  for (const group of ordered) {
    group.environments.sort(compareEnvironments);
  }

  return ordered;
}

export function getAppPlatformGroupTone(
  group: AppPlatformGroup,
): AppPlatformGroupTone {
  if (group.connected >= group.environments.length) {
    return AppPlatformGroupTone.Healthy;
  }

  return group.connected === 0
    ? AppPlatformGroupTone.Silent
    : AppPlatformGroupTone.Partial;
}

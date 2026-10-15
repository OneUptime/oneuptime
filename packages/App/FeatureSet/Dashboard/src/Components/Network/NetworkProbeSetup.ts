import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether the project has a probe on its own network yet - the first thing
 * anyone bringing a network into OneUptime needs, and the one thing the
 * Network area never told them.
 *
 * Every device is pinged and read by a probe, and the probe has to reach the
 * device: a switch at 10.0.0.2 answers nobody on the internet. OneUptime's
 * own probes (the global ones) sit on the internet on OneUptime Cloud, so a
 * new project's Add Device and scan forms offered either no probe at all or
 * only probes that could never reach the device, and the way out was a small
 * "Create a custom probe" link into another product.
 *
 * So the Network Overview's first-run path starts here, and this module says
 * which state that first step is in. Plain logic, free of React and of the
 * routes, so App/Tests can read it.
 */

export enum NetworkProbeSetupKind {
  // No probe of the project's own: the step is still to do.
  NoProbe = "noProbe",
  // Added, but none has checked in yet: it still has to be run.
  Waiting = "waiting",
  // At least one of the project's probes is checking in.
  Connected = "connected",
}

/*
 * What the step needs to know about one of the project's probes. Global
 * probes are not counted: they are OneUptime's, not "a probe on your
 * network".
 */
export interface NetworkProbeFacts {
  id: string;
  name: string;
  connectionStatus?: string | null | undefined;
  lastAlive?: Date | string | null | undefined;
}

export interface NetworkProbeSetup {
  kind: NetworkProbeSetupKind;
  // The project's probes that are checking in, in the order they came.
  connected: Array<NetworkProbeFacts>;
  // The project's probes that are not (yet): added, but not running.
  waiting: Array<NetworkProbeFacts>;
}

/*
 * The connection status a probe is stamped with once its heartbeats arrive
 * (ProbeConnectionStatus.Connected). Spelled out rather than imported so this
 * module stays free of the database models.
 */
export const PROBE_CONNECTED_STATUS: string = "connected";

/*
 * How recently a probe must have checked in to count as connected before the
 * worker that stamps its status has caught up. The worker marks a probe
 * Disconnected after three minutes of silence (Workers/Jobs/Probe/
 * UpdateConnectionStatus), so a heartbeat newer than that is the same answer
 * it will give - only sooner, which is what someone watching a probe they
 * have just started is waiting for.
 */
export const PROBE_CHECK_IN_WINDOW_IN_MS: number = 3 * 60 * 1000;

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time: number =
    value instanceof Date ? value.getTime() : new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

/**
 * Whether the probe is checking in: stamped connected, or heard from within
 * the last three minutes. A heartbeat from the future (a skewed clock) counts
 * as recent rather than as stale.
 */
export function isProbeConnected(probe: NetworkProbeFacts, now: Date): boolean {
  if (probe.connectionStatus === PROBE_CONNECTED_STATUS) {
    return true;
  }

  const lastAlive: number | null = toTime(probe.lastAlive);

  if (lastAlive === null) {
    return false;
  }

  return now.getTime() - lastAlive < PROBE_CHECK_IN_WINDOW_IN_MS;
}

/**
 * Which state the project's probe step is in. Connected wins as soon as one
 * probe checks in: one probe on the network is enough to bring devices in,
 * whatever else was added and never run.
 */
export function getNetworkProbeSetup(
  probes: Array<NetworkProbeFacts>,
  now: Date,
): NetworkProbeSetup {
  const connected: Array<NetworkProbeFacts> = [];
  const waiting: Array<NetworkProbeFacts> = [];

  for (const probe of probes) {
    if (!probe.id) {
      continue;
    }

    if (isProbeConnected(probe, now)) {
      connected.push(probe);
    } else {
      waiting.push(probe);
    }
  }

  let kind: NetworkProbeSetupKind = NetworkProbeSetupKind.NoProbe;

  if (connected.length > 0) {
    kind = NetworkProbeSetupKind.Connected;
  } else if (waiting.length > 0) {
    kind = NetworkProbeSetupKind.Waiting;
  }

  return { kind, connected, waiting };
}

/*
 * How often the first-run path asks again while a probe has been added but
 * has not checked in: often enough that the step turns green within seconds
 * of the probe starting, rarely enough to cost nothing while it waits.
 */
export const PROBE_WAITING_POLL_INTERVAL_IN_MS: number = 10 * 1000;

/**
 * Whether the page should keep asking about the probes: only while one has
 * been added and none is running yet. Nothing to wait for otherwise.
 */
export function shouldPollProbeSetup(setup: NetworkProbeSetup): boolean {
  return setup.kind === NetworkProbeSetupKind.Waiting;
}

// The words of the step, in one place for the component and the tests.
export const PROBE_STEP_TITLE: string = translationKey(
  "Put a probe on your network",
);

export const PROBE_STEP_DESCRIPTION: string = translationKey(
  "A probe is a small program you run on a computer inside your network, such as a server or a virtual machine. It checks your devices from there: a probe on the internet cannot reach private addresses like 10.0.0.1.",
);

export const PROBE_STEP_WAITING: string = translationKey(
  "{{name}} is added. Run it on a computer on your network and this step turns green.",
);

export const PROBE_STEP_CONNECTED_ONE: string = translationKey(
  "{{name}} is connected.",
);

// For two or more: one probe is named instead (PROBE_STEP_CONNECTED_ONE).
export const PROBE_STEP_CONNECTED_MANY: PluralTemplate = {
  one: "{{count}} probe is connected.",
  other: "{{count}} probes are connected.",
};

/*
 * On a self-hosted server, OneUptime's own probes run beside it - often on
 * the very network the devices are on. They are not "your probe on your
 * network", but they may well reach it, so the step says so instead of
 * implying they cannot.
 */
export const PROBE_STEP_SERVER_PROBE_NOTE: string = translationKey(
  "This OneUptime server runs a probe of its own too. It can check your devices if this server can reach them.",
);

export const DEVICES_STEP_TITLE: string = translationKey(
  "Bring your devices in",
);

export const ALERTS_STEP_TITLE: string = translationKey(
  "Get told when a device goes down",
);

export const ALERTS_STEP_DESCRIPTION: string = translationKey(
  "One alert policy raises an incident when any device goes down, for the devices you have now and every one you add later.",
);

export const ALERTS_STEP_DONE: string = translationKey("Alerts are on.");

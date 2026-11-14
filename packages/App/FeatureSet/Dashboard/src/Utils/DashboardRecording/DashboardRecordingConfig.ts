import { BILLING_ENABLED, env } from "Common/UI/Config";

/*
 * WATCHING ONEUPTIME WITH ONEUPTIME (issue #6834): the switch.
 *
 * On OneUptime Cloud, the Dashboard can record how people who accepted
 * analytics use its first-run pages, with OneUptime's own session replay,
 * into a Real User Monitoring application of the OneUptime team's own
 * project - to see where people get stuck. It is off unless OneUptime
 * Cloud's deployment says otherwise, in four settings of the App
 * (env.js serves every PUBLIC_ setting to the browser):
 *
 *   PUBLIC_DASHBOARD_SESSION_REPLAY_ENABLED         "true" to turn it on
 *   PUBLIC_DASHBOARD_SESSION_REPLAY_TOKEN           the ingestion key of that project
 *   PUBLIC_DASHBOARD_SESSION_REPLAY_APP_IDENTIFIER  the RUM application's identifier
 *   PUBLIC_DASHBOARD_SESSION_REPLAY_HOST            optional; the Dashboard's own origin otherwise
 *
 * and only where billing is on - OneUptime Cloud. On a self-hosted server
 * none of this is set, so readDashboardRecordingConfig answers null, and
 * nothing is loaded, fetched or sent: the recorder's code is a separate file
 * the Dashboard imports only after every gate (DashboardRecordingGate) has
 * passed, and asks nothing of the server for it before then.
 */

export const DASHBOARD_RECORDING_ENV: {
  enabled: string;
  token: string;
  appIdentifier: string;
  host: string;
} = {
  enabled: "PUBLIC_DASHBOARD_SESSION_REPLAY_ENABLED",
  token: "PUBLIC_DASHBOARD_SESSION_REPLAY_TOKEN",
  appIdentifier: "PUBLIC_DASHBOARD_SESSION_REPLAY_APP_IDENTIFIER",
  host: "PUBLIC_DASHBOARD_SESSION_REPLAY_HOST",
};

export interface DashboardRecordingConfig {
  // Where the recorder is loaded from and recordings are sent, no trailing slash.
  host: string;
  token: string;
  appIdentifier: string;
}

export interface DashboardRecordingConfigInput {
  readEnv: (key: string) => string | undefined;
  isBillingEnabled: boolean;
  // The Dashboard's own origin, for a host that is not set.
  ownOrigin: string;
}

const HTTP_ORIGIN: RegExp = /^https?:\/\/[^/\s?#]+$/i;

/*
 * The configuration, or null when recording is off: not OneUptime Cloud,
 * not switched on, or missing what it needs. A host that is not a plain
 * http(s) origin is a mistake, not a place to send recordings: null too.
 */
export const readDashboardRecordingConfig: (
  input: DashboardRecordingConfigInput,
) => DashboardRecordingConfig | null = (
  input: DashboardRecordingConfigInput,
): DashboardRecordingConfig | null => {
  if (!input.isBillingEnabled) {
    return null;
  }

  const read: (key: string) => string = (key: string): string => {
    return (input.readEnv(key) || "").trim();
  };

  if (read(DASHBOARD_RECORDING_ENV.enabled).toLowerCase() !== "true") {
    return null;
  }

  const token: string = read(DASHBOARD_RECORDING_ENV.token);
  const appIdentifier: string = read(DASHBOARD_RECORDING_ENV.appIdentifier);
  const host: string = (
    read(DASHBOARD_RECORDING_ENV.host) || input.ownOrigin
  ).replace(/\/+$/, "");

  if (!token || !appIdentifier || !HTTP_ORIGIN.test(host)) {
    return null;
  }

  return { host: host, token: token, appIdentifier: appIdentifier };
};

const ownOrigin: () => string = (): string => {
  try {
    return window.location.origin;
  } catch {
    return "";
  }
};

// This Dashboard's configuration, read from env.js.
export const getDashboardRecordingConfig: () => DashboardRecordingConfig | null =
  (): DashboardRecordingConfig | null => {
    return readDashboardRecordingConfig({
      readEnv: (key: string): string | undefined => {
        return env(key);
      },
      isBillingEnabled: BILLING_ENABLED,
      ownOrigin: ownOrigin(),
    });
  };

/*
 * Whether this server records anybody at all: what decides if the person's
 * and the project's off switches are shown. A server that never records
 * shows no switch for it.
 */
export const isDashboardRecordingConfigured: () => boolean = (): boolean => {
  return getDashboardRecordingConfig() !== null;
};

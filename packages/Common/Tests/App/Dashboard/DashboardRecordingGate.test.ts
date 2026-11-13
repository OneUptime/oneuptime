import { describe, expect, test } from "@jest/globals";
import {
  DASHBOARD_RECORDING_ENV,
  DashboardRecordingConfig,
  readDashboardRecordingConfig,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/DashboardRecording/DashboardRecordingConfig";
import {
  DashboardRecordingDecision,
  DashboardRecordingGateInput,
  decideDashboardRecording,
  shouldReadSwitches,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/DashboardRecording/DashboardRecordingGate";

/*
 * Watching OneUptime with OneUptime (#6834): the configuration that turns
 * recording on, and the gate every moment passes - in order - before
 * anything is recorded.
 *
 * The first gate is the one a self-hosted server stops at: without
 * OneUptime Cloud's configuration (billing on, and the four
 * PUBLIC_DASHBOARD_SESSION_REPLAY_ settings) there is no configuration,
 * and the gate answers "not-configured" before any other question.
 */

const CLOUD_ENV: Record<string, string> = {
  [DASHBOARD_RECORDING_ENV.enabled]: "true",
  [DASHBOARD_RECORDING_ENV.token]: "ingestion-key",
  [DASHBOARD_RECORDING_ENV.appIdentifier]: "dashboard-app",
};

const read: (
  env: Record<string, string>,
  overrides?: { isBillingEnabled?: boolean; ownOrigin?: string },
) => DashboardRecordingConfig | null = (
  env: Record<string, string>,
  overrides?: { isBillingEnabled?: boolean; ownOrigin?: string },
): DashboardRecordingConfig | null => {
  return readDashboardRecordingConfig({
    readEnv: (key: string): string | undefined => {
      return env[key];
    },
    isBillingEnabled: overrides?.isBillingEnabled ?? true,
    ownOrigin: overrides?.ownOrigin ?? "https://oneuptime.com",
  });
};

const CONFIG: DashboardRecordingConfig = {
  host: "https://oneuptime.com",
  token: "ingestion-key",
  appIdentifier: "dashboard-app",
};

const everyGateOpen: () => DashboardRecordingGateInput =
  (): DashboardRecordingGateInput => {
    return {
      config: CONFIG,
      isConsentGiven: true,
      isPersonOff: false,
      hasProject: true,
      isProjectOff: false,
      isRecordedPage: true,
    };
  };

describe("the configuration", () => {
  test("is read on OneUptime Cloud once it is switched on, with the Dashboard's own origin as the host", () => {
    expect(read(CLOUD_ENV)).toEqual(CONFIG);
  });

  test("is nothing on a self-hosted server: nothing set", () => {
    expect(read({}, { isBillingEnabled: false })).toBeNull();
  });

  test("is nothing without billing even when every setting is there - a self-hosted server that copied them", () => {
    expect(read(CLOUD_ENV, { isBillingEnabled: false })).toBeNull();
  });

  test("is off until it is switched on, whatever else is set", () => {
    for (const enabled of ["", "false", "1", "yes", "on"]) {
      expect(
        read({ ...CLOUD_ENV, [DASHBOARD_RECORDING_ENV.enabled]: enabled }),
      ).toBeNull();
    }

    expect(
      read({ ...CLOUD_ENV, [DASHBOARD_RECORDING_ENV.enabled]: " TRUE " }),
    ).toEqual(CONFIG);
  });

  test("needs the ingestion key and the application", () => {
    expect(
      read({ ...CLOUD_ENV, [DASHBOARD_RECORDING_ENV.token]: " " }),
    ).toBeNull();
    expect(
      read({ ...CLOUD_ENV, [DASHBOARD_RECORDING_ENV.appIdentifier]: "" }),
    ).toBeNull();
  });

  test("takes a host that is a plain http(s) origin, without its trailing slash", () => {
    expect(
      read({
        ...CLOUD_ENV,
        [DASHBOARD_RECORDING_ENV.host]: "https://replay.oneuptime.com/",
      })?.host,
    ).toBe("https://replay.oneuptime.com");
  });

  test("refuses a host that is anything else", () => {
    for (const host of [
      "javascript:alert(1)",
      "//oneuptime.com",
      "https://oneuptime.com/path",
      "https://oneuptime.com?x=1",
      "ftp://oneuptime.com",
    ]) {
      expect(read({ ...CLOUD_ENV, [DASHBOARD_RECORDING_ENV.host]: host })).toBe(
        null,
      );
    }
  });

  test("is named by four PUBLIC_ settings, which env.js serves to the browser", () => {
    for (const key of Object.values(DASHBOARD_RECORDING_ENV)) {
      expect(key.startsWith("PUBLIC_DASHBOARD_SESSION_REPLAY_")).toBe(true);
    }
  });
});

describe("the gate", () => {
  test("records only when every gate is open", () => {
    expect(decideDashboardRecording(everyGateOpen())).toBe(
      DashboardRecordingDecision.Record,
    );
  });

  test("1. stops a server with no configuration before anything else", () => {
    expect(
      decideDashboardRecording({
        config: null,
        isConsentGiven: false,
        isPersonOff: null,
        hasProject: true,
        isProjectOff: null,
        isRecordedPage: false,
      }),
    ).toBe(DashboardRecordingDecision.NotConfigured);

    expect(decideDashboardRecording({ ...everyGateOpen(), config: null })).toBe(
      DashboardRecordingDecision.NotConfigured,
    );
  });

  test("2. then consent", () => {
    expect(
      decideDashboardRecording({
        ...everyGateOpen(),
        isConsentGiven: false,
        isPersonOff: true,
        isProjectOff: true,
        isRecordedPage: false,
      }),
    ).toBe(DashboardRecordingDecision.NoConsent);
  });

  test("3. then the person's switch, unknown counting as off", () => {
    for (const isPersonOff of [true, null]) {
      expect(
        decideDashboardRecording({
          ...everyGateOpen(),
          isPersonOff: isPersonOff,
          isProjectOff: true,
          isRecordedPage: false,
        }),
      ).toBe(DashboardRecordingDecision.PersonOff);
    }
  });

  test("4. then the project's switch, unknown counting as off", () => {
    for (const isProjectOff of [true, null]) {
      expect(
        decideDashboardRecording({
          ...everyGateOpen(),
          isProjectOff: isProjectOff,
          isRecordedPage: false,
        }),
      ).toBe(DashboardRecordingDecision.ProjectOff);
    }
  });

  test("4. a page outside any project has no project to ask", () => {
    expect(
      decideDashboardRecording({
        ...everyGateOpen(),
        hasProject: false,
        isProjectOff: null,
      }),
    ).toBe(DashboardRecordingDecision.Record);
  });

  test("5. then the page", () => {
    expect(
      decideDashboardRecording({ ...everyGateOpen(), isRecordedPage: false }),
    ).toBe(DashboardRecordingDecision.PageNotRecorded);
  });

  test("reads the switches only once the configuration and consent are there", () => {
    expect(shouldReadSwitches({ config: null, isConsentGiven: true })).toBe(
      false,
    );
    expect(shouldReadSwitches({ config: CONFIG, isConsentGiven: false })).toBe(
      false,
    );
    expect(shouldReadSwitches({ config: CONFIG, isConsentGiven: true })).toBe(
      true,
    );
  });
});

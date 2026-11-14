import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import React, { useEffect } from "react";
import { MemoryRouter, NavigateFunction, useNavigate } from "react-router-dom";

/*
 * Watching OneUptime with OneUptime (#6834), as App mounts it: the real
 * component, the real gate, controller and recorder bridge, with only the
 * server's answers, the consent reading and the configuration stubbed.
 *
 * Above all: a Dashboard without OneUptime Cloud's configuration - every
 * self-hosted one - reads no switch, adds no script and sets no recorder
 * global, on any page.
 */

const PROJECT: string = "6a1c5e0f2b3d4c5e6f708192";
const HOME: string = `/dashboard/${PROJECT}/home/`;
const INCIDENTS: string = `/dashboard/${PROJECT}/incidents`;
const SCRIPT_SELECTOR: string = "script[data-oneuptime-dashboard-recording]";

interface Stubs {
  config: { host: string; token: string; appIdentifier: string } | null;
  isConsentGiven: boolean;
  isPersonOff: boolean;
  isProjectOff: boolean;
  reads: Array<string>;
}

const stubs: Stubs = {
  config: null,
  isConsentGiven: false,
  isPersonOff: false,
  isProjectOff: false,
  reads: [],
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/DashboardRecording/DashboardRecordingConfig",
  () => {
    return {
      __esModule: true,
      getDashboardRecordingConfig: () => {
        return stubs.config;
      },
      isDashboardRecordingConfigured: () => {
        return stubs.config !== null;
      },
    };
  },
);

jest.mock("../../../Utils/Analytics", () => {
  class AnalyticsStub {
    public isInitialized: boolean = false;

    public static isSessionRecordingAllowed(): boolean {
      return stubs.isConsentGiven;
    }

    public static isProductAnalyticsAllowed(): boolean {
      return false;
    }

    public capture(): void {}
    public userAuth(): void {}
    public logout(): void {}
    public setGoogleAnalyticsUserId(): void {}
  }

  return {
    __esModule: true,
    default: AnalyticsStub,
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isLoggedIn: (): boolean => {
        return true;
      },
      // What the component reads of an id: its string.
      getUserId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "5a1c5e0f2b3d4c5e6f708192";
          },
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (data: {
        modelType: { new (): { tableName?: string } };
      }): Promise<unknown> => {
        const item: Record<string, unknown> = new data.modelType() as Record<
          string,
          unknown
        >;
        const table: string = String(
          (item as { tableName?: string }).tableName,
        );

        stubs.reads.push(table);

        item["disableDashboardRecording"] =
          table === "User" ? stubs.isPersonOff : stubs.isProjectOff;

        return item;
      },
    },
  };
});

import DashboardRecording from "../../../../App/FeatureSet/Dashboard/src/Components/DashboardRecording/DashboardRecording";

let navigate: NavigateFunction | null = null;

const NavigationHandle: React.FunctionComponent = (): React.ReactElement => {
  const navigateTo: NavigateFunction = useNavigate();

  useEffect(() => {
    navigate = navigateTo;
  }, [navigateTo]);

  return <></>;
};

const windowRecord: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  return window as unknown as Record<string, unknown>;
};

const renderAt: (path: string) => void = (path: string): void => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <NavigationHandle />
      <DashboardRecording projectId={PROJECT} />
    </MemoryRouter>,
  );
};

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
};

describe("DashboardRecording", () => {
  beforeEach(() => {
    stubs.config = {
      host: "https://oneuptime.com",
      token: "ingestion-key",
      appIdentifier: "dashboard-app",
    };
    stubs.isConsentGiven = true;
    stubs.isPersonOff = false;
    stubs.isProjectOff = false;
    stubs.reads = [];
    navigate = null;
  });

  afterEach(() => {
    cleanup();
    document.head.innerHTML = "";
    delete windowRecord()["__ONEUPTIME_SESSION_REPLAY__"];
    delete windowRecord()["OneUptimeReplayQueue"];
  });

  test("a self-hosted Dashboard reads nothing, loads nothing and sets nothing, on any page", async () => {
    stubs.config = null;

    renderAt(HOME);
    await settle();

    await act(async () => {
      navigate?.(INCIDENTS);
    });
    await settle();

    expect(stubs.reads).toEqual([]);
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
    expect(windowRecord()["__ONEUPTIME_SESSION_REPLAY__"]).toBeUndefined();
    expect(windowRecord()["OneUptimeReplayQueue"]).toBeUndefined();
  });

  test("a person who did not accept analytics: no switch read, nothing loaded", async () => {
    stubs.isConsentGiven = false;

    renderAt(HOME);
    await settle();

    expect(stubs.reads).toEqual([]);
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
  });

  test("on Cloud, with consent and both switches on, a first-run page loads the recorder from the configured host", async () => {
    renderAt(HOME);

    await waitFor(() => {
      expect(document.querySelector(SCRIPT_SELECTOR)).not.toBeNull();
    });

    expect(stubs.reads.sort()).toEqual(["Project", "User"]);
    expect(
      (document.querySelector(SCRIPT_SELECTOR) as HTMLScriptElement).src,
    ).toBe("https://oneuptime.com/telemetry/session-replay/v1/recorder.js");
    expect(
      (
        windowRecord()["__ONEUPTIME_SESSION_REPLAY__"] as Record<
          string,
          unknown
        >
      )["maskAllText"],
    ).toBe(true);
  });

  test("a person who switched it off is never recorded", async () => {
    stubs.isPersonOff = true;

    renderAt(HOME);
    await settle();

    expect(stubs.reads).toContain("User");
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
  });

  test("nobody is recorded in a project that switched it off", async () => {
    stubs.isProjectOff = true;

    renderAt(HOME);
    await settle();

    expect(stubs.reads).toContain("Project");
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
  });

  test("a page that is not recorded loads nothing", async () => {
    renderAt(INCIDENTS);
    await settle();

    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
  });

  test("leaving for a page that is not recorded pauses, coming back resumes", async () => {
    renderAt(HOME);

    await waitFor(() => {
      expect(document.querySelector(SCRIPT_SELECTOR)).not.toBeNull();
    });

    await act(async () => {
      navigate?.(INCIDENTS);
    });
    await settle();

    await act(async () => {
      navigate?.(HOME);
    });
    await settle();

    const commands: Array<string> = (
      windowRecord()["OneUptimeReplayQueue"] as Array<Array<unknown>>
    ).map((command: Array<unknown>): string => {
      return String(command[0]);
    });

    expect(commands[0]).toBe("grantConsent");
    expect(commands).toContain("pause");
    expect(commands.indexOf("resume")).toBeGreaterThan(
      commands.indexOf("pause"),
    );
  });
});

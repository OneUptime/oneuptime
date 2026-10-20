import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Profiles monitor's form: the function its Function Share criteria
 * watch, the kind of profile it reads and its window - and, under them,
 * what the monitor would read right now, so a threshold is picked from
 * what the function takes today. A monitor saved with raw types of several
 * kinds keeps them; one with none reads every kind.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: { message?: string }) => {
        return error?.message || "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

import ProfileMonitorStepForm, {
  ANY_PROFILE_KIND,
  CUSTOM_PROFILE_KIND,
  getProfileMonitorKindValue,
  getProfileMonitorPreviewCategory,
  readProfileMonitorPreview,
  toProfileMonitorConfig,
  toProfileMonitorFormValues,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ProfileMonitor/ProfileMonitorStepForm";
import MonitorStepProfileMonitor, {
  MonitorStepProfileMonitorUtil,
} from "../../../Types/Monitor/MonitorStepProfileMonitor";
import ObjectID from "../../../Types/ObjectID";
import { ProfileCategory } from "../../../Utils/Profiles/ProfileTypes";

const SERVICE_ID: string = "60000000-0000-4000-8000-0000000000a1";

function monitor(
  change: Partial<MonitorStepProfileMonitor> = {},
): MonitorStepProfileMonitor {
  return {
    ...MonitorStepProfileMonitorUtil.getDefault(),
    telemetryServiceIds: [new ObjectID(SERVICE_ID)],
    functionName: "parseOrder",
    ...change,
  };
}

beforeEach(() => {
  postMock.mockReset();
  postMock.mockImplementation(async () => {
    return {
      data: {
        profileCount: 30,
        functionShare: {
          functionName: "parseOrder",
          sharePercent: 34.2,
          windowSampleCount: 12000,
        },
      },
    };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the form's values and the monitor they save", () => {
  test("a kind is read back from the raw types it was saved as", () => {
    expect(
      getProfileMonitorKindValue(["cpu", "process_cpu", "cpu_time", "samples"]),
    ).toBe("cpu");
    expect(getProfileMonitorKindValue(["inuse_space"])).toBe("memory");
    expect(getProfileMonitorKindValue([])).toBe(ANY_PROFILE_KIND);
    expect(getProfileMonitorKindValue(undefined)).toBe(ANY_PROFILE_KIND);
    // Types of several kinds were picked by hand: kept as they are.
    expect(getProfileMonitorKindValue(["cpu", "inuse_space"])).toBe(
      CUSTOM_PROFILE_KIND,
    );
  });

  test("the values round-trip into the monitor, a kind becoming its raw types", () => {
    const saved: MonitorStepProfileMonitor = monitor();
    const values: ReturnType<typeof toProfileMonitorFormValues> =
      toProfileMonitorFormValues(saved);

    expect(values).toEqual({
      functionName: "parseOrder",
      kind: "cpu",
      lastXSecondsOfProfiles: 300,
      telemetryServiceIds: [SERVICE_ID],
      entityKeys: [],
    });

    const changed: MonitorStepProfileMonitor = toProfileMonitorConfig(
      { ...values, kind: "memory", functionName: "  loadCatalog  " },
      saved,
    );

    expect(changed.profileTypes).toEqual(["inuse_space", "heap", "space"]);
    expect(changed.functionName).toBe("loadCatalog");
    expect(
      changed.telemetryServiceIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([SERVICE_ID]);
  });

  test("every kind reads no type filter; a hand-picked mix is kept; a bad service id is dropped", () => {
    const saved: MonitorStepProfileMonitor = monitor({
      profileTypes: ["cpu", "inuse_space"],
    });

    expect(
      toProfileMonitorConfig(
        { ...toProfileMonitorFormValues(saved), kind: ANY_PROFILE_KIND },
        saved,
      ).profileTypes,
    ).toEqual([]);
    expect(
      toProfileMonitorConfig(toProfileMonitorFormValues(saved), saved)
        .profileTypes,
    ).toEqual(["cpu", "inuse_space"]);
    expect(
      toProfileMonitorConfig(
        {
          ...toProfileMonitorFormValues(saved),
          telemetryServiceIds: ["checkout", SERVICE_ID],
        },
        saved,
      ).telemetryServiceIds,
    ).toHaveLength(1);
  });

  test("the preview's answer is read defensively", () => {
    expect(readProfileMonitorPreview({})).toEqual({
      profileCount: 0,
      functionShare: null,
    });
    expect(
      readProfileMonitorPreview({
        profileCount: "12",
        functionShare: { functionName: "f", sharePercent: "4.5" },
      } as never),
    ).toEqual({
      profileCount: 12,
      functionShare: {
        functionName: "f",
        sharePercent: 4.5,
        windowSampleCount: 0,
      },
    });
  });
});

describe("what the monitor would read now", () => {
  test("its profiles and the function's share, read with the monitor's own settings", async () => {
    jest.useFakeTimers();

    await act(async (): Promise<void> => {
      render(
        <ProfileMonitorStepForm
          monitorStepProfileMonitor={monitor()}
          onMonitorStepProfileMonitorChanged={() => {}}
          telemetryServices={[]}
        />,
      );
    });

    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(600);
    });
    jest.useRealTimers();

    await waitFor(() => {
      expect(screen.getByTestId("profile-monitor-preview")).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("profile-monitor-preview-count"),
    ).toHaveTextContent("30 profiles in the window.");
    expect(
      screen.getByTestId("profile-monitor-preview-share"),
    ).toHaveTextContent("parseOrder takes 34% of the CPU time in this window.");

    const request: {
      url: { toString: () => string };
      data: Record<string, unknown>;
    } = postMock.mock.calls[0]![0] as never;
    expect(request.url.toString()).toContain(
      "/telemetry/profiles/monitor-preview",
    );
    expect(request.data["functionName"]).toBe("parseOrder");
    expect(request.data["lastXSecondsOfProfiles"]).toBe(300);
  });

  test("nothing profiled in the window says Function Share has nothing to judge yet", async () => {
    postMock.mockImplementation(async () => {
      return {
        data: {
          profileCount: 0,
          functionShare: {
            functionName: "parseOrder",
            sharePercent: 0,
            windowSampleCount: 0,
          },
        },
      };
    });
    jest.useFakeTimers();

    await act(async (): Promise<void> => {
      render(
        <ProfileMonitorStepForm
          monitorStepProfileMonitor={monitor()}
          onMonitorStepProfileMonitorChanged={() => {}}
          telemetryServices={[]}
        />,
      );
    });
    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(600);
    });
    jest.useRealTimers();

    expect(
      await screen.findByTestId("profile-monitor-preview-nothing"),
    ).toHaveTextContent(
      "Nothing was profiled in this window, so Function Share has nothing to judge yet.",
    );
  });

  /*
   * "parseOrder takes 34% of the window." said a share of what? Of the
   * kind the monitor reads, as the Profiler's own headline says it.
   */
  test.each([
    [
      "memory",
      ["inuse_space"],
      "parseOrder takes 34% of the memory in this window.",
    ],
    [
      "every kind at once",
      [],
      "parseOrder takes 34% of the samples in this window.",
    ],
  ])(
    "the share is named as a share of %s",
    async (_kind: string, profileTypes: Array<string>, sentence: string) => {
      jest.useFakeTimers();

      await act(async (): Promise<void> => {
        render(
          <ProfileMonitorStepForm
            monitorStepProfileMonitor={monitor({ profileTypes })}
            onMonitorStepProfileMonitorChanged={() => {}}
            telemetryServices={[]}
          />,
        );
      });
      await act(async (): Promise<void> => {
        jest.advanceTimersByTime(600);
      });
      jest.useRealTimers();

      expect(
        await screen.findByTestId("profile-monitor-preview-share"),
      ).toHaveTextContent(sentence);
    },
  );

  test("the preview's kind: the one picked, every kind's samples, or a saved mix's", () => {
    expect(getProfileMonitorPreviewCategory("memory", undefined)).toBe(
      ProfileCategory.Memory,
    );
    expect(getProfileMonitorPreviewCategory(ANY_PROFILE_KIND, [])).toBe(
      ProfileCategory.Other,
    );
    // Raw types of several kinds have no one kind: their samples.
    expect(
      getProfileMonitorPreviewCategory(CUSTOM_PROFILE_KIND, [
        "cpu",
        "inuse_space",
      ]),
    ).toBe(ProfileCategory.Other);
    expect(getProfileMonitorPreviewCategory("", undefined)).toBe(
      ProfileCategory.Other,
    );
  });
});

describe("short words", () => {
  test("the Function field and the preview each say what they need in one short sentence", async () => {
    await act(async (): Promise<void> => {
      render(
        <ProfileMonitorStepForm
          monitorStepProfileMonitor={monitor()}
          onMonitorStepProfileMonitorChanged={() => {}}
          telemetryServices={[]}
        />,
      );
    });

    expect(
      screen.getByText(
        "Its name, or part of its file or package path, as the Profiler shows it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Set the threshold above what the function takes today.",
      ),
    ).toBeInTheDocument();
    // The long two-sentence wordings they replaced are gone.
    expect(document.body.textContent).not.toContain(
      "Function Share criteria judge how much of the window runs through it.",
    );
    expect(document.body.textContent).not.toContain(
      "Read with the monitor's own query",
    );
  });
});

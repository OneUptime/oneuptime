import { describe, expect, test } from "@jest/globals";
import { DashboardRecordingConfig } from "../../../../App/FeatureSet/Dashboard/src/Utils/DashboardRecording/DashboardRecordingConfig";
import DashboardRecordingController, {
  DashboardRecorderHandle,
  DashboardRecorderStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/DashboardRecording/DashboardRecordingController";
import { DashboardRecordingDecision } from "../../../../App/FeatureSet/Dashboard/src/Utils/DashboardRecording/DashboardRecordingGate";
import {
  DashboardSignalName,
  FORM_REFUSALS_FOR_SIGNAL,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/DashboardRecording/DashboardSignals";

/*
 * What the recorder is told as the person moves around the Dashboard
 * (#6834): loaded the first time a page may be recorded and never before,
 * paused on every page that is not recorded, resumed on the way back, and
 * stopped for good when consent or a switch goes. Signs of frustration and
 * the product's events are marked only while it records.
 */

const CONFIG: DashboardRecordingConfig = {
  host: "https://oneuptime.com",
  token: "ingestion-key",
  appIdentifier: "dashboard-app",
};

const HOME: string = "/dashboard/:projectId/home";
const CREATE: string = "/dashboard/:projectId/monitors/create";
const INCIDENT: string = "/dashboard/:projectId/incidents/:id";

type Call = Array<unknown>;

interface Harness {
  controller: DashboardRecordingController;
  calls: Array<Call>;
  loads: () => number;
  // Let the import() settle.
  arrive: () => Promise<void>;
  clock: { now: number };
}

const harness: (options?: { failToLoad?: boolean }) => Harness = (options?: {
  failToLoad?: boolean;
}): Harness => {
  const calls: Array<Call> = [];
  let loadCount: number = 0;
  let resolveLoad: (() => void) | null = null;
  const clock: { now: number } = { now: 0 };

  const recorder: DashboardRecorderHandle = {
    start: (
      config: DashboardRecordingConfig,
      startOptions?: { startPaused?: boolean | undefined } | undefined,
    ): void => {
      calls.push(["start", config.host, Boolean(startOptions?.startPaused)]);
    },
    pause: (): void => {
      calls.push(["pause"]);
    },
    resume: (): void => {
      calls.push(["resume"]);
    },
    track: (name: string): void => {
      calls.push(["track", name]);
    },
    setTags: (tags: Record<string, string>): void => {
      calls.push(["setTags", tags]);
    },
    stop: (): void => {
      calls.push(["stop"]);
    },
  };

  const controller: DashboardRecordingController =
    new DashboardRecordingController({
      loadRecorder: (): Promise<DashboardRecorderHandle> => {
        loadCount++;

        return new Promise<DashboardRecorderHandle>(
          (
            resolve: (handle: DashboardRecorderHandle) => void,
            reject: (error: Error) => void,
          ): void => {
            resolveLoad = (): void => {
              if (options?.failToLoad) {
                reject(new Error("blocked"));
              } else {
                resolve(recorder);
              }
            };
          },
        );
      },
      now: (): number => {
        return clock.now;
      },
    });

  return {
    controller: controller,
    calls: calls,
    loads: (): number => {
      return loadCount;
    },
    arrive: async (): Promise<void> => {
      if (resolveLoad) {
        resolveLoad();
      }

      for (let i: number = 0; i < 5; i++) {
        await Promise.resolve();
      }
    },
    clock: clock,
  };
};

const at: (
  page: string,
  decision: DashboardRecordingDecision,
) => {
  decision: DashboardRecordingDecision;
  config: DashboardRecordingConfig;
  page: string;
} = (
  page: string,
  decision: DashboardRecordingDecision,
): {
  decision: DashboardRecordingDecision;
  config: DashboardRecordingConfig;
  page: string;
} => {
  return { decision: decision, config: CONFIG, page: page };
};

const commands: (calls: Array<Call>) => Array<string> = (
  calls: Array<Call>,
): Array<string> => {
  return calls.map((call: Call): string => {
    return String(call[0]);
  });
};

describe("loading", () => {
  test("loads nothing on a page that is not recorded, or with any gate closed", () => {
    const h: Harness = harness();

    for (const decision of [
      DashboardRecordingDecision.NotConfigured,
      DashboardRecordingDecision.NoConsent,
      DashboardRecordingDecision.PersonOff,
      DashboardRecordingDecision.ProjectOff,
      DashboardRecordingDecision.PageNotRecorded,
    ]) {
      h.controller.update(at(INCIDENT, decision));
    }

    expect(h.loads()).toBe(0);
    expect(h.controller.getStatus()).toBe(DashboardRecorderStatus.NotLoaded);
  });

  test("loads once, the first time a page may be recorded, and starts it", async () => {
    const h: Harness = harness();

    h.controller.update(at(HOME, DashboardRecordingDecision.Record));
    h.controller.update(at(CREATE, DashboardRecordingDecision.Record));

    expect(h.loads()).toBe(1);

    await h.arrive();

    expect(h.calls[0]).toEqual(["start", CONFIG.host, false]);
    expect(h.controller.getStatus()).toBe(DashboardRecorderStatus.Recording);
  });

  test("starts paused when the person moved on to a page that is not recorded while it loaded", async () => {
    const h: Harness = harness();

    h.controller.update(at(HOME, DashboardRecordingDecision.Record));
    h.controller.update(
      at(INCIDENT, DashboardRecordingDecision.PageNotRecorded),
    );
    await h.arrive();

    expect(h.calls).toEqual([["start", CONFIG.host, true]]);
    expect(h.controller.getStatus()).toBe(DashboardRecorderStatus.Paused);
  });

  test("never starts when consent or a switch went while it loaded", async () => {
    const h: Harness = harness();

    h.controller.update(at(HOME, DashboardRecordingDecision.Record));
    h.controller.update(at(HOME, DashboardRecordingDecision.PersonOff));
    await h.arrive();

    expect(h.calls).toEqual([]);
    expect(h.controller.getStatus()).toBe(DashboardRecorderStatus.Stopped);

    h.controller.update(at(HOME, DashboardRecordingDecision.Record));

    expect(h.loads()).toBe(1);
  });

  test("records nothing on this page load when the recorder cannot load", async () => {
    const h: Harness = harness({ failToLoad: true });

    h.controller.update(at(HOME, DashboardRecordingDecision.Record));
    await h.arrive();

    expect(h.controller.getStatus()).toBe(DashboardRecorderStatus.Stopped);

    h.controller.update(at(CREATE, DashboardRecordingDecision.Record));

    expect(h.loads()).toBe(1);
    expect(h.calls).toEqual([]);
  });
});

describe("moving between pages", () => {
  const recording: () => Promise<Harness> = async (): Promise<Harness> => {
    const h: Harness = harness();

    h.controller.update(at(HOME, DashboardRecordingDecision.Record));
    await h.arrive();
    h.calls.length = 0;

    return h;
  };

  test("pauses on a page that is not recorded, and resumes on the way back", async () => {
    const h: Harness = await recording();

    h.controller.update(
      at(INCIDENT, DashboardRecordingDecision.PageNotRecorded),
    );

    expect(commands(h.calls)).toEqual(["pause"]);
    expect(h.controller.getStatus()).toBe(DashboardRecorderStatus.Paused);

    h.calls.length = 0;
    h.controller.update(at(CREATE, DashboardRecordingDecision.Record));

    expect(commands(h.calls)).toEqual(["resume", "setTags"]);
    expect(h.controller.getStatus()).toBe(DashboardRecorderStatus.Recording);
  });

  test("pauses once, however many pages that are not recorded follow", async () => {
    const h: Harness = await recording();

    h.controller.update(
      at(INCIDENT, DashboardRecordingDecision.PageNotRecorded),
    );
    h.controller.update(
      at(
        "/dashboard/:projectId/logs",
        DashboardRecordingDecision.PageNotRecorded,
      ),
    );

    expect(commands(h.calls)).toEqual(["pause"]);
  });

  test("stops for good when the person or the project switches it off, or consent goes", async () => {
    for (const decision of [
      DashboardRecordingDecision.PersonOff,
      DashboardRecordingDecision.ProjectOff,
      DashboardRecordingDecision.NoConsent,
    ]) {
      const h: Harness = await recording();

      h.controller.update(at(HOME, decision));

      expect(commands(h.calls)).toEqual(["stop"]);

      h.controller.update(at(CREATE, DashboardRecordingDecision.Record));

      expect(commands(h.calls)).toEqual(["stop"]);
      expect(h.controller.getStatus()).toBe(DashboardRecorderStatus.Stopped);
    }
  });

  test("stops from a pause too", async () => {
    const h: Harness = await recording();

    h.controller.update(
      at(INCIDENT, DashboardRecordingDecision.PageNotRecorded),
    );
    h.controller.update(at(INCIDENT, DashboardRecordingDecision.ProjectOff));

    expect(commands(h.calls)).toEqual(["pause", "stop"]);
  });

  test("tags the recording with the page, and the guided setup's step", async () => {
    const h: Harness = await recording();

    h.controller.noteGuidedSetupPlace({
      setup: "website_down",
      step: "address",
    });
    h.controller.update(at(CREATE, DashboardRecordingDecision.Record));

    expect(h.calls).toContainEqual([
      "setTags",
      {
        page: CREATE,
        sample_project: "false",
        guided_setup: "website_down",
        guided_setup_step: "address",
      },
    ]);

    h.calls.length = 0;
    h.controller.noteGuidedSetupPlace(null);

    expect(h.calls).toEqual([
      ["setTags", { page: CREATE, sample_project: "false" }],
    ]);
  });

  test("does not tag while paused", async () => {
    const h: Harness = await recording();

    h.controller.update(
      at(INCIDENT, DashboardRecordingDecision.PageNotRecorded),
    );
    h.calls.length = 0;
    h.controller.noteGuidedSetupPlace({
      setup: "website_down",
      step: "address",
    });

    expect(h.calls).toEqual([]);
  });
});

describe("marking", () => {
  const recording: () => Promise<Harness> = async (): Promise<Harness> => {
    const h: Harness = harness();

    h.controller.update(at(HOME, DashboardRecordingDecision.Record));
    await h.arrive();
    h.calls.length = 0;

    return h;
  };

  test("marks a form refused again and again", async () => {
    const h: Harness = await recording();

    for (let i: number = 0; i < FORM_REFUSALS_FOR_SIGNAL; i++) {
      h.controller.noteFormRefusal();
    }

    expect(h.calls).toEqual([
      ["track", DashboardSignalName.FormRefusedRepeatedly],
    ]);
  });

  test("marks a quick exit before pausing for the page that is not recorded", async () => {
    const h: Harness = await recording();

    h.clock.now = 1000;
    h.controller.update(at(CREATE, DashboardRecordingDecision.Record));
    h.controller.noteInput();
    h.calls.length = 0;
    h.clock.now = 2000;
    h.controller.update(
      at(INCIDENT, DashboardRecordingDecision.PageNotRecorded),
    );

    expect(h.calls).toEqual([
      ["track", DashboardSignalName.PageLeftQuickly],
      ["pause"],
    ]);
  });

  test("marks nothing while paused", async () => {
    const h: Harness = await recording();

    h.controller.update(
      at(INCIDENT, DashboardRecordingDecision.PageNotRecorded),
    );
    h.calls.length = 0;

    for (let i: number = 0; i < FORM_REFUSALS_FOR_SIGNAL; i++) {
      h.controller.noteFormRefusal();
    }

    h.controller.noteProductEvent("guided_setup/started");

    expect(h.calls).toEqual([]);
  });

  test("marks the product's events (#6830) by their own names while it records", async () => {
    const h: Harness = await recording();

    h.controller.noteProductEvent("guided_setup/step_reached");

    expect(h.calls).toEqual([["track", "guided_setup/step_reached"]]);
  });

  test("marks nothing before it has loaded", () => {
    const h: Harness = harness();

    h.controller.noteProductEvent("guided_setup/started");

    for (let i: number = 0; i < FORM_REFUSALS_FOR_SIGNAL; i++) {
      h.controller.noteFormRefusal();
    }

    expect(h.calls).toEqual([]);
  });
});

describe("a sample project (#6808)", () => {
  test("is tagged, so exploring the sample is told apart from setting up for real", async () => {
    const h: Harness = harness();

    h.controller.update({
      ...at(HOME, DashboardRecordingDecision.Record),
      isSampleProject: true,
    });
    await h.arrive();

    expect(h.calls).toContainEqual([
      "setTags",
      { page: HOME, sample_project: "true" },
    ]);

    h.calls.length = 0;
    h.controller.update({
      ...at(CREATE, DashboardRecordingDecision.Record),
      isSampleProject: false,
    });

    expect(h.calls).toContainEqual([
      "setTags",
      { page: CREATE, sample_project: "false" },
    ]);
  });
});

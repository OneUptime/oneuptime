import EnterpriseServerModule, {
  ENTERPRISE_SERVER_MODULE_NAME,
} from "Common/Server/Enterprise/EnterpriseServerModule";
import {
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseSnapshotUtil,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import JobDictionary from "../../../FeatureSet/Workers/Utils/JobDictionary";

/*
 * Builds the enterprise modules the loader tests require() from disk. Each
 * fixture directory under here has a Server/Index.ts (or .js) that calls this
 * factory with the behaviour it models, so the loader sees a real ee/-shaped
 * directory while the behaviour stays in one place.
 *
 * Calls are recorded on globalThis rather than in a module variable, so the
 * test can read them even though the loader require()s the fixture through
 * its own module registry.
 */

export type FixtureStepBehaviour = "ok" | "throw" | "hang";

export interface FixtureModuleBehaviour {
  init?: FixtureStepBehaviour | undefined;
  licenseLoad?: FixtureStepBehaviour | undefined;
  registerWorkerJobs?: "ok" | "throw" | undefined;
  // Job names registerWorkerJobs puts into JobDictionary.
  jobNames?: Array<string> | undefined;
}

export const FIXTURE_CALLS_KEY: string = "__oneUptimeEnterpriseFixtureCalls";

type GlobalRecord = Record<string, unknown>;

export const getFixtureCalls: () => Array<string> = (): Array<string> => {
  const calls: unknown = (globalThis as unknown as GlobalRecord)[
    FIXTURE_CALLS_KEY
  ];

  return Array.isArray(calls) ? (calls as Array<string>) : [];
};

export const resetFixtureCalls: () => void = (): void => {
  (globalThis as unknown as GlobalRecord)[FIXTURE_CALLS_KEY] = [];
};

const record: (call: string) => void = (call: string): void => {
  const calls: Array<string> = getFixtureCalls();
  calls.push(call);
  (globalThis as unknown as GlobalRecord)[FIXTURE_CALLS_KEY] = calls;
};

const neverSettles: <T>() => Promise<T> = <T>(): Promise<T> => {
  return new Promise<T>((): void => {
    // Deliberately never resolves nor rejects: models a hung dependency.
  });
};

export const createFixtureModule: (
  fixtureName: string,
  behaviour?: FixtureModuleBehaviour,
) => EnterpriseServerModule = (
  fixtureName: string,
  behaviour: FixtureModuleBehaviour = {},
): EnterpriseServerModule => {
  record(`${fixtureName}:required`);

  const snapshot: EnterpriseLicenseSnapshot =
    EnterpriseLicenseSnapshotUtil.createMissing(`${fixtureName} fixture`);

  return {
    name: ENTERPRISE_SERVER_MODULE_NAME,
    version: `0.0.0-${fixtureName}`,
    init: async (): Promise<void> => {
      record(`${fixtureName}:init`);

      if (behaviour.init === "throw") {
        throw new Error(`${fixtureName}: init failed (database unreachable)`);
      }

      if (behaviour.init === "hang") {
        await neverSettles<void>();
      }
    },
    licensing: {
      getSnapshot: async (): Promise<EnterpriseLicenseSnapshot> => {
        record(`${fixtureName}:getSnapshot`);

        if (behaviour.licenseLoad === "throw") {
          throw new Error(`${fixtureName}: license load failed`);
        }

        if (behaviour.licenseLoad === "hang") {
          return await neverSettles<EnterpriseLicenseSnapshot>();
        }

        return snapshot;
      },
      getCachedSnapshot: (): EnterpriseLicenseSnapshot | null => {
        return snapshot;
      },
      refresh: async (): Promise<void> => {
        record(`${fixtureName}:refresh`);
      },
      invalidate: (): void => {
        record(`${fixtureName}:invalidate`);
      },
      getSeatUsage: async (): Promise<null> => {
        return null;
      },
      assertSeatAvailableForNewUser: async (): Promise<void> => {
        return undefined;
      },
    },
    getIdentityRouters: (): [] => {
      return [];
    },
    getApiRouters: (): [] => {
      return [];
    },
    getAdminHealthRouter: (): null => {
      return null;
    },
    registerWorkerJobs: async (): Promise<void> => {
      record(`${fixtureName}:registerWorkerJobs`);

      if (behaviour.registerWorkerJobs === "throw") {
        throw new Error(`${fixtureName}: a cron module failed to import`);
      }

      for (const jobName of behaviour.jobNames || []) {
        JobDictionary.setJobFunction(jobName, async (): Promise<void> => {
          record(`${fixtureName}:ran:${jobName}`);
        });
      }
    },
    getAuditLogRecorder: (): null => {
      return null;
    },
  };
};

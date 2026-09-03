/*
 * Regression tests for the 24-hour throttle on
 * POST /probe/status-report/offline.
 *
 * Probe/Services/Register.ts calls reportIfOffline() once at EVERY probe
 * process start on any host where ICMP is blocked - which is most cloud VMs -
 * and this handler then mails EVERY project owner, or the instance-wide
 * adminNotificationEmail for a global probe, with no dedupe of any kind. The
 * send sits inside `if (!IsBillingEnabled)`, so the leak is invisible on cloud
 * and lands entirely on self-hosted installs: before the throttle, a
 * self-hoster running a handful of probe replicas received one "ACTION
 * REQUIRED: Probe Offline Notification" email per owner per probe on every
 * deploy, every restart and every scale-up.
 *
 * What must not regress, and what these tests pin:
 *   - the second report inside the window mails nobody, so a restart loop is
 *     one email a day rather than one email a restart;
 *   - the window is per probe, so a noisy probe cannot silence a different
 *     probe's first notice;
 *   - a global probe shares the single "global" window, because every global
 *     probe notifies the same one admin address;
 *   - the claim FAILS OPEN. When Redis is unreachable the mail still goes out.
 *     A throttle that failed closed would silently swallow the only warning an
 *     operator ever gets that their monitoring has gone blind, for as long as
 *     the cache is down;
 *   - the throttle is a filter on the SEND only. The billing gate, the
 *     BadDataException paths, the response bodies and the emailReason strings
 *     are untouched.
 */

import { mockRouter } from "Common/Tests/Server/API/Helpers";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import MailService from "Common/Server/Services/MailService";
import ProbeService from "Common/Server/Services/ProbeService";
import ProjectService from "Common/Server/Services/ProjectService";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import BadDataException from "Common/Types/Exception/BadDataException";
import DatabaseNotConnectedException from "Common/Types/Exception/DatabaseNotConnectedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import Probe from "Common/Models/DatabaseModels/Probe";
import User from "Common/Models/DatabaseModels/User";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose require graph reaches it (DatabaseService, the base class of every
 * concrete service, imports it). Nothing password-related is under test here,
 * so the module is replaced WITH A FACTORY - an automock would still require
 * the real file.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

/*
 * IsBillingEnabled is a module-level constant read from process.env at import
 * time, and the test runner exports BILLING_ENABLED=true. Both deployment
 * shapes have to be reachable from one file, so it is served through a getter.
 *
 * The flag lives on globalThis rather than in a module-scope `let`: this
 * factory runs the first time anything in the require graph touches
 * EnvironmentConfig, which can happen while this file's own top-level bindings
 * are still in their temporal dead zone.
 *
 * defineProperty rather than `{ ...actual, get IsBillingEnabled() {} }`: at
 * target ES2017 the object spread downlevels to Object.assign, which would
 * evaluate the getter once and copy the resulting value as a plain property.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual, __esModule: true };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return (
        (globalThis as Record<string, unknown>)[
          "__oneUptimeProbeOfflineBillingEnabled"
        ] === true
      );
    },
  });

  return mocked;
});

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    // The route module imports this named export for log attribution.
    getLogAttributesFromRequest: jest.fn(() => {
      return {};
    }),
  };
});

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      setStringIfNotExists: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProbeService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      updateLastAlive: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getOwners: jest.fn(),
      getActiveProjectStatusQuery: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Services/MonitorProbeService", () => {
  return {
    __esModule: true,
    default: {
      countBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      getEnabledMonitorQuery: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("../../FeatureSet/Telemetry/Middleware/ProbeAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

/*
 * The queue module pulls in BullMQ at import time. App's jest config has no
 * bullmq stub, and the offline handler must never reach the queue anyway.
 */
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addProbeIngestJob: jest.fn(),
        addSnmpTrapIngestJob: jest.fn(),
        getQueueStats: jest.fn(),
        getQueueSize: jest.fn(),
        getFailedJobs: jest.fn(),
      },
    };
  },
);

jest.mock("Common/Server/Middleware/ClusterKeyAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

/*
 * Importing the router module registers its routes on the mocked router so the
 * handler can be invoked directly. Kept last so the `mockRouter` binding the
 * Express factory closes over is initialised before getRouter() is called.
 */
import "../../FeatureSet/Telemetry/API/ProbeIngest/Probe";
import ProbeAuthorization from "../../FeatureSet/Telemetry/Middleware/ProbeAuthorization";

/*
 * The namespace is written out rather than imported because it is not
 * exported, and because it is persisted state: it is half of a live Redis key
 * that survives deploys. Renaming it silently re-arms every throttled
 * notification on the next rollout, so the literal belongs in a test.
 */
const THROTTLE_NAMESPACE: string = "probe-offline-notification";

const SECONDS_IN_ONE_DAY: number = 24 * 60 * 60;

const PROJECT_EMAIL_REASON: string =
  "This email is sent to you because you are listed as an owner of the project that this probe is associated with. To change this email, please visit the Project Dashboard > Settings > Teams and Members > Owners.";

const ADMIN_EMAIL_REASON: string =
  "This email is sent to you becuse you have listed this email as a notification email in the Admin Dashobard. To change this email, please visit the Admin Dashboard > Settings > Email.";

const globalCache: {
  setStringIfNotExists: jest.Mock;
} = GlobalCache as unknown as { setStringIfNotExists: jest.Mock };

const probeService: {
  findOneBy: jest.Mock;
} = ProbeService as unknown as { findOneBy: jest.Mock };

const projectService: {
  getOwners: jest.Mock;
} = ProjectService as unknown as { getOwners: jest.Mock };

const globalConfigService: {
  findOneBy: jest.Mock;
} = GlobalConfigService as unknown as { findOneBy: jest.Mock };

const mailService: {
  sendMail: jest.Mock;
} = MailService as unknown as { sendMail: jest.Mock };

const responseUtil: {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
} = Response as unknown as {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
};

const loggerUtil: {
  debug: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
} = logger as unknown as {
  debug: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

const mockResponse: ExpressResponse = {} as ExpressResponse;

/*
 * A real SET NX, in memory. The whole point of the change is that the SECOND
 * caller loses, so a stub that always returned true would let the regression
 * this suite guards against pass unnoticed.
 */
const cacheStore: Map<string, string> = new Map<string, string>();
let cacheIsDown: boolean = false;

const probeRegistry: Map<string, Probe> = new Map<string, Probe>();

type SetBillingEnabledFunction = (enabled: boolean) => void;

const setBillingEnabled: SetBillingEnabledFunction = (
  enabled: boolean,
): void => {
  (globalThis as Record<string, unknown>)[
    "__oneUptimeProbeOfflineBillingEnabled"
  ] = enabled;
};

type ClaimCall = {
  namespace: string;
  key: string;
  value: string;
  options: { expiresInSeconds: number } | undefined;
};

type GetClaimCallsFunction = () => Array<ClaimCall>;

const getClaimCalls: GetClaimCallsFunction = (): Array<ClaimCall> => {
  return globalCache.setStringIfNotExists.mock.calls.map(
    (call: Array<unknown>): ClaimCall => {
      return {
        namespace: call[0] as string,
        key: call[1] as string,
        value: call[2] as string,
        options: call[3] as { expiresInSeconds: number } | undefined,
      };
    },
  );
};

type GetClaimKeysFunction = () => Array<string>;

const getClaimKeys: GetClaimKeysFunction = (): Array<string> => {
  return getClaimCalls().map((claim: ClaimCall): string => {
    return claim.key;
  });
};

type GetMailedAddressesFunction = () => Array<string>;

const getMailedAddresses: GetMailedAddressesFunction = (): Array<string> => {
  return mailService.sendMail.mock.calls.map((call: Array<unknown>): string => {
    return ((call[0] as JSONObject)["toEmail"] as Email).toString();
  });
};

type GetEnvelopeFunction = (index: number) => JSONObject;

const getEnvelope: GetEnvelopeFunction = (index: number): JSONObject => {
  return (
    mailService.sendMail.mock.calls[index] as Array<unknown>
  )[0] as JSONObject;
};

type GetErrorResponseFunction = (index: number) => BadDataException;

const getErrorResponse: GetErrorResponseFunction = (
  index: number,
): BadDataException => {
  return (
    responseUtil.sendErrorResponse.mock.calls[index] as Array<unknown>
  )[2] as BadDataException;
};

type MakeProbeOptions = {
  id: ObjectID;
  projectId: ObjectID | null;
  name: string;
};

type MakeProbeFunction = (options: MakeProbeOptions) => Probe;

const makeProbe: MakeProbeFunction = (options: MakeProbeOptions): Probe => {
  const probe: Probe = new Probe(options.id);

  if (options.projectId) {
    probe.projectId = options.projectId;
  }

  probe.name = options.name;
  probe.description = "probe under test";

  return probe;
};

type MakeOwnerFunction = (email: string) => User;

const makeOwner: MakeOwnerFunction = (email: string): User => {
  const user: User = new User(ObjectID.generate());
  user.email = new Email(email);
  return user;
};

type MakeRequestOptions = {
  probeId: ObjectID;
  statusReport?: JSONObject | undefined;
};

type MakeRequestFunction = (options: MakeRequestOptions) => ExpressRequest;

const makeRequest: MakeRequestFunction = (
  options: MakeRequestOptions,
): ExpressRequest => {
  const statusReport: JSONObject = options.statusReport || {
    isPingCheckOffline: true,
    isWebsiteCheckOffline: false,
    isPortCheckOffline: false,
    hostname: "probe-host-1",
  };

  return {
    body: {
      probeId: options.probeId.toString(),
      probeKey: "test-probe-key",
      statusReport: statusReport,
    },
  } as unknown as ExpressRequest;
};

type CallOfflineEndpointFunction = (
  req: ExpressRequest,
) => Promise<{ next: NextFunction }>;

const callOfflineEndpoint: CallOfflineEndpointFunction = async (
  req: ExpressRequest,
): Promise<{ next: NextFunction }> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter
    .match("post", "/probe/status-report/offline")
    .handlerFunction(req, mockResponse, next);

  return { next };
};

describe("POST /probe/status-report/offline - 24h owner notification throttle", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    cacheStore.clear();
    cacheIsDown = false;
    probeRegistry.clear();

    // Self-hosted is the only deployment on which the notification is sent.
    setBillingEnabled(false);

    globalCache.setStringIfNotExists.mockImplementation(
      (namespace: string, key: string, value: string): Promise<boolean> => {
        if (cacheIsDown) {
          return Promise.reject(
            new DatabaseNotConnectedException("Cache is not connected"),
          );
        }

        const cacheKey: string = `${namespace}-${key}`;

        if (cacheStore.has(cacheKey)) {
          return Promise.resolve(false);
        }

        cacheStore.set(cacheKey, value);

        return Promise.resolve(true);
      },
    );

    probeService.findOneBy.mockImplementation(
      (args: { query: { _id: string } }): Promise<Probe | null> => {
        return Promise.resolve(probeRegistry.get(args.query._id) || null);
      },
    );

    mailService.sendMail.mockImplementation((): Promise<void> => {
      return Promise.resolve();
    });

    projectService.getOwners.mockImplementation((): Promise<Array<User>> => {
      return Promise.resolve([]);
    });

    globalConfigService.findOneBy.mockImplementation(
      (): Promise<GlobalConfig | null> => {
        return Promise.resolve(null);
      },
    );
  });

  describe("project probe", () => {
    const projectId: ObjectID = ObjectID.generate();
    const probeId: ObjectID = ObjectID.generate();

    type ArrangeFunction = () => void;

    const arrangeProjectProbe: ArrangeFunction = (): void => {
      probeRegistry.set(
        probeId.toString(),
        makeProbe({ id: probeId, projectId: projectId, name: "eu-probe-1" }),
      );

      projectService.getOwners.mockImplementation((): Promise<Array<User>> => {
        return Promise.resolve([
          makeOwner("owner-one@example.com"),
          makeOwner("owner-two@example.com"),
          makeOwner("owner-three@example.com"),
        ]);
      });
    };

    /*
     * The first report is the one that carries information, so it has to behave
     * exactly as it did before the throttle existed: every owner is mailed.
     */
    test("first offline report mails every project owner and claims the window", async () => {
      arrangeProjectProbe();

      await callOfflineEndpoint(makeRequest({ probeId: probeId }));

      expect(getMailedAddresses()).toEqual([
        "owner-one@example.com",
        "owner-two@example.com",
        "owner-three@example.com",
      ]);

      const claims: Array<ClaimCall> = getClaimCalls();

      expect(claims).toHaveLength(1);
      expect(claims[0]!.namespace).toBe(THROTTLE_NAMESPACE);
      expect(claims[0]!.key).toBe(probeId.toString());
      expect(claims[0]!.options).toEqual({
        expiresInSeconds: SECONDS_IN_ONE_DAY,
      });

      /*
       * A 24h window, expressed through the repo's own date helper rather than
       * a hand-rolled 86400, so the two cannot drift apart.
       */
      expect(claims[0]!.options!.expiresInSeconds).toBe(
        OneUptimeDate.getSecondsInDays(1),
      );

      // The claim token is a fresh value, never a constant sentinel.
      expect(typeof claims[0]!.value).toBe("string");
      expect(claims[0]!.value.length).toBeGreaterThan(0);
    });

    /*
     * THE regression pin. Register.reportIfOffline() runs at every probe
     * process start, so this second call is what a redeploy or a restart looks
     * like from the server's side.
     */
    test("second offline report inside the window mails nobody", async () => {
      arrangeProjectProbe();

      await callOfflineEndpoint(makeRequest({ probeId: probeId }));

      expect(mailService.sendMail).toHaveBeenCalledTimes(3);

      mailService.sendMail.mockClear();

      await callOfflineEndpoint(makeRequest({ probeId: probeId }));

      expect(mailService.sendMail).not.toHaveBeenCalled();
    });

    /*
     * Twenty restarts is twenty attempts at the window and still one round of
     * mail: the throttle is a shared claim, not a per-process memo.
     */
    test("repeated reports inside the window mail exactly one round", async () => {
      arrangeProjectProbe();

      for (let attempt: number = 0; attempt < 20; attempt++) {
        await callOfflineEndpoint(makeRequest({ probeId: probeId }));
      }

      expect(mailService.sendMail).toHaveBeenCalledTimes(3);
      expect(getClaimCalls()).toHaveLength(20);
    });

    // The throttle filters the send; it must not change what a probe is told.
    test("the response body is unchanged whether or not the mail is sent", async () => {
      arrangeProjectProbe();

      await callOfflineEndpoint(makeRequest({ probeId: probeId }));
      await callOfflineEndpoint(makeRequest({ probeId: probeId }));

      expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(2);
      expect(responseUtil.sendJsonObjectResponse).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        mockResponse,
        { message: "Status Report received" },
      );
      expect(responseUtil.sendJsonObjectResponse).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        mockResponse,
        { message: "Status Report received" },
      );
      expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
    });

    // The envelope the owner receives is what it was before the change.
    test("the mail envelope and its emailReason are unchanged", async () => {
      arrangeProjectProbe();

      await callOfflineEndpoint(makeRequest({ probeId: probeId }));

      const envelope: JSONObject = getEnvelope(0);

      expect(envelope["templateType"]).toBe(EmailTemplateType.ProbeOffline);
      expect(envelope["subject"]).toBe(
        "ACTION REQUIRED: Probe Offline Notification",
      );

      const vars: JSONObject = envelope["vars"] as JSONObject;

      expect(vars["probeName"]).toBe("eu-probe-1");
      expect(vars["probeId"]).toBe(probeId.toString());
      expect(vars["projectId"]).toBe(projectId.toString());
      expect(vars["hostname"]).toBe("probe-host-1");
      expect(vars["emailReason"]).toBe(PROJECT_EMAIL_REASON);
      expect(vars["issue"]).toContain(
        "This probe cannot reach out to ping other servers",
      );
    });
  });

  /*
   * Without a per-probe key one restart-looping probe would swallow the first
   * ever notice for every other probe in the install for a whole day.
   */
  test("two different probes each get their own independent claim", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const firstProbeId: ObjectID = ObjectID.generate();
    const secondProbeId: ObjectID = ObjectID.generate();

    probeRegistry.set(
      firstProbeId.toString(),
      makeProbe({ id: firstProbeId, projectId: projectId, name: "probe-a" }),
    );
    probeRegistry.set(
      secondProbeId.toString(),
      makeProbe({ id: secondProbeId, projectId: projectId, name: "probe-b" }),
    );

    projectService.getOwners.mockImplementation((): Promise<Array<User>> => {
      return Promise.resolve([makeOwner("owner@example.com")]);
    });

    await callOfflineEndpoint(makeRequest({ probeId: firstProbeId }));
    await callOfflineEndpoint(makeRequest({ probeId: secondProbeId }));

    // Both probes mailed: the second is not collateral damage of the first.
    expect(mailService.sendMail).toHaveBeenCalledTimes(2);
    expect(getClaimKeys()).toEqual([
      firstProbeId.toString(),
      secondProbeId.toString(),
    ]);

    // ...and each window is then independently exhausted.
    mailService.sendMail.mockClear();

    await callOfflineEndpoint(makeRequest({ probeId: firstProbeId }));
    await callOfflineEndpoint(makeRequest({ probeId: secondProbeId }));

    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  describe("global probe", () => {
    const globalProbeId: ObjectID = ObjectID.generate();
    const otherGlobalProbeId: ObjectID = ObjectID.generate();

    type ArrangeFunction = () => void;

    const arrangeGlobalProbes: ArrangeFunction = (): void => {
      probeRegistry.set(
        globalProbeId.toString(),
        makeProbe({ id: globalProbeId, projectId: null, name: "global-1" }),
      );
      probeRegistry.set(
        otherGlobalProbeId.toString(),
        makeProbe({
          id: otherGlobalProbeId,
          projectId: null,
          name: "global-2",
        }),
      );

      globalConfigService.findOneBy.mockImplementation(
        (): Promise<GlobalConfig | null> => {
          const globalConfig: GlobalConfig = new GlobalConfig();
          globalConfig.adminNotificationEmail = new Email("admin@example.com");
          return Promise.resolve(globalConfig);
        },
      );
    };

    /*
     * A global probe has no projectId, so its notice goes to the one
     * instance-wide admin address. Per-probe windows there would still put one
     * mail per replica into one inbox on every restart, which is the whole
     * complaint - so every global probe shares the literal "global" window.
     */
    test('claims under the "global" key and mails adminNotificationEmail', async () => {
      arrangeGlobalProbes();

      await callOfflineEndpoint(makeRequest({ probeId: globalProbeId }));

      expect(getMailedAddresses()).toEqual(["admin@example.com"]);

      const claims: Array<ClaimCall> = getClaimCalls();

      expect(claims).toHaveLength(1);
      expect(claims[0]!.namespace).toBe(THROTTLE_NAMESPACE);
      expect(claims[0]!.key).toBe("global");

      const vars: JSONObject = getEnvelope(0)["vars"] as JSONObject;

      expect(vars["emailReason"]).toBe(ADMIN_EMAIL_REASON);
      // A global probe has no project, and the var stays the empty string.
      expect(vars["projectId"]).toBe("");
    });

    test("a second global probe inside the window mails nobody", async () => {
      arrangeGlobalProbes();

      await callOfflineEndpoint(makeRequest({ probeId: globalProbeId }));

      expect(mailService.sendMail).toHaveBeenCalledTimes(1);

      mailService.sendMail.mockClear();

      await callOfflineEndpoint(makeRequest({ probeId: otherGlobalProbeId }));

      expect(mailService.sendMail).not.toHaveBeenCalled();
      expect(getClaimKeys()).toEqual(["global", "global"]);
    });

    /*
     * Unchanged: a missing GlobalConfig is still a BadDataException, and it
     * short-circuits before the claim so a misconfigured instance does not burn
     * a 24h window it never used.
     */
    test("a missing global config still short-circuits before any claim", async () => {
      probeRegistry.set(
        globalProbeId.toString(),
        makeProbe({ id: globalProbeId, projectId: null, name: "global-1" }),
      );

      await callOfflineEndpoint(makeRequest({ probeId: globalProbeId }));

      expect(responseUtil.sendErrorResponse).toHaveBeenCalledTimes(1);
      expect(getErrorResponse(0)).toBeInstanceOf(BadDataException);
      expect(getErrorResponse(0).message).toBe("Global config not found");

      expect(globalCache.setStringIfNotExists).not.toHaveBeenCalled();
      expect(mailService.sendMail).not.toHaveBeenCalled();
    });
  });

  describe("Redis unavailable", () => {
    const projectId: ObjectID = ObjectID.generate();
    const probeId: ObjectID = ObjectID.generate();

    type ArrangeFunction = () => void;

    const arrangeWithCacheDown: ArrangeFunction = (): void => {
      probeRegistry.set(
        probeId.toString(),
        makeProbe({ id: probeId, projectId: projectId, name: "eu-probe-1" }),
      );

      projectService.getOwners.mockImplementation((): Promise<Array<User>> => {
        return Promise.resolve([
          makeOwner("owner-one@example.com"),
          makeOwner("owner-two@example.com"),
        ]);
      });

      cacheIsDown = true;
    };

    /*
     * FAIL OPEN. setStringIfNotExists throws DatabaseNotConnectedException when
     * Redis is unreachable. Suppressing the mail in that case would silently
     * swallow the only warning an operator gets that their monitoring has gone
     * blind, for as long as the cache is down; sending it degrades the feature
     * to exactly the behaviour that shipped before the throttle, which is the
     * correct direction to be wrong in.
     */
    test("a throwing claim still mails every owner", async () => {
      arrangeWithCacheDown();

      await callOfflineEndpoint(makeRequest({ probeId: probeId }));

      expect(getMailedAddresses()).toEqual([
        "owner-one@example.com",
        "owner-two@example.com",
      ]);
    });

    test("a throwing claim logs a warning rather than an unhandled error", async () => {
      arrangeWithCacheDown();

      const { next } = await callOfflineEndpoint(
        makeRequest({ probeId: probeId }),
      );

      expect(loggerUtil.warn).toHaveBeenCalled();

      const warnedWithException: boolean = loggerUtil.warn.mock.calls.some(
        (call: Array<unknown>): boolean => {
          return call[0] instanceof DatabaseNotConnectedException;
        },
      );

      expect(warnedWithException).toBe(true);

      /*
       * The throw is swallowed inside the handler, so the request still
       * succeeds - it never reaches the express error handler.
       */
      expect(next).not.toHaveBeenCalled();
      expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
        expect.anything(),
        mockResponse,
        { message: "Status Report received" },
      );
    });

    // Failing open means failing open every time, not once.
    test("every report mails while the cache stays down", async () => {
      arrangeWithCacheDown();

      await callOfflineEndpoint(makeRequest({ probeId: probeId }));
      await callOfflineEndpoint(makeRequest({ probeId: probeId }));
      await callOfflineEndpoint(makeRequest({ probeId: probeId }));

      expect(mailService.sendMail).toHaveBeenCalledTimes(6);
    });
  });

  describe("gates that must not move", () => {
    const projectId: ObjectID = ObjectID.generate();
    const probeId: ObjectID = ObjectID.generate();

    beforeEach(() => {
      probeRegistry.set(
        probeId.toString(),
        makeProbe({ id: probeId, projectId: projectId, name: "eu-probe-1" }),
      );

      projectService.getOwners.mockImplementation((): Promise<Array<User>> => {
        return Promise.resolve([makeOwner("owner@example.com")]);
      });
    });

    /*
     * The whole block is still inside `if (!IsBillingEnabled)`. On cloud there
     * is no mail and there must also be no Redis round trip - the throttle sits
     * inside the gate, it does not replace it.
     */
    test("billing enabled still sends nothing and claims nothing", async () => {
      setBillingEnabled(true);

      await callOfflineEndpoint(makeRequest({ probeId: probeId }));

      expect(mailService.sendMail).not.toHaveBeenCalled();
      expect(globalCache.setStringIfNotExists).not.toHaveBeenCalled();
      expect(loggerUtil.debug).toHaveBeenCalledWith(
        "Billing is enabled, skipping probe offline email notification",
        expect.anything(),
      );
      expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
        expect.anything(),
        mockResponse,
        { message: "Status Report received" },
      );
    });

    /*
     * A body with no statusReport claims nothing and mails nobody.
     *
     * It does NOT hit the BadDataException("StatusReport not found") guard:
     * JSONFunctions.deserialize returns {} for a missing key, which is truthy,
     * so that guard has always been unreachable from this route. That is
     * pre-existing and deliberately left alone - the throttle is not allowed to
     * change any response on this endpoint. What matters here is that the
     * fall-through still reaches neither Redis nor the mailer.
     */
    test("a body with no status report claims nothing and mails nobody", async () => {
      const req: ExpressRequest = {
        body: { probeId: probeId.toString() },
      } as unknown as ExpressRequest;

      await callOfflineEndpoint(req);

      expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
      expect(globalCache.setStringIfNotExists).not.toHaveBeenCalled();
      expect(mailService.sendMail).not.toHaveBeenCalled();
      expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
        expect.anything(),
        mockResponse,
        { message: "Status Report received" },
      );
    });

    test("an unknown probe is still a BadDataException and claims nothing", async () => {
      probeRegistry.clear();

      await callOfflineEndpoint(makeRequest({ probeId: probeId }));

      expect(responseUtil.sendErrorResponse).toHaveBeenCalledTimes(1);
      expect(getErrorResponse(0).message).toBe("Invalid Probe ID or Probe Key");
      expect(globalCache.setStringIfNotExists).not.toHaveBeenCalled();
    });

    /*
     * A report that says everything is reachable never entered the notify
     * branch before the change, and must not start burning a 24h window now -
     * that would suppress the first genuine outage notice.
     */
    test("an all-clear report claims nothing", async () => {
      await callOfflineEndpoint(
        makeRequest({
          probeId: probeId,
          statusReport: {
            isPingCheckOffline: false,
            isWebsiteCheckOffline: false,
            isPortCheckOffline: false,
            hostname: "probe-host-1",
          },
        }),
      );

      expect(globalCache.setStringIfNotExists).not.toHaveBeenCalled();
      expect(mailService.sendMail).not.toHaveBeenCalled();
      expect(probeService.findOneBy).not.toHaveBeenCalled();
      expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
        expect.anything(),
        mockResponse,
        { message: "Status Report received" },
      );
    });

    // The route still authenticates the probe before any of this runs.
    test("is registered with the probe-auth middleware", () => {
      expect(
        mockRouter.match("post", "/probe/status-report/offline").middleware,
      ).toBe(ProbeAuthorization.isAuthorizedServiceMiddleware);
    });
  });
});

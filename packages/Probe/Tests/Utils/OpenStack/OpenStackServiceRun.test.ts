import { describe, expect, test } from "@jest/globals";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackApiError,
  OpenStackApiErrorKind,
  OpenStackBudgetExceededError,
} from "../../../Utils/OpenStack/OpenStackCollectionErrors";
import { OpenStackRequestTimeoutError } from "../../../Utils/OpenStack/OpenStackHttp";
import {
  OpenStackKeystoneSession,
  OpenStackToken,
  parseKeystoneToken,
} from "../../../Utils/OpenStack/OpenStackKeystone";
import OpenStackServiceClient from "../../../Utils/OpenStack/OpenStackServiceClient";
import OpenStackServiceRun from "../../../Utils/OpenStack/OpenStackServiceRun";
import { createFakeClock } from "./Helpers/CollectorHarness";

/*
 * One service's reads, each on its own: what a failure costs, when the rest of them wait,
 * and what the service's `_up` and `up` then say. `_up` reading 1 is what lets the
 * stale-row rule delete a row it has not seen lately, so this is where a failing read is
 * kept from costing someone their inventory.
 */

function run(): OpenStackServiceRun {
  return new OpenStackServiceRun({
    service: OpenStackServiceType.Network,
    regionName: "RegionOne",
    client: new OpenStackServiceClient({
      service: OpenStackServiceType.Network,
      regionName: "RegionOne",
      baseUrl: "https://neutron.example.com:9696/v2.0",
      transport: async () => {
        throw new Error("The reads here are scripted.");
      },
      clock: createFakeClock(),
      deadlineAt: Number.MAX_SAFE_INTEGER,
      session: new OpenStackKeystoneSession({
        token: parseKeystoneToken({ tokenId: "t", body: { token: {} } }),
        isFresh: true,
        login: async (): Promise<OpenStackToken> => {
          throw new Error("No login here.");
        },
      }),
      userAgent: "test",
    }),
  });
}

function apiError(
  kind: OpenStackApiErrorKind,
  status: number,
): OpenStackApiError {
  return new OpenStackApiError({
    kind: kind,
    status: status,
    url: "https://neutron.example.com:9696/v2.0/networks",
    message: `It said ${status}.`,
  });
}

function ok(
  service: OpenStackServiceRun,
  name: string = "networks",
): Promise<unknown> {
  return service.read({
    name: name,
    isInventory: true,
    run: async () => {
      return "read";
    },
  });
}

function failing(
  service: OpenStackServiceRun,
  error: unknown,
  name: string = "networks",
  isInventory: boolean = true,
): Promise<unknown> {
  return service.read({
    name: name,
    isInventory: isInventory,
    run: async () => {
      throw error;
    },
  });
}

describe("a read", () => {
  test("that works gives back what it read", async () => {
    const service: OpenStackServiceRun = run();

    await expect(ok(service)).resolves.toBe("read");
    expect(service.reads).toEqual([
      expect.objectContaining({
        name: "networks",
        isInventory: true,
        state: "ok",
      }),
    ]);
    expect(service.gotAnAnswer).toBe(true);
  });

  test("that fails gives back nothing, and goes no further", async () => {
    const service: OpenStackServiceRun = run();

    await expect(failing(service, new Error("boom"))).resolves.toBeUndefined();
    expect(service.reads[0]?.state).toBe("failing");
  });

  test("refused is written down as refused, and warns, and is no failure", async () => {
    const service: OpenStackServiceRun = run();

    await failing(service, apiError("refused", 403));

    expect(service.reads[0]).toMatchObject({ state: "refused", status: 403 });
    expect(service.warnings).toEqual(["It said 403."]);
    expect(service.firstFailure).toBeNull();
    expect(service.gotAnAnswer).toBe(true);
  });

  test("refused where that is what should happen is written down, and warns nobody", async () => {
    const service: OpenStackServiceRun = run();

    await service.read({
      name: "users",
      isInventory: false,
      isQuietWhenRefused: true,
      run: async () => {
        throw apiError("refused", 401);
      },
    });

    expect(service.reads[0]?.state).toBe("refused");
    expect(service.warnings).toEqual([]);
  });

  test("absent is a route this cloud does not have, and is nobody's failure", async () => {
    const service: OpenStackServiceRun = run();

    await failing(service, apiError("absent", 404), "extensions", false);

    expect(service.reads[0]?.state).toBe("absent");
    expect(service.firstFailure).toBeNull();
  });

  test("the first failure is kept in words for the report", async () => {
    const service: OpenStackServiceRun = run();

    await failing(service, apiError("failing", 500), "networks");
    await failing(service, apiError("failing", 500), "subnets");

    expect(service.firstFailure).toEqual({
      code: OpenStackCollectionErrorCode.ApiError,
      message: "It said 500.",
    });
  });
});

describe("when the rest of the reads wait for the next collection", () => {
  test.each([
    ["429", apiError("overloaded", 429)],
    ["503", apiError("overloaded", 503)],
  ])(
    "%s says to stop asking, and it stops at once",
    async (_name: string, error: OpenStackApiError) => {
      const service: OpenStackServiceRun = run();
      let wasAsked: boolean = false;

      await failing(service, error);
      await service.read({
        name: "subnets",
        isInventory: true,
        run: async () => {
          wasAsked = true;
        },
      });

      expect(wasAsked).toBe(false);
      expect(service.isOverloaded).toBe(true);
      expect(service.reads[1]).toMatchObject({
        name: "subnets",
        state: "skipped",
      });
    },
  );

  test("one 500 costs that read, and the next is asked: it may be that route's bug", async () => {
    const service: OpenStackServiceRun = run();

    await failing(service, apiError("failing", 500));

    expect(service.isStopped()).toBe(false);
    await expect(ok(service, "subnets")).resolves.toBe("read");
  });

  test("two failures in a row and it is the service", async () => {
    const service: OpenStackServiceRun = run();

    await failing(
      service,
      new OpenStackRequestTimeoutError("https://x/", 60_000),
    );
    expect(service.isStopped()).toBe(false);

    await failing(
      service,
      new OpenStackRequestTimeoutError("https://x/", 60_000),
    );
    expect(service.isStopped()).toBe(true);
  });

  test("an answer between failures starts the count again", async () => {
    const service: OpenStackServiceRun = run();

    await failing(service, apiError("failing", 500));
    await ok(service);
    await failing(service, apiError("failing", 500));

    expect(service.isStopped()).toBe(false);
  });

  test("refusals are never a reason to stop: each read has its own policy", async () => {
    const service: OpenStackServiceRun = run();

    await failing(service, apiError("refused", 403));
    await failing(service, apiError("refused", 403));
    await failing(service, apiError("refused", 403));

    expect(service.isStopped()).toBe(false);
  });

  test("running out of time stops it, and the read counts as not made", async () => {
    const service: OpenStackServiceRun = run();

    await failing(service, new OpenStackBudgetExceededError("Out of time."));

    expect(service.isOutOfTime).toBe(true);
    expect(service.isStopped()).toBe(true);
    expect(service.reads[0]?.state).toBe("skipped");
    expect(service.firstFailure?.code).toBe(
      OpenStackCollectionErrorCode.TimedOut,
    );
  });
});

describe("what `_up` says, which is what lets rows age out", () => {
  test("everything answered: up", async () => {
    const service: OpenStackServiceRun = run();

    await ok(service, "networks");
    await ok(service, "subnets");

    expect(service.isApiUp()).toBe(true);
    expect(service.getOutcome()).toBe("Succeeded");
  });

  test("an inventory read failed: not up, because its rows were not seen and are not gone", async () => {
    const service: OpenStackServiceRun = run();

    await ok(service, "networks");
    await failing(service, apiError("failing", 500), "floating IPs");

    expect(service.isApiUp()).toBe(false);
    expect(service.getOutcome()).toBe("Partial");
  });

  test("a count nothing keeps a row of failed: up, because it costs only itself", async () => {
    const service: OpenStackServiceRun = run();

    await ok(service, "networks");
    await failing(service, apiError("failing", 500), "security groups", false);

    expect(service.isApiUp()).toBe(true);
    expect(service.getOutcome()).toBe("Succeeded");
    expect(service.firstFailure).not.toBeNull();
  });

  test("a read skipped because the service was in trouble is a hole too", async () => {
    const service: OpenStackServiceRun = run();

    await ok(service, "networks");
    await failing(service, apiError("overloaded", 503), "subnets", false);
    await ok(service, "routers");

    expect(service.reads[2]?.state).toBe("skipped");
    expect(service.isApiUp()).toBe(false);
  });

  test("refused everywhere: up, because the API answered and it is the credential", async () => {
    const service: OpenStackServiceRun = run();

    await failing(service, apiError("refused", 403), "agents");
    await failing(service, apiError("refused", 403), "networks");

    expect(service.isApiUp()).toBe(true);
    expect(service.getOutcome()).toBe("Refused");
    expect(service.mustBackOff()).toBe(false);
  });

  test("some read and some refused: up, and it worked", async () => {
    const service: OpenStackServiceRun = run();

    await failing(service, apiError("refused", 403), "agents");
    await ok(service, "networks");

    expect(service.isApiUp()).toBe(true);
    expect(service.getOutcome()).toBe("Succeeded");
  });

  test("nothing but 404s is not this service at all", async () => {
    const service: OpenStackServiceRun = run();

    await failing(service, apiError("absent", 404), "agents");
    await failing(service, apiError("absent", 404), "networks");

    expect(service.isApiUp()).toBe(false);
    expect(service.getOutcome()).toBe("Failed");
  });

  test("no reads at all says nothing is up", () => {
    expect(run().isApiUp()).toBe(false);
  });

  /*
   * What a real access-rule credential met: Nova's list of versions answers anyone, and
   * every read after it was a 401. Keeping that one answer from counting is what tells
   * this service from one that read something.
   */
  describe("a read open to anyone", () => {
    function openToAnyone(service: OpenStackServiceRun): Promise<unknown> {
      return service.read({
        name: "versions",
        isInventory: false,
        isOpenToAnyone: true,
        run: async () => {
          return "versions";
        },
      });
    }

    test("says nothing of what this credential can read", async () => {
      const service: OpenStackServiceRun = run();

      await openToAnyone(service);
      await failing(service, apiError("refused", 401), "services");

      expect(service.getOutcome()).toBe("Refused");
      expect(service.isApiUp()).toBe(true);
    });

    test("and is no proof the rest of the API is there", async () => {
      const service: OpenStackServiceRun = run();

      await openToAnyone(service);
      await failing(service, apiError("absent", 404), "services");

      expect(service.isApiUp()).toBe(false);
      expect(service.getOutcome()).toBe("Failed");
    });

    test("but it was an answer, so `up` says so", async () => {
      const service: OpenStackServiceRun = run();

      await openToAnyone(service);

      expect(service.isAnswered()).toBe(true);
    });
  });

  test("out of time is never up, whatever it did read", async () => {
    const service: OpenStackServiceRun = run();

    await ok(service, "networks");
    service.markOutOfTime("The collection ran out of time.");

    expect(service.isApiUp()).toBe(false);
    expect(service.getOutcome()).toBe("Partial");
  });
});

describe("what `up` says, as the receiver's would", () => {
  test("an API that answered with an error still answered", async () => {
    const service: OpenStackServiceRun = run();

    await failing(service, apiError("failing", 500));

    expect(service.isAnswered()).toBe(true);
    expect(service.isApiUp()).toBe(false);
  });

  test("no answer at all is what `up` reading 0 means", async () => {
    const service: OpenStackServiceRun = run();

    await failing(
      service,
      Object.assign(new Error("refused"), {
        code: "ECONNREFUSED",
      }),
    );

    expect(service.isAnswered()).toBe(false);
  });

  test("a scrape that ran out of time reads 0 too, whatever it got", async () => {
    const service: OpenStackServiceRun = run();

    await ok(service);
    service.markOutOfTime("The collection ran out of time.");

    expect(service.isAnswered()).toBe(false);
  });
});

describe("whether to ask less often", () => {
  test("it said to", async () => {
    const service: OpenStackServiceRun = run();

    await ok(service, "networks");
    await failing(service, apiError("overloaded", 429), "subnets");

    expect(service.mustBackOff()).toBe(true);
  });

  test("it could not finish in time", async () => {
    const service: OpenStackServiceRun = run();

    await ok(service);
    service.markOutOfTime("Out of time.");

    expect(service.mustBackOff()).toBe(true);
  });

  test("nothing came back", async () => {
    const service: OpenStackServiceRun = run();

    await failing(service, apiError("failing", 500));

    expect(service.mustBackOff()).toBe(true);
  });

  test("one route's bug is no reason to read the rest less often", async () => {
    const service: OpenStackServiceRun = run();

    await ok(service, "networks");
    await failing(service, apiError("failing", 500), "subnets");

    expect(service.mustBackOff()).toBe(false);
  });
});

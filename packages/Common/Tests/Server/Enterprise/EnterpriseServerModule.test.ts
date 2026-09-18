import { describe, expect, test } from "@jest/globals";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import {
  ENTERPRISE_SERVER_MODULE_NAME,
  EnterpriseServerModuleShape,
} from "../../../Server/Enterprise/EnterpriseServerModule";
import FakeEnterpriseModule from "./FakeEnterpriseModule";

const noopHandler: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void = (
  _req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  next();
};

const createValidCandidate: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  const noop: () => undefined = (): undefined => {
    return undefined;
  };

  return {
    name: ENTERPRISE_SERVER_MODULE_NAME,
    version: "13.0.7",
    init: noop,
    getIdentityRouters: noop,
    getApiRouters: noop,
    getAdminHealthRouter: noop,
    registerWorkerJobs: noop,
    getAuditLogRecorder: noop,
    licensing: {
      getSnapshot: noop,
      getCachedSnapshot: noop,
      refresh: noop,
      invalidate: noop,
      getSeatUsage: noop,
      assertSeatAvailableForNewUser: noop,
    },
  };
};

describe("EnterpriseServerModuleShape.findProblems", () => {
  test("the module name is the documented constant", () => {
    expect(ENTERPRISE_SERVER_MODULE_NAME).toBe("oneuptime-enterprise");
  });

  test("a complete module has no problems", () => {
    expect(
      EnterpriseServerModuleShape.findProblems(createValidCandidate()),
    ).toEqual([]);
  });

  test("the test kit's fake satisfies the runtime shape check too", () => {
    expect(
      EnterpriseServerModuleShape.findProblems(new FakeEnterpriseModule()),
    ).toEqual([]);
  });

  test.each([
    ["undefined", undefined, "exported undefined"],
    ["null", null, "exported null"],
    ["a string", "oneuptime-enterprise", "exported string"],
    ["a number", 42, "exported number"],
    [
      "a function",
      (): void => {
        return undefined;
      },
      "exported function",
    ],
  ] as Array<[string, unknown, string]>)(
    "a module that exports %s is rejected",
    (_label: string, candidate: unknown, expected: string) => {
      const problems: Array<string> =
        EnterpriseServerModuleShape.findProblems(candidate);

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(expected);
    },
  );

  test("a wrong name is reported", () => {
    const candidate: Record<string, unknown> = createValidCandidate();
    candidate["name"] = "some-other-plugin";

    expect(EnterpriseServerModuleShape.findProblems(candidate)).toEqual([
      '"name" must be "oneuptime-enterprise", but it is "some-other-plugin"',
    ]);
  });

  test("a missing name is reported", () => {
    const candidate: Record<string, unknown> = createValidCandidate();
    delete candidate["name"];

    expect(EnterpriseServerModuleShape.findProblems(candidate)[0]).toContain(
      '"name" must be "oneuptime-enterprise"',
    );
  });

  test.each([undefined, "", "   ", 13] as Array<unknown>)(
    "a bad version (%p) is reported",
    (version: unknown) => {
      const candidate: Record<string, unknown> = createValidCandidate();
      candidate["version"] = version;

      expect(EnterpriseServerModuleShape.findProblems(candidate)).toEqual([
        '"version" must be a non-empty string',
      ]);
    },
  );

  test.each([
    "init",
    "getIdentityRouters",
    "getApiRouters",
    "getAdminHealthRouter",
    "registerWorkerJobs",
    "getAuditLogRecorder",
  ])("a missing %s function is reported", (functionName: string) => {
    const candidate: Record<string, unknown> = createValidCandidate();
    candidate[functionName] = "not a function";

    expect(EnterpriseServerModuleShape.findProblems(candidate)).toEqual([
      `"${functionName}" must be a function`,
    ]);
  });

  test("a missing licensing object is reported", () => {
    const candidate: Record<string, unknown> = createValidCandidate();
    delete candidate["licensing"];

    expect(EnterpriseServerModuleShape.findProblems(candidate)).toEqual([
      '"licensing" must be an object',
    ]);
  });

  test.each([
    "getSnapshot",
    "getCachedSnapshot",
    "refresh",
    "invalidate",
    "getSeatUsage",
    "assertSeatAvailableForNewUser",
  ])("a missing licensing.%s function is reported", (functionName: string) => {
    const candidate: Record<string, unknown> = createValidCandidate();
    const licensing: Record<string, unknown> = candidate["licensing"] as Record<
      string,
      unknown
    >;
    delete licensing[functionName];

    expect(EnterpriseServerModuleShape.findProblems(candidate)).toEqual([
      `"licensing.${functionName}" must be a function`,
    ]);
  });

  test("an empty object reports every missing member at once", () => {
    const problems: Array<string> = EnterpriseServerModuleShape.findProblems(
      {},
    );

    // name + version + 6 functions + licensing
    expect(problems).toHaveLength(9);
  });

  test("an un-unwrapped ES module namespace ({ default: module }) is rejected", () => {
    const problems: Array<string> = EnterpriseServerModuleShape.findProblems({
      default: createValidCandidate(),
    });

    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toContain('"name" must be "oneuptime-enterprise"');
  });
});

describe("EnterpriseServerModuleShape.findLayersWithoutRoute", () => {
  test("a router with only routes is accepted", () => {
    const router: ExpressRouter = Express.getRouter();
    router.get("/global-config/license", noopHandler);
    router.post("/global-config/license/refresh", noopHandler, noopHandler);
    router.all("/scim/v2/:id/Users", noopHandler);

    expect(EnterpriseServerModuleShape.findLayersWithoutRoute(router)).toEqual(
      [],
    );
  });

  test("an empty router is accepted", () => {
    expect(
      EnterpriseServerModuleShape.findLayersWithoutRoute(Express.getRouter()),
    ).toEqual([]);
  });

  test("a path-less router.use middleware is reported", () => {
    const router: ExpressRouter = Express.getRouter();
    router.get("/ok", noopHandler);
    router.use(noopHandler);

    const problems: Array<string> =
      EnterpriseServerModuleShape.findLayersWithoutRoute(router);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("layer 1");
    expect(problems[0]).toContain("noopHandler");
  });

  test("a path-scoped router.use middleware is reported too", () => {
    const router: ExpressRouter = Express.getRouter();
    router.use("/query", noopHandler);

    expect(
      EnterpriseServerModuleShape.findLayersWithoutRoute(router),
    ).toHaveLength(1);
  });

  test("a nested sub-router is reported", () => {
    const inner: ExpressRouter = Express.getRouter();
    inner.get("/inner", noopHandler);

    const router: ExpressRouter = Express.getRouter();
    router.use(inner);

    expect(
      EnterpriseServerModuleShape.findLayersWithoutRoute(router),
    ).toHaveLength(1);
  });

  test("something that is not a router is reported", () => {
    expect(
      EnterpriseServerModuleShape.findLayersWithoutRoute(
        {} as unknown as ExpressRouter,
      ),
    ).toEqual(["the router has no layer stack (is it an express Router?)"]);
  });
});

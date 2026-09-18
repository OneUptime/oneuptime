import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import CreatePermission from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import DeletePermission from "../../../../../Server/Types/Database/Permissions/DeletePermission";
import ReadPermission from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import UpdatePermission from "../../../../../Server/Types/Database/Permissions/UpdatePermission";
import Probe from "../../../../../Models/DatabaseModels/Probe";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import ExceptionCode from "../../../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { getJestSpyOn } from "../../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Every throw below is deliberate and asserted on, but @CaptureSpan hands each
 * one to Telemetry, which logs the whole stack. Mocking Logger keeps the run
 * readable.
 */
jest.mock("../../../../../Server/Utils/Logger");

/*
 * WHAT THIS FILE PINS
 *
 * The dashboard's access-token cookie expires together with the 15-minute JWT
 * inside it, so an idle tab's next request arrives with no credentials at all
 * and getUserMiddleware lets it through as Public. The browser client
 * refreshes the session and replays the request on a 401 and on nothing else.
 *
 * On a model whose table ACL includes Permission.Public (Probe, AIAgent and
 * LlmProvider reads; StatusPageSubscriber create) that anonymous caller passes
 * the "is anyone logged in" check at the top of the permission layer, and is
 * then refused by the column, select or query checks with a 422
 * NotAuthorizedException - a bogus error for a user whose session merely
 * needs refreshing. ModelPermission's entry points therefore turn a
 * NotAuthorizedException into a NotAuthenticatedException (401, same message)
 * when, and only when, the caller has no credentials at all.
 *
 * The first half drives each entry point against a stubbed underlying check so
 * every branch is reached on every entry point. The second half runs the real
 * permission layer on Probe, so the conversion is proved against a refusal the
 * permission code actually produces.
 */

const REFUSAL_MESSAGE: string = "x";

type EntryPointCall = (
  props: DatabaseCommonInteractionProps,
) => Promise<unknown>;

interface EntryPoint {
  name: string;
  // Stubs the underlying Read/Create/Update/Delete check.
  stubUnderlying: () => jest.SpyInstance<any, any>;
  // Calls the ModelPermission entry point; a sync throw becomes a rejection.
  call: EntryPointCall;
}

const fetchNothing: () => Promise<Probe | null> =
  async (): Promise<Probe | null> => {
    return null;
  };

const entryPoints: Array<EntryPoint> = [
  {
    name: "checkReadQueryPermission",
    stubUnderlying: () => {
      return getJestSpyOn(ReadPermission, "checkReadPermission");
    },
    call: async (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return await ModelPermission.checkReadQueryPermission(
        Probe,
        {},
        { name: true },
        props,
      );
    },
  },
  {
    name: "checkCreatePermissions",
    stubUnderlying: () => {
      return getJestSpyOn(CreatePermission, "checkCreatePermissions");
    },
    call: async (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return ModelPermission.checkCreatePermissions(Probe, new Probe(), props);
    },
  },
  {
    name: "checkUpdateQueryPermissions",
    stubUnderlying: () => {
      return getJestSpyOn(UpdatePermission, "checkUpdatePermissions");
    },
    call: async (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return await ModelPermission.checkUpdateQueryPermissions(
        Probe,
        {},
        { name: "renamed" },
        props,
      );
    },
  },
  {
    name: "checkUpdatePermissionByModel",
    stubUnderlying: () => {
      return getJestSpyOn(UpdatePermission, "checkUpdatePermissionByModel");
    },
    call: async (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return await ModelPermission.checkUpdatePermissionByModel({
        modelType: Probe,
        fetchModelWithAccessControlIds: fetchNothing,
        props: props,
      });
    },
  },
  {
    name: "checkDeleteQueryPermission",
    stubUnderlying: () => {
      return getJestSpyOn(DeletePermission, "checkDeletePermission");
    },
    call: async (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return await ModelPermission.checkDeleteQueryPermission(Probe, {}, props);
    },
  },
  {
    name: "checkDeletePermissionByModel",
    stubUnderlying: () => {
      return getJestSpyOn(DeletePermission, "checkDeletePermissionByModel");
    },
    call: async (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return await ModelPermission.checkDeletePermissionByModel({
        modelType: Probe,
        fetchModelWithAccessControlIds: fetchNothing,
        props: props,
      });
    },
  },
];

type PropsCase = [string, () => DatabaseCommonInteractionProps];

// Callers with no credentials at all: the expired-session shape.
const anonymousCases: Array<PropsCase> = [
  [
    "no props at all",
    (): DatabaseCommonInteractionProps => {
      return {};
    },
  ],
  [
    "a tenant but no user",
    (): DatabaseCommonInteractionProps => {
      return { tenantId: ObjectID.generate() };
    },
  ],
  [
    "an explicitly Public caller",
    (): DatabaseCommonInteractionProps => {
      return { userType: UserType.Public };
    },
  ],
  [
    "a Public caller with a tenant",
    (): DatabaseCommonInteractionProps => {
      return { tenantId: ObjectID.generate(), userType: UserType.Public };
    },
  ],
];

/*
 * Callers who ARE identified. Refreshing cannot change their answer, and a
 * 401 would send the client round a refresh-and-replay loop.
 */
const credentialedCases: Array<PropsCase> = [
  [
    "a signed-in user",
    (): DatabaseCommonInteractionProps => {
      return { userId: ObjectID.generate(), tenantId: ObjectID.generate() };
    },
  ],
  [
    "a signed-in user with userType User",
    (): DatabaseCommonInteractionProps => {
      return { userId: ObjectID.generate(), userType: UserType.User };
    },
  ],
  [
    "a project API key (no user)",
    (): DatabaseCommonInteractionProps => {
      return { tenantId: ObjectID.generate(), userType: UserType.API };
    },
  ],
  [
    "a master-admin userType with no user",
    (): DatabaseCommonInteractionProps => {
      return { userType: UserType.MasterAdmin };
    },
  ],
  [
    "isRoot with no user",
    (): DatabaseCommonInteractionProps => {
      return { isRoot: true };
    },
  ],
  [
    "isMasterAdmin with no user",
    (): DatabaseCommonInteractionProps => {
      return { isMasterAdmin: true };
    },
  ],
];

type RejectionOfFunction = (promise: Promise<unknown>) => Promise<unknown>;

// What the promise rejected with; fails the test if it resolved.
const rejectionOf: RejectionOfFunction = async (
  promise: Promise<unknown>,
): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the permission check to reject, but it resolved.");
};

type ExpectNotAuthenticatedFunction = (error: unknown, message: string) => void;

const expectNotAuthenticated: ExpectNotAuthenticatedFunction = (
  error: unknown,
  message: string,
): void => {
  expect(error).toBeInstanceOf(NotAuthenticatedException);
  expect(error).not.toBeInstanceOf(NotAuthorizedException);
  expect((error as Exception).code).toBe(
    ExceptionCode.NotAuthenticatedException,
  );
  expect((error as Exception).code).toBe(401);
  expect((error as Exception).message).toBe(message);
};

describe("ModelPermission: anonymous refusals become 401 (stubbed underlying checks)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(
    entryPoints.map((entry: EntryPoint): [string, EntryPoint] => {
      return [entry.name, entry];
    }),
  )("%s", (_name: string, entry: EntryPoint) => {
    test.each(anonymousCases)(
      "turns a NotAuthorizedException for %s into a 401 with the same message",
      async (
        _label: string,
        makeProps: () => DatabaseCommonInteractionProps,
      ) => {
        const original: NotAuthorizedException = new NotAuthorizedException(
          REFUSAL_MESSAGE,
        );

        entry.stubUnderlying().mockImplementation(() => {
          throw original;
        });

        const error: unknown = await rejectionOf(entry.call(makeProps()));

        expectNotAuthenticated(error, REFUSAL_MESSAGE);
        expect(error).not.toBe(original);
      },
    );

    test.each(credentialedCases)(
      "rethrows the original NotAuthorizedException for %s",
      async (
        _label: string,
        makeProps: () => DatabaseCommonInteractionProps,
      ) => {
        const original: NotAuthorizedException = new NotAuthorizedException(
          REFUSAL_MESSAGE,
        );

        entry.stubUnderlying().mockImplementation(() => {
          throw original;
        });

        const error: unknown = await rejectionOf(entry.call(makeProps()));

        expect(error).toBe(original);
        expect((error as Exception).code).toBe(422);
      },
    );

    /*
     * Only a NotAuthorizedException is converted. A 400 is the caller's data
     * being wrong, whoever they are, and must reach the client unchanged; a
     * 401 thrown further down is already the right answer.
     */
    test.each([
      [
        "a BadDataException",
        (): Error => {
          return new BadDataException(REFUSAL_MESSAGE);
        },
      ],
      [
        "a plain Error",
        (): Error => {
          return new Error(REFUSAL_MESSAGE);
        },
      ],
      [
        "an existing NotAuthenticatedException",
        (): Error => {
          return new NotAuthenticatedException(REFUSAL_MESSAGE);
        },
      ],
    ])(
      "passes %s from an anonymous caller through unchanged",
      async (_label: string, makeError: () => Error) => {
        const original: Error = makeError();

        entry.stubUnderlying().mockImplementation(() => {
          throw original;
        });

        const error: unknown = await rejectionOf(entry.call({}));

        expect(error).toBe(original);
      },
    );

    test("passes the underlying return value through for an anonymous caller", async () => {
      const sentinel: { sentinel: string } = { sentinel: entry.name };

      const spy: jest.SpyInstance<any, any> = entry.stubUnderlying();

      if (entry.name === "checkCreatePermissions") {
        spy.mockImplementation(() => {
          return sentinel;
        });
      } else {
        spy.mockImplementation(async () => {
          return sentinel;
        });
      }

      const props: DatabaseCommonInteractionProps = {
        tenantId: ObjectID.generate(),
      };

      await expect(entry.call(props)).resolves.toBe(sentinel);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test("a rejected promise (not just a sync throw) is converted too", async () => {
      if (entry.name === "checkCreatePermissions") {
        // Create is synchronous; its sync throw is covered above.
        return;
      }

      entry.stubUnderlying().mockImplementation(async () => {
        throw new NotAuthorizedException(REFUSAL_MESSAGE);
      });

      expectNotAuthenticated(
        await rejectionOf(entry.call({})),
        REFUSAL_MESSAGE,
      );
    });
  });

  /*
   * checkCreatePermissions is synchronous, and DatabaseService calls it
   * without awaiting. The conversion has to happen as a synchronous throw, not
   * as a returned rejected promise nobody looks at.
   */
  test("checkCreatePermissions converts synchronously", () => {
    getJestSpyOn(CreatePermission, "checkCreatePermissions").mockImplementation(
      () => {
        throw new NotAuthorizedException(REFUSAL_MESSAGE);
      },
    );

    let thrown: unknown = undefined;

    try {
      ModelPermission.checkCreatePermissions(Probe, new Probe(), {});
    } catch (error) {
      thrown = error;
    }

    expectNotAuthenticated(thrown, REFUSAL_MESSAGE);
  });

  test("hands the caller's arguments to the underlying check unchanged", async () => {
    const spy: jest.SpyInstance<any, any> = getJestSpyOn(
      ReadPermission,
      "checkReadPermission",
    ).mockImplementation(async () => {
      return { query: {}, select: null, relationSelect: null };
    });

    const props: DatabaseCommonInteractionProps = {
      tenantId: ObjectID.generate(),
    };
    const query: Record<string, unknown> = { name: "probe-1" };
    const select: Record<string, boolean> = { name: true };

    await ModelPermission.checkReadQueryPermission(Probe, query, select, props);

    expect(spy).toHaveBeenCalledWith(Probe, query, select, props);
  });
});

/*
 * The real thing, no stubs. Probe's table read list carries Permission.Public
 * (status pages show probe names to logged-out visitors), so an anonymous
 * read of Probe gets past the login check. Its `key` column is readable only
 * by ProjectOwner / ProjectAdmin, so selecting it is refused by
 * SelectPermission with a NotAuthorizedException - exactly the 422 an expired
 * dashboard session used to get on the probes page.
 */
describe("ModelPermission: anonymous refusals become 401 (real permission layer)", () => {
  const projectId: ObjectID = ObjectID.generate();

  type ReadKeyFunction = (
    props: DatabaseCommonInteractionProps,
  ) => Promise<unknown>;

  const readProbeKey: ReadKeyFunction = async (
    props: DatabaseCommonInteractionProps,
  ): Promise<unknown> => {
    return await ModelPermission.checkReadQueryPermission(
      Probe,
      {},
      { key: true },
      props,
    );
  };

  test("the fixture: Probe is publicly readable but its key column is not", () => {
    expect(new Probe().readRecordPermissions).toContain(Permission.Public);
    expect(new Probe().getColumnAccessControlFor("key")!.read).not.toContain(
      Permission.Public,
    );
    expect(new Probe().getColumnAccessControlFor("name")!.read).toContain(
      Permission.Public,
    );
  });

  test.each([
    ["with a tenant", { tenantId: projectId }],
    [
      "with a tenant and a Public userType",
      { tenantId: projectId, userType: UserType.Public },
    ],
  ])(
    "an anonymous caller (%s) selecting a non-public column gets a 401",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      const error: unknown = await rejectionOf(readProbeKey(props));

      expect(error).toBeInstanceOf(NotAuthenticatedException);
      expect((error as Exception).code).toBe(401);
      // The select refusal's own wording survives the conversion.
      expect((error as Exception).message).toContain(
        "You do not have permissions to select on - key.",
      );
    },
  );

  /*
   * The same refusal for a caller who has credentials stays the 422 it always
   * was: a project API key without ProjectOwner/ProjectAdmin really may not
   * see probe keys, and refreshing a session would not change that.
   */
  test("a project API key selecting the same column still gets the 422", async () => {
    const error: unknown = await rejectionOf(
      readProbeKey({ tenantId: projectId, userType: UserType.API }),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error).not.toBeInstanceOf(NotAuthenticatedException);
    expect((error as Exception).code).toBe(422);
    expect((error as Exception).message).toContain(
      "You do not have permissions to select on - key.",
    );
  });

  test("a signed-in user without the column permission still gets the 422", async () => {
    const error: unknown = await rejectionOf(
      readProbeKey({
        tenantId: projectId,
        userId: ObjectID.generate(),
        userType: UserType.User,
      }),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect((error as Exception).code).toBe(422);
  });

  // Control: the anonymous read itself is allowed; only the column is refused.
  test("an anonymous caller selecting only public columns is not refused", async () => {
    await expect(
      ModelPermission.checkReadQueryPermission(
        Probe,
        {},
        { name: true },
        { tenantId: projectId },
      ),
    ).resolves.toBeDefined();
  });
});

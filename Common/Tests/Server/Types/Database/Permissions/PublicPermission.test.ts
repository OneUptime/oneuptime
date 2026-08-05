import ModelPermission from "../../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import PublicPermission from "../../../../../Server/Types/Database/Permissions/PublicPermission";
import Log from "../../../../../Models/AnalyticsModels/Log";
import LogPipeline from "../../../../../Models/DatabaseModels/LogPipeline";
import Probe from "../../../../../Models/DatabaseModels/Probe";
import StatusPageSubscriber from "../../../../../Models/DatabaseModels/StatusPageSubscriber";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../../../../Types/Exception/Exception";
import ExceptionCode from "../../../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../../../Types/Exception/NotAuthenticatedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { describe, expect, it, jest } from "@jest/globals";

/*
 * Every throw below is a deliberate, asserted-on throw, but @CaptureSpan on
 * these methods hands each one to Telemetry, which logs the whole stack via
 * Server/Utils/Logger. Auto-mocking Logger (the same thing
 * Tests/Server/Middleware/UserAuthorization.test.ts does) keeps the run
 * readable. Nothing under test is mocked: PublicPermission,
 * AnalyticsDatabase/ModelPermission, TablePermission and the real models all
 * run for real.
 */
jest.mock("../../../../../Server/Utils/Logger");

/*
 * PublicPermission is the very first gate every Postgres-backed read/write
 * passes through, and until now nothing tested it directly — the only test
 * that touched checkIfUserIsLoggedIn (BasePermission.test.ts) stubs it out.
 *
 * It is also the function that produced the 401 in GitHub issue #3004: a
 * caller with a perfectly good project API key was told "A user should be
 * logged in to read record of Log Pipeline." Their key had never reached the
 * server, but the sentence talked only about sessions and named the model, so
 * it read as an RBAC bug on Log Pipeline specifically. Issue #1754 was the
 * same sentence on a different model (axios dropping the headers object).
 * The wording is therefore load-bearing, and so is the API early return the
 * reporter believed was broken. Both are pinned here.
 */
describe("PublicPermission", () => {
  const userId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  const allRequestTypes: Array<DatabaseRequestType> = [
    DatabaseRequestType.Create,
    DatabaseRequestType.Read,
    DatabaseRequestType.Update,
    DatabaseRequestType.Delete,
  ];

  // A caller carrying neither a session nor an API key.
  function anonymousProps(): DatabaseCommonInteractionProps {
    return {
      tenantId: projectId,
      userType: UserType.Public,
    };
  }

  /*
   * A caller authenticated by API key. This is exactly what
   * ProjectAuthorization.isValidProjectIdAndApiKeyMiddleware builds once it
   * resolves a key: userType = API, tenantId from the key's project, and NO
   * userId, because an API key is not a user.
   */
  function apiKeyProps(): DatabaseCommonInteractionProps {
    return {
      tenantId: projectId,
      userType: UserType.API,
    };
  }

  // Runs the check and returns the message it threw with.
  function messageFromCheck(runCheck: () => void): string {
    try {
      runCheck();
    } catch (err) {
      return (err as Exception).message;
    }

    throw new Error(
      "Expected checkIfUserIsLoggedIn to throw, but it returned normally.",
    );
  }

  describe("isPublicPermissionAllowed", () => {
    /*
     * LogPipeline is the issue-3004 model. Its read list is project-scoped
     * only — no Permission.Public — which is why an anonymous read of it
     * reaches the throw below rather than being waved through.
     */
    it("is false for a model whose read list has no Permission.Public", () => {
      /*
       * Stated against the model config as well as the function, so that if
       * someone ever adds Permission.Public to LogPipeline the failure here
       * reads as "the fixture changed" rather than "the function broke" —
       * that would be a real security change and this file would need
       * updating, not the production code.
       */
      expect(new LogPipeline().readRecordPermissions).not.toContain(
        Permission.Public,
      );

      expect(
        PublicPermission.isPublicPermissionAllowed(
          LogPipeline,
          DatabaseRequestType.Read,
        ),
      ).toBe(false);
    });

    /*
     * Probe genuinely carries Permission.Public in its TableAccessControl
     * read list (status pages render probe names to logged-out visitors).
     */
    it("is true for a model whose read list contains Permission.Public", () => {
      expect(new Probe().readRecordPermissions).toContain(Permission.Public);

      expect(
        PublicPermission.isPublicPermissionAllowed(
          Probe,
          DatabaseRequestType.Read,
        ),
      ).toBe(true);
    });

    /*
     * The lookup is per-operation, not per-model. StatusPageSubscriber is the
     * clearest case in the codebase: anyone may subscribe to a status page
     * (Public in `create`) but the subscriber list itself is not public
     * (no Public in `read`). A model-level answer here would leak the list.
     */
    it("answers per operation, not per model", () => {
      expect(
        PublicPermission.isPublicPermissionAllowed(
          StatusPageSubscriber,
          DatabaseRequestType.Create,
        ),
      ).toBe(true);

      expect(
        PublicPermission.isPublicPermissionAllowed(
          StatusPageSubscriber,
          DatabaseRequestType.Read,
        ),
      ).toBe(false);
    });

    it("is false for every non-public operation of the issue-3004 model", () => {
      for (const type of allRequestTypes) {
        expect(
          PublicPermission.isPublicPermissionAllowed(LogPipeline, type),
        ).toBe(false);
      }
    });
  });

  describe("checkIfUserIsLoggedIn", () => {
    /*
     * ===== THE MESSAGE =====
     *
     * This is the sentence the reporter of #3004 saw. The old wording — "A
     * user should be logged in to read record of Log Pipeline." — described
     * only one of the two ways to authenticate and named the model, so two
     * separate reporters (#3004 and #1754) spent their time auditing that
     * model's RBAC config when the real cause was an API key that never
     * arrived. The replacement names both credentials. If anyone shortens it
     * back to a login-only phrasing, this fails.
     */
    it("names both a session and an API key in the anonymous-read message", () => {
      const message: string = messageFromCheck(() => {
        PublicPermission.checkIfUserIsLoggedIn(
          LogPipeline,
          anonymousProps(),
          DatabaseRequestType.Read,
        );
      });

      expect(message).toBe(
        "Authenticated user or a valid API key is needed to read record of Log Pipeline.",
      );
      expect(message).not.toContain("should be logged in");
    });

    /*
     * ===== THE API EARLY RETURN =====
     *
     * This is the invariant #3004 claimed was broken: a request authenticated
     * by API key has userType API and NO userId, and must sail straight past
     * this gate for every operation even on a model that is not public. If
     * this ever regressed, every single API-key call in the product would 401
     * with the sentence above, and the report would look exactly like #3004.
     *
     * The early return sits inside the not-public/no-userId branch and is
     * keyed on `props.userType === UserType.API`; no userId is consulted,
     * which is exactly the props shape ProjectAuthorization produces once it
     * resolves a key.
     */
    it("lets an API-key caller with no userId through for every operation", () => {
      for (const type of allRequestTypes) {
        const props: DatabaseCommonInteractionProps = apiKeyProps();
        expect(props.userId).toBeUndefined();

        expect(() => {
          PublicPermission.checkIfUserIsLoggedIn(LogPipeline, props, type);
        }).not.toThrow();
      }
    });

    it("lets a logged-in user through for every operation", () => {
      for (const type of allRequestTypes) {
        expect(() => {
          PublicPermission.checkIfUserIsLoggedIn(
            LogPipeline,
            {
              userId: userId,
              tenantId: projectId,
              userType: UserType.User,
            },
            type,
          );
        }).not.toThrow();
      }
    });

    /*
     * The gate has exactly two halves — `!isPublicPermissionAllowed` and
     * `!props.userId` — and it is the *presence of a userId* that lifts it,
     * not the userType label. A session established before userType was
     * stamped on the props (SSO callback, older cached tokens) still carries
     * a userId, and must not be treated as anonymous. If the condition were
     * ever rewritten as `props.userType !== UserType.User`, this fails.
     */
    it("lets any caller carrying a userId through, whatever the userType says", () => {
      expect(() => {
        PublicPermission.checkIfUserIsLoggedIn(
          LogPipeline,
          {
            userId: userId,
            tenantId: projectId,
            userType: UserType.Public,
          },
          DatabaseRequestType.Read,
        );
      }).not.toThrow();
    });

    /*
     * The 401 has to stay a 401. Response.sendErrorResponse reads
     * exception.code straight through to the HTTP status, so a wrong
     * exception class here would silently change the status callers see and
     * break client retry/re-auth logic.
     */
    it("throws NotAuthenticatedException carrying status 401 for an anonymous caller", () => {
      let thrown: Exception | null = null;

      try {
        PublicPermission.checkIfUserIsLoggedIn(
          LogPipeline,
          anonymousProps(),
          DatabaseRequestType.Read,
        );
      } catch (err) {
        thrown = err as Exception;
      }

      expect(thrown).toBeInstanceOf(NotAuthenticatedException);
      expect(thrown?.code).toBe(ExceptionCode.NotAuthenticatedException);
      expect(thrown?.code).toBe(401);
    });

    /*
     * The operation verb is interpolated from DatabaseRequestType and the
     * model name from singularName. Support triages these reports by the
     * sentence, so both halves have to be the real values — "Log Pipeline"
     * with its space, not the class name "LogPipeline".
     */
    it("interpolates the operation and the model's singular name", () => {
      const expectedByType: Array<[DatabaseRequestType, string]> = [
        [
          DatabaseRequestType.Create,
          "Authenticated user or a valid API key is needed to create record of Log Pipeline.",
        ],
        [
          DatabaseRequestType.Read,
          "Authenticated user or a valid API key is needed to read record of Log Pipeline.",
        ],
        [
          DatabaseRequestType.Update,
          "Authenticated user or a valid API key is needed to update record of Log Pipeline.",
        ],
        [
          DatabaseRequestType.Delete,
          "Authenticated user or a valid API key is needed to delete record of Log Pipeline.",
        ],
      ];

      for (const [type, expected] of expectedByType) {
        const message: string = messageFromCheck(() => {
          PublicPermission.checkIfUserIsLoggedIn(
            LogPipeline,
            anonymousProps(),
            type,
          );
        });

        expect(message).toBe(expected);
      }

      // The human-readable name, not the class name.
      expect(new LogPipeline().singularName).toBe("Log Pipeline");
    });

    /*
     * A model that IS public for the operation lets an anonymous caller
     * through — that is what keeps logged-out status pages working — but only
     * for that operation. Probe is public to read and not public to create.
     */
    it("lets an anonymous caller read a publicly-readable model but not create it", () => {
      expect(() => {
        PublicPermission.checkIfUserIsLoggedIn(
          Probe,
          anonymousProps(),
          DatabaseRequestType.Read,
        );
      }).not.toThrow();

      expect(() => {
        PublicPermission.checkIfUserIsLoggedIn(
          Probe,
          anonymousProps(),
          DatabaseRequestType.Create,
        );
      }).toThrow(NotAuthenticatedException);

      /*
       * Every other message assertion in this file uses LogPipeline, so this
       * is the one that proves the sentence is built from the modelType
       * argument — `new modelType().singularName` — rather than from a name
       * captured anywhere else.
       */
      const message: string = messageFromCheck(() => {
        PublicPermission.checkIfUserIsLoggedIn(
          Probe,
          anonymousProps(),
          DatabaseRequestType.Create,
        );
      });

      expect(message).toBe(
        "Authenticated user or a valid API key is needed to create record of Probe.",
      );
    });

    /*
     * An entirely absent userType behaves the same as UserType.Public: only
     * UserType.API short-circuits. Callers that forget to set userType must
     * not accidentally get the API bypass.
     */
    it("treats props with no userType as anonymous", () => {
      expect(() => {
        PublicPermission.checkIfUserIsLoggedIn(
          LogPipeline,
          { tenantId: projectId },
          DatabaseRequestType.Read,
        );
      }).toThrow(NotAuthenticatedException);
    });

    /*
     * ===== MasterAdmin =====
     *
     * Documenting what the code actually does rather than what one might
     * assume: the early return checks `props.userType === UserType.API` and
     * nothing else, so a MasterAdmin (or an isMasterAdmin flag) with no
     * userId is NOT waved through here — it throws the same 401. In practice
     * the master-admin path always carries a userId, and the actual
     * master-key bypass lives upstream in the middleware, not in this gate.
     * If someone later adds a MasterAdmin short-circuit here, this test will
     * fail and force the decision to be explicit.
     */
    it("does not grant MasterAdmin an early return when there is no userId", () => {
      expect(() => {
        PublicPermission.checkIfUserIsLoggedIn(
          LogPipeline,
          {
            tenantId: projectId,
            userType: UserType.MasterAdmin,
            isMasterAdmin: true,
          },
          DatabaseRequestType.Read,
        );
      }).toThrow(NotAuthenticatedException);

      // ...but a MasterAdmin with a session passes, like any logged-in user.
      expect(() => {
        PublicPermission.checkIfUserIsLoggedIn(
          LogPipeline,
          {
            userId: userId,
            tenantId: projectId,
            userType: UserType.MasterAdmin,
            isMasterAdmin: true,
          },
          DatabaseRequestType.Read,
        );
      }).not.toThrow();
    });
  });

  /*
   * ===== DRIFT GUARD: Postgres message vs analytics message =====
   *
   * There are two copies of this check — PublicPermission (Postgres tables)
   * and AnalyticsDatabase/ModelPermission (ClickHouse tables). They are meant
   * to be the same gate, and a caller has no idea which storage engine backs
   * the model they just called. The two sentences silently diverged for
   * years: the analytics side already said "Authenticated user or a valid API
   * key is needed to ...", while the Postgres side still said "A user should
   * be logged in to ...". Searching the codebase for the string a user
   * pasted therefore turned up only one of the two call sites, which is a
   * large part of why #3004 was hard to diagnose.
   *
   * This drives both real functions with equivalent props and compares the
   * sentences they actually produce, rather than grepping the source, so it
   * still catches a divergence introduced by refactoring either one.
   */
  describe("message parity with the analytics-side checkIfUserIsLoggedIn", () => {
    // Replace the only part that legitimately differs: the model's own name.
    function sentenceTemplate(message: string, singularName: string): string {
      return message.replace(
        `record of ${singularName}.`,
        "record of <singularName>.",
      );
    }

    it("produces the same sentence on both storage engines for every operation", () => {
      const postgresSingularName: string = new LogPipeline().singularName!;
      const analyticsSingularName: string = new Log().singularName!;

      // Different names, so the comparison below is not trivially true.
      expect(postgresSingularName).not.toBe(analyticsSingularName);

      for (const type of allRequestTypes) {
        const postgresMessage: string = messageFromCheck(() => {
          PublicPermission.checkIfUserIsLoggedIn(
            LogPipeline,
            anonymousProps(),
            type,
          );
        });

        const analyticsMessage: string = messageFromCheck(() => {
          ModelPermission.checkIfUserIsLoggedIn(Log, anonymousProps(), type);
        });

        const postgresTemplate: string = sentenceTemplate(
          postgresMessage,
          postgresSingularName,
        );
        const analyticsTemplate: string = sentenceTemplate(
          analyticsMessage,
          analyticsSingularName,
        );

        // The normalisation actually fired on both sides.
        expect(postgresTemplate).toContain("<singularName>");
        expect(analyticsTemplate).toContain("<singularName>");

        expect(postgresTemplate).toBe(analyticsTemplate);
        expect(postgresTemplate).toBe(
          `Authenticated user or a valid API key is needed to ${type} record of <singularName>.`,
        );
      }
    });

    // The API early return has to agree across both engines too.
    it("lets an API-key caller with no userId through on both storage engines", () => {
      for (const type of allRequestTypes) {
        expect(() => {
          PublicPermission.checkIfUserIsLoggedIn(
            LogPipeline,
            apiKeyProps(),
            type,
          );
        }).not.toThrow();

        expect(() => {
          ModelPermission.checkIfUserIsLoggedIn(Log, apiKeyProps(), type);
        }).not.toThrow();
      }
    });
  });
});

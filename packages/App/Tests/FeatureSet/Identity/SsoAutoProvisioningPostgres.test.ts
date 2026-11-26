/*
 * ---------------------------------------------------------------------------
 * WHOM SINGLE SIGN-ON GIVES AN ACCOUNT, AND WHICH PROJECTS IT ADDS THEM TO
 * (#11149) - END TO END, AGAINST POSTGRES AND A REAL OPENID PROVIDER.
 *
 * The report: a self-hosted server's own OpenID Connect provider, Microsoft
 * Entra ID, set to "People without an account: Get one on their first
 * sign-in" and "Where this sign-in counts as SSO: Every project". Nobody
 * who signed in got an account - they were told "You need to be invited."
 * - and someone a master admin made by hand was added to no project.
 *
 * The provider had no project attached. A server's own provider adds people
 * to projects only through the projects attached to it, each with the teams
 * people join there; "Every project" decides where the sign-in counts as
 * SSO, and adds nobody to anything. With nothing attached, "Get one on their
 * first sign-in" could put nobody anywhere, so the server turned everyone
 * new away - while the provider's page said they get an account, and the
 * server's log said nothing. These run the whole sign-in to show:
 *
 *   - with nothing attached, nobody new gets an account, and the server's
 *     log now says why and what to do;
 *   - with a project attached, someone new gets an account and joins its
 *     teams, and someone made by hand joins it on their next sign-in;
 *   - an attached project with no teams of its own makes no account it
 *     cannot put anywhere, and a team of another project - one saved before
 *     teams were held to their project - takes nobody (it would have put the
 *     person on that project's on-call);
 *   - "Attached projects only" with every attachment off signs nobody in to
 *     a session every request would refuse;
 *   - an address the provider says it has not verified, or no address at
 *     all, makes and signs in no account, and joins nobody to anything;
 *   - a sign-in through one project's provider never reaches another
 *     project.
 *
 * The same for SAML, the server's own and a project's.
 *
 * The whole path is real: a browser that keeps cookies as a browser does
 * (./BrowserCookieJar) starts at OneUptime's sign-in route, follows its
 * redirect to an OpenID Provider on a loopback socket (./OidcTestIdp, here
 * with its authorization endpoint: it checks the client and redirect URI and
 * issues a one-time code bound to the request's nonce and PKCE challenge),
 * and comes back to the callback with the code; OneUptime redeems it at the
 * provider's token endpoint with openid-client, checks the ID token against
 * the provider's keys, and the Identity routers - mounted on a real Express
 * server as the App mounts them - read and write Postgres through the real
 * services: the account, its memberships, the providers and their
 * attachments, and the permissions each membership gives
 * (AccessTokenService). SAML responses are signed with a key the provider's
 * certificate names (./SamlTestKit) and posted to the Reply URL.
 *
 * Stood in, as each needs another server: Valkey (an in-memory store with
 * its commands' semantics, so the cache, the SAML one-time-use record and
 * the permission cache behave as they do), ClickHouse's audit log
 * (recorded), the session store (UserSessionService.createSession: its
 * metadata, recorded), the database's own copy of the server's host name,
 * and the message page's view (its title and message, as JSON).
 *
 * Opt in with RUN_POSTGRES_SSO_AUTO_PROVISIONING_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check
 * (.github/workflows/postgres-schema-drift.yaml runs it). The tables'
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema), dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from SSO_AUTO_PROVISIONING_TEST_DATABASE_NAME
 * or DATABASE_NAME, endpoint from SSO_AUTO_PROVISIONING_TEST_DATABASE_HOST /
 * _PORT (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 * ---------------------------------------------------------------------------
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  const environment: Record<string, unknown> = {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
  };

  // The server's public address: where the providers send people back to.
  environment["Host"] = "oneuptime.example.com";
  environment["HttpProtocol"] = "http://";

  return billingFlag.withLiveBillingFlag(environment);
});

/*
 * Valkey, in memory: the commands the cache uses on these paths, with their
 * semantics (EX, PX, NX, XX), so a cached permission, a SAML response's
 * one-time-use record and a cleared entry behave as they do on the server.
 * A command it does not know fails the test with its name.
 */
jest.mock("Common/Server/Infrastructure/Redis", () => {
  interface Entry {
    value: string;
    expiresAt: number | null;
  }

  const store: Map<string, Entry> = new Map<string, Entry>();

  const read: (key: string) => string | null = (key: string): string | null => {
    const entry: Entry | undefined = store.get(key);

    if (!entry) {
      return null;
    }

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }

    return entry.value;
  };

  const keysOf: (args: Array<unknown>) => Array<string> = (
    args: Array<unknown>,
  ): Array<string> => {
    return args.flat().map((key: unknown): string => {
      return String(key);
    });
  };

  const commands: Record<string, (...args: Array<unknown>) => unknown> = {
    get: (key: unknown): Promise<string | null> => {
      return Promise.resolve(read(String(key)));
    },
    mget: (...args: Array<unknown>): Promise<Array<string | null>> => {
      return Promise.resolve(keysOf(args).map(read));
    },
    set: (key: unknown, value: unknown, ...args: Array<unknown>): unknown => {
      let expiresAt: number | null = null;
      let isOnlyIfAbsent: boolean = false;
      let isOnlyIfPresent: boolean = false;

      for (let index: number = 0; index < args.length; index++) {
        const word: string = String(args[index]).toUpperCase();

        if (word === "EX") {
          expiresAt = Date.now() + Number(args[++index]) * 1000;
        } else if (word === "PX") {
          expiresAt = Date.now() + Number(args[++index]);
        } else if (word === "NX") {
          isOnlyIfAbsent = true;
        } else if (word === "XX") {
          isOnlyIfPresent = true;
        } else {
          throw new Error(`The in-memory Valkey has no SET ${word}.`);
        }
      }

      const existing: string | null = read(String(key));

      if (
        (isOnlyIfAbsent && existing !== null) ||
        (isOnlyIfPresent && existing === null)
      ) {
        return Promise.resolve(null);
      }

      store.set(String(key), { value: String(value), expiresAt: expiresAt });

      return Promise.resolve("OK");
    },
    del: (...args: Array<unknown>): Promise<number> => {
      let deleted: number = 0;

      for (const key of keysOf(args)) {
        if (read(key) !== null) {
          deleted++;
        }

        store.delete(key);
      }

      return Promise.resolve(deleted);
    },
    exists: (...args: Array<unknown>): Promise<number> => {
      return Promise.resolve(
        keysOf(args).filter((key: string): boolean => {
          return read(key) !== null;
        }).length,
      );
    },
    expire: (key: unknown, seconds: unknown): Promise<number> => {
      const entry: Entry | undefined = store.get(String(key));

      if (!entry || read(String(key)) === null) {
        return Promise.resolve(0);
      }

      entry.expiresAt = Date.now() + Number(seconds) * 1000;

      return Promise.resolve(1);
    },
    // Live updates of other servers: nobody listens here.
    publish: (): Promise<number> => {
      return Promise.resolve(0);
    },
  };

  const client: unknown = new Proxy(commands, {
    get: (
      target: Record<string, (...args: Array<unknown>) => unknown>,
      property: string | symbol,
    ): unknown => {
      if (typeof property === "symbol" || property === "then") {
        return undefined;
      }

      if (property === "status") {
        return "ready";
      }

      if (property in target) {
        return target[property];
      }

      return (): never => {
        throw new Error(`The in-memory Valkey has no ${property} command.`);
      };
    },
  });

  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return client;
      },
      isConnected: (): boolean => {
        return true;
      },
      getRedisOptions: (): Record<string, unknown> => {
        return {};
      },
      disconnect: (): Promise<void> => {
        return Promise.resolve();
      },
    },
    mockValkeyStore: store,
  };
});

import GlobalOIDCRouter from "../../../FeatureSet/Identity/API/GlobalOIDC";
import GlobalSSORouter from "../../../FeatureSet/Identity/API/GlobalSSO";
import OIDCRouter from "../../../FeatureSet/Identity/API/OIDC";
import SSORouter from "../../../FeatureSet/Identity/API/SSO";
import OIDCUtil from "../../../FeatureSet/Identity/Utils/OIDC";
import {
  PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
  PROVIDER_EMAIL_NOT_VERIFIED_TITLE,
} from "../../../FeatureSet/Identity/Utils/OidcEmailVerification";
import BrowserCookieJar from "./BrowserCookieJar";
import { TestIdp, startTestIdp } from "./OidcTestIdp";
import {
  SamlKeyPair,
  buildSamlResponse,
  generateRsaKeyPair,
  signElement,
  toBase64,
} from "./SamlTestKit";
import Entities from "Common/Models/DatabaseModels/Index";
import GlobalOIDC from "Common/Models/DatabaseModels/GlobalOidc";
import GlobalOIDCProject from "Common/Models/DatabaseModels/GlobalOidcProject";
import GlobalSSO from "Common/Models/DatabaseModels/GlobalSso";
import GlobalSSOProject from "Common/Models/DatabaseModels/GlobalSsoProject";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import AuditLogService from "Common/Server/Services/AuditLogService";
import GlobalOIDCService from "Common/Server/Services/GlobalOidcService";
import GlobalOIDCProjectService from "Common/Server/Services/GlobalOidcProjectService";
import GlobalSSOService from "Common/Server/Services/GlobalSsoService";
import GlobalSSOProjectService from "Common/Server/Services/GlobalSsoProjectService";
import ProjectOidcService from "Common/Server/Services/ProjectOidcService";
import ProjectSSOService from "Common/Server/Services/ProjectSsoService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
import UserSessionService from "Common/Server/Services/UserSessionService";
import FailedSignInAuditLog from "Common/Server/Utils/AuditLog/FailedSignInAuditLog";
import {
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressUrlEncoded,
  NextFunction,
  createExpressApp,
} from "Common/Server/Utils/Express";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import { CookieParser } from "Common/Tests/Server/TestingUtils/PasskeyHttpIntegration";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import CookieName from "Common/Types/CookieName";
import Email from "Common/Types/Email";
import Exception from "Common/Types/Exception/Exception";
import {
  SSO_INVITE_SCREEN_TITLE,
  SSO_NO_PROJECT_SCREEN_TITLE,
} from "Common/Types/HelpAndSupport/HelpAndSupport";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import DigestMethod from "Common/Types/SSO/DigestMethod";
import SignatureMethod from "Common/Types/SSO/SignatureMethod";
import { DataSource } from "Common/node_modules/typeorm";
import { EntityMetadata } from "Common/node_modules/typeorm/metadata/EntityMetadata";
import { RelationMetadata } from "Common/node_modules/typeorm/metadata/RelationMetadata";
import dns from "dns";
import http, { IncomingMessage } from "http";
import { AddressInfo } from "net";
import { Client, Issuer, custom } from "openid-client";

const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_SSO_AUTO_PROVISIONING_TESTS"] === "true"
    ? describe
    : describe.skip;

/*
 * Importing OIDCUtil installs the egress guard, which refuses loopback: the
 * provider here is on 127.0.0.1, so the suite opts out, as the other OIDC
 * suites do, and the clients the routes make are unhooked as they are made.
 */
custom.setHttpOptionsDefaults({ lookup: dns.lookup });

function removeEgressGuardHook(target: unknown): void {
  delete (target as Record<symbol, unknown>)[custom.http_options];
}

removeEgressGuardHook(Issuer);

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

// The server's public address, as its providers know it.
const APP_HOST: string = "oneuptime.example.com";
const SERVER: string = `http://${APP_HOST}`;

const CLIENT_ID: string = "6f1c2b8e-41d7-4f0a-9c55-0e7a3d2b9f11";
const CLIENT_SECRET: string = "Q7v8Q~entra-client-secret-0123456789abcdef";

// An Entra ID tenant, and the issuer its v2.0 tokens name.
const TENANT_ID: string = "72f988bf-86f1-41af-91ab-2d7cd011db47";

const SAML_ISSUER: string = `https://sts.windows.net/${TENANT_ID}/`;

/*
 * The tables the sign-ins read and write, and the ones the services read
 * beside them. Their many-to-many relations' junction tables are cloned too
 * (a provider's and an attachment's teams, a team permission's labels).
 */
const TABLES: Array<string> = [
  "User",
  "Project",
  "Team",
  "TeamMember",
  "TeamPermission",
  "Label",
  "GlobalOIDC",
  "GlobalOIDCProject",
  "GlobalSSO",
  "GlobalSSOProject",
  "ProjectOIDC",
  "ProjectSSO",
  "UserProjectSsoIdentity",
  "UserProjectSsoConsent",
];

/*
 * Fixtures written as rows: a project and its teams need nothing the sign-in
 * reads beyond their ids and names. Their other NOT NULL columns are
 * dropped; the tables the sign-ins write keep every constraint.
 */
const ROW_FIXTURE_TABLES: Array<string> = ["Project", "Team", "TeamPermission"];

// What the message page was asked to show, sent back as JSON by the stand-in.
interface ShownPage {
  view: string;
  title: string;
  message: string;
}

// One answer the browser got.
interface Answer {
  url: string;
  status: number;
  location: string | null;
  body: string;
}

// Where a whole sign-in ended.
interface Journey {
  answers: Array<Answer>;
  final: Answer;
  // The dashboard a sign-in that went through sends the browser to, or null.
  landedOn: string | null;
}

// A project and its teams, written as rows.
interface ProjectFixture {
  id: ObjectID;
  name: string;
  membersTeam: ObjectID;
  ownersTeam: ObjectID;
}

describePostgres(
  "single sign-on: whom it gives an account and which projects it adds them to (Postgres, #11149)",
  () => {
    const schema: string = `sso_provisioning_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    let database: DataSource;
    let server: http.Server;
    let appPort: number = 0;
    let idp: TestIdp;
    let samlKeys: SamlKeyPair;
    let clonedTables: Array<string> = [];

    // Every redirect URI the provider accepts: the providers each test makes.
    const registeredRedirectUris: Array<string> = [];

    // What the provider says of whoever signs in, set by each test.
    const idTokenClaims: JSONObject = {};
    const userInfo: JSONObject = {};

    // What the stand-ins were handed.
    const sessionsMade: Array<JSONObject> = [];
    const refusalsRecorded: Array<JSONObject> = [];
    const teamJoinsRecorded: Array<string> = [];
    const logLines: Array<{ level: string; text: string }> = [];

    const setClaims: (target: JSONObject, claims: JSONObject) => void = (
      target: JSONObject,
      claims: JSONObject,
    ): void => {
      for (const key of Object.keys(target)) {
        delete target[key];
      }

      Object.assign(target, claims);
    };

    /*
     * What Microsoft Entra ID's v2.0 ID token says of someone: no
     * email_verified, which Entra never sends, and the address in `email`.
     */
    const entraClaims: (data: {
      email: string;
      name: string;
    }) => JSONObject = (data: { email: string; name: string }): JSONObject => {
      return {
        ver: "2.0",
        tid: TENANT_ID,
        oid: ObjectID.generate().toString(),
        email: data.email,
        name: data.name,
        preferred_username: data.email,
      };
    };

    /*
     * ---------------------------------------------------------------------
     * The database.
     * ---------------------------------------------------------------------
     */

    const junctionTablesOf: (table: string) => Array<string> = (
      table: string,
    ): Array<string> => {
      const metadata: EntityMetadata | undefined =
        database.entityMetadatas.find((entity: EntityMetadata): boolean => {
          return entity.tableName === table;
        });

      if (!metadata) {
        throw new Error(`No entity has the table ${table}.`);
      }

      return metadata.relations
        .filter((relation: RelationMetadata): boolean => {
          return Boolean(relation.junctionEntityMetadata);
        })
        .flatMap((relation: RelationMetadata): Array<string> => {
          return [
            relation.junctionEntityMetadata!.tableName,
            relation.inverseEntityMetadata.tableName,
          ];
        });
    };

    const query: (
      statement: string,
      parameters?: Array<unknown>,
    ) => Promise<Array<Record<string, unknown>>> = async (
      statement: string,
      parameters?: Array<unknown>,
    ): Promise<Array<Record<string, unknown>>> => {
      return (await database.query(statement, parameters)) as Array<
        Record<string, unknown>
      >;
    };

    const makeProject: (name: string) => Promise<ProjectFixture> = async (
      name: string,
    ): Promise<ProjectFixture> => {
      const project: ProjectFixture = {
        id: ObjectID.generate(),
        name: name,
        membersTeam: ObjectID.generate(),
        ownersTeam: ObjectID.generate(),
      };

      await query(`INSERT INTO "Project" ("_id", "name") VALUES ($1, $2)`, [
        project.id.toString(),
        name,
      ]);

      for (const [teamId, teamName, permission] of [
        [project.ownersTeam, "Owners", "ProjectOwner"],
        [project.membersTeam, "Members", "ProjectMember"],
      ] as Array<[ObjectID, string, string]>) {
        await query(
          `INSERT INTO "Team" ("_id", "projectId", "name") VALUES ($1, $2, $3)`,
          [teamId.toString(), project.id.toString(), teamName],
        );

        await query(
          `INSERT INTO "TeamPermission" ("_id", "projectId", "teamId", "permission", "isBlockPermission") VALUES ($1, $2, $3, $4, false)`,
          [
            ObjectID.generate().toString(),
            project.id.toString(),
            teamId.toString(),
            permission,
          ],
        );
      }

      return project;
    };

    const teamOf: (id: ObjectID) => Team = (id: ObjectID): Team => {
      return new Team(id);
    };

    // An account a master admin made by hand: verified, in no project.
    const makeAccountByHand: (data: {
      email: string;
      name: string;
    }) => Promise<User> = async (data: {
      email: string;
      name: string;
    }): Promise<User> => {
      return await UserService.createByEmail({
        email: new Email(data.email),
        name: new Name(data.name),
        isEmailVerified: true,
        generateRandomPassword: true,
        props: { isRoot: true },
      });
    };

    // A membership a project gave someone before: accepted, in one team.
    const addMembership: (data: {
      userId: ObjectID;
      projectId: ObjectID;
      teamId: ObjectID;
    }) => Promise<void> = async (data: {
      userId: ObjectID;
      projectId: ObjectID;
      teamId: ObjectID;
    }): Promise<void> => {
      const membership: TeamMember = new TeamMember();
      membership.projectId = data.projectId;
      membership.teamId = data.teamId;
      membership.userId = data.userId;
      membership.hasAcceptedInvitation = true;
      membership.invitationAcceptedAt = new Date();

      await TeamMemberService.create({
        data: membership,
        props: { isRoot: true, ignoreHooks: true },
      });
    };

    const accountsAt: (email: string) => Promise<Array<User>> = async (
      email: string,
    ): Promise<Array<User>> => {
      return await UserService.findBy({
        query: { email: new Email(email) },
        select: {
          _id: true,
          email: true,
          name: true,
          isEmailVerified: true,
        },
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      });
    };

    interface Membership {
      projectId: string;
      teamId: string;
      hasAcceptedInvitation: boolean;
    }

    const membershipsOf: (
      userId: ObjectID,
    ) => Promise<Array<Membership>> = async (
      userId: ObjectID,
    ): Promise<Array<Membership>> => {
      const rows: Array<Record<string, unknown>> = await query(
        `SELECT "projectId", "teamId", "hasAcceptedInvitation" FROM "TeamMember" WHERE "userId" = $1 AND "deletedAt" IS NULL ORDER BY "projectId", "teamId"`,
        [userId.toString()],
      );

      return rows.map((row: Record<string, unknown>): Membership => {
        return {
          projectId: String(row["projectId"]),
          teamId: String(row["teamId"]),
          hasAcceptedInvitation: row["hasAcceptedInvitation"] === true,
        };
      });
    };

    const everyMembership: () => Promise<
      Array<Membership & { userId: string }>
    > = async (): Promise<Array<Membership & { userId: string }>> => {
      const rows: Array<Record<string, unknown>> = await query(
        `SELECT "userId", "projectId", "teamId", "hasAcceptedInvitation" FROM "TeamMember" WHERE "deletedAt" IS NULL`,
      );

      return rows.map(
        (row: Record<string, unknown>): Membership & { userId: string } => {
          return {
            userId: String(row["userId"]),
            projectId: String(row["projectId"]),
            teamId: String(row["teamId"]),
            hasAcceptedInvitation: row["hasAcceptedInvitation"] === true,
          };
        },
      );
    };

    const accountCount: () => Promise<number> = async (): Promise<number> => {
      const rows: Array<Record<string, unknown>> = await query(
        `SELECT count(*)::int AS "count" FROM "User"`,
      );

      return Number(rows[0]!["count"]);
    };

    /*
     * Whether the person may do anything in the project: the permissions
     * the real AccessTokenService works out from their memberships, or null
     * for someone who is not a member.
     */
    const hasProjectAccess: (
      userId: ObjectID,
      projectId: ObjectID,
    ) => Promise<boolean> = async (
      userId: ObjectID,
      projectId: ObjectID,
    ): Promise<boolean> => {
      return (
        (await AccessTokenService.refreshUserTenantAccessPermission(
          userId,
          projectId,
          { forgetLiveUpdateReaders: false },
        )) !== null
      );
    };

    /*
     * Whether the team lists the person among its members, as the on-call
     * escalations and notifications that name the team read it: by the
     * team alone, whatever project the membership says it is in
     * (TeamMemberService.getUsersInTeams).
     */
    const isOnTeam: (
      teamId: ObjectID,
      userId: ObjectID,
    ) => Promise<boolean> = async (
      teamId: ObjectID,
      userId: ObjectID,
    ): Promise<boolean> => {
      const users: Array<User> = await TeamMemberService.getUsersInTeams(
        [teamId],
        { acceptedOnly: true },
      );

      return users.some((user: User): boolean => {
        return user.id?.toString() === userId.toString();
      });
    };

    /*
     * ---------------------------------------------------------------------
     * The providers, saved as their services save them.
     * ---------------------------------------------------------------------
     */

    const makeGlobalOidc: (data?: {
      disableSignUpWithSso?: boolean | undefined;
      restrictToAttachedProjects?: boolean | undefined;
    }) => Promise<ObjectID> = async (data?: {
      disableSignUpWithSso?: boolean | undefined;
      restrictToAttachedProjects?: boolean | undefined;
    }): Promise<ObjectID> => {
      const provider: GlobalOIDC = new GlobalOIDC();
      provider.id = ObjectID.generate();
      provider.name = "Contoso Entra ID";
      provider.description = "Sign in with Contoso Entra ID";
      provider.discoveryURL = URL.fromString(
        `${idp.issuerUrl}/.well-known/openid-configuration`,
      );
      provider.issuerURL = idp.issuerUrl;
      provider.clientId = CLIENT_ID;
      provider.clientSecret = CLIENT_SECRET;
      provider.scopes = "openid email profile";
      provider.emailClaimName = "email";
      provider.nameClaimName = "name";
      // The two questions of the report: "Get one", "Every project".
      provider.disableSignUpWithSso = data?.disableSignUpWithSso ?? false;
      provider.restrictToAttachedProjects =
        data?.restrictToAttachedProjects ?? false;
      provider.isEnabled = true;

      await GlobalOIDCService.create({
        data: provider,
        props: { isRoot: true, ignoreHooks: true },
      });

      registeredRedirectUris.push(
        `${SERVER}/identity/global-oidc-callback/${provider.id.toString()}`,
      );

      return provider.id;
    };

    /*
     * A project attached to the server's own OpenID Connect provider, as the
     * Admin Dashboard's Attach saves it. Saved here without the save's
     * checks, so a test can write an attachment saved before them.
     */
    const attachToGlobalOidc: (data: {
      providerId: ObjectID;
      projectId: ObjectID;
      teams: Array<ObjectID>;
      isEnabled?: boolean | undefined;
    }) => Promise<void> = async (data: {
      providerId: ObjectID;
      projectId: ObjectID;
      teams: Array<ObjectID>;
      isEnabled?: boolean | undefined;
    }): Promise<void> => {
      const attachment: GlobalOIDCProject = new GlobalOIDCProject();
      attachment.globalOidcId = data.providerId;
      attachment.projectId = data.projectId;
      attachment.teams = data.teams.map(teamOf);
      attachment.isEnabled = data.isEnabled ?? true;

      await GlobalOIDCProjectService.create({
        data: attachment,
        props: { isRoot: true, ignoreHooks: true },
      });
    };

    const makeProjectOidc: (data: {
      projectId: ObjectID;
      teams: Array<ObjectID>;
    }) => Promise<ObjectID> = async (data: {
      projectId: ObjectID;
      teams: Array<ObjectID>;
    }): Promise<ObjectID> => {
      const provider: ProjectOIDC = new ProjectOIDC();
      provider.id = ObjectID.generate();
      provider.projectId = data.projectId;
      provider.name = "Contoso Entra ID";
      provider.description = "Sign in with Contoso Entra ID";
      provider.discoveryURL = URL.fromString(
        `${idp.issuerUrl}/.well-known/openid-configuration`,
      );
      provider.issuerURL = idp.issuerUrl;
      provider.clientId = CLIENT_ID;
      provider.clientSecret = CLIENT_SECRET;
      provider.scopes = "openid email profile";
      provider.emailClaimName = "email";
      provider.nameClaimName = "name";
      provider.teams = data.teams.map(teamOf);
      provider.isEnabled = true;

      await ProjectOidcService.create({
        data: provider,
        props: { isRoot: true, ignoreHooks: true },
      });

      registeredRedirectUris.push(
        `${SERVER}/identity/oidc-callback/${data.projectId.toString()}/${provider.id.toString()}`,
      );

      return provider.id;
    };

    const makeGlobalSaml: (data?: {
      disableSignUpWithSso?: boolean | undefined;
    }) => Promise<ObjectID> = async (data?: {
      disableSignUpWithSso?: boolean | undefined;
    }): Promise<ObjectID> => {
      const provider: GlobalSSO = new GlobalSSO();
      provider.id = ObjectID.generate();
      provider.name = "Contoso Entra ID (SAML)";
      provider.description = "Sign in with Contoso Entra ID (SAML)";
      provider.signatureMethod = SignatureMethod.SHA256;
      provider.digestMethod = DigestMethod.SHA256;
      provider.signOnURL = URL.fromString(
        `https://login.microsoftonline.com/${TENANT_ID}/saml2`,
      );
      provider.issuerURL = SAML_ISSUER;
      provider.publicCertificate = samlKeys.publicKey;
      provider.disableSignUpWithSso = data?.disableSignUpWithSso ?? false;
      provider.restrictToAttachedProjects = false;
      provider.isEnabled = true;

      await GlobalSSOService.create({
        data: provider,
        props: { isRoot: true, ignoreHooks: true },
      });

      return provider.id;
    };

    const attachToGlobalSaml: (data: {
      providerId: ObjectID;
      projectId: ObjectID;
      teams: Array<ObjectID>;
    }) => Promise<void> = async (data: {
      providerId: ObjectID;
      projectId: ObjectID;
      teams: Array<ObjectID>;
    }): Promise<void> => {
      const attachment: GlobalSSOProject = new GlobalSSOProject();
      attachment.globalSsoId = data.providerId;
      attachment.projectId = data.projectId;
      attachment.teams = data.teams.map(teamOf);
      attachment.isEnabled = true;

      await GlobalSSOProjectService.create({
        data: attachment,
        props: { isRoot: true, ignoreHooks: true },
      });
    };

    const makeProjectSaml: (data: {
      projectId: ObjectID;
      teams: Array<ObjectID>;
    }) => Promise<ObjectID> = async (data: {
      projectId: ObjectID;
      teams: Array<ObjectID>;
    }): Promise<ObjectID> => {
      const provider: ProjectSSO = new ProjectSSO();
      provider.id = ObjectID.generate();
      provider.projectId = data.projectId;
      provider.name = "Contoso Entra ID (SAML)";
      provider.description = "Sign in with Contoso Entra ID (SAML)";
      provider.signatureMethod = SignatureMethod.SHA256;
      provider.digestMethod = DigestMethod.SHA256;
      provider.signOnURL = URL.fromString(
        `https://login.microsoftonline.com/${TENANT_ID}/saml2`,
      );
      provider.issuerURL = SAML_ISSUER;
      provider.publicCertificate = samlKeys.publicKey;
      provider.teams = data.teams.map(teamOf);
      provider.isEnabled = true;

      await ProjectSSOService.create({
        data: provider,
        props: { isRoot: true, ignoreHooks: true },
      });

      return provider.id;
    };

    /*
     * ---------------------------------------------------------------------
     * The browser.
     * ---------------------------------------------------------------------
     */

    let jar: BrowserCookieJar = new BrowserCookieJar(APP_HOST);

    /*
     * One request, as a browser sends it: OneUptime's host is this server,
     * on its loopback port; any other address is reached as it is.
     */
    const send: (data: {
      method: "GET" | "POST";
      url: string;
      form?: Record<string, string> | undefined;
    }) => Promise<Answer> = (data: {
      method: "GET" | "POST";
      url: string;
      form?: Record<string, string> | undefined;
    }): Promise<Answer> => {
      const target: globalThis.URL = new globalThis.URL(data.url);
      const isOneUptime: boolean = target.hostname === APP_HOST;
      const body: string | null = data.form
        ? new URLSearchParams(data.form).toString()
        : null;

      const headers: Record<string, string> = {
        host: target.host,
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      };

      if (isOneUptime) {
        const cookies: Record<string, string> = jar.cookiesFor(
          target.pathname,
          { isHttps: false },
        ) as Record<string, string>;
        const cookieHeader: string = Object.entries(cookies)
          .map(([name, value]: [string, string]): string => {
            return `${name}=${value}`;
          })
          .join("; ");

        if (cookieHeader) {
          headers["cookie"] = cookieHeader;
        }
      }

      if (body !== null) {
        headers["content-type"] = "application/x-www-form-urlencoded";
        headers["content-length"] = Buffer.byteLength(body).toString();
      }

      return new Promise<Answer>(
        (
          resolve: (answer: Answer) => void,
          reject: (error: Error) => void,
        ): void => {
          const request: http.ClientRequest = http.request(
            {
              host: isOneUptime ? "127.0.0.1" : target.hostname,
              port: isOneUptime ? appPort : Number(target.port),
              method: data.method,
              path: `${target.pathname}${target.search}`,
              headers: headers,
            },
            (response: IncomingMessage): void => {
              let text: string = "";

              response.on("data", (chunk: Buffer): void => {
                text += chunk.toString();
              });

              response.on("end", (): void => {
                const setCookies: Array<string> =
                  response.headers["set-cookie"] || [];

                if (isOneUptime) {
                  jar.take(setCookies, {
                    isHttps: false,
                    requestPath: target.pathname,
                  });
                }

                const location: string | undefined =
                  response.headers["location"];

                resolve({
                  url: data.url,
                  status: response.statusCode || 0,
                  location: location
                    ? new globalThis.URL(location, data.url).toString()
                    : null,
                  body: text,
                });
              });
            },
          );

          request.on("error", reject);

          if (body !== null) {
            request.write(body);
          }

          request.end();
        },
      );
    };

    // A request and every redirect after it, until a page or the dashboard.
    const browse: (data: {
      method: "GET" | "POST";
      url: string;
      form?: Record<string, string> | undefined;
    }) => Promise<Journey> = async (data: {
      method: "GET" | "POST";
      url: string;
      form?: Record<string, string> | undefined;
    }): Promise<Journey> => {
      const answers: Array<Answer> = [];
      let answer: Answer = await send(data);
      answers.push(answer);

      while (
        [301, 302, 303, 307, 308].includes(answer.status) &&
        answer.location
      ) {
        const next: globalThis.URL = new globalThis.URL(answer.location);

        // The dashboard is another app: a sign-in that gets there went through.
        if (
          next.hostname === APP_HOST &&
          next.pathname.startsWith("/dashboard")
        ) {
          return { answers, final: answer, landedOn: answer.location };
        }

        if (answers.length > 10) {
          throw new Error(`Too many redirects, the last to ${answer.location}`);
        }

        answer = await send({ method: "GET", url: answer.location });
        answers.push(answer);
      }

      return { answers, final: answer, landedOn: null };
    };

    // The page a sign-in that did not go through was shown.
    const pageOf: (journey: Journey) => ShownPage = (
      journey: Journey,
    ): ShownPage => {
      expect(journey.landedOn).toBeNull();
      expect(journey.final.status).toBe(200);

      return JSON.parse(journey.final.body) as ShownPage;
    };

    const signInWithGlobalOidc: (
      providerId: ObjectID,
    ) => Promise<Journey> = async (providerId: ObjectID): Promise<Journey> => {
      return await browse({
        method: "GET",
        url: `${SERVER}/identity/global-oidc/${providerId.toString()}`,
      });
    };

    const signInWithProjectOidc: (
      projectId: ObjectID,
      providerId: ObjectID,
    ) => Promise<Journey> = async (
      projectId: ObjectID,
      providerId: ObjectID,
    ): Promise<Journey> => {
      return await browse({
        method: "GET",
        url: `${SERVER}/identity/oidc/${projectId.toString()}/${providerId.toString()}`,
      });
    };

    let samlResponseCounter: number = 0;

    /*
     * A response the identity provider signed for the provider at
     * `entityId`, sent to its Reply URL: IdP-initiated, as Entra ID's My Apps
     * sends it.
     */
    const postSamlResponse: (data: {
      replyUrl: string;
      entityId: string;
      email: string;
      name: string;
    }) => Promise<Journey> = async (data: {
      replyUrl: string;
      entityId: string;
      email: string;
      name: string;
    }): Promise<Journey> => {
      samlResponseCounter++;

      const samlResponse: string = toBase64(
        signElement(
          buildSamlResponse({
            issuer: SAML_ISSUER,
            email: data.email,
            displayName: data.name,
            issuedAt: new Date(),
            responseId: `_response_${samlResponseCounter}_${ObjectID.generate().toString()}`,
            assertionId: `_assertion_${samlResponseCounter}_${ObjectID.generate().toString()}`,
            audienceRestrictions: [[data.entityId]],
            recipient: data.replyUrl,
            destination: data.replyUrl,
            inResponseTo: null,
          }),
          "Assertion",
          samlKeys.privateKey,
        ),
      );

      return await browse({
        method: "POST",
        url: data.replyUrl,
        form: { SAMLResponse: samlResponse },
      });
    };

    const signInWithGlobalSaml: (data: {
      providerId: ObjectID;
      email: string;
      name: string;
    }) => Promise<Journey> = async (data: {
      providerId: ObjectID;
      email: string;
      name: string;
    }): Promise<Journey> => {
      return await postSamlResponse({
        replyUrl: `${SERVER}/identity/global-idp-login/${data.providerId.toString()}`,
        entityId: `${SERVER}/global-sso/${data.providerId.toString()}`,
        email: data.email,
        name: data.name,
      });
    };

    const signInWithProjectSaml: (data: {
      projectId: ObjectID;
      providerId: ObjectID;
      email: string;
      name: string;
    }) => Promise<Journey> = async (data: {
      projectId: ObjectID;
      providerId: ObjectID;
      email: string;
      name: string;
    }): Promise<Journey> => {
      return await postSamlResponse({
        replyUrl: `${SERVER}/identity/idp-login/${data.projectId.toString()}/${data.providerId.toString()}`,
        entityId: `${SERVER}/${data.projectId.toString()}/${data.providerId.toString()}`,
        email: data.email,
        name: data.name,
      });
    };

    // The person a sign-in that went through signed in, by their user-token.
    const signedInUserId: () => string | null = (): string | null => {
      const token: string | undefined = jar.cookie(CookieName.Token)?.value;

      if (!token) {
        return null;
      }

      return String(
        (JSONWebToken.decodeJsonPayload(token) as JSONObject)["userId"],
      );
    };

    // The projects a project-scoped SSO cookie the browser keeps names.
    const projectSsoCookies: () => Array<string> = (): Array<string> => {
      return jar
        .all()
        .filter((cookie: { name: string }): boolean => {
          return (
            cookie.name.startsWith("sso-") &&
            cookie.name !== CookieName.GlobalSSOToken
          );
        })
        .map((cookie: { name: string; value: string }): string => {
          const projectId: unknown = (
            JSONWebToken.decodeJsonPayload(cookie.value) as JSONObject
          )["projectId"];

          // The cookie's name and the project its token is for agree.
          expect(cookie.name).toBe(`sso-${String(projectId)}`);

          return String(projectId);
        });
    };

    const expectSignedIn: (journey: Journey, userId: ObjectID) => void = (
      journey: Journey,
      userId: ObjectID,
    ): void => {
      expect(journey.landedOn).not.toBeNull();
      expect(signedInUserId()).toBe(userId.toString());
      expect(sessionsMade).toHaveLength(1);
      expect(String(sessionsMade[0]!["userId"])).toBe(userId.toString());
    };

    const expectNobodySignedIn: (journey: Journey) => void = (
      journey: Journey,
    ): void => {
      expect(journey.landedOn).toBeNull();
      expect(jar.cookie(CookieName.Token)).toBeUndefined();
      expect(jar.cookie(CookieName.GlobalSSOToken)).toBeUndefined();
      expect(projectSsoCookies()).toEqual([]);
      expect(sessionsMade).toEqual([]);
    };

    const loggedLines: (level: string) => Array<string> = (
      level: string,
    ): Array<string> => {
      return logLines
        .filter((line: { level: string }): boolean => {
          return line.level === level;
        })
        .map((line: { text: string }): string => {
          return line.text;
        });
    };

    /*
     * ---------------------------------------------------------------------
     * Set up, once.
     * ---------------------------------------------------------------------
     */

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["SSO_AUTO_PROVISIONING_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["SSO_AUTO_PROVISIONING_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["SSO_AUTO_PROVISIONING_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      const tables: Set<string> = new Set<string>(TABLES);

      for (const table of TABLES) {
        for (const related of junctionTablesOf(table)) {
          tables.add(related);
        }
      }

      clonedTables = Array.from(tables);

      for (const table of clonedTables) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      for (const table of ROW_FIXTURE_TABLES) {
        const columns: Array<Record<string, unknown>> = await query(
          `SELECT c.column_name FROM information_schema.columns c
           WHERE c.table_schema = $1 AND c.table_name = $2 AND c.is_nullable = 'NO'
             AND c.column_name <> '_id' AND c.column_default IS NULL`,
          [schema, table],
        );

        for (const column of columns) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${String(column["column_name"])}" DROP NOT NULL`,
          );
        }
      }

      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);

      samlKeys = generateRsaKeyPair();

      idp = await startTestIdp({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        registeredRedirectUris: registeredRedirectUris,
        idTokenClaims: idTokenClaims,
        userInfo: userInfo,
      });

      // The single sign-on routes, under /identity as the server serves them.
      const app: ExpressApplication = createExpressApp();
      app.use(CookieParser());
      app.use(ExpressUrlEncoded({ extended: true }));
      app.use(ExpressJson());

      for (const router of [
        OIDCRouter,
        GlobalOIDCRouter,
        SSORouter,
        GlobalSSORouter,
      ]) {
        app.use("/identity", router);
      }

      app.use(
        (
          err: Exception,
          req: ExpressRequest,
          res: ExpressResponse,
          _next: NextFunction,
        ): void => {
          Response.sendErrorResponse(req, res, err);
        },
      );

      server = http.createServer(app);

      await new Promise<void>((resolve: () => void) => {
        server.listen(0, "127.0.0.1", resolve);
      });

      appPort = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve: () => void) => {
          server.close(() => {
            resolve();
          });
        });
      }

      if (idp) {
        await idp.close();
      }

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      // A self-hosted server: what the report's is.
      setTestBillingEnabled(false);

      await database.query(
        `TRUNCATE TABLE ${clonedTables
          .map((table: string): string => {
            return `"${schema}"."${table}"`;
          })
          .join(", ")}`,
      );

      (
        jest.requireMock("Common/Server/Infrastructure/Redis") as {
          mockValkeyStore: Map<string, unknown>;
        }
      ).mockValkeyStore.clear();

      jar = new BrowserCookieJar(APP_HOST);
      registeredRedirectUris.length = 0;
      setClaims(idTokenClaims, {});
      setClaims(userInfo, { sub: "00u1a2b3c4D5E6F7g8h9" });

      sessionsMade.length = 0;
      refusalsRecorded.length = 0;
      teamJoinsRecorded.length = 0;
      logLines.length = 0;

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      for (const level of ["debug", "info", "warn", "error"] as const) {
        jest
          .spyOn(logger, level)
          .mockImplementation((...args: Array<unknown>): void => {
            const message: unknown = args[0];

            logLines.push({
              level: level,
              text:
                message instanceof Error ? message.message : String(message),
            });
          });
      }

      // The clients the routes make are on loopback too: unhook them.
      const createClient: typeof OIDCUtil.createClient = (
        jest.requireActual("../../../FeatureSet/Identity/Utils/OIDC") as {
          default: typeof OIDCUtil;
        }
      ).default.createClient;

      jest
        .spyOn(OIDCUtil, "createClient")
        .mockImplementation(
          async (
            config: Parameters<typeof OIDCUtil.createClient>[0],
          ): Promise<Client> => {
            const client: Client = await createClient.call(OIDCUtil, config);
            removeEgressGuardHook(client);
            removeEgressGuardHook(client.issuer);
            return client;
          },
        );

      // Where a sign-in that went through lands: this server's dashboard.
      jest
        .spyOn(DatabaseConfig, "getHost")
        .mockResolvedValue(Hostname.fromString(APP_HOST));
      jest
        .spyOn(DatabaseConfig, "getHttpProtocol")
        .mockResolvedValue(Protocol.HTTP);

      jest
        .spyOn(UserSessionService, "createSession")
        .mockImplementation(
          async (
            data: Parameters<typeof UserSessionService.createSession>[0],
          ) => {
            sessionsMade.push({
              userId: data.userId.toString(),
              signIn: data.signIn as unknown as JSONObject,
            });

            return {
              session: { id: ObjectID.generate() },
              refreshToken: "refresh-token",
              refreshTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
              accessTokenExpiresInSeconds: 900,
              ssoSignInExpiresInSeconds: 3600,
              signedInAt: new Date(),
              lastActiveAt: new Date(),
            } as unknown as Awaited<
              ReturnType<typeof UserSessionService.createSession>
            >;
          },
        );

      jest
        .spyOn(AuditLogService, "recordCreate")
        .mockImplementation(async (data: { createdItem: unknown }) => {
          teamJoinsRecorded.push(
            String((data.createdItem as { teamId?: ObjectID }).teamId),
          );
        });

      jest
        .spyOn(FailedSignInAuditLog, "record")
        .mockImplementation(
          (data: Parameters<typeof FailedSignInAuditLog.record>[0]) => {
            refusalsRecorded.push({
              userId: data.userId.toString(),
              reason: data.reason,
            });
          },
        );

      // The message page, as its title and message.
      jest
        .spyOn(Response, "render")
        .mockImplementation(
          (
            _req: ExpressRequest,
            res: ExpressResponse,
            view: string,
            variables: JSONObject,
          ): void => {
            res.status(200).json({ view: view, ...variables });
          },
        );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /*
     * ---------------------------------------------------------------------
     * The server's own OpenID Connect provider (Global OIDC).
     * ---------------------------------------------------------------------
     */

    describe("the server's own OpenID Connect provider", () => {
      test("with no project attached, someone new is turned away and no account is made: the reported case, now said in the server's log", async () => {
        const providerId: ObjectID = await makeGlobalOidc();
        await makeProject("Platform");

        setClaims(
          idTokenClaims,
          entraClaims({ email: "megan@contoso.example", name: "Megan Bowen" }),
        );

        const journey: Journey = await signInWithGlobalOidc(providerId);

        expect(pageOf(journey).title).toBe(SSO_INVITE_SCREEN_TITLE);
        expectNobodySignedIn(journey);
        expect(await accountsAt("megan@contoso.example")).toEqual([]);
        expect(await accountCount()).toBe(0);
        expect(await everyMembership()).toEqual([]);

        // The sign-in itself went through the provider: a code, redeemed once.
        expect(idp.authorizationRequests).toHaveLength(1);
        expect(idp.tokenRequests).toHaveLength(1);

        /*
         * The person is told only that they need an invitation. Whoever
         * reads the server's log is told why, and what would let them in.
         */
        const told: Array<string> = loggedLines("info").filter(
          (line: string): boolean => {
            return line.includes(providerId.toString());
          },
        );

        expect(told).toHaveLength(1);
        expect(told[0]).toContain("Contoso Entra ID");
        expect(told[0]).toContain("no project is attached to it");
        expect(told[0]).toContain("Attached Projects");
        // Nobody is named in it.
        expect(told[0]).not.toContain("megan@contoso.example");
      });

      test("with no project attached, an account made by hand joins no project, and is told it needs an invitation", async () => {
        const providerId: ObjectID = await makeGlobalOidc();
        await makeProject("Platform");
        const account: User = await makeAccountByHand({
          email: "adele@contoso.example",
          name: "Adele Vance",
        });

        setClaims(
          idTokenClaims,
          entraClaims({ email: "adele@contoso.example", name: "Adele Vance" }),
        );

        const journey: Journey = await signInWithGlobalOidc(providerId);

        expect(pageOf(journey).title).toBe(SSO_NO_PROJECT_SCREEN_TITLE);
        expectNobodySignedIn(journey);
        expect(await membershipsOf(account.id!)).toEqual([]);
      });

      test("with a project attached, someone new gets an account and joins its teams, and may do what those teams may there, and nothing anywhere else", async () => {
        const providerId: ObjectID = await makeGlobalOidc();
        const platform: ProjectFixture = await makeProject("Platform");
        const payments: ProjectFixture = await makeProject("Payments");

        await attachToGlobalOidc({
          providerId: providerId,
          projectId: platform.id,
          teams: [platform.membersTeam],
        });

        setClaims(
          idTokenClaims,
          entraClaims({ email: "Megan@Contoso.example", name: "Megan Bowen" }),
        );

        const journey: Journey = await signInWithGlobalOidc(providerId);

        const accounts: Array<User> = await accountsAt("megan@contoso.example");
        expect(accounts).toHaveLength(1);

        const account: User = accounts[0]!;
        expect(account.name?.toString()).toBe("Megan Bowen");
        expect(account.isEmailVerified).toBe(true);

        expectSignedIn(journey, account.id!);
        expect(journey.landedOn).toBe(`${SERVER}/dashboard`);

        // One Global SSO sign-in, for every project they belong to.
        expect(jar.cookie(CookieName.GlobalSSOToken)).toBeDefined();
        expect(projectSsoCookies()).toEqual([]);

        expect(await membershipsOf(account.id!)).toEqual([
          {
            projectId: platform.id.toString(),
            teamId: platform.membersTeam.toString(),
            hasAcceptedInvitation: true,
          },
        ]);
        expect(teamJoinsRecorded).toEqual([platform.membersTeam.toString()]);

        expect(await hasProjectAccess(account.id!, platform.id)).toBe(true);
        expect(await hasProjectAccess(account.id!, payments.id)).toBe(false);
        // On the team they joined, as its on-call reads it; on no other.
        expect(await isOnTeam(platform.membersTeam, account.id!)).toBe(true);
        expect(await isOnTeam(payments.membersTeam, account.id!)).toBe(false);

        // The PKCE verifier the token endpoint took answered the challenge.
        expect(idp.tokenRequests[0]!.codeVerifier).toBeTruthy();
      });

      test("with a project attached, an account made by hand joins it on its next sign-in", async () => {
        const providerId: ObjectID = await makeGlobalOidc();
        const platform: ProjectFixture = await makeProject("Platform");
        const account: User = await makeAccountByHand({
          email: "adele@contoso.example",
          name: "Adele Vance",
        });

        await attachToGlobalOidc({
          providerId: providerId,
          projectId: platform.id,
          teams: [platform.membersTeam],
        });

        setClaims(
          idTokenClaims,
          entraClaims({ email: "adele@contoso.example", name: "Adele Vance" }),
        );

        const journey: Journey = await signInWithGlobalOidc(providerId);

        expectSignedIn(journey, account.id!);
        expect(await accountCount()).toBe(1);
        expect(await membershipsOf(account.id!)).toEqual([
          {
            projectId: platform.id.toString(),
            teamId: platform.membersTeam.toString(),
            hasAcceptedInvitation: true,
          },
        ]);
        expect(await hasProjectAccess(account.id!, platform.id)).toBe(true);
      });

      test("someone already in an attached project keeps the teams they have there, and joins the other attached projects", async () => {
        const providerId: ObjectID = await makeGlobalOidc();
        const platform: ProjectFixture = await makeProject("Platform");
        const payments: ProjectFixture = await makeProject("Payments");
        const account: User = await makeAccountByHand({
          email: "adele@contoso.example",
          name: "Adele Vance",
        });

        // An owner of Platform already.
        await addMembership({
          userId: account.id!,
          projectId: platform.id,
          teamId: platform.ownersTeam,
        });

        for (const project of [platform, payments]) {
          await attachToGlobalOidc({
            providerId: providerId,
            projectId: project.id,
            teams: [project.membersTeam],
          });
        }

        setClaims(
          idTokenClaims,
          entraClaims({ email: "adele@contoso.example", name: "Adele Vance" }),
        );

        expectSignedIn(await signInWithGlobalOidc(providerId), account.id!);

        const memberships: Array<Membership> = await membershipsOf(account.id!);

        expect(memberships).toHaveLength(2);
        expect(memberships).toEqual(
          expect.arrayContaining([
            {
              projectId: platform.id.toString(),
              teamId: platform.ownersTeam.toString(),
              hasAcceptedInvitation: true,
            },
            {
              projectId: payments.id.toString(),
              teamId: payments.membersTeam.toString(),
              hasAcceptedInvitation: true,
            },
          ]),
        );
      });

      test("an attached project with no teams makes no account it could put nowhere", async () => {
        const providerId: ObjectID = await makeGlobalOidc();
        const platform: ProjectFixture = await makeProject("Platform");

        await attachToGlobalOidc({
          providerId: providerId,
          projectId: platform.id,
          teams: [],
        });

        setClaims(
          idTokenClaims,
          entraClaims({ email: "megan@contoso.example", name: "Megan Bowen" }),
        );

        const journey: Journey = await signInWithGlobalOidc(providerId);

        expect(pageOf(journey).title).toBe(SSO_INVITE_SCREEN_TITLE);
        expectNobodySignedIn(journey);
        expect(await accountCount()).toBe(0);
        expect(await everyMembership()).toEqual([]);
        expect(
          loggedLines("info").some((line: string): boolean => {
            return line.includes("none of its attached projects has teams");
          }),
        ).toBe(true);
      });

      test("an attachment naming another project's team - saved before teams were held to their project - adds nobody to that team or that project", async () => {
        const providerId: ObjectID = await makeGlobalOidc();
        const platform: ProjectFixture = await makeProject("Platform");
        const payments: ProjectFixture = await makeProject("Payments");

        // Platform's attachment names its own members team and Payments' owners.
        await attachToGlobalOidc({
          providerId: providerId,
          projectId: platform.id,
          teams: [platform.membersTeam, payments.ownersTeam],
        });

        setClaims(
          idTokenClaims,
          entraClaims({ email: "megan@contoso.example", name: "Megan Bowen" }),
        );

        const journey: Journey = await signInWithGlobalOidc(providerId);
        const account: User = (await accountsAt("megan@contoso.example"))[0]!;

        expectSignedIn(journey, account.id!);

        // Platform's members team only: no row in a team of Payments.
        expect(await everyMembership()).toEqual([
          {
            userId: account.id!.toString(),
            projectId: platform.id.toString(),
            teamId: platform.membersTeam.toString(),
            hasAcceptedInvitation: true,
          },
        ]);
        expect(await hasProjectAccess(account.id!, payments.id)).toBe(false);
        // Not on the other project's team: its on-call and notifications.
        expect(await isOnTeam(payments.ownersTeam, account.id!)).toBe(false);
        expect(
          loggedLines("warn").some((line: string): boolean => {
            return line.includes("not teams of that project");
          }),
        ).toBe(true);
      });

      test("an attachment naming only another project's team makes no account, and adds nobody to anything", async () => {
        const providerId: ObjectID = await makeGlobalOidc();
        const platform: ProjectFixture = await makeProject("Platform");
        const payments: ProjectFixture = await makeProject("Payments");

        await attachToGlobalOidc({
          providerId: providerId,
          projectId: platform.id,
          teams: [payments.ownersTeam],
        });

        setClaims(
          idTokenClaims,
          entraClaims({ email: "megan@contoso.example", name: "Megan Bowen" }),
        );

        const journey: Journey = await signInWithGlobalOidc(providerId);

        expect(pageOf(journey).title).toBe(SSO_INVITE_SCREEN_TITLE);
        expectNobodySignedIn(journey);
        expect(await accountCount()).toBe(0);
        expect(await everyMembership()).toEqual([]);
      });

      test('"Must be invited first" makes no account, even with a project attached', async () => {
        const providerId: ObjectID = await makeGlobalOidc({
          disableSignUpWithSso: true,
        });
        const platform: ProjectFixture = await makeProject("Platform");

        await attachToGlobalOidc({
          providerId: providerId,
          projectId: platform.id,
          teams: [platform.membersTeam],
        });

        setClaims(
          idTokenClaims,
          entraClaims({ email: "megan@contoso.example", name: "Megan Bowen" }),
        );

        const journey: Journey = await signInWithGlobalOidc(providerId);

        expect(pageOf(journey).title).toBe(SSO_INVITE_SCREEN_TITLE);
        expectNobodySignedIn(journey);
        expect(await accountCount()).toBe(0);
        expect(
          loggedLines("info").some((line: string): boolean => {
            return line.includes('"Must be invited first"');
          }),
        ).toBe(true);
      });

      test('"Attached projects only" with every attachment off signs nobody in to a session every request would refuse', async () => {
        const providerId: ObjectID = await makeGlobalOidc({
          restrictToAttachedProjects: true,
        });
        const platform: ProjectFixture = await makeProject("Platform");
        const payments: ProjectFixture = await makeProject("Payments");
        const account: User = await makeAccountByHand({
          email: "adele@contoso.example",
          name: "Adele Vance",
        });

        await addMembership({
          userId: account.id!,
          projectId: payments.id,
          teamId: payments.membersTeam,
        });

        // Platform's attachment, turned off: the provider counts in no project.
        await attachToGlobalOidc({
          providerId: providerId,
          projectId: platform.id,
          teams: [platform.membersTeam],
          isEnabled: false,
        });

        setClaims(
          idTokenClaims,
          entraClaims({ email: "adele@contoso.example", name: "Adele Vance" }),
        );

        const journey: Journey = await signInWithGlobalOidc(providerId);

        expect(pageOf(journey).title).toBe("No project access.");
        expectNobodySignedIn(journey);
        expect(await membershipsOf(account.id!)).toEqual([
          {
            projectId: payments.id.toString(),
            teamId: payments.membersTeam.toString(),
            hasAcceptedInvitation: true,
          },
        ]);
      });

      describe("an address the provider has not verified, or none at all, makes and signs in no account", () => {
        test.each([false, "false", 0, "maybe"])(
          "email_verified %j: nobody new, nobody linked, nothing joined",
          async (emailVerified: boolean | string | number) => {
            const providerId: ObjectID = await makeGlobalOidc();
            const platform: ProjectFixture = await makeProject("Platform");
            const account: User = await makeAccountByHand({
              email: "adele@contoso.example",
              name: "Adele Vance",
            });

            await attachToGlobalOidc({
              providerId: providerId,
              projectId: platform.id,
              teams: [platform.membersTeam],
            });

            for (const email of [
              "adele@contoso.example",
              "megan@contoso.example",
            ]) {
              jar = new BrowserCookieJar(APP_HOST);
              sessionsMade.length = 0;

              setClaims(idTokenClaims, {
                ...entraClaims({ email: email, name: "Someone" }),
                email_verified: emailVerified,
              });

              const journey: Journey = await signInWithGlobalOidc(providerId);

              expect(pageOf(journey)).toEqual({
                view: expect.any(String),
                title: PROVIDER_EMAIL_NOT_VERIFIED_TITLE,
                message: PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
              });
              expectNobodySignedIn(journey);
            }

            // The account made by hand is as it was; nobody else was made.
            expect(await accountCount()).toBe(1);
            expect(await everyMembership()).toEqual([]);
            expect(await membershipsOf(account.id!)).toEqual([]);
            expect(refusalsRecorded).toEqual([
              {
                userId: account.id!.toString(),
                reason: expect.any(String),
              },
            ]);
          },
        );

        test("no address in the ID token or from userinfo: nobody made, nothing joined", async () => {
          const providerId: ObjectID = await makeGlobalOidc();
          const platform: ProjectFixture = await makeProject("Platform");

          await attachToGlobalOidc({
            providerId: providerId,
            projectId: platform.id,
            teams: [platform.membersTeam],
          });

          const claims: JSONObject = entraClaims({
            email: "megan@contoso.example",
            name: "Megan Bowen",
          });
          delete claims["email"];
          setClaims(idTokenClaims, claims);

          const journey: Journey = await signInWithGlobalOidc(providerId);

          expect(journey.landedOn).toBeNull();
          expect(journey.final.status).toBe(400);
          expect(journey.final.body).toContain(
            "did not include a usable 'email' claim",
          );
          expectNobodySignedIn(journey);
          expect(await accountCount()).toBe(0);
          expect(await everyMembership()).toEqual([]);
        });
      });
    });

    /*
     * ---------------------------------------------------------------------
     * A project's own OpenID Connect provider.
     * ---------------------------------------------------------------------
     */

    describe("a project's own OpenID Connect provider", () => {
      test("someone new joins that project's teams and nothing of any other project, and their SSO sign-in counts for that project alone", async () => {
        const platform: ProjectFixture = await makeProject("Platform");
        const payments: ProjectFixture = await makeProject("Payments");
        const providerId: ObjectID = await makeProjectOidc({
          projectId: platform.id,
          teams: [platform.membersTeam],
        });

        setClaims(
          idTokenClaims,
          entraClaims({ email: "megan@contoso.example", name: "Megan Bowen" }),
        );

        const journey: Journey = await signInWithProjectOidc(
          platform.id,
          providerId,
        );
        const account: User = (await accountsAt("megan@contoso.example"))[0]!;

        expectSignedIn(journey, account.id!);
        expect(journey.landedOn).toBe(
          `${SERVER}/dashboard/${platform.id.toString()}`,
        );
        expect(projectSsoCookies()).toEqual([platform.id.toString()]);
        expect(jar.cookie(CookieName.GlobalSSOToken)).toBeUndefined();

        expect(await everyMembership()).toEqual([
          {
            userId: account.id!.toString(),
            projectId: platform.id.toString(),
            teamId: platform.membersTeam.toString(),
            hasAcceptedInvitation: true,
          },
        ]);
        expect(await hasProjectAccess(account.id!, platform.id)).toBe(true);
        expect(await hasProjectAccess(account.id!, payments.id)).toBe(false);
      });

      test("a member of another project who signs in through this one's provider joins this one, and the other is left as it was", async () => {
        const platform: ProjectFixture = await makeProject("Platform");
        const payments: ProjectFixture = await makeProject("Payments");
        const providerId: ObjectID = await makeProjectOidc({
          projectId: platform.id,
          teams: [platform.membersTeam],
        });
        const account: User = await makeAccountByHand({
          email: "adele@contoso.example",
          name: "Adele Vance",
        });

        await addMembership({
          userId: account.id!,
          projectId: payments.id,
          teamId: payments.membersTeam,
        });

        setClaims(
          idTokenClaims,
          entraClaims({ email: "adele@contoso.example", name: "Adele Vance" }),
        );

        const journey: Journey = await signInWithProjectOidc(
          platform.id,
          providerId,
        );

        expectSignedIn(journey, account.id!);
        // The sign-in counts as SSO for Platform, never for Payments.
        expect(projectSsoCookies()).toEqual([platform.id.toString()]);

        const memberships: Array<Membership> = await membershipsOf(account.id!);
        expect(memberships).toHaveLength(2);
        expect(memberships).toEqual(
          expect.arrayContaining([
            {
              projectId: payments.id.toString(),
              teamId: payments.membersTeam.toString(),
              hasAcceptedInvitation: true,
            },
            {
              projectId: platform.id.toString(),
              teamId: platform.membersTeam.toString(),
              hasAcceptedInvitation: true,
            },
          ]),
        );
      });

      test("a provider naming another project's team - saved before teams were held to their project - adds nobody to it", async () => {
        const platform: ProjectFixture = await makeProject("Platform");
        const payments: ProjectFixture = await makeProject("Payments");
        const providerId: ObjectID = await makeProjectOidc({
          projectId: platform.id,
          teams: [platform.membersTeam, payments.ownersTeam],
        });

        setClaims(
          idTokenClaims,
          entraClaims({ email: "megan@contoso.example", name: "Megan Bowen" }),
        );

        const journey: Journey = await signInWithProjectOidc(
          platform.id,
          providerId,
        );
        const account: User = (await accountsAt("megan@contoso.example"))[0]!;

        expectSignedIn(journey, account.id!);
        expect(await everyMembership()).toEqual([
          {
            userId: account.id!.toString(),
            projectId: platform.id.toString(),
            teamId: platform.membersTeam.toString(),
            hasAcceptedInvitation: true,
          },
        ]);
        expect(await hasProjectAccess(account.id!, payments.id)).toBe(false);
        // Not on the other project's team: its on-call and notifications.
        expect(await isOnTeam(payments.ownersTeam, account.id!)).toBe(false);
      });

      test("a provider naming only another project's team adds nobody to anything, and says it has no teams", async () => {
        const platform: ProjectFixture = await makeProject("Platform");
        const payments: ProjectFixture = await makeProject("Payments");
        const providerId: ObjectID = await makeProjectOidc({
          projectId: platform.id,
          teams: [payments.ownersTeam],
        });

        setClaims(
          idTokenClaims,
          entraClaims({ email: "megan@contoso.example", name: "Megan Bowen" }),
        );

        const journey: Journey = await signInWithProjectOidc(
          platform.id,
          providerId,
        );

        expect(pageOf(journey).title).toBe("No teams added.");
        expectNobodySignedIn(journey);
        expect(await everyMembership()).toEqual([]);
        // Nowhere to put them, so no account is left behind either.
        expect(await accountCount()).toBe(0);
      });

      test("someone with an account in none of the project's teams is told the same as someone new, and joins nothing", async () => {
        const platform: ProjectFixture = await makeProject("Platform");
        const payments: ProjectFixture = await makeProject("Payments");
        const providerId: ObjectID = await makeProjectOidc({
          projectId: platform.id,
          teams: [payments.ownersTeam],
        });
        const account: User = await makeAccountByHand({
          email: "adele@contoso.example",
          name: "Adele Vance",
        });

        setClaims(
          idTokenClaims,
          entraClaims({ email: "adele@contoso.example", name: "Adele Vance" }),
        );

        const journey: Journey = await signInWithProjectOidc(
          platform.id,
          providerId,
        );

        expect(pageOf(journey).title).toBe("No teams added.");
        expectNobodySignedIn(journey);
        expect(await membershipsOf(account.id!)).toEqual([]);
        expect(await accountCount()).toBe(1);
      });

      test("an address the provider has not verified makes no account and joins nobody to the project", async () => {
        const platform: ProjectFixture = await makeProject("Platform");
        const providerId: ObjectID = await makeProjectOidc({
          projectId: platform.id,
          teams: [platform.membersTeam],
        });

        setClaims(idTokenClaims, {
          ...entraClaims({
            email: "megan@contoso.example",
            name: "Megan Bowen",
          }),
          email_verified: false,
        });

        const journey: Journey = await signInWithProjectOidc(
          platform.id,
          providerId,
        );

        expect(pageOf(journey).title).toBe(PROVIDER_EMAIL_NOT_VERIFIED_TITLE);
        expectNobodySignedIn(journey);
        expect(await accountCount()).toBe(0);
        expect(await everyMembership()).toEqual([]);
      });
    });

    /*
     * ---------------------------------------------------------------------
     * SAML: the server's own provider, and a project's.
     * ---------------------------------------------------------------------
     */

    describe("the server's own SAML provider", () => {
      test("with no project attached, someone new is turned away and no account is made, and the server's log says why", async () => {
        const providerId: ObjectID = await makeGlobalSaml();
        await makeProject("Platform");

        const journey: Journey = await signInWithGlobalSaml({
          providerId: providerId,
          email: "megan@contoso.example",
          name: "Megan Bowen",
        });

        expect(pageOf(journey).title).toBe(SSO_INVITE_SCREEN_TITLE);
        expectNobodySignedIn(journey);
        expect(await accountCount()).toBe(0);
        expect(
          loggedLines("info").some((line: string): boolean => {
            return (
              line.includes(providerId.toString()) &&
              line.includes("no project is attached to it")
            );
          }),
        ).toBe(true);
      });

      test("with a project attached, someone new gets an account and joins its teams", async () => {
        const providerId: ObjectID = await makeGlobalSaml();
        const platform: ProjectFixture = await makeProject("Platform");
        const payments: ProjectFixture = await makeProject("Payments");

        await attachToGlobalSaml({
          providerId: providerId,
          projectId: platform.id,
          teams: [platform.membersTeam],
        });

        const journey: Journey = await signInWithGlobalSaml({
          providerId: providerId,
          email: "megan@contoso.example",
          name: "Megan Bowen",
        });
        const account: User = (await accountsAt("megan@contoso.example"))[0]!;

        expectSignedIn(journey, account.id!);
        expect(account.name?.toString()).toBe("Megan Bowen");
        expect(await everyMembership()).toEqual([
          {
            userId: account.id!.toString(),
            projectId: platform.id.toString(),
            teamId: platform.membersTeam.toString(),
            hasAcceptedInvitation: true,
          },
        ]);
        expect(await hasProjectAccess(account.id!, payments.id)).toBe(false);
      });

      test("an attached project with no teams makes no account it could put nowhere", async () => {
        const providerId: ObjectID = await makeGlobalSaml();
        const platform: ProjectFixture = await makeProject("Platform");

        await attachToGlobalSaml({
          providerId: providerId,
          projectId: platform.id,
          teams: [],
        });

        const journey: Journey = await signInWithGlobalSaml({
          providerId: providerId,
          email: "megan@contoso.example",
          name: "Megan Bowen",
        });

        expect(pageOf(journey).title).toBe(SSO_INVITE_SCREEN_TITLE);
        expectNobodySignedIn(journey);
        expect(await accountCount()).toBe(0);
      });

      test("an attachment naming another project's team adds nobody to it", async () => {
        const providerId: ObjectID = await makeGlobalSaml();
        const platform: ProjectFixture = await makeProject("Platform");
        const payments: ProjectFixture = await makeProject("Payments");

        await attachToGlobalSaml({
          providerId: providerId,
          projectId: platform.id,
          teams: [platform.membersTeam, payments.ownersTeam],
        });

        const journey: Journey = await signInWithGlobalSaml({
          providerId: providerId,
          email: "megan@contoso.example",
          name: "Megan Bowen",
        });
        const account: User = (await accountsAt("megan@contoso.example"))[0]!;

        expectSignedIn(journey, account.id!);
        expect(await everyMembership()).toEqual([
          {
            userId: account.id!.toString(),
            projectId: platform.id.toString(),
            teamId: platform.membersTeam.toString(),
            hasAcceptedInvitation: true,
          },
        ]);
        expect(await hasProjectAccess(account.id!, payments.id)).toBe(false);
        // Not on the other project's team: its on-call and notifications.
        expect(await isOnTeam(payments.ownersTeam, account.id!)).toBe(false);
      });
    });

    describe("a project's own SAML provider", () => {
      test("a provider naming another project's team adds nobody to it, and someone new joins only the project's own team", async () => {
        const platform: ProjectFixture = await makeProject("Platform");
        const payments: ProjectFixture = await makeProject("Payments");
        const providerId: ObjectID = await makeProjectSaml({
          projectId: platform.id,
          teams: [platform.membersTeam, payments.ownersTeam],
        });

        const journey: Journey = await signInWithProjectSaml({
          projectId: platform.id,
          providerId: providerId,
          email: "megan@contoso.example",
          name: "Megan Bowen",
        });
        const account: User = (await accountsAt("megan@contoso.example"))[0]!;

        expectSignedIn(journey, account.id!);
        expect(projectSsoCookies()).toEqual([platform.id.toString()]);
        expect(await everyMembership()).toEqual([
          {
            userId: account.id!.toString(),
            projectId: platform.id.toString(),
            teamId: platform.membersTeam.toString(),
            hasAcceptedInvitation: true,
          },
        ]);
        expect(await hasProjectAccess(account.id!, payments.id)).toBe(false);
        // Not on the other project's team: its on-call and notifications.
        expect(await isOnTeam(payments.ownersTeam, account.id!)).toBe(false);
      });

      test("a provider naming only another project's team adds nobody to anything, and says it has no teams", async () => {
        const platform: ProjectFixture = await makeProject("Platform");
        const payments: ProjectFixture = await makeProject("Payments");
        const providerId: ObjectID = await makeProjectSaml({
          projectId: platform.id,
          teams: [payments.ownersTeam],
        });

        const journey: Journey = await signInWithProjectSaml({
          projectId: platform.id,
          providerId: providerId,
          email: "megan@contoso.example",
          name: "Megan Bowen",
        });

        expect(pageOf(journey).title).toBe("No teams added.");
        expectNobodySignedIn(journey);
        expect(await everyMembership()).toEqual([]);
        // Nowhere to put them, so no account is left behind either.
        expect(await accountCount()).toBe(0);
      });
    });
  },
);

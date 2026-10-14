import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncomingCallPolicy from "../../../../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyPhoneNumber from "../../../../../Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import ColumnRefusalMessage from "../../../../../Server/Types/Database/Permissions/ColumnRefusalMessage";
import { CheckReadPermissionType } from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import Query from "../../../../../Server/Types/Database/Query";
import WorkflowPrincipal from "../../../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import Search from "../../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../../Types/BaseDatabase/StartsWith";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { describe, expect, test } from "@jest/globals";

/*
 * A FILTER THROUGH A RELATION IS HELD TO THE RELATED COLUMN'S READ.
 *
 * A read may filter a record by a column of a record it names - a team
 * member by its user's name - and the database joins the related table to
 * answer it. The relation itself was held to the caller's read, but the
 * related column was not: a caller who may read a status page - a Status
 * Page Viewer, who may not read the call and SMS or SMTP settings at all,
 * included - could filter the pages by their Twilio config's auth token or
 * their SMTP config's password, and which pages matched says something
 * about the credential.
 *
 * Every case below goes through ModelPermission.checkReadQueryPermission,
 * the entry point every read takes before anything reaches the database.
 * A column of a related record is filtered on when it is marked
 * canReadOnRelationQuery, when it is one of the id and timestamp columns
 * every select may name, or when the caller may read that column of the
 * related model; never otherwise, at any depth.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const TOKEN: string = "0123456789abcdef0123456789abcdef";

function caller(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function apiKey(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions,
      projectId: PROJECT_ID,
      isApiKey: true,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

async function checkRead(
  modelType: { new (): BaseModel },
  query: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<CheckReadPermissionType<BaseModel>> {
  return await ModelPermission.checkReadQueryPermission<BaseModel>(
    modelType,
    query as Query<BaseModel>,
    { _id: true },
    props,
  );
}

async function refusalOf(
  modelType: { new (): BaseModel },
  query: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<Error | null> {
  try {
    await checkRead(modelType, query, props);
    return null;
  } catch (err) {
    return err as Error;
  }
}

const TOKEN_REFUSAL: string = ColumnRefusalMessage.getRelationQueryRefusal({
  column: "twilioAuthToken",
  relatedModelName: "Call and SMS Config",
  relationColumn: "callSmsConfig",
  permissions: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ReadProjectCallSMSConfig,
  ],
});

// Who may read a status page but not the Twilio token of its config.
const PAGE_READERS_WITHOUT_TOKEN: Array<[string, Array<Permission>]> = [
  ["a viewer", [Permission.Viewer]],
  ["a project member", [Permission.ProjectMember]],
  ["a status page admin", [Permission.StatusPageAdmin]],
  ["a status page member", [Permission.StatusPageMember]],
  ["a status page viewer", [Permission.StatusPageViewer]],
  ["a holder of Read Status Page", [Permission.ReadProjectStatusPage]],
  [
    "a status page viewer who also reads the rest of the Twilio config",
    [Permission.StatusPageViewer, Permission.SettingsViewer],
  ],
];

// Who may read a status page and the Twilio token of its config.
const PAGE_READERS_WITH_TOKEN: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  [
    "a status page viewer granted Read Call and SMS",
    [Permission.StatusPageViewer, Permission.ReadProjectCallSMSConfig],
  ],
];

describe("filtering a status page by its Twilio config's auth token", () => {
  describe.each(PAGE_READERS_WITHOUT_TOKEN)(
    "%s",
    (_who: string, permissions: Array<Permission>) => {
      test("is refused, in words that say who may", async () => {
        const error: Error | null = await refusalOf(
          StatusPage,
          { callSmsConfig: { twilioAuthToken: new StartsWith(TOKEN[0]!) } },
          caller(permissions),
        );

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect(error!.message).toBe(TOKEN_REFUSAL);
      });

      test("is refused for an exact guess and a substring alike", async () => {
        for (const guess of [TOKEN, new Search("abc")]) {
          const error: Error | null = await refusalOf(
            StatusPage,
            { callSmsConfig: { twilioAuthToken: guess } },
            caller(permissions),
          );

          expect(error).toBeInstanceOf(NotAuthorizedException);
        }
      });

      test("still filters the pages by the config's name and id", async () => {
        await expect(
          checkRead(
            StatusPage,
            { callSmsConfig: { name: new Search("Production") } },
            caller(permissions),
          ),
        ).resolves.toBeTruthy();

        await expect(
          checkRead(
            StatusPage,
            { callSmsConfig: { _id: ObjectID.generate().toString() } },
            caller(permissions),
          ),
        ).resolves.toBeTruthy();
      });
    },
  );

  describe.each(PAGE_READERS_WITH_TOKEN)(
    "%s",
    (_who: string, permissions: Array<Permission>) => {
      test("may filter by it: they may read it anyway", async () => {
        await expect(
          checkRead(
            StatusPage,
            { callSmsConfig: { twilioAuthToken: new StartsWith(TOKEN[0]!) } },
            caller(permissions),
          ),
        ).resolves.toBeTruthy();
      });
    },
  );

  test("an API key is held to the role it carries", async () => {
    const refused: Error | null = await refusalOf(
      StatusPage,
      { callSmsConfig: { twilioAuthToken: TOKEN } },
      apiKey([Permission.Viewer]),
    );
    expect(refused).toBeInstanceOf(NotAuthorizedException);
    expect(refused!.message).toBe(TOKEN_REFUSAL);

    await expect(
      checkRead(
        StatusPage,
        { callSmsConfig: { twilioAuthToken: TOKEN } },
        apiKey([
          Permission.StatusPageViewer,
          Permission.ReadProjectCallSMSConfig,
        ]),
      ),
    ).resolves.toBeTruthy();
  });

  test("a list of filter objects is held to the same rule as one", async () => {
    const error: Error | null = await refusalOf(
      StatusPage,
      {
        callSmsConfig: [
          { name: new Search("Production") },
          { twilioAuthToken: new StartsWith(TOKEN[0]!) },
        ],
      },
      caller([Permission.Viewer]),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error!.message).toBe(TOKEN_REFUSAL);
  });

  test("the account SID, which a viewer may read, is filtered on; a status page viewer, who may not read the config, is refused it", async () => {
    await expect(
      checkRead(
        StatusPage,
        { callSmsConfig: { twilioAccountSID: new StartsWith("AC") } },
        caller([Permission.Viewer]),
      ),
    ).resolves.toBeTruthy();

    const error: Error | null = await refusalOf(
      StatusPage,
      { callSmsConfig: { twilioAccountSID: new StartsWith("AC") } },
      caller([Permission.StatusPageViewer]),
    );
    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error!.message).toContain(
      "You do not have permissions to query on - twilioAccountSID of Call and SMS Config through callSmsConfig.",
    );
  });

  test("root and master admin reads are not held to it", async () => {
    await expect(
      checkRead(
        StatusPage,
        { callSmsConfig: { twilioAuthToken: TOKEN } },
        { isRoot: true },
      ),
    ).resolves.toBeTruthy();

    await expect(
      checkRead(
        StatusPage,
        { callSmsConfig: { twilioAuthToken: TOKEN } },
        {
          ...customDomainCaller({
            permissions: [],
            projectId: PROJECT_ID,
            isMasterAdmin: true,
          }),
        },
      ),
    ).resolves.toBeTruthy();
  });
});

describe("filtering a status page by its SMTP config's credentials", () => {
  test.each([["password" as const], ["clientSecret" as const]])(
    "%s is refused to a viewer, a member and a status page viewer",
    async (column: "password" | "clientSecret") => {
      for (const permissions of [
        [Permission.Viewer],
        [Permission.ProjectMember],
        [Permission.StatusPageViewer],
      ]) {
        const error: Error | null = await refusalOf(
          StatusPage,
          { smtpConfig: { [column]: new StartsWith("s") } },
          caller(permissions),
        );

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect(error!.message).toBe(
          ColumnRefusalMessage.getRelationQueryRefusal({
            column: column,
            relatedModelName: "SMTP Config",
            relationColumn: "smtpConfig",
            permissions: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ReadProjectSMTPConfig,
            ],
          }),
        );
      }
    },
  );

  test("an owner, an admin and Read SMTP Config may filter by it", async () => {
    for (const permissions of [
      [Permission.ProjectOwner],
      [Permission.ProjectAdmin],
      [Permission.StatusPageViewer, Permission.ReadProjectSMTPConfig],
    ]) {
      await expect(
        checkRead(
          StatusPage,
          { smtpConfig: { password: new StartsWith("s") } },
          caller(permissions),
        ),
      ).resolves.toBeTruthy();
    }
  });
});

describe("the other records that name a Twilio config", () => {
  test.each([
    ["an incoming call policy", IncomingCallPolicy],
    ["an incoming call policy's phone number", IncomingCallPolicyPhoneNumber],
  ])(
    "%s is not filtered by the config's token for a reader who may not read it",
    async (_what: string, modelType: { new (): BaseModel }) => {
      for (const permissions of [
        [Permission.ProjectMember],
        [Permission.Viewer],
        [Permission.SettingsViewer],
        [Permission.ReadProjectIncomingCallPolicy],
      ]) {
        const error: Error | null = await refusalOf(
          modelType,
          {
            projectCallSMSConfig: {
              twilioAuthToken: new StartsWith(TOKEN[0]!),
            },
          },
          caller(permissions),
        );

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect(error!.message).toContain(
          "You do not have permissions to query on - twilioAuthToken of Call and SMS Config through projectCallSMSConfig.",
        );
      }

      await expect(
        checkRead(
          modelType,
          {
            projectCallSMSConfig: {
              twilioAuthToken: new StartsWith(TOKEN[0]!),
            },
          },
          caller([Permission.ProjectOwner]),
        ),
      ).resolves.toBeTruthy();
    },
  );
});

describe("a workflow's step", () => {
  /*
   * A step acts as a Project Admin (WorkflowPrincipal), who may read every
   * credential below; but whoever may edit a workflow decides what its Find
   * steps filter by, so a step is lent no read of a setting that holds
   * credentials - not through a relation filter either.
   */
  function step(): DatabaseCommonInteractionProps {
    return {
      ...WorkflowPrincipal.getPropsWithoutPlan({
        projectId: PROJECT_ID,
        workflowId: ObjectID.generate(),
        workflowName: "Find the page",
      }),
      ...ON_HIGHEST_PLAN,
    };
  }

  test.each([
    [
      "a status page by its Twilio config's auth token",
      StatusPage,
      { callSmsConfig: { twilioAuthToken: new StartsWith(TOKEN[0]!) } },
      "You do not have permissions to query on - twilioAuthToken of Call and SMS Config through callSmsConfig.",
    ],
    [
      "a status page by its Twilio config's account SID",
      StatusPage,
      { callSmsConfig: { twilioAccountSID: new StartsWith("AC") } },
      "You do not have permissions to query on - twilioAccountSID of Call and SMS Config through callSmsConfig.",
    ],
    [
      "a status page by its SMTP config's password",
      StatusPage,
      { smtpConfig: { password: new StartsWith("s") } },
      "You do not have permissions to query on - password of SMTP Config through smtpConfig.",
    ],
    [
      "an incoming call policy by its Twilio config's auth token",
      IncomingCallPolicy,
      { projectCallSMSConfig: { twilioAuthToken: new StartsWith("0") } },
      "You do not have permissions to query on - twilioAuthToken of Call and SMS Config through projectCallSMSConfig.",
    ],
  ])(
    "may not filter %s",
    async (
      _what: string,
      modelType: { new (): BaseModel },
      query: Record<string, unknown>,
      refusal: string,
    ) => {
      const error: Error | null = await refusalOf(modelType, query, step());

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error!.message).toContain(refusal);

      // A Project Admin, who is a person, may: the step is the difference.
      await expect(
        checkRead(modelType, query, caller([Permission.ProjectAdmin])),
      ).resolves.toBeTruthy();
    },
  );

  test("still filters a status page by its config's name", async () => {
    await expect(
      checkRead(
        StatusPage,
        { callSmsConfig: { name: new Search("Production") } },
        step(),
      ),
    ).resolves.toBeTruthy();
  });
});

describe("a filter a relation deeper", () => {
  test("is held to the rule at every level", async () => {
    // Nobody may read who created a project through the API.
    const error: Error | null = await refusalOf(
      StatusPage,
      { project: { createdOwnerEmail: new StartsWith("a") } },
      caller([Permission.Viewer]),
    );
    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error!.message).toBe(
      ColumnRefusalMessage.getRelationQueryRefusal({
        column: "createdOwnerEmail",
        relatedModelName: "Project",
        relationColumn: "project",
        permissions: [],
      }),
    );

    // Two relations deep: the config's project, then that column.
    const deep: Error | null = await refusalOf(
      StatusPage,
      {
        callSmsConfig: {
          project: { createdOwnerEmail: new StartsWith("a") },
        },
      },
      caller([Permission.Viewer]),
    );
    expect(deep).toBeInstanceOf(NotAuthorizedException);
    expect(deep!.message).toContain(
      "You do not have permissions to query on - createdOwnerEmail of Project through project.",
    );

    // And the relation in between is held too.
    const between: Error | null = await refusalOf(
      StatusPage,
      { callSmsConfig: { project: { name: new Search("Acme") } } },
      caller([Permission.StatusPageViewer]),
    );
    expect(between).toBeInstanceOf(NotAuthorizedException);
    expect(between!.message).toContain(
      "You do not have permissions to query on - project of Call and SMS Config through callSmsConfig.",
    );

    // A deep filter on what every level may show still works.
    await expect(
      checkRead(
        StatusPage,
        { callSmsConfig: { project: { name: new Search("Acme") } } },
        caller([Permission.Viewer]),
      ),
    ).resolves.toBeTruthy();
  });

  test("a column the related model does not have is refused as a bad request", async () => {
    const error: Error | null = await refusalOf(
      StatusPage,
      { callSmsConfig: { notAColumn: "x" } },
      caller([Permission.ProjectOwner]),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error!.message).toBe(
      "Column notAColumn not found on Call and SMS Config",
    );
  });
});

describe("the relation filters the product sends keep working", () => {
  test("the people picker finds team members by their user's name and email", async () => {
    for (const filter of [
      { user: { name: new Search("ada") } },
      { user: { email: new Search("ada@") } },
    ]) {
      await expect(
        checkRead(TeamMember, filter, caller([Permission.ProjectMember])),
      ).resolves.toBeTruthy();
    }
  });

  test("the dashboard header counts incidents by their state", async () => {
    await expect(
      checkRead(
        Incident,
        { currentIncidentState: { isCreatedState: true } },
        caller([Permission.Viewer]),
      ),
    ).resolves.toBeTruthy();
  });

  test("monitor lists filter by whether their status is operational", async () => {
    await expect(
      checkRead(
        Monitor,
        { currentMonitorStatus: { isOperationalState: false } },
        caller([Permission.Viewer]),
      ),
    ).resolves.toBeTruthy();
  });

  test("a relation filtered by ids is not a relation filter object", async () => {
    for (const filter of [
      { callSmsConfig: ObjectID.generate() },
      { callSmsConfig: ObjectID.generate().toString() },
      { callSmsConfig: new Includes([ObjectID.generate()]) },
    ]) {
      await expect(
        checkRead(StatusPage, filter, caller([Permission.StatusPageViewer])),
      ).resolves.toBeTruthy();
    }
  });
});

import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import RecordActorType, {
  CREATED_BY_ACTOR_COLUMNS,
  LAST_MODIFIED_COLUMNS,
  RECORD_ACTOR_COLUMNS,
  RECORD_ACTOR_TYPES,
  RecordActor,
  RecordActorUtil,
} from "../../../Types/Database/RecordActor";
import UserAttribution from "../../../Types/Database/UserAttribution";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT MADE A WRITE, BY KIND (#10290).
 *
 * A record's "created by" and "last modified by" come from the props of the
 * write that made it, worked out by one rule. Each kind of caller is named
 * as what it is - an API key or a workflow never as a person, and an MCP
 * client as the client acting for its member - and OneUptime's own writes
 * count for a create and never for a change.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-bbbb-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-bbbb-4aaa-8bbb-0000000000e1");
const API_KEY_ID: ObjectID = new ObjectID(
  "0193c0de-bbbb-4aaa-8bbb-0000000000a1",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "0193c0de-bbbb-4aaa-8bbb-0000000000c1",
);
const GRANT_ID: ObjectID = new ObjectID("0193c0de-bbbb-4aaa-8bbb-0000000000d1");

function describeActor(actor: RecordActor | null): unknown {
  if (!actor) {
    return null;
  }

  return {
    type: actor.type,
    actorId: actor.actorId ? actor.actorId.toString() : null,
    userId: actor.userId ? actor.userId.toString() : null,
  };
}

interface ActorCase {
  name: string;
  props: DatabaseCommonInteractionProps;
  created: unknown;
  modified: unknown;
}

const CASES: Array<ActorCase> = [
  {
    name: "a person at the dashboard",
    props: { tenantId: PROJECT_ID, userId: USER_ID, userType: UserType.User },
    created: { type: "User", actorId: null, userId: USER_ID.toString() },
    modified: { type: "User", actorId: null, userId: USER_ID.toString() },
  },
  {
    name: "a project API key (Terraform, the CLI, a script)",
    props: {
      tenantId: PROJECT_ID,
      userType: UserType.API,
      apiKeyId: API_KEY_ID,
      apiKeyName: "Terraform",
    },
    created: {
      type: "ApiKey",
      actorId: API_KEY_ID.toString(),
      userId: null,
    },
    modified: {
      type: "ApiKey",
      actorId: API_KEY_ID.toString(),
      userId: null,
    },
  },
  {
    name: "an API key whose id the request did not carry",
    props: { tenantId: PROJECT_ID, userType: UserType.API },
    created: { type: "ApiKey", actorId: null, userId: null },
    modified: { type: "ApiKey", actorId: null, userId: null },
  },
  {
    name: "a workflow's step",
    props: {
      tenantId: PROJECT_ID,
      userType: UserType.Workflow,
      workflowId: WORKFLOW_ID,
      workflowName: "Close stale incidents",
    },
    created: {
      type: "Workflow",
      actorId: WORKFLOW_ID.toString(),
      userId: null,
    },
    modified: {
      type: "Workflow",
      actorId: WORKFLOW_ID.toString(),
      userId: null,
    },
  },
  {
    name: "a workflow's step that runs with a person's permissions",
    props: {
      tenantId: PROJECT_ID,
      isRoot: true,
      workflowId: WORKFLOW_ID,
      userType: UserType.Workflow,
    },
    created: {
      type: "Workflow",
      actorId: WORKFLOW_ID.toString(),
      userId: null,
    },
    modified: {
      type: "Workflow",
      actorId: WORKFLOW_ID.toString(),
      userId: null,
    },
  },
  {
    name: "an MCP client a member connected, acting for them",
    props: {
      tenantId: PROJECT_ID,
      userId: USER_ID,
      userType: UserType.User,
      mcpOAuthGrantId: GRANT_ID,
      mcpClientName: "Claude Code",
    },
    created: {
      type: "McpClient",
      actorId: GRANT_ID.toString(),
      userId: USER_ID.toString(),
    },
    modified: {
      type: "McpClient",
      actorId: GRANT_ID.toString(),
      userId: USER_ID.toString(),
    },
  },
  {
    name: "a server admin at the admin dashboard",
    props: {
      isMasterAdmin: true,
      userId: USER_ID,
      userType: UserType.MasterAdmin,
    },
    created: {
      type: "MasterAdmin",
      actorId: null,
      userId: USER_ID.toString(),
    },
    modified: {
      type: "MasterAdmin",
      actorId: null,
      userId: USER_ID.toString(),
    },
  },
  {
    name: "the master API key, acting as the server admin",
    props: {
      tenantId: PROJECT_ID,
      isMasterAdmin: true,
      userId: USER_ID,
      userType: UserType.MasterAdmin,
      apiKeyName: "Master API Key",
    },
    created: {
      type: "MasterAdmin",
      actorId: null,
      userId: USER_ID.toString(),
    },
    modified: {
      type: "MasterAdmin",
      actorId: null,
      userId: USER_ID.toString(),
    },
  },
  {
    name: "OneUptime's own code acting for the person who clicked",
    props: { isRoot: true, userId: USER_ID },
    created: { type: "User", actorId: null, userId: USER_ID.toString() },
    modified: { type: "User", actorId: null, userId: USER_ID.toString() },
  },
  {
    name: "OneUptime on its own: a job, an engine, a probe",
    props: { isRoot: true },
    created: { type: "System", actorId: null, userId: null },
    modified: null,
  },
  {
    name: "an engine writing a project's records",
    props: { isRoot: true, tenantId: PROJECT_ID },
    created: { type: "System", actorId: null, userId: null },
    modified: null,
  },
  {
    name: "a status page's visitor",
    props: { tenantId: PROJECT_ID, userType: UserType.Public },
    created: null,
    modified: null,
  },
  {
    name: "a request nobody signed",
    props: {},
    created: null,
    modified: null,
  },
];

describe("what made a write", () => {
  test.each(CASES)("$name", ({ props, created, modified }: ActorCase): void => {
    expect(describeActor(RecordActorUtil.fromProps(props))).toEqual(created);
    expect(describeActor(RecordActorUtil.changerFromProps(props))).toEqual(
      modified,
    );
  });

  test("an API key or a workflow is never a person, even with a person's id on its props", () => {
    const apiKey: RecordActor | null = RecordActorUtil.fromProps({
      tenantId: PROJECT_ID,
      userType: UserType.API,
      apiKeyId: API_KEY_ID,
      userId: USER_ID,
    });

    const workflow: RecordActor | null = RecordActorUtil.fromProps({
      tenantId: PROJECT_ID,
      userType: UserType.Workflow,
      workflowId: WORKFLOW_ID,
      userId: USER_ID,
    });

    expect(apiKey?.type).toBe(RecordActorType.ApiKey);
    expect(apiKey?.userId).toBeNull();
    expect(workflow?.type).toBe(RecordActorType.Workflow);
    expect(workflow?.userId).toBeNull();
  });

  test("an MCP client's grant without a member is no MCP client", () => {
    expect(
      describeActor(
        RecordActorUtil.fromProps({
          tenantId: PROJECT_ID,
          isRoot: true,
          mcpOAuthGrantId: GRANT_ID,
        }),
      ),
    ).toEqual({ type: "System", actorId: null, userId: null });
  });
});

describe("a stored kind", () => {
  test.each(
    RECORD_ACTOR_TYPES.map((type: RecordActorType) => {
      return [type];
    }),
  )("%s reads as itself", (type: RecordActorType) => {
    expect(RecordActorUtil.readType(type)).toBe(type);
  });

  test.each([
    [undefined],
    [null],
    [""],
    ["user"],
    ["Person"],
    ["API"],
    [42],
    [{ type: "User" }],
  ])("%p is no kind", (value: unknown) => {
    expect(RecordActorUtil.readType(value)).toBeNull();
  });
});

describe("the columns", () => {
  test("a create's and a change's columns are every one of them, each once", () => {
    expect(
      [
        ...CREATED_BY_ACTOR_COLUMNS,
        ...LAST_MODIFIED_COLUMNS,
        "lastModifiedByUser",
      ]
        .slice()
        .sort(),
    ).toEqual([...RECORD_ACTOR_COLUMNS].sort());
    expect(new Set(RECORD_ACTOR_COLUMNS).size).toBe(
      RECORD_ACTOR_COLUMNS.length,
    );
  });

  test.each(
    RECORD_ACTOR_COLUMNS.map((column: string) => {
      return [column];
    }),
  )("%s is OneUptime's to say", (column: string) => {
    expect(RecordActorUtil.isColumn(column)).toBe(true);
    expect(UserAttribution.isDecidedByServer(column)).toBe(true);
    expect(
      UserAttribution.getAccessControl(column, {
        read: [Permission.ProjectMember],
        create: [Permission.ProjectMember],
        update: [Permission.ProjectMember],
      }),
    ).toEqual({ read: [Permission.ProjectMember], create: [], update: [] });
    expect(
      UserAttribution.getColumnMetadata(column, { computed: false }),
    ).toEqual({ computed: true });
  });

  test.each([["updatedAt"], ["createdAt"], ["name"], ["lastSeenAt"], [""]])(
    "%s is no actor column",
    (column: string) => {
      expect(RecordActorUtil.isColumn(column)).toBe(false);
    },
  );
});

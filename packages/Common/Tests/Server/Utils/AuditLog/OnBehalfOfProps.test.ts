import fs from "fs";
import path from "path";
import ts from "typescript";
import OnBehalfOfProps from "../../../../Server/Utils/AuditLog/OnBehalfOfProps";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import WriteSource from "../../../../Types/BaseDatabase/WriteSource";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { describe, expect, test } from "@jest/globals";

/*
 * THE PROPS OF A WRITE ONEUPTIME MAKES ON A PERSON'S BEHALF (issue #6283).
 *
 * Cancelling a runbook run was written as plain root, so the audit log
 * credited it to System. Such a write now carries who the person is - and
 * nothing of what they may do - so the entry is theirs while the write
 * stays OneUptime's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const KEY_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const GRANT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const WORKFLOW_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

// Everything a request's props can carry.
function everything(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.ProjectOwner],
    } as never,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [],
      },
    },
    userType: UserType.User,
    tenantId: PROJECT_ID,
    isRoot: false,
    isMultiTenantRequest: false,
    ignoreHooks: true,
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: true,
    isMasterAdmin: true,
    userTeamIds: [PROJECT_ID],
    apiKeyId: KEY_ID,
    apiKeyName: "Deploy bot",
    mcpOAuthGrantId: GRANT_ID,
    mcpClientName: "Claude",
    workflowId: WORKFLOW_ID,
    workflowName: "Nightly",
    writeSource: WriteSource.AskAi,
    isReadOnlyCredential: true,
    requestOrigin: { ipAddress: "203.0.113.7" } as never,
  };
}

/*
 * What each of the props' other members is, and why the props of a write on
 * someone's behalf leave it out. A new member of
 * DatabaseCommonInteractionProps has to be one or the other.
 */
const NOT_IDENTITY: Readonly<Record<string, string>> = {
  userGlobalAccessPermission: "what they may do: root asks nothing",
  userTenantAccessPermission: "what they may do: root asks nothing",
  tenantId:
    "a project on the request would make it a write made in the project, which drops the people a write names (UserAttribution)",
  isRoot: "set to true: the write is OneUptime's",
  isMultiTenantRequest: "a read's scope",
  ignoreHooks: "the write runs every hook, as OneUptime's own writes do",
  currentPlan: "a plan decides a person's own writes, not OneUptime's",
  isSubscriptionUnpaid: "a plan decides a person's own writes, not OneUptime's",
  isMasterAdmin: "what they may do: root asks nothing",
  userTeamIds: "what they may do: root asks nothing",
  isReadOnlyCredential:
    "the action's own rules decide, as they did before the write was credited",
  requestOrigin: "for the security emails of a person's own account changes",
};

// The members DatabaseCommonInteractionProps declares, read from its source.
function declaredMembers(): Array<string> {
  const file: string = path.resolve(
    __dirname,
    "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps.ts",
  );
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const members: Array<string> = [];

  source.forEachChild((node: ts.Node): void => {
    if (!ts.isInterfaceDeclaration(node)) {
      return;
    }

    for (const member of node.members) {
      if (member.name && ts.isIdentifier(member.name)) {
        members.push(member.name.text);
      }
    }
  });

  return members;
}

describe("the props of a write OneUptime makes on someone's behalf", () => {
  test("carry who acted and through what, as root, and nothing they may do", () => {
    expect(OnBehalfOfProps.get(everything())).toEqual({
      isRoot: true,
      userId: USER_ID,
      userType: UserType.User,
      apiKeyId: KEY_ID,
      apiKeyName: "Deploy bot",
      mcpOAuthGrantId: GRANT_ID,
      mcpClientName: "Claude",
      workflowId: WORKFLOW_ID,
      workflowName: "Nightly",
      writeSource: WriteSource.AskAi,
    });
  });

  test("a person in the dashboard: their user and its type", () => {
    expect(
      OnBehalfOfProps.get({
        tenantId: PROJECT_ID,
        userId: USER_ID,
        userType: UserType.User,
        userTenantAccessPermission: {},
      }),
    ).toEqual({ isRoot: true, userId: USER_ID, userType: UserType.User });
  });

  test("an API key: the key, by id and name", () => {
    expect(
      OnBehalfOfProps.get({
        tenantId: PROJECT_ID,
        userType: UserType.API,
        apiKeyId: KEY_ID,
        apiKeyName: "Deploy bot",
      }),
    ).toEqual({
      isRoot: true,
      userType: UserType.API,
      apiKeyId: KEY_ID,
      apiKeyName: "Deploy bot",
    });
  });

  test("leaves out what is not set, and never aliases what it was given", () => {
    const props: DatabaseCommonInteractionProps = {
      userId: USER_ID,
      userType: UserType.User,
      apiKeyName: undefined,
      workflowName: null as never,
    };
    const onBehalfOf: DatabaseCommonInteractionProps =
      OnBehalfOfProps.get(props);

    expect(Object.keys(onBehalfOf).sort()).toEqual(
      ["isRoot", "userId", "userType"].sort(),
    );
    expect(onBehalfOf).not.toBe(props);
    expect(props.isRoot).toBeUndefined();
  });

  test("with nobody to name, it is OneUptime's own write: a system event", () => {
    expect(OnBehalfOfProps.get({})).toEqual({ isRoot: true });
  });

  test("every member of the props is decided: an identity it carries, or one it leaves out and why", () => {
    const identity: Set<string> = new Set<string>(
      OnBehalfOfProps.getIdentityKeys() as Array<string>,
    );
    const members: Array<string> = declaredMembers();

    expect(members.length).toBeGreaterThan(10);

    for (const member of members) {
      expect([member, identity.has(member) || member in NOT_IDENTITY]).toEqual([
        member,
        true,
      ]);
      expect([member, identity.has(member) && member in NOT_IDENTITY]).toEqual([
        member,
        false,
      ]);
    }

    // And nothing decided that the props no longer have.
    for (const decided of [...identity, ...Object.keys(NOT_IDENTITY)]) {
      expect([decided, members.includes(decided)]).toEqual([decided, true]);
    }
  });
});

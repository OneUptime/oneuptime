import FeedFollowOnWriteProps from "../../../../Server/Utils/Feed/FeedFollowOnWriteProps";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { describe, expect, test } from "@jest/globals";

/*
 * THE PROPS OF A WRITE ONEUPTIME MAKES ITSELF BECAUSE OF SOMEBODY'S CHANGE
 * (Server/Utils/Feed/FeedFollowOnWriteProps): a role given on an incident
 * episode, copied to each of its incidents. The write is OneUptime's own -
 * root, no tenant, nobody's permissions - and names who made the change,
 * so each incident's feed entry and chat message names them too.
 */

const PROJECT: ObjectID = new ObjectID("7c000000-0000-4000-8000-000000000001");
const PERSON: ObjectID = new ObjectID("7c000000-0000-4000-8000-000000000002");
const OTHER: ObjectID = new ObjectID("7c000000-0000-4000-8000-000000000003");
const KEY: ObjectID = new ObjectID("7c000000-0000-4000-8000-000000000004");
const WORKFLOW: ObjectID = new ObjectID("7c000000-0000-4000-8000-000000000005");

// A request's props, as a person's, a key's or a workflow's come in.
const request: (
  extra: Partial<DatabaseCommonInteractionProps>,
) => DatabaseCommonInteractionProps = (
  extra: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps => {
  return {
    tenantId: PROJECT,
    userGlobalAccessPermission: {
      projectIds: [PROJECT],
      globalPermissions: [Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    currentPlan: undefined,
    ...extra,
  };
};

describe("FeedFollowOnWriteProps.get", () => {
  test("a person's change: OneUptime's write, naming the person", () => {
    expect(
      FeedFollowOnWriteProps.get({ props: request({ userId: PERSON }) }),
    ).toEqual({ isRoot: true, userId: PERSON });
  });

  test("the person the change's record names wins over the request's", () => {
    expect(
      FeedFollowOnWriteProps.get({
        props: request({ userId: OTHER }),
        userId: PERSON,
      }),
    ).toEqual({ isRoot: true, userId: PERSON });
  });

  test("a project API key's change: naming the key", () => {
    expect(
      FeedFollowOnWriteProps.get({
        props: request({ apiKeyId: KEY, apiKeyName: "Jira Automation" }),
      }),
    ).toEqual({ isRoot: true, apiKeyId: KEY, apiKeyName: "Jira Automation" });
  });

  test("a workflow's step: naming the workflow", () => {
    expect(
      FeedFollowOnWriteProps.get({
        props: request({
          userType: UserType.Workflow,
          workflowId: WORKFLOW,
          workflowName: "  Page SRE  ",
        }),
      }),
    ).toEqual({
      isRoot: true,
      workflowId: WORKFLOW,
      workflowName: "Page SRE",
    });
  });

  test("OneUptime's own change - a grouping rule's - names nobody", () => {
    expect(FeedFollowOnWriteProps.get({ props: { isRoot: true } })).toEqual({
      isRoot: true,
    });
    expect(
      FeedFollowOnWriteProps.get({
        props: { isRoot: true },
        userId: null,
      }),
    ).toEqual({ isRoot: true });
  });

  test("never the request's tenant, permissions, plan or workflow role: the write stays OneUptime's", () => {
    for (const props of [
      request({ userId: PERSON }),
      request({ apiKeyId: KEY, apiKeyName: "K" }),
      request({
        userType: UserType.Workflow,
        workflowId: WORKFLOW,
        workflowName: "W",
      }),
    ]) {
      const followOn: DatabaseCommonInteractionProps =
        FeedFollowOnWriteProps.get({ props: props });

      expect(followOn.isRoot).toBe(true);
      expect(followOn.tenantId).toBeUndefined();
      expect(followOn.userGlobalAccessPermission).toBeUndefined();
      expect(followOn.userTenantAccessPermission).toBeUndefined();
      expect(followOn.userType).toBeUndefined();
      expect(Object.keys(followOn)).not.toContain("currentPlan");
    }
  });

  test("a person who made the change is named alone, whatever key or workflow came with it", () => {
    expect(
      FeedFollowOnWriteProps.get({
        props: request({
          userId: PERSON,
          apiKeyId: KEY,
          apiKeyName: "K",
          workflowName: "W",
        }),
      }),
    ).toEqual({ isRoot: true, userId: PERSON });
  });
});

import { describe, expect, test } from "@jest/globals";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

/*
 * WHO INSTALLS THE SLACK APP IS LINKED WITH NO TOKEN OF THEIR OWN.
 *
 * Slack's review of the app for the Slack Marketplace: "The user token for
 * users:read does not appear required." It was not: OneUptime acts with the
 * project's bot token and a person's Slack user id. So the app asks for no
 * user scopes, and Slack's install names who installed it (authed_user.id)
 * with no token of theirs. Their Slack account is linked with an empty one
 * (SlackAPI's install callback). The required-column check read "" as
 * missing, and would have refused that link - and with it, every install.
 * The services the callback's tests drive are fakes, so the check is run
 * here for real.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "f1000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("f1000000-0000-4000-8000-0000000000a1");

function link(authToken: string | undefined): WorkspaceUserAuthToken {
  const model: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
  model.projectId = PROJECT_ID;
  model.userId = USER_ID;
  model.workspaceType = WorkspaceType.Slack;
  model.workspaceUserId = "U0ALICE";
  model.miscData = { userId: "U0ALICE" };

  if (authToken !== undefined) {
    model.authToken = authToken;
  }

  return model;
}

function checkRequired(model: WorkspaceUserAuthToken): void {
  (
    WorkspaceUserAuthTokenService as unknown as {
      checkRequiredFields: (data: WorkspaceUserAuthToken) => unknown;
    }
  ).checkRequiredFields(model);
}

describe("WorkspaceUserAuthTokenService - a Slack account linked without a user token", () => {
  test("an empty token is a value: the link of whoever installed the app is kept", () => {
    expect(() => {
      return checkRequired(link(""));
    }).not.toThrow();
  });

  test("a token is kept as ever: an app created from an older manifest still gets one", () => {
    expect(() => {
      return checkRequired(link("xoxp-user-token"));
    }).not.toThrow();
  });

  test("a token that is not there at all is still required", () => {
    expect(() => {
      return checkRequired(link(undefined));
    }).toThrow("authToken is required");
  });

  test("every other required column is checked as before: a link names a Slack account", () => {
    const model: WorkspaceUserAuthToken = link("");
    model.workspaceUserId = "";

    expect(() => {
      return checkRequired(model);
    }).toThrow("workspaceUserId is required");
  });
});

import { describe, expect, test } from "@jest/globals";
import {
  ActorCredentialInput,
  DEFAULT_RESOURCE_META,
  RESOURCE_META,
  ResourceMeta,
  getActorCredentialLabel,
  getResourceLink,
  getResourceMeta,
} from "../../FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsTableUtils";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import ProjectMiddleware from "Common/Server/Middleware/ProjectAuthorization";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";

/*
 * "Who did this, and through what?" on an audit log entry.
 *
 * Before OAuth sign-in for the MCP server, a change a person made was a change
 * made by their own hands at the dashboard. Now a member can connect an MCP
 * client that acts AS them: the entry is still theirs - their name, their
 * permissions - and without a second line it would be indistinguishable from
 * something they clicked. The same goes for the instance master key, which
 * acts as the master admin.
 *
 * So an entry that names a person gets a small "via ..." line when the change
 * came through something else. Each way of getting that wrong is a lie in an
 * audit trail:
 *
 *  - no line on an MCP change: an agent's action reads as the member's own;
 *  - a line on an ordinary dashboard change: every entry looks automated;
 *  - a "via" line under a project API key: that entry has no person behind
 *    it. The key IS the actor and is drawn as one, so "via <the same key>"
 *    would say the key acted through itself.
 *
 * The helper module is pure (no window, no router), so it is imported for
 * real. The cell that prints the label is Enterprise code and is rendered in
 * ee/Tests/UI/AuditLogs.
 */

describe("what a person's change was made through", () => {
  test("an MCP client they connected", () => {
    expect(
      getActorCredentialLabel({
        userType: UserType.User,
        mcpClientName: "Claude Code",
      }),
    ).toBe("via Claude Code (MCP client)");
  });

  test("the instance master key, which acts as the master admin", () => {
    expect(
      getActorCredentialLabel({
        userType: UserType.MasterAdmin,
        apiKeyName: ProjectMiddleware.MASTER_API_KEY_AUDIT_NAME,
      }),
    ).toBe("via Master API Key");
  });

  test("the label says exactly what the server recorded for the master key", () => {
    /*
     * The name is written by ProjectMiddleware and read back here; the two
     * are a contract the audit page depends on to tell the master key apart.
     */
    expect(ProjectMiddleware.MASTER_API_KEY_AUDIT_NAME).toBe("Master API Key");
  });

  test("any other named key on an entry that names a person", () => {
    expect(
      getActorCredentialLabel({
        userType: UserType.User,
        apiKeyName: "Deploy key",
      }),
    ).toBe("via Deploy key");
  });

  test("an MCP client is named ahead of a key when an entry somehow carries both", () => {
    /*
     * The server never writes both - a delegated MCP request that also carries
     * an API key is refused - but if it ever did, the client is the more
     * specific statement and must not be hidden behind the key.
     */
    expect(
      getActorCredentialLabel({
        userType: UserType.User,
        apiKeyName: "Deploy key",
        mcpClientName: "Claude Code",
      }),
    ).toBe("via Claude Code (MCP client)");
  });

  test("a client's name is passed through as text, whatever is in it", () => {
    /*
     * A client chooses its own name. It is returned verbatim for React to
     * escape; nothing here builds markup out of it.
     */
    const name: string = '<img src=x onerror="alert(1)">';

    expect(
      getActorCredentialLabel({ userType: UserType.User, mcpClientName: name }),
    ).toBe(`via ${name} (MCP client)`);
  });
});

describe("when there is nothing to add", () => {
  test.each([
    ["a member's own change at the dashboard", { userType: UserType.User }],
    ["a master admin's own change", { userType: UserType.MasterAdmin }],
    ["an entry with no actor type", {}],
    ["an entry whose fields are all missing", { userType: undefined }],
    [
      "an entry whose credential names are empty",
      { userType: UserType.User, apiKeyName: "", mcpClientName: "" },
    ],
    [
      "an entry whose credential names are absent",
      {
        userType: UserType.User,
        apiKeyName: undefined,
        mcpClientName: undefined,
      },
    ],
  ] as Array<[string, ActorCredentialInput]>)(
    "%s has no second line",
    (_label: string, entry: ActorCredentialInput) => {
      expect(getActorCredentialLabel(entry)).toBeNull();
    },
  );

  test("an empty client name falls through to the key, not to a blank label", () => {
    expect(
      getActorCredentialLabel({
        userType: UserType.User,
        mcpClientName: "",
        apiKeyName: "Deploy key",
      }),
    ).toBe("via Deploy key");
  });
});

describe("a project API key is the actor, not a credential somebody used", () => {
  test("the value the table compares against is the real API user type", () => {
    // The helper matches on the literal the server stores.
    expect(UserType.API).toBe("API");
  });

  test("a named key gets no via line", () => {
    expect(
      getActorCredentialLabel({
        userType: UserType.API,
        apiKeyName: "CI pipeline",
      }),
    ).toBeNull();
  });

  test("not even when the entry also names an MCP client", () => {
    expect(
      getActorCredentialLabel({
        userType: UserType.API,
        apiKeyName: "CI pipeline",
        mcpClientName: "Claude Code",
      }),
    ).toBeNull();
  });

  test("a key with no name gets none either", () => {
    expect(getActorCredentialLabel({ userType: UserType.API })).toBeNull();
  });
});

/*
 * A workflow step acts as no person (WorkflowPrincipal): the workflow is the
 * actor, drawn by its name, so there is no "via" to add either.
 */
describe("a workflow is the actor, not a credential somebody used", () => {
  test("the value the table compares against is the real workflow user type", () => {
    expect(UserType.Workflow).toBe("Workflow");
  });

  test("a workflow's change gets no via line", () => {
    expect(getActorCredentialLabel({ userType: UserType.Workflow })).toBeNull();
  });

  test("not even when the entry also names a key or a client", () => {
    expect(
      getActorCredentialLabel({
        userType: UserType.Workflow,
        apiKeyName: "CI pipeline",
        mcpClientName: "Claude Code",
      }),
    ).toBeNull();
  });
});

describe("the MCP client authorization resource on the audit log", () => {
  const grantType: string = new McpOAuthGrant().singularName!;

  test("the server really does record connecting and disconnecting a client", () => {
    /*
     * Metadata for a type nothing writes would be dead. Connecting writes a
     * create entry and disconnecting a delete entry; the grant's bookkeeping
     * updates (last used, the sliding expiry) are not audited.
     */
    const grant: McpOAuthGrant = new McpOAuthGrant();

    expect(grantType).toBe("MCP Client Authorization");
    expect(grant.enableAuditLogOn).toBeTruthy();
    expect(grant.enableAuditLogOn!.create).toBe(true);
    expect(grant.enableAuditLogOn!.delete).toBe(true);
    expect(grant.enableAuditLogOn!.update).toBe(false);
  });

  test("its entries are drawn with their own icon rather than the generic cube", () => {
    const meta: ResourceMeta | undefined = RESOURCE_META[grantType];

    expect(meta).toBeDefined();
    expect(meta!.icon).toBe(IconProp.Terminal);
    expect(meta!.color).toBe("text-violet-600");
    expect(meta!.bgColor).toBe("bg-violet-50 border-violet-100");

    expect(getResourceMeta(grantType)).toBe(meta);
    expect(getResourceMeta(grantType)).not.toBe(DEFAULT_RESOURCE_META);
  });

  test.each(["Create", "Delete"])(
    "a %s entry links nowhere: a connected client is a table row, not a page",
    (action: string) => {
      const meta: ResourceMeta = getResourceMeta(grantType);

      expect(meta.viewRoute).toBeUndefined();
      expect(meta.childViewRoute).toBeUndefined();
      expect(
        getResourceLink({
          meta,
          action,
          resourceId: new ObjectID("33333333-3333-4333-8333-333333333333"),
          rootResourceId: new ObjectID("33333333-3333-4333-8333-333333333333"),
        }),
      ).toBeNull();
    },
  );
});

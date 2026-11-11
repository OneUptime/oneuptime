import { describe, expect, test } from "@jest/globals";
import SlackRequestWorkspaceUtil, {
  SlackRequestKind,
  SlackRequestWorkspace,
} from "../../../../../Server/Utils/Workspace/Slack/SlackRequestWorkspace";
import { JSONObject } from "../../../../../Types/JSON";

/*
 * WHERE A SLACK REQUEST WAS MADE (SlackRequestWorkspace): its workspace and,
 * in a Slack Enterprise organization, the organization - read from each
 * kind of request where Slack puts them - and the ids the projects it can be
 * about are connected under: the installation it says it is for first, so a
 * project connected to one workspace, one connected to the whole
 * organization and one that moved between the two are all found.
 *
 * The payloads are shaped as Slack sends them to an app installed for one
 * workspace, and to an app installed for a whole organization (team null on
 * presses and in an event's authorization, is_enterprise_install true).
 */

describe("getKind", () => {
  test("an event, a slash command, or anything else Slack sends - a press, a form, a shortcut", () => {
    expect(
      SlackRequestWorkspaceUtil.getKind({ type: "event_callback", event: {} }),
    ).toBe(SlackRequestKind.Event);
    expect(
      SlackRequestWorkspaceUtil.getKind({ event: { type: "app_home_opened" } }),
    ).toBe(SlackRequestKind.Event);
    expect(
      SlackRequestWorkspaceUtil.getKind({
        command: "/oneuptime",
        team_id: "T0EAST",
      }),
    ).toBe(SlackRequestKind.Command);
    expect(SlackRequestWorkspaceUtil.getKind({ type: "block_actions" })).toBe(
      SlackRequestKind.Interaction,
    );
    expect(SlackRequestWorkspaceUtil.getKind({ type: "view_submission" })).toBe(
      SlackRequestKind.Interaction,
    );
    // An event given as a list is no event.
    expect(SlackRequestWorkspaceUtil.getKind({ event: [] })).toBe(
      SlackRequestKind.Interaction,
    );
  });
});

describe("read: a slash command", () => {
  test("installed in one workspace: the workspace", () => {
    expect(
      SlackRequestWorkspaceUtil.read({
        command: "/oneuptime",
        team_id: "T0EAST",
        team_domain: "acme-east",
        is_enterprise_install: "false",
      }),
    ).toEqual({ teamId: "T0EAST" });
  });

  test("installed for the whole organization: the workspace, the organization, and the installation it is for - said as text", () => {
    expect(
      SlackRequestWorkspaceUtil.read({
        command: "/oneuptime",
        team_id: "T0EAST",
        enterprise_id: "E0ACME",
        is_enterprise_install: "true",
      }),
    ).toEqual({
      teamId: "T0EAST",
      enterpriseId: "E0ACME",
      isEnterpriseInstall: true,
    } as SlackRequestWorkspace);
  });

  test("from a workspace of an organization, installed in that workspace only", () => {
    expect(
      SlackRequestWorkspaceUtil.read({
        command: "/oneuptime",
        team_id: " T0EAST ",
        enterprise_id: " E0ACME ",
        is_enterprise_install: "false",
      }),
    ).toEqual({ teamId: "T0EAST", enterpriseId: "E0ACME" });
  });
});

describe("read: an event", () => {
  test("installed in one workspace: the installation's workspace (authorizations), whatever workspace it happened in", () => {
    expect(
      SlackRequestWorkspaceUtil.read({
        type: "event_callback",
        team_id: "T0SHARED",
        authorizations: [
          {
            enterprise_id: null,
            team_id: "T0EAST",
            user_id: "U0BOT",
            is_bot: true,
            is_enterprise_install: false,
          },
        ],
        event: { type: "message", team: "T0SHARED" },
      }),
    ).toEqual({ teamId: "T0EAST" });
  });

  test("installed for the whole organization: the authorization names no team - the workspace it happened in is the event's", () => {
    expect(
      SlackRequestWorkspaceUtil.read({
        type: "event_callback",
        team_id: "T0WEST",
        enterprise_id: "E0ACME",
        authorizations: [
          {
            enterprise_id: "E0ACME",
            team_id: null,
            user_id: "U0BOT",
            is_bot: true,
            is_enterprise_install: true,
          },
        ],
        event: { type: "app_home_opened", user: "U0ANA" },
      }),
    ).toEqual({
      teamId: "T0WEST",
      enterpriseId: "E0ACME",
      isEnterpriseInstall: true,
    } as SlackRequestWorkspace);
  });

  test("without authorizations: the payload's own fields, then the event's team", () => {
    expect(
      SlackRequestWorkspaceUtil.read({
        type: "event_callback",
        enterprise_id: "E0ACME",
        is_enterprise_install: true,
        event: { type: "reaction_added", team: "T0LABS" },
      }),
    ).toEqual({
      teamId: "T0LABS",
      enterpriseId: "E0ACME",
      isEnterpriseInstall: true,
    } as SlackRequestWorkspace);
  });

  test("authorizations that are not a list, or hold no object, are none", () => {
    expect(
      SlackRequestWorkspaceUtil.read({
        type: "event_callback",
        team_id: "T0EAST",
        authorizations: { team_id: "T0OTHER" },
        event: {},
      }),
    ).toEqual({ teamId: "T0EAST" });
    expect(
      SlackRequestWorkspaceUtil.read({
        type: "event_callback",
        team_id: "T0EAST",
        authorizations: ["T0OTHER"],
        event: {},
      }),
    ).toEqual({ teamId: "T0EAST" });
  });

  test("the authorization says the installation is not the organization's: the payload's word does not count", () => {
    expect(
      SlackRequestWorkspaceUtil.read({
        type: "event_callback",
        team_id: "T0EAST",
        is_enterprise_install: true,
        authorizations: [
          {
            enterprise_id: "E0ACME",
            team_id: "T0EAST",
            is_enterprise_install: false,
          },
        ],
        event: {},
      }),
    ).toEqual({ teamId: "T0EAST", enterpriseId: "E0ACME" });
  });
});

describe("read: a press, a form, a shortcut", () => {
  test("installed in one workspace: the press's team", () => {
    expect(
      SlackRequestWorkspaceUtil.read({
        type: "block_actions",
        team: { id: "T0EAST", domain: "acme-east" },
        user: { id: "U0ANA", team_id: "T0EAST" },
        enterprise: null,
        is_enterprise_install: false,
      }),
    ).toEqual({ teamId: "T0EAST" });
  });

  test("installed for the whole organization: team is null, so the workspace is the person's", () => {
    expect(
      SlackRequestWorkspaceUtil.read({
        type: "block_actions",
        team: null,
        user: { id: "U0ANA", team_id: "T0WEST" },
        enterprise: { id: "E0ACME", name: "Acme Corp" },
        is_enterprise_install: true,
      }),
    ).toEqual({
      teamId: "T0WEST",
      enterpriseId: "E0ACME",
      isEnterpriseInstall: true,
    } as SlackRequestWorkspace);
  });

  test("a form: the workspace OneUptime is installed in, as the form names it - not the shared channel's team", () => {
    expect(
      SlackRequestWorkspaceUtil.read({
        type: "view_submission",
        team: { id: "T0PARTNER" },
        user: { id: "U0ANA", team_id: "T0PARTNER" },
        view: { id: "V0FORM", app_installed_team_id: "T0EAST" },
      }),
    ).toEqual({ teamId: "T0EAST" });

    // A press names the press's team: a form's installed team is for forms only.
    expect(
      SlackRequestWorkspaceUtil.read({
        type: "block_actions",
        team: { id: "T0PARTNER" },
        view: { id: "V0HOME", app_installed_team_id: "T0EAST" },
      }),
    ).toEqual({ teamId: "T0PARTNER" });
  });

  test("a form closed is read as a form", () => {
    expect(
      SlackRequestWorkspaceUtil.read({
        type: "view_closed",
        team: null,
        user: { id: "U0ANA", team_id: "T0WEST" },
        view: { app_installed_team_id: "T0EAST" },
        enterprise: { id: "E0ACME" },
        is_enterprise_install: true,
      }),
    ).toEqual({
      teamId: "T0EAST",
      enterpriseId: "E0ACME",
      isEnterpriseInstall: true,
    } as SlackRequestWorkspace);
  });

  test("the organization named by the team, or the payload, when the press names no enterprise", () => {
    expect(
      SlackRequestWorkspaceUtil.read({
        type: "block_actions",
        team: { id: "T0EAST", enterprise_id: "E0ACME" },
      }),
    ).toEqual({ teamId: "T0EAST", enterpriseId: "E0ACME" });
    expect(
      SlackRequestWorkspaceUtil.read({
        type: "block_suggestion",
        team_id: "T0EAST",
        enterprise_id: "E0ACME",
      }),
    ).toEqual({ teamId: "T0EAST", enterpriseId: "E0ACME" });
  });

  test('is_enterprise_install as the text "true" counts; anything else does not', () => {
    expect(
      SlackRequestWorkspaceUtil.read({
        type: "shortcut",
        team: { id: "T0EAST" },
        enterprise: { id: "E0ACME" },
        is_enterprise_install: "true",
      }).isEnterpriseInstall,
    ).toBe(true);

    for (const value of ["false", "yes", 1, "TRUE", null]) {
      expect(
        SlackRequestWorkspaceUtil.read({
          type: "shortcut",
          team: { id: "T0EAST" },
          enterprise: { id: "E0ACME" },
          is_enterprise_install: value,
        } as JSONObject).isEnterpriseInstall,
      ).toBeUndefined();
    }
  });

  test("ids that are not text are none", () => {
    expect(
      SlackRequestWorkspaceUtil.read({
        type: "block_actions",
        team: { id: 42 },
        user: { team_id: ["T0EAST"] },
        enterprise: { id: { id: "E0ACME" } },
      } as unknown as JSONObject),
    ).toEqual({ teamId: "" });
  });
});

describe("read: what is no request", () => {
  test("nothing, or not an object: no workspace", () => {
    for (const payload of [
      null,
      undefined,
      "T0EAST",
      42,
      ["T0EAST"],
    ] as Array<unknown>) {
      expect(SlackRequestWorkspaceUtil.read(payload as JSONObject)).toEqual({
        teamId: "",
      });
    }

    expect(SlackRequestWorkspaceUtil.read({})).toEqual({ teamId: "" });
  });
});

describe("getConnectionIds: the ids a request's projects are connected under", () => {
  test("installed in one workspace, no organization: the workspace", () => {
    expect(
      SlackRequestWorkspaceUtil.getConnectionIds({ teamId: "T0EAST" }),
    ).toEqual(["T0EAST"]);
  });

  test("from a workspace of an organization, for that workspace's installation: the workspace first, then the organization", () => {
    expect(
      SlackRequestWorkspaceUtil.getConnectionIds({
        teamId: "T0EAST",
        enterpriseId: "E0ACME",
      }),
    ).toEqual(["T0EAST", "E0ACME"]);
  });

  test("for the organization's installation: the organization first, then the workspace", () => {
    expect(
      SlackRequestWorkspaceUtil.getConnectionIds({
        teamId: "T0EAST",
        enterpriseId: "E0ACME",
        isEnterpriseInstall: true,
      }),
    ).toEqual(["E0ACME", "T0EAST"]);
  });

  test("the organization's installation without a workspace (an event Slack named none for): the organization", () => {
    expect(
      SlackRequestWorkspaceUtil.getConnectionIds({
        teamId: "",
        enterpriseId: "E0ACME",
        isEnterpriseInstall: true,
      }),
    ).toEqual(["E0ACME"]);
  });

  test("an organization's installation that names no organization: the workspace", () => {
    expect(
      SlackRequestWorkspaceUtil.getConnectionIds({
        teamId: "T0EAST",
        isEnterpriseInstall: true,
      }),
    ).toEqual(["T0EAST"]);
  });

  test("each id once, trimmed, none empty", () => {
    expect(
      SlackRequestWorkspaceUtil.getConnectionIds({
        teamId: " E0ACME ",
        enterpriseId: "E0ACME",
      }),
    ).toEqual(["E0ACME"]);
    expect(SlackRequestWorkspaceUtil.getConnectionIds({ teamId: "" })).toEqual(
      [],
    );
    expect(
      SlackRequestWorkspaceUtil.getConnectionIds({
        teamId: "   ",
        enterpriseId: "  ",
      }),
    ).toEqual([]);
  });

  test("read from each kind of request, the projects of both installations can be found", () => {
    const fromOrganization: Array<string> =
      SlackRequestWorkspaceUtil.getConnectionIds(
        SlackRequestWorkspaceUtil.read({
          type: "block_actions",
          team: null,
          user: { id: "U0ANA", team_id: "T0WEST" },
          enterprise: { id: "E0ACME" },
          is_enterprise_install: true,
        }),
      );

    const fromWorkspace: Array<string> =
      SlackRequestWorkspaceUtil.getConnectionIds(
        SlackRequestWorkspaceUtil.read({
          command: "/oneuptime",
          team_id: "T0WEST",
          enterprise_id: "E0ACME",
          is_enterprise_install: "false",
        }),
      );

    expect(fromOrganization).toEqual(["E0ACME", "T0WEST"]);
    expect(fromWorkspace).toEqual(["T0WEST", "E0ACME"]);
  });
});

describe("getScopeId: the one id a request is told apart by", () => {
  test("the organization's installation: the organization - a person's presses can name their own workspace", () => {
    expect(
      SlackRequestWorkspaceUtil.getScopeId({
        teamId: "T0WEST",
        enterpriseId: "E0ACME",
        isEnterpriseInstall: true,
      }),
    ).toBe("E0ACME");
  });

  test("a workspace's installation: the workspace, organization or not", () => {
    expect(SlackRequestWorkspaceUtil.getScopeId({ teamId: "T0EAST" })).toBe(
      "T0EAST",
    );
    expect(
      SlackRequestWorkspaceUtil.getScopeId({
        teamId: "T0EAST",
        enterpriseId: "E0ACME",
      }),
    ).toBe("T0EAST");
  });

  test("nothing named: empty", () => {
    expect(SlackRequestWorkspaceUtil.getScopeId({ teamId: "" })).toBe("");
  });

  test("two presses of one organization's installation, from two workspaces, are one scope", () => {
    const east: string = SlackRequestWorkspaceUtil.getScopeId(
      SlackRequestWorkspaceUtil.read({
        type: "block_actions",
        team: null,
        user: { team_id: "T0EAST" },
        enterprise: { id: "E0ACME" },
        is_enterprise_install: true,
      }),
    );
    const west: string = SlackRequestWorkspaceUtil.getScopeId(
      SlackRequestWorkspaceUtil.read({
        type: "block_actions",
        team: null,
        user: { team_id: "T0WEST" },
        enterprise: { id: "E0ACME" },
        is_enterprise_install: true,
      }),
    );

    expect(east).toBe("E0ACME");
    expect(west).toBe(east);
  });
});

describe("getEnterprise: the organization part, with only what it says", () => {
  test("an organization's installation: both", () => {
    expect(
      SlackRequestWorkspaceUtil.getEnterprise({
        teamId: "T0EAST",
        enterpriseId: "E0ACME",
        isEnterpriseInstall: true,
      }),
    ).toEqual({ enterpriseId: "E0ACME", isEnterpriseInstall: true });
  });

  test("a workspace of an organization: the organization only", () => {
    expect(
      SlackRequestWorkspaceUtil.getEnterprise({
        teamId: "T0EAST",
        enterpriseId: " E0ACME ",
        isEnterpriseInstall: false,
      }),
    ).toEqual({ enterpriseId: "E0ACME" });
  });

  test("no organization: nothing - spread into a handler's data, it adds no field", () => {
    const enterprise: {
      enterpriseId?: string;
      isEnterpriseInstall?: boolean;
    } = SlackRequestWorkspaceUtil.getEnterprise({ teamId: "T0EAST" });

    expect(enterprise).toEqual({});
    expect(Object.keys({ teamId: "T0EAST", ...enterprise })).toEqual([
      "teamId",
    ]);
  });
});

describe("getScopeIdOf: for callers that may know only a team id", () => {
  test("the request's own scope when the request is given", () => {
    expect(
      SlackRequestWorkspaceUtil.getScopeIdOf({
        slackWorkspace: {
          teamId: "T0EAST",
          enterpriseId: "E0ACME",
          isEnterpriseInstall: true,
        },
        slackTeamId: "T0EAST",
      }),
    ).toBe("E0ACME");
  });

  test("the team id, trimmed, when only it is given", () => {
    expect(
      SlackRequestWorkspaceUtil.getScopeIdOf({ slackTeamId: " T0EAST " }),
    ).toBe("T0EAST");
  });

  test("neither, or nothing in them: undefined", () => {
    expect(SlackRequestWorkspaceUtil.getScopeIdOf({})).toBeUndefined();
    expect(
      SlackRequestWorkspaceUtil.getScopeIdOf({ slackTeamId: "  " }),
    ).toBeUndefined();
    expect(
      SlackRequestWorkspaceUtil.getScopeIdOf({
        slackWorkspace: { teamId: "" },
        slackTeamId: "T0EAST",
      }),
    ).toBeUndefined();
  });
});

describe("ofTeam", () => {
  test("a workspace with no organization, trimmed", () => {
    expect(SlackRequestWorkspaceUtil.ofTeam(" T0EAST ")).toEqual({
      teamId: "T0EAST",
    });
    expect(SlackRequestWorkspaceUtil.ofTeam(undefined)).toEqual({
      teamId: "",
    });
  });
});

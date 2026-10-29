import IncidentRoleFeedText, {
  INCIDENT_ROLE_CAUSE_KEY,
  IncidentRoleAssignmentCause,
} from "../../../../Server/Utils/Incident/IncidentRoleFeedText";
import { getFeedEntryText } from "../../../../UI/Components/Feed/FeedEntryText";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT AN INCIDENT'S FEED, SLACK AND TEAMS SAY WHEN SOMEBODY IS GIVEN A ROLE
 * OR TAKEN OFF ONE, FOR EVERY WAY IT HAPPENS (Server/Utils/Incident/
 * IncidentRoleFeedText).
 *
 * A channel read "Deane Looi Added Deane Looi as Responder to Incident
 * INC-18" after the maintainer added Deane in the Dashboard. The sentence
 * itself was right - it is written to follow whoever acted - and the person
 * in front of it was wrong; that is FeedWorkspaceNotification's. This suite
 * holds the sentences: a person's change reads after their name, a
 * workflow, a monitor and OneUptime itself say so in the sentence, and a
 * person who gives themselves a role took it.
 */

const LINK: string = "https://oneuptime.example/dashboard/p/incidents/i";
const INCIDENT: MarkdownText = mdText`[Incident INC-18](${LINK})`;
const DEANE: MarkdownText = mdText`[Deane Looi](https://oneuptime.example/dashboard/p/users/d)`;

const PERSON: ObjectID = new ObjectID("7a000000-0000-4000-8000-000000000001");
const KEY: ObjectID = new ObjectID("7a000000-0000-4000-8000-000000000002");
const WORKFLOW: ObjectID = new ObjectID("7a000000-0000-4000-8000-000000000003");

describe("somebody given a role", () => {
  test("by another person: the sentence that follows their name, naming who was given it", () => {
    expect(
      IncidentRoleFeedText.getAddedMarkdown({
        roleName: "Responder",
        incident: INCIDENT,
        person: DEANE,
        isSelf: false,
      }).toString(),
    ).toBe(
      `👤 Added **[Deane Looi](https://oneuptime.example/dashboard/p/users/d)** as **Responder** to [Incident INC-18](${LINK}).`,
    );
  });

  test("by themselves: they took the role - never 'Deane added Deane'", () => {
    const markdown: string = IncidentRoleFeedText.getAddedMarkdown({
      roleName: "Incident Commander",
      incident: INCIDENT,
      person: DEANE,
      isSelf: true,
    }).toString();

    expect(markdown).toBe(
      `👤 Took the **Incident Commander** role on [Incident INC-18](${LINK}).`,
    );
    expect(markdown).not.toContain("Deane");
  });

  test("by a workflow's step: the workflow is named, by the name it had", () => {
    expect(
      IncidentRoleFeedText.getAddedMarkdown({
        roleName: "Responder",
        incident: INCIDENT,
        person: DEANE,
        isSelf: false,
        workflowName: "  Page SRE on SEV1  ",
      }).toString(),
    ).toBe(
      `👤 Workflow **Page SRE on SEV1** added **[Deane Looi](https://oneuptime.example/dashboard/p/users/d)** as **Responder** to [Incident INC-18](${LINK}).`,
    );
  });

  test("by a monitor's criteria: the monitor is named", () => {
    expect(
      IncidentRoleFeedText.getAddedMarkdown({
        roleName: "Observer",
        incident: INCIDENT,
        person: DEANE,
        isSelf: false,
        cause: { kind: "monitor", monitorName: "API Health" },
      }).toString(),
    ).toBe(
      `👤 Monitor **API Health** added **[Deane Looi](https://oneuptime.example/dashboard/p/users/d)** as **Observer** to [Incident INC-18](${LINK}).`,
    );
  });

  test("by OneUptime, to the first person to change the state: it says why", () => {
    expect(
      IncidentRoleFeedText.getAddedMarkdown({
        roleName: "Incident Commander",
        incident: INCIDENT,
        person: DEANE,
        isSelf: false,
        cause: { kind: "stateChange", stateName: "Acknowledged" },
      }).toString(),
    ).toBe(
      `👤 **[Deane Looi](https://oneuptime.example/dashboard/p/users/d)** became the **Incident Commander** of [Incident INC-18](${LINK}) when they changed its state to **Acknowledged**.`,
    );
  });

  test("a cause wins over a workflow and over self: it is what really happened", () => {
    expect(
      IncidentRoleFeedText.getAddedMarkdown({
        roleName: "Incident Commander",
        incident: INCIDENT,
        person: DEANE,
        isSelf: true,
        workflowName: "Escalate",
        cause: { kind: "stateChange", stateName: "Investigating" },
      }).toString(),
    ).toContain("became the **Incident Commander**");
  });

  test.each<[string, IncidentRoleAssignmentCause]>([
    ["a state with no name", { kind: "stateChange", stateName: "   " }],
    ["a monitor with no name", { kind: "monitor", monitorName: "" }],
  ])(
    "%s is no cause: the plain sentence stands",
    (_label: string, cause: IncidentRoleAssignmentCause) => {
      expect(
        IncidentRoleFeedText.getAddedMarkdown({
          roleName: "Responder",
          incident: INCIDENT,
          person: DEANE,
          isSelf: false,
          cause: cause,
        }).toString(),
      ).toBe(
        `👤 Added **[Deane Looi](https://oneuptime.example/dashboard/p/users/d)** as **Responder** to [Incident INC-18](${LINK}).`,
      );
    },
  );

  test("a role, a workflow, a monitor and a state are names: placed as text, never Markdown", () => {
    const markdown: string = IncidentRoleFeedText.getAddedMarkdown({
      roleName: "*On-call* [lead](https://evil.example)",
      incident: INCIDENT,
      person: DEANE,
      isSelf: false,
      workflowName: "<!channel> `x`",
    }).toString();

    expect(markdown).toContain("\\*On-call\\* \\[lead\\]");
    expect(markdown).not.toContain("<!channel>");
    expect(markdown).toContain("\\`x\\`");

    const monitor: string = IncidentRoleFeedText.getAddedMarkdown({
      roleName: "Responder",
      incident: INCIDENT,
      person: DEANE,
      isSelf: false,
      cause: { kind: "monitor", monitorName: "![x](https://t.example/p.png)" },
    }).toString();

    expect(monitor).not.toContain("![x](");

    const state: string = IncidentRoleFeedText.getAddedMarkdown({
      roleName: "Responder",
      incident: INCIDENT,
      person: DEANE,
      isSelf: false,
      cause: { kind: "stateChange", stateName: "_Fixed_" },
    }).toString();

    expect(state).toContain("**\\_Fixed\\_**");
  });
});

describe("somebody taken off a role", () => {
  test("by another person: who was taken off, by name and email", () => {
    expect(
      IncidentRoleFeedText.getRemovedMarkdown({
        roleName: "Responder",
        incident: INCIDENT,
        personName: "Deane Looi",
        personEmail: "deane.looi@example.com",
        isSelf: false,
      }).toString(),
    ).toBe(
      `👤 Removed **Deane Looi** (deane.looi@example.com) as **Responder** from [Incident INC-18](${LINK}).`,
    );
  });

  test("a person named by their email alone is not named twice", () => {
    expect(
      IncidentRoleFeedText.getRemovedMarkdown({
        roleName: "Responder",
        incident: INCIDENT,
        personName: "deane@example.com",
        isSelf: false,
      }).toString(),
    ).toBe(
      `👤 Removed **deane@example.com** as **Responder** from [Incident INC-18](${LINK}).`,
    );
  });

  test("by themselves: they left the role", () => {
    expect(
      IncidentRoleFeedText.getRemovedMarkdown({
        roleName: "Observer",
        incident: INCIDENT,
        personName: "Deane Looi",
        personEmail: "deane.looi@example.com",
        isSelf: true,
      }).toString(),
    ).toBe(`👤 Left the **Observer** role on [Incident INC-18](${LINK}).`);
  });

  test("by a workflow's step: the workflow is named", () => {
    expect(
      IncidentRoleFeedText.getRemovedMarkdown({
        roleName: "Responder",
        incident: INCIDENT,
        personName: "Deane Looi",
        personEmail: "deane.looi@example.com",
        isSelf: false,
        workflowName: "Stand down",
      }).toString(),
    ).toBe(
      `👤 Workflow **Stand down** removed **Deane Looi** (deane.looi@example.com) as **Responder** from [Incident INC-18](${LINK}).`,
    );
  });

  test("a name and an email are text", () => {
    const markdown: string = IncidentRoleFeedText.getRemovedMarkdown({
      roleName: "Responder",
      incident: INCIDENT,
      personName: "Deane](https://evil.example) <!here>",
      personEmail: "a_b@example.com",
      isSelf: false,
    }).toString();

    expect(markdown).toContain("Deane\\]");
    expect(markdown).not.toContain("<!here>");
    // An underscore inside a word starts no emphasis: it stays as typed.
    expect(markdown).toContain("(a_b@example.com)");
  });
});

describe("how the Dashboard's feed reads each sentence after its author", () => {
  /*
   * The feed puts the entry's author in front of a sentence that opens
   * with an action's verb, in lower case (FeedEntryText). An entry with no
   * author is shown as it is written.
   */
  test("another person's change reads 'Valeria added Deane Looi as Responder ...'", () => {
    const text: ReturnType<typeof getFeedEntryText> = getFeedEntryText({
      markdown: IncidentRoleFeedText.getAddedMarkdown({
        roleName: "Responder",
        incident: INCIDENT,
        person: DEANE,
        isSelf: false,
      }).toString(),
      actorName: "Valeria Mustafaeva",
    });

    expect(text.lead).toBe(
      `added **[Deane Looi](https://oneuptime.example/dashboard/p/users/d)** as **Responder** to [Incident INC-18](${LINK}).`,
    );
    expect(text.leadNamesActor).toBe(false);
  });

  test("their own reads 'Deane Looi took the Responder role on Incident INC-18'", () => {
    expect(
      getFeedEntryText({
        markdown: IncidentRoleFeedText.getAddedMarkdown({
          roleName: "Responder",
          incident: INCIDENT,
          person: DEANE,
          isSelf: true,
        }).toString(),
        actorName: "Deane Looi",
      }).lead,
    ).toBe(`took the **Responder** role on [Incident INC-18](${LINK}).`);

    expect(
      getFeedEntryText({
        markdown: IncidentRoleFeedText.getRemovedMarkdown({
          roleName: "Responder",
          incident: INCIDENT,
          personName: "Deane Looi",
          isSelf: true,
        }).toString(),
        actorName: "Deane Looi",
      }).lead,
    ).toBe(`left the **Responder** role on [Incident INC-18](${LINK}).`);
  });

  test("a workflow's, a monitor's and OneUptime's own are drawn as they are written", () => {
    for (const markdown of [
      IncidentRoleFeedText.getAddedMarkdown({
        roleName: "Responder",
        incident: INCIDENT,
        person: DEANE,
        isSelf: false,
        workflowName: "Page SRE",
      }),
      IncidentRoleFeedText.getAddedMarkdown({
        roleName: "Responder",
        incident: INCIDENT,
        person: DEANE,
        isSelf: false,
        cause: { kind: "monitor", monitorName: "API Health" },
      }),
      IncidentRoleFeedText.getAddedMarkdown({
        roleName: "Incident Commander",
        incident: INCIDENT,
        person: DEANE,
        isSelf: false,
        cause: { kind: "stateChange", stateName: "Acknowledged" },
      }),
    ]) {
      const text: ReturnType<typeof getFeedEntryText> = getFeedEntryText({
        markdown: markdown.toString(),
      });

      expect(text.lead).toBeUndefined();
      // The emoji goes - the feed has an icon of its kind - and nothing else.
      expect(text.body).toBe(markdown.toString().replace("👤 ", ""));
    }
  });
});

describe("who a change was by, read from its props", () => {
  test("a workflow's step, which names no person and no key", () => {
    const props: DatabaseCommonInteractionProps = {
      userType: UserType.Workflow,
      workflowId: WORKFLOW,
      workflowName: "Page SRE",
    };

    expect(IncidentRoleFeedText.getWorkflowName(props)).toBe("Page SRE");
  });

  test.each<[string, DatabaseCommonInteractionProps | null | undefined]>([
    [
      "a person's request",
      { userId: PERSON, workflowName: "ignored", workflowId: WORKFLOW },
    ],
    [
      "an API key's",
      { apiKeyId: KEY, apiKeyName: "Jira", workflowName: "ignored" },
    ],
    ["OneUptime's own", { isRoot: true }],
    ["a workflow with no name", { workflowId: WORKFLOW, workflowName: "  " }],
    ["nothing", null],
    ["nothing at all", undefined],
  ])(
    "no workflow for %s",
    (
      _label: string,
      props: DatabaseCommonInteractionProps | null | undefined,
    ) => {
      expect(IncidentRoleFeedText.getWorkflowName(props)).toBeUndefined();
    },
  );
});

describe("why OneUptime gave the role, carried in a create's miscDataProps", () => {
  test("goes there and back for OneUptime's own write", () => {
    for (const cause of [
      { kind: "stateChange", stateName: "Acknowledged" },
      { kind: "monitor", monitorName: "API Health" },
    ] as Array<IncidentRoleAssignmentCause>) {
      expect(
        IncidentRoleFeedText.readCause({
          miscDataProps: IncidentRoleFeedText.toMiscDataProps(cause),
          props: { isRoot: true },
        }),
      ).toEqual(cause);
    }
  });

  test("a request can never say it: only a root write's cause is read", () => {
    const miscDataProps: JSONObject = IncidentRoleFeedText.toMiscDataProps({
      kind: "stateChange",
      stateName: "Acknowledged",
    });

    for (const props of [
      { userId: PERSON, tenantId: PERSON },
      { apiKeyId: KEY, tenantId: PERSON },
      { userType: UserType.Workflow, workflowName: "W" },
      { isRoot: false },
      {},
    ] as Array<DatabaseCommonInteractionProps>) {
      expect(
        IncidentRoleFeedText.readCause({
          miscDataProps: miscDataProps,
          props: props,
        }),
      ).toBeNull();
    }
  });

  test.each<[string, unknown]>([
    ["nothing", undefined],
    ["a string", "stateChange"],
    ["a list", [{ kind: "monitor", monitorName: "X" }]],
    ["an unknown kind", { kind: "rule", ruleName: "R" }],
    ["a state with no name", { kind: "stateChange", stateName: " " }],
    ["a state name that is no text", { kind: "stateChange", stateName: 7 }],
    ["a monitor with no name", { kind: "monitor" }],
  ])("%s is no cause", (_label: string, value: unknown) => {
    expect(
      IncidentRoleFeedText.readCause({
        miscDataProps: { [INCIDENT_ROLE_CAUSE_KEY]: value } as JSONObject,
        props: { isRoot: true },
      }),
    ).toBeNull();
  });

  test("no miscDataProps, no cause", () => {
    expect(
      IncidentRoleFeedText.readCause({
        miscDataProps: undefined,
        props: { isRoot: true },
      }),
    ).toBeNull();
    expect(
      IncidentRoleFeedText.readCause({
        miscDataProps: null,
        props: { isRoot: true },
      }),
    ).toBeNull();
  });
});

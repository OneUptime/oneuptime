import { afterEach, describe, expect, jest, test } from "@jest/globals";
import crypto from "crypto";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger from "../../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import {
  WORKSPACE_CHECKBOX_TICKED_VALUE,
  WorkspaceCheckboxBlock,
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspaceModalBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import {
  SecurityPlaybookApprovalAsk,
  SecurityPlaybookApprovalEvidenceKind,
  SecurityPlaybookApprovalProgress,
  SecurityPlaybookApprovalSource,
  SecurityPlaybookApprovalSourceKind,
  SecurityPlaybookApprovalStandingKind,
} from "../../../../Utils/SecurityPlaybook/SecurityPlaybookApprovalWords";
import { WorkspaceConnectRequestAgainKind } from "../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import TokenSigningKey from "../../../../Server/Utils/TokenSigningKey";
import { SecurityPlaybookApprovalRound } from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookApprovalReader";
import SlackActionType from "../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import WorkspaceSecurityPlaybookApprovalPress from "../../../../Server/Utils/Workspace/WorkspaceSecurityPlaybookApprovalPress";
import WorkspaceSecurityPlaybookApproval, {
  SecurityPlaybookApprovalMessage,
} from "../../../../Server/Utils/Workspace/WorkspaceSecurityPlaybookApproval";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import { htmlAsText } from "../../../Helpers/HtmlText";
import { marked } from "marked";

/*
 * THE MESSAGE A PLAYBOOK STEP WAITING FOR APPROVAL IS, IN SLACK AND
 * MICROSOFT TEAMS (#10341): ITS BUTTONS, WHAT THEY CARRY, AND THE PAYLOAD
 * EACH CHAT IS SENT FOR EACH SOURCE OF AN APPROVAL.
 */

const ROUND: SecurityPlaybookApprovalRound = {
  projectId: new ObjectID("0aa00000-0000-4000-8000-000000000001"),
  runId: new ObjectID("0aa00000-0000-4000-8000-000000000002"),
  securityCaseId: new ObjectID("0aa00000-0000-4000-8000-000000000003"),
  stepIndex: 1,
  stepId: "contain",
  targetsDigest: "abcdefghijklmnopqrstuv",
};

const CASE_URL: string =
  "https://oneuptime.example.com/dashboard/p/security-events/cases/c/playbook-runs";

function askOf(
  overrides: Partial<SecurityPlaybookApprovalAsk> = {},
): SecurityPlaybookApprovalAsk {
  return {
    caseNumber: "SEC-12",
    caseTitle: "Credential stuffing",
    caseUrl: CASE_URL,
    action: SecurityPlaybookActionType.SuspendOktaUser,
    connectionName: "Okta (acme)",
    targets: [
      {
        value: "alice@acme.com",
        reason: SecurityPlaybookTargetReason.GroupedOn,
        state: SecurityPlaybookTargetState.Proposed,
      },
      {
        value: "bob@acme.com",
        reason: SecurityPlaybookTargetReason.ThreatIntel,
        state: SecurityPlaybookTargetState.Proposed,
      },
      {
        value: "ceo@acme.com",
        state: SecurityPlaybookTargetState.Protected,
        protectedBy: "ceo@acme.com",
      },
    ],
    source: {
      kind: SecurityPlaybookApprovalSourceKind.Playbook,
      playbookName: "Contain account takeover",
      trigger: SecurityPlaybookTrigger.CaseOpened,
    },
    evidence: [{ kind: SecurityPlaybookApprovalEvidenceKind.NotProtected }],
    undoAction: SecurityPlaybookActionType.UnsuspendOktaUser,
    standing: { kind: SecurityPlaybookApprovalStandingKind.Waiting },
    ...overrides,
  };
}

function buttonsOf(
  message: SecurityPlaybookApprovalMessage,
): Array<WorkspaceMessagePayloadButton> {
  return message.messageBlocks
    .filter((block: WorkspaceMessageBlock): boolean => {
      return block._type === "WorkspacePayloadButtons";
    })
    .flatMap(
      (block: WorkspaceMessageBlock): Array<WorkspaceMessagePayloadButton> => {
        return (block as WorkspacePayloadButtons).buttons;
      },
    );
}

function markdownOf(message: SecurityPlaybookApprovalMessage): string {
  return message.messageBlocks
    .map((block: WorkspaceMessageBlock): string => {
      return (block as WorkspacePayloadMarkdown).text || "";
    })
    .join("\n---\n");
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what the buttons carry", () => {
  test("a value this installation signed reads back as the round it names", () => {
    const value: string = WorkspaceSecurityPlaybookApproval.encodeValue(ROUND);

    expect(value.startsWith("spa1.")).toBe(true);
    expect(WorkspaceSecurityPlaybookApproval.readValue(value)).toEqual(ROUND);
  });

  test("a forged value - changed by a character, signed with another key, made up, or not text - names nothing", () => {
    const value: string = WorkspaceSecurityPlaybookApproval.encodeValue(ROUND);
    const [prefix, payload, signature] = value.split(".") as [
      string,
      string,
      string,
    ];

    // Another project's run, under the same signature.
    const forgedPayload: string = Buffer.from(
      JSON.stringify([
        ObjectID.generate().toString(),
        ROUND.runId.toString(),
        ROUND.securityCaseId.toString(),
        ROUND.stepIndex,
        ROUND.stepId,
        ROUND.targetsDigest,
      ]),
      "utf8",
    ).toString("base64url");

    // Signed as a value of another purpose would be.
    const otherKeySignature: string = crypto
      .createHmac("sha256", TokenSigningKey.deriveKey("another-purpose"))
      .update(payload, "utf8")
      .digest("base64url");

    for (const forged of [
      `${prefix}.${forgedPayload}.${signature}`,
      `${prefix}.${payload}.${otherKeySignature}`,
      `${prefix}.${payload}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`,
      `pna1.${payload}.${signature}`,
      `${prefix}.${payload}`,
      ROUND.runId.toString(),
      "",
      `${value}${"x".repeat(2000)}`,
      undefined,
      12,
      { value },
    ]) {
      expect(WorkspaceSecurityPlaybookApproval.readValue(forged)).toBeNull();
    }
  });

  test("a signed value whose fields do not read as a round names nothing", () => {
    const sign: (fields: Array<unknown>) => string = (
      fields: Array<unknown>,
    ): string => {
      const payload: string = Buffer.from(
        JSON.stringify(fields),
        "utf8",
      ).toString("base64url");
      const signature: string = crypto
        .createHmac(
          "sha256",
          TokenSigningKey.deriveKey(
            "workspace-security-playbook-approval-button",
          ),
        )
        .update(payload, "utf8")
        .digest("base64url");

      return `spa1.${payload}.${signature}`;
    };

    const good: Array<unknown> = [
      ROUND.projectId.toString(),
      ROUND.runId.toString(),
      ROUND.securityCaseId.toString(),
      ROUND.stepIndex,
      ROUND.stepId,
      ROUND.targetsDigest,
    ];

    expect(WorkspaceSecurityPlaybookApproval.readValue(sign(good))).toEqual(
      ROUND,
    );

    for (const fields of [
      good.slice(0, 5),
      ["not-an-id", ...good.slice(1)],
      [...good.slice(0, 3), -1, ...good.slice(4)],
      [...good.slice(0, 3), 1.5, ...good.slice(4)],
      [...good.slice(0, 4), "", good[5]],
      [...good.slice(0, 4), "s".repeat(101), good[5]],
      [...good.slice(0, 5), "short"],
    ]) {
      expect(
        WorkspaceSecurityPlaybookApproval.readValue(sign(fields)),
      ).toBeNull();
    }
  });

  test("the project a press is about is read from its value - only this installation's, only an approval's", () => {
    const value: string = WorkspaceSecurityPlaybookApproval.encodeValue(ROUND);

    expect(
      WorkspaceSecurityPlaybookApproval.getSignedProjectId([
        {
          actionType: SlackActionType.ApproveSecurityPlaybookStep,
          actionValue: value,
        },
      ]),
    ).toBe(ROUND.projectId.toString());

    expect(
      WorkspaceSecurityPlaybookApproval.getSignedProjectId([
        { actionType: SlackActionType.AcknowledgeIncident, actionValue: value },
        {
          actionType: SlackActionType.RejectSecurityPlaybookStep,
          actionValue: "spa1.forged.value",
        },
      ]),
    ).toBeUndefined();
  });

  test("a press from an account not connected yet is asked to connect, and to press again - never decided for them", () => {
    expect(
      WorkspaceSecurityPlaybookApprovalPress.describe({
        actionType: SlackActionType.ApproveSecurityPlaybookStep,
      }),
    ).toEqual({
      purpose: "approve this playbook step",
      again: {
        kind: WorkspaceConnectRequestAgainKind.Button,
        label: "Approve",
      },
    });
    expect(
      WorkspaceSecurityPlaybookApprovalPress.describe({
        actionType: SlackActionType.SubmitApproveSomeSecurityPlaybookStep,
      }),
    ).toEqual({
      purpose: "approve this playbook step",
      again: {
        kind: WorkspaceConnectRequestAgainKind.Button,
        label: "Approve Some…",
      },
    });
    expect(
      WorkspaceSecurityPlaybookApprovalPress.describe({
        actionType: SlackActionType.RejectSecurityPlaybookStep,
      }),
    ).toEqual({
      purpose: "reject this playbook step",
      again: { kind: WorkspaceConnectRequestAgainKind.Button, label: "Reject" },
    });
    expect(
      WorkspaceSecurityPlaybookApprovalPress.describe({
        actionType: SlackActionType.AcknowledgeIncident,
      }),
    ).toBeNull();
  });
});

describe("the message", () => {
  test("while it waits: the evidence, then Approve, Approve Some…, Reject and Open Case, each decision carrying the signed round", () => {
    const message: SecurityPlaybookApprovalMessage =
      WorkspaceSecurityPlaybookApproval.getMessage({
        ask: askOf(),
        round: ROUND,
        workspaceType: WorkspaceType.Slack,
      });
    const buttons: Array<WorkspaceMessagePayloadButton> = buttonsOf(message);
    const value: string = WorkspaceSecurityPlaybookApproval.encodeValue(ROUND);

    expect(
      buttons.map((button: WorkspaceMessagePayloadButton): Array<unknown> => {
        return [button.title, button.actionId, button.isPrimary === true];
      }),
    ).toEqual([
      ["Approve", SlackActionType.ApproveSecurityPlaybookStep, true],
      [
        "Approve Some…",
        SlackActionType.ViewApproveSomeSecurityPlaybookStep,
        false,
      ],
      ["Reject", SlackActionType.RejectSecurityPlaybookStep, false],
      ["Open Case", SlackActionType.OpenInOneUptime, false],
    ]);
    expect(
      buttons
        .slice(0, 3)
        .map((button: WorkspaceMessagePayloadButton): string => {
          return button.value;
        }),
    ).toEqual([value, value, value]);
    // Open Case opens the approval on the case, and decides nothing.
    expect(buttons[3]!.url?.toString()).toBe(CASE_URL);
    expect(buttons[3]!.value).toBe("");

    const markdown: string = markdownOf(message);

    expect(markdown).toContain("⏸️ **Approval needed on [SEC-12](");
    expect(markdown).toContain(
      "**Suspend the user in Okta**, through Okta (acme)\n• `alice@acme.com`: the case is grouped on it\n• `bob@acme.com`: known to threat intel",
    );
    expect(markdown).toContain(
      "Asked by playbook **Contain account takeover**, which started when the case opened.",
    );
    expect(markdown).toContain(
      "• Nothing it acts on is on your protected list.",
    );
    expect(markdown).toContain(
      "Can be undone: each one, with **Unsuspend the user in Okta** on the case.",
    );
    expect(markdown).toContain(
      "Approve runs this step now, as you. Approve Some lets you leave some out. Reject ends the run.",
    );
    expect(message.notificationText).toBe(
      "Approval needed on SEC-12: Credential stuffing",
    );
  });

  test("a step with one target to act on has no Approve Some…", () => {
    const message: SecurityPlaybookApprovalMessage =
      WorkspaceSecurityPlaybookApproval.getMessage({
        ask: askOf({ targets: [askOf().targets[0]!] }),
        round: ROUND,
        workspaceType: WorkspaceType.Slack,
      });

    expect(
      buttonsOf(message).map(
        (button: WorkspaceMessagePayloadButton): string => {
          return button.actionId;
        },
      ),
    ).toEqual([
      SlackActionType.ApproveSecurityPlaybookStep,
      SlackActionType.RejectSecurityPlaybookStep,
      SlackActionType.OpenInOneUptime,
    ]);
  });

  test("once decided, every copy says who and when and how the step went, with Open Case only", () => {
    const approved: SecurityPlaybookApprovalMessage =
      WorkspaceSecurityPlaybookApproval.getMessage({
        ask: askOf({
          targets: [
            {
              value: "alice@acme.com",
              state: SecurityPlaybookTargetState.Done,
              detail: "suspended",
            },
            {
              value: "bob@acme.com",
              state: SecurityPlaybookTargetState.LeftOut,
            },
          ],
          standing: {
            kind: SecurityPlaybookApprovalStandingKind.Approved,
            deciderName: "Jane Doe",
            decidedAt: new Date("2026-11-20T10:43:00.000Z"),
            progress: SecurityPlaybookApprovalProgress.Done,
            completedAt: new Date("2026-11-20T10:43:05.000Z"),
          },
        }),
        round: ROUND,
        workspaceType: WorkspaceType.Slack,
      });

    expect(
      buttonsOf(approved).map(
        (button: WorkspaceMessagePayloadButton): string => {
          return button.actionId;
        },
      ),
    ).toEqual([SlackActionType.OpenInOneUptime]);

    const markdown: string = markdownOf(approved);

    // Each moment in the reader's own time (WorkspaceMessageTime).
    expect(markdown).toContain(
      "✅ **Approved by Jane Doe at {{TIME(2026-11-20T10:43:00Z)}}** Done at {{TIME(2026-11-20T10:43:05Z)}}.",
    );
    expect(markdown).toContain("• `alice@acme.com`: done · suspended");
    expect(markdown).toContain("• `bob@acme.com`: left out by the approver");
    expect(markdown).not.toContain("Approve runs this step now");
    expect(approved.notificationText).toBe(
      "Approved by Jane Doe at 10:43 UTC Done at 10:43 UTC.",
    );

    const rejected: string = markdownOf(
      WorkspaceSecurityPlaybookApproval.getMessage({
        ask: askOf({
          standing: {
            kind: SecurityPlaybookApprovalStandingKind.Rejected,
            deciderName: "Jane Doe",
            decidedAt: new Date("2026-11-20T10:43:00.000Z"),
          },
        }),
        round: ROUND,
        workspaceType: WorkspaceType.Slack,
      }),
    );

    expect(rejected).toContain(
      "❌ **Rejected by Jane Doe at {{TIME(2026-11-20T10:43:00Z)}}. Nothing was done.**",
    );

    const cancelled: string = markdownOf(
      WorkspaceSecurityPlaybookApproval.getMessage({
        ask: askOf({
          standing: {
            kind: SecurityPlaybookApprovalStandingKind.NoLongerWaiting,
            isRunCancelled: true,
          },
        }),
        round: ROUND,
        workspaceType: WorkspaceType.Slack,
      }),
    );

    expect(cancelled).toContain(
      "⏹️ **No longer waiting for approval: the run was cancelled.**",
    );
  });

  test("a Microsoft Teams card sets each line as a paragraph of its own", () => {
    const markdown: string = markdownOf(
      WorkspaceSecurityPlaybookApproval.getMessage({
        ask: askOf(),
        round: ROUND,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    );

    expect(markdown).toContain(
      "**Suspend the user in Okta**, through Okta (acme)\n\n• `alice@acme.com`: the case is grouped on it\n\n• `bob@acme.com`: known to threat intel",
    );
  });

  test("an approver's own copy is in the language on their account", () => {
    const message: SecurityPlaybookApprovalMessage =
      WorkspaceSecurityPlaybookApproval.getMessage({
        ask: askOf(),
        round: ROUND,
        workspaceType: WorkspaceType.Slack,
        language: "de",
      });

    expect(
      buttonsOf(message).map(
        (button: WorkspaceMessagePayloadButton): string => {
          return button.title;
        },
      ),
    ).toEqual([
      "Genehmigen",
      "Teilweise genehmigen…",
      "Ablehnen",
      "Fall öffnen",
    ]);
    expect(markdownOf(message)).toContain(
      "**Benutzer in Okta sperren**, über Okta (acme)",
    );
    expect(message.notificationText).toBe(
      "Genehmigung nötig für SEC-12: Credential stuffing",
    );
  });
});

/*
 * A case's title, a connection's name and an approver's name are what
 * someone wrote - an attacker, through what a case is named after, the
 * project, or a person. In the message, whatever it stands at, and in
 * Approve Some… each reads as typed: no link, image, HTML, bold or mention
 * of theirs, and the case's own link is the only link.
 */
describe("a name with markup in it reads as plain text", () => {
  const HOSTILE: string =
    "[Reset your password](https://evil.example/login) <img src=x onerror=alert(1)> **now** <!channel>";

  // What a reader sees of the Markdown, as an email renders it.
  function rendered(markdown: string): { html: string; text: string } {
    const html: string = marked.parse(markdown, { async: false }) as string;

    return {
      html,
      text: FeedMarkdown.withoutInvisibleBreaks(htmlAsText(html)).replace(
        /\s+/g,
        " ",
      ),
    };
  }

  /*
   * The addresses of the links whose words are not the address they open.
   * A bare address in a name is made a link by every renderer, one that
   * shows where it goes; a link whose words hide where it goes is what a
   * name must never make.
   */
  function hiddenLinksIn(html: string): Array<string> {
    return Array.from(html.matchAll(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g))
      .filter((match: RegExpMatchArray): boolean => {
        return (
          FeedMarkdown.withoutInvisibleBreaks(htmlAsText(match[2]!)).trim() !==
          htmlAsText(match[1]!)
        );
      })
      .map((match: RegExpMatchArray): string => {
        return htmlAsText(match[1]!);
      });
  }

  const DECIDED_AT: Date = new Date("2026-11-20T10:43:00.000Z");

  test.each([
    [
      "waiting",
      { kind: SecurityPlaybookApprovalStandingKind.Waiting },
      `SEC-12: ${HOSTILE}`,
    ],
    [
      "approved, and done",
      {
        kind: SecurityPlaybookApprovalStandingKind.Approved,
        deciderName: HOSTILE,
        decidedAt: DECIDED_AT,
        progress: SecurityPlaybookApprovalProgress.Done,
        completedAt: new Date("2026-11-20T10:43:05.000Z"),
      },
      `Approved by ${HOSTILE}`,
    ],
    [
      "rejected",
      {
        kind: SecurityPlaybookApprovalStandingKind.Rejected,
        deciderName: HOSTILE,
        decidedAt: DECIDED_AT,
      },
      HOSTILE,
    ],
    [
      "no longer waiting",
      {
        kind: SecurityPlaybookApprovalStandingKind.NoLongerWaiting,
        isRunCancelled: true,
      },
      "",
    ],
  ])(
    "in the message, %s",
    (
      _name: string,
      standing: SecurityPlaybookApprovalAsk["standing"],
      headlineSays: string,
    ) => {
      const message: SecurityPlaybookApprovalMessage =
        WorkspaceSecurityPlaybookApproval.getMessage({
          ask: askOf({
            caseTitle: HOSTILE,
            connectionName: HOSTILE,
            standing,
          }),
          round: ROUND,
          workspaceType: WorkspaceType.Slack,
        });
      const markdown: string = markdownOf(message);
      const { html, text } = rendered(markdown);

      expect(markdown).not.toContain(
        "[Reset your password](https://evil.example",
      );
      expect(markdown).not.toContain("<!channel>");
      expect(html).not.toMatch(/<(img|script)\b/);
      // The case's own link is the only one with words, and only a waiting headline has it.
      expect(hiddenLinksIn(html)).toEqual(
        standing.kind === SecurityPlaybookApprovalStandingKind.Waiting
          ? [CASE_URL]
          : [],
      );
      // The headline and the action read the names as they were written.
      expect(text).toContain(headlineSays);
      expect(text).toContain(`through ${HOSTILE}`);
      // Only the message's own words are bold: the name's asterisks are text.
      expect(html).not.toContain("<strong>now</strong>");
      expect(text).toContain("**now**");
    },
  );

  test("in Approve Some…'s intro", () => {
    const form: WorkspaceModalBlock =
      WorkspaceSecurityPlaybookApproval.getApproveSomeForm({
        ask: askOf({ connectionName: HOSTILE }),
        round: ROUND,
      });
    const intro: string = (
      form.blocks.find((block: WorkspaceMessageBlock): boolean => {
        return block._type === "WorkspacePayloadMarkdown";
      }) as WorkspacePayloadMarkdown
    ).text;
    const { html, text } = rendered(intro);

    expect(intro).not.toContain("[Reset your password](https://evil.example");
    expect(intro).not.toContain("<!channel>");
    expect(html).not.toMatch(/<(img|script)\b/);
    expect(hiddenLinksIn(html)).toEqual([]);
    expect(html).not.toContain("<strong>now</strong>");
    expect(text).toContain(`through ${HOSTILE}`);
    // The form's own sentence follows as a paragraph of its own.
    expect(html.match(/<p>/g)!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Approve Some…", () => {
  test("a box for each target the step proposes, every one ticked, and the round it approves", () => {
    const form: WorkspaceModalBlock =
      WorkspaceSecurityPlaybookApproval.getApproveSomeForm({
        ask: askOf(),
        round: ROUND,
      });

    expect(form.title).toBe("Approve Some");
    expect(form.submitButtonTitle).toBe("Approve");
    expect(form.cancelButtonTitle).toBe("Cancel");
    expect(form.actionId).toBe(
      SlackActionType.SubmitApproveSomeSecurityPlaybookStep,
    );
    expect(
      WorkspaceSecurityPlaybookApproval.readValue(form.actionValue),
    ).toEqual(ROUND);

    const boxes: Array<WorkspaceCheckboxBlock> = form.blocks.filter(
      (block: WorkspaceMessageBlock): boolean => {
        return block._type === "WorkspaceCheckboxBlock";
      },
    ) as Array<WorkspaceCheckboxBlock>;

    // The protected one is never offered: it is never acted on.
    expect(
      boxes.map((box: WorkspaceCheckboxBlock): Array<unknown> => {
        return [
          box.blockId,
          box.label,
          box.optionLabel,
          box.initialValue,
          box.optional,
        ];
      }),
    ).toEqual([
      [
        "approveTarget0",
        "alice@acme.com: the case is grouped on it",
        "alice@acme.com",
        true,
        true,
      ],
      [
        "approveTarget1",
        "bob@acme.com: known to threat intel",
        "bob@acme.com",
        true,
        true,
      ],
    ]);
  });

  test("its submission keeps the targets whose boxes are still ticked, in the order the step proposed them", () => {
    const ask: SecurityPlaybookApprovalAsk = askOf();

    expect(
      WorkspaceSecurityPlaybookApproval.readKeptTargets({
        ask,
        isTicked: (field: string): boolean => {
          return field === "approveTarget1";
        },
      }),
    ).toEqual(["bob@acme.com"]);
    expect(
      WorkspaceSecurityPlaybookApproval.readKeptTargets({
        ask,
        isTicked: (): boolean => {
          return false;
        },
      }),
    ).toEqual([]);

    expect(
      WorkspaceSecurityPlaybookApproval.isSlackBoxTicked([
        WORKSPACE_CHECKBOX_TICKED_VALUE,
      ]),
    ).toBe(true);
    expect(WorkspaceSecurityPlaybookApproval.isSlackBoxTicked([])).toBe(false);
    expect(WorkspaceSecurityPlaybookApproval.isSlackBoxTicked(undefined)).toBe(
      false,
    );
    expect(WorkspaceSecurityPlaybookApproval.isSlackBoxTicked("value")).toBe(
      false,
    );
  });
});

describe("the payload Slack and Microsoft Teams are sent, for each source of an approval", () => {
  const SOURCES: Array<[string, SecurityPlaybookApprovalSource, string]> = [
    [
      "a playbook that started on its own",
      {
        kind: SecurityPlaybookApprovalSourceKind.Playbook,
        playbookName: "Contain account takeover",
        trigger: SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
      },
      "Asked by playbook Contain account takeover, which started when OneUptime AI triaged the case as likely malicious.",
    ],
    [
      "a person",
      {
        kind: SecurityPlaybookApprovalSourceKind.Person,
        playbookName: "Contain account takeover",
        personName: "Nawaz Dhandala",
      },
      "Asked by Nawaz Dhandala, who started playbook Contain account takeover by hand.",
    ],
    [
      "an automatic response policy",
      {
        kind: SecurityPlaybookApprovalSourceKind.AutomaticResponse,
        playbookName: "",
        policyName: "Block password guessing",
      },
      "Asked by the automatic response policy Block password guessing.",
    ],
    [
      "OneUptime AI",
      {
        kind: SecurityPlaybookApprovalSourceKind.OneUptimeAi,
        playbookName: "",
      },
      "Asked by OneUptime AI, which is working the case.",
    ],
  ];

  test.each(SOURCES)(
    "%s: Slack's blocks carry the evidence and the buttons",
    (_name: string, source: SecurityPlaybookApprovalSource, said: string) => {
      const message: SecurityPlaybookApprovalMessage =
        WorkspaceSecurityPlaybookApproval.getMessage({
          ask: askOf({ source }),
          round: ROUND,
          workspaceType: WorkspaceType.Slack,
        });
      const blocks: Array<JSONObject> =
        SlackUtil.getBlocksFromWorkspaceMessagePayload({
          messageBlocks: message.messageBlocks,
        });
      const json: string = JSON.stringify(blocks);
      const value: string =
        WorkspaceSecurityPlaybookApproval.encodeValue(ROUND);

      // Slack's mrkdwn: bold is one star, the playbook's name stays bold.
      expect(json).toContain(said.split(" ").slice(0, 2).join(" "));
      expect(json).toContain("alice@acme.com");
      expect(json).toContain("Nothing it acts on is on your protected list.");

      const actions: Array<JSONObject> = blocks
        .filter((block: JSONObject): boolean => {
          return block["type"] === "actions";
        })
        .flatMap((block: JSONObject): Array<JSONObject> => {
          return block["elements"] as Array<JSONObject>;
        });

      expect(
        actions.map((action: JSONObject): Array<unknown> => {
          return [
            action["action_id"],
            action["value"] || null,
            action["url"] || null,
          ];
        }),
      ).toEqual([
        [SlackActionType.ApproveSecurityPlaybookStep, value, null],
        [SlackActionType.ViewApproveSomeSecurityPlaybookStep, value, null],
        [SlackActionType.RejectSecurityPlaybookStep, value, null],
        [SlackActionType.OpenInOneUptime, null, CASE_URL],
      ]);
      expect(actions[0]!["style"]).toBe("primary");
    },
  );

  test.each(SOURCES)(
    "%s: the Teams card carries the evidence and the buttons by Slack's ids",
    (_name: string, source: SecurityPlaybookApprovalSource, said: string) => {
      const message: SecurityPlaybookApprovalMessage =
        WorkspaceSecurityPlaybookApproval.getMessage({
          ask: askOf({ source }),
          round: ROUND,
          workspaceType: WorkspaceType.MicrosoftTeams,
        });
      const card: JSONObject =
        MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
          messageBlocks: message.messageBlocks,
        });
      const texts: string = (card["body"] as Array<JSONObject>)
        .map((element: JSONObject): string => {
          return String(element["text"] || "");
        })
        .join("\n");
      const value: string =
        WorkspaceSecurityPlaybookApproval.encodeValue(ROUND);

      expect(texts).toContain(said.split(" ").slice(0, 2).join(" "));
      expect(texts).toContain("`alice@acme.com`: the case is grouped on it");

      expect(
        (card["actions"] as Array<JSONObject>).map(
          (action: JSONObject): Array<unknown> => {
            return [
              action["type"],
              (action["data"] as JSONObject | undefined)?.["action"] || null,
              (action["data"] as JSONObject | undefined)?.["actionValue"] ||
                null,
              action["url"] || null,
            ];
          },
        ),
      ).toEqual([
        [
          "Action.Submit",
          SlackActionType.ApproveSecurityPlaybookStep,
          value,
          null,
        ],
        [
          "Action.Submit",
          SlackActionType.ViewApproveSomeSecurityPlaybookStep,
          value,
          null,
        ],
        [
          "Action.Submit",
          SlackActionType.RejectSecurityPlaybookStep,
          value,
          null,
        ],
        ["Action.OpenUrl", null, null, CASE_URL],
      ]);
      expect((card["actions"] as Array<JSONObject>)[0]!["style"]).toBe(
        "positive",
      );
    },
  );

  test("each source's own sentence is what the message says asked", () => {
    for (const [, source, said] of SOURCES) {
      const markdown: string = markdownOf(
        WorkspaceSecurityPlaybookApproval.getMessage({
          ask: askOf({ source }),
          round: ROUND,
          workspaceType: WorkspaceType.Slack,
        }),
      );

      // Names are bold in the message; the sentence is the same.
      expect(markdown.split("**").join("")).toContain(said);
    }
  });
});

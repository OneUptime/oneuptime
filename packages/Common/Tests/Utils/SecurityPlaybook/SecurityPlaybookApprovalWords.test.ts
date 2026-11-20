import { describe, expect, test } from "@jest/globals";
import { getServerTranslator } from "../../../Server/Utils/ServerTranslation";
import {
  SECURITY_PLAYBOOK_ACTIONS,
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  SECURITY_PLAYBOOK_ACTION_TITLE_WORDS,
  getSecurityPlaybookActionTitleWords,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookActionWords";
import {
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { READER_LANGUAGE_CODES } from "../../../Types/ReaderLanguage";
import { Translator } from "../../../Types/Translator";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import {
  SECURITY_PLAYBOOK_APPROVAL_WORDS,
  SecurityPlaybookApprovalAnswerKind,
  SecurityPlaybookApprovalAsk,
  SecurityPlaybookApprovalEvidenceKind,
  SecurityPlaybookApprovalLine,
  SecurityPlaybookApprovalProgress,
  SecurityPlaybookApprovalSourceKind,
  SecurityPlaybookApprovalStandingKind,
  SecurityPlaybookApprovalTime,
  SecurityPlaybookApprovalWording,
  SecurityPlaybookApprovalWordingContext,
  getProposedTargets,
  getSecurityPlaybookApprovalButtonWords,
  getSecurityPlaybookApprovalFormWords,
  offersApproveSome,
  wordSecurityPlaybookApproval,
  wordSecurityPlaybookApprovalAnswer,
} from "../../../Utils/SecurityPlaybook/SecurityPlaybookApprovalWords";

/*
 * A STEP WAITING FOR APPROVAL SAYS WHAT IT DOES, TO WHAT, WHY, WHO ASKED,
 * THE EVIDENCE AND WHAT CAN BE UNDONE - IN EVERY LANGUAGE (#10341).
 *
 * The words are the approval's whatever chat, email or phone reads them:
 * nobody approves blind. These pin each part - every source of an
 * approval, every piece of evidence, every target's standing, every
 * decision and how the step went - that what an attacker or the project
 * wrote stays text, and that each language words all of it.
 */

const DECIDED_AT: Date = new Date("2026-11-20T10:43:00.000Z");
const COMPLETED_AT: Date = new Date("2026-11-20T10:43:05.000Z");

// A moment as a test reads it: the same in Markdown and text.
const formatTime: (date: Date) => SecurityPlaybookApprovalTime = (
  date: Date,
): SecurityPlaybookApprovalTime => {
  return {
    markdown: FeedMarkdown.asMarkdown(`<${date.toISOString()}>`),
    text: date.toISOString(),
  };
};

const contextIn: (
  language: string,
) => SecurityPlaybookApprovalWordingContext = (
  language: string,
): SecurityPlaybookApprovalWordingContext => {
  return {
    translator: getServerTranslator(language),
    productName: "OneUptime",
    formatTime,
  };
};

const ENGLISH: SecurityPlaybookApprovalWordingContext = contextIn("en");

// A step that suspends two Okta users and leaves the CEO alone.
function askOf(
  overrides: Partial<SecurityPlaybookApprovalAsk> = {},
): SecurityPlaybookApprovalAsk {
  return {
    caseNumber: "SEC-12",
    caseTitle: "Credential stuffing from 35.205.11.131",
    caseUrl:
      "https://oneuptime.example.com/dashboard/p/security-events/cases/c/playbook-runs",
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
        reason: SecurityPlaybookTargetReason.GroupedOn,
        state: SecurityPlaybookTargetState.Protected,
        protectedBy: "*@acme.com",
      },
    ],
    source: {
      kind: SecurityPlaybookApprovalSourceKind.Playbook,
      playbookName: "Contain account takeover",
      trigger: SecurityPlaybookTrigger.CaseOpened,
    },
    evidence: [
      {
        kind: SecurityPlaybookApprovalEvidenceKind.Requests,
        outcomes: {
          [SecurityEventRequestOutcome.Rejected]: 1180,
          [SecurityEventRequestOutcome.ReachedApp]: 20,
          [SecurityEventRequestOutcome.ReachedDatabase]: 4,
        },
      },
      {
        kind: SecurityPlaybookApprovalEvidenceKind.ThreatIntel,
        values: ["35.205.11.131"],
      },
      { kind: SecurityPlaybookApprovalEvidenceKind.NotProtected },
    ],
    undoAction: SecurityPlaybookActionType.UnsuspendOktaUser,
    standing: { kind: SecurityPlaybookApprovalStandingKind.Waiting },
    ...overrides,
  };
}

function texts(lines: Array<SecurityPlaybookApprovalLine>): Array<string> {
  return lines.map((line: SecurityPlaybookApprovalLine): string => {
    return line.text;
  });
}

function word(
  ask: SecurityPlaybookApprovalAsk,
  context: SecurityPlaybookApprovalWordingContext = ENGLISH,
): SecurityPlaybookApprovalWording {
  return wordSecurityPlaybookApproval({ ask, context });
}

describe("what a waiting approval says", () => {
  test("what the step does, to what and why each target is one, who asked, the evidence, and its undo", () => {
    const wording: SecurityPlaybookApprovalWording = word(askOf());

    expect(wording.headline.text).toBe(
      "Approval needed on SEC-12: Credential stuffing from 35.205.11.131",
    );
    // The case, linked to the approval on it.
    expect(wording.headline.markdown.toString()).toContain(
      "[SEC-12](https://oneuptime.example.com/dashboard/p/security-events/cases/c/playbook-runs)",
    );
    expect(wording.action.text).toBe(
      "Suspend the user in Okta, through Okta (acme)",
    );
    expect(wording.action.markdown.toString()).toBe(
      "**Suspend the user in Okta**, through Okta (acme)",
    );
    expect(texts(wording.targets)).toEqual([
      "alice@acme.com: the case is grouped on it",
      "bob@acme.com: known to threat intel",
      "ceo@acme.com: matches *@acme.com on your protected list, so it is never acted on",
    ]);
    // A target is code, never Markdown.
    expect(wording.targets[0]!.markdown.toString()).toBe(
      "`alice@acme.com`: the case is grouped on it",
    );
    expect(wording.source.text).toBe(
      "Asked by playbook Contain account takeover, which started when the case opened.",
    );
    expect(texts(wording.evidence)).toEqual([
      "1,204 requests behind the case: Turned away: 1,180, Reached the app: 20, Reached the database: 4",
      "Known to threat intel: 35.205.11.131",
      "Nothing it acts on is on your protected list.",
    ]);
    expect(wording.undo.text).toBe(
      "Can be undone: each one, with Unsuspend the user in Okta on the case.",
    );
    expect(wording.note?.text).toBe(
      "Approve runs this step now, as you. Approve Some lets you leave some out. Reject ends the run.",
    );
    expect(wording.progress).toBeUndefined();
  });

  test("a step that acts through no connection names its action alone, and one nothing undoes says so", () => {
    const wording: SecurityPlaybookApprovalWording = word(
      askOf({
        action: SecurityPlaybookActionType.EndOktaSessions,
        connectionName: undefined,
        undoAction: undefined,
      }),
    );

    expect(wording.action.text).toBe("End the user's Okta sessions");
    expect(wording.action.markdown.toString()).toBe(
      "**End the user's Okta sessions**",
    );
    expect(wording.undo.text).toBe("Cannot be undone from OneUptime.");
  });

  test("a step with one proposed target offers no Approve Some, and its note says so", () => {
    const ask: SecurityPlaybookApprovalAsk = askOf({
      targets: [askOf().targets[0]!, askOf().targets[2]!],
    });

    expect(getProposedTargets(ask)).toHaveLength(1);
    expect(offersApproveSome(ask)).toBe(false);
    expect(word(ask).note?.text).toBe(
      "Approve runs this step now, as you. Reject ends the run.",
    );
    expect(offersApproveSome(askOf())).toBe(true);
  });

  test("a protected target its own value protects says it plainly", () => {
    const wording: SecurityPlaybookApprovalWording = word(
      askOf({
        targets: [
          {
            value: "CEO@acme.com",
            state: SecurityPlaybookTargetState.Protected,
            protectedBy: "ceo@acme.com",
          },
        ],
      }),
    );

    expect(texts(wording.targets)).toEqual([
      "CEO@acme.com: on your protected list, so it is never acted on",
    ]);
  });
});

describe("who or what asked: every source of an approval", () => {
  test.each([
    [
      SecurityPlaybookTrigger.CaseOpened,
      "Asked by playbook Contain, which started when the case opened.",
    ],
    [
      SecurityPlaybookTrigger.DetectionAdded,
      "Asked by playbook Contain, which started for a new detection.",
    ],
    [
      SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
      "Asked by playbook Contain, which started when OneUptime AI triaged the case as likely malicious.",
    ],
    [
      SecurityPlaybookTrigger.Manual,
      "Asked by playbook Contain, which was started by hand.",
    ],
  ])(
    "a playbook started by %s",
    (trigger: SecurityPlaybookTrigger, said: string) => {
      expect(
        word(
          askOf({
            source: {
              kind: SecurityPlaybookApprovalSourceKind.Playbook,
              playbookName: "Contain",
              trigger,
            },
          }),
        ).source.text,
      ).toBe(said);
    },
  );

  test("a person, an automatic response policy, and OneUptime AI", () => {
    expect(
      word(
        askOf({
          source: {
            kind: SecurityPlaybookApprovalSourceKind.Person,
            playbookName: "Contain",
            personName: "Nawaz Dhandala",
          },
        }),
      ).source.text,
    ).toBe("Asked by Nawaz Dhandala, who started playbook Contain by hand.");

    expect(
      word(
        askOf({
          source: {
            kind: SecurityPlaybookApprovalSourceKind.AutomaticResponse,
            playbookName: "Contain",
            policyName: "Block password guessing",
          },
        }),
      ).source.text,
    ).toBe("Asked by the automatic response policy Block password guessing.");

    expect(
      word(
        askOf({
          source: {
            kind: SecurityPlaybookApprovalSourceKind.OneUptimeAi,
            playbookName: "Contain",
          },
        }),
      ).source.text,
    ).toBe("Asked by OneUptime AI, which is working the case.");
  });

  test("a self-hosted install's own product name", () => {
    expect(
      wordSecurityPlaybookApproval({
        ask: askOf({
          source: {
            kind: SecurityPlaybookApprovalSourceKind.OneUptimeAi,
            playbookName: "",
          },
          undoAction: undefined,
        }),
        context: { ...ENGLISH, productName: "Acme Watch" },
      }).undo.text,
    ).toBe("Cannot be undone from Acme Watch.");
  });
});

describe("the evidence", () => {
  test("requests are counted only once a trace followed them, most serious last, one in the singular", () => {
    expect(
      texts(
        word(
          askOf({
            evidence: [
              {
                kind: SecurityPlaybookApprovalEvidenceKind.Requests,
                outcomes: {
                  [SecurityEventRequestOutcome.ReachedDatabase]: 1,
                },
              },
            ],
          }),
        ).evidence,
      ),
    ).toEqual(["1 request behind the case: Reached the database: 1"]);

    expect(
      texts(
        word(
          askOf({
            evidence: [
              {
                kind: SecurityPlaybookApprovalEvidenceKind.Requests,
                outcomes: {
                  [SecurityEventRequestOutcome.Errored]: 2,
                  [SecurityEventRequestOutcome.Rejected]: 3,
                },
              },
            ],
          }),
        ).evidence,
      ),
    ).toEqual(["5 requests behind the case: Turned away: 3, Errored: 2"]);
  });

  test("requests no trace followed, and empty lists, say nothing rather than something untrue", () => {
    expect(
      word(
        askOf({
          evidence: [
            {
              kind: SecurityPlaybookApprovalEvidenceKind.Requests,
              outcomes: {},
            },
            {
              kind: SecurityPlaybookApprovalEvidenceKind.ThreatIntel,
              values: [],
            },
          ],
        }),
      ).evidence,
    ).toEqual([]);
  });

  test("an address that is not one of the project's, and one no signed-in user used (a block, #10342)", () => {
    expect(
      texts(
        word(
          askOf({
            evidence: [
              {
                kind: SecurityPlaybookApprovalEvidenceKind.NotOwnAddress,
                values: ["35.205.11.131", "35.205.11.132"],
              },
              {
                kind: SecurityPlaybookApprovalEvidenceKind.NoSignedInUser,
                values: ["35.205.11.131"],
              },
            ],
          }),
        ).evidence,
      ),
    ).toEqual([
      "Not one of your addresses: 35.205.11.131, 35.205.11.132",
      "No signed-in user used it: 35.205.11.131",
    ]);
  });
});

describe("once somebody decided", () => {
  test("approved, and how the step went: running, done, failed, or stopped before it ran", () => {
    const approved: (
      progress: SecurityPlaybookApprovalProgress,
    ) => SecurityPlaybookApprovalWording = (
      progress: SecurityPlaybookApprovalProgress,
    ): SecurityPlaybookApprovalWording => {
      return word(
        askOf({
          standing: {
            kind: SecurityPlaybookApprovalStandingKind.Approved,
            deciderName: "Jane Doe",
            decidedAt: DECIDED_AT,
            progress,
            completedAt: COMPLETED_AT,
            error: "Okta answered 403",
          },
        }),
      );
    };

    const running: SecurityPlaybookApprovalWording = approved(
      SecurityPlaybookApprovalProgress.Running,
    );

    expect(running.headline.text).toBe(
      `Approved by Jane Doe at ${DECIDED_AT.toISOString()}`,
    );
    expect(running.progress?.text).toBe("Running now.");
    // Nobody is asked any more: no note of what pressing does.
    expect(running.note).toBeUndefined();

    expect(approved(SecurityPlaybookApprovalProgress.Done).progress?.text).toBe(
      `Done at ${COMPLETED_AT.toISOString()}.`,
    );
    expect(
      approved(SecurityPlaybookApprovalProgress.Failed).progress?.text,
    ).toBe(`Failed at ${COMPLETED_AT.toISOString()}: Okta answered 403`);
    expect(
      approved(SecurityPlaybookApprovalProgress.CancelledBeforeRun).progress
        ?.text,
    ).toBe("The run was cancelled before this step ran.");
    expect(
      approved(SecurityPlaybookApprovalProgress.StoppedBeforeRun).progress
        ?.text,
    ).toBe("The run stopped before this step ran.");
  });

  test("rejected, and no longer waiting", () => {
    expect(
      word(
        askOf({
          standing: {
            kind: SecurityPlaybookApprovalStandingKind.Rejected,
            deciderName: "Jane Doe",
            decidedAt: DECIDED_AT,
          },
        }),
      ).headline.text,
    ).toBe(
      `Rejected by Jane Doe at ${DECIDED_AT.toISOString()}. Nothing was done.`,
    );

    expect(
      word(
        askOf({
          standing: {
            kind: SecurityPlaybookApprovalStandingKind.NoLongerWaiting,
            isRunCancelled: true,
          },
        }),
      ).headline.text,
    ).toBe("No longer waiting for approval: the run was cancelled.");

    expect(
      word(
        askOf({
          standing: {
            kind: SecurityPlaybookApprovalStandingKind.NoLongerWaiting,
          },
        }),
      ).headline.text,
    ).toBe("No longer waiting for approval.");
  });

  test("each target says what came of it, the product's own word after OneUptime's, and who undid it", () => {
    const wording: SecurityPlaybookApprovalWording = word(
      askOf({
        targets: [
          {
            value: "a@acme.com",
            state: SecurityPlaybookTargetState.Done,
            detail: "suspended",
          },
          {
            value: "b@acme.com",
            state: SecurityPlaybookTargetState.AlreadyDone,
          },
          { value: "c@acme.com", state: SecurityPlaybookTargetState.NotFound },
          {
            value: "d@acme.com",
            state: SecurityPlaybookTargetState.Failed,
            detail: "Okta answered 403",
          },
          { value: "e@acme.com", state: SecurityPlaybookTargetState.LeftOut },
          {
            value: "f@acme.com",
            state: SecurityPlaybookTargetState.Undone,
            undoneByName: "Ana Ruiz",
            undoneAt: COMPLETED_AT,
          },
          {
            value: "g@acme.com",
            state: SecurityPlaybookTargetState.Undone,
            undoneAt: COMPLETED_AT,
          },
        ],
        standing: {
          kind: SecurityPlaybookApprovalStandingKind.Approved,
          deciderName: "Jane Doe",
          decidedAt: DECIDED_AT,
          progress: SecurityPlaybookApprovalProgress.Done,
          completedAt: COMPLETED_AT,
        },
      }),
    );

    expect(texts(wording.targets)).toEqual([
      "a@acme.com: done · suspended",
      "b@acme.com: it already was, before the step ran",
      "c@acme.com: not found",
      "d@acme.com: failed · Okta answered 403",
      "e@acme.com: left out by the approver",
      `f@acme.com: undone by Ana Ruiz at ${COMPLETED_AT.toISOString()}`,
      `g@acme.com: undone at ${COMPLETED_AT.toISOString()}`,
    ]);
  });
});

describe("what an attacker or the project wrote stays text", () => {
  const MENTION: string = "<!channel> *urgent* [click](https://evil.example)";

  test("a target, a name, a title and a product's word never become Markdown, a link or a mention", () => {
    const wording: SecurityPlaybookApprovalWording = word(
      askOf({
        caseTitle: MENTION,
        connectionName: MENTION,
        targets: [
          {
            value: "`evil` user",
            reason: SecurityPlaybookTargetReason.GroupedOn,
            state: SecurityPlaybookTargetState.Failed,
            detail: MENTION,
          },
        ],
        source: {
          kind: SecurityPlaybookApprovalSourceKind.Person,
          playbookName: "**Contain**",
          personName: MENTION,
        },
      }),
    );

    for (const line of [
      wording.headline,
      wording.action,
      wording.targets[0]!,
      wording.source,
    ]) {
      const markdown: string = line.markdown.toString();

      expect(markdown).not.toContain("<!channel>");
      expect(markdown).not.toContain("[click](https://evil.example)");
      // The text keeps what was written, as it was written.
      expect(line.text.length).toBeGreaterThan(0);
    }

    expect(wording.targets[0]!.text).toBe(`\`evil\` user: failed · ${MENTION}`);
    expect(wording.source.text).toBe(
      `Asked by ${MENTION}, who started playbook **Contain** by hand.`,
    );
    // The playbook's name is bold, its own asterisks escaped.
    expect(wording.source.markdown.toString()).toContain(
      "**\\*\\*Contain\\*\\***",
    );
  });
});

describe("what a press is answered with", () => {
  test.each([
    [
      SecurityPlaybookApprovalAnswerKind.Approved,
      "You approved it. The step is running now, and this message shows how it goes.",
    ],
    [
      SecurityPlaybookApprovalAnswerKind.Rejected,
      "You rejected it. The run has ended, and nothing was done.",
    ],
    [
      SecurityPlaybookApprovalAnswerKind.AlreadyApproved,
      `Already approved by Jane Doe at ${DECIDED_AT.toISOString()}, so nothing more was done.`,
    ],
    [
      SecurityPlaybookApprovalAnswerKind.AlreadyRejected,
      `Already rejected by Jane Doe at ${DECIDED_AT.toISOString()}, so nothing was done.`,
    ],
    [
      SecurityPlaybookApprovalAnswerKind.NoLongerWaiting,
      "This step no longer waits for approval, so nothing was done. Open the case in OneUptime to see where its run is.",
    ],
    [
      SecurityPlaybookApprovalAnswerKind.StartedTheRun,
      "You started this run, so someone else must approve its steps.",
    ],
    [
      SecurityPlaybookApprovalAnswerKind.Changed,
      "This approval changed after the message was sent, so nothing was done. Open the case in OneUptime to decide there.",
    ],
    [
      SecurityPlaybookApprovalAnswerKind.NotReadable,
      "This button does not name an approval OneUptime can check, so nothing was done. Open the case in OneUptime to decide there.",
    ],
    [
      SecurityPlaybookApprovalAnswerKind.CouldNotCheck,
      "OneUptime could not check this approval, so nothing was done. Open the case in OneUptime to decide there.",
    ],
    [
      SecurityPlaybookApprovalAnswerKind.KeepAtLeastOne,
      "Keep at least one ticked to approve the step, or reject it.",
    ],
  ])("%s", (kind: SecurityPlaybookApprovalAnswerKind, said: string) => {
    expect(
      wordSecurityPlaybookApprovalAnswer({
        kind,
        context: ENGLISH,
        deciderName: "Jane Doe",
        decidedAt: DECIDED_AT,
      }).text,
    ).toBe(said);
  });

  test("every answer that refuses says what to do instead: open the case in OneUptime", () => {
    for (const kind of [
      SecurityPlaybookApprovalAnswerKind.NoLongerWaiting,
      SecurityPlaybookApprovalAnswerKind.Changed,
      SecurityPlaybookApprovalAnswerKind.NotReadable,
      SecurityPlaybookApprovalAnswerKind.CouldNotCheck,
    ]) {
      expect(
        wordSecurityPlaybookApprovalAnswer({ kind, context: ENGLISH }).text,
      ).toContain("Open the case in OneUptime");
    }
  });
});

describe("in every language OneUptime writes in", () => {
  const LANGUAGES: Array<string> = READER_LANGUAGE_CODES.filter(
    (language: string): boolean => {
      return language !== "en";
    },
  );

  // Every line of every standing, worded in `language`.
  function everyLine(language: string): Array<string> {
    const context: SecurityPlaybookApprovalWordingContext = contextIn(language);
    const lines: Array<string> = [];

    const standings: Array<SecurityPlaybookApprovalAsk["standing"]> = [
      { kind: SecurityPlaybookApprovalStandingKind.Waiting },
      {
        kind: SecurityPlaybookApprovalStandingKind.Approved,
        deciderName: "Jane Doe",
        decidedAt: DECIDED_AT,
        progress: SecurityPlaybookApprovalProgress.Done,
        completedAt: COMPLETED_AT,
      },
      {
        kind: SecurityPlaybookApprovalStandingKind.Rejected,
        deciderName: "Jane Doe",
        decidedAt: DECIDED_AT,
      },
      {
        kind: SecurityPlaybookApprovalStandingKind.NoLongerWaiting,
        isRunCancelled: true,
      },
    ];

    for (const standing of standings) {
      const wording: SecurityPlaybookApprovalWording =
        wordSecurityPlaybookApproval({ ask: askOf({ standing }), context });

      lines.push(
        wording.headline.text,
        wording.action.text,
        wording.source.text,
        wording.undo.text,
        ...texts(wording.targets),
        ...texts(wording.evidence),
      );

      if (wording.progress) {
        lines.push(wording.progress.text);
      }

      if (wording.note) {
        lines.push(wording.note.text);
      }
    }

    return lines;
  }

  test.each(LANGUAGES)(
    "%s words the whole message, with every value in place",
    (language: string) => {
      const english: Array<string> = everyLine("en");
      const worded: Array<string> = everyLine(language);

      expect(worded).toHaveLength(english.length);

      worded.forEach((line: string, index: number): void => {
        // Every placeholder filled.
        expect([language, line]).not.toEqual([
          language,
          expect.stringContaining("{{"),
        ]);
        // Worded, never the English.
        expect([language, index, line]).not.toEqual([
          language,
          index,
          english[index],
        ]);
      });

      // The case, the people and the targets read as written.
      const all: string = worded.join("\n");

      expect(all).toContain("SEC-12");
      expect(all).toContain("Jane Doe");
      expect(all).toContain("alice@acme.com");
      expect(all).toContain("Contain account takeover");
    },
  );

  test.each(LANGUAGES)(
    "%s names the action by the Dashboard's own title for it",
    (language: string) => {
      const translator: Translator = getServerTranslator(language);
      const wording: SecurityPlaybookApprovalWording =
        wordSecurityPlaybookApproval({
          ask: askOf({ connectionName: undefined }),
          context: contextIn(language),
        });

      expect(wording.action.text).toBe(
        translator.translateText("Suspend the user in Okta"),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s words the buttons, the form and every answer; Approve Some's title fits a Slack form's 24 characters",
    (language: string) => {
      const translator: Translator = getServerTranslator(language);
      const english: Translator = getServerTranslator("en");
      const buttons: ReturnType<typeof getSecurityPlaybookApprovalButtonWords> =
        getSecurityPlaybookApprovalButtonWords(translator);
      const form: ReturnType<typeof getSecurityPlaybookApprovalFormWords> =
        getSecurityPlaybookApprovalFormWords(translator);

      expect(Object.values(buttons)).not.toEqual(
        Object.values(getSecurityPlaybookApprovalButtonWords(english)),
      );
      expect(form.title.length).toBeLessThanOrEqual(24);
      expect(form.title).not.toBe(SECURITY_PLAYBOOK_APPROVAL_WORDS.formTitle);
      expect(form.intro).not.toBe(SECURITY_PLAYBOOK_APPROVAL_WORDS.formIntro);

      for (const kind of Object.values(SecurityPlaybookApprovalAnswerKind)) {
        const answer: string = wordSecurityPlaybookApprovalAnswer({
          kind,
          context: contextIn(language),
          deciderName: "Jane Doe",
          decidedAt: DECIDED_AT,
        }).text;

        expect([kind, answer]).not.toEqual([
          kind,
          wordSecurityPlaybookApprovalAnswer({
            kind,
            context: ENGLISH,
            deciderName: "Jane Doe",
            decidedAt: DECIDED_AT,
          }).text,
        ]);
        expect(answer).not.toContain("{{");
      }
    },
  );
});

describe("each playbook action's title, as a message names it", () => {
  test("is the action's own title, for every action", () => {
    for (const action of SECURITY_PLAYBOOK_ACTIONS) {
      expect([
        action.type,
        SECURITY_PLAYBOOK_ACTION_TITLE_WORDS[action.type],
      ]).toEqual([action.type, action.title]);
      expect(getSecurityPlaybookActionTitleWords(action.type)).toBe(
        action.title,
      );
    }

    expect(Object.keys(SECURITY_PLAYBOOK_ACTION_TITLE_WORDS).sort()).toEqual(
      SECURITY_PLAYBOOK_ACTIONS.map(
        (action: SecurityPlaybookActionDefinition): string => {
          return action.type;
        },
      ).sort(),
    );
  });

  test("an action this build does not know reads by its own name, and none reads as nothing", () => {
    expect(getSecurityPlaybookActionTitleWords("Block Address")).toBe(
      "Block Address",
    );
    expect(getSecurityPlaybookActionTitleWords(undefined)).toBe("");
  });
});

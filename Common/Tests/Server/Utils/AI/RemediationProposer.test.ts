import RemediationProposer, {
  ParsedRemediationProposal,
  ProposalAllowlists,
} from "../../../../Server/Utils/AI/SRE/RemediationProposer";
import {
  MAX_ACTIONS_PER_RUN,
  MAX_COMMAND_SCRIPT_CHARS,
  MAX_RATIONALE_CHARS,
  MAX_TITLE_CHARS,
} from "../../../../Server/Utils/AI/SRE/RemediationPolicy";
import AIRemediationActionType from "../../../../Types/AI/AIRemediationActionType";
import { describe, expect, test } from "@jest/globals";

/*
 * The defensive proposal parse (invariant 7: server-fetched allowlists).
 * The model's reply is UNTRUSTED — adversarial telemetry can steer what it
 * writes — so parseProposals must drop anything referencing ids outside the
 * server-fetched runbook/agent allowlists, survive malformed JSON and code
 * fences, enforce every length cap, and never throw. Failure → [].
 */

const RUNBOOK_ID: string = "652f1a2b3c4d5e6f70718283";
const AGENT_ID: string = "752f1a2b3c4d5e6f70718283";

const allowlists: ProposalAllowlists = {
  runbookIdAllowlist: [RUNBOOK_ID],
  agentIdAllowlist: [AGENT_ID],
};

function runbookEntry(overrides: Record<string, unknown> = {}): object {
  return {
    type: "runbook",
    runbookId: RUNBOOK_ID,
    title: "Restart the API pods",
    rationale: "The RCA shows the API pods are wedged after the deploy.",
    ...overrides,
  };
}

function commandEntry(overrides: Record<string, unknown> = {}): object {
  return {
    type: "command",
    script: "systemctl status api-server",
    runbookAgentId: AGENT_ID,
    title: "Check the api-server service",
    rationale: "Confirms whether the service is running before restarting.",
    ...overrides,
  };
}

describe("RemediationProposer.parseProposals — valid replies", () => {
  test("parses a valid runbook + command pair", () => {
    const proposals: Array<ParsedRemediationProposal> =
      RemediationProposer.parseProposals(
        JSON.stringify([runbookEntry(), commandEntry()]),
        allowlists,
      );

    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toEqual({
      actionType: AIRemediationActionType.Runbook,
      title: "Restart the API pods",
      rationale: "The RCA shows the API pods are wedged after the deploy.",
      runbookId: RUNBOOK_ID,
    });
    expect(proposals[1]).toEqual({
      actionType: AIRemediationActionType.Command,
      title: "Check the api-server service",
      rationale: "Confirms whether the service is running before restarting.",
      runbookAgentId: AGENT_ID,
      commandScript: "systemctl status api-server",
    });
  });

  test("an empty array (nothing safely automatable) parses to []", () => {
    expect(RemediationProposer.parseProposals("[]", allowlists)).toEqual([]);
  });

  test("strips accidental markdown code fences", () => {
    const fenced: string = [
      "```json",
      JSON.stringify([runbookEntry()]),
      "```",
    ].join("\n");

    expect(RemediationProposer.parseProposals(fenced, allowlists)).toHaveLength(
      1,
    );
  });

  test("accepts a bare fence without a language tag", () => {
    const fenced: string = [
      "```",
      JSON.stringify([commandEntry()]),
      "```",
    ].join("\n");

    expect(RemediationProposer.parseProposals(fenced, allowlists)).toHaveLength(
      1,
    );
  });

  test("type matching is case-insensitive", () => {
    expect(
      RemediationProposer.parseProposals(
        JSON.stringify([runbookEntry({ type: "Runbook" })]),
        allowlists,
      ),
    ).toHaveLength(1);
  });
});

describe("RemediationProposer.parseProposals — malformed replies", () => {
  test("empty / null / undefined input → []", () => {
    expect(RemediationProposer.parseProposals("", allowlists)).toEqual([]);
    expect(RemediationProposer.parseProposals(null, allowlists)).toEqual([]);
    expect(RemediationProposer.parseProposals(undefined, allowlists)).toEqual(
      [],
    );
  });

  test("prose instead of JSON → []", () => {
    expect(
      RemediationProposer.parseProposals(
        "I suggest restarting the API pods.",
        allowlists,
      ),
    ).toEqual([]);
  });

  test("a JSON object (not an array) → []", () => {
    expect(
      RemediationProposer.parseProposals(
        JSON.stringify(runbookEntry()),
        allowlists,
      ),
    ).toEqual([]);
  });

  test("non-object array entries are dropped", () => {
    expect(
      RemediationProposer.parseProposals(
        JSON.stringify(["restart", 42, null, [runbookEntry()]]),
        allowlists,
      ),
    ).toEqual([]);
  });

  test("entries with missing or non-string fields are dropped", () => {
    const proposals: Array<ParsedRemediationProposal> =
      RemediationProposer.parseProposals(
        JSON.stringify([
          runbookEntry({ title: undefined }),
          runbookEntry({ rationale: 42 }),
          commandEntry({ script: undefined }),
          { type: "runbook" },
        ]),
        allowlists,
      );

    expect(proposals).toEqual([]);
  });

  test("whitespace-only title or rationale is dropped", () => {
    expect(
      RemediationProposer.parseProposals(
        JSON.stringify([
          runbookEntry({ title: "   " }),
          commandEntry({ rationale: "\n\t" }),
        ]),
        allowlists,
      ),
    ).toEqual([]);
  });

  test("unknown action types are dropped", () => {
    expect(
      RemediationProposer.parseProposals(
        JSON.stringify([runbookEntry({ type: "workflow" })]),
        allowlists,
      ),
    ).toEqual([]);
  });
});

describe("RemediationProposer.parseProposals — allowlist enforcement", () => {
  test("a runbookId outside the allowlist is dropped (no minted targets)", () => {
    expect(
      RemediationProposer.parseProposals(
        JSON.stringify([
          runbookEntry({ runbookId: "999f1a2b3c4d5e6f70718283" }),
        ]),
        allowlists,
      ),
    ).toEqual([]);
  });

  test("an agentId outside the allowlist is dropped (no minted targets)", () => {
    expect(
      RemediationProposer.parseProposals(
        JSON.stringify([
          commandEntry({ runbookAgentId: "999f1a2b3c4d5e6f70718283" }),
        ]),
        allowlists,
      ),
    ).toEqual([]);
  });

  test("a runbook entry with a non-string runbookId is dropped", () => {
    expect(
      RemediationProposer.parseProposals(
        JSON.stringify([runbookEntry({ runbookId: 42 })]),
        allowlists,
      ),
    ).toEqual([]);
  });

  test("empty allowlists drop everything", () => {
    expect(
      RemediationProposer.parseProposals(
        JSON.stringify([runbookEntry(), commandEntry()]),
        { runbookIdAllowlist: [], agentIdAllowlist: [] },
      ),
    ).toEqual([]);
  });

  test("valid entries survive alongside dropped ones", () => {
    const proposals: Array<ParsedRemediationProposal> =
      RemediationProposer.parseProposals(
        JSON.stringify([
          runbookEntry({ runbookId: "999f1a2b3c4d5e6f70718283" }),
          commandEntry(),
        ]),
        allowlists,
      );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.actionType).toBe(AIRemediationActionType.Command);
  });
});

describe("RemediationProposer.parseProposals — caps", () => {
  test(`caps the count at MAX_ACTIONS_PER_RUN (${MAX_ACTIONS_PER_RUN})`, () => {
    const entries: Array<object> = [];
    for (let i: number = 0; i < MAX_ACTIONS_PER_RUN + 5; i++) {
      entries.push(runbookEntry({ title: `Action ${i}` }));
    }

    expect(
      RemediationProposer.parseProposals(JSON.stringify(entries), allowlists),
    ).toHaveLength(MAX_ACTIONS_PER_RUN);
  });

  test("truncates over-long titles and rationales", () => {
    const proposals: Array<ParsedRemediationProposal> =
      RemediationProposer.parseProposals(
        JSON.stringify([
          runbookEntry({
            title: "t".repeat(MAX_TITLE_CHARS + 50),
            rationale: "r".repeat(MAX_RATIONALE_CHARS + 50),
          }),
        ]),
        allowlists,
      );

    expect(proposals[0]?.title).toHaveLength(MAX_TITLE_CHARS);
    expect(proposals[0]?.rationale).toHaveLength(MAX_RATIONALE_CHARS);
  });

  test("an over-long script DROPS the entry — truncation could change what it does", () => {
    expect(
      RemediationProposer.parseProposals(
        JSON.stringify([
          commandEntry({ script: "x".repeat(MAX_COMMAND_SCRIPT_CHARS + 1) }),
        ]),
        allowlists,
      ),
    ).toEqual([]);
  });

  test("a script exactly at the cap survives", () => {
    expect(
      RemediationProposer.parseProposals(
        JSON.stringify([
          commandEntry({ script: "x".repeat(MAX_COMMAND_SCRIPT_CHARS) }),
        ]),
        allowlists,
      ),
    ).toHaveLength(1);
  });
});

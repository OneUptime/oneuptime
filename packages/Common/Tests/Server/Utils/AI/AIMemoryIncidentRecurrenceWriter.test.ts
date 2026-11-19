import AIMemory, {
  IncidentRecurrenceCase,
  PAST_RESOLVED_INCIDENTS_HEADING,
} from "../../../../Server/Utils/AI/SRE/AIMemory";
import { describe, expect, test } from "@jest/globals";

/*
 * AN INCIDENT'S RECURRENCE CONTEXT, AS AN INVESTIGATION READS IT (#7766).
 *
 * AIMemory.writeIncidentRecurrence is the part of the incident recurrence
 * context that writes it: the heading, what to do with a match, then each
 * past incident. buildIncidentRecurrence reads the cases and hands them to
 * it; the benchmark's scenarios write their project history with it, so a
 * scenario's past incidents read exactly as the product's do.
 */

const POOL_INCIDENT: IncidentRecurrenceCase = {
  incidentNumber: 412,
  title: "Card payments failing",
  cause: "The database connection pool was exhausted.",
  isConfirmedAnalysis: false,
  monitorNames: ["Payments API", "Payments database"],
  matchedOn: "Matched on: the same monitor (Payments API)",
  fix: 'ran the runbook "Restart payments-api"',
};

const INSTRUCTION: string =
  "If the current signal matches one of these, this may be a recurrence — say so explicitly and reference the incident number and how it was resolved. When OneUptime AI's fix of one was verified, say in the next steps whether the same fix applies now. Each says what it has in common with this incident; a match by meaning alone is a lead to check, not proof.";

describe("AIMemory.writeIncidentRecurrence", () => {
  test("a section of its own after a blank line: the heading, what to do with a match, then each case", () => {
    expect(
      AIMemory.writeIncidentRecurrence({
        cases: [POOL_INCIDENT],
        isFallback: false,
      }),
    ).toBe(
      [
        "",
        "",
        PAST_RESOLVED_INCIDENTS_HEADING,
        INSTRUCTION,
        "",
        "- **#412 — Card payments failing**",
        "  Previously resolved. Root cause: The database connection pool was exhausted.",
        "  Monitors: Payments API, Payments database",
        "  Matched on: the same monitor (Payments API)",
        '  Fixed by OneUptime AI (verified): ran the runbook "Restart payments-api"',
      ].join("\n"),
    );
  });

  test("a cause nobody recorded is OneUptime AI's analysis, confirmed, and says so", () => {
    expect(
      AIMemory.writeIncidentRecurrence({
        cases: [{ ...POOL_INCIDENT, isConfirmedAnalysis: true }],
        isFallback: false,
      }),
    ).toContain(
      "  Previously resolved. Root cause (OneUptime AI's analysis, confirmed by your team): The database connection pool was exhausted.",
    );
  });

  test("with nothing matched, each says it is one of the most recent, never a Matched on line", () => {
    const section: string = AIMemory.writeIncidentRecurrence({
      cases: [POOL_INCIDENT],
      isFallback: true,
    });

    expect(section).toContain(
      "\n  Nothing in it matched this incident: it is one of the project's most recent resolved incidents.",
    );
    expect(section).not.toContain("Matched on:");
  });

  test("lines with nothing to say are left out: no monitors, no match, no verified fix, no title", () => {
    const section: string = AIMemory.writeIncidentRecurrence({
      cases: [
        {
          incidentNumber: 7,
          cause: "A typo in a config value.",
          isConfirmedAnalysis: false,
          monitorNames: [],
          matchedOn: null,
        },
      ],
      isFallback: false,
    });

    expect(
      section.endsWith(
        "\n- **#7 — Untitled**\n  Previously resolved. Root cause: A typo in a config value.",
      ),
    ).toBe(true);
    expect(section).not.toContain("Monitors:");
    expect(section).not.toContain("Fixed by OneUptime AI");
  });

  test("a long cause is held to a prompt field's length, and an embedded image becomes a note", () => {
    const section: string = AIMemory.writeIncidentRecurrence({
      cases: [
        {
          ...POOL_INCIDENT,
          cause: `![shot](data:image/png;base64,${"A".repeat(4000)}) ${"x".repeat(3000)}`,
        },
      ],
      isFallback: false,
    });

    expect(section).not.toContain("A".repeat(100));
    expect(section.length).toBeLessThan(3000);
  });

  test("each case in the order given", () => {
    const section: string = AIMemory.writeIncidentRecurrence({
      cases: [
        POOL_INCIDENT,
        { ...POOL_INCIDENT, incidentNumber: 377, title: "Refunds delayed" },
      ],
      isFallback: false,
    });

    expect(section.indexOf("#412")).toBeLessThan(section.indexOf("#377"));
  });
});

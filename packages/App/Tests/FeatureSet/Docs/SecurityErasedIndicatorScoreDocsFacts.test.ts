import { SECURITY_EVENTS } from "./AiObservabilityDocsPages";
import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { JSONObject } from "Common/Types/JSON";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import {
  ENRICHMENT_CONFIDENCE_ATTRIBUTE,
  ERASED_THREAT_INTEL_SEVERITY,
  ocsfSeverityForConfidence,
} from "Common/Types/SecurityEvent/ThreatIntelConstants";
import {
  unnameKeptEventStamps,
  withoutIndicatorConfidence,
} from "Common/Utils/SecurityEvent/SecurityUserErasureUnnaming";
import { describe, expect, it } from "@jest/globals";

/*
 * WHAT THE SECURITY EVENTS PAGE SAYS AN ERASURE KEEPS OF A THREAT INTEL
 * INDICATOR'S CONFIDENCE (#11447), held to the code that decides it.
 *
 * In a small feed whose few addresses each have a confidence of their own,
 * the confidence an erased person's match kept could point back at one
 * address, and so could the severity the matcher took from it. So the
 * erasure keeps neither: the page says the confidence goes, as the
 * un-naming takes it out, and names the severity every erased match reads,
 * as the code sets it. What it leaves - a case's priority, an alert's or
 * an incident's severity, the feed, the type and when - is said too.
 */

const LINE_BREAK: RegExp = /\n/;

// A section of a page, from its heading to the next heading of its level or above.
function section(markdown: string, heading: string): string {
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const index: number = headings.findIndex((entry: DocsHeading): boolean => {
    return entry.text === heading;
  });

  expect({ heading, found: index >= 0 }).toEqual({ heading, found: true });

  const start: DocsHeading = headings[index] as DocsHeading;
  const next: DocsHeading | undefined = headings
    .slice(index + 1)
    .find((entry: DocsHeading): boolean => {
      return entry.level <= start.level;
    });
  const lines: Array<string> = markdown.split(LINE_BREAK);

  return lines
    .slice(start.line, next ? next.line - 1 : lines.length)
    .join("\n");
}

describe("the Security Events page on an erased person's threat intel match (#11447)", () => {
  const erase: string = section(
    readPage("en", SECURITY_EVENTS),
    "Erase a person",
  );

  it("says the indicator's confidence goes, as the un-naming takes it out of a match's sentence", () => {
    expect(erase).toContain(
      "the indicator's name and confidence go: `(email-addr, confidence 80)` reads `(email-addr)`.",
    );
    expect(
      withoutIndicatorConfidence(
        "Indicator `[HASHED:5e29db14e508e09a]` (email-addr, confidence 80) from the threat intel feed **Acme** matched 2 security events.",
      ),
    ).toBe(
      "Indicator `[HASHED:5e29db14e508e09a]` (email-addr) from the threat intel feed **Acme** matched 2 security events.",
    );
  });

  it("says why no band of it is kept either", () => {
    expect(erase).toContain(
      "the confidence alone could point back at one address, and so could a band of it, so none is kept.",
    );
  });

  it("names the severity every erased match reads, as the code sets it: a match's on an indicator with no confidence", () => {
    expect(ERASED_THREAT_INTEL_SEVERITY).toBe(OcsfSeverity.Medium);
    expect(ERASED_THREAT_INTEL_SEVERITY).toBe(ocsfSeverityForConfidence(0));
    expect(erase).toContain(
      `the Detection Finding and the detection take the severity a match on an indicator with no confidence has, **${ERASED_THREAT_INTEL_SEVERITY}**, whatever the indicator's confidence made it.`,
    );
  });

  it("keeps the feed and the indicator's type, and a kept event loses the confidence its stamp held", () => {
    expect(erase).toContain("The feed and the indicator's type stay.");
    expect(erase).not.toContain("its confidence stay");

    // A stamp an erasure from before #11447 left: the token and the erased id, and the score.
    const kept: { value: JSONObject; changed: boolean } = unnameKeptEventStamps(
      {
        events: [
          {
            attributes: {
              "threat.indicator_value": "[HASHED:5e29db14e508e09a]",
              "threat.indicator_id": "[INDICATOR:0a1b2c3d4e5f6a7b]",
              "threat.feed": "Acme",
              "threat.indicator_type": "email-addr",
              [ENRICHMENT_CONFIDENCE_ATTRIBUTE]: "80",
            },
          },
        ],
      } as JSONObject,
      {
        names: [
          { named: "alice@example.com", hashed: "[HASHED:5e29db14e508e09a]" },
        ],
        erasedIndicatorIdOf: (): string => {
          return "[INDICATOR:0a1b2c3d4e5f6a7b]";
        },
      },
    );

    expect(kept.changed).toBe(true);
    expect(JSON.stringify(kept.value)).not.toContain(
      ENRICHMENT_CONFIDENCE_ATTRIBUTE,
    );
    expect(JSON.stringify(kept.value)).toContain(
      '"threat.indicator_type":"email-addr"',
    );
  });

  it("says what it leaves: a case's priority, an alert's or incident's severity, and which feed matched, the type and when", () => {
    expect(erase).toContain(
      "- The priority of a case, and the severity of an alert or incident, a threat intel match opened: people were paged and triaged by them, and may have changed them since.",
    );
    expect(erase).toContain(
      "Which feed matched, the indicator's type and when stay too, so a feed that lists a single email address, or each of its few addresses at a different time, can still point at the person.",
    );
  });
});

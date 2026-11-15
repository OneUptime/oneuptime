import { describe, expect, test } from "@jest/globals";
import {
  AI_ACTION_LINES,
  AI_ACTION_PLURAL_SENTENCES,
  AI_ACTION_SENTENCES,
  AI_ACTION_TERM_WORDS,
  aiActionPluralSentence,
  describeAIActionSentence,
  isKnownAIActionSentence,
} from "../../../Types/AI/AIActionWords";
import {
  AI_INSIGHT_SEVERITY_LABELS,
  AI_INSIGHT_STATUS_LABELS,
  AI_READ_AI_RUN_STATUSES,
  AI_READ_DATA_SECURITY_TERMS,
  AI_READ_ESCALATION_CHAIN,
  AI_READ_ESCALATION_CHAIN_TERMS,
  AI_READ_NOTIFICATION_STATUSES,
  AI_READ_ON_CALL_PAGE_STATUSES,
  AI_READ_RESOURCE_KINDS,
  AI_READ_RUM_CLIENT_TYPES,
  AI_READ_RUNBOOK_STEP_INSTRUCTIONS,
  AI_READ_RUNBOOK_STEP_TYPES,
  AI_READ_SECURITY_VERDICTS,
  AI_READ_TABLE_AND_CITATION_PLURAL_SENTENCES,
  AI_READ_TABLE_AND_CITATION_SENTENCES,
  AI_READ_TABLE_TERMS,
  AI_READ_TRIAGE_LABELS,
  AI_READ_WIDGET_LINES,
  AI_READ_WIDGET_TITLES,
  AI_TOOL_CITATION_PLURALS,
  AI_TOOL_CITATIONS,
} from "../../../Types/AI/AIReadTableWords";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import { DataStoreExposure } from "../../../Types/DataSecurity/DataStorePosture";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import SecurityCaseAiVerdict from "../../../Types/SecurityCase/SecurityCaseAiVerdict";
import { DataStoreAccessLevel } from "../../../Types/DataSecurity/DataStoreAccess";
import { PluralTemplate } from "../../../Types/Translator";
import { PROBE_AGREEMENT_SENTENCES } from "../../../Utils/Monitor/ProbeAgreementRule";

/*
 * THE REST OF ASK AI'S WORDS, AS THE DASHBOARD TRUSTS THEM (issues #8311,
 * #8312, #8313, #8245).
 *
 * The chips of every other tool, the headings of the lists and charts and
 * the cells that are OneUptime's words are sentences and terms of
 * Types/AI/AIReadTableWords: only what AIActionWords lists is said in the
 * reader's language, so each must be there. The words of a table's cells
 * cover every value OneUptime stores there, and the card of
 * set_up_website_monitoring says the probes card's own sentences.
 */

describe("every new sentence, plural and term is one the Dashboard trusts", () => {
  test("each sentence is among AI_ACTION_SENTENCES", () => {
    const sentences: Array<string> = [
      ...Object.values(AI_READ_WIDGET_TITLES),
      ...Object.values(AI_READ_WIDGET_LINES),
      ...Object.values(AI_READ_ESCALATION_CHAIN),
      ...Object.values(AI_READ_RUNBOOK_STEP_INSTRUCTIONS),
      ...Object.values(AI_TOOL_CITATIONS),
    ];

    expect(sentences.length).toBeGreaterThan(150);

    for (const template of sentences) {
      expect({
        template,
        listed: AI_READ_TABLE_AND_CITATION_SENTENCES.includes(template),
        trusted: AI_ACTION_SENTENCES.includes(template),
      }).toEqual({ template, listed: true, trusted: true });
    }
  });

  test("each plural counts, and is listed", () => {
    for (const plural of Object.values(AI_TOOL_CITATION_PLURALS)) {
      expect(AI_READ_TABLE_AND_CITATION_PLURAL_SENTENCES).toContain(plural);
      expect(AI_ACTION_PLURAL_SENTENCES).toContain(plural);
      expect(isKnownAIActionSentence(aiActionPluralSentence(plural, 2))).toBe(
        true,
      );
    }

    expect(
      describeAIActionSentence(
        aiActionPluralSentence(AI_TOOL_CITATION_PLURALS.runs, 1),
      ),
    ).toBe("1 run");
    expect(
      describeAIActionSentence(
        aiActionPluralSentence(AI_TOOL_CITATION_PLURALS.commits, 3),
      ),
    ).toBe("3 commits");
  });

  test("no two plurals share a general form with different singulars", () => {
    const byOther: Map<string, string> = new Map<string, string>();

    for (const plural of AI_ACTION_PLURAL_SENTENCES as Array<PluralTemplate>) {
      const one: string | undefined = byOther.get(plural.other);
      expect({ other: plural.other, one: one ?? plural.one }).toEqual({
        other: plural.other,
        one: plural.one,
      });
      byOther.set(plural.other, plural.one);
    }
  });

  test("each cell's word is a term the Dashboard trusts", () => {
    const terms: Array<string> = [
      ...Object.values(AI_READ_ESCALATION_CHAIN_TERMS),
      ...AI_READ_ON_CALL_PAGE_STATUSES,
      ...AI_READ_NOTIFICATION_STATUSES,
      ...Object.values(AI_READ_AI_RUN_STATUSES),
      ...Object.values(AI_INSIGHT_STATUS_LABELS),
      ...Object.values(AI_INSIGHT_SEVERITY_LABELS),
      ...Object.values(AI_READ_TRIAGE_LABELS),
      ...AI_READ_DATA_SECURITY_TERMS,
      ...AI_READ_SECURITY_VERDICTS,
      ...Object.values(AI_READ_RUNBOOK_STEP_TYPES),
      ...Object.values(AI_READ_RUM_CLIENT_TYPES),
      ...AI_READ_RESOURCE_KINDS,
    ];

    for (const term of terms) {
      expect({
        term,
        listed: AI_READ_TABLE_TERMS.includes(term),
        trusted: AI_ACTION_TERM_WORDS.includes(term),
      }).toEqual({ term, listed: true, trusted: true });
    }
  });
});

describe("the words of a table's cells cover what OneUptime stores there (#8313)", () => {
  test("every on-call page status, and every person's notification status", () => {
    for (const status of Object.values(OnCallDutyPolicyStatus)) {
      expect(AI_READ_ON_CALL_PAGE_STATUSES).toContain(status);
    }

    for (const status of Object.values(UserNotificationExecutionStatus)) {
      expect(AI_READ_NOTIFICATION_STATUSES).toContain(status);
    }
  });

  test("every sensitivity, exposure, severity, access level and AI verdict; an open issue's status is data", () => {
    for (const value of [
      ...Object.values(DataSensitivity),
      ...Object.values(DataStoreExposure),
      ...Object.values(SecuritySeverity),
      ...Object.values(DataStoreAccessLevel),
    ]) {
      expect(AI_READ_DATA_SECURITY_TERMS).toContain(value);
    }

    for (const verdict of Object.values(SecurityCaseAiVerdict)) {
      expect(AI_READ_SECURITY_VERDICTS).toContain(verdict);
    }

    expect(AI_READ_DATA_SECURITY_TERMS).not.toContain("Open");
  });
});

describe("Ask AI's website monitoring card says the probes card's words (#8245)", () => {
  test("its agreement lines are the probe agreement rule's own sentences", () => {
    expect(AI_ACTION_LINES.probeAgreementSome).toBe(
      PROBE_AGREEMENT_SENTENCES.some,
    );
    expect(AI_ACTION_LINES.probeAgreementBoth).toBe(
      PROBE_AGREEMENT_SENTENCES.both,
    );
    expect(AI_ACTION_LINES.probeAgreementAll).toBe(
      PROBE_AGREEMENT_SENTENCES.all,
    );

    for (const template of Object.values(PROBE_AGREEMENT_SENTENCES)) {
      expect(AI_ACTION_SENTENCES).toContain(template);
    }
  });
});

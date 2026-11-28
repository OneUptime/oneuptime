import { describe, expect, test } from "@jest/globals";
import {
  BREACH_NOTICES_NOT_LEGAL_ADVICE_ENGLISH,
  DRAFT_NOT_LEGAL_ADVICE_ENGLISH,
  countryInEnglish,
  describeLogReadsInEnglish,
  describeReadsInEnglish,
  describeSecretsInEnglish,
  describeWhoseInEnglish,
  describeWindowInEnglish,
  exportMoment,
  getExposureNoticesExportNames,
  getExposureNoticesMarkdown,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/Exposure/ExposureNoticesExport";
import {
  BREACH_LAW_RULES,
  BreachLawId,
  BreachLawRule,
  BreachPlace,
  COVERED_US_STATES,
  getBreachLawRule,
  isUsStateRule,
  UNCOVERED_US_STATES,
} from "Common/Types/DataSecurity/BreachLaws";
import {
  ComplianceFact,
  ComplianceFactKind,
} from "Common/Types/DataSecurity/ComplianceFacts";
import { DataSecurityExposureAssessmentResponse } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  BreachObligation,
  BreachObligationStatus,
  ExposureAssessmentView,
  ExposureDraftPart,
  ExposureDraftSection,
  ExposureWindowEndKind,
  ExposureWindowStartKind,
  getBreachLawName,
} from "Common/Types/DataSecurity/ExposureAssessment";
import { ImpactAssessmentSectionSource } from "Common/Types/DataSecurity/ImpactAssessment";
import { NO_BREAK_SPACE } from "Common/Types/NoBreakSpaces";
import {
  EXPOSURE_NOW,
  exposureAnswerOf,
  exposureAssessmentOf,
  exposureLogReadOf,
  exposureViewOf,
} from "Common/Tests/Helpers/ExposureAssessmentAnswers";

/*
 * A CASE'S BREACH NOTICES AS ONE DOCUMENT (#10955): what Export Markdown
 * downloads and Export PDF draws.
 *
 * Read like the two cards: "drafts, not legal advice, nothing was sent"
 * first; the law due first and its deadline; the window, who could read
 * it, whose data and the secrets to rotate; each law that may apply with
 * its source and the day it was checked, then those that may if some of
 * the people live elsewhere; what the table does not cover; and each part
 * as a person last saved it - its byline, its words, the facts a draft
 * rests on. It reads only the server's answer, so it holds no sample, no
 * record, no secret's value and no principal, and its own words are
 * English, whatever the reader's language.
 */

const EXPORTED_AT: Date = new Date("2026-11-11T12:30:00.000Z");
const EDITOR_ID: string = "10955000-0000-4000-8000-0000000000f1";

const WINDOW_FACT: ComplianceFact = {
  id: "F2",
  key: "exposure:window",
  kind: ComplianceFactKind.ExposureWindow,
  foundAt: "2026-11-02T09:00:00.000Z",
  start: "2026-11-02T09:00:00.000Z",
  startIsExact: false,
  end: "2026-11-11T09:00:00.000Z",
  endKind: ExposureWindowEndKind.ResponseAction,
  isStillOpen: false,
  hours: 216,
  days: 9,
};

const READS_FACT: ComplianceFact = {
  id: "F3",
  key: "exposure:reads",
  kind: ComplianceFactKind.ExposureReads,
  logged: "NotLogged",
  isPublic: true,
  outsideAccounts: 2,
  outsideAccountsUsedInWindow: 1,
  isTreatedAsRead: true,
};

const STORE_FACT: ComplianceFact = {
  id: "F1",
  key: "store",
  kind: ComplianceFactKind.StoreIdentity,
  name: "eu-customer-exports",
  storeKind: "AWS S3 Bucket",
  provider: "aws",
};

function drafted(
  part: ExposureDraftPart,
  markdown: string,
  factKeys: Array<string>,
): ExposureDraftSection {
  return {
    part,
    markdown,
    source: ImpactAssessmentSectionSource.Drafted,
    factKeys,
    factsHash: "hash",
    draftedAt: "2026-11-11T10:00:00.000Z",
  };
}

function answerWithParts(
  data: Partial<DataSecurityExposureAssessmentResponse> = {},
): DataSecurityExposureAssessmentResponse {
  return exposureAnswerOf({
    assessment: exposureAssessmentOf({
      sections: {
        [ExposureDraftPart.Explanation]: drafted(
          ExposureDraftPart.Explanation,
          "The bucket of EU customers' emails was public for nine days, and reads were not logged.",
          ["exposure:window", "exposure:reads"],
        ),
        [ExposureDraftPart.RegulatorNotice]: {
          part: ExposureDraftPart.RegulatorNotice,
          markdown:
            "We are notifying you of a personal data breach under GDPR Article 33. [Contact details of our DPO]",
          source: ImpactAssessmentSectionSource.Edited,
          factKeys: [],
          factsHash: "edited",
          editedAt: "2026-11-11T11:00:00.000Z",
          editedByUserId: EDITOR_ID,
        },
        [ExposureDraftPart.InternalSummary]: drafted(
          ExposureDraftPart.InternalSummary,
          "eu-customer-exports was public from 2 November to 11 November.",
          ["store", "exposure:window"],
        ),
      },
      facts: [STORE_FACT, WINDOW_FACT, READS_FACT],
    }),
    editors: { [EDITOR_ID]: "Ana Ortiz" },
    staleParts: [ExposureDraftPart.InternalSummary],
    ...data,
  });
}

function markdownOf(answer: DataSecurityExposureAssessmentResponse): string {
  return getExposureNoticesMarkdown({ answer, exportedAt: EXPORTED_AT });
}

function sectionOf(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n## ${heading}\n`);

  expect(start).toBeGreaterThanOrEqual(0);

  const next: number = markdown.indexOf("\n## ", start + 4);

  return markdown.slice(start, next === -1 ? undefined : next);
}

describe("the document's names and moments", () => {
  test("is titled as drafts, and its files are named after the store", () => {
    expect(getExposureNoticesExportNames("eu-customer-exports")).toEqual({
      pdfTitle: "Draft Breach Notices: eu-customer-exports",
      fileLabel: "eu-customer-exports breach notices",
    });
  });

  test("writes every moment in UTC, to the minute, whatever the reader's zone", () => {
    expect(exportMoment("2026-11-05T09:00:00.000Z")).toBe(
      "2026-11-05 09:00 UTC",
    );
    expect(exportMoment(new Date("2026-03-01T23:59:30.000Z"))).toBe(
      "2026-03-01 23:59 UTC",
    );
    expect(exportMoment(undefined)).toBe("");
    expect(exportMoment("not a date")).toBe("");
    expect(countryInEnglish("de")).toBe("Germany");
    expect(countryInEnglish("NL")).toBe("Netherlands");
  });
});

describe("a case's breach notices, exported", () => {
  test("opens with what it is, and that it is drafts, not legal advice, and nothing was sent - before anything else", () => {
    const markdown: string = markdownOf(answerWithParts());
    const lines: Array<string> = markdown.split("\n");

    expect(lines[0]).toBe("# Draft Breach Notices: eu-customer-exports");
    expect(lines[2]).toBe(
      "AWS S3 Bucket, eu-west-1. Exported from OneUptime on 2026-11-11.",
    );
    expect(lines[4]).toBe(`> ${BREACH_NOTICES_NOT_LEGAL_ADVICE_ENGLISH}`);
    expect(BREACH_NOTICES_NOT_LEGAL_ADVICE_ENGLISH).toContain(
      "not legal advice",
    );
    expect(BREACH_NOTICES_NOT_LEGAL_ADVICE_ENGLISH).toContain(
      "Nothing was sent",
    );
    // Said once at the top, before the law due first.
    expect(markdown.indexOf(BREACH_NOTICES_NOT_LEGAL_ADVICE_ENGLISH)).toBe(
      markdown.lastIndexOf(BREACH_NOTICES_NOT_LEGAL_ADVICE_ENGLISH),
    );
    expect(markdown.indexOf("not legal advice")).toBeLessThan(
      markdown.indexOf("## Due First"),
    );
  });

  test("its sections come in the cards' order", () => {
    const markdown: string = markdownOf(answerWithParts());
    const order: Array<number> = [
      "## Due First",
      "## How Long It Was Open",
      "## Who Could Read It",
      "## Whose Data",
      "## Secrets to Rotate",
      "## Breach Laws That May Apply",
      "## If Any of the People Live Elsewhere",
      "## What This Does Not Cover",
      "## What This Means",
      "## Notice to the Regulator",
      "## Notice to the People Affected",
      "## Internal Summary",
      "## The Facts the Drafts Rest On",
    ].map((heading: string): number => {
      return markdown.indexOf(`\n${heading}\n`);
    });

    for (const at of order) {
      expect(at).toBeGreaterThan(0);
    }

    expect(
      [...order].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(order);
  });

  test("the law due first: what it asks, of whom, its deadline in its units, and when it falls, in UTC", () => {
    const due: string = sectionOf(markdownOf(answerWithParts()), "Due First");

    expect(due).toContain(
      "**GDPR Article 33: Notify the supervisory authority.**",
    );
    // When it falls first, then the law's own length and what it counts from.
    expect(due).toContain(
      "Due 2026-11-05 09:00 UTC: 72 hours from when it was found, counted from 2026-11-02 09:00 UTC, when Data Security found the exposure.",
    );
  });

  test("while nobody knows where the people live, it says that decides the laws", () => {
    const due: string = sectionOf(
      markdownOf(exposureAnswerOf({ view: exposureViewOf({ countries: [] }) })),
      "Due First",
    );

    expect(due).toContain(
      "Where the people live decides which laws apply, and nobody has said yet.",
    );
  });

  test("a store with nothing a breach law covers says no law of the table asks for a notice", () => {
    const answer: DataSecurityExposureAssessmentResponse = exposureAnswerOf({
      view: exposureViewOf({
        dataTypeIds: ["aws-secret-access-key"],
        countries: ["DE"],
      }),
    });
    const markdown: string = markdownOf(answer);

    expect(sectionOf(markdown, "Due First")).toContain(
      "No law in OneUptime's table asks for a notice on these facts.",
    );
    expect(sectionOf(markdown, "Breach Laws That May Apply")).toContain(
      "None of the table's laws may apply on these facts.",
    );
  });

  test("how long it was open: from when, until when and how it closed, and for how long", () => {
    const markdown: string = markdownOf(answerWithParts());

    expect(sectionOf(markdown, "How Long It Was Open")).toContain(
      `At least since 2026-11-02 09:00 UTC, the first scan that saw it exposed, until 2026-11-11 09:00 UTC, when Data Security's response closed it: 9${NO_BREAK_SPACE}days.`,
    );
  });

  test("the window's other ways: a change that opened and closed it, still open, a scan, none at all", () => {
    expect(
      describeWindowInEnglish({
        foundAt: "2026-11-02T09:00:00.000Z",
        start: "2026-11-01T08:00:00.000Z",
        startKind: ExposureWindowStartKind.Change,
        startOperation: "s3:DeleteBucketPublicAccessBlock",
        end: "2026-11-01T20:00:00.000Z",
        endKind: ExposureWindowEndKind.Change,
        endOperation: "s3:PutBucketPublicAccessBlock",
        isStillOpen: false,
        hours: 12,
        days: 0,
        earlierPeriods: [],
      }),
    ).toBe(
      `From 2026-11-01 08:00 UTC, when s3:DeleteBucketPublicAccessBlock opened it, until 2026-11-01 20:00 UTC, when s3:PutBucketPublicAccessBlock closed it: 12${NO_BREAK_SPACE}hours.`,
    );
    expect(
      describeWindowInEnglish({
        foundAt: "2026-11-02T09:00:00.000Z",
        start: "2026-11-02T09:00:00.000Z",
        startKind: ExposureWindowStartKind.FirstSeen,
        endKind: ExposureWindowEndKind.StillOpen,
        isStillOpen: true,
        hours: 30,
        days: 1,
        earlierPeriods: [],
      }),
    ).toBe(
      `At least since 2026-11-02 09:00 UTC, the first scan that saw it exposed, and it is still open: 1${NO_BREAK_SPACE}day so far.`,
    );
    expect(
      describeWindowInEnglish({
        foundAt: "2026-11-02T09:00:00.000Z",
        start: "2026-11-02T09:00:00.000Z",
        startKind: ExposureWindowStartKind.FirstSeen,
        end: "2026-11-02T09:20:00.000Z",
        endKind: ExposureWindowEndKind.Scan,
        isStillOpen: false,
        hours: 0,
        days: 0,
        earlierPeriods: [],
      }),
    ).toContain("at the latest, when a scan saw it closed: less than an hour.");
    expect(describeWindowInEnglish(null)).toBe(
      "Data Security recorded no time the store was open to people outside your company.",
    );
  });

  test("who could read it: the brief's words where reads were not logged, and the accounts counted, never named", () => {
    const view: ExposureAssessmentView = exposureViewOf({
      grants: [
        {
          principal: "arn:aws:iam::999999999999:role/partner-reader",
          isExternal: true,
          lastUsedAt: "2026-11-05T13:00:00.000Z",
        },
        {
          principal: "arn:aws:iam::888888888888:user/auditor",
          isExternal: true,
        },
      ],
    });
    const markdown: string = markdownOf(exposureAnswerOf({ view }));
    const reads: string = sectionOf(markdown, "Who Could Read It");

    expect(reads).toContain("- Reads were not logged. Treat the data as read.");
    expect(reads).toContain("- Anyone on the internet could read it.");
    expect(reads).toContain(
      `- 2${NO_BREAK_SPACE}accounts outside your company could read it.`,
    );
    expect(reads).toContain("- 1 of them used its access while it was open.");
    expect(markdown).not.toContain("999999999999");
    expect(markdown).not.toContain("partner-reader");
    expect(markdown).not.toContain("888888888888");
  });

  test("what the store's access logs show, counted - never who, even for a reader the card names them to (#10951)", () => {
    const view: ExposureAssessmentView = exposureViewOf({
      accessLogging: true,
      logRead: exposureLogReadOf({
        anonymous: 3,
        outside: 2,
        principals: true,
      }),
    });
    const markdown: string = markdownOf(exposureAnswerOf({ view }));
    const reads: string = sectionOf(markdown, "Who Could Read It");

    expect(view.reads.fromLogs!.outsidePrincipals).toHaveLength(1);
    expect(reads).toContain(
      `- OneUptime read the store's access logs for this window: 5${NO_BREAK_SPACE}reads from outside your accounts.`,
    );
    expect(reads).toContain(
      `- 3 by anyone on the internet, from 3${NO_BREAK_SPACE}addresses; 2 by 1${NO_BREAK_SPACE}account outside your company.`,
    );
    expect(reads).toContain(
      `- 4${NO_BREAK_SPACE}objects read, 5${NO_BREAK_SPACE}MB sent.`,
    );
    expect(reads).toContain(
      `- It read 240${NO_BREAK_SPACE}log files of the window.`,
    );
    expect(markdown).not.toContain("partner-reader");
    expect(markdown).not.toContain("999999999999");
  });

  test("logs read with none from outside, or read in part, say so as the card does", () => {
    expect(
      describeLogReadsInEnglish(
        exposureViewOf({ accessLogging: true, logRead: exposureLogReadOf({}) })
          .reads,
      ),
    ).toEqual([
      "OneUptime read the store's access logs for this window: no read from outside your accounts.",
      `It read 240${NO_BREAK_SPACE}log files of the window.`,
      "S3 delivers its access logs on a best effort basis, so a person still checks.",
    ]);
    expect(
      describeLogReadsInEnglish(
        exposureViewOf({
          accessLogging: true,
          logRead: exposureLogReadOf({ isComplete: false }),
        }).reads,
      )[1],
    ).toBe(
      `It read 240${NO_BREAK_SPACE}log files, to 2026-11-06 09:00 UTC: the counts are those so far.`,
    );
    // Not read, or read for the window as it was: nothing said of them.
    expect(describeLogReadsInEnglish(exposureViewOf({}).reads)).toEqual([]);
    expect(
      describeLogReadsInEnglish(
        exposureViewOf({
          accessLogging: true,
          logRead: exposureLogReadOf({
            outside: 1,
            windowStart: "2026-10-30T09:00:00.000Z",
          }),
        }).reads,
      ),
    ).toEqual([]);
  });

  test("reads logged, or not known to be: each says so in its own words", () => {
    expect(
      describeReadsInEnglish(exposureViewOf({ accessLogging: true }))[0],
    ).toBe("Reads were logged. The store's access logs say who read it.");
    expect(
      describeReadsInEnglish(exposureViewOf({ accessLogging: null }))[0],
    ).toBe(
      "Whether reads were logged is not known. Treat the data as read until someone checks.",
    );
  });

  test("whose data: what it holds, about how many records, the people's countries and where a person said they live", () => {
    const lines: Array<string> = describeWhoseInEnglish(
      exposureViewOf({ places: [BreachPlace.UnitedKingdom] }),
    );

    expect(lines[0]).toContain("It holds ");
    expect(lines.join(" ")).toContain(`About 48,000${NO_BREAK_SPACE}records.`);
    expect(lines.join(" ")).toContain(
      "Its data shows people in Germany, France and Netherlands.",
    );
    expect(lines.join(" ")).toContain(
      "A person said the people live in the United Kingdom.",
    );
    expect(lines.join(" ")).toContain(
      "Its record of processing says it is about: Customers.",
    );
    expect(
      describeWhoseInEnglish(exposureViewOf({ countries: [] })).join(" "),
    ).toContain("Nobody has said where the people live yet.");
  });

  test("the secrets to rotate: each by its type and where, never its value", () => {
    expect(describeSecretsInEnglish(exposureViewOf())).toEqual([
      "AWS secret access key, at deploy/env.sh (still there).",
    ]);
    expect(describeSecretsInEnglish(exposureViewOf({ secrets: [] }))).toEqual([
      "No secret was found in the store while it was exposed.",
    ]);
    expect(
      describeSecretsInEnglish(
        exposureViewOf({
          secrets: [
            {
              dataTypeId: "github-token",
              dataTypeName: "GitHub token",
              location: "ci/config.yml",
              isStillThere: false,
            },
          ],
        }),
      ),
    ).toEqual(["GitHub token, at ci/config.yml (fixed since)."]);
  });

  test("every law that may apply, with what it asks, who is told, its deadline, what a person checks, its source and the day it was checked", () => {
    const answer: DataSecurityExposureAssessmentResponse = answerWithParts();
    const markdown: string = markdownOf(answer);
    const laws: string = sectionOf(markdown, "Breach Laws That May Apply");
    const elsewhere: string = sectionOf(
      markdown,
      "If Any of the People Live Elsewhere",
    );
    const mayApply: Array<BreachObligation> = answer.view!.obligations.filter(
      (obligation: BreachObligation): boolean => {
        return obligation.status === BreachObligationStatus.MayApply;
      },
    );

    expect(
      mayApply.filter((obligation: BreachObligation): boolean => {
        return obligation.isPlaceKnown;
      }).length,
    ).toBeGreaterThan(1);
    expect(
      mayApply.filter((obligation: BreachObligation): boolean => {
        return !obligation.isPlaceKnown;
      }).length,
    ).toBeGreaterThan(0);

    for (const obligation of mayApply) {
      const rule: BreachLawRule = getBreachLawRule(obligation.ruleId);
      // Where the people are known to live, or wherever they live; else if they live elsewhere.
      const block: string = obligation.isPlaceKnown ? laws : elsewhere;

      expect(block).toContain(`### ${getBreachLawName(rule.id)}`);
      expect(block).toContain(`- **What it asks:** ${rule.action}.`);
      expect(block).toContain(`- **Who is told:** ${rule.recipient}.`);
      expect(block).toContain(`${rule.sourceTitle}, ${rule.sourceUrl}`);
      expect(block).toContain(`checked on ${rule.checkedOn}`);
    }

    // The one due first says so.
    expect(laws).toContain("### GDPR Article 33 (due first)");
    expect(laws).toContain(
      "- **Deadline:** 72 hours from when it was found. Due 2026-11-05 09:00 UTC.",
    );
    expect(laws).toContain(
      "- **Still to check:** Unless the breach is unlikely to result in a risk to the people's rights and freedoms.",
    );
    // A deadline with no length starts its sentence as one.
    expect(laws).toContain("- **Deadline:** Without undue delay.");
    expect(elsewhere).toContain(
      "Each of these applies only if some of the people live where it says. Nobody has said they do.",
    );
    expect(elsewhere).toContain(
      "- **Still to check:** If any of the people live in the United Kingdom.",
    );
  });

  test("a law not in force, or ruled out by the facts, is not one that may apply", () => {
    const answer: DataSecurityExposureAssessmentResponse = exposureAnswerOf({
      view: exposureViewOf({ countries: ["IN"], dataTypeIds: ["in-aadhaar"] }),
    });
    const laws: string = sectionOf(
      markdownOf(answer),
      "Breach Laws That May Apply",
    );

    // DPDP Rule 7 takes effect on 13 May 2027.
    expect(laws).not.toContain(
      `### ${getBreachLawName(BreachLawId.DpdpBoard)}`,
    );
    expect(laws).not.toContain(`### ${getBreachLawName(BreachLawId.PciDss)}`);
    expect(laws).toContain(`### ${getBreachLawName(BreachLawId.CertIn)}`);
  });

  test("what the table does not cover, in plain words, as the card says it", () => {
    const markdown: string = markdownOf(
      exposureAnswerOf({ view: exposureViewOf({ countries: ["DE", "JP"] }) }),
    );
    const uncovered: string = sectionOf(markdown, "What This Does Not Cover");

    expect(uncovered).toContain(
      "- Its data is about people in Japan, whose breach laws this assessment does not cover.",
    );
    expect(uncovered).toContain("Where your organization is established");
    expect(uncovered).toContain("Contracts with customers and partners");
  });

  test("while nobody said which US states, each state's notices are one line under its name, in alphabetical order (#10952)", () => {
    const markdown: string = markdownOf(
      exposureAnswerOf({
        view: exposureViewOf({
          dataTypeIds: ["us-ssn", "person-name"],
          countries: ["US"],
          places: [BreachPlace.UnitedStates],
        }),
      }),
    );
    const states: string = sectionOf(
      markdown,
      "If Any of the People Live in These US States",
    );
    const lines: Array<string> = states
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("- **");
      });

    expect(states).toContain(
      "Each state's notices apply only if some of the people live in that state. Nobody has said which states they live in",
    );
    // One line a state the table covers, Alabama first; Georgia the state reads "Georgia".
    expect(lines).toHaveLength(COVERED_US_STATES.length);
    expect(lines[0]).toBe(
      "- **Alabama:** Code of Alabama 1975 8-38-5: Tell the people affected (45 calendar days from when it was found); Code of Alabama 1975 8-38-6: Tell the state's attorney general (45 calendar days from when it was found, if it affects more than 1,000 people); Code of Alabama 1975 8-38-7: Tell the consumer reporting agencies (in the most expedient time possible and without unreasonable delay, if it affects more than 1,000 people).",
    );
    expect(states).toContain(
      "- **Georgia:** Official Code of Georgia 10-1-912(a): Tell the people affected (in the most expedient time possible and without unreasonable delay); Official Code of Georgia 10-1-912(d): Tell the consumer reporting agencies (in the most expedient time possible and without unreasonable delay, if it affects more than 10,000 people).",
    );
    expect(states).not.toContain("Georgia (US state)");
    expect(states).toContain(
      "- **District of Columbia:** D.C. Code 28-3852(a): Tell the people affected",
    );
    // Puerto Rico, Guam and the US Virgin Islands, whose laws the table holds (#11424, #11426).
    expect(states).toContain(
      "- **Puerto Rico:** Puerto Rico Citizen Information on Data Banks Security Act Section 3: Tell the people affected (in the most expedient time possible and without unreasonable delay); Puerto Rico Citizen Information on Data Banks Security Act Section 3 (Department of Consumer Affairs): Tell Puerto Rico's Department of Consumer Affairs (10 calendar days from when it was found).",
    );
    expect(states).toContain(
      "- **Guam:** Guam Code Annotated, Title 9 48.30(a): Tell the people affected (in the most expedient time possible and without unreasonable delay).",
    );
    expect(states).toContain(
      "- **US Virgin Islands:** Virgin Islands Code, Title 14 2209(a): Tell the people affected (in the most expedient time possible and without unreasonable delay).",
    );
    // Vermont's line is the text in force when the exposure was found: its residents' 45 days, not 2027's.
    expect(states).toContain(
      "- **Vermont:** Vermont Statutes, Title 9 2435(b)(1): Tell the people affected (45 calendar days from when it was found); Vermont Statutes, Title 9 2435(b)(3): Tell the state's attorney general (14 business days from when it was found);",
    );
    // Nobody said the data is held for another: no notice to its owner is a line (#11427).
    expect(states).not.toContain("Tell the data's owner");
    // No state's notice is drawn in full: those are the card's.
    for (const rule of BREACH_LAW_RULES.filter(isUsStateRule)) {
      expect(markdown).not.toContain(`### ${getBreachLawName(rule.id)}`);
    }
  });

  test("a US state a person named is a law that may apply in full, and the states the table leaves out are named (#10952)", () => {
    const markdown: string = markdownOf(
      exposureAnswerOf({
        view: exposureViewOf({
          dataTypeIds: ["us-ssn", "person-name"],
          countries: ["US"],
          places: [BreachPlace.Indiana],
        }),
      }),
    );
    const laws: string = sectionOf(markdown, "Breach Laws That May Apply");

    expect(laws).toContain(
      `### ${getBreachLawName(BreachLawId.IndianaResidents)} (due first)`,
    );
    expect(laws).toContain(
      `### ${getBreachLawName(BreachLawId.IndianaAttorneyGeneral)}`,
    );
    expect(markdown).not.toContain(
      "If Any of the People Live in These US States",
    );

    const uncovered: string = sectionOf(
      markdownOf(
        exposureAnswerOf({
          view: exposureViewOf({
            dataTypeIds: ["us-ssn", "person-name"],
            countries: ["US"],
            places: [BreachPlace.UnitedStates],
          }),
        }),
      ),
      "What This Does Not Cover",
    );

    // Puerto Rico's, Guam's and the US Virgin Islands' laws are rows now (#11424, #11426).
    expect(uncovered).not.toContain("Guam");
    expect(uncovered).not.toContain("Virgin Islands");
    expect(uncovered).not.toContain("Puerto Rico");
    // Each state's notice to the consumer reporting agencies is a row of its own.
    expect(uncovered).not.toContain("consumer reporting agencies");
    expect(uncovered).toContain("West Virginia");
    expect(uncovered.includes("It does not cover the breach laws of")).toBe(
      UNCOVERED_US_STATES.length > 0,
    );
    // Nobody said whose data it is: the notices to its owner wait on the answer (#11427).
    expect(uncovered).toContain(
      "- If your organization holds this data for another, the law may ask you to tell the data's owner. Say whose data it is on the Was It a Breach? card to see those notices.",
    );
  });

  test("data held for another: Texas's notice to the owner is due first, immediately - the export gives it no moment of its own (#11427)", () => {
    const markdown: string = markdownOf(
      exposureAnswerOf({
        view: exposureViewOf({
          dataTypeIds: ["us-ssn", "person-name"],
          countries: ["US"],
          places: [BreachPlace.Texas],
          holdsForAnother: true,
        }),
      }),
    );
    const due: string = sectionOf(markdown, "Due First");
    const laws: string = sectionOf(markdown, "Breach Laws That May Apply");
    const owner: string = laws.slice(
      laws.indexOf(`### ${getBreachLawName(BreachLawId.TexasDataOwner)}`),
      laws.indexOf(
        "\n### ",
        laws.indexOf(`### ${getBreachLawName(BreachLawId.TexasDataOwner)}`) +
          4,
      ),
    );

    expect(due).toContain(
      "**Texas Business and Commerce Code 521.053(c): Tell the data's owner.** The organization that owns the data, or licensed it to you.",
    );
    expect(due).toContain(
      "Due immediately, counted from 2026-11-02 09:00 UTC, when Data Security found the exposure.",
    );
    expect(due).not.toContain("Due  ");
    expect(due).not.toContain("UTC:");
    expect(laws).toContain(
      `### ${getBreachLawName(BreachLawId.TexasDataOwner)} (due first)`,
    );
    expect(owner).toContain("- **What it asks:** Tell the data's owner.");
    expect(owner).toContain(
      "- **Who is told:** The organization that owns the data, or licensed it to you.",
    );
    expect(owner).toContain("- **Deadline:** Immediately.");
    expect(owner).toContain(
      "- **Source:** Texas Business and Commerce Code 521.053(c), https://",
    );
    // The attorney general's 30 days come after it, no longer first.
    expect(laws).toContain(
      `### ${getBreachLawName(BreachLawId.TexasAttorneyGeneral)}\n`,
    );
    expect(laws).not.toContain(
      `### ${getBreachLawName(BreachLawId.TexasAttorneyGeneral)} (due first)`,
    );
    // Answered: the table no longer says the notices wait on it.
    expect(sectionOf(markdown, "What This Does Not Cover")).not.toContain(
      "If your organization holds this data for another",
    );
  });

  test("whose data says what a person said of whose it is, and nothing while nobody has (#11427)", () => {
    expect(
      describeWhoseInEnglish(exposureViewOf({ holdsForAnother: true })),
    ).toContain(
      "A person said your organization holds this data for another organization: the notices owed to the data's owner are among the laws below.",
    );
    expect(
      describeWhoseInEnglish(exposureViewOf({ holdsForAnother: false })),
    ).toContain("A person said this data is your organization's own.");

    const unsaid: string = describeWhoseInEnglish(exposureViewOf()).join(" ");

    expect(unsaid).not.toContain("holds this data for another");
    expect(unsaid).not.toContain("your organization's own");
  });

  test("EU emails held for a client: GDPR's processor's notice is a law that may apply, without undue delay, and the controller's 72 hours are still due first (#11427)", () => {
    const markdown: string = markdownOf(
      exposureAnswerOf({
        view: exposureViewOf({ holdsForAnother: true }),
      }),
    );
    const laws: string = sectionOf(markdown, "Breach Laws That May Apply");

    expect(laws).toContain(`### ${getBreachLawName(BreachLawId.GdprProcessor)}`);
    expect(laws).toContain(
      `### ${getBreachLawName(BreachLawId.GdprAuthority)} (due first)`,
    );
    expect(laws).toContain(
      `- **Who is told:** ${getBreachLawRule(BreachLawId.GdprProcessor).recipient}.`,
    );
    expect(laws).toContain("- **Deadline:** Without undue delay.");
  });

  test("Vermont's two texts: an exposure found in 2026 owes the text in force then, and says the newer takes effect in 2027 (#11425)", () => {
    const markdown: string = markdownOf(
      exposureAnswerOf({
        view: exposureViewOf({
          dataTypeIds: ["us-ssn", "person-name"],
          countries: ["US"],
          places: [BreachPlace.Vermont],
        }),
      }),
    );
    const laws: string = sectionOf(markdown, "Breach Laws That May Apply");

    const residents: string = `### ${getBreachLawName(BreachLawId.VermontResidents)}`;

    // The same section's two texts share its name: only the one in force when it was found may apply.
    expect(getBreachLawName(BreachLawId.VermontResidentsFrom2027)).toBe(
      getBreachLawName(BreachLawId.VermontResidents),
    );
    expect(laws.split(residents).length - 1).toBe(1);
    expect(laws).toContain(
      `### ${getBreachLawName(BreachLawId.VermontAttorneyGeneral)} (due first)`,
    );
    expect(laws).toContain(
      `- **Source:** ${getBreachLawRule(BreachLawId.VermontResidents).sourceTitle}, `,
    );
    expect(laws).toContain(
      "Vermont Statutes, Title 9, 2435(b)(3), as in force until 1 January 2027",
    );
    // The text from 1 January 2027 is not in force yet: not a law that may apply, and not cited.
    expect(laws).not.toContain(
      getBreachLawRule(BreachLawId.VermontResidentsFrom2027).sourceTitle,
    );
    expect(laws).not.toContain("in force from 1 January 2027");
  });

  test("each part as a person last saved it: who wrote it and when, its words, and the facts a draft rests on", () => {
    const markdown: string = markdownOf(answerWithParts());

    const explanation: string = sectionOf(markdown, "What This Means");

    expect(explanation).toContain("_Drafted by OneUptime AI on 2026-11-11._");
    expect(explanation).toContain(
      "The bucket of EU customers' emails was public for nine days",
    );
    expect(explanation).toContain("Rests on: F2, F3.");
    // The explanation is no notice: no draft line of its own.
    expect(explanation).not.toContain(DRAFT_NOT_LEGAL_ADVICE_ENGLISH);

    const regulator: string = sectionOf(markdown, "Notice to the Regulator");

    expect(regulator).toContain(`_${DRAFT_NOT_LEGAL_ADVICE_ENGLISH}_`);
    expect(regulator).toContain("_Edited by Ana Ortiz on 2026-11-11._");
    expect(regulator).toContain("[Contact details of our DPO]");
    expect(regulator).not.toContain("Rests on:");

    const people: string = sectionOf(markdown, "Notice to the People Affected");

    expect(people).toContain(`_${DRAFT_NOT_LEGAL_ADVICE_ENGLISH}_`);
    expect(people).toContain("_Not written yet._");

    const summary: string = sectionOf(markdown, "Internal Summary");

    expect(summary).toContain(`_${DRAFT_NOT_LEGAL_ADVICE_ENGLISH}_`);
    expect(summary).toContain(
      "_The facts it rests on changed since it was written._",
    );
    expect(summary).toContain("Rests on: F1, F2.");

    const facts: string = sectionOf(markdown, "The Facts the Drafts Rest On");

    expect(facts).toContain("- **F1.** ");
    expect(facts).toContain("- **F2.** ");
    expect(facts).toContain("- **F3.** ");
  });

  test("an edit by someone the project no longer knows is still an edit, unnamed", () => {
    const markdown: string = markdownOf(answerWithParts({ editors: {} }));

    expect(sectionOf(markdown, "Notice to the Regulator")).toContain(
      "_Edited on 2026-11-11._",
    );
  });

  test("a case assessed with nothing drafted yet still exports what plain code worked out, each part not written yet", () => {
    const markdown: string = markdownOf(exposureAnswerOf());

    expect(markdown).toContain("## Due First");
    expect(markdown).toContain("## Breach Laws That May Apply");
    expect(markdown.match(/_Not written yet\._/g)).toHaveLength(4);
    expect(markdown).not.toContain("## The Facts the Drafts Rest On");
  });

  test("its own words are English, whatever the reader reads the page in", () => {
    const markdown: string = markdownOf(answerWithParts());

    for (const heading of [
      "## Due First",
      "## Who Could Read It",
      "## Notice to the Regulator",
    ]) {
      expect(markdown).toContain(heading);
    }

    expect(markdown).toContain(
      "Reads were not logged. Treat the data as read.",
    );
  });

  test("every row a law may apply by has its source and day, so the export can cite each one", () => {
    for (const rule of BREACH_LAW_RULES) {
      expect(rule.sourceUrl).toMatch(/^https?:\/\//);
      expect(rule.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("written at a fixed moment: the same answer always exports the same document", () => {
    expect(markdownOf(answerWithParts())).toBe(markdownOf(answerWithParts()));
    expect(EXPOSURE_NOW.toISOString()).toBe("2026-11-11T12:00:00.000Z");
  });
});

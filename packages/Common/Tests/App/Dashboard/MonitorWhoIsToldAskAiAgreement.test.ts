import { describe, expect, test } from "@jest/globals";
/*
 * Toolbox/Index first: the toolbox sits in an import cycle (tool -> service
 * -> ... -> AIToolbox), and production always enters through Index.
 */
import "../../../Server/Utils/AI/Toolbox/Index";
import { describeWhoIsToldForModel } from "../../../Server/Utils/AI/Toolbox/WhoIsToldTools";
import {
  getBreakSentence,
  getWhoIsToldSentences,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldWords";
import {
  WHO_IS_TOLD_PERSON_PROBLEM_CLAUSES,
  WhoIsToldBreak,
  WhoIsToldBreakKind,
  WhoIsToldCriteria,
  WhoIsToldFix,
  WhoIsToldOwners,
  WhoIsToldOwnersSource,
  WhoIsToldPersonProblem,
  WhoIsToldResult,
  makeWhoIsToldBreak,
} from "../../../Types/Monitor/WhoIsTold";
import { OnCallTestPageRecordKind } from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { createTranslator, Translator } from "../../../Types/Translator";

/*
 * ASK AI AND THE MONITOR'S PAGE SAY THE SAME WHO IS EMAILED (#7396).
 *
 * "Who is told when example.com goes down?" is answered on the monitor's
 * overview by the "When this goes down" card (WhoIsToldWords) and in Ask AI
 * by the who_is_told tool (WhoIsToldTools), both from the same resolver
 * answer. Each says where an incident's, an alert's or a status change's
 * owners come from, for each source Types/Monitor/WhoIsTold defines. The two
 * drifted once: the card learned the OwnerRules source (#7205) while the
 * tool still read a field that source replaced, and main stopped compiling.
 * Here, for every source, in the place the resolver uses it, the card's
 * English "It emails ..." and the tool's "emails ..." name the same owners in
 * the same words - with no names, and with one (where the two lists are
 * written alike: the card joins several with "and", the tool with commas and
 * says "team" before a team, for the model).
 */

const english: Translator = createTranslator(undefined, "en");

// Where the resolver hands each source: on what opens, or on a status change.
const EVENT_SOURCES: ReadonlyArray<WhoIsToldOwnersSource> = [
  WhoIsToldOwnersSource.Named,
  WhoIsToldOwnersSource.OwnerRules,
  WhoIsToldOwnersSource.ProjectOwners,
];
const STATUS_SOURCES: ReadonlyArray<WhoIsToldOwnersSource> = [
  WhoIsToldOwnersSource.MonitorOwners,
  WhoIsToldOwnersSource.ProjectOwners,
];

function answer(criteria: WhoIsToldCriteria): WhoIsToldResult {
  return {
    monitorId: "55555555-5555-4555-8555-555555555555",
    monitorName: "example.com",
    checkedAt: "2026-11-12T10:00:00.000Z",
    criteria: [criteria],
    channels: {
      isBillingEnabled: false,
      isSmsOn: true,
      isCallOn: true,
      isWhatsAppOn: false,
      isTelegramOn: false,
      hasOwnTwilioForSms: false,
      hasOwnTwilioForCalls: false,
      serverCanSendEmail: true,
      serverCanSendSms: true,
      serverCanCall: true,
    },
    breaks: [],
  };
}

// A criteria that opens an incident, which emails `owners`.
function opening(owners: WhoIsToldOwners): WhoIsToldResult {
  return answer({
    id: "c1",
    name: "Check if offline",
    statusName: "Offline",
    events: [
      {
        kind: OnCallTestPageRecordKind.Incident,
        title: "example.com is offline",
        severityName: "Critical",
        owners: owners,
        ownerRules: [],
        rules: [],
        policies: [],
        statusPages: [],
      },
    ],
  });
}

// A criteria that only changes the status, which emails `owners` of it.
function statusChange(owners: WhoIsToldOwners): WhoIsToldResult {
  return answer({
    id: "c2",
    name: "Check if offline",
    statusName: "Offline",
    statusOwners: owners,
    events: [],
  });
}

// The card's "It emails ..." sentence, the second of its first words.
function cardSays(result: WhoIsToldResult): string {
  const sentence: string | undefined = getWhoIsToldSentences(
    result,
    english,
  ).find((item: string): boolean => {
    return item.startsWith("It emails ");
  });

  expect(sentence).toBeDefined();

  return sentence || "";
}

// Who the tool says is emailed: the words after "emails" on `lead`'s line.
function toolSays(
  result: WhoIsToldResult,
  lead: string,
  tail: string = "",
): string {
  const line: string | undefined = describeWhoIsToldForModel(result)
    .split("\n")
    .find((item: string): boolean => {
      return item.startsWith(lead) && item.endsWith(tail);
    });

  expect(line).toBeDefined();

  return (line || "").slice(lead.length, (line || "").length - tail.length);
}

const OPENS_LEAD: string =
  '  - opens an incident (Critical) titled "example.com is offline"; emails ';
const STATUS_LEAD: string =
  '- Criteria "Check if offline": sets status Offline; emails ';
const STATUS_TAIL: string = " of the change";

// test.each's table: one row per source.
function rows(
  sources: ReadonlyArray<WhoIsToldOwnersSource>,
): Array<[WhoIsToldOwnersSource]> {
  return sources.map(
    (source: WhoIsToldOwnersSource): [WhoIsToldOwnersSource] => {
      return [source];
    },
  );
}

// Each source with no name to say, then with one.
function noNameThenOne(name: string): Array<Array<string>> {
  return [[], [name]];
}

function owners(
  source: WhoIsToldOwnersSource,
  userNames: Array<string>,
): WhoIsToldOwners {
  return { source: source, userNames: userNames, teamNames: [] };
}

describe("Ask AI's who_is_told and the When this goes down card", () => {
  test("between them, every owners source WhoIsTold defines is compared", () => {
    expect(
      new Set<WhoIsToldOwnersSource>([...EVENT_SOURCES, ...STATUS_SOURCES]),
    ).toEqual(
      new Set<WhoIsToldOwnersSource>(Object.values(WhoIsToldOwnersSource)),
    );
  });

  test.each(rows(EVENT_SOURCES))(
    "what opens, emailing %s: the same owners in the same words",
    (source: WhoIsToldOwnersSource) => {
      for (const names of noNameThenOne("Ben Ito")) {
        const result: WhoIsToldResult = opening(owners(source, names));
        const tool: string = toolSays(result, OPENS_LEAD);

        expect(cardSays(result)).toBe(`It emails ${tool}.`);
        if (names.length > 0) {
          expect(tool).toContain("(Ben Ito)");
        }
      }
    },
  );

  test.each(rows(STATUS_SOURCES))(
    "a status change, emailing %s: the same owners in the same words",
    (source: WhoIsToldOwnersSource) => {
      for (const names of noNameThenOne("Me Myself")) {
        const result: WhoIsToldResult = statusChange(owners(source, names));
        const tool: string = toolSays(result, STATUS_LEAD, STATUS_TAIL);

        expect(cardSays(result)).toBe(`It emails ${tool}.`);
        if (names.length > 0) {
          expect(tool).toContain("(Me Myself)");
        }
      }
    },
  );

  /*
   * An owner the on-call page reaches first is not emailed as an owner too
   * (#8860): the card and Ask AI leave out the same owner, say whom the
   * email still reaches in the same words, and say why in the same terms -
   * an owner, or a Project Owner.
   */
  test.each(rows(EVENT_SOURCES))(
    "what opens, emailing %s, one of whom the page reaches first: both leave out the same owner, and say why alike",
    (source: WhoIsToldOwnersSource) => {
      const role: string =
        source === WhoIsToldOwnersSource.ProjectOwners
          ? "a Project Owner"
          : "an owner";
      const result: WhoIsToldResult = opening({
        ...owners(source, ["Ben Ito"]),
        pagedOwners: [{ userId: "u1", name: "Ana Lopez" }],
      });
      const parts: Array<string> = toolSays(result, OPENS_LEAD).split(
        " - not ",
      );

      expect(parts).toHaveLength(2);
      expect(cardSays(result)).toBe(`It emails ${parts[0]}.`);
      expect(cardSays(result)).not.toContain("Ana Lopez");
      expect(getWhoIsToldSentences(result, english)).toContain(
        `Ana Lopez is paged, so isn't emailed as ${role} too.`,
      );
      expect(parts[1]).toBe(
        `Ana Lopez, whom the on-call page reaches first, so is not emailed as ${role} too`,
      );
    },
  );

  test("every owner the page reaches first: the card says no email, and Ask AI that nobody is emailed as an owner", () => {
    const result: WhoIsToldResult = opening({
      ...owners(WhoIsToldOwnersSource.ProjectOwners, []),
      pagedOwners: [{ userId: "u1", name: "Me Myself" }],
    });
    const sentences: Array<string> = getWhoIsToldSentences(result, english);

    expect(
      sentences.some((item: string): boolean => {
        return item.startsWith("It emails ");
      }),
    ).toBe(false);
    expect(sentences).toContain(
      "Me Myself is paged, so isn't emailed as a Project Owner too.",
    );
    expect(toolSays(result, OPENS_LEAD)).toBe(
      "nobody as an owner: Me Myself, whom the on-call page reaches first, so is not emailed as a Project Owner too",
    );
  });

  test("the OwnerRules source is never said as the project's owners, on the card or by Ask AI", () => {
    const result: WhoIsToldResult = opening(
      owners(WhoIsToldOwnersSource.OwnerRules, ["Dana Reyes"]),
    );

    expect(cardSays(result)).toBe(
      "It emails the owners added by owner rules (Dana Reyes).",
    );
    expect(toolSays(result, OPENS_LEAD)).toBe(
      "the owners added by owner rules (Dana Reyes)",
    );
  });
});

/*
 * WHY A PERSON CAN'T BE PAGED, SAID ALIKE (#7525). The card says it in a
 * break's sentence ("Ana Lopez has no verified notification method."), the
 * server's break message and Ask AI's who_is_told in the same clause after
 * the name (WHO_IS_TOLD_PERSON_PROBLEM_CLAUSES) - the tool after the card's
 * "Can't be paged" - so the model never answers in a code, nor in other
 * words than the page.
 */
function unreachable(problem: WhoIsToldPersonProblem): WhoIsToldResult {
  const result: WhoIsToldResult = opening(
    owners(WhoIsToldOwnersSource.ProjectOwners, []),
  );

  result.criteria[0]!.events[0]!.policies = [
    {
      id: "p1",
      name: "Default",
      isHidden: false,
      isNamedByCriteria: true,
      ruleIds: [],
      levelCount: 1,
      people: [
        {
          userId: "u2",
          name: "Ana Lopez",
          channels: [],
          isFallback: false,
          isReachable: false,
          problem: problem,
        },
      ],
      notPaged: [],
    },
  ];

  return result;
}

describe("Ask AI's who_is_told and the card: why someone can't be paged", () => {
  test.each(
    Object.values(WhoIsToldPersonProblem).map(
      (problem: WhoIsToldPersonProblem): [WhoIsToldPersonProblem] => {
        return [problem];
      },
    ),
  )(
    "%s: the card, the server's break and Ask AI say the same reason",
    (problem: WhoIsToldPersonProblem) => {
      const clause: string = WHO_IS_TOLD_PERSON_PROBLEM_CLAUSES[problem];
      const brk: WhoIsToldBreak = makeWhoIsToldBreak({
        kind: WhoIsToldBreakKind.PersonUnreachable,
        fix: WhoIsToldFix.OnCallReadiness,
        policyId: "p1",
        policyName: "Default",
        userId: "u2",
        userName: "Ana Lopez",
        problem: problem,
      });

      // The card's sentence, in English.
      expect(getBreakSentence(brk, english)).toBe(`Ana Lopez ${clause}.`);
      // The server's own English break, for other readers of the API.
      expect(brk.message.startsWith(`Ana Lopez ${clause}, `)).toBe(true);
      // Ask AI, after the card's "Can't be paged".
      expect(describeWhoIsToldForModel(unreachable(problem))).toContain(
        `Ana Lopez: can't be paged, because Ana Lopez ${clause}`,
      );
    },
  );
});

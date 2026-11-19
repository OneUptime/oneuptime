/*
 * The toolbox first: its tools import services that import it back, and
 * the toolbox lists them whole only when it is the one loaded first.
 */
import AIToolbox from "../../Toolbox/Index";
import {
  AIChatCitation,
  AIChatCitationTargetType,
} from "../../../../../Types/AI/AIChatTypes";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import {
  isSameWebsiteAddress,
  parseWebsiteAddress,
} from "../../../../../Utils/GuidedSetup/WebsiteMonitorRecords";
import { DOCS_ANSWER_NOT_COVERED } from "../../Chat/ObservabilityChatPrompt";
import { isDocsNotCoveredAnswer } from "../../../../../Types/AI/AskAiAnswers";
import {
  AskAiEvalPerson,
  AskAiEvalProject,
  AskAiEvalProjectKind,
  pagesPeople,
} from "./AskAiEvalProject";
import { AskAiEvalCall, AskAiEvalTurn } from "./AskAiEvalTurn";

/*
 * HOW AN ANSWER OF ASK AI IS GRADED, WHEN A LIVE MODEL GAVE IT (#7246,
 * #7066).
 *
 * A setup request (Tests/Server/Utils/AI/AskAiSetupRequests.ts) passes when
 * the plan the model proposed in one answer, for one approval card, is the
 * request's: the same setup tools, each with the arguments the request
 * lists, present and not contradicted (an argument the schema takes that
 * the list leaves out is allowed); nothing proposed for a request no setup
 * action answers; no set_up_paging in a project that pages people already;
 * no question in place of a plan it could work out, and never a question
 * for a phone number. A part refused before the card counts as proposed:
 * the request's note says which ones are, and the model was told why.
 *
 * A how-do-I question (App's Tests/FeatureSet/Docs/AskAiHowDoIQuestions.ts)
 * passes when the answer cites the docs page that answers it (or another
 * the list says does) and, for a question done on a Dashboard page, ends
 * with that page's Go to button: a DashboardPage citation the answer's text
 * cites, as AskAiPageLinks draws one. A question the docs do not cover
 * passes when the answer says "The docs do not cover this."
 *
 * Every grade is a pass or a fail, with the reasons a person reads in the
 * report. Pure functions: they read the turn, never a model or a database.
 */

export interface AskAiExpectedCall {
  tool: string;
  arguments: JSONObject;
}

export interface AskAiSetupCase {
  id: string;
  request: string;
  projectKind: AskAiEvalProjectKind;
  expected: Array<AskAiExpectedCall>;
  language: string;
  note?: string | undefined;
}

export interface AskAiHowDoICase {
  id: string;
  question: string;
  language: string;
  // The page under /docs/<lang>/ that answers it, and others that do too.
  docsPage?: string | undefined;
  alsoAnswers?: Array<string> | undefined;
  // The Dashboard page where it is done: its title, and its route.
  dashboardPage?: string | undefined;
  dashboardPath?: string | undefined;
  // A question the docs do not cover: the answer must say so.
  notCovered?: boolean | undefined;
}

export interface AskAiGrade {
  passed: boolean;
  reasons: Array<string>;
}

const CITATION_MARK: RegExp = /\[(C\d+)\]/g;

// A question that asks for a phone number, in the languages asked in.
const PHONE_WORDS: RegExp =
  /phone|mobile|cell|number|nummer|telefon|handy|شماره|تلفن|موبایل/i;

function describeCall(call: {
  name?: string;
  tool?: string;
  arguments: JSONObject;
}): string {
  return `${call.name || call.tool}(${JSON.stringify(call.arguments)})`;
}

// A name as it is compared: its case, an address's scheme and slash aside.
function normalized(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

// The member a name or an address means, so either one names them.
function personNamed(
  project: AskAiEvalProject,
  value: string,
): AskAiEvalPerson | undefined {
  const text: string = normalized(value);

  return project.members.find((person: AskAiEvalPerson): boolean => {
    return (
      normalized(person.name) === text || normalized(person.email) === text
    );
  });
}

function sameString(
  project: AskAiEvalProject,
  key: string,
  expected: string,
  actual: string,
): boolean {
  if (normalized(expected) === normalized(actual)) {
    return true;
  }

  if (key === "address" && parseWebsiteAddress(actual)) {
    return isSameWebsiteAddress(expected, actual);
  }

  const person: AskAiEvalPerson | undefined = personNamed(project, expected);

  return Boolean(person && personNamed(project, actual) === person);
}

/*
 * Whether a value the model gave says what the list's does: the same
 * string, number or flag; for a list, every value the list names among
 * the model's; for an object, every key the list names, matching.
 */
export function valueMatches(
  project: AskAiEvalProject,
  key: string,
  expected: JSONValue,
  actual: JSONValue | undefined,
): boolean {
  if (actual === undefined || actual === null) {
    return false;
  }

  if (Array.isArray(expected)) {
    const given: Array<JSONValue> = Array.isArray(actual) ? actual : [actual];

    return expected.every((item: JSONValue): boolean => {
      return given.some((candidate: JSONValue): boolean => {
        return valueMatches(project, key, item, candidate);
      });
    });
  }

  if (typeof expected === "object") {
    if (typeof actual !== "object" || Array.isArray(actual)) {
      return false;
    }

    return Object.keys(expected as JSONObject).every((inner: string) => {
      return valueMatches(
        project,
        inner,
        (expected as JSONObject)[inner] as JSONValue,
        (actual as JSONObject)[inner],
      );
    });
  }

  if (typeof expected === "number") {
    return Number(actual) === expected;
  }

  if (typeof expected === "boolean") {
    return actual === expected || String(actual) === String(expected);
  }

  return sameString(project, key, String(expected), String(actual));
}

// What a call says against the list's: the keys it leaves out or contradicts.
export function compareArguments(
  project: AskAiEvalProject,
  expected: JSONObject,
  actual: JSONObject,
): Array<string> {
  return Object.keys(expected)
    .filter((key: string): boolean => {
      return !valueMatches(
        project,
        key,
        expected[key] as JSONValue,
        actual[key],
      );
    })
    .map((key: string): string => {
      return actual[key] === undefined
        ? `${key} is missing (want ${JSON.stringify(expected[key])})`
        : `${key} is ${JSON.stringify(actual[key])}, not ${JSON.stringify(expected[key])}`;
    });
}

// The sentences of an answer that ask the person something.
export function getQuestionsAsked(text: string): Array<string> {
  return (text.match(/[^.!?\n]*[?؟]/g) || [])
    .map((sentence: string): string => {
      return sentence.trim();
    })
    .filter(Boolean);
}

/*
 * The expected calls matched to the plan's, each to a call of its own
 * tool: what is missing, what is said wrong, and what is proposed besides.
 */
function matchPlan(
  project: AskAiEvalProject,
  expected: Array<AskAiExpectedCall>,
  plan: Array<AskAiEvalCall>,
): Array<string> {
  const reasons: Array<string> = [];
  const left: Array<AskAiEvalCall> = [...plan];

  for (const want of expected) {
    const sameTool: Array<AskAiEvalCall> = left.filter(
      (call: AskAiEvalCall): boolean => {
        return call.name === want.tool;
      },
    );
    const match: AskAiEvalCall | undefined =
      sameTool.find((call: AskAiEvalCall): boolean => {
        return (
          compareArguments(project, want.arguments, call.arguments).length === 0
        );
      }) || sameTool[0];

    if (!match) {
      reasons.push(`Did not propose ${describeCall(want)}.`);
      continue;
    }

    left.splice(left.indexOf(match), 1);

    const wrong: Array<string> = compareArguments(
      project,
      want.arguments,
      match.arguments,
    );

    if (wrong.length > 0) {
      reasons.push(`${want.tool}: ${wrong.join("; ")}.`);
    }
  }

  for (const extra of left) {
    reasons.push(`Also proposed ${describeCall(extra)}.`);
  }

  return reasons;
}

export function gradeSetupTurn(
  setupCase: AskAiSetupCase,
  project: AskAiEvalProject,
  turn: AskAiEvalTurn,
): AskAiGrade {
  if (turn.error) {
    return { passed: false, reasons: [`The turn failed: ${turn.error}`] };
  }

  const reasons: Array<string> = [];
  const questions: Array<string> = getQuestionsAsked(turn.answer);
  const expectedActions: Array<AskAiExpectedCall> = setupCase.expected.filter(
    (call: AskAiExpectedCall): boolean => {
      return AIToolbox.isMutationTool(call.tool);
    },
  );
  const expectedReads: Array<AskAiExpectedCall> = setupCase.expected.filter(
    (call: AskAiExpectedCall): boolean => {
      return !AIToolbox.isMutationTool(call.tool);
    },
  );
  const allActions: Array<AskAiEvalCall> = turn.calls.filter(
    (call: AskAiEvalCall): boolean => {
      return AIToolbox.isMutationTool(call.name);
    },
  );

  const askedForPhone: string | undefined = questions.find(
    (sentence: string): boolean => {
      return PHONE_WORDS.test(sentence);
    },
  );

  if (askedForPhone) {
    reasons.push(`Asked for a phone number: "${askedForPhone}"`);
  }

  if (
    pagesPeople(project) &&
    allActions.some((call: AskAiEvalCall): boolean => {
      return call.name === "set_up_paging";
    })
  ) {
    reasons.push(
      "Proposed set_up_paging in a project whose on-call policies page people already.",
    );
  }

  for (const read of expectedReads) {
    const made: boolean = turn.calls.some((call: AskAiEvalCall): boolean => {
      return (
        call.name === read.tool &&
        compareArguments(project, read.arguments, call.arguments).length === 0
      );
    });

    if (!made) {
      reasons.push(`Did not call ${describeCall(read)}.`);
    }
  }

  if (expectedActions.length === 0) {
    if (allActions.length > 0) {
      reasons.push(
        `Proposed ${allActions.map(describeCall).join(", ")}, though no setup action answers this.`,
      );
    }

    return { passed: reasons.length === 0, reasons };
  }

  if (turn.answersWithActions === 0) {
    reasons.push(
      questions.length > 0
        ? `Proposed nothing, and asked instead: "${questions[0]}"`
        : "Proposed nothing.",
    );

    return { passed: false, reasons };
  }

  /*
   * The plan as first proposed: a later answer may propose again once a
   * part was refused before the card, but one that splits a plan no
   * refusal touched asks for two approvals where one would do.
   */
  if (turn.answersWithActions > 1 && turn.refusedBeforeCard.length === 0) {
    reasons.push(
      `Proposed its plan over ${turn.answersWithActions} answers, not on one card.`,
    );
  }

  reasons.push(...matchPlan(project, expectedActions, turn.proposed));

  return { passed: reasons.length === 0, reasons };
}

// The citations an answer's text cites, in the order it names them.
export function getCitedCitations(
  text: string,
  citations: ReadonlyArray<AIChatCitation>,
): Array<AIChatCitation> {
  const cited: Array<AIChatCitation> = [];

  for (const match of text.matchAll(CITATION_MARK)) {
    const citation: AIChatCitation | undefined = citations.find(
      (candidate: AIChatCitation): boolean => {
        return candidate.id === match[1];
      },
    );

    if (citation && !cited.includes(citation)) {
      cited.push(citation);
    }
  }

  return cited;
}

// The docs pages an answer cites, by their address under /docs/<lang>/.
export function getCitedDocsPages(turn: AskAiEvalTurn): Array<string> {
  return getCitedCitations(turn.answer, turn.citations)
    .filter((citation: AIChatCitation): boolean => {
      return citation.target?.type === AIChatCitationTargetType.DocsPage;
    })
    .map((citation: AIChatCitation): string => {
      return String(citation.target?.params?.["page"] || "");
    })
    .filter(Boolean);
}

// The Go to buttons under an answer: the Dashboard pages its text cites.
export function getOfferedPages(
  turn: AskAiEvalTurn,
): Array<{ path: string; title: string }> {
  return getCitedCitations(turn.answer, turn.citations)
    .filter((citation: AIChatCitation): boolean => {
      return citation.target?.type === AIChatCitationTargetType.DashboardPage;
    })
    .map((citation: AIChatCitation) => {
      return {
        path: String(citation.target?.params?.["path"] || ""),
        title: String(citation.target?.params?.["title"] || citation.label),
      };
    });
}

export function gradeHowDoITurn(
  howDoICase: AskAiHowDoICase,
  turn: AskAiEvalTurn,
): AskAiGrade {
  if (turn.error) {
    return { passed: false, reasons: [`The turn failed: ${turn.error}`] };
  }

  // In any language Ask AI answers in (#7064), as its own events count it.
  const saysNotCovered: boolean = isDocsNotCoveredAnswer(turn.answer);

  if (howDoICase.notCovered) {
    return saysNotCovered
      ? { passed: true, reasons: [] }
      : {
          passed: false,
          reasons: [`Answered instead of saying "${DOCS_ANSWER_NOT_COVERED}"`],
        };
  }

  const reasons: Array<string> = [];
  const pages: Array<string> = getCitedDocsPages(turn);
  const answering: Array<string> = [
    ...(howDoICase.docsPage ? [howDoICase.docsPage] : []),
    ...(howDoICase.alsoAnswers || []),
  ];

  if (saysNotCovered) {
    reasons.push(`Said "${DOCS_ANSWER_NOT_COVERED}"`);
  }

  if (
    !pages.some((page: string): boolean => {
      return answering.includes(page);
    })
  ) {
    reasons.push(
      `Cited no page that answers it (${answering.join(" or ")}); cited ${
        pages.length > 0 ? pages.join(", ") : "no docs page"
      }.`,
    );
  }

  if (howDoICase.dashboardPath || howDoICase.dashboardPage) {
    const offered: Array<{ path: string; title: string }> =
      getOfferedPages(turn);
    const isOffered: boolean = offered.some(
      (page: { path: string; title: string }): boolean => {
        return howDoICase.dashboardPath
          ? page.path === howDoICase.dashboardPath
          : page.title === howDoICase.dashboardPage;
      },
    );

    if (!isOffered) {
      reasons.push(
        `Offered no Go to ${howDoICase.dashboardPage || howDoICase.dashboardPath} button; offered ${
          offered.length > 0
            ? offered
                .map((page: { path: string; title: string }): string => {
                  return page.title;
                })
                .join(", ")
            : "none"
        }.`,
      );
    }
  }

  return { passed: reasons.length === 0, reasons };
}

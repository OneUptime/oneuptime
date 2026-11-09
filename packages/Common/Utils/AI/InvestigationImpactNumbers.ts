import { JSONObject } from "../../Types/JSON";

/*
 * AN INVESTIGATION'S IMPACT IN NUMBERS (#5715's follow-up: "Impact shows
 * only in the full investigation report, not on the folded Investigation
 * step").
 *
 * A report's Impact section says who and what the incident or alert hurts,
 * a cited line each for the users, the services and the SLOs, with how each
 * was counted (InvestigationReport's Impact kind). Those lines are long -
 * what was counted, over which window, which citation - so the folded
 * Investigation step, which shows the report's one-line summary, cannot
 * show them. It shows short numbers instead: "1,240 requests affected",
 * "2 services affected", "1 of 2 SLOs affected".
 *
 * The numbers come from the run, never from reading the prose: the
 * investigation persona asks the model to close its answer with one fenced
 * block of JSON in a language of its own (INVESTIGATION_IMPACT_NUMBERS_
 * LANGUAGE), the engine takes that block off the report before anything
 * posts it (takeInvestigationImpactNumbers), and records the numbers on the
 * run as an InvestigationImpact event, which the AI card reads
 * (parseInvestigationImpactNumbers).
 *
 * Display-only, like the TL;DR: nothing branches on these numbers. They are
 * held to what can be drawn - whole counts from 0 to a trillion, at most the
 * number of SLOs there are - and anything else is dropped: a block that
 * does not read leaves the card showing the summary alone, as before.
 *
 * Pure: the engine takes the numbers with it, the Dashboard reads what the
 * run recorded with it, and the suites hold both to it.
 */

// A Windows line ending's \r, at the end of a line split on \n.
const CARRIAGE_RETURN_AT_END: RegExp = /\r$/;

// The fenced block's language: ```impact-numbers ... ```.
export const INVESTIGATION_IMPACT_NUMBERS_LANGUAGE: string = "impact-numbers";

// What a users' count counted. Failed requests are not users.
export enum InvestigationImpactCounted {
  Users = "users",
  Sessions = "sessions",
  Requests = "requests",
}

export interface InvestigationImpactUsers {
  count: number;
  counted: InvestigationImpactCounted;
}

export interface InvestigationImpactServices {
  count: number;
}

export interface InvestigationImpactSlos {
  // How many of the SLOs that count the subject it burns.
  affected: number;
  // How many SLOs count the subject.
  total: number;
}

/*
 * What the run measured, each part left out when it did not: the people
 * (or sessions, or requests) it hurt, the services it reaches and the SLOs
 * it burns.
 */
export interface InvestigationImpactNumbers {
  users?: InvestigationImpactUsers | undefined;
  services?: InvestigationImpactServices | undefined;
  slos?: InvestigationImpactSlos | undefined;
}

// The largest count drawn: anything larger is not a measurement.
export const MAX_INVESTIGATION_IMPACT_COUNT: number = 1_000_000_000_000;

/*
 * The longest block read: the persona's block is a line of JSON, a few
 * hundred characters at most.
 */
export const MAX_INVESTIGATION_IMPACT_BLOCK_LENGTH: number = 2000;

// The words a model may say what it counted with, lower case.
const COUNTED_WORDS: ReadonlyArray<{
  counted: InvestigationImpactCounted;
  words: ReadonlyArray<string>;
}> = [
  {
    counted: InvestigationImpactCounted.Users,
    words: [
      "users",
      "user",
      "people",
      "customers",
      "customer",
      "visitors",
      "end users",
    ],
  },
  {
    counted: InvestigationImpactCounted.Sessions,
    words: ["sessions", "session", "user sessions", "browser sessions"],
  },
  {
    counted: InvestigationImpactCounted.Requests,
    words: [
      "requests",
      "request",
      "failed requests",
      "slow requests",
      "calls",
      "transactions",
      "errors",
      "spans",
      "root spans",
    ],
  },
];

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/*
 * A count as the run wrote it: a whole number from 0 up, or a string of
 * digits; null for anything else (a fraction is rounded, a negative, a
 * word or "1,240" is not a count).
 */
function readCount(value: unknown): number | null {
  let count: number | null = null;

  if (typeof value === "number") {
    count = value;
  } else if (typeof value === "string") {
    const trimmed: string = value.trim();

    if (trimmed.length > 0 && trimmed.length <= 13) {
      let isDigits: boolean = true;

      for (const character of trimmed) {
        if (character < "0" || character > "9") {
          isDigits = false;
          break;
        }
      }

      count = isDigits ? Number(trimmed) : null;
    }
  }

  if (count === null || !Number.isFinite(count) || count < 0) {
    return null;
  }

  const whole: number = Math.round(count);

  return whole <= MAX_INVESTIGATION_IMPACT_COUNT ? whole : null;
}

function readCounted(value: unknown): InvestigationImpactCounted | null {
  if (typeof value !== "string") {
    return null;
  }

  const word: string = value.trim().toLowerCase();

  for (const entry of COUNTED_WORDS) {
    if (entry.words.includes(word)) {
      return entry.counted;
    }
  }

  return null;
}

function readUsers(value: unknown): InvestigationImpactUsers | null {
  if (!isObject(value)) {
    return null;
  }

  const count: number | null = readCount(value["count"]);
  const counted: InvestigationImpactCounted | null = readCounted(
    value["counted"],
  );

  return count === null || counted === null ? null : { count, counted };
}

function readServices(value: unknown): InvestigationImpactServices | null {
  if (!isObject(value)) {
    return null;
  }

  const count: number | null = readCount(value["count"]);

  return count === null ? null : { count };
}

/*
 * The SLOs it burns, of how many count it: there is at least one, and no
 * more are burned than there are.
 */
function readSlos(value: unknown): InvestigationImpactSlos | null {
  if (!isObject(value)) {
    return null;
  }

  const affected: number | null = readCount(value["affected"]);
  const total: number | null = readCount(value["total"]);

  if (affected === null || total === null || total < 1 || affected > total) {
    return null;
  }

  return { affected, total };
}

/*
 * The numbers as a run recorded them (an InvestigationImpact event's
 * resultSummary.impactNumbers), or as the model wrote them in its block:
 * each part that reads, the others left out; null when none does.
 */
export function parseInvestigationImpactNumbers(
  value: unknown,
): InvestigationImpactNumbers | null {
  if (!isObject(value)) {
    return null;
  }

  const users: InvestigationImpactUsers | null = readUsers(value["users"]);
  const services: InvestigationImpactServices | null = readServices(
    value["services"],
  );
  const slos: InvestigationImpactSlos | null = readSlos(value["slos"]);

  if (!users && !services && !slos) {
    return null;
  }

  return {
    ...(users ? { users } : {}),
    ...(services ? { services } : {}),
    ...(slos ? { slos } : {}),
  };
}

// "1 request" or "1240 requests": a count and its noun, in English.
function countOf(count: number, one: string, other: string): string {
  return `${count} ${count === 1 ? one : other}`;
}

/*
 * The numbers in one English line, as the run's record keeps them
 * (resultSummary.message): "Affected: 1240 requests, 2 services, 1 of 2
 * SLOs." The card words them in the reader's language itself.
 */
export function describeInvestigationImpactNumbers(
  numbers: InvestigationImpactNumbers,
): string {
  const parts: Array<string> = [];

  if (numbers.users) {
    const nouns: Record<InvestigationImpactCounted, [string, string]> = {
      [InvestigationImpactCounted.Users]: ["user", "users"],
      [InvestigationImpactCounted.Sessions]: ["session", "sessions"],
      [InvestigationImpactCounted.Requests]: ["request", "requests"],
    };
    const [one, other]: [string, string] = nouns[numbers.users.counted];

    parts.push(countOf(numbers.users.count, one, other));
  }

  if (numbers.services) {
    parts.push(countOf(numbers.services.count, "service", "services"));
  }

  if (numbers.slos) {
    parts.push(
      `${numbers.slos.affected} of ${countOf(numbers.slos.total, "SLO", "SLOs")}`,
    );
  }

  return `Affected: ${parts.join(", ")}.`;
}

// The numbers as JSON, as the run records them.
export function investigationImpactNumbersToJSON(
  numbers: InvestigationImpactNumbers,
): JSONObject {
  return JSON.parse(JSON.stringify(numbers)) as JSONObject;
}

/*
 * A code fence's marker on a line - three or more backticks or tildes,
 * after at most three spaces - and what follows it, or null when the line
 * is no fence. Read with string steps, so a line costs its length.
 */
function readFence(
  line: string,
): { marker: string; length: number; rest: string } | null {
  let start: number = 0;

  while (start < line.length && start < 3 && line[start] === " ") {
    start++;
  }

  const marker: string | undefined = line[start];

  if (marker !== "`" && marker !== "~") {
    return null;
  }

  let end: number = start;

  while (end < line.length && line[end] === marker) {
    end++;
  }

  if (end - start < 3) {
    return null;
  }

  return { marker, length: end - start, rest: line.slice(end) };
}

// Whether a line opens the impact numbers' block: ```impact-numbers.
function isImpactNumbersFence(
  line: string,
): { marker: string; length: number } | null {
  const fence: { marker: string; length: number; rest: string } | null =
    readFence(line);

  if (!fence) {
    return null;
  }

  const language: string = fence.rest.trim().toLowerCase();

  return language === INVESTIGATION_IMPACT_NUMBERS_LANGUAGE
    ? { marker: fence.marker, length: fence.length }
    : null;
}

// Whether a line closes a block a fence of `marker` x `length` opened.
function isClosingFence(
  line: string,
  opening: { marker: string; length: number },
): boolean {
  const fence: { marker: string; length: number; rest: string } | null =
    readFence(line);

  return Boolean(
    fence &&
      fence.marker === opening.marker &&
      fence.length >= opening.length &&
      fence.rest.trim() === "",
  );
}

// A block's JSON, read only while it is no longer than a block can be.
function readBlock(body: string): InvestigationImpactNumbers | null {
  const text: string = body.trim();

  if (!text || text.length > MAX_INVESTIGATION_IMPACT_BLOCK_LENGTH) {
    return null;
  }

  try {
    return parseInvestigationImpactNumbers(JSON.parse(text));
  } catch {
    return null;
  }
}

export interface TakenInvestigationImpactNumbers {
  // The answer with every impact numbers' block taken off, as it is posted.
  markdown: string;
  // The numbers of the last block that reads; null when none does.
  numbers: InvestigationImpactNumbers | null;
}

/*
 * Takes the impact numbers' block off a model's answer: every block in the
 * block's own language goes - one that does not read too, and one never
 * closed (the answer was cut short), to the end - so the report posted to
 * the timeline, the chats and the card never shows it; the numbers are the
 * last block's that read. The rest of the answer is left as written. A line
 * is read once, so the time this takes grows with the answer.
 */
export function takeInvestigationImpactNumbers(
  markdown: string,
): TakenInvestigationImpactNumbers {
  const lines: Array<string> = markdown.split("\n");
  const kept: Array<string> = [];
  let numbers: InvestigationImpactNumbers | null = null;
  let isTaken: boolean = false;
  let index: number = 0;

  while (index < lines.length) {
    const line: string = lines[index]!;
    const opening: { marker: string; length: number } | null =
      isImpactNumbersFence(line.replace(CARRIAGE_RETURN_AT_END, ""));

    if (!opening) {
      kept.push(line);
      index++;
      continue;
    }

    isTaken = true;

    const body: Array<string> = [];
    let end: number = index + 1;

    while (
      end < lines.length &&
      !isClosingFence(lines[end]!.replace(CARRIAGE_RETURN_AT_END, ""), opening)
    ) {
      body.push(lines[end]!);
      end++;
    }

    const read: InvestigationImpactNumbers | null = readBlock(body.join("\n"));

    if (read) {
      numbers = read;
    }

    // Past its closing fence, or to the end of an answer cut short.
    index = end + 1;
  }

  return {
    markdown: isTaken ? kept.join("\n").trim() : markdown,
    numbers,
  };
}

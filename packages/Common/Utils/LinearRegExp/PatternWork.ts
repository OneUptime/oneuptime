import { PatternWorkAllowanceSpentError } from "./PatternProblem";

/*
 * WHAT A PROJECT'S PATTERNS MAY COST TOGETHER.
 *
 * Each question a pattern is asked takes work in line with the text it reads
 * (Matcher.ts, WorkMeter). But a project can hold thousands of rules, each
 * asked about every new resource, and its scrub rules, filters and grok
 * processors are asked about every record of every batch of telemetry it
 * sends - and in line with the text, thousands of times over, is still
 * seconds of a process that every project shares.
 *
 * So the questions asked for one piece of work share one allowance:
 *
 * - one evaluation of a project's rules of one kind for one resource (the
 *   label rules for a new incident, say), and
 * - one batch of telemetry a project sends.
 *
 * Everything the questions do counts against it, in the units WorkMeter
 * counts - a step of a pattern visited, a character read: a fixed amount for
 * each question, every character each reading reads, every step visited,
 * building automata, and compiling a pattern that is not compiled yet. The
 * allowance holds a pool, for the work any piece of work needs whatever its
 * texts, and grows with the text the patterns are handed:
 *
 * - a rule evaluation by WORK_PER_TEXT_CHARACTER for each character of each
 *   text its rules read, counted once however many rules read it (texts are
 *   granted as they are asked about: grantText);
 * - a batch of telemetry, record by record, as each step - drop filters,
 *   scrub rules, pipelines, metric rules - hands a record to its patterns
 *   (handOver): TELEMETRY_WORK_PER_TEXT for each string in it and
 *   TELEMETRY_WORK_PER_CHARACTER for each character, shared by every pattern
 *   of the step. A scrub rule's replacement is a new text, so texts asked
 *   about add nothing here.
 *
 * Real patterns take a small part of it: a plain pattern reads a character
 * in about one unit. A question that would take more than is left stops with
 * PatternWorkAllowanceSpentError, and so does every question after it - each
 * one a PatternWorkLimitError, which means what a question that reached its
 * own limit means to its caller: a rule does not match, a privacy rule keeps
 * the record private, a scrub rule scrubs the whole value, a grok line stays
 * unparsed.
 *
 * Which allowance a question counts against: the one of the piece of work
 * under way, which the server keeps per asynchronous context
 * (Server/Utils/PatternWorkScope.ts) and hands to the matcher through
 * providePatternWorkAllowance. Outside any - in a browser, in a check of a
 * pattern being saved - a question has only its own limit, as before.
 */

/*
 * What a question costs besides its reading and its steps: setting it up,
 * finding its compiled pattern and automaton, the calls around it.
 */
export const QUESTION_WORK: number = 32;

/*
 * What compiling a pattern costs: a part for reading and checking it, and a
 * part for each step it compiles to (case-insensitive sets cost the most a
 * step; this is that). A pattern refused as too large is counted as one
 * compiled to the most steps it may have.
 */
export const COMPILE_WORK: number = 2048;
export const COMPILE_WORK_PER_STEP: number = 48;

/*
 * What building a pattern's automaton costs before it reads anything (its
 * tables of code unit classes, its arrays), per step of its program; and
 * what keeping a new state costs, per move it keeps room for.
 */
export const AUTOMATON_WORK: number = 512;
export const AUTOMATON_WORK_PER_STEP: number = 2;
export const STATE_WORK: number = 64;
export const STATE_WORK_PER_EIGHT_MOVES: number = 1;

/*
 * What finding a state among those kept costs, per step it holds: its steps
 * are sorted and written out as its key. A pattern built to meet a new
 * state of thousands of steps at every character spends most of its time
 * there.
 */
export const STATE_KEY_WORK_PER_STEP: number = 8;

/*
 * One evaluation of a project's rules of one kind for one resource: about
 * half a second of work. The pool covers compiling and asking some fourteen
 * thousand plain patterns that are not compiled yet - more than the 10,000
 * rules of one kind an evaluation reads (Rules/RuleEngineLimits.ts), with a
 * pattern each, and many times what the largest projects hold - and each
 * character of each text the rules read adds what one pattern alone may take
 * on it (Matcher.ts, WORK_PER_CODE_UNIT), so a long description is still
 * read by every rule that reads it today.
 */
export const RULE_EVALUATION_WORK: number = 64_000_000;
export const WORK_PER_TEXT_CHARACTER: number = 128;

/*
 * The texts of one rule evaluation whose characters add to its allowance: a
 * resource's title, description and the names of what it touches. Past
 * these, texts add nothing - an evaluation does not read thousands of
 * distinct texts, and the set must stay small.
 */
export const MAX_GRANTED_TEXTS: number = 1024;

/*
 * One batch of telemetry. The pool covers compiling a project's patterns and
 * building their automata. Each record a step hands to its patterns adds, for
 * each string in it, what some sixty plain questions cost before they read
 * anything, and for each character what one pattern alone may take on it
 * (Matcher.ts, WORK_PER_CODE_UNIT) - about what sixty plain patterns reading
 * every character take, or a grok processor and a few dozen more.
 */
export const TELEMETRY_BATCH_WORK: number = 32_000_000;
export const TELEMETRY_WORK_PER_TEXT: number = 2048;
export const TELEMETRY_WORK_PER_CHARACTER: number = 128;

/*
 * How deep into a record, and how many of its values, are counted when it is
 * handed over: a log row is its body and a map of attributes, a span a few
 * maps more. A record deeper or larger adds no more than this much of it.
 */
const MAX_RECORD_DEPTH: number = 6;
const MAX_RECORD_VALUES: number = 100_000;

export interface PatternWorkAllowanceOptions {
  // The work the allowance starts with.
  pool: number;
  /*
   * What each character of a text a question reads adds, the first time the
   * text is asked about (grantText) - a rule evaluation's texts. 0: none.
   */
  workPerCharacterOfTextAsked?: number | undefined;
  /*
   * What a record handed over adds (handOver), for each string in it and
   * each character - a batch of telemetry. 0: none.
   */
  workPerRecordText?: number | undefined;
  workPerRecordCharacter?: number | undefined;
}

interface RecordTally {
  texts: number;
  characters: number;
  values: number;
}

export class PatternWorkAllowance {
  private allowed: number;
  private used: number = 0;
  private stopped: number = 0;
  private readonly workPerCharacterOfTextAsked: number;
  private readonly workPerRecordText: number;
  private readonly workPerRecordCharacter: number;
  private readonly grantedTexts: Set<string> = new Set<string>();
  // A record handed over whose share is added when its first question runs.
  private pendingRecord: unknown = undefined;
  /*
   * What every question stops with once nothing is left: made once, as a
   * batch can ask millions of questions after that and an error's stack
   * costs more than the question.
   */
  private spentError: PatternWorkAllowanceSpentError | null = null;

  public constructor(options: PatternWorkAllowanceOptions) {
    this.allowed = options.pool;
    this.workPerCharacterOfTextAsked = options.workPerCharacterOfTextAsked ?? 0;
    this.workPerRecordText = options.workPerRecordText ?? 0;
    this.workPerRecordCharacter = options.workPerRecordCharacter ?? 0;
  }

  // The allowance of one evaluation of a project's rules of one kind.
  public static forRuleEvaluation(): PatternWorkAllowance {
    return new PatternWorkAllowance({
      pool: RULE_EVALUATION_WORK,
      workPerCharacterOfTextAsked: WORK_PER_TEXT_CHARACTER,
    });
  }

  // The allowance of one batch of telemetry, granted record by record.
  public static forTelemetryBatch(): PatternWorkAllowance {
    return new PatternWorkAllowance({
      pool: TELEMETRY_BATCH_WORK,
      workPerRecordText: TELEMETRY_WORK_PER_TEXT,
      workPerRecordCharacter: TELEMETRY_WORK_PER_CHARACTER,
    });
  }

  // How much work the allowance holds now, spent or not.
  public get allowedWork(): number {
    return this.allowed;
  }

  // How much work the questions have taken so far.
  public get usedWork(): number {
    return this.used;
  }

  // Whether nothing is left: every question from now on stops.
  public get isSpent(): boolean {
    return this.used > this.allowed;
  }

  /*
   * How many questions stopped before they had an answer - by this
   * allowance, or by their own limit. A caller that must not take "no
   * answer" for "no match" (a privacy rule, a negated condition) compares it
   * before and after.
   */
  public get stoppedQuestions(): number {
    return this.stopped;
  }

  /*
   * A record a step is about to hand its patterns (a log row, a span, a
   * metric point, a text of a session replay): its share is added when the
   * step's first question runs, so a step whose patterns are not asked -
   * one with no custom pattern - walks nothing.
   */
  public handOver(record: unknown): void {
    this.pendingRecord = record;
  }

  /*
   * A text a question reads: the first time, each of its characters adds
   * its share (rule evaluations), however many questions read it after.
   */
  public grantText(text: string): void {
    if (
      this.workPerCharacterOfTextAsked <= 0 ||
      text.length === 0 ||
      this.grantedTexts.size >= MAX_GRANTED_TEXTS ||
      this.grantedTexts.has(text)
    ) {
      return;
    }

    this.grantedTexts.add(text);
    this.allowed += this.workPerCharacterOfTextAsked * text.length;
  }

  /*
   * Before a question about this text: what was handed over and the text
   * add their share, then the question pays what any question costs before
   * it reads - and stops if nothing is left.
   */
  public beforeQuestion(text: string): void {
    this.grantPendingRecord();
    this.grantText(text);
    this.spend(QUESTION_WORK);
  }

  /*
   * Before a compile, which cannot be stopped midway: refused when nothing is
   * left.
   */
  public beforeCompile(): void {
    if (this.refuses()) {
      throw this.stopError();
    }
  }

  /*
   * Whether a question asked now about this text would stop at once - what
   * was handed over and the text add their share first - counting it as
   * stopped when it would. A caller that asks many questions asks this
   * first, and answers "no answer" without looking its pattern up.
   */
  public refuses(text?: string): boolean {
    this.grantPendingRecord();

    if (text !== undefined) {
      this.grantText(text);
    }

    if (!this.isSpent) {
      return false;
    }

    this.stopped++;
    return true;
  }

  /*
   * Work a question is about to do or has done; stops the question with
   * PatternWorkAllowanceSpentError when the allowance cannot hold it.
   */
  public spend(work: number): void {
    this.used += work;

    if (this.used > this.allowed) {
      this.stopped++;
      throw this.stopError();
    }
  }

  /*
   * Work done that could not be stopped midway - a compile - counted after
   * it: the next question pays for it.
   */
  public charge(work: number): void {
    this.used += work;
  }

  // A question that stopped at its own limit.
  public noteStopped(): void {
    this.stopped++;
  }

  private stopError(): PatternWorkAllowanceSpentError {
    if (this.spentError === null) {
      this.spentError = new PatternWorkAllowanceSpentError();
    }

    return this.spentError;
  }

  private grantPendingRecord(): void {
    if (this.pendingRecord === undefined) {
      return;
    }

    const record: unknown = this.pendingRecord;
    this.pendingRecord = undefined;

    const tally: RecordTally = { texts: 0, characters: 0, values: 0 };
    tallyRecord(record, 0, tally);

    this.allowed +=
      this.workPerRecordText * tally.texts +
      this.workPerRecordCharacter * tally.characters;
  }
}

// Every string in a record, and their characters, to a bounded depth.
function tallyRecord(value: unknown, depth: number, tally: RecordTally): void {
  if (tally.values >= MAX_RECORD_VALUES) {
    return;
  }

  tally.values++;

  if (typeof value === "string") {
    tally.texts++;
    tally.characters += value.length;
    return;
  }

  if (value === null || typeof value !== "object" || depth >= MAX_RECORD_DEPTH) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      tallyRecord(item, depth + 1, tally);
    }

    return;
  }

  for (const key of Object.keys(value)) {
    tallyRecord((value as Record<string, unknown>)[key], depth + 1, tally);
  }
}

/*
 * Where the matcher finds the allowance of the piece of work under way. The
 * server installs one that reads its asynchronous context
 * (Server/Utils/PatternWorkScope.ts); without one, no question counts
 * against any allowance.
 */
type PatternWorkAllowanceProvider = () => PatternWorkAllowance | undefined;

const NO_ALLOWANCE: PatternWorkAllowanceProvider =
  (): PatternWorkAllowance | undefined => {
    return undefined;
  };

let allowanceProvider: PatternWorkAllowanceProvider = NO_ALLOWANCE;

/*
 * Questions asked outside any allowance that stopped at their own limit, in
 * this process: what getStoppedPatternQuestions reads when no piece of work
 * is under way.
 */
let stoppedOutsideAllowances: number = 0;

export function providePatternWorkAllowance(
  provider: PatternWorkAllowanceProvider,
): void {
  allowanceProvider = provider;
}

// The allowance the current question counts against, if any.
export function getPatternWorkAllowance(): PatternWorkAllowance | undefined {
  return allowanceProvider();
}

/*
 * Whether a question asked now about this text would stop at once, the
 * allowance of the piece of work under way being spent
 * (PatternWorkAllowance.refuses): a caller answers "no answer" then without
 * looking its pattern up. False outside any piece of work.
 */
export function patternWorkRefusesQuestions(text: string): boolean {
  const allowance: PatternWorkAllowance | undefined = allowanceProvider();

  return allowance !== undefined && allowance.refuses(text);
}

// A question asked outside any allowance stopped at its own limit.
export function noteQuestionStoppedOutsideAllowance(): void {
  stoppedOutsideAllowances++;
}

/*
 * How many questions have stopped without an answer so far: those of the
 * piece of work under way, or, outside one, those asked outside any in this
 * process. Read before and after a question, it says whether that question
 * was answered - a negated condition must not take "no answer" for "does
 * not match".
 */
export function getStoppedPatternQuestions(): number {
  const allowance: PatternWorkAllowance | undefined = allowanceProvider();

  return allowance === undefined
    ? stoppedOutsideAllowances
    : allowance.stoppedQuestions;
}

import CharacterSet from "./CharacterSet";
import { closeOverCase, getCaseVariants } from "./CaseCanonicalization";
import {
  AssertionKind,
  LookaroundNode,
  ParsedPattern,
  RepeatNode,
  SetNode,
  SyntaxNode,
} from "./Syntax";
import { PatternProblemError, PatternProblemReason } from "./PatternProblem";

/*
 * A PARSED PATTERN AS STEPS FOR THE MATCHER.
 *
 * The steps are those of a Thompson automaton with Pike's additions for
 * capturing groups: a step either reads one code unit, or moves on without
 * reading - to one place or, in an order of preference, to two. The matcher
 * (Matcher.ts) follows every way through the steps at once, a code unit at a
 * time, so it reads each code unit once whatever the pattern.
 *
 * What JavaScript adds to a plain automaton, and how it is kept:
 *
 * - Which match wins. A backtracking engine takes the first way through the
 *   pattern that works, trying the left side of "|" first and taking as much
 *   as a greedy repeat will; the two ways out of a split are ordered the same
 *   way here, and the matcher keeps every way in that order.
 * - A repeat that matched nothing. JavaScript fails a repetition past the
 *   minimum that matched no text. A body that can match nothing remembers
 *   where each such repetition started (PROGRESS_START) and fails when it
 *   ends there (PROGRESS_CHECK); the matcher tells apart two ways at one
 *   step that differ in it (scopeOf).
 * - Groups forget what they captured at the start of every repetition (RESET).
 * - Look-arounds. Each is compiled on its own; the matcher works out, for the
 *   text at hand, at which positions it holds - one pass over the text, a
 *   look-ahead's body compiled backwards - and the pattern's LOOKAROUND step
 *   reads that answer.
 */

// The steps that read a code unit, numbered first so a test is one compare.
export const OP_CHARACTER: number = 0;
export const OP_SET: number = 1;
export const OP_ANY: number = 2;
export const OP_MATCH: number = 3;
export const OP_JUMP: number = 4;
export const OP_SPLIT: number = 5;
export const OP_SAVE: number = 6;
export const OP_RESET: number = 7;
export const OP_PROGRESS_START: number = 8;
export const OP_PROGRESS_CHECK: number = 9;
export const OP_ASSERT: number = 10;
export const OP_LOOKAROUND: number = 11;

export const ASSERT_TEXT_START: number = 0;
export const ASSERT_TEXT_END: number = 1;
export const ASSERT_LINE_START: number = 2;
export const ASSERT_LINE_END: number = 3;
export const ASSERT_WORD_BOUNDARY: number = 4;
export const ASSERT_NOT_WORD_BOUNDARY: number = 5;

/*
 * How many steps a pattern may compile to, its look-arounds included: what a
 * compiled pattern may cost to build and to keep. A pattern written in a
 * rule's few hundred characters compiles to a few hundred steps; a large
 * count ({0,5000}) repeats its body that many times. The time a text takes
 * is bounded whatever the steps (Matcher.ts, WorkMeter).
 */
export const DEFAULT_MAX_STEPS: number = 10_000;

/*
 * How many look-arounds a pattern may hold - counting those that compile to
 * the same steps once. Each is worked out for the whole text before a match
 * is looked for: one reading of the text and one answer per code unit, per
 * look-around. The grok library holds two.
 */
export const MAX_LOOKAROUNDS: number = 32;

/*
 * How deep repeats whose body can match nothing may sit inside one another,
 * such as ((a*)*)* - three. Telling apart two ways at one step reads that
 * deep (scopeOf below), and the ordered machine keeps a mark per step per
 * depth. A pattern deeper is refused as too large.
 */
export const MAX_EMPTY_REPEAT_NESTING: number = 8;

export interface Program {
  ops: Int32Array;
  argA: Int32Array;
  argB: Int32Array;
  sets: Array<CharacterSet>;
  /*
   * 2 slots per group (group 0 is the whole match) when the program saves
   * what groups capture, else 2 for the whole match; then one per
   * PROGRESS_START register.
   */
  slotCount: number;
  /*
   * The code units a match can start with, or null when a match can be
   * empty (it then starts anywhere). Lets the matcher skip what cannot start
   * one.
   */
  firstCodeUnits: CharacterSet | null;
  /*
   * For each step, the PROGRESS_START registers of the repetitions it sits
   * in, outermost first (scopes[scopeOf[pc]]). Two ways at the same step and
   * position are the same way only when the same of those repetitions have
   * read nothing yet - the matcher counts them (Matcher.ts).
   */
  scopeOf: Int32Array;
  scopes: Array<Int32Array>;
  // One more than the deepest such nesting: how many counts there can be.
  scopeWidth: number;
  /*
   * The look-arounds whose answers the program's LOOKAROUND steps read,
   * each once, in the order the steps first name them.
   */
  lookaroundsRead: Int32Array;
}

export interface LookaroundProgram {
  behind: boolean;
  /*
   * A look-behind's body as written; a look-ahead's body backwards, so that
   * both are found in one pass over the text.
   */
  program: Program;
}

export interface CompiledPattern {
  main: Program;
  /*
   * The pattern compiled backwards, without captures: read from the end of a
   * text, it says at which positions a match can start.
   */
  reversed: Program;
  /*
   * Every look-around, the ones inside another look-around first - each
   * one's answers are worked out before those of the one it sits in.
   */
  lookarounds: Array<LookaroundProgram>;
  captureCount: number;
  captureNames: Array<string | null>;
  // Steps in every program above together: what the pattern costs to keep.
  totalSteps: number;
}

interface EmitMode {
  // Whether the steps save what groups capture.
  captures: boolean;
  // A look-ahead's body, compiled to be read backwards.
  reverse: boolean;
  /*
   * Whether the optional copies of a counted repeat check that they read
   * something. Only the pattern itself needs it: a look-around's body is only
   * asked whether it matches at all.
   */
  checksProgress: boolean;
}

export interface CompileOptions {
  /*
   * Whether the caller reads what groups captured. Without it the groups
   * cost nothing, and a group inside a look-around is no problem.
   */
  captures: boolean;
  maxSteps: number;
}

function isNullable(node: SyntaxNode): boolean {
  switch (node.kind) {
    case "Empty":
    case "Assertion":
    case "Lookaround":
      return true;
    case "Character":
    case "Set":
      return false;
    case "Group":
      return isNullable(node.body);
    case "Repeat":
      return node.min === 0 || isNullable(node.body);
    case "Alternation":
      return node.options.some(isNullable);
    case "Sequence":
      return node.items.every(isNullable);
    default:
      return true;
  }
}

function hasCapture(node: SyntaxNode): boolean {
  switch (node.kind) {
    case "Group":
      return true;
    case "Lookaround":
      return hasCapture(node.body);
    case "Repeat":
      return hasCapture(node.body);
    case "Alternation":
      return node.options.some(hasCapture);
    case "Sequence":
      return node.items.some(hasCapture);
    default:
      return false;
  }
}

class StepBudget {
  private used: number = 0;
  private readonly limit: number;

  public constructor(limit: number) {
    this.limit = limit;
  }

  public spend(): void {
    this.used++;

    if (this.used > this.limit) {
      throw new PatternProblemError(
        PatternProblemReason.TooLarge,
        `The pattern is too large: it would take more than ${this.limit} steps to run.`,
      );
    }
  }
}

class ProgramBuilder {
  public readonly ops: Array<number> = [];
  public readonly argA: Array<number> = [];
  public readonly argB: Array<number> = [];
  public readonly scopeOf: Array<number> = [];
  public readonly scopes: Array<Array<number>> = [[]];
  public slotCount: number;

  private readonly scopeStack: Array<number> = [];
  private readonly scopeIdByKey: Map<string, number> = new Map<string, number>([
    ["", 0],
  ]);
  private currentScope: number = 0;

  private readonly budget: StepBudget;
  private readonly sets: Array<CharacterSet>;
  private readonly setIndexByKey: Map<string, number>;

  public constructor(data: {
    budget: StepBudget;
    sets: Array<CharacterSet>;
    setIndexByKey: Map<string, number>;
    slotCount: number;
  }) {
    this.budget = data.budget;
    this.sets = data.sets;
    this.setIndexByKey = data.setIndexByKey;
    this.slotCount = data.slotCount;
  }

  public get next(): number {
    return this.ops.length;
  }

  public emit(op: number, argA: number = 0, argB: number = 0): number {
    this.budget.spend();
    this.ops.push(op);
    this.argA.push(argA);
    this.argB.push(argB);
    this.scopeOf.push(this.currentScope);
    return this.ops.length - 1;
  }

  // The steps emitted from now on sit in the repetition of this register.
  public enterScope(register: number): void {
    if (this.scopeStack.length >= MAX_EMPTY_REPEAT_NESTING) {
      throw new PatternProblemError(
        PatternProblemReason.TooLarge,
        `The pattern nests repeats that can match nothing more than ${MAX_EMPTY_REPEAT_NESTING} deep.`,
      );
    }

    this.scopeStack.push(register);
    this.updateScope();
  }

  public leaveScope(): void {
    this.scopeStack.pop();
    this.updateScope();
  }

  private updateScope(): void {
    const key: string = this.scopeStack.join(",");
    let id: number | undefined = this.scopeIdByKey.get(key);

    if (id === undefined) {
      this.scopes.push([...this.scopeStack]);
      id = this.scopes.length - 1;
      this.scopeIdByKey.set(key, id);
    }

    this.currentScope = id;
  }

  public setIndex(set: CharacterSet): number {
    const key: string = set.key();
    const existing: number | undefined = this.setIndexByKey.get(key);

    if (existing !== undefined) {
      return existing;
    }

    this.sets.push(set);
    this.setIndexByKey.set(key, this.sets.length - 1);
    return this.sets.length - 1;
  }

  public allocateRegister(): number {
    return this.slotCount++;
  }
}

class Compiler {
  private readonly options: CompileOptions;
  private budget: StepBudget;
  // Each look-around is compiled once; the backwards copy reads the same one.
  private readonly lookaroundIndexByNode: Map<LookaroundNode, number> = new Map<
    LookaroundNode,
    number
  >();
  /*
   * Look-arounds that compile to the same steps share one answer per text:
   * a grok pattern repeats (?<![0-9]) and (?![0-9]) for every IP address in
   * it.
   */
  private readonly lookaroundIndexBySteps: Map<string, number> = new Map<
    string,
    number
  >();
  private readonly sets: Array<CharacterSet> = [];
  private readonly setIndexByKey: Map<string, number> = new Map<
    string,
    number
  >();
  public readonly lookarounds: Array<LookaroundProgram> = [];

  public constructor(options: CompileOptions) {
    this.options = options;
    this.budget = new StepBudget(options.maxSteps);
  }

  public compileReversed(pattern: ParsedPattern): Program {
    // A copy of the pattern, with a budget of its own.
    this.budget = new StepBudget(this.options.maxSteps);
    const builder: ProgramBuilder = this.newBuilder(0);

    this.emit(builder, pattern.root, {
      captures: false,
      reverse: true,
      checksProgress: false,
    });
    builder.emit(OP_MATCH);

    return this.finish(builder);
  }

  public compileMain(pattern: ParsedPattern): Program {
    /*
     * Without captures no group's slots are ever written: the ways carry the
     * whole match's two, and the registers.
     */
    const builder: ProgramBuilder = this.newBuilder(
      this.options.captures ? 2 * (pattern.captureCount + 1) : 2,
    );

    builder.emit(OP_SAVE, 0);
    this.emit(builder, pattern.root, {
      captures: this.options.captures,
      reverse: false,
      checksProgress: true,
    });
    builder.emit(OP_SAVE, 1);
    builder.emit(OP_MATCH);

    return this.finish(builder);
  }

  private newBuilder(slotCount: number): ProgramBuilder {
    return new ProgramBuilder({
      budget: this.budget,
      sets: this.sets,
      setIndexByKey: this.setIndexByKey,
      slotCount: slotCount,
    });
  }

  private finish(builder: ProgramBuilder): Program {
    const scopes: Array<Int32Array> = builder.scopes.map(
      (registers: Array<number>): Int32Array => {
        return Int32Array.from(registers);
      },
    );
    const lookaroundsRead: Array<number> = [];

    for (let pc: number = 0; pc < builder.ops.length; pc++) {
      if (
        builder.ops[pc] === OP_LOOKAROUND &&
        !lookaroundsRead.includes(builder.argA[pc]!)
      ) {
        lookaroundsRead.push(builder.argA[pc]!);
      }
    }

    const program: Program = {
      ops: Int32Array.from(builder.ops),
      argA: Int32Array.from(builder.argA),
      argB: Int32Array.from(builder.argB),
      sets: this.sets,
      slotCount: builder.slotCount,
      firstCodeUnits: null,
      scopeOf: Int32Array.from(builder.scopeOf),
      scopes: scopes,
      scopeWidth:
        1 +
        scopes.reduce((deepest: number, registers: Int32Array): number => {
          return Math.max(deepest, registers.length);
        }, 0),
      lookaroundsRead: Int32Array.from(lookaroundsRead),
    };

    program.firstCodeUnits = computeFirstCodeUnits(program);

    return program;
  }

  private emit(
    builder: ProgramBuilder,
    node: SyntaxNode,
    mode: EmitMode,
  ): void {
    switch (node.kind) {
      case "Empty":
        return;
      case "Character": {
        if (node.ignoreCase) {
          const variants: Array<number> = getCaseVariants(node.codeUnit);

          if (variants.length > 1) {
            builder.emit(
              OP_SET,
              builder.setIndex(CharacterSet.fromCodeUnits(variants)),
              0,
            );
            return;
          }
        }

        builder.emit(OP_CHARACTER, node.codeUnit);
        return;
      }
      case "Set":
        this.emitSet(builder, node);
        return;
      case "Assertion":
        builder.emit(OP_ASSERT, assertionStep(node.assertion, node.multiline));
        return;
      case "Lookaround": {
        const index: number = this.compileLookaround(node);
        builder.emit(OP_LOOKAROUND, index, node.negate ? 0 : 1);
        return;
      }
      case "Group":
        if (!mode.captures) {
          this.emit(builder, node.body, mode);
          return;
        }

        builder.emit(OP_SAVE, node.captureIndex * 2);
        this.emit(builder, node.body, mode);
        builder.emit(OP_SAVE, node.captureIndex * 2 + 1);
        return;
      case "Sequence": {
        const items: Array<SyntaxNode> = mode.reverse
          ? [...node.items].reverse()
          : node.items;

        for (const item of items) {
          this.emit(builder, item, mode);
        }

        return;
      }
      case "Alternation": {
        const jumpsToEnd: Array<number> = [];

        for (let index: number = 0; index < node.options.length; index++) {
          const option: SyntaxNode = node.options[index]!;

          if (index === node.options.length - 1) {
            this.emit(builder, option, mode);
            break;
          }

          const split: number = builder.emit(OP_SPLIT);
          builder.argA[split] = builder.next;
          this.emit(builder, option, mode);
          jumpsToEnd.push(builder.emit(OP_JUMP));
          builder.argB[split] = builder.next;
        }

        for (const jump of jumpsToEnd) {
          builder.argA[jump] = builder.next;
        }

        return;
      }
      case "Repeat":
        this.emitRepeat(builder, node, mode);
        return;
      default:
        return;
    }
  }

  private emitSet(builder: ProgramBuilder, node: SetNode): void {
    const members: CharacterSet = node.ignoreCase
      ? closeOverCase(node.set)
      : node.set;

    if (node.negate ? members.isEmpty() : members.size() === 0x10000) {
      builder.emit(OP_ANY);
      return;
    }

    const single: number | null = members.singleCodeUnit();

    if (!node.negate && single !== null) {
      builder.emit(OP_CHARACTER, single);
      return;
    }

    builder.emit(OP_SET, builder.setIndex(members), node.negate ? 1 : 0);
  }

  private emitRepeat(
    builder: ProgramBuilder,
    node: RepeatNode,
    mode: EmitMode,
  ): void {
    const resetsCaptures: boolean = mode.captures && node.captureCount > 0;
    const firstSlot: number = node.firstCapture * 2;
    const endSlot: number = (node.firstCapture + node.captureCount) * 2;

    /*
     * A repetition past the minimum that matched nothing fails, in
     * JavaScript: a body that can match nothing remembers where each such
     * repetition started (PROGRESS_START) and fails when it ends there
     * (PROGRESS_CHECK). Which match wins depends on it, so the pattern
     * itself keeps the check; a look-around's body, asked only whether it
     * matches, does not need it.
     */
    const register: number =
      mode.checksProgress && isNullable(node.body)
        ? builder.allocateRegister()
        : -1;

    const emitBody: (checked: boolean) => void = (checked: boolean): void => {
      if (resetsCaptures) {
        builder.emit(OP_RESET, firstSlot, endSlot);
      }

      if (!checked || register < 0) {
        this.emit(builder, node.body, mode);
        return;
      }

      builder.emit(OP_PROGRESS_START, register);
      builder.enterScope(register);
      this.emit(builder, node.body, mode);
      builder.emit(OP_PROGRESS_CHECK, register);
      builder.leaveScope();
    };

    for (let copy: number = 0; copy < node.min; copy++) {
      const before: number = builder.next;
      emitBody(false);

      if (builder.next === before) {
        // A body with no steps, such as (?:): its copies are no-ops.
        break;
      }
    }

    if (node.max === Infinity) {
      const split: number = builder.emit(OP_SPLIT);
      const bodyStart: number = builder.next;
      emitBody(true);
      builder.emit(OP_JUMP, split);
      const exit: number = builder.next;

      builder.argA[split] = node.greedy ? bodyStart : exit;
      builder.argB[split] = node.greedy ? exit : bodyStart;
      return;
    }

    const optionalCopies: number = node.max - node.min;

    if (optionalCopies <= 0) {
      return;
    }

    // Copies that may each be taken or not; once one is skipped, all are.
    const splits: Array<number> = [];

    for (let copy: number = 0; copy < optionalCopies; copy++) {
      const split: number = builder.emit(OP_SPLIT);
      splits.push(split);
      const bodyStart: number = builder.next;

      emitBody(true);

      if (node.greedy) {
        builder.argA[split] = bodyStart;
      } else {
        builder.argB[split] = bodyStart;
      }
    }

    const exit: number = builder.next;

    for (const split of splits) {
      if (node.greedy) {
        builder.argB[split] = exit;
      } else {
        builder.argA[split] = exit;
      }
    }
  }

  private compileLookaround(node: LookaroundNode): number {
    const compiled: number | undefined = this.lookaroundIndexByNode.get(node);

    if (compiled !== undefined) {
      return compiled;
    }

    if (this.options.captures && !node.negate && hasCapture(node.body)) {
      throw new PatternProblemError(
        PatternProblemReason.CaptureInsideLookaround,
        "The pattern captures a group inside a look-ahead or look-behind.",
      );
    }

    const builder: ProgramBuilder = this.newBuilder(0);

    // A look-ahead is found by reading the text backwards (Matcher.ts).
    this.emit(builder, node.body, {
      captures: false,
      reverse: !node.behind,
      checksProgress: false,
    });
    builder.emit(OP_MATCH);

    const program: Program = this.finish(builder);

    const stepsKey: string = [
      node.behind ? "behind" : "ahead",
      Array.from(program.ops).join(","),
      Array.from(program.argA).join(","),
      Array.from(program.argB).join(","),
    ].join("|");
    let index: number | undefined = this.lookaroundIndexBySteps.get(stepsKey);

    if (index === undefined) {
      if (this.lookarounds.length >= MAX_LOOKAROUNDS) {
        throw new PatternProblemError(
          PatternProblemReason.TooLarge,
          `The pattern holds more than ${MAX_LOOKAROUNDS} look-aheads and look-behinds.`,
        );
      }

      this.lookarounds.push({ behind: node.behind, program: program });
      index = this.lookarounds.length - 1;
      this.lookaroundIndexBySteps.set(stepsKey, index);
    }

    this.lookaroundIndexByNode.set(node, index);

    return index;
  }
}

function assertionStep(kind: AssertionKind, multiline: boolean): number {
  switch (kind) {
    case AssertionKind.Start:
      return multiline ? ASSERT_LINE_START : ASSERT_TEXT_START;
    case AssertionKind.End:
      return multiline ? ASSERT_LINE_END : ASSERT_TEXT_END;
    case AssertionKind.WordBoundary:
      return ASSERT_WORD_BOUNDARY;
    default:
      return ASSERT_NOT_WORD_BOUNDARY;
  }
}

/*
 * The code units the program can read first, following every step that
 * reads nothing (an assertion is assumed to hold). Null when the program can
 * reach its end without reading anything.
 */
function computeFirstCodeUnits(program: Program): CharacterSet | null {
  const visited: Uint8Array = new Uint8Array(program.ops.length);
  const stack: Array<number> = [0];
  const pairs: Array<number> = [];
  /*
   * The classes met, each once - set index times two, plus one when read
   * negated: many alternatives of a large pattern start with the same class.
   */
  const classesMet: Set<number> = new Set<number>();

  while (stack.length > 0) {
    const pc: number = stack.pop()!;

    if (visited[pc] === 1) {
      continue;
    }

    visited[pc] = 1;

    const op: number = program.ops[pc]!;

    if (op === OP_MATCH) {
      return null;
    }

    if (op === OP_CHARACTER) {
      pairs.push(program.argA[pc]!, program.argA[pc]!);
      continue;
    }

    if (op === OP_SET) {
      const classKey: number =
        program.argA[pc]! * 2 + (program.argB[pc] === 1 ? 1 : 0);

      if (!classesMet.has(classKey)) {
        classesMet.add(classKey);

        const set: CharacterSet = program.sets[program.argA[pc]!]!;

        for (const bound of (program.argB[pc] === 1 ? set.complement() : set)
          .ranges) {
          pairs.push(bound);
        }
      }

      continue;
    }

    if (op === OP_ANY) {
      return null;
    }

    if (op === OP_JUMP) {
      stack.push(program.argA[pc]!);
      continue;
    }

    if (op === OP_SPLIT) {
      stack.push(program.argB[pc]!, program.argA[pc]!);
      continue;
    }

    stack.push(pc + 1);
  }

  return CharacterSet.fromPairs(pairs);
}

export function compilePattern(
  pattern: ParsedPattern,
  options: CompileOptions,
): CompiledPattern {
  const compiler: Compiler = new Compiler(options);
  const main: Program = compiler.compileMain(pattern);
  const reversed: Program = compiler.compileReversed(pattern);

  return {
    main: main,
    reversed: reversed,
    lookarounds: compiler.lookarounds,
    captureCount: pattern.captureCount,
    captureNames: pattern.captureNames,
    totalSteps: compiler.lookarounds.reduce(
      (steps: number, lookaround: LookaroundProgram): number => {
        return steps + lookaround.program.ops.length;
      },
      main.ops.length + reversed.ops.length,
    ),
  };
}

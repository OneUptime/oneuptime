import CharacterSet from "./CharacterSet";
import {
  ASSERT_LINE_END,
  ASSERT_LINE_START,
  ASSERT_NOT_WORD_BOUNDARY,
  ASSERT_TEXT_END,
  ASSERT_TEXT_START,
  ASSERT_WORD_BOUNDARY,
  CompiledPattern,
  OP_ANY,
  OP_ASSERT,
  OP_CHARACTER,
  OP_JUMP,
  OP_LOOKAROUND,
  OP_MATCH,
  OP_PROGRESS_CHECK,
  OP_PROGRESS_START,
  OP_RESET,
  OP_SAVE,
  OP_SET,
  OP_SPLIT,
  Program,
} from "./Program";
import { PatternWorkLimitError } from "./PatternProblem";

/*
 * RUNS A COMPILED PATTERN OVER A TEXT, READING EACH CODE UNIT A BOUNDED
 * NUMBER OF TIMES.
 *
 * Every way through the pattern that is still alive moves along the text
 * together, one code unit at a time, and two ways that reach the same step at
 * the same position are one (Thompson's construction, Pike's machine). So the
 * work for each code unit is at most one visit to each step of the pattern,
 * whatever the pattern and whatever the text: time in line with the text.
 *
 * Two machines over the same steps:
 *
 * - The lazy automaton (LazyDfa): asks only where some way reaches the end
 *   of the pattern. The set of steps alive at a position, with what the code
 *   unit before it was, is a state of a deterministic automaton; states and
 *   their moves are kept as they are met, so a text is mostly read at one
 *   table lookup per code unit. It reads forwards (is there a match? where
 *   does a look-behind hold?) or backwards (where does a look-ahead hold?
 *   where can a match start?).
 * - The ordered machine (execAnchored): the match JavaScript's exec returns
 *   from a given start - the one a backtracking engine would take - with
 *   what its groups captured. Ways are kept in the order a backtracking engine
 *   would try them, and the first to reach the end wins.
 *
 * exec finds the leftmost position where a match starts with one backwards
 * pass of the pattern compiled backwards, then runs the ordered machine from
 * there alone.
 */

function isWordCodeUnit(codeUnit: number): boolean {
  return (
    (codeUnit >= 0x61 && codeUnit <= 0x7a) ||
    (codeUnit >= 0x41 && codeUnit <= 0x5a) ||
    (codeUnit >= 0x30 && codeUnit <= 0x39) ||
    codeUnit === 0x5f
  );
}

function isLineTerminator(codeUnit: number): boolean {
  return (
    codeUnit === 0x0a ||
    codeUnit === 0x0d ||
    codeUnit === 0x2028 ||
    codeUnit === 0x2029
  );
}

function isWordAt(text: string, position: number): boolean {
  return (
    position >= 0 &&
    position < text.length &&
    isWordCodeUnit(text.charCodeAt(position))
  );
}

function assertionHolds(kind: number, text: string, position: number): boolean {
  switch (kind) {
    case ASSERT_TEXT_START:
      return position === 0;
    case ASSERT_TEXT_END:
      return position === text.length;
    case ASSERT_LINE_START:
      return position === 0 || isLineTerminator(text.charCodeAt(position - 1));
    case ASSERT_LINE_END:
      return (
        position === text.length || isLineTerminator(text.charCodeAt(position))
      );
    case ASSERT_WORD_BOUNDARY:
      return isWordAt(text, position - 1) !== isWordAt(text, position);
    case ASSERT_NOT_WORD_BOUNDARY:
      return isWordAt(text, position - 1) === isWordAt(text, position);
    default:
      return false;
  }
}

/*
 * A yes or no for every position of a text, one bit each: where a
 * look-around holds, where a match can start. A text of tens of megabytes
 * and a pattern of many look-arounds would otherwise ask for a byte per
 * position per look-around.
 */
export function newPositionBits(textLength: number): Uint8Array {
  // Positions 0 .. textLength, the end of the text included.
  return new Uint8Array((textLength >>> 3) + 1);
}

export function setPositionBit(bits: Uint8Array, position: number): void {
  bits[position >>> 3] = bits[position >>> 3]! | (1 << (position & 7));
}

export function positionBit(bits: Uint8Array, position: number): number {
  return (bits[position >>> 3]! >>> (position & 7)) & 1;
}

// Whether the step at pc, one that reads a code unit, reads this one.
function readsCodeUnit(
  program: Program,
  pc: number,
  codeUnit: number,
): boolean {
  const op: number = program.ops[pc]!;

  if (op === OP_CHARACTER) {
    return program.argA[pc] === codeUnit;
  }

  if (op === OP_SET) {
    return (
      program.sets[program.argA[pc]!]!.has(codeUnit) !==
      (program.argB[pc] === 1)
    );
  }

  return op === OP_ANY;
}

/*
 * ---------------------------------------------------------------------------
 * How much work one question about one text may take.
 * ---------------------------------------------------------------------------
 *
 * Every machine here takes time in line with the text - at most one visit to
 * each step of the pattern per code unit - but for a pattern of thousands of
 * steps whose automaton keeps meeting new states, "in line" can still be
 * a minute for a megabyte. So the visits are counted, and a question about a
 * text may take at most WORK_PER_CODE_UNIT of them per code unit, plus
 * WORK_PER_STEP per step of the pattern for the first states a large pattern
 * meets: the time is then in line with the text and the pattern, with a
 * small multiple, whatever the pattern. A real pattern needs a few visits
 * per code unit once its states are met; one built to need more is stopped
 * with PatternWorkLimitError, and the caller decides what that means (a rule
 * does not match, a scrub rule scrubs the whole value).
 */

export const WORK_PER_CODE_UNIT: number = 128;
export const WORK_PER_STEP: number = 64;

export class WorkMeter {
  private used: number = 0;
  private readonly limit: number;

  public constructor(limit: number) {
    this.limit = limit;
  }

  /*
   * The meter for one question about a text of this length, asked of a
   * pattern of this many steps (CompiledPattern.totalSteps).
   */
  public static forText(length: number, patternSteps: number): WorkMeter {
    return new WorkMeter(
      WORK_PER_CODE_UNIT * (length + 1) + WORK_PER_STEP * patternSteps,
    );
  }

  public spend(visits: number): void {
    this.used += visits;

    if (this.used > this.limit) {
      throw new PatternWorkLimitError();
    }
  }
}

/*
 * ---------------------------------------------------------------------------
 * The lazy automaton: where does some way reach the end of the program.
 * ---------------------------------------------------------------------------
 */

/*
 * What a state knows of the code unit behind its position - the one just
 * read: an assertion needs it, together with the code unit ahead (or that
 * there is none).
 */
const BEHIND_NOTHING: number = 1;
const BEHIND_WORD: number = 2;
const BEHIND_LINE_TERMINATOR: number = 4;

const MOVE_UNKNOWN: number = -1;

/*
 * How many moves one program's automaton keeps (states times code unit
 * classes times look-around answers) - about 128 KB - and how many
 * look-arounds a program may read to be run this way.
 */
const MAX_DFA_MOVES: number = 32_768;
const MAX_DFA_LOOKAROUNDS: number = 4;

interface DfaState {
  // The steps the ways are at, before following the steps that read nothing.
  pcs: Int32Array;
  behind: number;
  /*
   * Per (code unit class, look-around answers): the next state's index
   * times two, plus one when a way reaches the end of the program at this
   * position - or MOVE_UNKNOWN until worked out. Null for a state that is
   * not kept.
   */
  moves: Int32Array | null;
  /*
   * Per look-around answers, with no code unit ahead (the end of the
   * reading): 1 when a way reaches the end of the program, 0 when none does,
   * -1 until worked out.
   */
  ends: Int8Array | null;
}

/*
 * The code units no step tells apart, numbered: the automaton moves on the
 * class, not the code unit.
 */
class CodeUnitClasses {
  public readonly count: number;
  private readonly asciiClass: Int32Array;
  private readonly boundaries: Int32Array;

  public constructor(program: Program) {
    const points: Set<number> = new Set<number>([0]);
    const addRange: (first: number, last: number) => void = (
      first: number,
      last: number,
    ): void => {
      points.add(first);

      if (last + 1 <= 0xffff) {
        points.add(last + 1);
      }
    };

    // Word characters and line terminators decide the assertions.
    addRange(0x30, 0x39);
    addRange(0x41, 0x5a);
    addRange(0x5f, 0x5f);
    addRange(0x61, 0x7a);
    addRange(0x0a, 0x0a);
    addRange(0x0d, 0x0d);
    addRange(0x2028, 0x2029);

    // Each class once: many steps of a large pattern read the same one.
    const setsRead: Set<number> = new Set<number>();

    for (let pc: number = 0; pc < program.ops.length; pc++) {
      if (program.ops[pc] === OP_CHARACTER) {
        addRange(program.argA[pc]!, program.argA[pc]!);
      } else if (program.ops[pc] === OP_SET) {
        setsRead.add(program.argA[pc]!);
      }
    }

    for (const setIndex of setsRead) {
      const set: CharacterSet = program.sets[setIndex]!;

      for (let index: number = 0; index < set.ranges.length; index += 2) {
        addRange(set.ranges[index]!, set.ranges[index + 1]!);
      }
    }

    this.boundaries = Int32Array.from(
      Array.from(points).sort((left: number, right: number): number => {
        return left - right;
      }),
    );
    this.count = this.boundaries.length;
    this.asciiClass = new Int32Array(128);

    for (let codeUnit: number = 0; codeUnit < 128; codeUnit++) {
      this.asciiClass[codeUnit] = this.lookup(codeUnit);
    }
  }

  public classOf(codeUnit: number): number {
    if (codeUnit < 128) {
      return this.asciiClass[codeUnit]!;
    }

    return this.lookup(codeUnit);
  }

  private lookup(codeUnit: number): number {
    // The last boundary at or below the code unit.
    let low: number = 0;
    let high: number = this.boundaries.length - 1;

    while (low < high) {
      const middle: number = (low + high + 1) >>> 1;

      if (this.boundaries[middle]! <= codeUnit) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    return low;
  }
}

/*
 * ---------------------------------------------------------------------------
 * The automata kept between questions, within a bound of memory.
 * ---------------------------------------------------------------------------
 *
 * A program's automaton keeps the states it meets, so the next text is read
 * at one table lookup per code unit. Patterns come and go - the caches of
 * compiled patterns drop the least recently used - and a pattern can be
 * built to meet many large states. So every automaton is kept here, with an
 * estimate of the memory it holds (its states, and the program it reads),
 * and together they hold at most MAX_KEPT_AUTOMATA_BYTES: when keeping more
 * would pass that, the automata read least recently are dropped, to be built
 * again from nothing if their pattern is asked again. One automaton holds at
 * most MAX_AUTOMATON_BYTES; past that it reads on without keeping new states,
 * at the cost per code unit of reading without an automaton - which the work
 * meter bounds.
 */
export const MAX_KEPT_AUTOMATA_BYTES: number = 64 * 1024 * 1024;
export const MAX_AUTOMATON_BYTES: number = 16 * 1024 * 1024;

// What a state costs besides its arrays: the object, its key's entry.
const STATE_OVERHEAD_BYTES: number = 128;

class AutomatonStore {
  private readonly forwardAutomata: Map<Program, LazyDfa> = new Map<
    Program,
    LazyDfa
  >();
  private readonly backwardAutomata: Map<Program, LazyDfa> = new Map<
    Program,
    LazyDfa
  >();
  // Every kept automaton, the one read least recently first.
  private readonly recency: Map<LazyDfa, true> = new Map<LazyDfa, true>();
  private keptBytes: number = 0;

  // What all kept automata hold together (an estimate, in bytes).
  public get bytes(): number {
    return this.keptBytes;
  }

  // How many automata are kept.
  public get size(): number {
    return this.recency.size;
  }

  // The program's automaton for this direction: the kept one, or a new one.
  public automatonFor(program: Program, forwards: boolean): LazyDfa {
    const byProgram: Map<Program, LazyDfa> = forwards
      ? this.forwardAutomata
      : this.backwardAutomata;
    let automaton: LazyDfa | undefined = byProgram.get(program);

    if (automaton === undefined) {
      automaton = new LazyDfa(program, forwards, this);
      byProgram.set(program, automaton);
      this.keptBytes += automaton.bytes;
    } else {
      this.recency.delete(automaton);
    }

    this.recency.set(automaton, true);
    this.makeRoom(automaton);

    return automaton;
  }

  public holds(automaton: LazyDfa): boolean {
    return this.recency.has(automaton);
  }

  /*
   * Whether the automaton may keep a state of this many bytes more; when it
   * may, they are counted as kept.
   */
  public reserve(automaton: LazyDfa, bytes: number): boolean {
    if (
      !this.recency.has(automaton) ||
      automaton.bytes + bytes > MAX_AUTOMATON_BYTES
    ) {
      return false;
    }

    this.keptBytes += bytes;
    this.makeRoom(automaton);

    if (this.keptBytes > MAX_KEPT_AUTOMATA_BYTES) {
      // Only what this automaton holds is left, and it is too much.
      this.keptBytes -= bytes;
      return false;
    }

    return true;
  }

  // The automaton forgot states that held this many bytes.
  public released(automaton: LazyDfa, bytes: number): void {
    if (this.recency.has(automaton)) {
      this.keptBytes -= bytes;
    }
  }

  // Test seam: forget every automaton.
  public clear(): void {
    this.forwardAutomata.clear();
    this.backwardAutomata.clear();
    this.recency.clear();
    this.keptBytes = 0;
  }

  // Drops the automata read least recently until the rest fit; never `keep`.
  private makeRoom(keep: LazyDfa): void {
    if (this.keptBytes <= MAX_KEPT_AUTOMATA_BYTES) {
      return;
    }

    for (const oldest of Array.from(this.recency.keys())) {
      if (this.keptBytes <= MAX_KEPT_AUTOMATA_BYTES) {
        return;
      }

      if (oldest !== keep) {
        this.drop(oldest);
      }
    }
  }

  private drop(automaton: LazyDfa): void {
    this.recency.delete(automaton);
    (automaton.forwards ? this.forwardAutomata : this.backwardAutomata).delete(
      automaton.program,
    );
    this.keptBytes -= automaton.bytes;
  }
}

const automata: AutomatonStore = new AutomatonStore();

// What the kept automata hold, for tests and diagnostics.
export function getKeptAutomataBytes(): number {
  return automata.bytes;
}

export function getKeptAutomataCount(): number {
  return automata.size;
}

// Test seam: forget every kept automaton.
export function clearKeptAutomata(): void {
  automata.clear();
}

/*
 * One program's automaton for one direction of reading. Kept in the store
 * above, so every text read builds on the states earlier texts met.
 */
class LazyDfa {
  public readonly program: Program;
  public readonly forwards: boolean;
  /*
   * What the automaton holds, in bytes (an estimate): the program it reads
   * and its own arrays, and the states it keeps.
   */
  public bytes: number;
  private readonly store: AutomatonStore;
  private readonly classes: CodeUnitClasses;
  // The look-around answers the program reads, and each step's bit of them.
  private readonly lookaroundTables: Array<number>;
  private readonly bitOfStep: Int32Array;
  private readonly combinations: number;
  private readonly states: Array<DfaState> = [];
  private readonly stateByKey: Map<string, number> = new Map<string, number>();
  // What the kept states hold, in bytes.
  private statesBytes: number = 0;
  private readonly marks: Int32Array;
  private mark: number = 0;
  private readonly stack: Int32Array;
  private readonly found: Int32Array;
  private reachedEnd: boolean = false;
  // The meter of the scan under way.
  private meter: WorkMeter = new WorkMeter(Infinity);

  public constructor(
    program: Program,
    forwards: boolean,
    store: AutomatonStore,
  ) {
    this.program = program;
    this.forwards = forwards;
    this.store = store;
    this.classes = new CodeUnitClasses(program);
    this.lookaroundTables = Array.from(program.lookaroundsRead);
    this.bitOfStep = new Int32Array(program.ops.length).fill(-1);

    for (let pc: number = 0; pc < program.ops.length; pc++) {
      if (program.ops[pc] === OP_LOOKAROUND) {
        this.bitOfStep[pc] = this.lookaroundTables.indexOf(program.argA[pc]!);
      }
    }

    this.combinations = 1 << this.lookaroundTables.length;
    this.marks = new Int32Array(program.ops.length);
    this.stack = new Int32Array(program.ops.length + 1);
    this.found = new Int32Array(program.ops.length);

    let setBytes: number = 0;

    for (const set of program.sets) {
      setBytes += 64 + 8 * set.ranges.length;
    }

    // The program's four arrays and this automaton's four, per step.
    this.bytes = 32 * program.ops.length + 4 * this.classes.count + setBytes;
  }

  /*
   * Reads the whole text in this automaton's direction, starting a new way
   * at every position, and calls onMatch with every position where a way
   * reaches the end of the program, in reading order; onMatch returns true
   * to stop. Returns whether it was stopped.
   */
  public scan(
    text: string,
    tables: ReadonlyArray<Uint8Array>,
    meter: WorkMeter,
    onMatch: (position: number) => boolean,
  ): boolean {
    this.meter = meter;

    if (this.isFull()) {
      /*
       * Full from earlier texts: start this one afresh rather than read it
       * all with states that are not kept.
       */
      this.forgetStates();
    }

    const forwards: boolean = this.forwards;
    const firstCodeUnits: CharacterSet | null = this.program.firstCodeUnits;
    const idleStates: Array<DfaState | undefined> = [];
    let position: number = forwards ? 0 : text.length;
    let state: DfaState = this.stateFor([], BEHIND_NOTHING);

    for (;;) {
      const hasAhead: boolean = forwards
        ? position < text.length
        : position > 0;
      const ahead: number = hasAhead
        ? text.charCodeAt(forwards ? position : position - 1)
        : -1;

      if (
        hasAhead &&
        state.pcs.length === 0 &&
        firstCodeUnits !== null &&
        !firstCodeUnits.has(ahead)
      ) {
        /*
         * Nothing alive, and no match can start with the code unit ahead
         * (the program cannot match empty text): go to the next code unit
         * that can start one, as the idle state after the one behind it.
         */
        position = this.nextCandidate(firstCodeUnits, text, position);

        const behind: number = this.behindAt(text, position);
        let idle: DfaState | undefined = idleStates[behind];

        if (idle === undefined) {
          idle = this.stateFor([], behind);
          idleStates[behind] = idle;
        }

        state = idle;
        continue;
      }

      const combination: number = this.combinationAt(tables, position);

      if (!hasAhead) {
        if (this.endMatches(state, combination) && onMatch(position)) {
          return true;
        }

        return false;
      }

      const moveIndex: number =
        this.classes.classOf(ahead) * this.combinations + combination;
      let move: number =
        state.moves === null ? MOVE_UNKNOWN : state.moves[moveIndex]!;
      let next: DfaState;

      if (move === MOVE_UNKNOWN) {
        const computed: DfaState | number = this.computeMove(
          state,
          ahead,
          combination,
        );

        if (typeof computed === "number") {
          move = computed * 2 + (this.reachedEnd ? 1 : 0);

          if (state.moves !== null) {
            state.moves[moveIndex] = move;
          }

          next = this.states[computed]!;
        } else {
          // Not kept: carry on with the ways themselves as the state.
          move = this.reachedEnd ? 1 : 0;
          next = computed;
        }
      } else {
        next = this.states[move >>> 1]!;
      }

      if ((move & 1) === 1 && onMatch(position)) {
        return true;
      }

      state = next;
      position += forwards ? 1 : -1;
    }
  }

  // The next position, in reading order, whose code unit ahead can start a match.
  private nextCandidate(
    firstCodeUnits: CharacterSet,
    text: string,
    from: number,
  ): number {
    let position: number = from;

    if (this.forwards) {
      do {
        position++;
      } while (
        position < text.length &&
        !firstCodeUnits.has(text.charCodeAt(position))
      );

      return position;
    }

    do {
      position--;
    } while (
      position > 0 &&
      !firstCodeUnits.has(text.charCodeAt(position - 1))
    );

    return position;
  }

  private behindAt(text: string, position: number): number {
    const hasBehind: boolean = this.forwards
      ? position > 0
      : position < text.length;

    if (!hasBehind) {
      return BEHIND_NOTHING;
    }

    return this.behindAfter(
      text.charCodeAt(this.forwards ? position - 1 : position),
    );
  }

  private behindAfter(codeUnit: number): number {
    return (
      (isWordCodeUnit(codeUnit) ? BEHIND_WORD : 0) |
      (isLineTerminator(codeUnit) ? BEHIND_LINE_TERMINATOR : 0)
    );
  }

  private combinationAt(
    tables: ReadonlyArray<Uint8Array>,
    position: number,
  ): number {
    let combination: number = 0;

    for (let bit: number = 0; bit < this.lookaroundTables.length; bit++) {
      combination |=
        positionBit(tables[this.lookaroundTables[bit]!]!, position) << bit;
    }

    return combination;
  }

  /*
   * Follows the steps that read nothing from the state's steps - and from
   * the program's first step, a new way starting at this position - with
   * the assertions decided by the code unit behind (the state) and ahead
   * (-1: none). Leaves the reading steps found in this.found and returns how
   * many; sets this.reachedEnd when a way reaches the end of the program.
   */
  private closure(state: DfaState, ahead: number, combination: number): number {
    const program: Program = this.program;
    const ops: Int32Array = program.ops;
    const argA: Int32Array = program.argA;
    const argB: Int32Array = program.argB;
    const marks: Int32Array = this.marks;
    const stack: Int32Array = this.stack;
    const found: Int32Array = this.found;
    const mark: number = ++this.mark;
    let stackLength: number = 0;
    let foundLength: number = 0;

    this.reachedEnd = false;
    stack[stackLength++] = 0;

    for (let index: number = state.pcs.length - 1; index >= 0; index--) {
      stack[stackLength++] = state.pcs[index]!;
    }

    let visits: number = state.pcs.length;

    while (stackLength > 0) {
      let pc: number = stack[--stackLength]!;

      for (;;) {
        if (marks[pc] === mark) {
          break;
        }

        marks[pc] = mark;
        visits++;

        const op: number = ops[pc]!;

        if (op === OP_JUMP) {
          pc = argA[pc]!;
          continue;
        }

        if (op === OP_SPLIT) {
          stack[stackLength++] = argB[pc]!;
          pc = argA[pc]!;
          continue;
        }

        if (op === OP_ASSERT) {
          if (!this.assertionHoldsHere(argA[pc]!, state.behind, ahead)) {
            break;
          }

          pc++;
          continue;
        }

        if (op === OP_LOOKAROUND) {
          if (((combination >>> this.bitOfStep[pc]!) & 1) !== argB[pc]) {
            break;
          }

          pc++;
          continue;
        }

        if (op === OP_MATCH) {
          this.reachedEnd = true;
          break;
        }

        if (op > OP_MATCH) {
          // SAVE, RESET, PROGRESS: nothing to keep when nothing is captured.
          pc++;
          continue;
        }

        found[foundLength++] = pc;
        break;
      }
    }

    this.meter.spend(visits);

    return foundLength;
  }

  // Whether the automaton keeps as many moves as it may.
  private isFull(): boolean {
    return (
      (this.states.length + 1) * this.classes.count * this.combinations >
        MAX_DFA_MOVES || this.bytes >= MAX_AUTOMATON_BYTES
    );
  }

  // Forgets every state kept, so a new text starts afresh.
  private forgetStates(): void {
    this.states.length = 0;
    this.stateByKey.clear();
    this.store.released(this, this.statesBytes);
    this.bytes -= this.statesBytes;
    this.statesBytes = 0;
  }

  private assertionHoldsHere(
    kind: number,
    behind: number,
    ahead: number,
  ): boolean {
    // The code units left and right of the position, in text order.
    const behindIsNothing: boolean = (behind & BEHIND_NOTHING) !== 0;
    const behindIsWord: boolean = (behind & BEHIND_WORD) !== 0;
    const behindIsLineTerminator: boolean =
      (behind & BEHIND_LINE_TERMINATOR) !== 0;
    const aheadIsNothing: boolean = ahead < 0;
    const aheadIsWord: boolean = !aheadIsNothing && isWordCodeUnit(ahead);
    const aheadIsLineTerminator: boolean =
      !aheadIsNothing && isLineTerminator(ahead);
    const leftIsNothing: boolean = this.forwards
      ? behindIsNothing
      : aheadIsNothing;
    const rightIsNothing: boolean = this.forwards
      ? aheadIsNothing
      : behindIsNothing;
    const leftIsLineTerminator: boolean = this.forwards
      ? behindIsLineTerminator
      : aheadIsLineTerminator;
    const rightIsLineTerminator: boolean = this.forwards
      ? aheadIsLineTerminator
      : behindIsLineTerminator;

    switch (kind) {
      case ASSERT_TEXT_START:
        return leftIsNothing;
      case ASSERT_TEXT_END:
        return rightIsNothing;
      case ASSERT_LINE_START:
        return leftIsNothing || leftIsLineTerminator;
      case ASSERT_LINE_END:
        return rightIsNothing || rightIsLineTerminator;
      case ASSERT_WORD_BOUNDARY:
        return behindIsWord !== aheadIsWord;
      case ASSERT_NOT_WORD_BOUNDARY:
        return behindIsWord === aheadIsWord;
      default:
        return false;
    }
  }

  private endMatches(state: DfaState, combination: number): boolean {
    if (state.ends !== null && state.ends[combination] !== -1) {
      return state.ends[combination] === 1;
    }

    this.closure(state, -1, combination);
    const matches: boolean = this.reachedEnd;

    if (state.ends !== null) {
      state.ends[combination] = matches ? 1 : 0;
    }

    return matches;
  }

  /*
   * The state after reading `ahead` from `state`: a kept state's index or,
   * when no more can be kept, a state that is not kept. Sets
   * this.reachedEnd for the position before the code unit.
   */
  private computeMove(
    state: DfaState,
    ahead: number,
    combination: number,
  ): DfaState | number {
    const foundLength: number = this.closure(state, ahead, combination);
    const reachedEnd: boolean = this.reachedEnd;
    const next: Array<number> = [];

    for (let index: number = 0; index < foundLength; index++) {
      const pc: number = this.found[index]!;

      if (readsCodeUnit(this.program, pc, ahead)) {
        next.push(pc + 1);
      }
    }

    const behind: number = this.behindAfter(ahead);
    this.reachedEnd = reachedEnd;

    return this.keptStateFor(next, behind);
  }

  // The state of these ways: kept when it can be (see keptStateFor).
  private stateFor(pcs: Array<number>, behind: number): DfaState {
    const kept: DfaState | number = this.keptStateFor(pcs, behind);

    return typeof kept === "number" ? this.states[kept]! : kept;
  }

  /*
   * The kept state of these ways - an index - or, when the automaton is full
   * or the store has no room, a state that is not kept, which carries no
   * moves: every move from it is worked out again.
   */
  private keptStateFor(pcs: Array<number>, behind: number): DfaState | number {
    if (this.isFull()) {
      return { pcs: Int32Array.from(pcs), behind: behind, moves: null, ends: null };
    }

    // A set of ways: their order does not matter for where one ends.
    pcs.sort((left: number, right: number): number => {
      return left - right;
    });

    const key: string = `${behind}:${pcs.join(",")}`;
    const existing: number | undefined = this.stateByKey.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const moveCount: number = this.classes.count * this.combinations;
    // The key is digits, commas and a colon: one byte a character.
    const bytes: number =
      STATE_OVERHEAD_BYTES +
      4 * moveCount +
      this.combinations +
      4 * pcs.length +
      key.length;

    if (!this.store.reserve(this, bytes)) {
      return { pcs: Int32Array.from(pcs), behind: behind, moves: null, ends: null };
    }

    this.bytes += bytes;
    this.statesBytes += bytes;
    this.states.push({
      pcs: Int32Array.from(pcs),
      behind: behind,
      moves: new Int32Array(moveCount).fill(MOVE_UNKNOWN),
      ends: new Int8Array(this.combinations).fill(-1),
    });
    this.stateByKey.set(key, this.states.length - 1);

    return this.states.length - 1;
  }
}

/*
 * ---------------------------------------------------------------------------
 * The same question without the automaton, for a program that reads more
 * look-arounds than it takes: every way, one position at a time.
 * ---------------------------------------------------------------------------
 */

class StepWalker {
  public readonly program: Program;
  public readonly text: string;
  public readonly tables: ReadonlyArray<Uint8Array>;
  private readonly marks: Int32Array;
  private mark: number = 0;
  private readonly stack: Int32Array;
  private readonly meter: WorkMeter;

  public constructor(
    program: Program,
    text: string,
    tables: ReadonlyArray<Uint8Array>,
    meter: WorkMeter,
  ) {
    this.program = program;
    this.text = text;
    this.tables = tables;
    this.marks = new Int32Array(program.ops.length);
    this.stack = new Int32Array(program.ops.length + 1);
    this.meter = meter;
  }

  // Starts a new position: no step has been visited at it yet.
  public nextPosition(): void {
    this.mark++;
  }

  /*
   * Adds to `list` (from `length` on) every step that reads a code unit, or
   * ends the program, reachable from pc at this position without reading.
   * Returns the new length.
   */
  public addSteps(
    list: Int32Array,
    length: number,
    startPc: number,
    position: number,
  ): number {
    const ops: Int32Array = this.program.ops;
    const argA: Int32Array = this.program.argA;
    const argB: Int32Array = this.program.argB;
    const marks: Int32Array = this.marks;
    const mark: number = this.mark;
    const stack: Int32Array = this.stack;
    let stackLength: number = 0;
    let listLength: number = length;
    let visits: number = 1;

    stack[stackLength++] = startPc;

    while (stackLength > 0) {
      let pc: number = stack[--stackLength]!;

      for (;;) {
        if (marks[pc] === mark) {
          break;
        }

        marks[pc] = mark;
        visits++;

        const op: number = ops[pc]!;

        if (op === OP_JUMP) {
          pc = argA[pc]!;
          continue;
        }

        if (op === OP_SPLIT) {
          stack[stackLength++] = argB[pc]!;
          pc = argA[pc]!;
          continue;
        }

        if (op === OP_ASSERT) {
          if (!assertionHolds(argA[pc]!, this.text, position)) {
            break;
          }

          pc++;
          continue;
        }

        if (op === OP_LOOKAROUND) {
          if (positionBit(this.tables[argA[pc]!]!, position) !== argB[pc]) {
            break;
          }

          pc++;
          continue;
        }

        if (op > OP_MATCH) {
          // SAVE, RESET, PROGRESS: nothing to keep when nothing is captured.
          pc++;
          continue;
        }

        list[listLength++] = pc;
        break;
      }
    }

    this.meter.spend(visits);

    return listLength;
  }
}

function scanByWays(
  program: Program,
  forwards: boolean,
  text: string,
  tables: ReadonlyArray<Uint8Array>,
  meter: WorkMeter,
  onMatch: (position: number) => boolean,
): boolean {
  const walker: StepWalker = new StepWalker(program, text, tables, meter);
  const size: number = program.ops.length;
  let current: Int32Array = new Int32Array(size);
  let next: Int32Array = new Int32Array(size);
  let position: number = forwards ? 0 : text.length;
  let stopped: boolean = false;

  // Takes the ends out of the list; reports them. Null when told to stop.
  const keepReading: (list: Int32Array, length: number) => number | null = (
    list: Int32Array,
    length: number,
  ): number | null => {
    let kept: number = 0;
    let reachedEnd: boolean = false;

    for (let index: number = 0; index < length; index++) {
      const pc: number = list[index]!;

      if (program.ops[pc] === OP_MATCH) {
        reachedEnd = true;
        continue;
      }

      list[kept++] = pc;
    }

    if (reachedEnd && onMatch(position)) {
      stopped = true;
      return null;
    }

    return kept;
  };

  walker.nextPosition();
  let currentLength: number | null = keepReading(
    current,
    walker.addSteps(current, 0, 0, position),
  );

  while (currentLength !== null) {
    if (forwards ? position >= text.length : position <= 0) {
      return false;
    }

    const codeUnit: number = text.charCodeAt(
      forwards ? position : position - 1,
    );
    const nextPosition: number = position + (forwards ? 1 : -1);
    walker.nextPosition();
    let nextLength: number = 0;

    for (let index: number = 0; index < currentLength; index++) {
      const pc: number = current[index]!;

      if (readsCodeUnit(program, pc, codeUnit)) {
        nextLength = walker.addSteps(next, nextLength, pc + 1, nextPosition);
      }
    }

    nextLength = walker.addSteps(next, nextLength, 0, nextPosition);
    position = nextPosition;

    const swap: Int32Array = current;
    current = next;
    next = swap;
    currentLength = keepReading(current, nextLength);
  }

  return stopped;
}

/*
 * ---------------------------------------------------------------------------
 * The questions LinearRegExp asks.
 * ---------------------------------------------------------------------------
 */

function scanProgram(
  program: Program,
  forwards: boolean,
  text: string,
  tables: ReadonlyArray<Uint8Array>,
  meter: WorkMeter,
  onMatch: (position: number) => boolean,
): boolean {
  if (program.lookaroundsRead.length > MAX_DFA_LOOKAROUNDS) {
    return scanByWays(program, forwards, text, tables, meter, onMatch);
  }

  return automata
    .automatonFor(program, forwards)
    .scan(text, tables, meter, onMatch);
}

// Whether the pattern matches anywhere in the text.
export function testProgram(
  program: Program,
  text: string,
  tables: ReadonlyArray<Uint8Array>,
  meter: WorkMeter,
): boolean {
  return scanProgram(program, true, text, tables, meter, (): boolean => {
    return true;
  });
}

/*
 * The answers of every look-around of a pattern for one text: bit p of tables[i] is
 * 1 when look-around i's body matches at position p (without its negation) -
 * a look-behind's body ending at p, read forwards; a look-ahead's body
 * starting at p, its steps compiled backwards and read backwards.
 */
export function computeLookaroundTables(
  compiled: CompiledPattern,
  text: string,
  meter: WorkMeter,
): Array<Uint8Array> {
  const tables: Array<Uint8Array> = [];

  for (const lookaround of compiled.lookarounds) {
    const answers: Uint8Array = newPositionBits(text.length);

    scanProgram(
      lookaround.program,
      lookaround.behind,
      text,
      tables,
      meter,
      (position: number): boolean => {
        setPositionBit(answers, position);
        return false;
      },
    );

    tables.push(answers);
  }

  return tables;
}

/*
 * Where a match of the pattern can start: bit p of starts is 1 when some match
 * starts at p. One backwards reading of the pattern compiled backwards.
 */
export function computeMatchStarts(
  compiled: CompiledPattern,
  text: string,
  tables: ReadonlyArray<Uint8Array>,
  meter: WorkMeter,
): Uint8Array {
  const starts: Uint8Array = newPositionBits(text.length);

  scanProgram(
    compiled.reversed,
    false,
    text,
    tables,
    meter,
    (position: number): boolean => {
      setPositionBit(starts, position);
      return false;
    },
  );

  return starts;
}

/*
 * ---------------------------------------------------------------------------
 * The ordered machine: the match exec returns, from a known start.
 * ---------------------------------------------------------------------------
 */

export interface AnchoredOutcome {
  /*
   * Two slots per group, group 0 being the whole match: where it starts and
   * ends, -1 for a group that took no part. Null when no match starts here.
   */
  slots: Array<number> | null;
}

/*
 * The ordered machine's arrays: a grok pattern has thousands of steps, and
 * allocating its lists for every log line would cost more than reading the
 * line. One set serves every program - the machine never runs inside itself
 * - grown to the largest program it has run, so what it holds does not grow
 * with how many patterns are kept.
 */
interface AnchoredWorkspace {
  // How many ways the arrays have room for.
  size: number;
  marks: Int32Array;
  // Marks below this one belong to earlier positions or earlier runs.
  mark: number;
  stackPcs: Int32Array;
  stackSlots: Array<Array<number>>;
  firstPcs: Int32Array;
  firstSlots: Array<Array<number>>;
  secondPcs: Int32Array;
  secondSlots: Array<Array<number>>;
}

const MARK_RESET_AT: number = 0x3fffffff;

function newWorkspace(size: number): AnchoredWorkspace {
  return {
    size: size,
    marks: new Int32Array(size),
    mark: 0,
    stackPcs: new Int32Array(size + 1),
    stackSlots: new Array<Array<number>>(size + 1),
    firstPcs: new Int32Array(size),
    firstSlots: new Array<Array<number>>(size),
    secondPcs: new Int32Array(size),
    secondSlots: new Array<Array<number>>(size),
  };
}

let sharedWorkspace: AnchoredWorkspace = newWorkspace(0);

function workspaceFor(program: Program): AnchoredWorkspace {
  // A way is a step and a count up to the program's scope width.
  const size: number = program.ops.length * program.scopeWidth;

  if (sharedWorkspace.size < size) {
    sharedWorkspace = newWorkspace(size);
  }

  return sharedWorkspace;
}

// How many ways the shared arrays have room for, for tests.
export function getAnchoredWorkspaceSize(): number {
  return sharedWorkspace.size;
}

/*
 * The match a backtracking engine finds starting exactly at `start`, or
 * null. With captures off, only where the whole match starts and ends is
 * kept.
 */
export function execAnchored(
  program: Program,
  text: string,
  start: number,
  tables: ReadonlyArray<Uint8Array>,
  captures: boolean,
  meter: WorkMeter,
): AnchoredOutcome {
  const ops: Int32Array = program.ops;
  const argA: Int32Array = program.argA;
  const argB: Int32Array = program.argB;
  const scopeOf: Int32Array = program.scopeOf;
  const scopes: Array<Int32Array> = program.scopes;
  const width: number = program.scopeWidth;
  /*
   * A way is a step and, when the step sits in repetitions that must read
   * something, how many of the innermost of those have read nothing yet:
   * two ways that differ there can fail or not at the end of a repetition,
   * so both are kept (see Program.ts). The count suffices - an outer
   * repetition that has read nothing contains inner ones that have not
   * either.
   */
  const workspace: AnchoredWorkspace = workspaceFor(program);
  const marks: Int32Array = workspace.marks;
  let mark: number = workspace.mark;
  const stackPcs: Int32Array = workspace.stackPcs;
  const stackSlots: Array<Array<number>> = workspace.stackSlots;

  let currentPcs: Int32Array = workspace.firstPcs;
  let currentSlots: Array<Array<number>> = workspace.firstSlots;
  let currentLength: number = 0;
  let nextPcs: Int32Array = workspace.secondPcs;
  let nextSlots: Array<Array<number>> = workspace.secondSlots;
  let nextLength: number = 0;
  let matched: Array<number> | null = null;

  const wayOf: (
    pc: number,
    slots: Array<number>,
    position: number,
  ) => number = (
    pc: number,
    slots: Array<number>,
    position: number,
  ): number => {
    if (width === 1) {
      return pc;
    }

    const registers: Int32Array = scopes[scopeOf[pc]!]!;
    let unread: number = 0;

    for (
      let index: number = registers.length - 1;
      index >= 0 && slots[registers[index]!] === position;
      index--
    ) {
      unread++;
    }

    return pc * width + unread;
  };

  const addSteps: (
    startPc: number,
    startSlots: Array<number>,
    position: number,
  ) => void = (
    startPc: number,
    startSlots: Array<number>,
    position: number,
  ): void => {
    let stackLength: number = 0;
    let visits: number = 1;
    stackPcs[stackLength] = startPc;
    stackSlots[stackLength] = startSlots;
    stackLength++;

    while (stackLength > 0) {
      stackLength--;
      let pc: number = stackPcs[stackLength]!;
      let slots: Array<number> = stackSlots[stackLength]!;
      /*
       * Slots are shared until a way writes to them; then the way takes a
       * copy of its own, once, until it splits again. A copy is counted as
       * work in line with its length.
       */
      let owned: boolean = false;
      const copyCost: number = 1 + (startSlots.length >>> 3);

      for (;;) {
        const way: number = wayOf(pc, slots, position);

        if (marks[way] === mark) {
          break;
        }

        marks[way] = mark;
        visits++;

        const op: number = ops[pc]!;

        if (op === OP_JUMP) {
          pc = argA[pc]!;
          continue;
        }

        if (op === OP_SPLIT) {
          stackPcs[stackLength] = argB[pc]!;
          stackSlots[stackLength] = slots;
          stackLength++;
          owned = false;
          pc = argA[pc]!;
          continue;
        }

        if (op === OP_SAVE) {
          const slot: number = argA[pc]!;

          if ((captures || slot < 2) && slots[slot] !== position) {
            if (!owned) {
              slots = slots.slice();
              owned = true;
              visits += copyCost;
            }

            slots[slot] = position;
          }

          pc++;
          continue;
        }

        if (op === OP_RESET) {
          if (captures) {
            if (!owned) {
              slots = slots.slice();
              owned = true;
              visits += copyCost;
            }

            slots.fill(-1, argA[pc]!, argB[pc]!);
          }

          pc++;
          continue;
        }

        if (op === OP_PROGRESS_START) {
          if (slots[argA[pc]!] !== position) {
            if (!owned) {
              slots = slots.slice();
              owned = true;
              visits += copyCost;
            }

            slots[argA[pc]!] = position;
          }

          pc++;
          continue;
        }

        if (op === OP_PROGRESS_CHECK) {
          if (slots[argA[pc]!] === position) {
            // A repetition past the minimum that matched nothing fails.
            break;
          }

          pc++;
          continue;
        }

        if (op === OP_ASSERT) {
          if (!assertionHolds(argA[pc]!, text, position)) {
            break;
          }

          pc++;
          continue;
        }

        if (op === OP_LOOKAROUND) {
          if (positionBit(tables[argA[pc]!]!, position) !== argB[pc]) {
            break;
          }

          pc++;
          continue;
        }

        nextPcs[nextLength] = pc;
        nextSlots[nextLength] = slots;
        nextLength++;
        break;
      }
    }

    meter.spend(visits);
  };

  const startSlots: Array<number> = new Array<number>(program.slotCount).fill(
    -1,
  );
  startSlots[0] = start;
  let position: number = start;

  try {
    // The program's first step saves where the match starts; it is set above.
    mark++;
    nextLength = 0;
    addSteps(1, startSlots, position);

    while (nextLength > 0) {
      const swapPcs: Int32Array = currentPcs;
      currentPcs = nextPcs;
      nextPcs = swapPcs;
      const swapSlots: Array<Array<number>> = currentSlots;
      currentSlots = nextSlots;
      nextSlots = swapSlots;
      currentLength = nextLength;
      nextLength = 0;

      const codeUnit: number =
        position < text.length ? text.charCodeAt(position) : -1;
      mark++;
      meter.spend(currentLength);

      for (let index: number = 0; index < currentLength; index++) {
        const pc: number = currentPcs[index]!;

        if (ops[pc] === OP_MATCH) {
          /*
           * The best match so far: every way after it is one a backtracking
           * engine would never get to.
           */
          matched = currentSlots[index]!;
          break;
        }

        if (codeUnit >= 0 && readsCodeUnit(program, pc, codeUnit)) {
          addSteps(pc + 1, currentSlots[index]!, position + 1);
        }
      }

      if (position >= text.length) {
        break;
      }

      position++;
    }
  } finally {
    // Kept for the next run, even when this one was stopped.
    workspace.mark = mark;

    if (mark > MARK_RESET_AT) {
      marks.fill(0);
      workspace.mark = 0;
    }
  }

  return { slots: matched };
}

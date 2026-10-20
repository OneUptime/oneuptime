import CharacterSet from "./CharacterSet";

/*
 * THE SHAPE OF A PARSED PATTERN.
 *
 * What Parser.ts reads a JavaScript regular expression into and Program.ts
 * compiles. Each node carries the flags that were in force where it was
 * written, since a modifier group - (?i:...) - can change them for part of a
 * pattern.
 */

export enum AssertionKind {
  // ^ : the start of the text, or of a line with the m flag.
  Start = "Start",
  // $ : the end of the text, or of a line with the m flag.
  End = "End",
  WordBoundary = "WordBoundary",
  NotWordBoundary = "NotWordBoundary",
}

export type SyntaxNode =
  | EmptyNode
  | CharacterNode
  | SetNode
  | AssertionNode
  | LookaroundNode
  | GroupNode
  | RepeatNode
  | AlternationNode
  | SequenceNode;

export interface EmptyNode {
  kind: "Empty";
}

// One code unit.
export interface CharacterNode {
  kind: "Character";
  codeUnit: number;
  ignoreCase: boolean;
}

/*
 * A character class, an escape such as \d or \W, or the dot. `set` holds the
 * members as written; with ignoreCase the members' case variants count too.
 * `negate` is a class written [^...]: it matches what the class would not.
 */
export interface SetNode {
  kind: "Set";
  set: CharacterSet;
  negate: boolean;
  ignoreCase: boolean;
}

export interface AssertionNode {
  kind: "Assertion";
  assertion: AssertionKind;
  multiline: boolean;
}

// (?=...), (?!...), (?<=...), (?<!...)
export interface LookaroundNode {
  kind: "Lookaround";
  behind: boolean;
  negate: boolean;
  body: SyntaxNode;
}

/*
 * A capturing group: captureIndex counts from 1, left to right, as
 * JavaScript numbers groups. Non-capturing groups do not appear in the tree.
 */
export interface GroupNode {
  kind: "Group";
  captureIndex: number;
  name: string | null;
  body: SyntaxNode;
}

/*
 * body{min,max}; max is Infinity for *, + and {n,}. The capturing groups
 * inside the body are firstCapture .. firstCapture + captureCount - 1:
 * JavaScript forgets what they captured at the start of every repetition.
 */
export interface RepeatNode {
  kind: "Repeat";
  min: number;
  max: number;
  greedy: boolean;
  body: SyntaxNode;
  firstCapture: number;
  captureCount: number;
}

export interface AlternationNode {
  kind: "Alternation";
  options: Array<SyntaxNode>;
}

export interface SequenceNode {
  kind: "Sequence";
  items: Array<SyntaxNode>;
}

export interface ParsedPattern {
  root: SyntaxNode;
  // How many capturing groups the pattern has.
  captureCount: number;
  // Each capturing group's name, or null: index 0 stands for group 1.
  captureNames: Array<string | null>;
}

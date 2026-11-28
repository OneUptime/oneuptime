import type GlossaryTerm from "../../../Types/Docs/GlossaryTerm";
import { Context, createContext } from "react";

/*
 * A DEFINITION SOMEONE OPENED (#7019).
 *
 * Which words people open the definition of says which words still
 * confuse them. A defined term (DefinedTerm) tells, once per word drawn,
 * that its definition was opened, by its term and how:
 *
 *   - press: a click or a tap on the word;
 *   - keyboard: the keyboard's focus reached the word;
 *   - hover: the pointer rested on the word for DEFINITION_HOVER_OPEN_MS.
 *     A pointer on its way across the page shows the definition too, at
 *     once (DefinedTerm), but that is not someone reading it.
 *
 * It tells its `onOpened`, and the page's listener (DefinitionOpenedContext)
 * - the Dashboard's sends `glossary/definition_opened` to product analytics
 * (Utils/GlossaryEvents), where product analytics is set up and the person
 * allows it. A page that gives no listener hears nothing: a shared
 * component sends no event of its own.
 */

export enum DefinitionOpenedTrigger {
  Press = "press",
  Keyboard = "keyboard",
  Hover = "hover",
}

export interface DefinitionOpened {
  term: GlossaryTerm;
  trigger: DefinitionOpenedTrigger;
}

export type DefinitionOpenedListener = (opened: DefinitionOpened) => void;

// How long the pointer rests on a word before its definition counts as opened.
export const DEFINITION_HOVER_OPEN_MS: number = 1000;

// The page's listener: told about every definition opened on it.
export const DefinitionOpenedContext: Context<DefinitionOpenedListener | null> =
  createContext<DefinitionOpenedListener | null>(null);

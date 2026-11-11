import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  getLineDirection,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../Utils/LineDirection";
import useTranslator from "../../Utils/UseTranslator";
import { ReadingDirection } from "../../../Types/ReadingDirection";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

export interface ComponentProps {
  // The words that decide which way the line reads.
  text: string;
  /*
   * What the line draws, when it is not just the words: a link around
   * them, a fallback dash.
   */
  children?: ReactNode | undefined;
  className?: string | undefined;
  // A line of its own: a block, a paragraph, or a span made a block.
  as?: "div" | "p" | "span" | undefined;
  title?: string | undefined;
  dataTestId?: string | undefined;
}

// A box cut short to a few lines (line-clamp-2), whose "..." text-end drops.
const LINE_CLAMP_CLASS_NAME_PATTERN: RegExp = /(?:^|\s)line-clamp-\d+(?:\s|$)/;

/*
 * A box whose words may run onto more lines: its white-space lets them
 * wrap (whitespace-normal and the like, text-wrap, text-balance,
 * text-pretty) or it breaks a word too long for it (break-words,
 * break-all, [overflow-wrap:anywhere]).
 */
const WRAPPING_CLASS_NAME_PATTERN: RegExp =
  /(?:^|\s)(?:whitespace-(?:normal|pre-wrap|pre-line|break-spaces)|text-(?:wrap|balance|pretty)|break-(?:words|all)|\[overflow-wrap:(?:anywhere|break-word)\]|\[word-break:break-(?:all|word)\])(?=\s|$)/;

// A box kept to one line, whatever else it says.
const ONE_LINE_CLASS_NAME_PATTERN: RegExp =
  /(?:^|\s)(?:truncate|whitespace-nowrap|text-nowrap)(?=\s|$)/;

/*
 * Whether a box of these classes says its words wrap (and nothing keeps
 * them to one line). Such a box aligned to its end, as a one-line box is,
 * lines up every one of its lines by its end: an English paragraph on an
 * Arabic page ragged on its left, where it starts. Exported for its tests.
 */
export const isWrappingLineClassName: (
  className: string | null | undefined,
) => boolean = (className: string | null | undefined): boolean => {
  if (!className) {
    return false;
  }

  return (
    WRAPPING_CLASS_NAME_PATTERN.test(className) &&
    !ONE_LINE_CLASS_NAME_PATTERN.test(className)
  );
};

/*
 * The classes a line of `text` takes on a page in `pageLanguage`, and the
 * dir it reads in: none of either when its words read the page's way.
 */
export const getIsolatedLine: (data: {
  text: string | null | undefined;
  pageLanguage: string | null | undefined;
  className?: string | undefined;
}) => { dir: ReadingDirection | undefined; className: string } = (data: {
  text: string | null | undefined;
  pageLanguage: string | null | undefined;
  className?: string | undefined;
}): { dir: ReadingDirection | undefined; className: string } => {
  const className: string = data.className || "";
  const dir: ReadingDirection | undefined = getLineDirection(
    data.text,
    data.pageLanguage,
  );

  if (!dir) {
    return { dir: undefined, className: className };
  }

  /*
   * Lined up as the page's lines are: by its end, which is the page's
   * start - or, cut short to a few lines or wrapping onto them, by its
   * width (text-end would drop a clamped line's "...", and line up each
   * wrapped line by its end): as wide as its words, at the page's start,
   * each of its lines from its own start.
   */
  const alignClassName: string =
    LINE_CLAMP_CLASS_NAME_PATTERN.test(className) ||
    isWrappingLineClassName(className)
      ? CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME
      : LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME;

  return {
    dir: dir,
    className: className ? `${className} ${alignClassName}` : alignClassName,
  };
};

/*
 * A LINE OF ITS OWN, READ THE WAY ITS WORDS ARE WRITTEN.
 *
 * IsolatedText keeps a value's punctuation in place inside a line of the
 * page. A line that is cut short where its box ends needs more: the box
 * itself reads the words' way, so an English name on an Arabic page ends in
 * "..." at its own end ("Checkout API lat...") rather than losing its start
 * ("...API latency") - LineDirection. A table's cell does this for the one
 * line it draws (TableRow, Column.getLineText); a cell that lays out more -
 * a provider's logo beside the name, a line of the page's own words under
 * it - draws its name on an IsolatedLine, and leaves its other lines the
 * page's.
 *
 * Words in the page's own way are drawn exactly as they were: no dir, no
 * class of its own.
 */
const IsolatedLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const language: string | undefined = useTranslator().language;
  const line: { dir: ReadingDirection | undefined; className: string } =
    getIsolatedLine({
      text: props.text,
      pageLanguage: language,
      className: props.className,
    });
  const Tag: "div" | "p" | "span" = props.as || "div";

  return (
    <Tag
      dir={line.dir}
      className={line.className || undefined}
      title={props.title}
      data-testid={props.dataTestId}
    >
      {props.children === undefined ? props.text : props.children}
    </Tag>
  );
};

export default IsolatedLine;

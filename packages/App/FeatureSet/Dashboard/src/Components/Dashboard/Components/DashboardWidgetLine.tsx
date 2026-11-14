import { getIsolatedLine } from "Common/UI/Components/IsolatedText/IsolatedLine";
import { DEFAULT_PAGE_LANGUAGE } from "Common/UI/Utils/PageLanguage";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { ReadingDirection } from "Common/Types/ReadingDirection";
import React, {
  CSSProperties,
  FunctionComponent,
  ReactElement,
  ReactNode,
} from "react";
import { isPublicDashboard } from "../Utils/PublicDashboardContext";

/*
 * A WIDGET'S LINE OF WORDS SOMEONE WROTE, READ THE WAY THEY ARE WRITTEN.
 *
 * A widget's title, a list row's name, a container's image, a pod's
 * namespace: words someone typed, or a system named, in their language
 * whatever the board's. A line that ends in "..." where its box does is
 * cut at the end of the line, and on an Arabic or Persian board a line
 * ends at the left - where an English one starts: "checkout-api-production"
 * read "...api-production", and the names a list shows one under another
 * lost the start that tells them apart.
 *
 * Drawn here, such a line's box reads the way its words do when that is
 * not the board's way (Common's getIsolatedLine): an English name on an
 * Arabic board is cut at its own end ("checkout-api-pro..."), and kept on
 * the board's side - aligned to its end, which is the board's start, so a
 * short one still starts under its column's name; a title centred in its
 * tile stays centred. Words that read the board's way are drawn exactly as
 * they were: no dir, no class of their own. A cell that holds a figure or a
 * state (a count, a time, a status) is not drawn here: it is written for
 * its reader already.
 */

/*
 * THE LANGUAGE A WIDGET'S LINES ARE LAID OUT IN.
 *
 * In the Dashboard, the reader's: <html dir> follows it (PageLanguage). A
 * public dashboard's page stays as the server drew it - English, read from
 * the left - whatever its visitor's browser speaks (VisitorLanguage), and
 * its widgets draw their words in English. A line there is read against
 * English: an English name needs no dir of its own on that page, where the
 * visitor's Arabic would have set it apart and moved it to the cell's end.
 */
export const getWidgetPageLanguage: (
  readerLanguage: string | null | undefined,
) => string = (readerLanguage: string | null | undefined): string => {
  if (isPublicDashboard()) {
    return DEFAULT_PAGE_LANGUAGE;
  }

  return readerLanguage || DEFAULT_PAGE_LANGUAGE;
};

// The elements a widget draws such a line as.
export type DashboardWidgetLineTag = "div" | "span" | "p" | "h3" | "td";

export interface ComponentProps {
  // The words that decide which way the line reads.
  text: string;
  /*
   * What the line draws, when it is not just the words: a link around
   * them.
   */
  children?: ReactNode | undefined;
  // The box's classes; it keeps to one line, or to a few, as they say.
  className?: string | undefined;
  as?: DashboardWidgetLineTag | undefined;
  // Under the pointer: the words whole, for a line cut short.
  title?: string | undefined;
  dataTestId?: string | undefined;
  /*
   * The box's own measures, when a class cannot say them: a honeycomb
   * tile's label is as wide as its tile lets it be.
   */
  style?: CSSProperties | undefined;
}

const DashboardWidgetLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const language: string = getWidgetPageLanguage(useTranslator().language);
  const line: { dir: ReadingDirection | undefined; className: string } =
    getIsolatedLine({
      text: props.text,
      pageLanguage: language,
      className: props.className,
    });
  const Tag: DashboardWidgetLineTag = props.as || "div";

  return (
    <Tag
      dir={line.dir}
      className={line.className || undefined}
      title={props.title}
      data-testid={props.dataTestId}
      style={props.style}
    >
      {props.children === undefined ? props.text : props.children}
    </Tag>
  );
};

export default DashboardWidgetLine;

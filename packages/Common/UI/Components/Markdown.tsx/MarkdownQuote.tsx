import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useContext,
} from "react";
import {
  MARKDOWN_CALLOUT_ATTRIBUTE,
  MarkdownCalloutKind,
  getMarkdownCalloutKind,
} from "./MarkdownCallouts";
import { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

/*
 * A blockquote in rendered Markdown (MarkdownViewer's `blockquote`): a quote,
 * or a callout when the Markdown asked for one (MarkdownCallouts).
 *
 * A quote is drawn as the editor draws it while the note is written
 * (MarkdownEditor's `.oneuptime-wysiwyg blockquote`): a grey bar down its
 * left side and its text a shade lighter. No box and no icon - it is
 * somebody's words, not a warning. Its paragraphs and list items read the
 * lighter shade from MarkdownQuoteContext, so the dark theme re-colours it
 * like any other text (Theme.css remaps text-gray-600; an arbitrary
 * [&_p]: variant it would not).
 *
 * A callout is a tinted panel with its kind's icon beside the text, as the
 * viewer drew every blockquote before. Its label is not written out above
 * it: a callout's own words lead it ("**This token is a secret.**"), and the
 * icon and tint say which kind it is; a screen reader is told by its name.
 */

/*
 * The quote, as MarkdownEditor's visual mode draws it, its bar on the side
 * the text starts from (left to right: the left).
 */
export const MARKDOWN_QUOTE_CLASS_NAME: string =
  "my-2 border-s-[3px] border-gray-300 ps-3";

// The text of a paragraph or a list item, in a quote and anywhere else.
export const MARKDOWN_QUOTED_TEXT_CLASS_NAME: string = "text-gray-600";
export const MARKDOWN_TEXT_CLASS_NAME: string = "text-gray-700";

export const MARKDOWN_CALLOUT_CLASS_NAME: string =
  "my-3 flex items-start gap-3 rounded-lg border px-4 py-3";

// The text beside the icon: the first and last blocks sit flush with the panel.
export const MARKDOWN_CALLOUT_BODY_CLASS_NAME: string =
  "min-w-0 flex-1 text-sm text-gray-700 leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

export interface MarkdownCalloutStyle {
  // The panel's border and tint.
  panel: string;
  // The icon's colour.
  icon: string;
  // The icon: a Heroicons outline path, as the docs draw the same kind.
  iconPath: string;
  /*
   * What a screen reader calls it, in English: the reader's language has
   * its own word under the callout's key (getMarkdownCalloutName).
   */
  label: string;
}

// The docs' icons (MarkdownDocsExtensions.DOCS_CALLOUT_ICONS), as paths.
const INFO_ICON: string =
  "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z";
const TIP_ICON: string =
  "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z";
const IMPORTANT_ICON: string =
  "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z";
const WARNING_ICON: string =
  "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z";
const DANGER_ICON: string = "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z";

export const MARKDOWN_CALLOUT_STYLES: Readonly<
  Record<MarkdownCalloutKind, MarkdownCalloutStyle>
> = {
  note: {
    panel: "border-blue-200 bg-blue-50",
    icon: "text-blue-500",
    iconPath: INFO_ICON,
    label: "Note",
  },
  info: {
    panel: "border-blue-200 bg-blue-50",
    icon: "text-blue-500",
    iconPath: INFO_ICON,
    label: "Info",
  },
  tip: {
    panel: "border-green-200 bg-green-50",
    icon: "text-green-600",
    iconPath: TIP_ICON,
    label: "Tip",
  },
  important: {
    panel: "border-violet-200 bg-violet-50",
    icon: "text-violet-500",
    iconPath: IMPORTANT_ICON,
    label: "Important",
  },
  warning: {
    panel: "border-amber-200 bg-amber-50",
    icon: "text-amber-500",
    iconPath: WARNING_ICON,
    label: "Warning",
  },
  caution: {
    panel: "border-amber-200 bg-amber-50",
    icon: "text-amber-500",
    iconPath: WARNING_ICON,
    label: "Caution",
  },
  danger: {
    panel: "border-red-200 bg-red-50",
    icon: "text-red-500",
    iconPath: DANGER_ICON,
    label: "Danger",
  },
};

// Where a callout's name is kept in every frontend's locale files.
export const MARKDOWN_CALLOUT_NAME_KEY_PREFIX: string = "markdownCallouts.";

/*
 * What a screen reader calls a callout, in the reader's language.
 *
 * Each kind is a key of its own (markdownCallouts.note, ...), worded as the
 * docs name their callouts, never the shared word: the Dashboard's "Note" is
 * a note somebody wrote (German "Notiz", where a callout is a "Hinweis"),
 * and its "Warning" and "Info" name statuses and severities whose words the
 * docs and other pages pin. A frontend without the key, or a stand-in t()
 * that hands keys back, reads the English.
 */
export const getMarkdownCalloutName: (
  t: TFunction,
  kind: MarkdownCalloutKind,
) => string = (t: TFunction, kind: MarkdownCalloutKind): string => {
  const names: Record<MarkdownCalloutKind, unknown> = {
    note: t("markdownCallouts.note", "Note"),
    info: t("markdownCallouts.info", "Info"),
    tip: t("markdownCallouts.tip", "Tip"),
    important: t("markdownCallouts.important", "Important"),
    warning: t("markdownCallouts.warning", "Warning"),
    caution: t("markdownCallouts.caution", "Caution"),
    danger: t("markdownCallouts.danger", "Danger"),
  };
  const name: unknown = names[kind];

  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.startsWith(MARKDOWN_CALLOUT_NAME_KEY_PREFIX)
  ) {
    return MARKDOWN_CALLOUT_STYLES[kind].label;
  }

  return name;
};

/*
 * Whether the text being drawn is inside a quote. A callout starts afresh:
 * a quote's words inside a callout are a quote again only in a quote of
 * their own.
 */
export const MarkdownQuoteContext: React.Context<boolean> =
  React.createContext<boolean>(false);

// The colour of a paragraph's or a list item's text where it is drawn.
export const useMarkdownTextClassName: () => string = (): string => {
  return useContext(MarkdownQuoteContext)
    ? MARKDOWN_QUOTED_TEXT_CLASS_NAME
    : MARKDOWN_TEXT_CLASS_NAME;
};

export interface MarkdownBlockquoteProps {
  children?: ReactNode;
  /*
   * What react-markdown hands over; "data-callout" is set by
   * remarkMarkdownCallouts on a blockquote that asked to be a callout.
   */
  [attribute: string]: unknown;
}

const MarkdownBlockquote: FunctionComponent<MarkdownBlockquoteProps> = (
  props: MarkdownBlockquoteProps,
): ReactElement => {
  const { t } = useTranslation();
  const kind: MarkdownCalloutKind | null = getMarkdownCalloutKind(
    props[MARKDOWN_CALLOUT_ATTRIBUTE],
  );

  /*
   * The way the quote's words read (MarkdownReadingDirection), so its rule,
   * or its callout's icon, stands where its lines start.
   */
  const dir: string | undefined =
    typeof props["dir"] === "string" ? props["dir"] : undefined;

  if (!kind) {
    return (
      <MarkdownQuoteContext.Provider value={true}>
        <blockquote className={MARKDOWN_QUOTE_CLASS_NAME} dir={dir}>
          {props.children}
        </blockquote>
      </MarkdownQuoteContext.Provider>
    );
  }

  const style: MarkdownCalloutStyle = MARKDOWN_CALLOUT_STYLES[kind];

  /*
   * Still a <blockquote>, with its kind on it: a copy of the note keeps it a
   * quote, and MarkdownPaste writes the marker back in front of it.
   */
  return (
    <MarkdownQuoteContext.Provider value={false}>
      <blockquote
        className={`${MARKDOWN_CALLOUT_CLASS_NAME} ${style.panel}`}
        dir={dir}
        role="note"
        aria-label={getMarkdownCalloutName(t, kind)}
        data-callout={kind}
      >
        <svg
          className={`mt-0.5 h-5 w-5 flex-none ${style.icon}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
          data-markdown-ignore="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d={style.iconPath}
          />
        </svg>
        <div className={MARKDOWN_CALLOUT_BODY_CLASS_NAME}>{props.children}</div>
      </blockquote>
    </MarkdownQuoteContext.Provider>
  );
};

export default MarkdownBlockquote;

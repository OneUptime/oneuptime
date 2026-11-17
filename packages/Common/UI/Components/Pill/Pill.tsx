import { Gray500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import Icon, { ThickProp } from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, { CSSProperties, FunctionComponent, ReactElement } from "react";
import Tooltip from "../Tooltip/Tooltip";
import { GetReactElementFunction } from "../../Types/FunctionTypes";
import {
  getPillColors,
  getPillDotStyle,
  getPillHollowDotStyle,
  getPillToneStyle,
  PillColors,
} from "./PillColors";
import { getPillToneColor, PillTone } from "./PillTone";
import useTranslateValue from "../../Utils/Translation";
import { getLineDirection } from "../../Utils/LineDirection";
import { ReadingDirection } from "../../../Types/ReadingDirection";

export enum PillSize {
  Small = "10px",
  Normal = "13px",
  Large = "15px",
  ExtraLarge = "18px",
}

export interface ComponentProps {
  text: string;
  /*
   * HOW ITS TEXT READS, BY THE RULE A DROPDOWN'S OPTION READS BY
   * (DropdownOption.isUserContent). Left out, the text is the product's own
   * words in English, looked up in the reader's language: "Active",
   * "Paid". Set, it is drawn as given, never looked up: a name - a label's,
   * a monitor's, a state a project named itself - or words the caller
   * already put in the reader's language. A label named "Network" read
   * "Red" on a Spanish page, and a state named "Open" the verb "Abrir".
   * A state's, a severity's or a status's name reads by
   * Common/Utils/DefaultRecordNames: OneUptime's default names looked up,
   * the project's own as written (isRecordNameAsWritten).
   */
  isUserContent?: boolean | undefined;
  /*
   * What the chip says about how something is doing (PillTone): Success,
   * Warning, Danger, Info, Neutral, or Paused for a state someone chose to
   * switch off. A status chip names its tone; a colour someone picked (a
   * label's, a state's, a severity's) is passed as `color` instead, which
   * wins. Neither: Neutral.
   */
  tone?: PillTone | undefined;
  color?: Color | undefined;
  size?: PillSize | undefined;
  style?: CSSProperties;
  isMinimal?: boolean | undefined;
  // Its hover tip, in English: looked up where it is drawn.
  tooltip?: string | undefined;
  /*
   * The hover tip reads by the same rule as the text (isUserContent): set,
   * it is drawn as given, never looked up (Tooltip's isTextUserContent) -
   * words someone wrote, as a label's description is its owner's, or words
   * the caller already put in the reader's language. A label described
   * "Status" read "Estado" on a Spanish page (#8067).
   */
  isTooltipUserContent?: boolean | undefined;
  icon?: IconProp | undefined;
  /*
   * Whether the icon turns round on a page read right to left (Icon's
   * isMirroredRightToLeft). Left out, the icons that point along the line
   * (a chevron, an arrow) do and every other keeps its shape; true turns
   * one that means "on to what comes next" without being one of them - the
   * escalation steps' Forward - so it points the way an Arabic or Persian
   * page's words run; false keeps an arrow that means a fixed side.
   */
  isIconMirroredRightToLeft?: boolean | undefined;
  /*
   * A ring ripples out of the dot, over and over: "this is happening right
   * now". Only while motion is welcome - under prefers-reduced-motion the dot
   * stays still and the text alone says it. Ignored when `icon` replaces the
   * dot.
   */
  isPulsing?: boolean | undefined;
  /*
   * Words too long for the room run onto a next line inside the pill,
   * rather than end in "..." with the whole of them under the pointer -
   * for where nothing points: a phone's card (a record's labels in a
   * table's row on a phone). A pill of one line looks as any other.
   */
  isWrapping?: boolean | undefined;
  /*
   * With isWrapping: its words run onto a next line between one another,
   * never broken inside one - a state's few words in a table's column,
   * which is then at least as wide as the longest of them. A label's one
   * long key and value still breaks where it must (isWrapping alone): in a
   * column held at 8rem, a Russian connection's Health read
   * "приостановле / но" (#6891).
   */
  isKeepingWordsWhole?: boolean | undefined;
  /*
   * No dot: a tag or a count that is not a state ("Beta", "3 rules"), where
   * a dot would say "this is live". An icon still shows.
   */
  isDotHidden?: boolean | undefined;
  // Where it sits in its row (a margin, flex-shrink-0), never its look.
  className?: string | undefined;
  // What a test or a page finds it by; "pill" when left out.
  dataTestId?: string | undefined;
}

/*
 * Spacing is in em, so each size is the same pill scaled: a Small pill in a
 * dense table and an ExtraLarge one in a page header keep their proportions.
 *
 * Every pill in the product is this one shape - a label, a state, a yes/no
 * (Detail/BooleanValue) and a choice (Dropdown/DropdownValueBadge) - so a
 * card that shows all of them shows one pill, not three: the yes/no was a
 * 14px pill and a choice a 12px rounded-corner badge beside 13px labels.
 */
export const PILL_CLASS_NAME: string =
  "inline-flex max-w-full items-center gap-[0.4em] rounded-full px-[0.6em] py-[0.2em] font-medium leading-[1.35]";

// Its dot: half its text's size, the colour itself.
export const PILL_DOT_CLASS_NAME: string =
  "h-[0.5em] w-[0.5em] flex-shrink-0 rounded-full";

/*
 * A pill whose words may run onto a next line: its dot on the first line,
 * and corners as round as a one-line pill's (half its 1.75em height), so a
 * pill of two lines is a rounded box, not a stadium, and one of one line is
 * the pill above.
 */
export const WRAPPING_PILL_CLASS_NAME: string =
  "inline-flex max-w-full items-start gap-[0.4em] rounded-[0.875em] px-[0.6em] py-[0.2em] font-medium leading-[1.35]";

// Its dot, centred on the first line: (1.35em - 0.5em) / 2 above it.
export const WRAPPING_PILL_DOT_CLASS_NAME: string = "mt-[0.425em]";

// And an icon in the dot's place: (1.35em - 1em) / 2 above it.
export const WRAPPING_PILL_ICON_CLASS_NAME: string = "mt-[0.175em]";

export const PILL_TEXT_CLASS_NAME: string = "min-w-0 truncate";

export const WRAPPING_PILL_TEXT_CLASS_NAME: string =
  "min-w-0 whitespace-normal [overflow-wrap:anywhere]";

/*
 * A wrapping pill's words when they are kept whole (isKeepingWordsWhole):
 * break-word, unlike anywhere, leaves the pill's narrowest width that of
 * its longest word, so a table never squeezes it below that; a word wider
 * than all the room there is still breaks rather than spill out.
 */
export const WHOLE_WORDS_PILL_TEXT_CLASS_NAME: string =
  "min-w-0 whitespace-normal [overflow-wrap:break-word]";

const Pill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const tone: PillTone | undefined = props.color
    ? undefined
    : props.tone || PillTone.Neutral;
  const colors: PillColors = getPillColors(
    props.color || (tone ? getPillToneColor(tone) : Gray500),
  );
  const { translateString, language } = useTranslateValue();
  const text: string = props.isUserContent
    ? props.text
    : translateString(props.text) ?? props.text;
  /*
   * Its words read their own way where that is not the page's: a label a
   * team named in English, on an Arabic page, is cut short at its own end
   * ("Production EU W...") and keeps its punctuation in place, while its
   * dot stays at the page's start (LineDirection).
   */
  const textDirection: ReadingDirection | undefined = getLineDirection(
    text,
    language,
  );

  const getPillElement: GetReactElementFunction = (): ReactElement => {
    return (
      <span
        data-testid={props.dataTestId || "pill"}
        data-ou-pill={props.isMinimal ? undefined : ""}
        data-tone={tone}
        /*
         * Its words end in "..." where its box ends, so a table that would
         * run past its card may narrow it (TableLayout's
         * TABLE_SHRINKABLE_ATTRIBUTE); a pill that wraps does not.
         */
        data-table-shrinks={props.isWrapping ? undefined : "true"}
        className={`${
          props.isWrapping ? WRAPPING_PILL_CLASS_NAME : PILL_CLASS_NAME
        } ${
          props.isMinimal ? "text-gray-700 ring-1 ring-inset ring-gray-200" : ""
        }${props.className ? ` ${props.className}` : ""}`}
        style={{
          fontSize: props.size ? props.size.toString() : PillSize.Normal,
          // A minimal pill is a neutral outline: its classes colour it.
          ...(props.isMinimal ? {} : getPillToneStyle(colors, props.style)),
          ...props.style,
        }}
      >
        {props.icon ? (
          <Icon
            icon={props.icon}
            isMirroredRightToLeft={props.isIconMirroredRightToLeft}
            thick={ThickProp.Thick}
            className={`h-[1em] w-[1em] flex-shrink-0${
              props.isWrapping ? ` ${WRAPPING_PILL_ICON_CLASS_NAME}` : ""
            }`}
          />
        ) : props.isPulsing ? (
          /*
           * The dot, with a copy of itself behind it that grows and fades.
           * Both are painted like the plain dot, so the dark theme swaps both.
           */
          <span
            data-testid="pill-dot"
            data-pulsing="true"
            className={`relative inline-flex h-[0.5em] w-[0.5em] flex-shrink-0${
              props.isWrapping ? ` ${WRAPPING_PILL_DOT_CLASS_NAME}` : ""
            }`}
            aria-hidden="true"
          >
            <span
              data-testid="pill-dot-pulse"
              data-ou-pill-dot=""
              className="absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping"
              style={getPillDotStyle(colors)}
            ></span>
            <span
              data-ou-pill-dot=""
              className="relative inline-flex h-full w-full rounded-full"
              style={getPillDotStyle(colors)}
            ></span>
          </span>
        ) : props.isDotHidden ? (
          <></>
        ) : tone === PillTone.Paused ? (
          // A light that is off: a ring, nothing inside (PillTone.Paused).
          <span
            data-testid="pill-dot"
            data-hollow="true"
            data-ou-pill-hollow-dot=""
            className={`${PILL_DOT_CLASS_NAME}${
              props.isWrapping ? ` ${WRAPPING_PILL_DOT_CLASS_NAME}` : ""
            }`}
            style={getPillHollowDotStyle(colors)}
            aria-hidden="true"
          ></span>
        ) : (
          <span
            data-testid="pill-dot"
            data-ou-pill-dot=""
            className={`${PILL_DOT_CLASS_NAME}${
              props.isWrapping ? ` ${WRAPPING_PILL_DOT_CLASS_NAME}` : ""
            }`}
            style={getPillDotStyle(colors)}
            aria-hidden="true"
          ></span>
        )}
        <span
          data-testid="pill-text"
          dir={textDirection}
          className={
            props.isWrapping
              ? props.isKeepingWordsWhole
                ? WHOLE_WORDS_PILL_TEXT_CLASS_NAME
                : WRAPPING_PILL_TEXT_CLASS_NAME
              : PILL_TEXT_CLASS_NAME
          }
          onMouseEnter={(event: React.MouseEvent<HTMLSpanElement>) => {
            /*
             * A pill stays on one line and ellipsizes in a container too
             * narrow for it, so the cut-short ones show their whole text on
             * hover. A pill with a tooltip already has hover text.
             */
            const textElement: HTMLSpanElement = event.currentTarget;

            if (
              !props.tooltip &&
              textElement.scrollWidth > textElement.clientWidth
            ) {
              textElement.title = text;
            } else {
              textElement.removeAttribute("title");
            }
          }}
        >
          {text}
        </span>
      </span>
    );
  };

  if (props.tooltip) {
    return (
      <Tooltip
        text={props.tooltip}
        isTextUserContent={props.isTooltipUserContent}
      >
        {getPillElement()}
      </Tooltip>
    );
  }

  return getPillElement();
};

export default Pill;

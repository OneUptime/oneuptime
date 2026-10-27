import IconProp from "../../../Types/Icon/IconProp";
import bringIntoView from "../../Utils/BringIntoView";
import { getListSeparator } from "../../Utils/ListSeparator";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Icon from "../Icon/Icon";
import {
  FoldedSectionItem,
  FoldedSectionItemsShown,
  getFoldedSectionItemsShown,
} from "./FoldedSectionItem";
import {
  FOLDED_SECTION_LINE,
  FoldedSectionVariant,
  getFoldedSectionVariant,
} from "./FoldedSectionVariant";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/*
 * A fold: options most people never need, out of the way until someone
 * opens them - a form's "More fields" (Forms/Utils/AdvancedFormSection,
 * MoreFieldsSection), a page's "More settings" (AdvancedPageSection), and
 * every other folded section a form draws (CollapsibleFormSection).
 *
 * Folded, its header says what is inside without being opened:
 *   - the fields or cards it holds, by name, a few of them and how many
 *     more;
 *   - the ones that are set, with what they are set to ("Labels: 2",
 *     "Private Incident: On"), so nothing in force is hidden;
 *   - what its defaults do, in a sentence, where the section says so ("The
 *     key expires a year from today.").
 * Open, it shows its description instead, and the fields.
 *
 * It is drawn one of two ways (FoldedSectionVariant):
 *   - a card (the default): a framed block, its title beside an icon tile,
 *     what is inside as pills under it, the set ones as indigo chips, and a
 *     chevron at its end - a page's More settings, among the page's cards,
 *     and a form's sections named for what they hold;
 *   - a line: no frame, no tile, no pills - a small chevron, the title as a
 *     quiet link, and what is inside after it, the set ones a shade darker:
 *     "More fields · Description, Labels: 2". Open, the fields follow the
 *     line as part of the form. Every form's More fields: the maintainer,
 *     on the card it was - "Can we make this more subtle, this needs to be
 *     done across the project for more fields. Takes up too much real
 *     estate right now."
 *
 * Either way the header is a real button: Tab reaches it, Enter and Space
 * open it, aria-expanded says which way it is, its name is the title alone,
 * and what is inside is its description for a screen reader. Folded, the
 * body stays mounted (fields keep what was typed) but is invisible, so
 * nothing in it can be tabbed to or read out. It works the same in the dark
 * theme (Theme.css remaps every colour class used here), at phone width
 * (the lines wrap; the chevron keeps its place) and right to left (the
 * line's chevron points left while it is folded).
 *
 * On a phone a card's sides are 12px, not 16 (from sm up): a card is often
 * nested in other cards there - a monitor criteria's alert form sits in
 * four - and each one's padding came off the width its fields have.
 *
 * Opened by the reader, it brings itself into view (Utils/BringIntoView):
 * a More fields line at the bottom of a dialog opened its fields below the
 * dialog's edge, so pressing it seemed to do nothing. Only as far as
 * needed: a fold that fits stays where it is, one below the view comes up
 * until its last field is in sight, and one taller than the view keeps its
 * header at the top - each a little room (scroll-my-4) from the edge. A fold opened for the reader by something else - a
 * field in it that failed - is brought into view by what opened it.
 */

export const FOLDED_SECTION_TEST_ID: string = "folded-section";

export interface ComponentProps {
  // English; looked up when drawn.
  title: string;
  /*
   * "card" when left out: a framed block. "line": one quiet line. A fold
   * titled More fields is always the line (FoldedSectionVariant).
   */
  variant?: FoldedSectionVariant | undefined;
  // Drawn in a tile before the title: what kind of section it is (cards only).
  icon?: IconProp | undefined;
  // Under the title while open.
  description?: string | ReactElement | undefined;
  /*
   * Folded: what is inside, and what each set one is set to - a line's
   * names, a card's pills and chips.
   */
  items?: Array<FoldedSectionItem> | undefined;
  /*
   * Folded: what the section is set to or what its defaults do, as whole
   * sentences - English (looked up here) or already translated.
   */
  summary?: string | ReactElement | undefined;
  /*
   * Folded: one short word beside what is inside ("Configured") - for a
   * section that knows something in it is set but not what.
   */
  badge?: string | undefined;
  /*
   * Controlled: drawn as the prop says, in the same render it changes in -
   * so a form that opens a section for a field in error can bring the field
   * into view as it is drawn. A press asks onToggle. Left out, the section
   * keeps its own state, starting as defaultCollapsed.
   */
  isCollapsed?: boolean | undefined;
  // True when left out: a fold starts folded.
  defaultCollapsed?: boolean | undefined;
  onToggle?: ((isCollapsed: boolean) => void) | undefined;
  // A block of its own on a page, among cards: a card's shadow.
  isElevated?: boolean | undefined;
  /*
   * The body holds sections (Card/CardSections) that pad themselves and draw
   * the divider above each one: the body adds no padding and no rule of its
   * own, and its bottom is rounded with the frame's, so the last section -
   * a table's grey footer too - ends on the frame's curve.
   */
  isBodyFlush?: boolean | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
  children: ReactNode;
}

const FoldedSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [ownIsCollapsed, setOwnIsCollapsed] = useState<boolean>(
    props.isCollapsed ?? props.defaultCollapsed ?? true,
  );

  const isCollapsed: boolean =
    props.isCollapsed !== undefined ? props.isCollapsed : ownIsCollapsed;

  const rootRef: MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

  // Set by a press that opens the fold, until it has been brought into view.
  const isOpeningForReader: MutableRefObject<boolean> = useRef<boolean>(false);

  const toggle: () => void = (): void => {
    const next: boolean = !isCollapsed;
    isOpeningForReader.current = !next;
    setOwnIsCollapsed(next);
    props.onToggle?.(next);
  };

  /*
   * Once what the press opened is drawn, before it is painted: the fold
   * comes into view as it opens.
   */
  useLayoutEffect(() => {
    if (isCollapsed || !isOpeningForReader.current) {
      return;
    }

    isOpeningForReader.current = false;
    bringIntoView(rootRef.current);
  }, [isCollapsed]);

  const id: string = useId();
  const titleId: string = `folded-section-title-${id}`;
  const bodyId: string = `folded-section-body-${id}`;
  const contentsId: string = `folded-section-contents-${id}`;
  const summaryId: string = `folded-section-summary-${id}`;
  const descriptionId: string = `folded-section-description-${id}`;

  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) ?? text;
  };

  const { shown, hiddenCount }: FoldedSectionItemsShown =
    getFoldedSectionItemsShown(props.items || []);

  const hasSetItem: boolean = shown.some((item: FoldedSectionItem) => {
    return item.isSet;
  });

  const showContents: boolean = isCollapsed && shown.length > 0;
  const showSummary: boolean = Boolean(isCollapsed && props.summary);
  const showBadge: boolean = Boolean(isCollapsed && props.badge);
  const showDescription: boolean = Boolean(!isCollapsed && props.description);

  const describedBy: Array<string> = [];

  if (showContents || showBadge) {
    describedBy.push(contentsId);
  }

  if (showSummary) {
    describedBy.push(summaryId);
  }

  if (showDescription) {
    describedBy.push(descriptionId);
  }

  // An item as it reads: its name, and what a set one is set to.
  const getItemWords: (item: FoldedSectionItem) => {
    title: string;
    value: string | undefined;
  } = (
    item: FoldedSectionItem,
  ): { title: string; value: string | undefined } => {
    return {
      title: translate(item.title),
      value:
        item.isSet && item.value
          ? item.translateValue
            ? translate(item.value)
            : item.value
          : undefined,
    };
  };

  const moreText: string = translator.translatePlural(
    { one: "{{count}} more", other: "{{count}} more" },
    hiddenCount,
  );

  const badgeText: string = translate(props.badge || "");

  /*
   * What goes between two things listed, the way their script writes it
   * (Utils/ListSeparator): "Description, Labels", "説明、ラベル",
   * "توضیحات، برچسب‌ها". The names decide - not what a value or "3 more"
   * is written in - so names a locale has not translated keep their English
   * commas.
   */
  const listSeparator: string = getListSeparator(
    shown.map((item: FoldedSectionItem): string => {
      return getItemWords(item).title;
    }),
  );

  /*
   * Between two things listed: the pills are apart on screen already; a
   * screen reader hears the separator, so the names are not read as one.
   */
  const renderSeparator: () => ReactElement = (): ReactElement => {
    return <span className="sr-only">{listSeparator}</span>;
  };

  const renderItem: (item: FoldedSectionItem) => ReactElement = (
    item: FoldedSectionItem,
  ): ReactElement => {
    const { title, value }: { title: string; value: string | undefined } =
      getItemWords(item);

    if (!item.isSet) {
      return (
        <span
          data-testid="folded-section-item"
          data-item-key={item.key}
          data-item-set="false"
          className="inline-flex min-w-0 max-w-full items-center rounded-full px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200"
        >
          <span className="truncate">{title}</span>
        </span>
      );
    }

    return (
      <span
        data-testid="folded-section-item"
        data-item-key={item.key}
        data-item-set="true"
        className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 flex-none rounded-full bg-indigo-500"
        />
        <span className="truncate">
          {title}
          {value ? (
            <>
              {": "}
              <span className="font-normal">{value}</span>
            </>
          ) : (
            <></>
          )}
        </span>
      </span>
    );
  };

  const variant: FoldedSectionVariant = getFoldedSectionVariant({
    title: props.title,
    variant: props.variant,
  });

  if (variant === FOLDED_SECTION_LINE) {
    /*
     * What is inside, as words: the names in grey, and each one that is
     * set as its name and value a shade darker and medium ("Labels: 2"),
     * so what is in force still stands out without a chip - and still a
     * step quieter than the form's own field labels (text-gray-700).
     */
    const renderLineItem: (item: FoldedSectionItem) => ReactElement = (
      item: FoldedSectionItem,
    ): ReactElement => {
      const { title, value }: { title: string; value: string | undefined } =
        getItemWords(item);

      if (!item.isSet) {
        return (
          <span
            data-testid="folded-section-item"
            data-item-key={item.key}
            data-item-set="false"
          >
            {title}
          </span>
        );
      }

      return (
        <span
          data-testid="folded-section-item"
          data-item-key={item.key}
          data-item-set="true"
          className="font-medium text-gray-600"
        >
          {title}
          {value ? `: ${value}` : ""}
        </span>
      );
    };

    // What the folded line lists after its title, in order.
    const lineEntries: Array<ReactElement> = [];

    if (showContents) {
      for (const item of shown) {
        lineEntries.push(renderLineItem(item));
      }

      if (hiddenCount > 0) {
        lineEntries.push(
          <span data-testid="folded-section-more">{moreText}</span>,
        );
      }
    }

    if (showBadge) {
      lineEntries.push(
        <span
          className="font-medium text-gray-600"
          data-testid="folded-section-badge"
        >
          {badgeText}
        </span>,
      );
    }

    /*
     * The separator's mark goes with the entry before it ("Labels,"), and
     * the space after it - where the script writes one - between the two:
     * "説明、ラベル" has none.
     */
    const listMark: string = listSeparator.trimEnd();
    const listSpace: string = listSeparator.endsWith(" ") ? " " : "";

    const showAfterTitle: boolean =
      showContents || showBadge || showDescription;

    return (
      <div
        ref={rootRef}
        className={`min-w-0 scroll-my-4 ${props.className || ""}`}
        data-testid={props.dataTestId || FOLDED_SECTION_TEST_ID}
        data-collapsed={isCollapsed ? "true" : "false"}
        data-variant={variant}
      >
        {/*
         * One button holds the whole line - the chevron, the title, what is
         * inside and the sentences under them - so a click on anything it
         * says opens it. It is as wide as what it says, not the form: the
         * empty space beside it is not a control.
         */}
        <button
          type="button"
          className="group -mx-1 inline-flex max-w-full items-start gap-1 rounded-md px-1 py-0.5 text-start text-sm leading-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          onClick={toggle}
          aria-expanded={!isCollapsed}
          aria-controls={bodyId}
          aria-labelledby={titleId}
          aria-describedby={
            describedBy.length > 0 ? describedBy.join(" ") : undefined
          }
          data-testid="folded-section-header"
        >
          {/*
           * Points at the line's end - the way it opens - and turns down
           * once it is open; in a right-to-left page it points left (Icon
           * mirrors a chevron there).
           */}
          <span
            aria-hidden="true"
            className="flex h-6 flex-none items-center text-indigo-500 transition-colors duration-150 group-hover:text-indigo-700"
            data-testid="folded-section-chevron"
          >
            <Icon
              icon={IconProp.ChevronRight}
              className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${
                isCollapsed ? "" : "rotate-90"
              }`}
            />
          </span>

          <span className="min-w-0">
            <span className="block break-words">
              {/*
               * The title keeps the dot after it on its line; the list may
               * wrap onto the next, under the title.
               */}
              <span className="whitespace-nowrap">
                {/*
                 * A quiet link, as the product's others are: indigo, and
                 * underlined under the pointer - the cue the dark theme
                 * keeps, where both indigos are one colour.
                 */}
                <span
                  id={titleId}
                  className="font-medium text-indigo-600 underline-offset-2 transition-colors duration-150 group-hover:text-indigo-800 group-hover:underline"
                  data-testid="folded-section-title"
                >
                  {translate(props.title)}
                </span>

                {showAfterTitle ? (
                  <span
                    aria-hidden="true"
                    className="pe-0.5 ps-1.5 text-gray-400"
                  >
                    ·
                  </span>
                ) : (
                  <></>
                )}
              </span>

              {showAfterTitle ? " " : ""}

              {showContents || showBadge ? (
                <span
                  id={contentsId}
                  className="text-gray-500"
                  data-testid="folded-section-contents"
                >
                  {lineEntries.map(
                    (entry: ReactElement, index: number): ReactElement => {
                      /*
                       * Each entry wraps to the next line whole - "Initial
                       * State: Identified," or "3 more" is never cut in two
                       * - unless it is longer than a line by itself.
                       */
                      return (
                        <Fragment key={index}>
                          {index > 0 ? listSpace : ""}
                          <span className="inline-block max-w-full">
                            {entry}
                            {index < lineEntries.length - 1 ? listMark : ""}
                          </span>
                        </Fragment>
                      );
                    },
                  )}
                </span>
              ) : (
                <></>
              )}

              {showDescription ? (
                <span
                  id={descriptionId}
                  className="text-gray-500"
                  data-testid="folded-section-description"
                >
                  {typeof props.description === "string"
                    ? translate(props.description)
                    : props.description}
                </span>
              ) : (
                <></>
              )}
            </span>

            {showSummary ? (
              <span
                id={summaryId}
                className="block break-words text-sm leading-5 text-gray-500"
                data-testid="collapsible-section-summary"
              >
                {typeof props.summary === "string"
                  ? translate(props.summary)
                  : props.summary}
              </span>
            ) : (
              <></>
            )}
          </span>
        </button>

        {/*
         * Open, the fields follow the line as part of the form - no frame,
         * no padding of their own - and nothing clips them (an input's
         * focus ring reaches past its edge). Folded, they are out of sight
         * and reach (invisible: no tab stops, nothing read out) but
         * mounted, so they keep what was typed.
         */}
        <div
          id={bodyId}
          className={`duration-150 ease-in-out motion-reduce:transition-none ${
            isCollapsed
              ? "max-h-0 overflow-hidden opacity-0 invisible transition-all"
              : "opacity-100 transition-opacity"
          }`}
          data-testid="folded-section-body"
        >
          <div className="pt-3">{props.children}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`scroll-my-4 border border-gray-200 bg-white transition-colors duration-150 ${
        props.isElevated ? "rounded-xl shadow-sm" : "rounded-lg"
      } ${props.className || ""}`}
      data-testid={props.dataTestId || FOLDED_SECTION_TEST_ID}
      data-collapsed={isCollapsed ? "true" : "false"}
      data-variant={variant}
    >
      <button
        type="button"
        className={`flex w-full items-start gap-3 text-left transition-colors duration-150 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
          props.isElevated ? "px-5 py-4 md:px-6" : "px-3 py-3 sm:px-4"
        } ${
          props.isElevated
            ? isCollapsed
              ? "rounded-xl"
              : "rounded-t-xl"
            : isCollapsed
              ? "rounded-lg"
              : "rounded-t-lg"
        }`}
        onClick={toggle}
        aria-expanded={!isCollapsed}
        aria-controls={bodyId}
        aria-labelledby={titleId}
        aria-describedby={
          describedBy.length > 0 ? describedBy.join(" ") : undefined
        }
        data-testid="folded-section-header"
      >
        {props.icon ? (
          <span
            aria-hidden="true"
            className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-md transition-colors duration-150 ${
              hasSetItem
                ? "bg-indigo-50 text-indigo-600"
                : "bg-gray-100 text-gray-500"
            }`}
            data-testid="folded-section-icon"
          >
            <Icon icon={props.icon} className="h-4 w-4" />
          </span>
        ) : (
          <></>
        )}

        <span className="min-w-0 flex-1">
          <span
            id={titleId}
            className="block text-sm font-medium leading-6 text-gray-900"
            data-testid="folded-section-title"
          >
            {translate(props.title)}
          </span>

          {showDescription ? (
            <span
              id={descriptionId}
              className="mt-0.5 block text-sm text-gray-500"
              data-testid="folded-section-description"
            >
              {typeof props.description === "string"
                ? translate(props.description)
                : props.description}
            </span>
          ) : (
            <></>
          )}

          {showContents || showBadge ? (
            <span
              id={contentsId}
              className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs leading-5 text-gray-500"
              data-testid="folded-section-contents"
            >
              {shown.map(
                (item: FoldedSectionItem, index: number): ReactElement => {
                  return (
                    <Fragment key={item.key}>
                      {index > 0 ? renderSeparator() : <></>}
                      {renderItem(item)}
                    </Fragment>
                  );
                },
              )}
              {showContents && hiddenCount > 0 ? (
                <>
                  {renderSeparator()}
                  <span
                    className="px-1 font-medium"
                    data-testid="folded-section-more"
                  >
                    {moreText}
                  </span>
                </>
              ) : (
                <></>
              )}
              {showBadge ? (
                <>
                  {showContents ? renderSeparator() : <></>}
                  <span
                    className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                    data-testid="folded-section-badge"
                  >
                    {badgeText}
                  </span>
                </>
              ) : (
                <></>
              )}
            </span>
          ) : (
            <></>
          )}

          {showSummary ? (
            <span
              id={summaryId}
              className="mt-1 block break-words text-sm leading-5 text-gray-600"
              data-testid="collapsible-section-summary"
            >
              {typeof props.summary === "string"
                ? translate(props.summary)
                : props.summary}
            </span>
          ) : (
            <></>
          )}
        </span>

        <span
          aria-hidden="true"
          className="mt-1 flex-none text-gray-400"
          data-testid="folded-section-chevron"
        >
          <Icon
            icon={IconProp.ChevronDown}
            className={`h-5 w-5 transition-transform duration-200 motion-reduce:transition-none ${
              isCollapsed ? "" : "-rotate-180"
            }`}
          />
        </span>
      </button>

      {/*
       * Folded, the body is out of sight (max-h-0, opacity-0) and out of
       * reach (invisible: no tab stops, nothing read out), but mounted. A
       * transition follows the property list of the state it goes to:
       * folding transitions visibility with the rest, so it turns invisible
       * once the fold has finished; opening leaves it out, so the fields can
       * be tabbed to at once (CollapsibleSection does the same).
       *
       * Open, nothing caps its height, as the line's body: a fold can hold
       * a whole guide - the Microsoft Teams setup guide is taller than
       * 5,000 pixels on a desktop and twice that on a phone - and a cap
       * (max-h-[5000px], with overflow-hidden for the rounded corners) cut
       * its last sections off with nothing to scroll to.
       */}
      <div
        id={bodyId}
        className={`overflow-hidden duration-200 ease-in-out motion-reduce:transition-none ${
          isCollapsed
            ? "max-h-0 opacity-0 invisible transition-all"
            : "opacity-100 transition-opacity"
        }${
          props.isBodyFlush
            ? props.isElevated
              ? " rounded-b-xl"
              : " rounded-b-lg"
            : ""
        }`}
        data-testid="folded-section-body"
      >
        <div
          className={
            props.isBodyFlush
              ? ""
              : `border-t border-gray-200 ${
                  props.isElevated
                    ? "px-5 py-5 md:px-6"
                    : "px-3 py-3 sm:px-4 sm:py-4"
                }`
          }
        >
          {props.children}
        </div>
      </div>
    </div>
  );
};

export default FoldedSection;

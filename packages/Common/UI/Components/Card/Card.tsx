import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import ShortcutKey from "../ShortcutKey/ShortcutKey";
import { CardGridCellContext, useIsCardGridCell } from "./CardGridCell";
import { useIsCardSection } from "./CardSurface";
import IconProp from "../../../Types/Icon/IconProp";
import {
  PAGE_ANCHOR_SCROLL_MARGIN_TOP,
  PAGE_ANCHOR_SECTION_SCROLL_MARGIN_TOP,
} from "../../Utils/PageAnchor";
import useTranslateValue from "../../Utils/Translation";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useRef,
  useState,
} from "react";

export interface CardButtonSchema {
  title: string;
  buttonStyle?: ButtonStyleType | undefined;
  onClick: () => void;
  disabled?: boolean | undefined;
  /*
   * Shown on hover. The reason a disabled button is disabled belongs here -
   * Button keeps a disabled button hoverable precisely so this can be read.
   */
  tooltip?: string | undefined;
  icon: IconProp;
  isLoading?: undefined | boolean;
  className?: string | undefined;
  shortcutKey?: undefined | ShortcutKey;
  buttonSize?: ButtonSize | undefined;
}

/*
 * Where a card's actions go. Whatever the layout, what a card offers - Edit,
 * Create, the ⋯ menu, a status badge, a picker - sits at the RIGHT edge of
 * the header, on the title's line ("Why are edit buttons not on the right?").
 * When it does not fit there it moves onto a line of its own, still at the
 * right edge - in the stacked and toolbar headers after the description,
 * which stays right under the title. It is never centred across the header,
 * and never put at the left.
 *
 * How the header shares its width:
 *
 * "default" is for a card as wide as the page's content: the title and the
 * description on the left, the actions beside them on the right, their top
 * level with the title's. Below md the description is hidden, and the title
 * and the actions share a line the way the stacked header's do.
 *
 * "stacked" is for a narrow column (the one-third sidebar of an overview
 * page, or a card whose header holds a row of controls). Beside the actions
 * the description would be squeezed into a column a word or two wide, so the
 * title and the actions share the first line and the description runs under
 * both, across the card's whole width - right under the title, as it is in
 * a card with no actions: the controls are centred on the title's line and
 * reach past it rather than pushing the description a button row down, and
 * the title stays at the card's padding, level with its neighbours'
 * (CARD_HEADER_TITLE_LINE_CLASS_NAMES).
 *
 * "toolbar" is the stacked header for a card as wide as the page whose
 * actions are a row of controls - a table's search, its saved views, its
 * main button and ⋯. The title and the controls share the first line, and
 * the description runs under both; but where the stacked header keeps half
 * the line for the title, this one keeps only what a title needs (12rem), so
 * a table's controls stay beside its title until they really do not fit,
 * rather than dropping to a line of their own the moment a filter brings
 * the Saved Views button in.
 */
export type CardHeaderLayout = "default" | "stacked" | "toolbar";

/*
 * Every layout, for the tests that hold each of them to the rule above: a
 * Record, so a layout added to the type cannot be left out of the list.
 */
const CARD_HEADER_LAYOUT_SET: Record<CardHeaderLayout, true> = {
  default: true,
  stacked: true,
  toolbar: true,
};

export const CARD_HEADER_LAYOUTS: ReadonlyArray<CardHeaderLayout> = Object.keys(
  CARD_HEADER_LAYOUT_SET,
) as Array<CardHeaderLayout>;

export interface ComponentProps {
  title?: string | ReactElement | undefined;
  description?: string | ReactElement | undefined;
  buttons?: undefined | Array<CardButtonSchema | ReactElement>;
  children?: undefined | Array<ReactElement> | ReactElement;
  className?: string | undefined;
  bodyClassName?: string | undefined;
  rightElement?: ReactElement | undefined;
  headerLayout?: CardHeaderLayout | undefined;
  /*
   * The card is as tall as the box it is in, and its body takes the height
   * the header leaves - for cards that share a grid row, so the row ends on
   * one line instead of leaving the page showing under the shorter card.
   * The box gives the height: a grid cell is as tall as its row. The body
   * is a column, so what is in it can grow into the room (flex-1) or sit in
   * its middle. The card adds no gap under itself: the box's parent spaces
   * its cards. A card drawn as a section of another card ignores it: the
   * card it is in has the height. The card of a CardGrid cell fills it
   * unless this says false.
   */
  fillHeight?: boolean | undefined;
  /*
   * The card's header is drawn by what holds it: a fold whose title names
   * the table inside it (the Archived section of a value's settings page,
   * useArchivableValues). The card draws no header of its own - not even an
   * empty one - and its body starts at its top edge, under the divider of
   * the section it is.
   */
  isHeaderHidden?: boolean | undefined;
  /*
   * The card's place on its page (Utils/PageAnchor): a link to the page
   * that names it after its "#" lands on the card, its top clear of the
   * page's sticky header - and opens the More settings it is in. A plain
   * name, unique on the page ("runner").
   */
  id?: string | undefined;
}

/*
 * What a card with a place of its own on the page (`id`) carries, so a link
 * to it lands with the card's top under the sticky header, not behind it:
 * a card of its own with the page's gap above its frame, a section of a
 * card (one of More settings') with its divider right under the header.
 */
const getCardAnchorStyle: (
  id: string | undefined,
  isSection: boolean,
) => React.CSSProperties | undefined = (
  id: string | undefined,
  isSection: boolean,
): React.CSSProperties | undefined => {
  if (!id) {
    return undefined;
  }

  return {
    scrollMarginTop: isSection
      ? PAGE_ANCHOR_SECTION_SCROLL_MARGIN_TOP
      : PAGE_ANCHOR_SCROLL_MARGIN_TOP,
  };
};

/*
 * The header's class names, exported so the layout tests and the guard
 * (Common/Tests/UI/Components/CardHeaderActionsGuard.test.tsx) read the same
 * strings Card draws with.
 */

/*
 * The actions: one row that wraps, at the right edge of the header. ml-auto
 * keeps the row at the right edge when it has a line to itself, and
 * justify-end keeps each of its own lines there when it wraps.
 */
export const CARD_HEADER_ACTIONS_CLASS_NAME: string =
  "ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-2";

/*
 * The title's share of the line it shares with the actions.
 *
 * On a phone the title keeps its whole width: the actions stay beside it
 * while the two fit, and move to the next line, at the right edge, when they
 * do not - the title is never broken to make room for them.
 *
 * In the stacked header from md up - the one-third column of an overview
 * page, about 230px of header at 1280px - the title grows into whatever the
 * actions leave, and keeps the line with them as long as they leave it at
 * least half of it: "Affected Resources" breaks over two lines beside Edit
 * rather than dropping Edit onto a line of its own. Actions wider than that
 * - a probe picker and Test Monitor, or Assign and Refresh in that narrow
 * column - move to the next line instead, so a title is never squeezed
 * beside a row of controls.
 *
 * In the default header from md up the title and the description fill what
 * the actions leave, on one line that does not wrap.
 */
export const CARD_HEADER_TITLE_BLOCK_CLASS_NAME: string = "min-w-0 md:flex-1";

export const CARD_HEADER_STACKED_TITLE_BLOCK_CLASS_NAME: string =
  "min-w-0 md:grow md:basis-1/2";

/*
 * In the toolbar header from md up the title grows into what the controls
 * leave, and keeps the line with them as long as they leave it 12rem.
 */
export const CARD_HEADER_TOOLBAR_TITLE_BLOCK_CLASS_NAME: string =
  "min-w-0 md:grow md:basis-48";

/*
 * A control of a toolbar header that fills its line on a phone - a table's
 * search - marks the element it is in with this attribute. Below md the
 * toolbar's actions, and the action box that holds that element, then take
 * the card's width (CARD_HEADER_TOOLBAR_FILL_CLASS_NAME), so the search can
 * fill its line: as wide as the card, not hung at the right edge, and an
 * opened search no wider than its text's own measure. A toolbar with no
 * such control (a table without a search) keeps its buttons beside the
 * title while they fit.
 */
export const CARD_HEADER_TOOLBAR_FILL_ATTRIBUTE: string = "data-toolbar-fill";

export const CARD_HEADER_TOOLBAR_FILL_CLASS_NAME: string =
  "max-md:has-[[data-toolbar-fill]]:w-full";

/*
 * Each action's own box. Button carries a left margin meant for a dialog's
 * footer (md:ml-3 on a normal button, ml-1 on an outline one), which made
 * the gaps between a card's buttons uneven - 18px between two normal
 * buttons, 10px before the ⋯. The row's gap spaces them, so that margin is
 * cleared on the action itself (a <button>, or the one element a button
 * sits in: a disabled button's tooltip span, the ⋯ menu's wrapper) and never
 * on the buttons inside a control, such as a picker or a dialog it opens.
 */
export const CARD_HEADER_ACTION_CLASS_NAME: string =
  "flex items-center [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0";

/*
 * The first line of the stacked and toolbar headers: the title and the
 * actions side by side while they fit, the actions on the next line - at
 * the right edge - when they do not. On a phone the two are centred on each
 * other. CARD_HEADER_TITLE_LINE_CLASS_NAMES says how they meet from md up.
 */
export const CARD_HEADER_TITLE_ROW_CLASS_NAME: string =
  "flex flex-wrap items-center gap-x-4 gap-y-2";

/*
 * How far a header's controls reach past its title's line, from md up, on
 * each side: they are 38px tall (Button's normal size, and every control in
 * a table's header - TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME), the title's
 * line 24px (CARD_TITLE_CLASS_NAME's leading-6), so 7px above it and 7px
 * below it when they are centred on the title.
 */
export const CARD_HEADER_CONTROL_HEIGHT_IN_PX: number = 38;

export const CARD_TITLE_LINE_HEIGHT_IN_PX: number = 24;

export const CARD_HEADER_CONTROL_OVERHANG_IN_PX: number =
  (CARD_HEADER_CONTROL_HEIGHT_IN_PX - CARD_TITLE_LINE_HEIGHT_IN_PX) / 2;

/*
 * Air between the controls' foot and a description that runs under them
 * (the description's letters start another 6px down its line).
 */
export const CARD_DESCRIPTION_CLEARANCE_IN_PX: number = 2;

/*
 * "There's a lot of gap between the title of the card and the description
 * of the card." In the stacked and toolbar headers the description follows
 * the first line, and that line was as tall as the controls on it: the
 * title hung from its top and the description came 20px under the title -
 * a button row's height - where a card with no controls has 6px. From md
 * up (a phone does not show the description) the first line is now the
 * title's own line:
 *
 *   - the title stays where every card's title is, at the card's padding,
 *     so the titles of cards side by side line up whatever their headers
 *     hold;
 *   - the actions are centred on the title's line (md:items-center) and
 *     reach as far above it as below it (md:-my-[7px] for 38px controls),
 *     so the line is no taller than the title. Centring their margin box
 *     centres the actions themselves whatever their height: a 38px search
 *     or Edit, a 32px segmented control, a status pill or a small link;
 *   - the description follows that line by the 7px the controls hang down
 *     and 2px of air (CARD_DESCRIPTION_UNDER_ACTIONS_CLASS_NAME): 9px under
 *     the title, and clear of the controls wherever it runs under them.
 *
 * A long title that breaks over two lines has the actions centred on both.
 *
 * Without a description nothing follows the first line, so the controls'
 * foot must stay in it - the card's body never moves up under them: they
 * hang only above the line (md:-mt-[7px]) and the title's block takes the
 * same 7px under it (CARD_HEADER_TITLE_BLOCK_OVER_NOTHING_CLASS_NAME), so
 * both stay centred and the title stays where it is with a description.
 * That matters where a description comes and goes: a table drops its own
 * while its empty state says it, and its title and controls do not move.
 *
 * When the actions do not fit beside the title (a list with a side menu at
 * 1024px, two buttons in an overview's one-third column) they go to a line
 * of their own, and a description that followed them sat a button row or
 * two under its title (48px on the Runbooks list at 1024px, 98px at 768px).
 * There the description joins the title's block instead, 6px under the
 * title as in a card with no actions, and the actions follow it, at the
 * right edge, hanging past nothing (overActions; see
 * cardHeaderActionsAreUnderTitle). Where they go is the browser's to say -
 * it depends on the title, the controls and the language - so the card
 * reads it from the drawn header.
 */
export const CARD_HEADER_TITLE_LINE_CLASS_NAMES: {
  // The title and the actions side by side.
  besideActions: string;
  // The title with no actions beside it (or actions with no title).
  alone: string;
  /*
   * The title and its description as one block, over actions that went to
   * a line of their own.
   */
  overActions: string;
} = {
  besideActions: "md:items-center",
  alone: "md:items-start",
  overActions: "md:items-start",
};

/*
 * The actions beside the title, from md up: as far above its line as below
 * it, so they are centred on it (CARD_HEADER_CONTROL_OVERHANG_IN_PX each
 * way for 38px controls).
 */
export const CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES: {
  // A description follows the line: the actions hang over it too.
  overDescription: string;
  // Nothing follows the line: the actions' foot stays in it.
  overNothing: string;
} = {
  overDescription: "md:-my-[7px]",
  overNothing: "md:-mt-[7px]",
};

/*
 * With nothing under the line, the title's block takes as much room under
 * it as the actions reach above it, so the two stay centred on each other.
 */
export const CARD_HEADER_TITLE_BLOCK_OVER_NOTHING_CLASS_NAME: string =
  "md:mb-[7px]";

/*
 * Whether a stacked or toolbar header's actions went to a line of their own
 * under the title's block: their top below its middle (beside it, they are
 * centred on its line). Null while the header is not drawn (no size: a
 * hidden card, or a test's DOM without layout), when it cannot say.
 *
 * Where the actions go does not depend on the description: from md up the
 * title's block wraps by its flex-basis (half the line, or 12rem in the
 * toolbar), never by its words, so moving the description into the block
 * cannot change the answer.
 */
export const cardHeaderActionsAreUnderTitle: (
  titleBlock: Element,
  actions: Element,
) => boolean | null = (
  titleBlock: Element,
  actions: Element,
): boolean | null => {
  const titleBox: DOMRect = titleBlock.getBoundingClientRect();
  const actionsBox: DOMRect = actions.getBoundingClientRect();

  if (titleBox.height === 0 || actionsBox.height === 0) {
    return null;
  }

  return actionsBox.top > (titleBox.top + titleBox.bottom) / 2;
};

/*
 * The description under a card's title. A card with no controls beside its
 * title (and the default header, where the controls stand beside the
 * description) puts it 6px under the title; the stacked and toolbar headers
 * with actions beside the title put it 9px under it - the controls'
 * overhang and the clearance - out of their way (see
 * CARD_HEADER_TITLE_LINE_CLASS_NAMES). Hidden on a phone.
 */
export const CARD_DESCRIPTION_CLASS_NAME: string =
  "mt-1.5 text-sm text-gray-500 w-full max-md:hidden md:block leading-relaxed";

export const CARD_DESCRIPTION_UNDER_ACTIONS_CLASS_NAME: string =
  "mt-[9px] text-sm text-gray-500 w-full max-md:hidden md:block leading-relaxed";

/*
 * A card's frame on a page: a white box with a border, rounded corners and a
 * shadow, and a gap under it for the next card.
 */
export const CARD_FRAME_CLASS_NAME: string =
  "bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible";

/*
 * The same card drawn as a section of the card it is in (CardSections): no
 * frame and no gap of its own, a divider across the whole card above it.
 * Its padding is a card's, so everything drawn to a card's edges - a
 * table's rows and footer, a switch row - still reaches the section's.
 */
export const CARD_SECTION_CLASS_NAME: string = "border-t border-gray-200";

export const CARD_PADDING_CLASS_NAME: string = "py-6 px-5 md:px-6";

// A card with no header of its own (isHeaderHidden): nothing above its body.
export const CARD_HEADERLESS_PADDING_CLASS_NAME: string = "pb-6 px-5 md:px-6";

/*
 * What fillHeight adds, exported so the tests read the same strings: the
 * card and its frame take the box's height, the frame and the padding are
 * columns, and the body grows into what the header leaves.
 */
export const CARD_FILL_HEIGHT_CLASS_NAME: string = "h-full";

export const CARD_FILL_HEIGHT_FRAME_CLASS_NAME: string = "flex h-full flex-col";

export const CARD_FILL_HEIGHT_CONTENT_CLASS_NAME: string =
  "flex flex-1 flex-col";

export const CARD_FILL_HEIGHT_BODY_CLASS_NAME: string = "flex flex-1 flex-col";

/*
 * A section's title, a step below a card's: the sections are parts of one
 * card, and their titles say so beside the cards on the rest of the page.
 */
export const CARD_TITLE_CLASS_NAME: string =
  "text-lg font-semibold leading-6 text-gray-900 text-balance break-words";

export const CARD_SECTION_TITLE_CLASS_NAME: string =
  "text-base font-semibold leading-6 text-gray-900 text-balance break-words";

const Card: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateValue } = useTranslateValue();
  const isSection: boolean = useIsCardSection();
  const isGridCell: boolean = useIsCardGridCell();
  const hasButtons: boolean = Boolean(
    props.buttons && props.buttons.length > 0,
  );
  const hasActions: boolean = Boolean(props.rightElement) || hasButtons;
  const isToolbar: boolean = props.headerLayout === "toolbar";
  const isStacked: boolean = props.headerLayout === "stacked" || isToolbar;
  const translatedTitle: string | ReactElement | undefined = translateValue(
    props.title,
  );
  const translatedDescription: string | ReactElement | undefined =
    translateValue(props.description);

  const renderButtons: () => Array<ReactElement> = (): Array<ReactElement> => {
    return (props.buttons || []).map(
      (button: CardButtonSchema | ReactElement, i: number) => {
        return (
          <div
            key={i}
            className={
              isToolbar
                ? `${CARD_HEADER_ACTION_CLASS_NAME} ${CARD_HEADER_TOOLBAR_FILL_CLASS_NAME}`
                : CARD_HEADER_ACTION_CLASS_NAME
            }
          >
            {React.isValidElement(button) ? button : null}
            {React.isValidElement(button) ? null : (
              <Button
                key={i}
                title={(button as CardButtonSchema).title}
                buttonStyle={(button as CardButtonSchema).buttonStyle}
                buttonSize={(button as CardButtonSchema).buttonSize}
                className={(button as CardButtonSchema).className}
                onClick={() => {
                  if ((button as CardButtonSchema).onClick) {
                    (button as CardButtonSchema).onClick();
                  }
                }}
                disabled={(button as CardButtonSchema).disabled}
                tooltip={(button as CardButtonSchema).tooltip}
                icon={(button as CardButtonSchema).icon}
                shortcutKey={(button as CardButtonSchema).shortcutKey}
                dataTestId="card-button"
                isLoading={(button as CardButtonSchema).isLoading}
              />
            )}
          </div>
        );
      },
    );
  };

  const titleElement: ReactElement | false | "" | undefined =
    translatedTitle && (
      <h2
        data-testid="card-details-heading"
        id="card-details-heading"
        className={
          isSection ? CARD_SECTION_TITLE_CLASS_NAME : CARD_TITLE_CLASS_NAME
        }
      >
        {translatedTitle}
      </h2>
    );

  const hasDescription: boolean = Boolean(translatedDescription);

  /*
   * A stacked or toolbar header with a title, actions and a description
   * reads where the browser put its actions: beside the title, or on a line
   * of their own under it. In the second case the description joins the
   * title's block, so it is not a button row or two under its title
   * (CARD_HEADER_TITLE_LINE_CLASS_NAMES, overActions). The first line is
   * read once it is drawn - before the browser paints it - and again
   * whenever its size changes: the window, the language, a table's search
   * opening or a button coming in.
   */
  const readsActionsLine: boolean =
    isStacked && hasActions && hasDescription && Boolean(translatedTitle);
  const [actionsUnderTitle, setActionsUnderTitle] = useState<boolean>(false);
  const titleRowObserver: MutableRefObject<ResizeObserver | null> =
    useRef<ResizeObserver | null>(null);

  const watchTitleRow: (titleRow: HTMLDivElement | null) => void = useCallback(
    (titleRow: HTMLDivElement | null): void => {
      titleRowObserver.current?.disconnect();
      titleRowObserver.current = null;

      if (!titleRow || !readsActionsLine) {
        return;
      }

      const read: () => void = (): void => {
        const parts: Array<Element> = Array.from(titleRow.children);
        const titleBlock: Element | undefined = parts.find(
          (part: Element): boolean => {
            return (
              part.getAttribute("data-testid") === "card-header-title-block"
            );
          },
        );
        const actions: Element | undefined = parts.find(
          (part: Element): boolean => {
            return part.getAttribute("data-testid") === "card-header-actions";
          },
        );

        if (!titleBlock || !actions) {
          return;
        }

        const isUnderTitle: boolean | null = cardHeaderActionsAreUnderTitle(
          titleBlock,
          actions,
        );

        if (isUnderTitle !== null) {
          setActionsUnderTitle(isUnderTitle);
        }
      };

      read();

      if (typeof ResizeObserver === "undefined") {
        return;
      }

      const observer: ResizeObserver = new ResizeObserver(read);
      observer.observe(titleRow);
      titleRowObserver.current = observer;
    },
    [readsActionsLine],
  );

  const isDescriptionInTitleBlock: boolean =
    readsActionsLine && actionsUnderTitle;

  /*
   * From md up, actions beside a stacked or toolbar header's title are
   * centred on its line, reaching above and below it
   * (CARD_HEADER_TITLE_LINE_CLASS_NAMES); on a line of their own, or with
   * no title to sit beside, they hang past nothing.
   */
  const centresActionsOnTitle: boolean =
    isStacked &&
    hasActions &&
    Boolean(titleElement) &&
    !isDescriptionInTitleBlock;

  /*
   * In the stacked and toolbar headers the description follows the line the
   * title shares with the actions; there it keeps clear of the controls'
   * foot. Over actions on a line of their own, and in the default header, it
   * is in the title's block, 6px under the title.
   */
  const descriptionElement: ReactElement | false | "" | undefined =
    translatedDescription && (
      <p
        data-testid="card-description"
        className={
          centresActionsOnTitle
            ? CARD_DESCRIPTION_UNDER_ACTIONS_CLASS_NAME
            : CARD_DESCRIPTION_CLASS_NAME
        }
      >
        {translatedDescription}
      </p>
    );

  const stackedActionsClassName: string = centresActionsOnTitle
    ? ` ${
        hasDescription
          ? CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overDescription
          : CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overNothing
      }`
    : "";

  const actionsElement: ReactElement | null = hasActions ? (
    <div
      data-testid="card-header-actions"
      className={`${CARD_HEADER_ACTIONS_CLASS_NAME}${
        isStacked ? stackedActionsClassName : " md:flex-shrink-0"
      }${isToolbar ? ` ${CARD_HEADER_TOOLBAR_FILL_CLASS_NAME}` : ""}`}
    >
      {props.rightElement && (
        <div className="flex items-center">{props.rightElement}</div>
      )}
      {hasButtons && renderButtons()}
    </div>
  ) : null;

  /*
   * The title and the actions share one line that wraps: side by side while
   * the actions leave the title its share, the actions on the next line - at
   * the right edge - when they do not (see the title block's class above).
   * On a phone the two are centred on each other; from md up the actions
   * are centred on the title's line and the line is no taller than the
   * title, so a description follows the title, not the controls
   * (CARD_HEADER_TITLE_LINE_CLASS_NAMES). The description is not on that
   * line, so its length cannot push the actions off it: it runs under both,
   * across the card's whole width - unless the actions went under the
   * title, when it joins the title's block, before them.
   */
  const titleLineClassName: string = isDescriptionInTitleBlock
    ? CARD_HEADER_TITLE_LINE_CLASS_NAMES.overActions
    : centresActionsOnTitle
      ? CARD_HEADER_TITLE_LINE_CLASS_NAMES.besideActions
      : CARD_HEADER_TITLE_LINE_CLASS_NAMES.alone;

  const titleBlockShareClassName: string = actionsElement
    ? isToolbar
      ? CARD_HEADER_TOOLBAR_TITLE_BLOCK_CLASS_NAME
      : CARD_HEADER_STACKED_TITLE_BLOCK_CLASS_NAME
    : "w-full min-w-0";

  // With nothing under the line, the title keeps level with the actions' middle.
  const stackedTitleBlockClassName: string =
    centresActionsOnTitle && !hasDescription
      ? `${titleBlockShareClassName} ${CARD_HEADER_TITLE_BLOCK_OVER_NOTHING_CLASS_NAME}`
      : titleBlockShareClassName;

  const stackedHeader: ReactElement = (
    <div
      data-testid="card-header"
      data-header-layout={isToolbar ? "toolbar" : "stacked"}
    >
      {(titleElement || actionsElement) && (
        <div
          data-testid="card-header-title-row"
          ref={watchTitleRow}
          className={`${CARD_HEADER_TITLE_ROW_CLASS_NAME} ${titleLineClassName}`}
        >
          {titleElement && (
            <div
              data-testid="card-header-title-block"
              className={stackedTitleBlockClassName}
            >
              {titleElement}
              {isDescriptionInTitleBlock && descriptionElement}
            </div>
          )}
          {actionsElement}
        </div>
      )}
      {!isDescriptionInTitleBlock && descriptionElement}
    </div>
  );

  /*
   * From md up the title and the description are one block on the left, and
   * the actions sit beside it at the right edge, their top level with the
   * title's. Below md the description is hidden, so the title and the
   * actions share a line the way the stacked header's do: centred on each
   * other while they fit, the actions on the next line, at the right edge,
   * when they do not.
   */
  const defaultHeader: ReactElement = (
    <div
      data-testid="card-header"
      data-header-layout="default"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 md:flex-nowrap md:items-start"
    >
      <div
        data-testid="card-header-title-block"
        className={
          hasActions ? CARD_HEADER_TITLE_BLOCK_CLASS_NAME : "w-full min-w-0"
        }
      >
        {titleElement}
        {descriptionElement}
      </div>
      {actionsElement}
    </div>
  );

  /*
   * Only a card with a frame of its own fills its box: a section's height
   * is the card it is in. The card of a CardGrid cell fills it unless it
   * says otherwise. Without either every class below is exactly what it
   * was, so no other card changes.
   */
  const fillsHeight: boolean = (props.fillHeight ?? isGridCell) && !isSection;
  const isHeaderHidden: boolean = Boolean(props.isHeaderHidden);
  const bodyClassName: string = isHeaderHidden
    ? props.bodyClassName || ""
    : props.bodyClassName || "mt-4";
  const paddingClassName: string = isHeaderHidden
    ? CARD_HEADERLESS_PADDING_CLASS_NAME
    : CARD_PADDING_CLASS_NAME;

  const content: ReactElement = (
    <div
      className={
        fillsHeight
          ? `${paddingClassName} ${CARD_FILL_HEIGHT_CONTENT_CLASS_NAME}`
          : paddingClassName
      }
    >
      {isHeaderHidden ? <></> : isStacked ? stackedHeader : defaultHeader}

      {props.children && (
        <div
          className={
            fillsHeight
              ? `${bodyClassName} ${CARD_FILL_HEIGHT_BODY_CLASS_NAME}`
              : bodyClassName
          }
        >
          {/*
           * The cell is this card's: a card drawn in its body is as tall
           * as its content.
           */}
          {isGridCell ? (
            <CardGridCellContext.Provider value={false}>
              {props.children}
            </CardGridCellContext.Provider>
          ) : (
            props.children
          )}
        </div>
      )}
    </div>
  );

  if (isSection) {
    return (
      <div
        id={props.id}
        style={getCardAnchorStyle(props.id, true)}
        data-testid="card"
        data-card-surface="section"
        className={`${CARD_SECTION_CLASS_NAME} ${props.className || ""}`}
      >
        {content}
      </div>
    );
  }

  /*
   * A card that fills its box leaves no gap under it either: that would
   * reach past the box's bottom, and its parent spaces its cards (a grid's
   * or a column's gap).
   */
  const frameBoxClassName: string = fillsHeight
    ? [props.className, CARD_FILL_HEIGHT_CLASS_NAME].filter(Boolean).join(" ")
    : `mb-5 ${props.className || ""}`;

  return (
    <React.Fragment>
      <div
        id={props.id}
        style={getCardAnchorStyle(props.id, false)}
        data-testid="card"
        data-fill-height={fillsHeight ? "true" : undefined}
        className={frameBoxClassName}
      >
        <div
          className={
            fillsHeight
              ? `${CARD_FRAME_CLASS_NAME} ${CARD_FILL_HEIGHT_FRAME_CLASS_NAME}`
              : CARD_FRAME_CLASS_NAME
          }
        >
          {content}
        </div>
      </div>
    </React.Fragment>
  );
};

export default Card;

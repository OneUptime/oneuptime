import Button, { ButtonStyleType } from "../Button/Button";
import { isShortTitleInName } from "../Button/ShortButtonWords";
import { CardButtonSchema } from "../Card/Card";
import CardMoreMenu from "../Card/CardMoreMenu";
import Icon from "../Icon/Icon";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import { translationKey } from "../../Utils/TranslateTemplate";
import useIsBelowWidth, {
  PHONE_BELOW_WIDTH_IN_PX,
} from "../../Utils/UseIsBelowWidth";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useRef,
} from "react";

/*
 * The controls at the right of a table's card header: its search, the main
 * button and the ⋯ that holds everything else (Refresh, Filter, Columns, a
 * sort order). Every list in the product draws them from here - the model
 * tables (BaseModelTable) and the tables a page builds on Common's Table
 * itself (Session Replay, a host's processes, a cluster's events) - so a
 * table's header looks and works the same wherever it is: one height, one
 * search, one ⋯, never a lone icon nudged into place beside the title.
 *
 *   [🔍 Search…  /] [saved views] [+ Create] [⋯]
 */

/*
 * The row of a table's header controls. On a phone (below md) it takes the
 * card's width.
 */
export const TABLE_HEADER_TOOLBAR_CLASS_NAME: string =
  "flex flex-wrap items-center justify-end gap-3 max-md:w-full [[data-actions-under-title=true]_&]:w-full";

/*
 * The search while it is folded to its "Search... /" pill: 14rem from md
 * up. On a phone it fills its line - beside the buttons where they fit, on
 * a line of its own where they do not - never narrower than 11rem; and so
 * it does from md up while the header's controls are on a line of their
 * own under the title (Card's CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE):
 * between 768 and about 1100px beside a side menu it was a 14rem pill hung
 * at the right edge of an empty line.
 */
export const TABLE_HEADER_SEARCH_CLASS_NAME: string =
  "max-md:min-w-[11rem] max-md:flex-1 md:w-56 [[data-actions-under-title=true]_&]:min-w-[11rem] [[data-actions-under-title=true]_&]:flex-1";

/*
 * The search opened: the card's width on a phone, a wide bar from md up -
 * the line's width while the controls are under the title.
 */
export const TABLE_HEADER_OPEN_SEARCH_CLASS_NAME: string =
  "w-full md:w-[26rem] lg:w-[32rem] [[data-actions-under-title=true]_&]:flex-1";

/*
 * The search opened in a header whose controls stay beside it (see
 * TableHeaderToolbar's keepButtonsWhileSearching): a little narrower from md
 * up, so the bar, a time range picker and the ⋯ still share the title's line
 * on a laptop's card.
 */
export const TABLE_HEADER_OPEN_SEARCH_BESIDE_BUTTONS_CLASS_NAME: string =
  "w-full md:w-[20rem] lg:w-[24rem] [[data-actions-under-title=true]_&]:flex-1";

/*
 * The buttons beside an opened search, folded away to no width. They clip
 * what they hold while folded: their buttons, drawn on past a box of no
 * width, reached 31px past a phone's screen and let the whole page scroll
 * sideways. Only while folded - the ⋯ menu opens out of them otherwise.
 * And their words keep to one line: squeezed to no width, "Create
 * Monitor" broke over two, the folded box stood 58px tall, and the opened
 * search dropped 10px below the card's title. Hidden from the keyboard too
 * (invisible, once their fold has run): Tab from the opened search went on
 * to buttons nobody could see.
 */
export const TABLE_HEADER_FOLDED_BUTTONS_CLASS_NAME: string =
  "max-w-0 -ml-3 gap-0 opacity-0 pointer-events-none overflow-hidden whitespace-nowrap invisible";

/*
 * The same buttons, unfolded. On a phone they wrap onto a second line, at
 * the right edge, when they do not fit on one - Saved Views over the main
 * button and the ⋯ - each as wide as its words (a Button fills a phone's
 * line by default). Squeezed onto one line, Saved Views and the main
 * button broke their words ("Create / On-Call / Schedule" stood three
 * lines tall), and in German "Gespeicherte Ansichten" ran past the card's
 * left edge.
 */
export const TABLE_HEADER_BUTTONS_CLASS_NAME: string =
  "max-w-[600px] gap-3 opacity-100 max-md:flex-wrap max-md:justify-end max-md:[&>button]:w-auto max-md:[&>*>button]:w-auto";

/*
 * The main button and the ⋯, one item of that row
 * (renderTableHeaderMainAndMore): where the row wraps they move to the
 * next line together. A main button too long to share its line with the ⋯
 * - "Create Scheduled Maintenance Event" on a 390px phone - says its short
 * words there (CardButtonSchema.phoneTitle, "Create"); one without them
 * breaks its words beside it. As two items of the row, the ⋯ wrapped onto
 * a line of its own under a main button that filled the line. Each as
 * wide as its words, as in the row.
 */
export const TABLE_HEADER_MAIN_AND_MORE_CLASS_NAME: string =
  "flex items-center gap-3 max-md:[&>button]:w-auto max-md:[&>*>button]:w-auto";

/*
 * Every control in the row is one height: 42px on a phone and 38px from md
 * up, the height of a card's buttons (Button's normal size) and of the ⋯
 * (CARD_MORE_MENU_TRIGGER_CLASS_NAME). A picker drawn beside them - a time
 * range - takes this box so it does not sit a size smaller than its
 * neighbours.
 */
export const TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME: string = "py-2.5 md:py-2";

/*
 * The "/" key hint in a table's search, folded and opened. Its own line is
 * 12px: with its padding and border it stays inside the search's 20px line.
 * On the line it inherited (15px for its 10px text) it stood 21px tall and
 * made every table's search 39px beside its 38px buttons.
 */
export const TABLE_HEADER_SEARCH_KEY_HINT_CLASS_NAME: string =
  "max-sm:hidden flex-none select-none items-center rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-3 text-gray-500 sm:inline-flex";

/*
 * The x that empties a table's opened search. Tab reaches it from the box,
 * so it shows where the focus is the way the header's other buttons do -
 * the browser's own black ring was drawn round it instead.
 *
 * Its circle (22px) hangs over the search's 20px line rather than growing
 * it (-my-1): it appears with the first letter typed, and the search grew
 * to 40px with it, the card's description and chips moving 2px down under
 * the reader's typing, the box standing taller than the buttons beside it.
 */
export const TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME: string =
  "-my-1 flex-none rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

/*
 * The folded search's "Search…  /" pill. It shows the keyboard's focus as
 * the header's other controls do - the time range, the main button, the ⋯
 * - with the indigo ring, where the browser drew its own black one.
 */
export const TABLE_HEADER_SEARCH_PILL_FOCUS_CLASS_NAME: string =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

/*
 * The labels of the ⋯'s items that are icon-only buttons in the header
 * (Refresh, Filter, ...), in English: MoreMenuItem looks each one up in the
 * reader's language.
 */
const ICON_BUTTON_LABELS: Partial<Record<IconProp, string>> = {
  [IconProp.Refresh]: translationKey("Refresh"),
  [IconProp.Filter]: translationKey("Filter"),
  [IconProp.Add]: translationKey("Add"),
  [IconProp.Help]: translationKey("Help"),
  [IconProp.Book]: translationKey("Documentation"),
  [IconProp.Play]: translationKey("Watch Demo"),
  [IconProp.Search]: translationKey("Search"),
  [IconProp.TableCells]: translationKey("Columns"),
};

// The word an icon-only header button goes by in the ⋯ menu.
export function getTableHeaderButtonLabel(icon: IconProp | undefined): string {
  return (icon && ICON_BUTTON_LABELS[icon]) || "Action";
}

export interface TableHeaderButtonSplit {
  // The button the header keeps in sight, or null when there is none.
  main: CardButtonSchema | null;
  // Everything the ⋯ holds, in order.
  rest: Array<CardButtonSchema | ReactElement>;
}

/*
 * The "primary" button is the one with NORMAL style and the Add icon - the
 * Create button that BaseModelTable injects automatically. The header shows
 * it beside the search and keeps everything else behind the ⋯. If there is
 * no such button the first NORMAL- or PRIMARY-styled one is the main one.
 * PRIMARY is treated as a main candidate because it explicitly marks a
 * primary action (e.g. "Run Runbook") - hiding it in the overflow menu
 * defeats the purpose of the style. Icon-only buttons (Refresh, Filter,
 * Columns) are never the main one.
 */
export function splitTableHeaderButtons(
  buttons: Array<CardButtonSchema | ReactElement>,
): TableHeaderButtonSplit {
  let mainIndex: number = -1;

  for (let i: number = 0; i < buttons.length; i++) {
    const button: CardButtonSchema | ReactElement = buttons[i]!;

    if (React.isValidElement(button)) {
      continue;
    }

    const schema: CardButtonSchema = button as CardButtonSchema;

    if (
      schema.buttonStyle === ButtonStyleType.NORMAL &&
      schema.icon === IconProp.Add
    ) {
      mainIndex = i;
      break;
    }
  }

  if (mainIndex < 0) {
    for (let i: number = 0; i < buttons.length; i++) {
      const button: CardButtonSchema | ReactElement = buttons[i]!;

      if (React.isValidElement(button)) {
        continue;
      }

      const style: ButtonStyleType | undefined = (button as CardButtonSchema)
        .buttonStyle;

      if (
        style === ButtonStyleType.NORMAL ||
        style === ButtonStyleType.PRIMARY
      ) {
        mainIndex = i;
        break;
      }
    }
  }

  if (mainIndex < 0) {
    return { main: null, rest: buttons };
  }

  return {
    main: buttons[mainIndex] as CardButtonSchema,
    rest: [...buttons.slice(0, mainIndex), ...buttons.slice(mainIndex + 1)],
  };
}

/*
 * The main button, as the header draws it. On a phone it says its short
 * words when it has them (CardButtonSchema.phoneTitle): beside the ⋯
 * there, "Create Scheduled Maintenance Event" broke onto two lines and
 * stood twice as tall as the ⋯. Named by its whole title, which holds the
 * short words (ShortButtonWords), so a voice command and a screen reader
 * still find it by what it does; from md up it says the whole title.
 */
const TableHeaderMainButton: FunctionComponent<{
  button: CardButtonSchema;
}> = (props: { button: CardButtonSchema }): ReactElement => {
  const { translateString } = useTranslateValue();
  const isPhone: boolean = useIsBelowWidth(PHONE_BELOW_WIDTH_IN_PX);
  const button: CardButtonSchema = props.button;
  const isShortened: boolean =
    isPhone &&
    isShortTitleInName({
      title: translateString(button.title),
      shortTitle: translateString(button.phoneTitle),
    });

  return (
    <Button
      title={isShortened ? button.phoneTitle : button.title}
      ariaLabel={isShortened ? button.title : undefined}
      buttonStyle={button.buttonStyle}
      buttonSize={button.buttonSize}
      className={button.className}
      onClick={() => {
        if (button.disabled) {
          return;
        }

        button.onClick?.();
      }}
      disabled={button.disabled}
      tooltip={button.tooltip}
      icon={button.icon}
      shortcutKey={button.shortcutKey}
      dataTestId="card-button"
      isLoading={button.isLoading}
    />
  );
};

export function renderTableHeaderMainButton(
  button: CardButtonSchema,
): ReactElement {
  return (
    <TableHeaderMainButton key="model-table-main-action" button={button} />
  );
}

export interface TableHeaderMoreMenuOptions {
  /*
   * Drawn first, as they are: a sort order's section of ticked choices
   * (MoreMenuSection), as a feed's ⋯ has.
   */
  sections?: Array<ReactElement> | undefined;
  dataTestId?: string | undefined;
}

/*
 * The ⋯ at the end of a table's header and what it holds: a button by its
 * title (an icon-only one by the word for its icon), any other element in a
 * padded row of its own. Null when there is nothing to put in it.
 */
export function renderTableHeaderMoreMenu(
  items: Array<CardButtonSchema | ReactElement>,
  options?: TableHeaderMoreMenuOptions,
): ReactElement | null {
  const sections: Array<ReactElement> = options?.sections || [];

  if (items.length === 0 && sections.length === 0) {
    return null;
  }

  const children: Array<ReactElement> = [
    ...sections,
    ...items.map((item: CardButtonSchema | ReactElement, index: number) => {
      if (React.isValidElement(item)) {
        return (
          <div key={`more-${index}`} className="px-2 py-1">
            {item}
          </div>
        );
      }

      const button: CardButtonSchema = item as CardButtonSchema;
      const label: string =
        button.title || getTableHeaderButtonLabel(button.icon);

      return (
        <MoreMenuItem
          key={`more-${index}`}
          text={label}
          icon={button.icon}
          onClick={() => {
            if (!button.disabled) {
              button.onClick?.();
            }
          }}
          isDisabled={button.disabled}
          tooltip={button.tooltip}
        />
      );
    }),
  ];

  // The same ⋯ every card header has: a feed's, too.
  return (
    <CardMoreMenu key="model-table-more-menu" dataTestId={options?.dataTestId}>
      {children}
    </CardMoreMenu>
  );
}

/*
 * The main button and the ⋯ beside it, kept together in a toolbar's row
 * (TABLE_HEADER_MAIN_AND_MORE_CLASS_NAME). Either one alone is drawn as
 * it is; null when there is neither.
 */
export function renderTableHeaderMainAndMore(
  main: CardButtonSchema | null | undefined,
  moreMenu: ReactElement | null | undefined,
): ReactElement | null {
  if (!main) {
    return moreMenu || null;
  }

  if (!moreMenu) {
    return renderTableHeaderMainButton(main);
  }

  return (
    <div
      key="model-table-main-and-more"
      data-testid="model-table-main-and-more"
      className={TABLE_HEADER_MAIN_AND_MORE_CLASS_NAME}
    >
      {renderTableHeaderMainButton(main)}
      {moreMenu}
    </div>
  );
}

/*
 * A table header's buttons as a card takes them, for a table without a
 * search: the main button in sight and the rest behind the ⋯ - which is
 * where a model table keeps Refresh and Filter. A table a page builds itself
 * hands its header buttons through this, so they are never drawn as loose
 * icons beside the title.
 */
export function getTableHeaderButtons(
  buttons: Array<CardButtonSchema | ReactElement>,
  options?: TableHeaderMoreMenuOptions,
): Array<ReactElement> {
  const { main, rest }: TableHeaderButtonSplit =
    splitTableHeaderButtons(buttons);
  const composed: Array<ReactElement> = [];

  if (main) {
    composed.push(renderTableHeaderMainButton(main));
  }

  const moreMenu: ReactElement | null = renderTableHeaderMoreMenu(
    rest,
    options,
  );

  if (moreMenu) {
    composed.push(moreMenu);
  }

  return composed;
}

/*
 * "/" opens a table's search and focuses it - the same affordance as GitHub
 * and Linear. Not while the reader is typing in another input or textarea,
 * or in an editable region.
 */
export function useTableHeaderSearchShortcut(
  isEnabled: boolean,
  openSearch: () => void,
): void {
  const openSearchRef: React.MutableRefObject<() => void> =
    useRef<() => void>(openSearch);

  openSearchRef.current = openSearch;

  useEffect(() => {
    if (!isEnabled) {
      return undefined;
    }

    const handleKey: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target: HTMLElement | null = event.target as HTMLElement | null;

      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      openSearchRef.current();
    };

    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("keydown", handleKey);
    };
  }, [isEnabled]);
}

export interface TableHeaderSearchSlotProps {
  // Opened: the search control shows; folded: the "Search… /" pill does.
  isOpen: boolean;
  // The pill was clicked.
  onOpen: () => void;
  // The opened search control. It sets the slot's height.
  children: ReactNode;
  // The slot's width while opened. Defaults to TABLE_HEADER_OPEN_SEARCH_CLASS_NAME.
  openClassName?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * A table's search in its header - a compact pill that says "Search…  /"
 * until it is used, grown into the full search bar when it is. Always
 * advertising itself (rather than starting as a tiny icon) reads as a more
 * polished search affordance, in line with Stripe / Linear / GitHub.
 *
 * Both states stay mounted: the change is purely CSS, so the input keeps
 * its focus and a dropdown under it keeps its open state.
 */
export const TableHeaderSearchSlot: FunctionComponent<
  TableHeaderSearchSlotProps
> = (props: TableHeaderSearchSlotProps): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) ?? value;
  };

  return (
    <div
      data-testid={props.dataTestId || "model-table-search-slot"}
      className={`relative max-w-full shrink-0 transition-[width] duration-300 ease-out ${
        props.isOpen
          ? props.openClassName || TABLE_HEADER_OPEN_SEARCH_CLASS_NAME
          : TABLE_HEADER_SEARCH_CLASS_NAME
      }`}
    >
      {/* Trigger (folded state) */}
      <button
        type="button"
        onClick={props.onOpen}
        title={tx("Search (/)")}
        aria-label={tx("Open search")}
        tabIndex={props.isOpen ? -1 : 0}
        className={`absolute inset-0 inline-flex items-center gap-2 rounded-md border bg-white px-3 text-sm shadow-sm transition-all duration-200 ease-out ${TABLE_HEADER_SEARCH_PILL_FOCUS_CLASS_NAME} ${
          props.isOpen
            ? "pointer-events-none border-gray-200 opacity-0"
            : "border-gray-200 opacity-100 hover:border-gray-300 hover:bg-gray-50"
        }`}
      >
        <Icon
          icon={IconProp.Search}
          className="h-4 w-4 flex-none text-gray-400"
        />
        <span className="flex-1 truncate text-left text-gray-400">
          {tx("Search…")}
        </span>
        <kbd className={TABLE_HEADER_SEARCH_KEY_HINT_CLASS_NAME}>/</kbd>
      </button>

      {/* The opened search control */}
      <div
        className={`transition-opacity duration-200 ease-out ${
          props.isOpen
            ? "opacity-100 delay-150"
            : "pointer-events-none opacity-0"
        }`}
      >
        {props.children}
      </div>
    </div>
  );
};

export interface TableHeaderToolbarProps {
  // The search slot (TableHeaderSearchSlot), first in the row.
  search?: ReactNode | undefined;
  isSearchOpen?: boolean | undefined;
  /*
   * A model table folds its buttons away while its search is open, to give
   * the bar the room. A table whose header holds a picker the reader needs
   * while searching - a list's time range - keeps them beside it.
   */
  keepButtonsWhileSearching?: boolean | undefined;
  // The rest of the row: saved views, a picker, the main button, the ⋯.
  children?: ReactNode;
  dataTestId?: string | undefined;
}

/*
 * One row while it fits; in a narrow card (a phone, or beside a product's
 * side menu) the buttons wrap under the search, at the right edge, instead
 * of the row running off the card's left edge.
 *
 * On a phone the row takes the card's width, and the search the whole of its
 * line (TABLE_HEADER_SEARCH_CLASS_NAME). It is handed to Card as one of its
 * buttons; Card's toolbar header lets it fill a phone's line because it says
 * so (data-toolbar-fill, CARD_HEADER_TOOLBAR_FILL_ATTRIBUTE).
 */
export const TableHeaderToolbar: FunctionComponent<TableHeaderToolbarProps> = (
  props: TableHeaderToolbarProps,
): ReactElement => {
  const isFolded: boolean =
    Boolean(props.isSearchOpen) && !props.keepButtonsWhileSearching;

  return (
    <div
      data-testid={props.dataTestId || "model-table-header-toolbar"}
      data-toolbar-fill="true"
      className={TABLE_HEADER_TOOLBAR_CLASS_NAME}
    >
      {props.search}

      {/*
       * Buttons that collapse when the bar expands. We avoid
       * `overflow-hidden` here — the MoreMenu dropdown is an absolutely
       * positioned child of one of these buttons and would otherwise get
       * clipped by an `overflow-hidden` ancestor, leaving the user with an
       * apparent "no menu appears" bug when they click ⋯. The wrapper is
       * hidden via opacity + pointer-events instead, and its width
       * collapses by setting both `max-width` and `gap` to 0 so the search
       * slot to the left can grow into the freed space.
       */}
      <div
        className={`flex items-center transition-all duration-300 ease-out [&_button]:md:ml-0 ${
          isFolded
            ? TABLE_HEADER_FOLDED_BUTTONS_CLASS_NAME
            : TABLE_HEADER_BUTTONS_CLASS_NAME
        }`}
        aria-hidden={isFolded}
      >
        {props.children}
      </div>
    </div>
  );
};

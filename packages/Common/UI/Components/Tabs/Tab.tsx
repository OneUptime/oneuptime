import useTranslateValue from "../../Utils/Translation";
import { PRODUCT_TEXT_CLASS_NAME } from "../../Utils/ProductText";
import React, { FunctionComponent, ReactElement } from "react";
import { PillTone } from "../Pill/PillTone";

export enum TabType {
  Error = "error",
  Warning = "warning",
  Info = "info",
  Success = "success",
}

// The tone each kind of tab's count is drawn in: red, amber, blue, green.
export const TAB_COUNT_TONES: Readonly<Record<TabType, PillTone>> =
  Object.freeze({
    [TabType.Error]: PillTone.Danger,
    [TabType.Warning]: PillTone.Warning,
    [TabType.Info]: PillTone.Info,
    [TabType.Success]: PillTone.Success,
  });

export enum TabsVariant {
  // Tinted pills: the shared look of a page's or a card's tabs.
  Pills = "pills",
  /*
   * An underlined row on a rule across the top of its panel: the look of the
   * tablists drawn by hand in a detail panel (a span's, a log's, a replay's),
   * so they can move to the shared one.
   */
  Underline = "underline",
}

export interface Tab {
  name: string;
  /*
   * The name is drawn as given, never looked up: a product's name ("Cursor")
   * can also be a word the reader's language translates (a text cursor).
   */
  isName?: boolean | undefined;
  countBadge?: number | undefined;
  tabType?: TabType | undefined;
  children: ReactElement;
}

export interface ComponentProps {
  tab: Tab;
  /*
   * Unique on the page: Tabs builds it with useId, never from the tab's
   * name, which can hold spaces ("Incident Rules") and repeat across two
   * rows of tabs on one page (#9136).
   */
  id: string;
  onClick?: () => void;
  isSelected?: boolean;
  // The panel this tab names. Only the selected tab's panel is drawn.
  tabPanelId?: string | undefined;
  /*
   * The tab sits in a row that wraps (Tabs wrap): the row spaces its tabs
   * and its lines, so the tab adds no margin of its own.
   */
  isInWrappingRow?: boolean | undefined;
  variant?: TabsVariant | undefined;
}

/*
 * What every tab shares. A tab is a real button, so Enter and Space press it
 * with no code of its own, with the focus ring every control has. Under a
 * finger (pointer: coarse) it is at least 44px tall, WCAG 2.2's comfortable
 * target; a mouse keeps the compact row.
 */
export const TAB_BASE_CLASS_NAME: string =
  "text-sm font-medium cursor-pointer inline-flex items-center whitespace-nowrap flex-shrink-0 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 [@media(pointer:coarse)]:min-h-11";

const PILL_CLASS_NAME: string = "rounded-md px-3 py-2";
const PILL_SELECTED_CLASS_NAME: string = "bg-gray-100 text-gray-700";
const PILL_IDLE_CLASS_NAME: string = "text-gray-500 hover:text-gray-700";

const UNDERLINE_CLASS_NAME: string = "-mb-px border-b-2 px-1 py-2.5";
const UNDERLINE_SELECTED_CLASS_NAME: string =
  "border-indigo-500 text-indigo-600";
const UNDERLINE_IDLE_CLASS_NAME: string =
  "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700";

const TabElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translatedName: string = props.tab.isName
    ? props.tab.name
    : translateString(props.tab.name) ?? props.tab.name;

  const isUnderline: boolean = props.variant === TabsVariant.Underline;

  let stateClasses: string = props.isSelected
    ? PILL_SELECTED_CLASS_NAME
    : PILL_IDLE_CLASS_NAME;

  if (isUnderline) {
    stateClasses = props.isSelected
      ? UNDERLINE_SELECTED_CLASS_NAME
      : UNDERLINE_IDLE_CLASS_NAME;
  }

  const shapeClasses: string = isUnderline
    ? UNDERLINE_CLASS_NAME
    : PILL_CLASS_NAME;

  // The row spaces its tabs itself when it wraps or underlines them.
  let holderClassName: string = props.isInWrappingRow ? "" : "mt-3 mb-3";

  if (isUnderline) {
    holderClassName = "flex";
  }

  return (
    // Only a layout box: the tablist's children are its tabs (role none).
    <div className={holderClassName} role="none">
      <button
        type="button"
        id={props.id}
        data-testid={`tab-${props.tab.name}`}
        onClick={props.onClick}
        className={`${stateClasses} ${shapeClasses} ${TAB_BASE_CLASS_NAME}`}
        role="tab"
        tabIndex={props.isSelected ? 0 : -1}
        aria-selected={Boolean(props.isSelected)}
        aria-controls={props.isSelected ? props.tabPanelId : undefined}
      >
        {/* A tab named in the product's words reads in a recording (Utils/ProductText). */}
        <span
          className={props.tab.isName ? undefined : PRODUCT_TEXT_CLASS_NAME}
        >
          {translatedName}
        </span>

        {props.tab.countBadge && props.tab.countBadge > 0 ? (
          <span
            data-testid="tab-count"
            /*
             * What the count's colour means (PillTone), so a test reads the
             * tone, never the classes that paint it (#9255).
             */
            data-tone={
              props.tab.tabType
                ? TAB_COUNT_TONES[props.tab.tabType]
                : PillTone.Neutral
            }
            className={`${
              props.tab.tabType === TabType.Error
                ? "bg-red-500"
                : props.tab.tabType === TabType.Warning
                  ? "bg-yellow-500"
                  : props.tab.tabType === TabType.Info
                    ? "bg-indigo-500"
                    : props.tab.tabType === TabType.Success
                      ? "bg-green-500"
                      : "bg-gray-500"
            } text-white rounded-full px-2 py-1 text-xs font-semibold ml-2 -mt-0.5`}
          >
            {props.tab.countBadge}
          </span>
        ) : null}
      </button>
    </div>
  );
};

export default TabElement;

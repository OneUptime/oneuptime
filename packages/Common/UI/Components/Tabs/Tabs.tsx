import TabElement, { Tab, TabsVariant } from "./Tab";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  tabs: Array<Tab>;
  onTabChange: (tab: Tab) => void;
  /*
   * What the row of tabs is for, in English and looked up like any other
   * words ("Incident on-call rules", "Pod"). A screen reader says it as it
   * enters the row: every row was called "Tabs", so two on a page could not
   * be told apart (#9136).
   */
  label: string;
  /**
   * Tab selected on first render (e.g. restored from a URL param).
   * Falls back to the first tab when absent or unknown.
   */
  initialTabName?: string | undefined;
  /*
   * Focus the tab selected on first render, as a click on it leaves it:
   * for a page that opens a tab for the reader (AppPlatforms' Set up
   * alerts), so a keyboard carries on from there.
   */
  focusInitialTab?: boolean | undefined;
  /*
   * A few tabs inside a card, such as one per client to set up: on a narrow
   * screen the tab row wraps onto a second line instead of scrolling
   * sideways, so no tab is out of sight, and the panel starts at the card's
   * edge like everything else in it. Left out, the row scrolls on a phone
   * and the panel is set in a little, as it always was.
   */
  wrap?: boolean | undefined;
  // Pills (the default) or an underlined row (TabsVariant).
  variant?: TabsVariant | undefined;
}

/*
 * The ARIA tabs pattern (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/):
 * a tablist named by `label`, tabs that are buttons, one of them in the Tab
 * order (roving tabindex), the arrow keys, Home and End moving between them
 * and choosing as they go, and the panel named by its tab. Every id comes
 * from useId, so it holds no space and two rows on one page never share one.
 */
const Tabs: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [currentTabName, setCurrentTabName] = useState<string | null>(null);
  const hasInitialized: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const baseId: string = useId();

  type GetTabIdFunction = (index: number) => string;

  const getTabId: GetTabIdFunction = (index: number): string => {
    return `${baseId}tab-${index}`;
  };

  const tabPanelId: string = `${baseId}tabpanel`;

  /*
   * When the active tab changes as a result of keyboard arrow navigation we move
   * DOM focus onto the newly active tab (roving tabindex pattern). This ref keeps
   * us from stealing focus when the tab changes for any other reason (e.g. click).
   */
  const moveFocusToActiveTab: React.MutableRefObject<boolean> = useRef<boolean>(
    Boolean(props.focusInitialTab),
  );

  const currentIndex: number = props.tabs.findIndex((t: Tab) => {
    return t.name === currentTabName;
  });

  useEffect(() => {
    if (moveFocusToActiveTab.current && currentIndex >= 0) {
      document.getElementById(getTabId(currentIndex))?.focus();
      moveFocusToActiveTab.current = false;
    }
  }, [currentTabName]);

  type ActivateTabAtFunction = (index: number) => void;

  const activateTabAt: ActivateTabAtFunction = (index: number): void => {
    const tab: Tab | undefined = props.tabs[index];

    if (!tab) {
      return;
    }

    moveFocusToActiveTab.current = true;
    setCurrentTabName(tab.name);
  };

  type HandleTabListKeyDownFunction = (
    event: React.KeyboardEvent<HTMLElement>,
  ) => void;

  const handleTabListKeyDown: HandleTabListKeyDownFunction = (
    event: React.KeyboardEvent<HTMLElement>,
  ): void => {
    const count: number = props.tabs.length;

    if (count === 0) {
      return;
    }

    const fromIndex: number = currentIndex < 0 ? 0 : currentIndex;

    /*
     * The row reads in the page's direction: in a right-to-left page the
     * tab on the right is the one before, so ArrowRight goes back.
     */
    const isRightToLeft: boolean =
      (event.currentTarget.closest("[dir]")?.getAttribute("dir") ||
        document.documentElement.dir) === "rtl";
    const forwardKey: string = isRightToLeft ? "ArrowLeft" : "ArrowRight";
    const backwardKey: string = isRightToLeft ? "ArrowRight" : "ArrowLeft";

    if (event.key === forwardKey || event.key === "ArrowDown") {
      event.preventDefault();
      activateTabAt((fromIndex + 1) % count);
    } else if (event.key === backwardKey || event.key === "ArrowUp") {
      event.preventDefault();
      activateTabAt((fromIndex - 1 + count) % count);
    } else if (event.key === "Home") {
      event.preventDefault();
      activateTabAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      activateTabAt(count - 1);
    }
  };

  // Initialize current tab only once, or when the tab list names change
  useEffect(() => {
    const tabNames: Array<string> = props.tabs.map((t: Tab) => {
      return t.name;
    });

    if (!hasInitialized.current && props.tabs.length > 0) {
      hasInitialized.current = true;
      setCurrentTabName(
        props.initialTabName && tabNames.includes(props.initialTabName)
          ? props.initialTabName
          : props.tabs[0]!.name,
      );
      return;
    }

    // If current tab no longer exists in the list, reset to first
    if (currentTabName && !tabNames.includes(currentTabName)) {
      setCurrentTabName(props.tabs.length > 0 ? props.tabs[0]!.name : null);
    }
  }, [
    props.tabs
      .map((t: Tab) => {
        return t.name;
      })
      .join(","),
  ]);

  // Find the current tab object by name
  const currentTab: Tab | undefined = props.tabs[currentIndex];

  useEffect(() => {
    if (currentTab && props.onTabChange) {
      props.onTabChange(currentTab);
    }
  }, [currentTabName]);

  const isUnderline: boolean = props.variant === TabsVariant.Underline;

  let tabListClassName: string =
    "flex space-x-2 overflow-x-auto md:overflow-visible md:space-x-4";

  if (props.wrap) {
    tabListClassName = "flex flex-wrap gap-2 py-3 md:gap-x-4";
  }

  if (isUnderline) {
    tabListClassName = `flex gap-x-6 border-b border-gray-200 ${
      props.wrap ? "flex-wrap" : "overflow-x-auto"
    }`;
  }

  let tabPanelClassName: string = props.wrap ? "mt-3" : "mt-3 ml-1";

  if (isUnderline) {
    tabPanelClassName = "mt-4";
  }

  return (
    <div>
      <div
        role="tablist"
        aria-orientation="horizontal"
        className={tabListClassName}
        aria-label={translator.translateText(props.label)}
        onKeyDown={handleTabListKeyDown}
      >
        {props.tabs.map((tab: Tab, index: number) => {
          return (
            <TabElement
              key={tab.name}
              id={getTabId(index)}
              tab={tab}
              onClick={() => {
                setCurrentTabName(tab.name);
              }}
              isSelected={index === currentIndex}
              tabPanelId={tabPanelId}
              isInWrappingRow={props.wrap}
              variant={props.variant}
            />
          );
        })}
      </div>
      {currentTab ? (
        <div
          id={tabPanelId}
          role="tabpanel"
          /*
           * In the Tab order, so Tab moves from the row into a panel that
           * holds no control of its own and a screen reader says its name.
           */
          tabIndex={0}
          aria-labelledby={getTabId(currentIndex)}
          className={`${tabPanelClassName} rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2`}
        >
          {currentTab.children}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default Tabs;

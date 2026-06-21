import TabElement, { Tab } from "./Tab";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  tabs: Array<Tab>;
  onTabChange: (tab: Tab) => void;
}

const Tabs: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [currentTabName, setCurrentTabName] = useState<string | null>(null);
  const hasInitialized: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  /*
   * When the active tab changes as a result of keyboard arrow navigation we move
   * DOM focus onto the newly active tab (roving tabindex pattern). This ref keeps
   * us from stealing focus when the tab changes for any other reason (e.g. click).
   */
  const moveFocusToActiveTab: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    if (moveFocusToActiveTab.current && currentTabName) {
      document.getElementById(`tab-${currentTabName}`)?.focus();
      moveFocusToActiveTab.current = false;
    }
  }, [currentTabName]);

  type ActivateTabByOffsetFunction = (offset: number) => void;

  const activateTabByOffset: ActivateTabByOffsetFunction = (
    offset: number,
  ): void => {
    if (props.tabs.length === 0) {
      return;
    }
    const currentIndex: number = props.tabs.findIndex((t: Tab) => {
      return t.name === currentTabName;
    });
    const fromIndex: number = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex: number =
      (fromIndex + offset + props.tabs.length) % props.tabs.length;
    moveFocusToActiveTab.current = true;
    setCurrentTabName(props.tabs[nextIndex]!.name);
  };

  type HandleTabListKeyDownFunction = (
    event: React.KeyboardEvent<HTMLElement>,
  ) => void;

  const handleTabListKeyDown: HandleTabListKeyDownFunction = (
    event: React.KeyboardEvent<HTMLElement>,
  ): void => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      activateTabByOffset(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      activateTabByOffset(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      if (props.tabs.length > 0) {
        moveFocusToActiveTab.current = true;
        setCurrentTabName(props.tabs[0]!.name);
      }
    } else if (event.key === "End") {
      event.preventDefault();
      if (props.tabs.length > 0) {
        moveFocusToActiveTab.current = true;
        setCurrentTabName(props.tabs[props.tabs.length - 1]!.name);
      }
    }
  };

  // Initialize current tab only once, or when the tab list names change
  useEffect(() => {
    const tabNames: Array<string> = props.tabs.map((t: Tab) => {
      return t.name;
    });

    if (!hasInitialized.current && props.tabs.length > 0) {
      hasInitialized.current = true;
      setCurrentTabName(props.tabs[0]!.name);
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
  const currentTab: Tab | undefined = props.tabs.find((t: Tab) => {
    return t.name === currentTabName;
  });

  useEffect(() => {
    if (currentTab && props.onTabChange) {
      props.onTabChange(currentTab);
    }
  }, [currentTabName]);

  const tabPanelId: string = `tabpanel-${currentTabName || "default"}`;

  return (
    <div>
      <nav
        role="tablist"
        aria-orientation="horizontal"
        className="flex space-x-2 overflow-x-auto md:overflow-visible md:space-x-4"
        aria-label="Tabs"
        onKeyDown={handleTabListKeyDown}
      >
        {props.tabs.map((tab: Tab) => {
          return (
            <TabElement
              key={tab.name}
              tab={tab}
              onClick={() => {
                setCurrentTabName(tab.name);
              }}
              isSelected={tab.name === currentTabName}
              tabPanelId={tabPanelId}
            />
          );
        })}
      </nav>
      <div
        id={tabPanelId}
        role="tabpanel"
        aria-labelledby={`tab-${currentTabName || "default"}`}
        className="mt-3 ml-1"
      >
        {currentTab && currentTab.children}
      </div>
    </div>
  );
};

export default Tabs;

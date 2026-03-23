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
  const hasInitialized = useRef<boolean>(false);

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
        className="flex space-x-2 overflow-x-auto md:overflow-visible md:space-x-4"
        aria-label="Tabs"
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

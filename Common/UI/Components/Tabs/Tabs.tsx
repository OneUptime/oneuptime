import TabElement, { Tab } from "./Tab";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  tabs: Array<Tab>;
  onTabChange: (tab: Tab) => void;
}

const Tabs: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [currentTab, setCurrentTab] = useState<Tab | null>(null);

  useEffect(() => {
    setCurrentTab(props.tabs.length > 0 ? (props.tabs[0] as Tab) : null);
  }, [props.tabs]);

  useEffect(() => {
    if (currentTab && props.onTabChange) {
      props.onTabChange(currentTab);
    }
  }, [currentTab]);

  const tabPanelId: string = `tabpanel-${currentTab?.name || "default"}`;

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
                setCurrentTab(tab);
              }}
              isSelected={tab === currentTab}
              tabPanelId={tabPanelId}
            />
          );
        })}
      </nav>
      <div
        id={tabPanelId}
        role="tabpanel"
        aria-labelledby={`tab-${currentTab?.name || "default"}`}
        className="mt-3 ml-1"
      >
        {currentTab && currentTab.children}
      </div>
    </div>
  );
};

export default Tabs;

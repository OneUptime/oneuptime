import React, { FunctionComponent, ReactElement } from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";

/*
 * A part page's tabs, under its hero. A page with a single tab - a Swarm
 * node's or service's Overview, a task whose container sent no id yet -
 * draws that tab's cards without a tab row: a row of one tab is a control
 * that does nothing. With more, the row wraps on a narrow screen rather
 * than scrolling, and the cards under it line up with the hero above them
 * (an unwrapped row set them 4px in).
 */
export interface ComponentProps {
  tabs: Array<Tab>;
}

const ResourcePartTabs: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.tabs.length === 1) {
    return props.tabs[0]!.children;
  }

  return <Tabs tabs={props.tabs} wrap={true} onTabChange={() => {}} />;
};

export default ResourcePartTabs;

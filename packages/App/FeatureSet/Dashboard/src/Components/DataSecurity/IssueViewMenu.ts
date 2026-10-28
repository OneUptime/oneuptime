import PageMap from "../../Utils/PageMap";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * A data security issue's own menu, as data: its Overview - what is wrong,
 * why it matters and how to fix it - and its Timeline, then, under
 * Advanced (folded by its title, as every record's is), Delete Issue.
 *
 * An issue is opened by checks and worked on its own pages, never set up
 * as code, so it has no Developer section; its API and MCP tools are on
 * the Data Security docs.
 */

export interface IssueViewMenuItem {
  page: PageMap;
  title: string;
  icon: IconProp;
  isDestructive?: boolean | undefined;
}

export interface IssueViewMenuSection {
  title: string;
  items: Array<IssueViewMenuItem>;
}

export const DATA_SECURITY_ISSUE_MENU: Array<IssueViewMenuSection> = [
  {
    title: "Overview",
    items: [
      {
        page: PageMap.DATA_SECURITY_ISSUE_VIEW,
        title: "Overview",
        icon: IconProp.Info,
      },
      {
        page: PageMap.DATA_SECURITY_ISSUE_VIEW_TIMELINE,
        title: "Timeline",
        icon: IconProp.Timeline,
      },
    ],
  },
  {
    title: "Advanced",
    items: [
      {
        page: PageMap.DATA_SECURITY_ISSUE_VIEW_DELETE,
        title: "Delete Issue",
        icon: IconProp.Trash,
        isDestructive: true,
      },
    ],
  },
];

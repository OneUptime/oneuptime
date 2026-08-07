import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupTreeUtil, {
  StatusPageGroupIndex,
  StatusPageGroupIndexNode,
} from "Common/Utils/StatusPage/GroupTree";

/*
 * Group pickers - "Parent Group" on Status Page > Groups, "Add to Group" on
 * Status Page > Monitor Rules - list every group on the status page, and a
 * group's own name is not enough to pick by: two groups at different levels
 * are very often both called "Region 1000". Each option is labelled with its
 * full path instead.
 *
 * Building those labels one group at a time rederives the whole tree per
 * option, so a status page with a thousand groups walks a thousand groups a
 * thousand times just to fill a dropdown. One shared index, built once, is the
 * whole point of this module.
 *
 * React-free on purpose (same reason as StatusPageGroupCsv), so the shape below
 * is declared here rather than imported from the Dropdown component. It is the
 * subset of DropdownOption these pickers use.
 */
export interface StatusPageGroupDropdownOption {
  value: string;
  label: string;
}

export type ToStatusPageGroupDropdownOptionsFunction = (data: {
  statusPageGroups: Array<StatusPageGroup>;
}) => Array<StatusPageGroupDropdownOption>;

/*
 * Options in the order the status page renders the groups in - a parent
 * immediately above the groups nested under it - so scrolling the list walks
 * the tree instead of jumping around it.
 */
export const toStatusPageGroupDropdownOptions: ToStatusPageGroupDropdownOptionsFunction =
  (data: {
    statusPageGroups: Array<StatusPageGroup>;
  }): Array<StatusPageGroupDropdownOption> => {
    const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
      statusPageGroups: data.statusPageGroups,
    });

    return index.getNodesInTreeOrder().map((node: StatusPageGroupIndexNode) => {
      return {
        value: StatusPageGroupTreeUtil.getGroupId(node.group),
        label: index.getGroupPathLabel(node.group),
      };
    });
  };

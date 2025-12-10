import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import Dictionary from "../../Types/Dictionary";

export interface GetResourcesGroupedByGroupNameOptions {
  resources: Array<StatusPageResource>;
  defaultValue?: string;
}

export default class StatusPageResourceUtil {
  /**
   * Formats an array of StatusPageResource items into a string grouped by their resource group.
   *
   * If resources have no group or only one resource exists without a group, returns a simple comma-separated list.
   * If resources are grouped, returns a formatted string like:
   * "EU: Infrastructure, Website; UK: Infrastructure, API"
   *
   * @param resources - Array of StatusPageResource items with displayName, statusPageGroupId, and optionally statusPageGroup.name
   * @param defaultValue - Value to return if no resources (defaults to "None")
   * @returns Formatted string of resources grouped by their resource group
   */
  public static getResourcesGroupedByGroupName(
    resources: Array<StatusPageResource>,
    defaultValue: string = "",
  ): string {
    if (!resources || resources.length === 0) {
      return defaultValue;
    }

    // Check if any resource has a group
    const hasAnyGroup: boolean = resources.some((r: StatusPageResource) => {
      return r.statusPageGroupId || r.statusPageGroup;
    });

    // If no resources have groups, return simple comma-separated list
    if (!hasAnyGroup) {
      return (
        resources
          .map((r: StatusPageResource) => {
            return r.displayName;
          })
          .filter((name: string | undefined) => {
            return name;
          })
          .join(", ") || ""
      );
    }

    // Group resources by their group name
    const resourcesByGroup: Dictionary<Array<string>> = {};
    const ungroupedResources: Array<string> = [];

    for (const resource of resources) {
      const displayName: string | undefined = resource.displayName;
      if (!displayName) {
        continue;
      }

      const groupName: string | undefined =
        resource.statusPageGroup?.name || undefined;

      if (groupName) {
        if (!resourcesByGroup[groupName]) {
          resourcesByGroup[groupName] = [];
        }
        resourcesByGroup[groupName]!.push(displayName);
      } else {
        ungroupedResources.push(displayName);
      }
    }

    // Build the formatted string
    const formattedGroups: Array<string> = [];

    // Add grouped resources
    for (const groupName in resourcesByGroup) {
      const groupResources: Array<string> = resourcesByGroup[groupName]!;
      formattedGroups.push(`${groupName}: ${groupResources.join(", ")}`);
    }

    // Add ungrouped resources on separate lines (without "Other" label)
    if (ungroupedResources.length > 0) {
      for (const resourceName of ungroupedResources) {
        formattedGroups.push(resourceName);
      }
    }

    return formattedGroups.join("\n") || defaultValue;
  }
}

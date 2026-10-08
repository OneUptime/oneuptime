import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import Dictionary from "../../Types/Dictionary";
import SafeHtml from "../../Types/SafeHtml";

export interface GetResourcesGroupedByGroupNameOptions {
  resources: Array<StatusPageResource>;
  defaultValue?: string;
}

// Groups go on their own line in HTML emails.
export const HTML_RESOURCE_GROUP_SEPARATOR: string = "<br/>";

/*
 * SMS, Slack, Teams, email subjects and webhooks show "<br/>" as literal
 * text, so they get every group on one line. The names inside a group are
 * already comma-separated, which is why groups are split with a semicolon.
 */
export const PLAIN_TEXT_RESOURCE_GROUP_SEPARATOR: string = "; ";

type FormatNameFunction = (name: string) => string;

const asWritten: FormatNameFunction = (name: string): string => {
  return name;
};

export default class StatusPageResourceUtil {
  /**
   * Formats an array of StatusPageResource items into an HTML string grouped by their resource group.
   *
   * If resources have no group or only one resource exists without a group, returns a simple comma-separated list.
   * If resources are grouped, returns one group per line, like:
   * "EU: Infrastructure, Website<br/>UK: Infrastructure, API"
   *
   * The result is HTML: every resource name, group name and the default
   * value is HTML-escaped before it is joined, and the only markup is the
   * "<br/>" between groups. A project member names resources and groups, and
   * the default subscriber emails put this list into their raw-HTML slot, so
   * a name such as `<a href="https://evil.example">Checkout</a>` would
   * otherwise arrive as a live link. That is also what makes it safe to hand
   * a custom email template as SafeHtml.
   *
   * Use this only where the value is rendered as HTML (email bodies). Use
   * getResourcesGroupedByGroupNameAsPlainText everywhere else: it is not
   * escaped, because SMS, subjects and webhooks show text as written. Slack
   * and Teams messages are Markdown, and their callers escape it where they
   * place it (FeedMarkdown.templateText, SubscriberMarkdownTemplateValues).
   *
   * @param resources - Array of StatusPageResource items with displayName, statusPageGroupId, and optionally statusPageGroup.name
   * @param defaultValue - Value to return if no resources (defaults to "")
   * @returns Formatted string of resources grouped by their resource group
   */
  public static getResourcesGroupedByGroupName(
    resources: Array<StatusPageResource>,
    defaultValue: string = "",
  ): string {
    return StatusPageResourceUtil.formatResourcesGroupedByGroupName({
      resources: resources,
      defaultValue: defaultValue,
      groupSeparator: HTML_RESOURCE_GROUP_SEPARATOR,
      formatName: SafeHtml.escape,
    });
  }

  /**
   * The plain-text form of getResourcesGroupedByGroupName, for channels that
   * do not render HTML. Grouped resources come back on one line, like:
   * "EU: Infrastructure, Website; UK: Infrastructure, API"
   *
   * @param resources - Array of StatusPageResource items with displayName, statusPageGroupId, and optionally statusPageGroup.name
   * @param defaultValue - Value to return if no resources (defaults to "")
   * @returns Formatted string of resources grouped by their resource group
   */
  public static getResourcesGroupedByGroupNameAsPlainText(
    resources: Array<StatusPageResource>,
    defaultValue: string = "",
  ): string {
    return StatusPageResourceUtil.formatResourcesGroupedByGroupName({
      resources: resources,
      defaultValue: defaultValue,
      groupSeparator: PLAIN_TEXT_RESOURCE_GROUP_SEPARATOR,
      formatName: asWritten,
    });
  }

  /*
   * Groups are keyed by the name as written, so two groups are merged only
   * when their names really are the same; formatName (the HTML escaping, for
   * the HTML form) is applied to each piece of text as it is written out.
   */
  private static formatResourcesGroupedByGroupName(data: {
    resources: Array<StatusPageResource>;
    defaultValue: string;
    groupSeparator: string;
    formatName: FormatNameFunction;
  }): string {
    const { resources, groupSeparator, formatName } = data;
    const defaultValue: string = formatName(data.defaultValue);

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
          .filter((name: string | undefined): name is string => {
            return Boolean(name);
          })
          .map(formatName)
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
      formattedGroups.push(
        `${formatName(groupName)}: ${groupResources.map(formatName).join(", ")}`,
      );
    }

    // Add ungrouped resources on separate lines (without "Other" label)
    if (ungroupedResources.length > 0) {
      for (const resourceName of ungroupedResources) {
        formattedGroups.push(formatName(resourceName));
      }
    }

    return formattedGroups.join(groupSeparator) || defaultValue;
  }
}

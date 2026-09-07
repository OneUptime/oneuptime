import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getVMwareBreadcrumbs(path: string): Array<Link> | undefined {
  const links: Dictionary<Array<Link>> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_SOURCES, [
      "Project",
      "VMware",
      "Sources",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_SOURCE_VIEW, [
      "Project",
      "VMware",
      "Source",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_RESOURCE_VIEW, [
      "Project",
      "VMware",
      "Source",
      "Resources",
      "Resource",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_MONITORS, [
      "Project",
      "VMware",
      "Monitors",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_DOCUMENTATION, [
      "Project",
      "VMware",
      "Installation",
    ]),
  };
  return links[path];
}

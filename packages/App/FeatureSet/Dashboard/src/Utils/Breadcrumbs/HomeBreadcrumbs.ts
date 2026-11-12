import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

// The pages under Home (HomeRoutePath): Project > Home > the page.
export function getHomeBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.HOME_SETUP_HEALTH, [
      "Project",
      "Home",
      "Setup Health",
    ]),
  };
  return breadcrumpLinksMap[path];
}

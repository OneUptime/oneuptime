import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_SECTION_TITLE,
  DeveloperDocsPageDefinition,
  DeveloperDocsParentPage,
  DeveloperDocsScope,
  getDeveloperDocsPageKey,
  getDeveloperDocsParentPage,
} from "./DeveloperDocsPages";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  SideMenuItemProps,
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { ReactElement } from "react";

/*
 * The "Developer" section of a resource's side menus: Terraform, API and AI
 * Assistants. It starts collapsed, like Advanced (the section title is in
 * SideMenuSectionState's SECTION_TITLES_COLLAPSED_BY_DEFAULT), and opens by
 * itself on its own pages.
 *
 * Menus are written two ways, so it comes in both: section props for a menu
 * built from a `sections` array, and a <SideMenuSection> element for one
 * written in JSX. The element is returned by a function, not wrapped in a
 * component of its own, because SideMenu recognises its sections by type to
 * work out which one holds the current page.
 */

export interface DeveloperSideMenuSectionOptions {
  // The resource's model, which the menu already imports.
  modelType: DatabaseBaseModelType;
  scope: DeveloperDocsScope;
  // The resource, on a view menu.
  modelId?: ObjectID | undefined;
}

export function getDeveloperSideMenuItems(
  options: DeveloperSideMenuSectionOptions,
): Array<SideMenuItemProps> {
  const tableName: string = new options.modelType().tableName || "";
  const parent: DeveloperDocsParentPage | undefined =
    getDeveloperDocsParentPage(tableName, options.scope);

  if (!parent) {
    throw new Error(
      `${tableName} has no ${options.scope} page with Developer pages: add it to DEVELOPER_DOCS_PARENT_PAGES.`,
    );
  }

  return DEVELOPER_DOCS_PAGES.map(
    (page: DeveloperDocsPageDefinition): SideMenuItemProps => {
      return {
        link: {
          title: page.title,
          to: RouteUtil.populateRouteParams(
            RouteMap[getDeveloperDocsPageKey(parent.pageKey, page.type)] as Route,
            options.modelId ? { modelId: options.modelId } : undefined,
          ),
        },
        icon: page.icon,
      };
    },
  );
}

// For a menu built from a `sections` array.
export function getDeveloperSideMenuSectionProps(
  options: DeveloperSideMenuSectionOptions,
): SideMenuSectionProps {
  return {
    title: DEVELOPER_DOCS_SECTION_TITLE,
    items: getDeveloperSideMenuItems(options),
  };
}

/*
 * The sections a resource's view menu closes with: settings, owners and the
 * Delete page. The Developer section goes just before one, so Delete stays
 * the last entry of the menu.
 */
export const CLOSING_SECTION_TITLES: ReadonlyArray<string> = [
  "Advanced",
  "Manage",
  "Management",
  "Settings",
  "Danger Zone",
];

/*
 * Adds the Developer section to a menu built from a `sections` array, in
 * place: on a view menu just before the closing section (see
 * CLOSING_SECTION_TITLES), on a list menu at the end.
 */
export function addDeveloperSideMenuSection(
  sections: Array<SideMenuSectionProps>,
  options: DeveloperSideMenuSectionOptions,
): Array<SideMenuSectionProps> {
  const section: SideMenuSectionProps =
    getDeveloperSideMenuSectionProps(options);
  const last: SideMenuSectionProps | undefined = sections[sections.length - 1];

  if (
    options.scope === DeveloperDocsScope.View &&
    last &&
    CLOSING_SECTION_TITLES.includes(last.title)
  ) {
    sections.splice(sections.length - 1, 0, section);
  } else {
    sections.push(section);
  }

  return sections;
}

// For a menu written in JSX: `{getDeveloperSideMenuSection({...})}`.
export function getDeveloperSideMenuSection(
  options: DeveloperSideMenuSectionOptions,
): ReactElement {
  return (
    <SideMenuSection
      key="developer-docs-section"
      title={DEVELOPER_DOCS_SECTION_TITLE}
    >
      {getDeveloperSideMenuItems(options).map(
        (item: SideMenuItemProps): ReactElement => {
          return (
            <SideMenuItem
              key={item.link.title}
              link={item.link}
              icon={item.icon}
            />
          );
        },
      )}
    </SideMenuSection>
  );
}

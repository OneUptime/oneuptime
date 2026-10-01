import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_SECTION_TITLE,
  DeveloperDocsPageDefinition,
  DeveloperDocsResource,
  DeveloperDocsScope,
  getDeveloperDocsPageKey,
  getDeveloperDocsParentPageKey,
  getDeveloperDocsResource,
} from "./DeveloperDocsResources";
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
  modelType: DatabaseBaseModelType;
  scope: DeveloperDocsScope;
  // The resource on a view menu.
  modelId?: ObjectID | undefined;
}

export function getDeveloperSideMenuItems(
  options: DeveloperSideMenuSectionOptions,
): Array<SideMenuItemProps> {
  const resource: DeveloperDocsResource = getDeveloperDocsResource(
    options.modelType,
  );
  const parentPageKey: PageMap | undefined = getDeveloperDocsParentPageKey(
    resource,
    options.scope,
  );

  if (!parentPageKey) {
    throw new Error(
      `${options.modelType.name} has no ${options.scope} page with Developer pages: set it in DEVELOPER_DOCS_RESOURCES.`,
    );
  }

  return DEVELOPER_DOCS_PAGES.map(
    (page: DeveloperDocsPageDefinition): SideMenuItemProps => {
      return {
        link: {
          title: page.title,
          to: RouteUtil.populateRouteParams(
            RouteMap[getDeveloperDocsPageKey(parentPageKey, page.type)] as Route,
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

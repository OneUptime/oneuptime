import { DataTypeCategory, DataTypeDocumentation } from "./DataTypes";
import { ModelDocumentation } from "./Resources";
import { TranslateFn } from "./I18n";

/*
 * One description of the API reference's navigation, shared by everything that
 * needs to know what the site contains: the sidebar, the mobile drawer, the
 * command palette's search index, and the previous/next pager at the foot of
 * each page. Those four used to disagree - the sidebar built its list inline in
 * EJS, and nothing else had a list at all - so a page could be reachable from
 * one and invisible to the others.
 */

/** A single linkable page. `slug` is the last URL segment, never a full path. */
export interface ReferenceNavItem {
  name: string;
  slug: string;
  /** Shown under the name in search results; absent for guides. */
  description?: string;
}

/**
 * A run of items inside a section. `title` is null for the items that hang
 * directly off the section (data types with no category, every resource).
 */
export interface ReferenceNavGroup {
  title: string | null;
  items: Array<ReferenceNavItem>;
}

export interface ReferenceNavSection {
  /** Stable identifier - used for DOM ids and test assertions, never shown. */
  id: string;
  title: string;
  groups: Array<ReferenceNavGroup>;
}

export interface ReferenceNavAdjacent {
  previous: ReferenceNavItem | null;
  next: ReferenceNavItem | null;
}

export interface BuildNavigationOptions {
  t: TranslateFn;
  resources: Array<ModelDocumentation>;
  dataTypes: Array<DataTypeDocumentation>;
  /*
   * Master admin APIs only exist on a self-hosted install, so the guide is
   * hidden on the billing-enabled build - the same rule Resources.ts applies to
   * master-admin model docs.
   */
  showMasterAdminApis: boolean;
}

/**
 * The guides, in reading order. Kept here rather than in the template so the
 * pager and the search index see the same order the sidebar renders.
 */
const GUIDE_PAGES: Array<{ slug: string; labelKey: string }> = [
  { slug: "introduction", labelKey: "ui.introductionLink" },
  { slug: "authentication", labelKey: "ui.authenticationLink" },
  { slug: "pagination", labelKey: "ui.paginationLink" },
  { slug: "permissions", labelKey: "ui.permissionsLink" },
  { slug: "data-types", labelKey: "ui.dataTypesLink" },
  { slug: "errors", labelKey: "ui.errorsLink" },
  { slug: "openapi", labelKey: "ui.openApiSpecLink" },
];

const MASTER_ADMIN_GUIDE: { slug: string; labelKey: string } = {
  slug: "master-admin-apis",
  labelKey: "ui.masterAdminApisLink",
};

export const GUIDES_SECTION_ID: string = "guides";
export const RESOURCES_SECTION_ID: string = "resources";
export const DATA_TYPES_SECTION_ID: string = "data-types";

function buildGuideSection(
  options: BuildNavigationOptions,
): ReferenceNavSection {
  const guides: Array<{ slug: string; labelKey: string }> = [...GUIDE_PAGES];

  if (options.showMasterAdminApis) {
    guides.push(MASTER_ADMIN_GUIDE);
  }

  return {
    id: GUIDES_SECTION_ID,
    title: options.t("ui.guides"),
    groups: [
      {
        title: null,
        items: guides.map((guide: { slug: string; labelKey: string }) => {
          return { name: options.t(guide.labelKey), slug: guide.slug };
        }),
      },
    ],
  };
}

function buildResourceSection(
  options: BuildNavigationOptions,
): ReferenceNavSection {
  return {
    id: RESOURCES_SECTION_ID,
    title: options.t("ui.resources"),
    groups: [
      {
        title: null,
        items: options.resources.map((resource: ModelDocumentation) => {
          return {
            name: resource.name,
            slug: resource.path,
            description: resource.description,
          };
        }),
      },
    ],
  };
}

function buildDataTypeSection(
  options: BuildNavigationOptions,
): ReferenceNavSection {
  /*
   * Uncategorised types hang off the section directly (title null); the rest
   * keep the category headings DataTypes.ts already assigns them.
   */
  const uncategorised: Array<DataTypeDocumentation> = options.dataTypes.filter(
    (dataType: DataTypeDocumentation) => {
      return !dataType.category;
    },
  );

  const categories: Array<DataTypeCategory> = [];
  const seenCategories: Set<string> = new Set<string>();

  for (const dataType of options.dataTypes) {
    if (!dataType.category) {
      continue;
    }

    if (!seenCategories.has(dataType.category)) {
      seenCategories.add(dataType.category);
      categories.push({ name: dataType.category, types: [] });
    }

    categories
      .find((category: DataTypeCategory) => {
        return category.name === dataType.category;
      })!
      .types.push(dataType);
  }

  const toItem: (dataType: DataTypeDocumentation) => ReferenceNavItem = (
    dataType: DataTypeDocumentation,
  ): ReferenceNavItem => {
    return {
      name: dataType.name,
      slug: dataType.path,
      description: dataType.description,
    };
  };

  const groups: Array<ReferenceNavGroup> = [];

  if (uncategorised.length > 0) {
    groups.push({ title: null, items: uncategorised.map(toItem) });
  }

  for (const category of categories) {
    groups.push({ title: category.name, items: category.types.map(toItem) });
  }

  return {
    id: DATA_TYPES_SECTION_ID,
    title: options.t("ui.dataTypes"),
    groups: groups,
  };
}

/** Build the whole navigation tree, in the order it is rendered. */
export function buildReferenceNavigation(
  options: BuildNavigationOptions,
): Array<ReferenceNavSection> {
  const sections: Array<ReferenceNavSection> = [
    buildGuideSection(options),
    buildResourceSection(options),
  ];

  const dataTypeSection: ReferenceNavSection = buildDataTypeSection(options);

  if (dataTypeSection.groups.length > 0) {
    sections.push(dataTypeSection);
  }

  return sections;
}

/** Every item in the tree, flattened into the order a reader would meet them. */
export function flattenNavigation(
  sections: Array<ReferenceNavSection>,
): Array<ReferenceNavItem> {
  return sections.flatMap((section: ReferenceNavSection) => {
    return section.groups.flatMap((group: ReferenceNavGroup) => {
      return group.items;
    });
  });
}

/**
 * The pages either side of `slug` in reading order. Both ends are null-capped
 * rather than wrapped: a pager that loops from the last data type back to the
 * introduction reads as a bug, not a feature. An unknown slug - a 404, or a
 * page that is not in the nav - gets no pager at all.
 */
export function findAdjacentPages(
  sections: Array<ReferenceNavSection>,
  slug: string,
): ReferenceNavAdjacent {
  const items: Array<ReferenceNavItem> = flattenNavigation(sections);
  const index: number = items.findIndex((item: ReferenceNavItem) => {
    return item.slug === slug;
  });

  if (index === -1) {
    return { previous: null, next: null };
  }

  return {
    previous: index > 0 ? items[index - 1]! : null,
    next: index < items.length - 1 ? items[index + 1]! : null,
  };
}

export interface ReferenceNavLocation {
  section: ReferenceNavSection;
  group: ReferenceNavGroup;
  item: ReferenceNavItem;
}

/**
 * Where a slug sits in the tree. The breadcrumb needs the section title, the
 * sidebar needs to know which section to open, and both would otherwise walk
 * the tree themselves in the template.
 */
export function findNavLocation(
  sections: Array<ReferenceNavSection>,
  slug: string,
): ReferenceNavLocation | null {
  for (const section of sections) {
    for (const group of section.groups) {
      for (const item of group.items) {
        if (item.slug === slug) {
          return { section: section, group: group, item: item };
        }
      }
    }
  }

  return null;
}

export interface ReferenceSearchEntry {
  name: string;
  slug: string;
  section: string;
  description: string;
}

/**
 * Flat list the command palette filters over. Every entry carries the section
 * it came from so a result can say whether "Monitor" is a resource or a guide.
 */
export function buildSearchIndex(
  sections: Array<ReferenceNavSection>,
): Array<ReferenceSearchEntry> {
  const entries: Array<ReferenceSearchEntry> = [];

  for (const section of sections) {
    for (const group of section.groups) {
      for (const item of group.items) {
        entries.push({
          name: item.name,
          slug: item.slug,
          section: group.title
            ? `${section.title} · ${group.title}`
            : section.title,
          description: item.description || "",
        });
      }
    }
  }

  return entries;
}

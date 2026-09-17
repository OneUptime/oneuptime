import { DataTypeDocumentation } from "../../../FeatureSet/APIReference/Utils/DataTypes";
import {
  makeT,
  TranslateFn,
} from "../../../FeatureSet/APIReference/Utils/I18n";
import {
  buildReferenceNavigation,
  buildSearchIndex,
  findAdjacentPages,
  findNavLocation,
  ReferenceNavSection,
} from "../../../FeatureSet/APIReference/Utils/Navigation";
import { ModelDocumentation } from "../../../FeatureSet/APIReference/Utils/Resources";
import ejs from "ejs";
import path from "path";

/*
 * Fixtures for the view tests.
 *
 * The templates are rendered against these rather than against the live model
 * registry: the registry instantiates every documented model, which is slow, and
 * a test that asserts on "the third resource in the sidebar" would then break
 * every time somebody adds a model. What the registry produces is checked
 * separately, once, in Navigation.test.ts.
 */

export const VIEWS_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "APIReference",
  "views",
);

/*
 * `model` on ModelDocumentation is a live BaseModel and none of the navigation
 * or view code touches it, so the fixtures leave it unset behind a cast rather
 * than constructing models the test does not need.
 */
export const FIXTURE_RESOURCES: Array<ModelDocumentation> = [
  {
    name: "Incident",
    path: "incident",
    description: "An incident is an event that affects your services.",
    isAnalytics: false,
  },
  {
    name: "Monitor",
    path: "monitor",
    description: "Monitor is anything that monitors your API or website.",
    isAnalytics: false,
  },
  {
    name: "On-Call Duty Policy",
    path: "on-call-duty-policy",
    description: "The policy that decides who gets paged.",
    isAnalytics: false,
  },
  {
    name: "Status Page",
    path: "status-page",
    description: "A public page showing the health of your services.",
    isAnalytics: false,
  },
] as unknown as Array<ModelDocumentation>;

export const FIXTURE_DATA_TYPES: Array<DataTypeDocumentation> = [
  {
    name: "ObjectID",
    path: "object-id",
    description: "A unique identifier for objects.",
  },
  {
    name: "Decimal",
    path: "decimal",
    description: "A decimal number type.",
  },
  {
    name: "MonitorSteps",
    path: "monitor-steps",
    description: "Monitor check configuration.",
    category: "Monitor",
  },
  {
    name: "MonitorStep",
    path: "monitor-step",
    description: "A single monitor step.",
    category: "Monitor",
  },
];

export function fixtureNavigation(options?: {
  showMasterAdminApis?: boolean;
  lang?: string;
}): Array<ReferenceNavSection> {
  return buildReferenceNavigation({
    t: makeT(options?.lang || "en"),
    resources: FIXTURE_RESOURCES,
    dataTypes: FIXTURE_DATA_TYPES,
    showMasterAdminApis: options?.showMasterAdminApis ?? true,
  });
}

export interface CodeExampleFixture {
  requestPreview: { headers: string; body: string };
  [language: string]: unknown;
}

export function fixtureCodeExamples(
  body?: Record<string, unknown>,
): CodeExampleFixture {
  const languages: Array<string> = [
    "curl",
    "javascript",
    "typescript",
    "python",
    "go",
    "java",
    "csharp",
    "php",
    "ruby",
    "rust",
    "powershell",
  ];

  const examples: CodeExampleFixture = {
    requestPreview: {
      headers: "Content-Type: application/json\nApiKey: YOUR_API_KEY",
      body: body ? JSON.stringify(body, null, 2) : "",
    },
  };

  for (const language of languages) {
    examples[language] = `// ${language} example`;
  }

  return examples;
}

function fixtureColumn(
  type: string,
  required: boolean,
  description: string,
  permissions?: {
    create: Array<string>;
    read: Array<string>;
    update: Array<string>;
  },
): Record<string, unknown> {
  return {
    type: type,
    required: required,
    description: description,
    permissions: permissions || {
      create: ["CreateProjectMonitor"],
      read: ["ReadProjectMonitor"],
      update: ["EditProjectMonitor"],
    },
  };
}

export const MODEL_PAGE_DATA: Record<string, unknown> = {
  title: "Monitor",
  description: "Monitor is anything that monitors your API or website.",
  apiPath: "/api/monitor",
  columns: {
    _id: fixtureColumn("ObjectID", true, "ID of the object."),
    name: fixtureColumn("Name", true, "Name of the monitor."),
    createdAt: fixtureColumn("Date", false, "When the object was created.", {
      create: [],
      read: ["ReadProjectMonitor"],
      update: [],
    }),
  },
  tablePermissions: {
    read: [
      {
        permission: "ReadProjectMonitor",
        title: "Read Monitor",
        description: "Read a monitor.",
      },
    ],
    create: [
      {
        permission: "CreateProjectMonitor",
        title: "Create Monitor",
        description: "Create a monitor.",
      },
    ],
    update: [
      {
        permission: "EditProjectMonitor",
        title: "Edit Monitor",
        description: "Edit a monitor.",
      },
    ],
    delete: [
      {
        permission: "DeleteProjectMonitor",
        title: "Delete Monitor",
        description: "Delete a monitor.",
      },
    ],
  },
  exampleObjects: {
    simpleSelectExample: { _id: true, name: true },
    simpleQueryExample: { name: "Monitor name" },
    simpleSortExample: { createdAt: "ASC" },
    simpleCreateExample: { name: "Monitor name" },
    simpleUpdateExample: { name: "Monitor name" },
    simpleResponseExample: { _id: "monitor-id", name: "Monitor name" },
    simpleListResponseExample: [{ _id: "monitor-id", name: "Monitor name" }],
  },
  codeExamples: {
    list: fixtureCodeExamples({ query: {} }),
    getItem: fixtureCodeExamples({ select: { name: true } }),
    count: fixtureCodeExamples({ query: {} }),
    create: fixtureCodeExamples({ data: { name: "Monitor name" } }),
    update: fixtureCodeExamples({ data: { name: "Monitor name" } }),
    delete: fixtureCodeExamples(),
  },
  showAggregate: false,
  isMasterAdminApiDocs: false,
  exampleObjectID: "monitor-id",
};

export interface PageFixture {
  /** Template under views/main, without the extension. */
  page: string;
  /** Last URL segment, which is what the sidebar and pager key off. */
  slug: string;
  pageData: Record<string, unknown>;
}

export const PAGE_FIXTURES: Record<string, PageFixture> = {
  introduction: {
    page: "introduction",
    slug: "introduction",
    pageData: { featuredResources: FIXTURE_RESOURCES },
  },
  authentication: {
    page: "authentication",
    slug: "authentication",
    pageData: {},
  },
  pagination: {
    page: "pagination",
    slug: "pagination",
    pageData: {
      requestCode: '{ "query": {} }',
      responseCode: '{ "data": [], "count": 0 }',
    },
  },
  permissions: {
    page: "permissions",
    slug: "permissions",
    pageData: {
      permissionGroups: [
        {
          group: "Project",
          permissions: [
            {
              permission: "ProjectOwner",
              title: "Project Owner",
              description: "Owner of this project.",
            },
          ],
        },
        {
          group: "Monitor",
          permissions: [
            {
              permission: "CreateProjectMonitor",
              title: "Create Monitor",
              description: "Create a monitor.",
            },
          ],
        },
      ],
    },
  },
  errors: { page: "errors", slug: "errors", pageData: {} },
  openapi: {
    page: "openapi",
    slug: "openapi",
    pageData: { hostUrl: "https://oneuptime.com/" },
  },
  status: { page: "status", slug: "status", pageData: {} },
  notFound: { page: "404", slug: "page-not-found", pageData: {} },
  model: { page: "model", slug: "monitor", pageData: MODEL_PAGE_DATA },
};

export interface RenderOptions {
  lang?: string;
  showMasterAdminApis?: boolean;
  enableGoogleTagManager?: boolean;
}

/** Render a page through the real layout, exactly as the services do. */
export async function renderPage(
  fixture: PageFixture,
  options?: RenderOptions,
): Promise<string> {
  const lang: string = options?.lang || "en";
  const t: TranslateFn = makeT(lang);
  const navSections: Array<ReferenceNavSection> = fixtureNavigation({
    lang: lang,
    showMasterAdminApis: options?.showMasterAdminApis ?? true,
  });

  return (await ejs.renderFile(
    path.join(VIEWS_ROOT, "pages", "index.ejs"),
    {
      page: fixture.page,
      resources: FIXTURE_RESOURCES,
      dataTypes: FIXTURE_DATA_TYPES,
      pageTitle: fixture.slug,
      pageDescription: `Test render of ${fixture.slug}`,
      enableGoogleTagManager: options?.enableGoogleTagManager ?? false,
      pageData: fixture.pageData,
      lang: lang,
      t: t,
      supportedLanguages: [
        { code: "en", nativeName: "English" },
        { code: "de", nativeName: "Deutsch" },
      ],
      currentPath: `/reference/${lang}/${fixture.slug}`,
      showMasterAdminApis: options?.showMasterAdminApis ?? true,
      currentPage: fixture.slug,
      navSections: navSections,
      searchIndex: buildSearchIndex(navSections),
      pager: findAdjacentPages(navSections, fixture.slug),
      currentLocation: findNavLocation(navSections, fixture.slug),
    },
    { views: [VIEWS_ROOT] },
  )) as string;
}

/** Count non-overlapping occurrences of a literal in a string. */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  let count: number = 0;
  let index: number = haystack.indexOf(needle);

  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }

  return count;
}

/** Count regex matches. The pattern must carry the global flag. */
export function countMatches(haystack: string, pattern: RegExp): number {
  return Array.from(haystack.matchAll(pattern)).length;
}

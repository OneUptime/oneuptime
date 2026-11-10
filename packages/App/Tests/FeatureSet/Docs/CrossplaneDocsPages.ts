/*
 * The Crossplane provider's pages (issue #6587), by the paths their suites
 * name them with, and the words they keep as the product writes them.
 *
 * CrossplaneDocsFacts holds the English pages to the provider
 * (Scripts/CrossplaneProvider) and to the release that publishes it, and
 * CrossplaneDocsTranslations holds every translation to its English page.
 * They read the page lists and the kept words from here, never from each
 * other: importing a .test.ts file runs its tests.
 */

export interface CrossplaneDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const CROSSPLANE_OVERVIEW: string = "crossplane/index";
export const MANAGING_RESOURCES: string = "crossplane/managing-resources";

// Every page of the group, in nav order.
export const CROSSPLANE_PAGES: ReadonlyArray<CrossplaneDocsPageEntry> = [
  { page: CROSSPLANE_OVERVIEW, navTitle: "Crossplane Overview" },
  { page: MANAGING_RESOURCES, navTitle: "Managing Resources" },
];

/*
 * The whole Crossplane nav group: the pages above, in the same order. The
 * group's first page is where /docs/crossplane lands.
 */
export const CROSSPLANE_GROUP_URLS: ReadonlyArray<string> = [
  "/docs/crossplane/index",
  "/docs/crossplane/managing-resources",
];

// The nav group's title, as the docs' English locale keys it.
export const CROSSPLANE_NAV_GROUP: string = "Crossplane Provider";

/*
 * Bold words that are emphasis or a list item's lead, not a Dashboard
 * label: a translation words them freely.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [CROSSPLANE_OVERVIEW]: [
    "Crossplane 2.0 or later.",
    "An API key of your project.",
    "On OneUptime Cloud, the Growth plan or above.",
  ],
};

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, tools, formats and protocols, and the Kubernetes words a reader
 * types or reads in kubectl's output. A line made of them alone is not a
 * line left untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime Cloud",
  "OneUptime",
  "Crossplane",
  "Kubernetes",
  "Terraform",
  "Argo CD",
  "Flux",
  "Docker Hub",
  "Helm",
  "Sigstore",
  "cosign",
  "kubectl",
  "Secret",
  "Secrets",
  "ProviderConfig",
  "ClusterProviderConfig",
  "DeploymentRuntimeConfig",
  "ManagedResourceActivationPolicy",
  "CamelCase",
  "camelCase",
  "Spec",
  "Status",
  "List",
  "Definition",
  "JSON",
  "REST",
  "API",
  "CLI",
  "TLS",
  "URL",
  "ID",
  "IDs",
];

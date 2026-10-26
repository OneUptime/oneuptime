import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";

/*
 * What a list of records in a table's cell says for the items it folds
 * away (TableColumnListComponent's moreTemplate): a row's resources,
 * monitors, teams or hosts show three, then "2 more monitors", which opens
 * the rest.
 *
 * One sentence with its count in it, translated with each language's plural
 * forms ("Ещё мониторов: 5", "ほか 2 件のモニター", "모니터 2개 더", "另外
 * 2 个监视器"). The count used to be glued in front of words looked up on
 * their own: "2 件のモニター（ほか）" in Japanese, and English words after
 * the count in every language but German and Spanish.
 *
 * React-free, so App's tests can hold every language to these sentences.
 */

export const MORE_RESOURCES_TEMPLATE: PluralTemplate = {
  one: "{{count}} more resource",
  other: "{{count}} more resources",
};

export const MORE_MONITORS_TEMPLATE: PluralTemplate = {
  one: "{{count}} more monitor",
  other: "{{count}} more monitors",
};

export const MORE_TEAMS_TEMPLATE: PluralTemplate = {
  one: "{{count}} more team",
  other: "{{count}} more teams",
};

export const MORE_HOSTS_TEMPLATE: PluralTemplate = {
  one: "{{count}} more host",
  other: "{{count}} more hosts",
};

export const MORE_DOCKER_HOSTS_TEMPLATE: PluralTemplate = {
  one: "{{count}} more Docker host",
  other: "{{count}} more Docker hosts",
};

export const MORE_PODMAN_HOSTS_TEMPLATE: PluralTemplate = {
  one: "{{count}} more Podman host",
  other: "{{count}} more Podman hosts",
};

export const MORE_KUBERNETES_CLUSTERS_TEMPLATE: PluralTemplate = {
  one: "{{count}} more Kubernetes cluster",
  other: "{{count}} more Kubernetes clusters",
};

export const MORE_SERVICES_TEMPLATE: PluralTemplate = {
  one: "{{count}} more service",
  other: "{{count}} more services",
};

export const MORE_DATABASES_TEMPLATE: PluralTemplate = {
  one: "{{count}} more database",
  other: "{{count}} more databases",
};

export const MORE_SEVERITIES_TEMPLATE: PluralTemplate = {
  one: "{{count}} more severity",
  other: "{{count}} more severities",
};

export const MORE_RUNNERS_TEMPLATE: PluralTemplate = {
  one: "{{count}} more Runner",
  other: "{{count}} more Runners",
};

export const MORE_STATUS_PAGES_TEMPLATE: PluralTemplate = {
  one: "{{count}} more status page",
  other: "{{count}} more status pages",
};

// A service's languages and frameworks.
export const MORE_TECHNOLOGIES_TEMPLATE: PluralTemplate = {
  one: "{{count}} more technology",
  other: "{{count}} more technologies",
};

// Every sentence above, for the tests that hold each language to them.
export const MORE_ITEMS_TEMPLATES: ReadonlyArray<PluralTemplate> = [
  MORE_RESOURCES_TEMPLATE,
  MORE_MONITORS_TEMPLATE,
  MORE_TEAMS_TEMPLATE,
  MORE_HOSTS_TEMPLATE,
  MORE_DOCKER_HOSTS_TEMPLATE,
  MORE_PODMAN_HOSTS_TEMPLATE,
  MORE_KUBERNETES_CLUSTERS_TEMPLATE,
  MORE_SERVICES_TEMPLATE,
  MORE_DATABASES_TEMPLATE,
  MORE_SEVERITIES_TEMPLATE,
  MORE_RUNNERS_TEMPLATE,
  MORE_STATUS_PAGES_TEMPLATE,
  MORE_TECHNOLOGIES_TEMPLATE,
];

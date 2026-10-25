/*
 * The Backups page (docs/installation/backups): the Enterprise Edition's
 * backups of PostgreSQL and ClickHouse, set up in the Admin Dashboard
 * (Settings > Backups), by the path its suites name it with, where it sits
 * in the nav, and the words a translation draws from the Admin Dashboard,
 * keeps as written or words freely.
 *
 * BackupsDocsFacts holds the English page to the product; BackupsDocs-
 * Translations holds every translation to the English page. They read the
 * lists from here, never from each other: importing a .test.ts file runs
 * its tests.
 */

export const BACKUPS_PAGE: string = "installation/backups";

export const BACKUPS_NAV_TITLE: string = "Backups";

// Its nav group, and the links right before and after it.
export const BACKUPS_NAV_GROUP: string = "Installation";
export const BACKUPS_NAV_AFTER: string = "Upgrading";
export const BACKUPS_NAV_BEFORE: string = "Kubernetes and Helm";

/*
 * The Admin Dashboard page, by the keys of the Admin Dashboard's locale its
 * breadcrumb draws: Settings, then the page's own title (BackupsPaths).
 */
export const BACKUPS_ADMIN_PATH_KEYS: ReadonlyArray<string> = [
  "breadcrumbs.settings",
  "Backups",
];

/*
 * The bold leads of the page's own lists: neither Admin Dashboard labels
 * nor shown in English, so a translation words them freely.
 */
export const BACKUPS_PROSE_LEADS: ReadonlyArray<string> = [
  "Consistent.",
  "Straight to the destination.",
  "Checked.",
  "Encrypted.",
  "One at a time.",
  "The Enterprise Edition",
  "A master admin.",
  "A bucket or container for backups only",
  "A destination ClickHouse reaches too.",
  "To restore PostgreSQL, a database user that may create databases.",
];

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, editions, storages, protocols and tools. A line made of them
 * alone is not a line left untranslated.
 */
export const BACKUPS_NAMES: ReadonlyArray<string> = [
  "OneUptime",
  "Admin Dashboard",
  "Enterprise Edition",
  "PostgreSQL",
  "ClickHouse",
  "Amazon S3",
  "Cloudflare R2",
  "Backblaze B2",
  "Google Cloud Storage",
  "Azure Blob Storage",
  "Cloud Storage",
  "DigitalOcean Spaces",
  "Hetzner Object Storage",
  "Storage Object Admin",
  "Interoperability",
  "Wasabi",
  "MinIO",
  "Ceph",
  "AWS",
  "HMAC",
  "HTTPS",
  "SHA-256",
  "SSE-S3",
  "API",
  "UTC",
  "SAS",
  "R2",
  "S3",
];

/*
 * The widest label line of the page's diagram, counting a Chinese,
 * Japanese or Korean character twice: about 185px in a browser, which
 * Mermaid draws on one line inside its node.
 */
export const BACKUPS_WIDEST_DIAGRAM_LINE: number = 26;

// What the page's one diagram is: a backup's steps, top to bottom.
export const BACKUPS_DIAGRAM_KIND: string = "flowchart TB";

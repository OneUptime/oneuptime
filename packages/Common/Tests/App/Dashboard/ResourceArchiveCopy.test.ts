import { describe, expect, test } from "@jest/globals";
import {
  DASHBOARD_ARCHIVE_COPY,
  MONITOR_ARCHIVE_COPY,
  ON_CALL_POLICY_ARCHIVE_COPY,
  ResourceArchiveCopy,
  STATUS_PAGE_ARCHIVE_COPY,
  WORKFLOW_ARCHIVE_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ResourceArchiveCopy";

/*
 * What a user is told before and after archiving a workflow, a monitor, a
 * status page, a dashboard or an on-call policy.
 *
 * The generic archive copy describes a telemetry resource that keeps
 * collecting data while archived. For these resources archiving does the
 * opposite - it stops their work - so each says, in its own words, what
 * stops, that nothing is deleted, and how to undo it. These pin the promises
 * the server keeps (see the archive behaviour tests on the server side), so
 * the words cannot drift away from what actually happens.
 */

interface Entry {
  name: string;
  copy: ResourceArchiveCopy;
  // What the resource stops doing while archived, as each entry says it.
  stops: RegExp;
  // The list it leaves.
  list: string;
}

const ENTRIES: Array<Entry> = [
  {
    name: "workflow",
    copy: WORKFLOW_ARCHIVE_COPY,
    stops: /(stop(s)? running|does not run|do not run)/i,
    list: "Workflows list",
  },
  {
    name: "monitor",
    copy: MONITOR_ARCHIVE_COPY,
    stops: /(not checked|stop(s)? (being )?check)/i,
    list: "monitor lists",
  },
  {
    name: "status page",
    copy: STATUS_PAGE_ARCHIVE_COPY,
    stops: /offline/i,
    list: "Status Pages list",
  },
  {
    name: "dashboard",
    copy: DASHBOARD_ARCHIVE_COPY,
    stops: /public link/i,
    list: "Dashboards list",
  },
  {
    name: "on-call policy",
    copy: ON_CALL_POLICY_ARCHIVE_COPY,
    stops: /pages? no one|stop(s)? it paging/i,
    list: "On-Call Policies list",
  },
];

const FIELDS: Array<keyof ResourceArchiveCopy> = [
  "singularName",
  "pluralName",
  "archiveCardDescription",
  "unarchiveCardDescription",
  "archiveConfirmMessage",
  "unarchiveConfirmMessage",
  "bulkArchiveConfirmMessage",
  "bulkUnarchiveConfirmMessage",
  "bannerTitle",
  "bannerBody",
  "archivedPageTitle",
  "archivedPageDescription",
  "noArchivedItemsMessage",
];

describe.each(ENTRIES)("archive copy for a $name", (entry: Entry) => {
  test("says something in every place the copy is read", () => {
    for (const field of FIELDS) {
      expect(entry.copy[field].trim().length).toBeGreaterThan(0);
    }
  });

  test("is named for the resource, in the singular and the plural", () => {
    expect(entry.copy.singularName).toBe(entry.name);
    expect(entry.copy.pluralName.startsWith(entry.name.slice(0, -1))).toBe(
      true,
    );
    expect(entry.copy.bannerTitle).toBe(`This ${entry.name} is archived`);
    expect(entry.copy.archivedPageTitle.startsWith("Archived ")).toBe(true);
  });

  test("never borrows the telemetry wording, which promises the opposite", () => {
    for (const field of FIELDS) {
      expect(entry.copy[field].toLowerCase()).not.toContain("telemetry");
      expect(entry.copy[field].toLowerCase()).not.toContain("keeps collecting");
    }
  });

  test("says what stops, before archiving and while archived", () => {
    expect(entry.copy.archiveConfirmMessage).toMatch(entry.stops);
    expect(entry.copy.bulkArchiveConfirmMessage).toMatch(entry.stops);
    expect(entry.copy.bannerBody).toMatch(entry.stops);
    expect(entry.copy.unarchiveCardDescription).toMatch(entry.stops);
  });

  test("says which list it leaves", () => {
    expect(entry.copy.archiveConfirmMessage).toContain(entry.list);
    expect(entry.copy.archivedPageDescription).toContain(entry.list);
  });

  test("says it can be undone, and how", () => {
    expect(entry.copy.archiveConfirmMessage).toMatch(/unarchive/i);
    expect(entry.copy.bulkArchiveConfirmMessage).toMatch(/unarchive/i);
    expect(entry.copy.bannerBody).toMatch(/Unarchive/);
    expect(entry.copy.unarchiveCardDescription).toMatch(/Unarchive/);
  });

  test("asks before archiving or unarchiving one, and the bulk confirmations do not ask again", () => {
    expect(entry.copy.archiveConfirmMessage).toMatch(/^Archive this .*\?/);
    expect(entry.copy.unarchiveConfirmMessage).toMatch(/^Unarchive this .*\?/);
    // The bulk dialog's title already asks "Archive 3 workflows?".
    expect(entry.copy.bulkArchiveConfirmMessage).not.toContain("?");
    expect(entry.copy.bulkUnarchiveConfirmMessage).not.toContain("?");
  });

  test("tells someone with nothing archived how to archive one", () => {
    expect(entry.copy.noArchivedItemsMessage).toMatch(/^No archived /);
    expect(entry.copy.noArchivedItemsMessage).toContain("choose Archive");
  });
});

describe("what each resource's copy promises, resource by resource", () => {
  test("a workflow stops on every trigger, and runs again on unarchive only if enabled", () => {
    expect(WORKFLOW_ARCHIVE_COPY.archiveConfirmMessage).toContain(
      "every trigger",
    );
    expect(WORKFLOW_ARCHIVE_COPY.archiveConfirmMessage).toContain(
      "runs that are waiting will be cancelled",
    );
    expect(WORKFLOW_ARCHIVE_COPY.unarchiveConfirmMessage).toContain(
      "only if it is enabled",
    );
    expect(WORKFLOW_ARCHIVE_COPY.bulkUnarchiveConfirmMessage).toContain(
      "only if it is enabled",
    );
  });

  test("a monitor opens nothing new, but what is open stays open", () => {
    expect(MONITOR_ARCHIVE_COPY.archiveConfirmMessage).toContain(
      "open no incidents or alerts",
    );
    expect(MONITOR_ARCHIVE_COPY.archiveConfirmMessage).toContain(
      "Incidents and alerts that are open stay open",
    );
    expect(MONITOR_ARCHIVE_COPY.archiveConfirmMessage).toContain(
      "status pages",
    );
    expect(MONITOR_ARCHIVE_COPY.unarchiveConfirmMessage).toContain(
      "unless the monitor is disabled",
    );
  });

  test("a status page answers 'page not found', on its custom domains too, and sends subscribers nothing", () => {
    expect(STATUS_PAGE_ARCHIVE_COPY.archiveConfirmMessage).toContain(
      '"page not found"',
    );
    expect(STATUS_PAGE_ARCHIVE_COPY.archiveConfirmMessage).toContain(
      "custom domains",
    );
    expect(STATUS_PAGE_ARCHIVE_COPY.archiveConfirmMessage).toContain(
      "subscribers will be sent nothing",
    );
    expect(STATUS_PAGE_ARCHIVE_COPY.archiveConfirmMessage).toContain(
      "subscribers are kept",
    );
  });

  test("a dashboard's public link stops working, only if it is public", () => {
    expect(DASHBOARD_ARCHIVE_COPY.archiveConfirmMessage).toContain(
      "if it is public, its public link will stop working",
    );
    expect(DASHBOARD_ARCHIVE_COPY.unarchiveConfirmMessage).toContain(
      "if it is public",
    );
  });

  test("an on-call policy stops paging at once, including executions already escalating", () => {
    expect(ON_CALL_POLICY_ARCHIVE_COPY.archiveConfirmMessage).toContain(
      "right away",
    );
    expect(ON_CALL_POLICY_ARCHIVE_COPY.archiveConfirmMessage).toContain(
      "including any escalating now",
    );
    expect(ON_CALL_POLICY_ARCHIVE_COPY.bulkArchiveConfirmMessage).toContain(
      "including any escalating now",
    );
  });

  test("a status page is archived from its Advanced Settings; the others from Settings", () => {
    expect(STATUS_PAGE_ARCHIVE_COPY.noArchivedItemsMessage).toContain(
      "open its Advanced Settings",
    );

    for (const copy of [
      WORKFLOW_ARCHIVE_COPY,
      MONITOR_ARCHIVE_COPY,
      DASHBOARD_ARCHIVE_COPY,
      ON_CALL_POLICY_ARCHIVE_COPY,
    ]) {
      expect(copy.noArchivedItemsMessage).toContain("open its Settings");
    }
  });
});

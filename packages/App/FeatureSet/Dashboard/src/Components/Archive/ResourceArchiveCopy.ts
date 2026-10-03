import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What archiving means, in the words each archivable resource's pages use.
 *
 * Archiving is the same idea everywhere - the resource leaves its list,
 * stops doing its work, keeps everything it had, and comes back with one
 * click - but "its work" differs: a workflow stops running, a monitor stops
 * being checked, a status page goes offline. The generic copy on
 * ArchiveResourceCard and useBulkArchiveActions describes a telemetry
 * resource that keeps ingesting while archived, which would tell the user the
 * opposite of what happens here, so every place these resources can be
 * archived or restored reads its words from one entry below: the Settings
 * card, the bulk actions, the banner on an archived resource's pages, and its
 * Archived page. Each entry is written to make sense on its own.
 *
 * Every value is an English key: the components that draw them translate
 * them, so a reader sees each one in their own language.
 */
export interface ResourceArchiveCopy {
  // "workflow" - used in titles such as "Archive workflow".
  singularName: string;
  // "workflows" - used in "Archive 3 workflows?".
  pluralName: string;
  // Settings card, while the resource is live.
  archiveCardDescription: string;
  // Settings card, while the resource is archived.
  unarchiveCardDescription: string;
  // Confirmation before archiving one resource from its Settings card.
  archiveConfirmMessage: string;
  // Confirmation before unarchiving one resource (Settings card or banner).
  unarchiveConfirmMessage: string;
  // Bulk confirmation; the title above it already says how many.
  bulkArchiveConfirmMessage: string;
  bulkUnarchiveConfirmMessage: string;
  // The banner across the top of an archived resource's pages.
  bannerTitle: string;
  bannerBody: string;
  // The Archived page.
  archivedPageTitle: string;
  archivedPageDescription: string;
  noArchivedItemsMessage: string;
}

export const WORKFLOW_ARCHIVE_COPY: ResourceArchiveCopy = {
  singularName: translationKey("workflow"),
  pluralName: translationKey("workflows"),
  archiveCardDescription: translationKey(
    "Archive this workflow to stop it running and hide it from the Workflows list. Nothing is deleted: its steps, variables and run history are kept, and you can unarchive it at any time.",
  ),
  unarchiveCardDescription: translationKey(
    "This workflow is archived: it is hidden from the Workflows list and does not run from any trigger. Unarchive it to bring it back. It runs again only if it is enabled.",
  ),
  archiveConfirmMessage: translationKey(
    "Archive this workflow? It will stop running from every trigger - manual runs, webhooks, schedules, events and emails - and runs that are waiting will be cancelled. It will be hidden from the Workflows list. You can unarchive it at any time.",
  ),
  unarchiveConfirmMessage: translationKey(
    "Unarchive this workflow? It will reappear in the Workflows list. It runs again only if it is enabled.",
  ),
  bulkArchiveConfirmMessage: translationKey(
    "Archived workflows stop running from every trigger and are hidden from the Workflows list. Nothing is deleted, and you can unarchive them at any time.",
  ),
  bulkUnarchiveConfirmMessage: translationKey(
    "Unarchived workflows reappear in the Workflows list. Each one runs again only if it is enabled.",
  ),
  bannerTitle: translationKey("This workflow is archived"),
  bannerBody: translationKey(
    "It does not run from any trigger and is hidden from the Workflows list. Unarchive it to bring it back.",
  ),
  archivedPageTitle: translationKey("Archived Workflows"),
  archivedPageDescription: translationKey(
    "Workflows you archived. They are hidden from the Workflows list and do not run from any trigger. Select workflows to unarchive them.",
  ),
  noArchivedItemsMessage: translationKey(
    "No archived workflows. To archive one, select it in the Workflows list and choose Archive, or open its Settings.",
  ),
};

export const MONITOR_ARCHIVE_COPY: ResourceArchiveCopy = {
  singularName: translationKey("monitor"),
  pluralName: translationKey("monitors"),
  archiveCardDescription: translationKey(
    "Archive this monitor to stop checking it and hide it from monitor lists and status pages. Nothing is deleted: its settings and history are kept, and you can unarchive it at any time.",
  ),
  unarchiveCardDescription: translationKey(
    "This monitor is archived: it is not checked, opens no incidents or alerts, and is hidden from monitor lists and status pages. Unarchive it to start monitoring again.",
  ),
  archiveConfirmMessage: translationKey(
    "Archive this monitor? It will stop being checked and will open no incidents or alerts. It will be hidden from monitor lists, status pages and monitor groups. Incidents and alerts that are open stay open. You can unarchive it at any time.",
  ),
  unarchiveConfirmMessage: translationKey(
    "Unarchive this monitor? It will reappear in monitor lists and on status pages, and monitoring resumes unless the monitor is disabled.",
  ),
  bulkArchiveConfirmMessage: translationKey(
    "Archived monitors are not checked, open no incidents or alerts, and are hidden from monitor lists and status pages. Incidents and alerts that are open stay open. You can unarchive them at any time.",
  ),
  bulkUnarchiveConfirmMessage: translationKey(
    "Unarchived monitors reappear in monitor lists and on status pages, and monitoring resumes for each one that is not disabled.",
  ),
  bannerTitle: translationKey("This monitor is archived"),
  bannerBody: translationKey(
    "It is not checked, opens no incidents or alerts, and is hidden from monitor lists and status pages. Unarchive it to start monitoring again.",
  ),
  archivedPageTitle: translationKey("Archived Monitors"),
  archivedPageDescription: translationKey(
    "Monitors you archived. They are not checked, open no incidents or alerts, and are hidden from monitor lists and status pages. Select monitors to unarchive them.",
  ),
  noArchivedItemsMessage: translationKey(
    "No archived monitors. To archive one, select it in the monitor list and choose Archive, or open its Settings.",
  ),
};

export const STATUS_PAGE_ARCHIVE_COPY: ResourceArchiveCopy = {
  singularName: translationKey("status page"),
  pluralName: translationKey("status pages"),
  archiveCardDescription: translationKey(
    'Archive this status page to take it offline and hide it from the Status Pages list. Visitors see "page not found" and subscribers are sent nothing. Its settings and subscribers are kept, and you can unarchive it at any time.',
  ),
  unarchiveCardDescription: translationKey(
    "This status page is archived: it is offline, sends nothing to its subscribers, and is hidden from the Status Pages list. Unarchive it to put it back online.",
  ),
  archiveConfirmMessage: translationKey(
    'Archive this status page? It goes offline right away - visitors, including those on its custom domains, will see "page not found" - and its subscribers will be sent nothing. It will be hidden from the Status Pages list. Its settings and subscribers are kept, and you can unarchive it at any time.',
  ),
  unarchiveConfirmMessage: translationKey(
    "Unarchive this status page? It will be back online, and its subscribers will get notifications again.",
  ),
  bulkArchiveConfirmMessage: translationKey(
    'Archived status pages go offline (visitors see "page not found"), send nothing to their subscribers and are hidden from the Status Pages list. Nothing is deleted, and you can unarchive them at any time.',
  ),
  bulkUnarchiveConfirmMessage: translationKey(
    "Unarchived status pages are back online, and their subscribers get notifications again.",
  ),
  bannerTitle: translationKey("This status page is archived"),
  bannerBody: translationKey(
    'It is offline - visitors see "page not found" - and it sends nothing to its subscribers. Unarchive it to put it back online.',
  ),
  archivedPageTitle: translationKey("Archived Status Pages"),
  archivedPageDescription: translationKey(
    "Status pages you archived. They are offline, send nothing to their subscribers, and are hidden from the Status Pages list. Select status pages to unarchive them.",
  ),
  noArchivedItemsMessage: translationKey(
    "No archived status pages. To archive one, select it in the Status Pages list and choose Archive, or open its Advanced Settings.",
  ),
};

export const DASHBOARD_ARCHIVE_COPY: ResourceArchiveCopy = {
  singularName: translationKey("dashboard"),
  pluralName: translationKey("dashboards"),
  archiveCardDescription: translationKey(
    "Archive this dashboard to hide it from the Dashboards list. If it is public, its public link stops working. Nothing is deleted, and you can unarchive it at any time.",
  ),
  unarchiveCardDescription: translationKey(
    "This dashboard is archived: it is hidden from the Dashboards list and its public link does not work. Unarchive it to bring it back as it was.",
  ),
  archiveConfirmMessage: translationKey(
    "Archive this dashboard? It will be hidden from the Dashboards list, and if it is public, its public link will stop working. You can unarchive it at any time.",
  ),
  unarchiveConfirmMessage: translationKey(
    "Unarchive this dashboard? It will reappear in the Dashboards list, and its public link works again if it is public.",
  ),
  bulkArchiveConfirmMessage: translationKey(
    "Archived dashboards are hidden from the Dashboards list, and public ones stop working at their public link. Nothing is deleted, and you can unarchive them at any time.",
  ),
  bulkUnarchiveConfirmMessage: translationKey(
    "Unarchived dashboards reappear in the Dashboards list, and public ones work at their public link again.",
  ),
  bannerTitle: translationKey("This dashboard is archived"),
  bannerBody: translationKey(
    "It is hidden from the Dashboards list, and its public link does not work. Unarchive it to bring it back.",
  ),
  archivedPageTitle: translationKey("Archived Dashboards"),
  archivedPageDescription: translationKey(
    "Dashboards you archived. They are hidden from the Dashboards list and their public links do not work. Select dashboards to unarchive them.",
  ),
  noArchivedItemsMessage: translationKey(
    "No archived dashboards. To archive one, select it in the Dashboards list and choose Archive, or open its Settings.",
  ),
};

export const ON_CALL_POLICY_ARCHIVE_COPY: ResourceArchiveCopy = {
  singularName: translationKey("on-call policy"),
  pluralName: translationKey("on-call policies"),
  archiveCardDescription: translationKey(
    "Archive this policy to stop it paging anyone and hide it from the On-Call Policies list. Incidents and alerts that use it will page no one through it. Nothing is deleted, and you can unarchive it at any time.",
  ),
  unarchiveCardDescription: translationKey(
    "This on-call policy is archived: it pages no one and is hidden from the On-Call Policies list. Unarchive it to put it back in service.",
  ),
  archiveConfirmMessage: translationKey(
    "Archive this on-call policy? It stops paging anyone right away: incidents and alerts that use it - including any escalating now - will page no one through it. It will be hidden from the On-Call Policies list. You can unarchive it at any time.",
  ),
  unarchiveConfirmMessage: translationKey(
    "Unarchive this on-call policy? It will page people again for new incidents and alerts that use it.",
  ),
  bulkArchiveConfirmMessage: translationKey(
    "Archived on-call policies page no one - incidents and alerts that use them, including any escalating now, skip them - and are hidden from the On-Call Policies list. You can unarchive them at any time.",
  ),
  bulkUnarchiveConfirmMessage: translationKey(
    "Unarchived on-call policies page people again for new incidents and alerts that use them.",
  ),
  bannerTitle: translationKey("This on-call policy is archived"),
  bannerBody: translationKey(
    "It pages no one: incidents and alerts that use it skip it. It is hidden from the On-Call Policies list. Unarchive it to put it back in service.",
  ),
  archivedPageTitle: translationKey("Archived On-Call Policies"),
  archivedPageDescription: translationKey(
    "On-call policies you archived. They page no one and are hidden from the On-Call Policies list. Select policies to unarchive them.",
  ),
  noArchivedItemsMessage: translationKey(
    "No archived on-call policies. To archive one, select it in the On-Call Policies list and choose Archive, or open its Settings.",
  ),
};

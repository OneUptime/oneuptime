import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import { AskAiRecordKind } from "../../../../Types/AI/AskAiRecordPages";
import {
  AI_DASHBOARD_PAGES,
  AIDashboardPage,
  AIDashboardPageKind,
} from "../Docs/DashboardPageFinder";
import DashboardRecordPageFinder from "../Docs/DashboardRecordPageFinder";

/*
 * THE PAGE ASK AI IS OPEN ON, IN THE DASHBOARD'S OWN WORDS (#7062).
 *
 * The Dashboard sends which page is on screen as its route template
 * (AIChatPageContext.page): "/dashboard/:projectId/settings/api-keys",
 * "/dashboard/:projectId/status-pages/:id/domains". The prompt names it
 * from the server's own catalogs of the Dashboard's pages - the project's
 * (DashboardPages.json) and one record's (DashboardRecordPages.json), both
 * generated from Search's indexes - so "how do I add someone here?" is
 * answered for that page, by the name its menu gives it. A route neither
 * catalog holds is named nothing: no word the client sent reaches the
 * prompt as it was written.
 */

export interface PageContextPage {
  // Its name, as its menu gives it: "API Keys".
  title: string;
  // Where it is and its name, as the menus say it: "Project Settings > Advanced > API Keys".
  menuPath: string;
  // Whether it creates something: Create Monitor, Declare Incident.
  isCreateForm: boolean;
}

/*
 * The kind of record whose own pages a context's record has, for
 * find_dashboard_page's recordType (#7065).
 */
export const RECORD_KIND_OF_PAGE_CONTEXT: Readonly<
  Partial<Record<AIChatPageContextType, AskAiRecordKind>>
> = {
  [AIChatPageContextType.Incident]: AskAiRecordKind.Incident,
  [AIChatPageContextType.Alert]: AskAiRecordKind.Alert,
  [AIChatPageContextType.Monitor]: AskAiRecordKind.Monitor,
  [AIChatPageContextType.ScheduledMaintenanceEvent]:
    AskAiRecordKind.MaintenanceEvent,
  [AIChatPageContextType.TelemetryService]: AskAiRecordKind.Service,
  [AIChatPageContextType.Workflow]: AskAiRecordKind.Workflow,
  [AIChatPageContextType.StatusPage]: AskAiRecordKind.StatusPage,
  [AIChatPageContextType.OnCallPolicy]: AskAiRecordKind.OnCallPolicy,
  // The records whose pages sent no context before #10104.
  [AIChatPageContextType.OnCallSchedule]: AskAiRecordKind.OnCallSchedule,
  [AIChatPageContextType.Team]: AskAiRecordKind.Team,
  [AIChatPageContextType.Dashboard]: AskAiRecordKind.Dashboard,
  [AIChatPageContextType.Runbook]: AskAiRecordKind.Runbook,
  [AIChatPageContextType.Slo]: AskAiRecordKind.Slo,
  [AIChatPageContextType.IncomingCallPolicy]:
    AskAiRecordKind.IncomingCallPolicy,
  [AIChatPageContextType.Form]: AskAiRecordKind.Form,
};

const routeOf: (path: string) => string = (path: string): string => {
  return path.split(/[?#]/)[0] || "";
};

/*
 * The order a page is named by among those of one address: the page
 * itself, then a form that creates something on it, then a setting on it -
 * or, on a create form, the form first: a list's Create Status Page opens
 * on the list's own address (?create=1).
 */
const PAGE_FIRST: ReadonlyArray<AIDashboardPageKind> = [
  AIDashboardPageKind.Page,
  AIDashboardPageKind.Action,
  AIDashboardPageKind.Setting,
];

const FORM_FIRST: ReadonlyArray<AIDashboardPageKind> = [
  AIDashboardPageKind.Action,
  AIDashboardPageKind.Page,
  AIDashboardPageKind.Setting,
];

// The page of the project a route is, as the catalog names it.
const findProjectPage: (data: {
  route: string;
  isCreateForm: boolean;
}) => AIDashboardPage | undefined = (data: {
  route: string;
  isCreateForm: boolean;
}): AIDashboardPage | undefined => {
  const order: ReadonlyArray<AIDashboardPageKind> = data.isCreateForm
    ? FORM_FIRST
    : PAGE_FIRST;
  const candidates: Array<AIDashboardPage> = AI_DASHBOARD_PAGES.filter(
    (page: AIDashboardPage): boolean => {
      return routeOf(page.path) === data.route;
    },
  );

  // Then its own address before one with a query or an anchor.
  return candidates.sort((a: AIDashboardPage, b: AIDashboardPage): number => {
    return (
      order.indexOf(a.kind) - order.indexOf(b.kind) ||
      Number(a.path !== data.route) - Number(b.path !== data.route)
    );
  })[0];
};

/*
 * The page a context says is on screen, named from the catalogs, or null
 * when it says none or one the catalogs do not hold.
 */
export const getPageContextPage: (
  context: AIChatPageContext,
) => PageContextPage | null = (
  context: AIChatPageContext,
): PageContextPage | null => {
  if (!context.page) {
    return null;
  }

  const route: string = routeOf(context.page);
  const recordPage: ReturnType<typeof DashboardRecordPageFinder.getPageByPath> =
    DashboardRecordPageFinder.getPageByPath(route);

  if (recordPage) {
    const { kind, page } = recordPage;

    return {
      title: page.title,
      menuPath: (page.section === page.title
        ? [kind.recordName, page.title]
        : [kind.recordName, page.section, page.title]
      ).join(" > "),
      isCreateForm: false,
    };
  }

  const projectPage: AIDashboardPage | undefined = findProjectPage({
    route,
    isCreateForm: context.type === AIChatPageContextType.CreateForm,
  });

  if (!projectPage) {
    return null;
  }

  return {
    title: projectPage.title,
    menuPath: [...projectPage.where, projectPage.title].join(" > "),
    isCreateForm: projectPage.kind === AIDashboardPageKind.Action,
  };
};

import ProductKey from "../Product/ProductKey";

/*
 * THE RECORDS WHOSE OWN PAGES ASK AI OPENS (#7065).
 *
 * A "how do I...?" answer ends with a "Go to <page>" button (#6828). It
 * opened a page of the project only - Create Monitor, Notification Methods
 * - so "how do I put this status page on my own domain?" could not take
 * anyone to that status page's Custom Domains. Now find_dashboard_page
 * also finds one record's own pages: its kind, as named here, and its id.
 *
 * Each kind is a record menu of Search's record page index
 * (RecordPageSearchIndex.ts, #9204), named by the id Search gives it there,
 * so a page Search opens for a record is a page Ask AI can send someone
 * to, under the same name. Its pages are generated into the server's
 * catalog (Server/Utils/AI/Docs/DashboardRecordPages.json) by App's
 * AIDashboardRecordPagesCatalog test, with each page's route from RouteMap.
 * The server reads the record with the person's own permissions before a
 * page of it is offered (Server/Utils/AI/Docs/DashboardRecordReaders), so a
 * record the person may not read gets no button.
 *
 * The kinds are the ones people set up and ask "how do I" about: a status
 * page's domain or sign-in, a monitor's criteria, a policy's escalation.
 * Adding one is a line here and a reader on the server; the catalog's test
 * says what else to do.
 *
 * Pure: the server, the Dashboard and the tests read it.
 */

export enum AskAiRecordKind {
  StatusPage = "status-pages",
  Monitor = "monitors",
  Incident = "incidents",
  Alert = "alerts",
  OnCallPolicy = "on-call-policies",
  OnCallSchedule = "on-call-schedules",
  IncomingCallPolicy = "incoming-call-policies",
  MaintenanceEvent = "scheduled-maintenance",
  Service = "services",
  Team = "teams",
  Workflow = "workflows",
  Dashboard = "dashboards",
  Runbook = "runbooks",
  Slo = "slos",
  Form = "forms",
}

export const ASK_AI_RECORD_KINDS: ReadonlyArray<AskAiRecordKind> =
  Object.values(AskAiRecordKind);

export const isAskAiRecordKind: (value: unknown) => value is AskAiRecordKind = (
  value: unknown,
): value is AskAiRecordKind => {
  return (
    typeof value === "string" &&
    (ASK_AI_RECORD_KINDS as ReadonlyArray<string>).includes(value)
  );
};

/*
 * The parameter a record's route takes its id by (the Dashboard's
 * RouteParams.ModelID): "/dashboard/:projectId/status-pages/:id/domains".
 */
export const ASK_AI_RECORD_ROUTE_PARAM: string = ":id";

// A page of one record, as the server's catalog keeps it.
export interface AskAiRecordPage {
  // Its English title, as the record's menu names it: "Custom Domains".
  title: string;
  // The menu section it sits in: "Branding".
  section: string;
  // Other words for it: its former titles, and what people type for it.
  keywords?: Array<string> | undefined;
  /*
   * Its route template, with the query string its menu link carries:
   * "/dashboard/:projectId/status-pages/:id/domains".
   */
  path: string;
  /*
   * Every product the page needs on (the Dashboard's getProductsOfPath): a
   * page of a product switched off on the server is never offered.
   */
  products?: Array<ProductKey> | undefined;
}

// One kind of record, with its pages, as the server's catalog keeps it.
export interface AskAiRecordKindPages {
  kind: AskAiRecordKind;
  // What one record is called, in English: "Status Page".
  recordName: string;
  pages: Array<AskAiRecordPage>;
}

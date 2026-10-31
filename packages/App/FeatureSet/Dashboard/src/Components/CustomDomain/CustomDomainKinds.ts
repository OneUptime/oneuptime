import {
  CustomDomainInstallation,
  CustomDomainKindCopy,
  DASHBOARD_CUSTOM_DOMAIN_COPY,
  FORM_CUSTOM_DOMAIN_COPY,
  STATUS_PAGE_CUSTOM_DOMAIN_COPY,
} from "./CustomDomainCopy";
import DashboardDomain from "Common/Models/DatabaseModels/DashboardDomain";
import FormDomain from "Common/Models/DatabaseModels/FormDomain";
import StatusPageDomain from "Common/Models/DatabaseModels/StatusPageDomain";
import {
  CUSTOM_DOMAIN_FREE_CERTIFICATES,
  DashboardCNameRecord,
  FormCNameRecord,
  HTTP_PROTOCOL,
  StatusPageCNameRecord,
} from "Common/UI/Config";

/*
 * The kinds of custom domain the Dashboard manages: a status page's, a
 * dashboard's and a form's. Their tables have the same columns, their
 * certificates go through the same steps, and their Custom Domains pages are
 * one table (CustomDomainsTable); what differs is here.
 */

export type CustomDomainModel = StatusPageDomain | DashboardDomain | FormDomain;

export interface CustomDomainKind {
  modelType: { new (): CustomDomainModel };
  // The column that names the status page, dashboard or form a domain belongs to.
  parentColumn: "statusPageId" | "dashboardId" | "formId";
  /*
   * The table's names, as each page has always had them: saved filters and
   * column preferences are kept under them.
   */
  tableId: string;
  tableName: string;
  userPreferencesKey: string;
  saveFilterTableId: string;
  /*
   * What each domain's CNAME record points to on this installation, read
   * when it is shown. Empty where custom domains of this kind are off.
   */
  getCnameRecord: () => string;
  // The environment variable that sets it, named when it is not set.
  cnameRecordVariable: string;
  copy: CustomDomainKindCopy;
}

export const STATUS_PAGE_CUSTOM_DOMAINS: CustomDomainKind = {
  modelType: StatusPageDomain,
  parentColumn: "statusPageId",
  tableId: "domains-table",
  tableName: "Status Page > Domains",
  userPreferencesKey: "status-page-domains-table",
  saveFilterTableId: "status-page-domains-table",
  getCnameRecord: (): string => {
    return StatusPageCNameRecord;
  },
  cnameRecordVariable: "STATUS_PAGE_CNAME_RECORD",
  copy: STATUS_PAGE_CUSTOM_DOMAIN_COPY,
};

export const DASHBOARD_CUSTOM_DOMAINS: CustomDomainKind = {
  modelType: DashboardDomain,
  parentColumn: "dashboardId",
  tableId: "dashboard-domains-table",
  tableName: "Dashboard > Domains",
  userPreferencesKey: "dashboard-domains-table",
  saveFilterTableId: "dashboard-domains-table",
  getCnameRecord: (): string => {
    return DashboardCNameRecord;
  },
  cnameRecordVariable: "DASHBOARD_CNAME_RECORD",
  copy: DASHBOARD_CUSTOM_DOMAIN_COPY,
};

/*
 * A form's own domains (Forms -> a form -> Custom Domains). Their CNAME
 * record is FORM_CNAME_RECORD, else the status page one: the variable named
 * when neither is set is the status page one, which turns on both.
 */
export const FORM_CUSTOM_DOMAINS: CustomDomainKind = {
  modelType: FormDomain,
  parentColumn: "formId",
  tableId: "form-domains-table",
  tableName: "Form > Custom Domains",
  userPreferencesKey: "form-domains-table",
  saveFilterTableId: "form-domains-table",
  getCnameRecord: (): string => {
    return FormCNameRecord;
  },
  cnameRecordVariable: "STATUS_PAGE_CNAME_RECORD",
  copy: FORM_CUSTOM_DOMAIN_COPY,
};

/*
 * What this installation does for every custom domain, read when it is
 * needed: whether it issues free certificates (only with a Let's Encrypt
 * account key) and the protocol it is reached over.
 */
export const getCustomDomainInstallation: () => CustomDomainInstallation =
  (): CustomDomainInstallation => {
    return {
      issuesFreeCertificates: CUSTOM_DOMAIN_FREE_CERTIFICATES,
      protocol: HTTP_PROTOCOL,
    };
  };

import {
  CustomDomainKindCopy,
  DASHBOARD_CUSTOM_DOMAIN_COPY,
  STATUS_PAGE_CUSTOM_DOMAIN_COPY,
} from "./CustomDomainCopy";
import DashboardDomain from "Common/Models/DatabaseModels/DashboardDomain";
import StatusPageDomain from "Common/Models/DatabaseModels/StatusPageDomain";
import { DashboardCNameRecord, StatusPageCNameRecord } from "Common/UI/Config";

/*
 * The kinds of custom domain the Dashboard manages: a status page's and a
 * dashboard's. Their tables have the same columns, their certificates go
 * through the same steps, and their Custom Domains pages are one table
 * (CustomDomainsTable); what differs is here.
 */

export type CustomDomainModel = StatusPageDomain | DashboardDomain;

export interface CustomDomainKind {
  modelType: { new (): CustomDomainModel };
  // The column that names the status page or dashboard a domain belongs to.
  parentColumn: "statusPageId" | "dashboardId";
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

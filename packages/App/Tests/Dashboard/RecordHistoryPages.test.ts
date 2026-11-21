import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getOwnRecordHistoryPage,
  getRecordHistoryPage,
  getRecordIdOfAuditLogsPage,
  RECORD_HISTORY_QUERY_PARAM,
  RecordHistoryPage,
} from "../../FeatureSet/Dashboard/src/Components/AuditLogs/RecordHistoryPages";
import { RESOURCE_META } from "../../FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsTableUtils";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import AlertOwnerRule from "Common/Models/DatabaseModels/AlertOwnerRule";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import EmailLog from "Common/Models/DatabaseModels/EmailLog";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import Service from "Common/Models/DatabaseModels/Service";
import ObjectID from "Common/Types/ObjectID";
import { getApiSingularName } from "Common/Utils/ModelApiName";

/*
 * WHERE A RECORD'S LINE LINKS ITS HISTORY (#10290).
 *
 * Every record's line ends with "History" where the audit log records its
 * kind: the Audit Logs page of its own view where its kind has one, and the
 * project's audit log showing the record alone otherwise - a rule, an LLM
 * provider, an API key. These hold the two in step: each resource's Audit
 * Logs page is the one its records' lines link to, and nothing the audit
 * log does not record links anywhere.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

const MODELS: Array<BaseModel> = (
  AllModelTypes as Array<{ new (): BaseModel }>
).map((modelType: { new (): BaseModel }): BaseModel => {
  return new modelType();
});

describe("a record's own Audit Logs page", () => {
  test.each([
    [Monitor, PageMap.MONITOR_VIEW_AUDIT_LOGS],
    [Service, PageMap.SERVICE_VIEW_AUDIT_LOGS],
    [ScheduledMaintenance, PageMap.SCHEDULED_MAINTENANCE_VIEW_AUDIT_LOGS],
  ])(
    "%p's is beside its view",
    (modelType: { new (): BaseModel }, page: PageMap) => {
      expect(getRecordHistoryPage(new modelType())).toEqual({
        page: page,
        isOwnPage: true,
      });
    },
  );

  test("every resource view's Audit Logs page is the one its records' lines link to", () => {
    const linked: Set<string> = new Set<string>(
      MODELS.map((model: BaseModel): string => {
        return getOwnRecordHistoryPage(model) || "";
      }),
    );

    /*
     * The view pages the audit log opens an entry on, whose Audit Logs page
     * sits beside them.
     */
    const viewPagesWithHistory: Array<string> = Object.values(RESOURCE_META)
      .map((meta: { viewRoute?: PageMap | undefined }): string => {
        return meta.viewRoute ? `${meta.viewRoute}_AUDIT_LOGS` : "";
      })
      .filter((page: string): boolean => {
        return (Object.values(PageMap) as Array<string>).includes(page);
      });

    expect(viewPagesWithHistory.length).toBeGreaterThan(40);

    const unlinked: Array<string> = viewPagesWithHistory.filter(
      (page: string): boolean => {
        return !linked.has(page);
      },
    );

    expect(unlinked).toEqual([]);
  });

  test("each page it links is a page with a route", () => {
    const routeMap: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Utils", "RouteMap.ts"),
      "utf8",
    );

    const missing: Array<string> = [];

    for (const model of MODELS) {
      const page: PageMap | null = getOwnRecordHistoryPage(model);

      if (page && !routeMap.includes(`[PageMap.${page}]: new Route(`)) {
        missing.push(`${getApiSingularName(model)}: ${page}`);
      }
    }

    expect(missing).toEqual([]);
  });
});

describe("a record whose kind has no Audit Logs page of its own", () => {
  test.each([
    ["an alert owner rule", AlertOwnerRule],
    ["an LLM provider", LlmProvider],
    ["an API key", ApiKey],
  ])(
    "%s links the project's audit log, showing it alone",
    (_name: string, modelType: { new (): BaseModel }) => {
      expect(getRecordHistoryPage(new modelType())).toEqual({
        page: PageMap.SETTINGS_AUDIT_LOGS,
        isOwnPage: false,
      });
    },
  );

  test("a kind the audit log does not record links nowhere", () => {
    expect(new EmailLog().enableAuditLogOn).toBeUndefined();
    expect(getRecordHistoryPage(new EmailLog())).toBeNull();
  });

  test("every recorded kind has a history, and every unrecorded one none", () => {
    const wrong: Array<string> = [];

    for (const model of MODELS) {
      const history: RecordHistoryPage | null = getRecordHistoryPage(model);
      const isRecorded: boolean = Boolean(
        model.enableAuditLogOn?.create || model.enableAuditLogOn?.update,
      );

      if (isRecorded !== Boolean(history)) {
        wrong.push(`${model.tableName}: ${history ? "linked" : "not linked"}`);
      }
    }

    expect(wrong).toEqual([]);
  });
});

describe("the project's audit log, showing one record", () => {
  const RECORD_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";

  test("reads the record from its query", () => {
    expect(RECORD_HISTORY_QUERY_PARAM).toBe("recordId");
    expect(getRecordIdOfAuditLogsPage(RECORD_ID)?.toString()).toBe(RECORD_ID);
    expect(getRecordIdOfAuditLogsPage(`  ${RECORD_ID} `)?.toString()).toBe(
      RECORD_ID,
    );
  });

  test.each([[null], [undefined], [""], ["   "], ["not-an-id"], ["1; DROP"]])(
    "shows every change for %p",
    (value: string | null | undefined) => {
      expect(getRecordIdOfAuditLogsPage(value)).toBeNull();
    },
  );

  test("the page lists the record and what it holds, by its root pointer", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Pages", "Settings", "AuditLogs.tsx"),
      "utf8",
    );

    expect(source).toContain("getRecordIdOfAuditLogsPage(");
    expect(source).toContain("rootResourceId={recordId}");
    expect(source).toContain("PageMap.SETTINGS_AUDIT_LOGS");
  });

  test("an id in the query is an ObjectID's", () => {
    expect(getRecordIdOfAuditLogsPage(RECORD_ID)).toBeInstanceOf(ObjectID);
  });
});

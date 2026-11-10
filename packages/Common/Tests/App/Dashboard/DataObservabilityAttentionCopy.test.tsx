import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import DataObservabilityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi";
import {
  DataCheckRunStatus,
  DataCheckType,
} from "../../../Types/DataObservability/DataCheckType";
import {
  DataObservabilityCollector,
  DataObservabilityOverview,
  DataObservabilityStoreSummary,
  MAX_CHECK_HEALTH_IDS,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import {
  DataAttentionItem,
  DataAttentionKind,
  DataCheckHealth,
  DataCheckHealthAnswer,
  DataObservabilitySetupStep,
  EMPTY_DATA_OBSERVABILITY_SETUP,
} from "../../../Types/DataObservability/DataObservabilityAttention";
import ObjectID from "../../../Types/ObjectID";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import {
  CHECK_HEALTH_COPY,
  getCheckHealthBeforeAlerts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/CheckHealthCopy";
import {
  AttentionTone,
  DATA_ATTENTION_COPY,
  DATA_OBSERVABILITY_SETUP_COPY,
  getAlertRoute,
  getAttentionOwnersRoute,
  getAttentionRoute,
  getSetupDismissedKey,
  getSetupStepRoute,
  getStoreAlertsRoute,
  hasAlertCount,
  isLateKind,
  isSetupKnown,
  normalizeDataObservabilityOverview,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/OverviewAttention";
import StoreAlertStatus, {
  STORE_ALERT_STATUS_TEST_ID,
  isStoreWithoutAlerts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/StoreAlertStatus";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * THE WORDS AND THE WAY ON, FOR EACH THING THE OVERVIEW SAYS NEEDS SOMEONE.
 *
 * Every kind has a word for its pill, a sentence of what it means for the
 * data and the page where it is put right - its own record's page where
 * it has one. A check's Status says Passing only when its alert says so.
 * A database says whether its alerts are on, and a server that does not
 * say is not guessed at.
 */

const ID: string = "10000000-0000-4000-8000-000000000001";

goTo(`/dashboard/${PROJECT_ID}/data-observability`);

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function routeTo(page: PageMap, modelId?: string): string {
  return RouteUtil.populateRouteParams(
    RouteMap[page] as Route,
    modelId ? { modelId: new ObjectID(modelId) } : undefined,
  ).toString();
}

function item(
  kind: DataAttentionKind,
  fields: Partial<DataAttentionItem> = {},
): DataAttentionItem {
  return {
    kind,
    name: "x",
    where: null,
    message: null,
    overdueBySeconds: 0,
    since: null,
    dataStoreId: null,
    dataAssetId: null,
    dataPipelineId: null,
    dataCheckId: null,
    dataProductId: null,
    dataReconciliationId: null,
    alert: null,
    ...fields,
  };
}

function store(
  fields: Partial<DataObservabilityStoreSummary>,
): DataObservabilityStoreSummary {
  return {
    dataStoreId: ID,
    name: "orders-db",
    kind: "PostgreSQL",
    isTableHealthEnabled: true,
    collector: DataObservabilityCollector.OneUptime,
    probeName: null,
    status: "Collected",
    message: null,
    collectedAt: null,
    assetCount: 1,
    lateAssetCount: 0,
    alertMonitorCount: 0,
    ...fields,
  };
}

describe("each kind's words", () => {
  test("every kind has a word, a sentence, a page and a time, each worded", () => {
    for (const kind of Object.values(DataAttentionKind)) {
      const copy: (typeof DATA_ATTENTION_COPY)[DataAttentionKind] =
        DATA_ATTENTION_COPY[kind];

      expect(copy).toBeDefined();
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.sentence).toMatch(/\.$/);
      expect(copy.actionTitle).toMatch(/^Open /);
      expect(copy.caption).toContain("{{time}}");
    }
  });

  test("what failed is told as broken, what is late as late", () => {
    expect(
      Object.values(DataAttentionKind).filter((kind: DataAttentionKind) => {
        return DATA_ATTENTION_COPY[kind].tone === AttentionTone.Danger;
      }),
    ).toEqual([
      DataAttentionKind.CollectionFailed,
      DataAttentionKind.PipelineFailed,
      DataAttentionKind.CheckFailing,
      DataAttentionKind.ReconciliationDrifted,
    ]);
    expect(Object.values(DataAttentionKind).filter(isLateKind)).toEqual([
      DataAttentionKind.TableLate,
      DataAttentionKind.PipelineLate,
    ]);
  });
});

describe("the page where each is put right", () => {
  test.each([
    [
      DataAttentionKind.CollectionFailed,
      { dataStoreId: ID },
      PageMap.DATA_OBSERVABILITY_STORE_VIEW,
    ],
    [
      DataAttentionKind.PipelineFailed,
      { dataPipelineId: ID },
      PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW,
    ],
    [
      DataAttentionKind.PipelineLate,
      { dataPipelineId: ID },
      PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW,
    ],
    [
      DataAttentionKind.CheckFailing,
      { dataCheckId: "c", dataAssetId: ID },
      PageMap.DATA_OBSERVABILITY_TABLE_VIEW_CHECKS,
    ],
    [
      DataAttentionKind.CheckCouldNotRun,
      { dataAssetId: ID },
      PageMap.DATA_OBSERVABILITY_TABLE_VIEW_CHECKS,
    ],
    [
      DataAttentionKind.DataProductLate,
      { dataProductId: ID },
      PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW,
    ],
    [
      DataAttentionKind.TableLate,
      { dataAssetId: ID },
      PageMap.DATA_OBSERVABILITY_TABLE_VIEW,
    ],
  ])(
    "%s: its record's own page",
    (
      kind: DataAttentionKind,
      fields: Partial<DataAttentionItem>,
      page: PageMap,
    ) => {
      expect(getAttentionRoute(item(kind, fields)).toString()).toBe(
        routeTo(page, ID),
      );
    },
  );

  test.each([
    [DataAttentionKind.CollectionFailed, PageMap.DATA_OBSERVABILITY_STORES],
    [DataAttentionKind.PipelineFailed, PageMap.DATA_OBSERVABILITY_PIPELINES],
    [DataAttentionKind.CheckFailing, PageMap.DATA_OBSERVABILITY_CHECKS],
    [
      DataAttentionKind.DataProductLate,
      PageMap.DATA_OBSERVABILITY_DATA_PRODUCTS,
    ],
    [DataAttentionKind.TableLate, PageMap.DATA_OBSERVABILITY_TABLES],
    [
      DataAttentionKind.ReconciliationDrifted,
      PageMap.DATA_OBSERVABILITY_RECONCILIATIONS,
    ],
    [
      DataAttentionKind.ReconciliationCouldNotRun,
      PageMap.DATA_OBSERVABILITY_RECONCILIATIONS,
    ],
  ])(
    "%s with no record to open: the list it is in",
    (kind: DataAttentionKind, page: PageMap) => {
      expect(getAttentionRoute(item(kind)).toString()).toBe(routeTo(page));
    },
  );

  test("a table's owners are named on its Owners page; nothing else has one", () => {
    expect(
      getAttentionOwnersRoute(
        item(DataAttentionKind.TableLate, { dataAssetId: ID }),
      )?.toString(),
    ).toBe(routeTo(PageMap.DATA_OBSERVABILITY_TABLE_VIEW_OWNERS, ID));
    expect(
      getAttentionOwnersRoute(
        item(DataAttentionKind.PipelineFailed, { dataPipelineId: ID }),
      ),
    ).toBeNull();
  });

  test("an alert's page, and a database's alerts", () => {
    expect(getAlertRoute(ID).toString()).toBe(routeTo(PageMap.ALERT_VIEW, ID));
    expect(getStoreAlertsRoute(ID).toString()).toBe(
      routeTo(PageMap.DATA_OBSERVABILITY_STORE_VIEW_RECOMMENDATIONS, ID),
    );
  });
});

describe("the first steps' words and pages", () => {
  test("each step is worded, with the page it is done on", () => {
    for (const step of Object.values(DataObservabilitySetupStep)) {
      expect(DATA_OBSERVABILITY_SETUP_COPY[step].title.length).toBeGreaterThan(
        0,
      );
      expect(DATA_OBSERVABILITY_SETUP_COPY[step].description).toMatch(/\.$/);
    }

    expect(
      getSetupStepRoute(
        DataObservabilitySetupStep.Owners,
        EMPTY_DATA_OBSERVABILITY_SETUP,
      ).toString(),
    ).toBe(routeTo(PageMap.DATA_OBSERVABILITY_SETTINGS_OWNER_RULES));
    expect(
      getSetupStepRoute(
        DataObservabilitySetupStep.Pipelines,
        EMPTY_DATA_OBSERVABILITY_SETUP,
      ).toString(),
    ).toBe(routeTo(PageMap.DATA_OBSERVABILITY_PIPELINES));
    expect(
      getSetupStepRoute(
        DataObservabilitySetupStep.Connect,
        EMPTY_DATA_OBSERVABILITY_SETUP,
      ).toString(),
    ).toBe(routeTo(PageMap.DATA_OBSERVABILITY_STORES));
  });

  test("turning alerts on opens the database that has none, else the databases", () => {
    expect(
      getSetupStepRoute(DataObservabilitySetupStep.Alerts, {
        ...EMPTY_DATA_OBSERVABILITY_SETUP,
        firstStoreWithoutAlertsId: ID,
      }).toString(),
    ).toBe(routeTo(PageMap.DATA_OBSERVABILITY_STORE_VIEW_RECOMMENDATIONS, ID));
    expect(
      getSetupStepRoute(
        DataObservabilitySetupStep.Alerts,
        EMPTY_DATA_OBSERVABILITY_SETUP,
      ).toString(),
    ).toBe(routeTo(PageMap.DATA_OBSERVABILITY_STORES));
  });

  test("hiding them is remembered per project", () => {
    expect(getSetupDismissedKey("a")).not.toBe(getSetupDismissedKey("b"));
  });
});

describe("an Overview from any server", () => {
  test("a server a version behind: every new part filled in, nothing guessed", () => {
    const overview: DataObservabilityOverview =
      normalizeDataObservabilityOverview({
        assetCount: 3,
        stores: [store({}), store({ dataStoreId: "other" })],
      });

    expect(overview.storeCount).toBe(2);
    expect(overview.attention).toEqual([]);
    expect(overview.attentionCount).toBe(0);
    expect(overview.failingCheckCount).toBe(0);
    expect(overview.setup).toEqual({
      ...EMPTY_DATA_OBSERVABILITY_SETUP,
      storeCount: 2,
    });
    expect(isSetupKnown({ assetCount: 3 })).toBe(false);
  });

  test("nothing at all, or the wrong shapes: an empty Overview, never an error", () => {
    for (const raw of [
      null,
      undefined,
      {},
      {
        stores: "x",
        attention: { a: 1 },
        assetCount: "12",
        setup: "x",
      } as unknown as Partial<DataObservabilityOverview>,
    ]) {
      const overview: DataObservabilityOverview =
        normalizeDataObservabilityOverview(raw);

      expect(overview.stores).toEqual([]);
      expect(overview.attention).toEqual([]);
      expect(overview.assetCount).toBe(0);
      expect(overview.storeCount).toBe(0);
    }

    expect(isSetupKnown({ setup: "x" } as never)).toBe(false);
  });

  test("an answer with all its parts is read as sent, the count of all kept", () => {
    const overview: DataObservabilityOverview =
      normalizeDataObservabilityOverview({
        storeCount: 1,
        stores: [store({})],
        attention: [item(DataAttentionKind.TableLate)],
        attentionCount: 30,
        failingCheckCount: 2,
        setup: { ...EMPTY_DATA_OBSERVABILITY_SETUP, checkCount: 4 },
      });

    expect(overview.attentionCount).toBe(30);
    expect(overview.failingCheckCount).toBe(2);
    expect(overview.setup.checkCount).toBe(4);
    expect(isSetupKnown({ setup: { ...EMPTY_DATA_OBSERVABILITY_SETUP } })).toBe(
      true,
    );
  });
});

describe("whether a database's alerts are on", () => {
  test("none on, of a watched database: nobody hears of its tables", () => {
    render(<StoreAlertStatus store={store({ alertMonitorCount: 0 })} />);

    const status: HTMLElement = screen.getByTestId(STORE_ALERT_STATUS_TEST_ID);

    expect(status).toHaveAttribute("data-alerts", "none");
    expect(status).toHaveTextContent("No alerts on");
    expect(isStoreWithoutAlerts(store({ alertMonitorCount: 0 }))).toBe(true);
  });

  test("some on: how many", () => {
    render(<StoreAlertStatus store={store({ alertMonitorCount: 1 })} />);
    expect(screen.getByTestId(STORE_ALERT_STATUS_TEST_ID)).toHaveTextContent(
      "1 alert on",
    );

    cleanup();
    render(<StoreAlertStatus store={store({ alertMonitorCount: 5 })} />);
    expect(screen.getByTestId(STORE_ALERT_STATUS_TEST_ID)).toHaveTextContent(
      "5 alerts on",
    );
    expect(isStoreWithoutAlerts(store({ alertMonitorCount: 5 }))).toBe(false);
  });

  test("not watched, or a server that does not say: nothing, rather than a guess", () => {
    const unwatched: DataObservabilityStoreSummary = store({
      isTableHealthEnabled: false,
    });
    const unsaid: DataObservabilityStoreSummary = store({});
    delete (unsaid as Partial<DataObservabilityStoreSummary>).alertMonitorCount;

    render(<StoreAlertStatus store={unwatched} />);
    render(<StoreAlertStatus store={unsaid} />);

    expect(screen.queryByTestId(STORE_ALERT_STATUS_TEST_ID)).toBeNull();
    expect(isStoreWithoutAlerts(unwatched)).toBe(false);
    expect(isStoreWithoutAlerts(unsaid)).toBe(false);
    expect(hasAlertCount(unsaid)).toBe(false);
  });
});

describe("asking how the checks stand", () => {
  test("at most 200 a request, every answer merged by check id", async () => {
    const asked: Array<Array<string>> = [];

    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
    jest.spyOn(API, "post").mockImplementation((async (request: {
      data: { dataCheckIds: Array<string> };
    }) => {
      asked.push(request.data.dataCheckIds);

      return new HTTPResponse(
        200,
        {
          checks: Object.fromEntries(
            request.data.dataCheckIds.map((id: string) => {
              return [id, { health: DataCheckHealth.Passing, alert: null }];
            }),
          ),
        } as unknown as JSONObject,
        {},
      );
    }) as never);

    const ids: Array<string> = Array.from(
      { length: MAX_CHECK_HEALTH_IDS + 50 },
      (_value: unknown, index: number): string => {
        return `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      },
    );

    const answers: Map<string, DataCheckHealthAnswer> =
      await DataObservabilityApi.getCheckHealth(ids);

    expect(
      asked.map((chunk: Array<string>) => {
        return chunk.length;
      }),
    ).toEqual([MAX_CHECK_HEALTH_IDS, 50]);
    expect(answers.size).toBe(ids.length);
    expect(answers.get(ids[MAX_CHECK_HEALTH_IDS + 10]!)?.health).toBe(
      DataCheckHealth.Passing,
    );
  });

  test("an answer that is not a map of checks: none, never an error", async () => {
    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse(
          200,
          { checks: ["x"] } as unknown as JSONObject,
          {},
        ) as never,
      );

    expect((await DataObservabilityApi.getCheckHealth([ID])).size).toBe(0);
    expect((await DataObservabilityApi.getCheckHealth([])).size).toBe(0);
  });
});

describe("a check's Status", () => {
  function check(fields: Record<string, unknown>): DataCheck {
    const row: DataCheck = new DataCheck();
    Object.assign(row, {
      isEnabled: true,
      checkType: DataCheckType.RowCount,
      lastRunAt: new Date(),
      lastRunStatus: DataCheckRunStatus.Ran,
      ...fields,
    });
    return row;
  }

  test("each health has a word and a colour; only Failing is red, only Passing green", () => {
    for (const health of Object.values(DataCheckHealth)) {
      expect(CHECK_HEALTH_COPY[health].label.length).toBeGreaterThan(0);
    }

    expect(CHECK_HEALTH_COPY[DataCheckHealth.Failing].label).toBe("Failing");
    expect(CHECK_HEALTH_COPY[DataCheckHealth.Passing].label).toBe("Passing");
    expect(CHECK_HEALTH_COPY[DataCheckHealth.NoAlert].label).toBe("Ran");
    expect(CHECK_HEALTH_COPY[DataCheckHealth.CouldNotRun].label).toBe(
      "Could Not Run",
    );
    expect(
      new Set(
        Object.values(DataCheckHealth).map((health: DataCheckHealth) => {
          return CHECK_HEALTH_COPY[health].color.toString();
        }),
      ).size,
    ).toBe(4);
  });

  test("before its alert is read, a check that ran says only that it ran - never Passing", () => {
    expect(getCheckHealthBeforeAlerts(check({}))).toBe(DataCheckHealth.NoAlert);
    expect(
      getCheckHealthBeforeAlerts(
        check({ lastRunStatus: DataCheckRunStatus.Failed }),
      ),
    ).toBe(DataCheckHealth.CouldNotRun);
    expect(
      getCheckHealthBeforeAlerts(
        check({ lastRunAt: null, lastRunStatus: null }),
      ),
    ).toBe(DataCheckHealth.Waiting);
    expect(getCheckHealthBeforeAlerts(check({ isEnabled: false }))).toBe(
      DataCheckHealth.Off,
    );
  });

  test("a dbt test's own verdict stands", () => {
    expect(
      getCheckHealthBeforeAlerts(
        check({ checkType: DataCheckType.DbtTest, lastRunStatus: "Passed" }),
      ),
    ).toBe(DataCheckHealth.Passing);
    expect(
      getCheckHealthBeforeAlerts(
        check({ checkType: DataCheckType.DbtTest, lastRunStatus: "Failed" }),
      ),
    ).toBe(DataCheckHealth.Failing);
  });
});

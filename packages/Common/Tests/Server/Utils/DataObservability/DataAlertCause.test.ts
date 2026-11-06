import { afterEach, describe, expect, jest, test } from "@jest/globals";
import DataAlertCause, {
  DataAlertSubject,
  describeConsequence,
  getDataAlertScope,
  getSeriesTableKey,
} from "../../../../Server/Utils/DataObservability/DataAlertCause";
import Alert from "../../../../Models/DatabaseModels/Alert";
import DataAlert from "../../../../Models/DatabaseModels/DataAlert";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import DataAlertService from "../../../../Server/Services/DataAlertService";
import { getAllDataObservabilityAlertTemplates } from "../../../../Types/Monitor/DataObservabilityAlertTemplates";
import { getAllDataPipelineAlertTemplates } from "../../../../Types/Monitor/DataPipelineAlertTemplates";
import { buildDataCheckMonitorStep } from "../../../../Types/Monitor/DataCheckMonitorStep";
import { DataCheckAlertCondition } from "../../../../Types/DataObservability/DataCheckType";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { htmlAsText } from "../../../Helpers/HtmlText";
import {
  hrefsOf,
  renderAsDashboard,
} from "../../../Utils/Markdown/DashboardMarkdownRenderer";

/*
 * A data alert is about what its monitor is scoped to: a store's tables
 * (and the table its series names), a check, or a pipeline. Any other
 * monitor's alert is not a data alert, and is never held back.
 */

const STORE_ID: string = ObjectID.generate().toString();
const PIPELINE_ID: string = ObjectID.generate().toString();
const CHECK_ID: string = ObjectID.generate().toString();

function stepsOf(step: MonitorStep): MonitorSteps {
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ObjectID.generate(),
  };
  return steps;
}

function seed(): {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} {
  return {
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "a data monitor",
  };
}

describe("getDataAlertScope", () => {
  test("a store's table monitors are scoped to the store", () => {
    for (const template of getAllDataObservabilityAlertTemplates()) {
      expect(
        getDataAlertScope(
          stepsOf(
            template.getMonitorStep({ ...seed(), dataStoreId: STORE_ID }),
          ),
        ),
      ).toEqual({
        dataStoreId: STORE_ID,
        dataPipelineId: null,
        dataCheckId: null,
      });
    }
  });

  test("a pipeline's monitors are scoped to the pipeline", () => {
    for (const template of getAllDataPipelineAlertTemplates()) {
      expect(
        getDataAlertScope(
          stepsOf(
            template.getMonitorStep({ ...seed(), dataPipelineId: PIPELINE_ID }),
          ),
        ),
      ).toEqual({
        dataStoreId: null,
        dataPipelineId: PIPELINE_ID,
        dataCheckId: null,
      });
    }
  });

  test("a check's monitor is scoped to the check", () => {
    expect(
      getDataAlertScope(
        stepsOf(
          buildDataCheckMonitorStep({
            ...seed(),
            checkId: CHECK_ID,
            checkName: "not_null: order_id",
            tableKey: "public.orders",
            condition: DataCheckAlertCondition.Above,
            threshold: 0,
            intervalInMinutes: 1440,
          }),
        ),
      ),
    ).toEqual({
      dataStoreId: null,
      dataPipelineId: null,
      dataCheckId: CHECK_ID,
    });
  });

  test("any other monitor is not a data monitor", () => {
    expect(
      getDataAlertScope(
        stepsOf(
          MonitorStep.getDefaultMonitorStep({
            ...seed(),
            monitorType: MonitorType.Website,
          }),
        ),
      ),
    ).toBe(null);
    expect(getDataAlertScope(undefined)).toBe(null);
  });
});

describe("getSeriesTableKey", () => {
  test("the table a store monitor's series names", () => {
    expect(
      getSeriesTableKey({ "oneuptime.data.table.key": " public.orders " }),
    ).toBe("public.orders");
    expect(getSeriesTableKey({})).toBe(null);
    expect(getSeriesTableKey(null)).toBe(null);
  });
});

describe("describeConsequence", () => {
  test("names the cause, and why nobody was paged", () => {
    expect(
      describeConsequence({
        title: "Table Is Late - public.raw_orders",
        alertNumberWithPrefix: "#41",
        isPrivate: false,
      }),
    ).toBe(
      "**Caused upstream.** Alert #41 Table Is Late - public.raw_orders is open on what this alert's table or pipeline is built from, so this alert started acknowledged: nobody is paged twice for one problem. It recovers on its own once its data does.",
    );
  });

  test("shows the cause's title as it was written: its Markdown makes no link and no bold", () => {
    const title: string = "Table Is Late - [Pay here](/billing) **now**";

    const html: string = renderAsDashboard([
      describeConsequence({
        title: title,
        alertNumberWithPrefix: "#41",
        isPrivate: false,
      }),
    ])[0]!;

    expect(hrefsOf(html)).toEqual([]);
    // Only the line's own "Caused upstream." is bold.
    expect(html.split("<strong>").length - 1).toBe(1);
    expect(htmlAsText(html)).toContain(`Alert #41 ${title} is open`);
  });

  test("never names a private cause: its number and title stay out of the line", () => {
    const line: string = describeConsequence({
      title: "Table Is Late - public.payroll",
      alertNumberWithPrefix: "#41",
      isPrivate: true,
    });

    expect(line).toBe(
      "**Caused upstream.** A private alert is open on what this alert's table or pipeline is built from, so this alert started acknowledged: nobody is paged twice for one problem. It recovers on its own once its data does.",
    );
    expect(line).not.toContain("payroll");
    expect(line).not.toContain("#41");
  });
});

/*
 * Anyone who may read the new alert reads its feed, and the cause's owners
 * alone may see a private cause: so what record() writes there, from the
 * cause findCause read, names the cause only when it is not private.
 */
describe("the feed line of an alert whose cause is open upstream", () => {
  const PROJECT_ID: ObjectID = ObjectID.generate();
  const SUBJECT: DataAlertSubject = {
    dataAssetId: ObjectID.generate(),
    dataPipelineId: null,
    dataStoreId: null,
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function causeAlert(isPrivate: boolean | undefined): Alert {
    const cause: Alert = new Alert();
    cause.id = ObjectID.generate();
    cause.title = "Table Is Late - public.payroll";
    cause.alertNumberWithPrefix = "#41";

    if (isPrivate !== undefined) {
      cause.isPrivate = isPrivate;
    }

    return cause;
  }

  async function recordedLine(cause: Alert): Promise<string> {
    jest
      .spyOn(DataAlertService, "create")
      .mockResolvedValue(new DataAlert() as never);
    const feed: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);

    const alert: Alert = new Alert();
    alert.id = ObjectID.generate();
    alert.projectId = PROJECT_ID;

    await DataAlertCause.record({
      alert: alert,
      subject: SUBJECT,
      cause: cause,
    });

    expect(feed).toHaveBeenCalledTimes(1);

    return (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
      .feedInfoInMarkdown;
  }

  test("names a cause that is not private", async () => {
    const line: string = await recordedLine(causeAlert(false));

    expect(line).toContain("Alert #41 Table Is Late - public.payroll is open");
  });

  test("names a cause whose privacy was never set, as an alert that is not private", async () => {
    const line: string = await recordedLine(causeAlert(undefined));

    expect(line).toContain("Alert #41 Table Is Late - public.payroll is open");
  });

  test("never names a private cause", async () => {
    const line: string = await recordedLine(causeAlert(true));

    expect(line).toContain("A private alert is open");
    expect(line).not.toContain("payroll");
    expect(line).not.toContain("#41");
  });

  test("the cause is read with whether it is private", async () => {
    jest
      .spyOn(
        DataAlertCause as unknown as {
          readUpstream: () => Promise<unknown>;
        },
        "readUpstream",
      )
      .mockResolvedValue({
        assetIds: new Set<string>([ObjectID.generate().toString()]),
        pipelineIds: new Set<string>(),
        storeIds: new Set<string>(),
      });

    const upstreamAlert: DataAlert = new DataAlert();
    upstreamAlert.alertId = ObjectID.generate();
    jest
      .spyOn(DataAlertService, "findBy")
      .mockResolvedValue([upstreamAlert] as never);
    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([ObjectID.generate()] as never);
    const findCause: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(null as never);

    await DataAlertCause.findCause({ projectId: PROJECT_ID, subject: SUBJECT });

    expect(findCause).toHaveBeenCalledTimes(1);
    expect(
      (findCause.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select,
    ).toMatchObject({
      title: true,
      alertNumberWithPrefix: true,
      isPrivate: true,
    });
  });
});

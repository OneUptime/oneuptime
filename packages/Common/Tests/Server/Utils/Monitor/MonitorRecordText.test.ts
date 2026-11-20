/*
 * MonitorTemplateUtil pulls the native isolated-vm addon in through VMAPI.
 * Nothing here runs the sandbox, and the prebuilt binary cannot always load
 * in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorRecordText, {
  MonitorRecordTextResult,
} from "../../../../Server/Utils/Monitor/MonitorRecordText";
import MonitorTemplateUtil from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import SeriesContextEnricher from "../../../../Server/Utils/Monitor/SeriesContextEnricher";
import { JSONObject } from "../../../../Types/JSON";
import { getManagedDeviceAlertTemplateById } from "../../../../Types/Monitor/ManagedDeviceAlertTemplates";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * THE WORDS OF AN INCIDENT OR ALERT A MONITOR OPENS (MonitorRecordText), and
 * what "When this goes down" renders them with before any check
 * (MonitorTemplateUtil.buildStorageMapBeforeCheck, #7076).
 *
 * MonitorIncident and MonitorAlert render every record's title and
 * description through MonitorRecordText.render: it must say exactly what
 * the two used to put together inline - the title against the title map,
 * the description as Markdown, both then made to name the series - or the
 * same breach would read differently than it did. The card renders a
 * criteria's template the same way with what is known of the monitor before
 * a check, so the project's rules are matched on the words a record would
 * get.
 */

const MONITOR_ID: string = "70760000-0000-4000-8000-0000000000aa";

function monitor(overrides: Partial<Monitor> = {}): Monitor {
  const item: Monitor = new Monitor();
  item._id = MONITOR_ID;
  item.name = "Checkout API";
  item.description = "Takes the payments";
  item.slug = "checkout-api";
  item.monitorType = MonitorType.Website;
  Object.assign(item, overrides);
  return item;
}

// What MonitorIncident and MonitorAlert put together inline before MonitorRecordText.
function renderedInline(data: {
  titleTemplate: string | undefined;
  descriptionTemplate: string | undefined;
  monitorType: MonitorType;
  storageMap: JSONObject;
  seriesLabels?: JSONObject | undefined;
}): MonitorRecordTextResult {
  const titleStorageMap: JSONObject = MonitorTemplateUtil.buildTitleStorageMap({
    monitorType: data.monitorType,
    storageMap: data.storageMap,
  });

  return {
    title: SeriesContextEnricher.enrichTitle({
      title: MonitorTemplateUtil.processTemplateString({
        value: data.titleTemplate,
        storageMap: titleStorageMap,
      }),
      seriesLabels: data.seriesLabels,
    }),
    description: SeriesContextEnricher.enrichDescription({
      description: MonitorTemplateUtil.processMarkdownTemplateString({
        value: data.descriptionTemplate,
        storageMap: data.storageMap,
      }),
      seriesLabels: data.seriesLabels,
      monitorType: data.monitorType,
    }),
  };
}

const POD_LABELS: JSONObject = {
  "resource.k8s.namespace.name": "prod",
  "resource.k8s.pod.name": "checkout-7d9f-2xk",
};

describe("MonitorRecordText.render", () => {
  test.each([
    {
      label: "a website check",
      titleTemplate: "{{monitorName}} answered {{responseStatusCode}}",
      descriptionTemplate:
        "**{{monitorName}}** answered {{responseStatusCode}}: {{responseBody}}",
      monitorType: MonitorType.Website,
      dataToProcess: {
        monitorId: new ObjectID(MONITOR_ID),
        responseCode: 502,
        responseBody: '{"error": "<b>Bad gateway</b> *now*"}',
      } as unknown as DataToProcess,
      seriesLabels: undefined,
    },
    {
      label: "an incoming email, whose subject is written by the sender",
      titleTemplate: "Mail: {{emailSubject}}",
      descriptionTemplate: "From {{emailFrom}}: {{emailBody}}",
      monitorType: MonitorType.IncomingEmail,
      dataToProcess: {
        monitorId: new ObjectID(MONITOR_ID),
        incomingEmail: {
          subject: "Disk full\non host-a\r\n[link](https://x.test)",
          from: "ops@example.com",
          body: "# Heading\n<img src=x>",
        },
      } as unknown as DataToProcess,
      seriesLabels: undefined,
    },
    {
      label: "one series of a grouped Kubernetes criteria",
      titleTemplate: "Pod CPU high",
      descriptionTemplate: "CPU is high.",
      monitorType: MonitorType.Kubernetes,
      dataToProcess: {} as unknown as DataToProcess,
      seriesLabels: POD_LABELS,
    },
    {
      label: "templates left empty",
      titleTemplate: undefined,
      descriptionTemplate: undefined,
      monitorType: MonitorType.Website,
      dataToProcess: {} as unknown as DataToProcess,
      seriesLabels: undefined,
    },
  ])(
    "$label reads as MonitorIncident and MonitorAlert always wrote it",
    (data: {
      titleTemplate: string | undefined;
      descriptionTemplate: string | undefined;
      monitorType: MonitorType;
      dataToProcess: DataToProcess;
      seriesLabels: JSONObject | undefined;
    }) => {
      const storageMap: JSONObject =
        MonitorTemplateUtil.buildTemplateStorageMap({
          monitorType: data.monitorType,
          dataToProcess: data.dataToProcess,
          monitor: monitor({ monitorType: data.monitorType }),
          seriesLabels: data.seriesLabels,
        });

      const input: {
        titleTemplate: string | undefined;
        descriptionTemplate: string | undefined;
        monitorType: MonitorType;
        storageMap: JSONObject;
        seriesLabels: JSONObject | undefined;
      } = {
        titleTemplate: data.titleTemplate,
        descriptionTemplate: data.descriptionTemplate,
        monitorType: data.monitorType,
        storageMap: storageMap,
        seriesLabels: data.seriesLabels,
      };

      const text: MonitorRecordTextResult = MonitorRecordText.render(input);

      expect(text).toEqual(renderedInline(input));
    },
  );

  test("a title is one line, though the subject it carries is not", () => {
    const text: MonitorRecordTextResult = MonitorRecordText.render({
      titleTemplate: "Mail: {{emailSubject}}",
      descriptionTemplate: "{{emailSubject}}",
      monitorType: MonitorType.IncomingEmail,
      storageMap: { emailSubject: "Disk full\non host-a" },
    });

    expect(text.title).not.toContain("\n");
    expect(text.title).toContain("Disk full");
    expect(text.title).toContain("on host-a");
  });

  test("a grouped series is named in the title and the description", () => {
    const text: MonitorRecordTextResult = MonitorRecordText.render({
      titleTemplate: "Pod CPU high",
      descriptionTemplate: "CPU is high.",
      monitorType: MonitorType.Kubernetes,
      storageMap: MonitorTemplateUtil.buildTemplateStorageMap({
        monitorType: MonitorType.Kubernetes,
        dataToProcess: {} as unknown as DataToProcess,
        seriesLabels: POD_LABELS,
      }),
      seriesLabels: POD_LABELS,
    });

    expect(text.title).toContain("checkout-7d9f-2xk");
    expect(text.description).toContain("checkout-7d9f-2xk");
  });

  /*
   * #10209: a managed device's alert, as MonitorAlert and MonitorIncident
   * open one - the template's own words, rendered with the check's answer,
   * whose view names the metric the step reads - carries the command of
   * that reading alone, in its description and in {{seriesDebugCommands}}.
   */
  test.each([
    ["esper-low-battery", "oneuptime.managed_device.battery.level"],
    ["esper-storage-nearly-full", "oneuptime.managed_device.storage.used"],
    [
      "esper-security-patch-out-of-date",
      "oneuptime.managed_device.security_patch.age",
    ],
    [
      "esper-device-stopped-checking-in",
      "oneuptime.managed_device.check_in.age",
    ],
  ])(
    "a device's %s alert carries the command of its own reading alone",
    (templateId: string, metricName: string) => {
      const step: MonitorStep = getManagedDeviceAlertTemplateById(
        templateId,
      )!.getMonitorStep({
        deviceManagementConnectionId: ObjectID.generate().toString(),
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "Stores West",
      });
      const alert: { title: string; description: string } =
        step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!
          .alerts[0]!;
      const seriesLabels: JSONObject = {
        "oneuptime.managed_device.name": "STORE-0412-TC52",
      };
      // The check's answer: the step's own view, as the worker hands it on.
      const dataToProcess: DataToProcess = {
        metricViewConfig: MonitorStep.getMetricsViewConfig(step),
        metricResult: [],
      } as unknown as DataToProcess;
      const storageMap: JSONObject =
        MonitorTemplateUtil.buildTemplateStorageMap({
          monitorType: MonitorType.Metrics,
          dataToProcess,
          seriesLabels,
        });

      const text: MonitorRecordTextResult = MonitorRecordText.render({
        titleTemplate: alert.title,
        descriptionTemplate: alert.description,
        monitorType: MonitorType.Metrics,
        storageMap,
        seriesLabels,
        metricNames: MonitorTemplateUtil.getMetricNamesReadBy(dataToProcess),
      });

      for (const written of [
        text.description,
        String(storageMap["seriesDebugCommands"]),
      ]) {
        expect(written.split("oneuptime metric list").length - 1).toBe(1);
        expect(written).toContain(`"name":"${metricName}"`);
      }

      // Before #10209 the alert listed every reading of the device, check-ins first.
      const unnarrowed: string = MonitorRecordText.render({
        titleTemplate: alert.title,
        descriptionTemplate: alert.description,
        monitorType: MonitorType.Metrics,
        storageMap,
        seriesLabels,
      }).description;

      expect(unnarrowed.split("oneuptime metric list").length - 1).toBe(4);
    },
  );
});

describe("MonitorTemplateUtil.buildStorageMapBeforeCheck", () => {
  test("says what a title can say of the monitor itself, exactly as a check's map says it", () => {
    const item: Monitor = monitor();
    const before: JSONObject = MonitorTemplateUtil.buildStorageMapBeforeCheck({
      monitor: item,
    });
    const atCheck: JSONObject = MonitorTemplateUtil.buildTemplateStorageMap({
      monitorType: MonitorType.Website,
      dataToProcess: {
        monitorId: new ObjectID(MONITOR_ID),
        responseCode: 502,
      } as unknown as DataToProcess,
      monitor: item,
    });

    expect(before).toMatchObject({
      monitorName: "Checkout API",
      monitorId: MONITOR_ID,
      monitorDescription: "Takes the payments",
      monitorSlug: "checkout-api",
      monitorType: MonitorType.Website,
    });

    // Every value it has is the one a check's map has.
    for (const key of Object.keys(before)) {
      expect({ key, value: before[key] }).toEqual({
        key,
        value: atCheck[key],
      });
    }
  });

  test("the series renderings of a monitor that is not grouped are empty, so their placeholders vanish", () => {
    const before: JSONObject = MonitorTemplateUtil.buildStorageMapBeforeCheck({
      monitor: monitor({ monitorType: MonitorType.Kubernetes }),
    });

    for (const key of [
      "seriesResourceSuffix",
      "seriesResourceSummary",
      "seriesResourceBlock",
      "seriesDebugCommands",
    ]) {
      expect({ key, value: before[key] }).toEqual({ key, value: "" });
    }

    expect(
      MonitorRecordText.render({
        titleTemplate: "Pod CPU high{{seriesResourceSuffix}}",
        descriptionTemplate: "",
        monitorType: MonitorType.Kubernetes,
        storageMap: before,
      }).title,
    ).toBe("Pod CPU high");
  });

  test("what only a check reports is not in it, and its placeholder is left as written", () => {
    const before: JSONObject = MonitorTemplateUtil.buildStorageMapBeforeCheck({
      monitor: monitor(),
    });

    expect(before["responseStatusCode"]).toBeUndefined();
    expect(before["responseBody"]).toBeUndefined();
    expect(
      MonitorRecordText.render({
        titleTemplate: "{{monitorName}} answered {{responseStatusCode}}",
        descriptionTemplate: "{{monitorName}} ({{monitorType}})",
        monitorType: MonitorType.Website,
        storageMap: before,
      }),
    ).toEqual({
      title: "Checkout API answered {{responseStatusCode}}",
      description: "Checkout API (Website)",
    });
  });

  test("a monitor without a description or slug leaves them out, rather than saying undefined", () => {
    const bare: Monitor = monitor();
    delete bare.description;
    delete bare.slug;

    const before: JSONObject = MonitorTemplateUtil.buildStorageMapBeforeCheck({
      monitor: bare,
    });

    expect(Object.keys(before)).not.toContain("monitorDescription");
    expect(Object.keys(before)).not.toContain("monitorSlug");
    expect(JSON.stringify(before)).not.toContain("undefined");
  });
});

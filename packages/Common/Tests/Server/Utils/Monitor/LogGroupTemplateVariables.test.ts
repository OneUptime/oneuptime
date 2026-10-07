/*
 * MonitorTemplateUtil renders through VMAPI, which loads the native
 * isolated-vm addon. Placeholder substitution does not use the sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorTemplateUtil from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import SeriesContextEnricher from "../../../../Server/Utils/Monitor/SeriesContextEnricher";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import { JSONObject } from "../../../../Types/JSON";
import LogMonitorResponse from "../../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import TemplateVariablesCatalog, {
  TemplateVariable,
  TemplateVariableGroup,
} from "../../../../UI/Components/MonitorTemplateVariables/TemplateVariablesCatalog";
import { describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test - a grouped Logs monitor's group values reach the
 * alert and incident templates the way a grouped metric monitor's series
 * labels do.
 *
 * MonitorAlert / MonitorIncident render every per-series alert with
 * buildTemplateStorageMap({ seriesLabels }) and then SeriesContextEnricher;
 * for a Logs monitor the series labels ARE the group's attribute values.
 * So "IPsec tunnel {{con_name}} terminated" has to read "IPsec tunnel
 * HQ-Branch1 terminated", and a title that does not mention the tunnel
 * has to get it appended.
 */

const GROUP_LABELS: JSONObject = { con_name: "HQ-Branch1" };

function logsMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.monitorType = MonitorType.Logs;
  monitor.name = "IPsec tunnels";
  return monitor;
}

function groupedResponse(): LogMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    logCount: 3,
    logQuery: {},
    groupByAttributes: ["con_name"],
    groupBreakdown: [
      {
        fingerprint: MetricSeriesFingerprint.computeFingerprint(GROUP_LABELS),
        labels: GROUP_LABELS,
        logCount: 3,
      },
    ],
    totalGroupCount: 1,
  };
}

function storageMapFor(seriesLabels: JSONObject): JSONObject {
  return MonitorTemplateUtil.buildTemplateStorageMap({
    monitorType: MonitorType.Logs,
    dataToProcess: groupedResponse() as DataToProcess,
    monitor: logsMonitor(),
    seriesLabels: seriesLabels,
  });
}

function renderTitle(template: string, seriesLabels: JSONObject): string {
  return SeriesContextEnricher.enrichTitle({
    title: MonitorTemplateUtil.processTemplateString({
      value: template,
      storageMap: MonitorTemplateUtil.buildTitleStorageMap({
        monitorType: MonitorType.Logs,
        storageMap: storageMapFor(seriesLabels),
      }),
    }),
    seriesLabels: seriesLabels,
  });
}

describe("group values in a grouped Logs monitor's titles", () => {
  it("places the group's value where the template asks for it", () => {
    expect(
      renderTitle("IPsec tunnel {{con_name}} terminated", GROUP_LABELS),
    ).toBe("IPsec tunnel HQ-Branch1 terminated");
  });

  it("reads a dotted key as a path, like a metric label", () => {
    expect(
      renderTitle("Tunnel {{sophos.con_name}} down", {
        "sophos.con_name": "Branch2",
      }),
    ).toBe("Tunnel Branch2 down");
  });

  it("appends the group to a title that does not name it", () => {
    expect(renderTitle("IPsec tunnel terminated", GROUP_LABELS)).toBe(
      "IPsec tunnel terminated - Con Name: HQ-Branch1",
    );
  });

  it("offers the ready-made series renderings", () => {
    expect(
      renderTitle("Tunnel down{{seriesResourceSuffix}}", GROUP_LABELS),
    ).toBe("Tunnel down - Con Name: HQ-Branch1");
    expect(
      renderTitle("{{seriesResourceSummary}} terminated", GROUP_LABELS),
    ).toBe("Con Name: HQ-Branch1 terminated");
  });

  it("keeps several group values apart", () => {
    expect(
      renderTitle("{{con_name}} via {{gw_name}}", {
        con_name: "HQ-Branch1",
        gw_name: "WAN2",
      }),
    ).toBe("HQ-Branch1 via WAN2");
  });

  it("names nothing for a group whose logs did not carry the attribute", () => {
    expect(renderTitle("IPsec tunnel terminated", { con_name: "" })).toBe(
      "IPsec tunnel terminated",
    );
  });
});

describe("group values in a grouped Logs monitor's descriptions", () => {
  it("places a group value as text, never as Markdown it could carry", () => {
    const description: string =
      MonitorTemplateUtil.processMarkdownTemplateString({
        value: "Tunnel {{con_name}} terminated.",
        storageMap: storageMapFor({
          con_name: "[click](https://evil.example) <!channel>",
        }),
      });

    // The link and the chat mention arrive defused, not as written Markdown.
    expect(description).not.toContain("[click](https://evil.example)");
    expect(description).not.toContain("<!channel>");
    expect(description).toContain("click");
  });

  it("exposes the full label map for iteration", () => {
    expect(storageMapFor(GROUP_LABELS)["seriesLabels"]).toEqual(GROUP_LABELS);
  });

  it("never walks a hostile label key into the prototype", () => {
    storageMapFor({ "__proto__.polluted": "yes" });

    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("the template variables list for a grouped Logs monitor", () => {
  const GROUP_TITLE: string = "Group Values (one alert per group)";

  function titlesOf(groups: Array<TemplateVariableGroup>): Array<string> {
    return groups.map((group: TemplateVariableGroup) => {
      return group.title;
    });
  }

  it("lists each group-by attribute as a variable", () => {
    const groups: Array<TemplateVariableGroup> =
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.Logs,
        seriesAttributeKeys: ["con_name", "sophos.gw_name"],
      });

    const groupValues: TemplateVariableGroup | undefined = groups.find(
      (group: TemplateVariableGroup) => {
        return group.title === GROUP_TITLE;
      },
    );

    expect(groupValues).toBeDefined();
    expect(
      groupValues!.variables.map((variable: TemplateVariable) => {
        return variable.key;
      }),
    ).toEqual(["con_name", "sophos.gw_name"]);
  });

  it("is not listed for an ungrouped Logs monitor", () => {
    expect(
      titlesOf(
        TemplateVariablesCatalog.getVariables({
          monitorType: MonitorType.Logs,
          seriesAttributeKeys: [],
        }),
      ),
    ).not.toContain(GROUP_TITLE);
  });

  it("is only for Logs monitors", () => {
    expect(
      titlesOf(
        TemplateVariablesCatalog.getVariables({
          monitorType: MonitorType.Traces,
          seriesAttributeKeys: ["con_name"],
        }),
      ),
    ).not.toContain(GROUP_TITLE);
  });
});

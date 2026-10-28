import {
  CheckOn,
  CriteriaFilterUtil,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepProbeStatusMonitor, {
  MonitorStepProbeStatusMonitorUtil,
} from "../../../Types/Monitor/MonitorStepProbeStatusMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorTemplateSyncFieldUtil from "../../../Types/Monitor/MonitorTemplateSyncField";
import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
  MonitorTypeProps,
} from "../../../Types/Monitor/MonitorType";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import { getMonitorStepSchema } from "../../../Utils/Schema/MonitorSchemas";

/*
 * The Probe Status monitor type (issue #2733): a monitor that watches the
 * project's probes and goes offline - opening one incident - when one of
 * them disconnects. These hold the type's pure definition: where it sits in
 * the picker, what it is not (probe-run, interval-driven), its step config,
 * its two checks and the criteria a new one starts with.
 */

const FRANKFURT: string = "73000000-0000-4000-8000-000000000001";
const SINGAPORE: string = "73000000-0000-4000-8000-000000000003";

function propsFor(monitorType: MonitorType): MonitorTypeProps {
  const props: MonitorTypeProps | undefined =
    MonitorTypeHelper.getAllMonitorTypeProps().find(
      (item: MonitorTypeProps): boolean => {
        return item.monitorType === monitorType;
      },
    );

  if (!props) {
    throw new Error(`No props for ${monitorType}`);
  }

  return props;
}

function defaultStep(monitorName: string = "Probe health"): MonitorStep {
  return MonitorStep.getDefaultMonitorStep({
    monitorName: monitorName,
    monitorType: MonitorType.ProbeStatus,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });
}

describe("MonitorType.ProbeStatus", () => {
  test("its stored value never changes", () => {
    expect(MonitorType.ProbeStatus).toBe("Probe Status");
  });

  test("is offered under Other, beside Manual, and nowhere else", () => {
    const categories: Array<MonitorTypeCategory> =
      MonitorTypeHelper.getMonitorTypeCategories();

    const holding: Array<string> = categories
      .filter((category: MonitorTypeCategory): boolean => {
        return category.monitorTypes.includes(MonitorType.ProbeStatus);
      })
      .map((category: MonitorTypeCategory): string => {
        return category.label;
      });

    expect(holding).toEqual(["Other"]);
    expect(
      categories.find((category: MonitorTypeCategory): boolean => {
        return category.label === "Other";
      })?.monitorTypes,
    ).toEqual([MonitorType.Manual, MonitorType.ProbeStatus]);
  });

  test("is not one of the six common types the picker opens on", () => {
    expect(MonitorTypeHelper.getCommonMonitorTypes()).not.toContain(
      MonitorType.ProbeStatus,
    );
  });

  test("says what it does on its card, short enough for the grid", () => {
    const props: MonitorTypeProps = propsFor(MonitorType.ProbeStatus);

    expect(props.title).toBe("Probe Status");
    expect(props.description).toBe(
      "Alert when a probe disconnects - one incident per outage, resolved when it reconnects.",
    );
    expect(props.description.length).toBeLessThanOrEqual(100);
    expect(props.icon).toBe(IconProp.SignalSlash);
    expect(MonitorTypeHelper.getTitle(MonitorType.ProbeStatus)).toBe(
      "Probe Status",
    );
  });

  test("answers the searches people make for a probe that went away", () => {
    expect(MonitorTypeHelper.getKeywords(MonitorType.ProbeStatus)).toEqual(
      expect.arrayContaining([
        "offline",
        "disconnected",
        "private location",
        "probe down",
      ]),
    );
  });

  test("no probe runs it, and it has no interval: OneUptime evaluates it every minute", () => {
    expect(MonitorTypeHelper.isProbableMonitor(MonitorType.ProbeStatus)).toBe(
      false,
    );
    expect(
      MonitorTypeHelper.doesMonitorTypeHaveInterval(MonitorType.ProbeStatus),
    ).toBe(false);
    expect(MonitorTypeHelper.isTelemetryMonitor(MonitorType.ProbeStatus)).toBe(
      false,
    );
    expect(
      MonitorTypeHelper.isMetricBackedMonitor(MonitorType.ProbeStatus),
    ).toBe(false);
  });

  test("has criteria, and counts as an active monitor like every type but Manual", () => {
    expect(
      MonitorTypeHelper.doesMonitorTypeHaveCriteria(MonitorType.ProbeStatus),
    ).toBe(true);
    expect(MonitorTypeHelper.getActiveMonitorTypes()).toContain(
      MonitorType.ProbeStatus,
    );
    expect(
      MonitorTypeHelper.isBilledAsActiveMonitor(MonitorType.ProbeStatus),
    ).toBe(true);
  });
});

describe("MonitorStepProbeStatusMonitorUtil", () => {
  test("a new step watches nothing yet", () => {
    expect(MonitorStepProbeStatusMonitorUtil.getDefault()).toEqual({
      probeIds: [],
    });
  });

  test("keeps each probe once, in the order first given, as first written", () => {
    expect(
      MonitorStepProbeStatusMonitorUtil.normalizeProbeIds([
        FRANKFURT,
        ` ${SINGAPORE} `,
        FRANKFURT.toUpperCase(),
        SINGAPORE,
      ]),
    ).toEqual([FRANKFURT, SINGAPORE]);
  });

  test("drops what is not an id-shaped string rather than failing the parse", () => {
    expect(
      MonitorStepProbeStatusMonitorUtil.normalizeProbeIds([
        "",
        "   ",
        12,
        null,
        undefined,
        { value: FRANKFURT },
        SINGAPORE,
      ]),
    ).toEqual([SINGAPORE]);
    expect(
      MonitorStepProbeStatusMonitorUtil.normalizeProbeIds(undefined),
    ).toEqual([]);
    expect(
      MonitorStepProbeStatusMonitorUtil.normalizeProbeIds(FRANKFURT),
    ).toEqual([]);
  });

  test("survives a JSON round trip, normalized both ways", () => {
    const json: JSONObject = MonitorStepProbeStatusMonitorUtil.toJSON({
      probeIds: [FRANKFURT, FRANKFURT, SINGAPORE],
    });

    expect(json).toEqual({ probeIds: [FRANKFURT, SINGAPORE] });

    const parsed: MonitorStepProbeStatusMonitor =
      MonitorStepProbeStatusMonitorUtil.fromJSON({
        probeIds: [SINGAPORE, "", SINGAPORE.toUpperCase()],
      });

    expect(parsed).toEqual({ probeIds: [SINGAPORE] });
    expect(MonitorStepProbeStatusMonitorUtil.fromJSON({})).toEqual({
      probeIds: [],
    });
  });
});

describe("MonitorStep for a Probe Status monitor", () => {
  test("a new step is seeded with an empty probe list, other types are not", () => {
    expect(defaultStep().data?.probeStatusMonitor).toEqual({ probeIds: [] });

    const website: MonitorStep = MonitorStep.getDefaultMonitorStep({
      monitorName: "Storefront",
      monitorType: MonitorType.Website,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
    });

    expect(website.data?.probeStatusMonitor).toBeUndefined();
  });

  test("cannot be saved watching no probe, and says what to do", () => {
    const step: MonitorStep = defaultStep();

    expect(MonitorStep.getValidationError(step, MonitorType.ProbeStatus)).toBe(
      "Pick at least one probe to watch",
    );

    step.setProbeStatusMonitor({ probeIds: ["   "] });

    expect(MonitorStep.getValidationError(step, MonitorType.ProbeStatus)).toBe(
      "Pick at least one probe to watch",
    );
  });

  test("is valid once it watches a probe", () => {
    const step: MonitorStep = defaultStep();
    step.setProbeStatusMonitor({ probeIds: [FRANKFURT] });

    expect(
      MonitorStep.getValidationError(step, MonitorType.ProbeStatus),
    ).toBeNull();
  });

  test("the probes it watches survive toJSON and fromJSON, each once", () => {
    const step: MonitorStep = defaultStep();
    step.setProbeStatusMonitor({
      probeIds: [FRANKFURT, SINGAPORE, FRANKFURT],
    });

    const json: JSONObject = step.toJSON();
    const value: JSONObject = json["value"] as JSONObject;

    expect(value["probeStatusMonitor"]).toEqual({
      probeIds: [FRANKFURT, SINGAPORE],
    });

    const parsed: MonitorStep = MonitorStep.fromJSON(json);

    expect(parsed.data?.probeStatusMonitor).toEqual({
      probeIds: [FRANKFURT, SINGAPORE],
    });
  });

  test("a step written by hand is normalized on the way in", () => {
    const json: JSONObject = defaultStep().toJSON();
    (json["value"] as JSONObject)["probeStatusMonitor"] = {
      probeIds: [SINGAPORE, 7, "", SINGAPORE.toUpperCase()],
    };

    expect(MonitorStep.fromJSON(json).data?.probeStatusMonitor).toEqual({
      probeIds: [SINGAPORE],
    });
  });

  test("a step of another type carries no probe status config", () => {
    const json: JSONObject = defaultStep().toJSON();
    delete (json["value"] as JSONObject)["probeStatusMonitor"];

    expect(MonitorStep.fromJSON(json).data?.probeStatusMonitor).toBeUndefined();
  });

  test("the schema accepts the field", () => {
    const step: MonitorStep = defaultStep();
    step.setProbeStatusMonitor({ probeIds: [FRANKFURT] });

    expect(getMonitorStepSchema().safeParse(step.toJSON()).success).toBe(true);
  });
});

describe("the Probe Status checks", () => {
  test("their stored values never change", () => {
    expect(CheckOn.ConnectedProbes).toBe("Connected Probes");
    expect(CheckOn.DisconnectedProbes).toBe("Disconnected Probes");
  });

  test("take a number to compare with", () => {
    for (const checkOn of [
      CheckOn.ConnectedProbes,
      CheckOn.DisconnectedProbes,
    ]) {
      expect(
        CriteriaFilterUtil.hasValueField({
          checkOn: checkOn,
          filterType: FilterType.GreaterThan,
        }),
      ).toBe(true);
    }
  });

  test("can be judged over a window, the tunable hold-down", () => {
    for (const checkOn of [
      CheckOn.ConnectedProbes,
      CheckOn.DisconnectedProbes,
    ]) {
      expect(
        CriteriaFilterUtil.isEvaluateOverTimeFilter(
          checkOn,
          MonitorType.ProbeStatus,
        ),
      ).toBe(true);
      // Counts, not yes/no samples: every aggregate is on offer.
      expect(CriteriaFilterUtil.isBooleanSeries(checkOn)).toBe(false);
      expect(
        CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
          { checkOn: checkOn, filterType: FilterType.GreaterThan, value: 0 },
          MonitorType.ProbeStatus,
        ).length,
      ).toBe(6);
    }
  });
});

describe("the criteria a new Probe Status monitor starts with", () => {
  const onlineStatusId: ObjectID = ObjectID.generate();
  const offlineStatusId: ObjectID = ObjectID.generate();
  const incidentSeverityId: ObjectID = ObjectID.generate();
  const alertSeverityId: ObjectID = ObjectID.generate();

  function defaults(): Array<MonitorCriteriaInstance> {
    return (
      MonitorCriteria.getDefaultMonitorCriteria({
        monitorType: MonitorType.ProbeStatus,
        monitorName: "Probe health",
        onlineMonitorStatusId: onlineStatusId,
        offlineMonitorStatusId: offlineStatusId,
        defaultIncidentSeverityId: incidentSeverityId,
        defaultAlertSeverityId: alertSeverityId,
      }).data?.monitorCriteriaInstanceArray || []
    );
  }

  test("offline first, then online: the evaluator stops at the first match", () => {
    const [offline, online]: Array<MonitorCriteriaInstance> = defaults();

    expect(defaults()).toHaveLength(2);
    expect(offline?.data?.name).toBe("Check if a probe is disconnected");
    expect(online?.data?.name).toBe("Check if every probe is connected");
  });

  test("offline: any probe disconnected changes the status and opens one incident that resolves itself", () => {
    const offline: MonitorCriteriaInstance = defaults()[0]!;

    expect(offline.data?.filters).toEqual([
      {
        checkOn: CheckOn.DisconnectedProbes,
        filterType: FilterType.GreaterThan,
        value: 0,
      },
    ]);
    expect(offline.data?.monitorStatusId?.toString()).toBe(
      offlineStatusId.toString(),
    );
    expect(offline.data?.changeMonitorStatus).toBe(true);
    expect(offline.data?.createIncidents).toBe(true);
    expect(offline.data?.createAlerts).toBe(false);
    expect(offline.data?.incidents).toHaveLength(1);

    const incident: NonNullable<
      NonNullable<MonitorCriteriaInstance["data"]>["incidents"]
    >[number] = offline.data!.incidents[0]!;

    expect(incident.autoResolveIncident).toBe(true);
    expect(incident.incidentSeverityId?.toString()).toBe(
      incidentSeverityId.toString(),
    );
    // The title names the probes, not the watcher.
    expect(incident.title).toBe(
      "Probe disconnected: {{disconnectedProbeNames}}",
    );
    /*
     * The probes first, then what it means, what it costs and what happens
     * next - read by whoever is paged, so no jargon and no guesswork.
     */
    expect(incident.description).toBe(
      "{{probeStatusSummary}}\n\nA probe is disconnected when nothing has been heard from it for three minutes. Monitors that run only on a disconnected probe are not checked until it is back. This resolves itself once every probe this monitor watches is connected again.",
    );
    expect(incident.description).toBe(
      MonitorCriteriaInstance.PROBE_DISCONNECTED_DESCRIPTION,
    );
    /*
     * It names no monitor: the incident is the monitor's own, a renamed
     * monitor would keep its old name here, and "every probe Probe health
     * watches" read as a typo.
     */
    expect(incident.description).not.toContain("Probe health");
    // A licence can rename the product; the stored default never names it.
    expect(incident.description).not.toContain("OneUptime");
  });

  test("the criteria describe themselves by this monitor, not by its name", () => {
    const [offline, online]: Array<MonitorCriteriaInstance> = defaults();

    expect(offline?.data?.description).toBe(
      "This criteria checks if any probe this monitor watches is disconnected",
    );
    expect(online?.data?.description).toBe(
      "This criteria checks if every probe this monitor watches is connected",
    );
  });

  test("the alert it would open, once switched on, reads the same and resolves itself", () => {
    const offline: MonitorCriteriaInstance = defaults()[0]!;

    expect(offline.data?.alerts).toHaveLength(1);
    expect(offline.data?.alerts[0]?.title).toBe(
      "Probe disconnected: {{disconnectedProbeNames}}",
    );
    expect(offline.data?.alerts[0]?.autoResolveAlert).toBe(true);
    expect(offline.data?.alerts[0]?.description).toBe(
      offline.data?.incidents[0]?.description,
    );
    expect(offline.data?.alerts[0]?.alertSeverityId?.toString()).toBe(
      alertSeverityId.toString(),
    );
  });

  test("online: every probe connected, the exact complement", () => {
    const online: MonitorCriteriaInstance = defaults()[1]!;

    expect(online.data?.filterCondition).toBe(FilterCondition.All);
    expect(online.data?.filters).toEqual([
      {
        checkOn: CheckOn.DisconnectedProbes,
        filterType: FilterType.EqualTo,
        value: 0,
      },
    ]);
    expect(online.data?.monitorStatusId?.toString()).toBe(
      onlineStatusId.toString(),
    );
    expect(online.data?.changeMonitorStatus).toBe(true);
    expect(online.data?.createIncidents).toBe(false);
  });

  test("both are valid as they are, so a new monitor saves on its defaults", () => {
    for (const criteria of defaults()) {
      expect(
        MonitorCriteriaInstance.getValidationError(
          criteria,
          MonitorType.ProbeStatus,
        ),
      ).toBeNull();
    }
  });

  test("a whole new monitor's steps are valid once a probe is picked", () => {
    const steps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
      monitorType: MonitorType.ProbeStatus,
      monitorName: "Probe health",
      defaultMonitorStatusId: onlineStatusId,
      onlineMonitorStatusId: onlineStatusId,
      offlineMonitorStatusId: offlineStatusId,
      defaultIncidentSeverityId: incidentSeverityId,
      defaultAlertSeverityId: alertSeverityId,
    });

    expect(
      MonitorSteps.getValidationError(steps, MonitorType.ProbeStatus),
    ).toBe("Pick at least one probe to watch");

    steps.data!.monitorStepsInstanceArray[0]!.setProbeStatusMonitor({
      probeIds: [FRANKFURT],
    });

    expect(
      MonitorSteps.getValidationError(steps, MonitorType.ProbeStatus),
    ).toBeNull();
  });
});

describe("a Probe Status monitor template", () => {
  test("can leave the probes to each monitor made from it", () => {
    expect(
      MonitorTemplateSyncFieldUtil.getFields(MonitorType.ProbeStatus),
    ).toEqual([
      { path: "probeStatusMonitor.probeIds", label: "Probes to watch" },
    ]);
    expect(
      MonitorTemplateSyncFieldUtil.parse(
        ["probeStatusMonitor.probeIds"],
        MonitorType.ProbeStatus,
      ),
    ).toEqual(["probeStatusMonitor.probeIds"]);
  });
});

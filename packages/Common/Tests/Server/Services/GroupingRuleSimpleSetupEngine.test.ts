import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import MonitorService from "../../../Server/Services/MonitorService";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
  RULE_CRITERIA_SCHEMA_VERSION,
} from "../../../Types/Rules/RuleCriteria";
import {
  GROUPING_RULE_TEMPLATES,
  GROUP_BY_FIELD_NAMES,
  GroupByFieldNames,
  GroupingMode,
  GroupingRuleKind,
  GroupingRuleTemplate,
  GroupingRuleTranslateFunction,
  GroupingRuleValues,
  getEffectiveTimeWindowMinutes,
  getGroupingMode,
  getNewGroupingRuleValues,
  getTemplateRuleValues,
  getValuesForGroupingModeChange,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/GroupingRule/GroupingRuleSetup";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The simplified grouping rule pages change how a rule is set up, not what a
 * rule is: they write the same columns, and IncidentGroupingEngineService
 * and AlertGroupingEngineService read them unchanged. These run the real
 * engines on rules made the new ways - a ready-made template, a blank rule,
 * an existing rule opened and saved - and hold them to two things:
 *
 *   - they group exactly as a rule with the same switches set by hand
 *     always has, for every combination of the five switches;
 *   - what the pages tell people is what the engines do: "Numbers in titles
 *     are ignored", one shared episode for Everything Together, the time
 *     window a template promises (and the hour a window with no minutes
 *     falls back to), and a rule with no conditions matching every new
 *     incident whichever way it was saved.
 */

interface IncidentEngineInternals {
  buildGroupingKey: (
    incident: Incident,
    rule: IncidentGroupingRule,
  ) => Promise<string>;
  doesIncidentMatchRule: (
    incident: Incident,
    rule: IncidentGroupingRule,
  ) => Promise<boolean>;
  groupIncidentWithRule: (
    incident: Incident,
    rule: IncidentGroupingRule,
  ) => Promise<unknown>;
  findMatchingActiveEpisode: (
    projectId: ObjectID,
    ruleId: ObjectID,
    groupingKey: string,
    timeWindowCutoff: Date | null,
  ) => Promise<IncidentEpisode | null>;
  addIncidentToEpisode: (...args: Array<unknown>) => Promise<void>;
}

interface AlertEngineInternals {
  buildGroupingKey: (alert: Alert, rule: AlertGroupingRule) => Promise<string>;
  doesAlertMatchRule: (
    alert: Alert,
    rule: AlertGroupingRule,
  ) => Promise<boolean>;
  groupAlertWithRule: (
    alert: Alert,
    rule: AlertGroupingRule,
  ) => Promise<unknown>;
  findMatchingActiveEpisode: (
    projectId: ObjectID,
    ruleId: ObjectID,
    groupingKey: string,
    timeWindowCutoff: Date | null,
  ) => Promise<AlertEpisode | null>;
  addAlertToEpisode: (...args: Array<unknown>) => Promise<void>;
}

const incidentEngine: IncidentEngineInternals =
  IncidentGroupingEngineService as unknown as IncidentEngineInternals;
const alertEngine: AlertEngineInternals =
  AlertGroupingEngineService as unknown as AlertEngineInternals;

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-0000000000a1",
);
const RULE_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-0000000000b1");
const MONITOR_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-0000000000c1",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-0000000000d1",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-0000000000e1",
);
const LABEL_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-0000000000f1");
const MONITOR_LABEL_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-0000000000f2",
);

const NOW: Date = new Date("2026-10-02T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

const english: GroupingRuleTranslateFunction = (text: string): string => {
  return text;
};

function label(id: ObjectID): Label {
  const item: Label = new Label();
  item.id = id;
  return item;
}

function incidentNamed(title: string): Incident {
  const incident: Incident = new Incident();
  incident.id = ObjectID.generate();
  incident.projectId = PROJECT_ID;
  incident.title = title;
  incident.description = "Checkout is failing";
  incident.incidentSeverityId = SEVERITY_ID;
  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.name = "checkout-api";
  incident.monitors = [monitor];
  incident.labels = [label(LABEL_ID)];
  return incident;
}

function alertNamed(title: string): Alert {
  const alert: Alert = new Alert();
  alert.id = ObjectID.generate();
  alert.projectId = PROJECT_ID;
  alert.title = title;
  alert.description = "Checkout is failing";
  alert.alertSeverityId = SEVERITY_ID;
  alert.monitorId = MONITOR_ID;
  alert.labels = [label(LABEL_ID)];
  return alert;
}

function incidentRule(values: GroupingRuleValues): IncidentGroupingRule {
  const rule: IncidentGroupingRule = new IncidentGroupingRule();
  rule.id = RULE_ID;
  rule.name = "Rule";
  Object.assign(rule, values);
  return rule;
}

function alertRule(values: GroupingRuleValues): AlertGroupingRule {
  const rule: AlertGroupingRule = new AlertGroupingRule();
  rule.id = RULE_ID;
  rule.name = "Rule";
  Object.assign(rule, values);
  return rule;
}

function everySwitchCombination(
  kind: GroupingRuleKind,
): Array<Record<string, boolean>> {
  const names: GroupByFieldNames = GROUP_BY_FIELD_NAMES[kind];
  const fields: Array<string> = [
    names.monitor,
    names.severity,
    names.title,
    names.labels,
    names.monitorLabels,
  ];
  const combinations: Array<Record<string, boolean>> = [];

  for (let mask: number = 0; mask < 32; mask++) {
    const values: Record<string, boolean> = {};
    fields.forEach((field: string, index: number): void => {
      values[field] = (mask & (1 << index)) !== 0;
    });
    combinations.push(values);
  }

  return combinations;
}

// What the form saves for a rule opened and saved without changing its answer.
function savedUntouched(
  values: Record<string, boolean>,
  kind: GroupingRuleKind,
): GroupingRuleValues {
  return {
    ...values,
    ...getValuesForGroupingModeChange({
      values,
      mode: getGroupingMode(values, kind),
      kind,
      translate: english,
    }),
  };
}

function emptyCriteria(): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: [],
  };
}

beforeEach(() => {
  jest
    .spyOn(MonitorService, "findOneById")
    .mockImplementation(async (): Promise<Monitor> => {
      const monitor: Monitor = new Monitor();
      monitor.id = MONITOR_ID;
      monitor.labels = [label(MONITOR_LABEL_ID)];
      return monitor;
    });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("incident grouping keys", () => {
  test("every switch combination groups the same, saved by hand or by the simplified form", async () => {
    const incident: Incident = incidentNamed("CPU 91% on host-12");

    for (const values of everySwitchCombination(GroupingRuleKind.Incident)) {
      const byHand: string = await incidentEngine.buildGroupingKey(
        incident,
        incidentRule(values),
      );
      const byForm: string = await incidentEngine.buildGroupingKey(
        incident,
        incidentRule(savedUntouched(values, GroupingRuleKind.Incident)),
      );

      expect({ values, key: byForm }).toEqual({ values, key: byHand });
    }
  });

  test.each(
    GROUPING_RULE_TEMPLATES.map(
      (template: GroupingRuleTemplate): [string, GroupingRuleTemplate] => {
        return [template.id, template];
      },
    ),
  )(
    "the %s template groups like the switch it names",
    async (_id: string, template: GroupingRuleTemplate) => {
      const incident: Incident = incidentNamed("Disk 80% full");
      const key: string = await incidentEngine.buildGroupingKey(
        incident,
        incidentRule(
          getTemplateRuleValues({
            template,
            kind: GroupingRuleKind.Incident,
            translate: english,
          }),
        ),
      );

      const expected: Record<string, string> = {
        [GroupingMode.Monitor]: `monitor:${MONITOR_ID.toString()}`,
        [GroupingMode.Severity]: `severity:${SEVERITY_ID.toString()}`,
        [GroupingMode.Title]: "title:disk X% full",
        [GroupingMode.Everything]: "default",
      };

      expect(key).toBe(expected[template.mode]);
    },
  );

  test("a blank rule groups by monitor", async () => {
    expect(
      await incidentEngine.buildGroupingKey(
        incidentNamed("Anything"),
        incidentRule(
          getNewGroupingRuleValues({
            kind: GroupingRuleKind.Incident,
            translate: english,
          }),
        ),
      ),
    ).toBe(`monitor:${MONITOR_ID.toString()}`);
  });

  test("the Title card's promise: numbers and case in titles are ignored", async () => {
    const rule: IncidentGroupingRule = incidentRule({
      groupByIncidentTitle: true,
    });

    const first: string = await incidentEngine.buildGroupingKey(
      incidentNamed("CPU 91% on host-12"),
      rule,
    );
    const second: string = await incidentEngine.buildGroupingKey(
      incidentNamed("cpu 97% on HOST-3"),
      rule,
    );
    const other: string = await incidentEngine.buildGroupingKey(
      incidentNamed("Memory 91% on host-12"),
      rule,
    );

    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });

  test("Everything Together puts every incident under one key", async () => {
    const rule: IncidentGroupingRule = incidentRule({});

    expect(
      await incidentEngine.buildGroupingKey(incidentNamed("A"), rule),
    ).toBe("default");
    expect(
      await incidentEngine.buildGroupingKey(incidentNamed("B 2"), rule),
    ).toBe("default");
  });

  test("a custom mix keys on each of its switches, labels by their exact set", async () => {
    expect(
      await incidentEngine.buildGroupingKey(
        incidentNamed("Latency"),
        incidentRule({
          groupByMonitor: true,
          groupBySeverity: true,
          groupByIncidentLabels: true,
          groupByMonitorLabels: true,
        }),
      ),
    ).toBe(
      [
        `monitor:${MONITOR_ID.toString()}`,
        `severity:${SEVERITY_ID.toString()}`,
        `incidentLabels:${LABEL_ID.toString()}`,
        `monitorLabels:${MONITOR_LABEL_ID.toString()}`,
      ].join("|"),
    );
  });
});

describe("alert grouping keys", () => {
  test("every switch combination groups the same, saved by hand or by the simplified form", async () => {
    const alert: Alert = alertNamed("CPU 91% on host-12");

    for (const values of everySwitchCombination(GroupingRuleKind.Alert)) {
      const byHand: string = await alertEngine.buildGroupingKey(
        alert,
        alertRule(values),
      );
      const byForm: string = await alertEngine.buildGroupingKey(
        alert,
        alertRule(savedUntouched(values, GroupingRuleKind.Alert)),
      );

      expect({ values, key: byForm }).toEqual({ values, key: byHand });
    }
  });

  test.each(
    GROUPING_RULE_TEMPLATES.map(
      (template: GroupingRuleTemplate): [string, GroupingRuleTemplate] => {
        return [template.id, template];
      },
    ),
  )(
    "the %s template groups like the switch it names",
    async (_id: string, template: GroupingRuleTemplate) => {
      const key: string = await alertEngine.buildGroupingKey(
        alertNamed("Disk 80% full"),
        alertRule(
          getTemplateRuleValues({
            template,
            kind: GroupingRuleKind.Alert,
            translate: english,
          }),
        ),
      );

      const expected: Record<string, string> = {
        [GroupingMode.Monitor]: `monitor:${MONITOR_ID.toString()}`,
        [GroupingMode.Severity]: `severity:${SEVERITY_ID.toString()}`,
        [GroupingMode.Title]: "title:disk X% full",
        [GroupingMode.Everything]: "default",
      };

      expect(key).toBe(expected[template.mode]);
    },
  );
});

describe("the time window an episode is looked for in", () => {
  function stubIncidentGrouping(): SpyInstance<
    IncidentEngineInternals["findMatchingActiveEpisode"]
  > {
    jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({} as unknown as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
    jest
      .spyOn(incidentEngine, "addIncidentToEpisode")
      .mockResolvedValue(undefined);
    jest
      .spyOn(IncidentEpisodeService, "updateEpisodeSeverity")
      .mockResolvedValue(undefined);

    const episode: IncidentEpisode = new IncidentEpisode();
    episode.id = EPISODE_ID;

    return jest
      .spyOn(incidentEngine, "findMatchingActiveEpisode")
      .mockResolvedValue(episode);
  }

  function stubAlertGrouping(): SpyInstance<
    AlertEngineInternals["findMatchingActiveEpisode"]
  > {
    jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({} as unknown as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
    jest.spyOn(alertEngine, "addAlertToEpisode").mockResolvedValue(undefined);
    jest
      .spyOn(AlertEpisodeService, "updateEpisodeSeverity")
      .mockResolvedValue(undefined);

    const episode: AlertEpisode = new AlertEpisode();
    episode.id = EPISODE_ID;

    return jest
      .spyOn(alertEngine, "findMatchingActiveEpisode")
      .mockResolvedValue(episode);
  }

  function cutoffOf(
    spy: SpyInstance<
      (
        projectId: ObjectID,
        ruleId: ObjectID,
        groupingKey: string,
        timeWindowCutoff: Date | null,
      ) => Promise<unknown>
    >,
  ): Date | null {
    return (spy.mock.calls[0] as Array<unknown>)[3] as Date | null;
  }

  test.each(
    GROUPING_RULE_TEMPLATES.map(
      (template: GroupingRuleTemplate): [string, GroupingRuleTemplate] => {
        return [template.id, template];
      },
    ),
  )(
    "the %s template looks back exactly the time window its card promises",
    async (_id: string, template: GroupingRuleTemplate) => {
      jest.useFakeTimers({ now: NOW });
      const find: SpyInstance<
        IncidentEngineInternals["findMatchingActiveEpisode"]
      > = stubIncidentGrouping();

      const values: GroupingRuleValues = getTemplateRuleValues({
        template,
        kind: GroupingRuleKind.Incident,
        translate: english,
      });

      await incidentEngine.groupIncidentWithRule(
        incidentNamed("Disk full"),
        incidentRule(values),
      );

      expect(cutoffOf(find)?.getTime()).toBe(
        NOW.getTime() - template.timeWindowMinutes * MINUTE,
      );
      // The list's summary reads the same window.
      expect(getEffectiveTimeWindowMinutes(values)).toBe(
        template.timeWindowMinutes,
      );
    },
  );

  test("a window switched on with no minutes looks back an hour, as the list says", async () => {
    jest.useFakeTimers({ now: NOW });
    const find: SpyInstance<
      IncidentEngineInternals["findMatchingActiveEpisode"]
    > = stubIncidentGrouping();
    const values: GroupingRuleValues = {
      groupByMonitor: true,
      enableTimeWindow: true,
      timeWindowMinutes: 0,
    };

    await incidentEngine.groupIncidentWithRule(
      incidentNamed("Disk full"),
      incidentRule(values),
    );

    expect(cutoffOf(find)?.getTime()).toBe(NOW.getTime() - 60 * MINUTE);
    expect(getEffectiveTimeWindowMinutes(values)).toBe(60);
  });

  test("a window switched off looks for any open episode, as the list says", async () => {
    const find: SpyInstance<
      IncidentEngineInternals["findMatchingActiveEpisode"]
    > = stubIncidentGrouping();
    const values: GroupingRuleValues = {
      groupByMonitor: true,
      enableTimeWindow: false,
      timeWindowMinutes: 30,
    };

    await incidentEngine.groupIncidentWithRule(
      incidentNamed("Disk full"),
      incidentRule(values),
    );

    expect(cutoffOf(find)).toBeNull();
    expect(getEffectiveTimeWindowMinutes(values)).toBeNull();
  });

  test("alerts: a template's window is the window the alert engine looks back", async () => {
    jest.useFakeTimers({ now: NOW });
    const find: SpyInstance<AlertEngineInternals["findMatchingActiveEpisode"]> =
      stubAlertGrouping();

    await alertEngine.groupAlertWithRule(
      alertNamed("Disk full"),
      alertRule(
        getTemplateRuleValues({
          template: GROUPING_RULE_TEMPLATES[1]!,
          kind: GroupingRuleKind.Alert,
          translate: english,
        }),
      ),
    );

    expect(cutoffOf(find)?.getTime()).toBe(NOW.getTime() - 10 * MINUTE);
  });
});

describe("which incidents a rule with no conditions applies to", () => {
  test("a template's rule, saved with no conditions at all, matches every incident", async () => {
    for (const template of GROUPING_RULE_TEMPLATES) {
      await expect(
        incidentEngine.doesIncidentMatchRule(
          incidentNamed("Anything at all"),
          incidentRule(
            getTemplateRuleValues({
              template,
              kind: GroupingRuleKind.Incident,
              translate: english,
            }),
          ),
        ),
      ).resolves.toBe(true);
    }
  });

  test("the form's rule - empty conditions and the legacy safety pattern - matches every incident too", async () => {
    await expect(
      incidentEngine.doesIncidentMatchRule(
        incidentNamed("Anything at all"),
        incidentRule({
          ...getNewGroupingRuleValues({
            kind: GroupingRuleKind.Incident,
            translate: english,
          }),
          criteria: emptyCriteria(),
          incidentTitlePattern: RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
          monitors: [],
          incidentSeverities: [],
        }),
      ),
    ).resolves.toBe(true);
  });

  test("alerts: both ways of saving a rule with no conditions match every alert", async () => {
    await expect(
      alertEngine.doesAlertMatchRule(
        alertNamed("Anything at all"),
        alertRule(
          getTemplateRuleValues({
            template: GROUPING_RULE_TEMPLATES[0]!,
            kind: GroupingRuleKind.Alert,
            translate: english,
          }),
        ),
      ),
    ).resolves.toBe(true);

    await expect(
      alertEngine.doesAlertMatchRule(
        alertNamed("Anything at all"),
        alertRule({
          criteria: emptyCriteria(),
          alertTitlePattern: RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
        }),
      ),
    ).resolves.toBe(true);
  });
});

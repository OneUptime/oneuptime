import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import AlertEpisodeLabelRuleEngineService from "../../../Server/Services/AlertEpisodeLabelRuleEngineService";
import AlertEpisodeOnCallRuleEngineService from "../../../Server/Services/AlertEpisodeOnCallRuleEngineService";
import AlertEpisodeOwnerRuleEngineService from "../../../Server/Services/AlertEpisodeOwnerRuleEngineService";
import AlertEpisodePrivacyRuleEngineService from "../../../Server/Services/AlertEpisodePrivacyRuleEngineService";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import AlertLabelRuleEngineService from "../../../Server/Services/AlertLabelRuleEngineService";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOwnerRuleEngineService from "../../../Server/Services/AlertOwnerRuleEngineService";
import AlertPrivacyRuleEngineService from "../../../Server/Services/AlertPrivacyRuleEngineService";
import IncidentEpisodeLabelRuleEngineService from "../../../Server/Services/IncidentEpisodeLabelRuleEngineService";
import IncidentEpisodeOnCallRuleEngineService from "../../../Server/Services/IncidentEpisodeOnCallRuleEngineService";
import IncidentEpisodeOwnerRuleEngineService from "../../../Server/Services/IncidentEpisodeOwnerRuleEngineService";
import IncidentEpisodePrivacyRuleEngineService from "../../../Server/Services/IncidentEpisodePrivacyRuleEngineService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentLabelRuleEngineService from "../../../Server/Services/IncidentLabelRuleEngineService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentPrivacyRuleEngineService from "../../../Server/Services/IncidentPrivacyRuleEngineService";
import MonitorService from "../../../Server/Services/MonitorService";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

const PRODUCTION_LABEL_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CUSTOMER_LABEL_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const STAGING_LABEL_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MONITOR_A_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_B_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

interface AlertRuleMatchFields {
  criteria?: RuleCriteria | null | undefined;
  alertLabels?: Array<Label> | undefined;
  alertTitlePattern?: string | undefined;
  alertDescriptionPattern?: string | undefined;
  matchCriteria?: unknown;
}

interface IncidentRuleMatchFields {
  criteria?: RuleCriteria | null | undefined;
  incidentLabels?: Array<Label> | undefined;
  incidentTitlePattern?: string | undefined;
  incidentDescriptionPattern?: string | undefined;
  matchCriteria?: unknown;
}

interface AlertEpisodeRuleMatchFields {
  criteria?: RuleCriteria | null | undefined;
  episodeLabels?: Array<Label> | undefined;
  episodeTitlePattern?: string | undefined;
  episodeDescriptionPattern?: string | undefined;
}

interface IncidentEpisodeRuleMatchFields {
  criteria?: RuleCriteria | null | undefined;
  episodeLabels?: Array<Label> | undefined;
  episodeTitlePattern?: string | undefined;
  episodeDescriptionPattern?: string | undefined;
}

interface AsyncAlertRuleMatcher {
  doesAlertMatchRule: (
    alert: Alert,
    rule: AlertRuleMatchFields,
  ) => Promise<boolean>;
}

interface AsyncIncidentRuleMatcher {
  doesIncidentMatchRule: (
    incident: Incident,
    rule: IncidentRuleMatchFields,
  ) => Promise<boolean>;
}

interface AlertEpisodeRuleMatcher {
  doesEpisodeMatchRule: (
    episode: AlertEpisode,
    rule: AlertEpisodeRuleMatchFields,
  ) => boolean;
}

interface IncidentEpisodeRuleMatcher {
  doesEpisodeMatchRule: (
    episode: IncidentEpisode,
    rule: IncidentEpisodeRuleMatchFields,
  ) => boolean;
}

function fakeLabel(id: ObjectID): Label {
  return { id, _id: id.toString() } as unknown as Label;
}

function criteria(
  filterCondition: FilterCondition,
  filters: RuleCriteria["filters"],
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition,
    filters,
  };
}

function fakeAlert(fields?: {
  title?: string | undefined;
  description?: string | undefined;
  labels?: Array<ObjectID> | undefined;
}): Alert {
  return {
    title: fields?.title || "Production API failure",
    description: fields?.description || "Customer checkout is unavailable",
    labels: (fields?.labels || [PRODUCTION_LABEL_ID, CUSTOMER_LABEL_ID]).map(
      fakeLabel,
    ),
  } as unknown as Alert;
}

function fakeIncident(fields?: {
  title?: string | undefined;
  description?: string | undefined;
  labels?: Array<ObjectID> | undefined;
}): Incident {
  return {
    title: fields?.title || "Production API outage",
    description: fields?.description || "Customer checkout is unavailable",
    labels: (fields?.labels || [PRODUCTION_LABEL_ID, CUSTOMER_LABEL_ID]).map(
      fakeLabel,
    ),
  } as unknown as Incident;
}

function fakeAlertEpisode(fields?: {
  title?: string | undefined;
  description?: string | undefined;
  labels?: Array<ObjectID> | undefined;
}): AlertEpisode {
  return {
    title: fields?.title || "Production API alert episode",
    description: fields?.description || "Customer checkout is unavailable",
    labels: (fields?.labels || [PRODUCTION_LABEL_ID, CUSTOMER_LABEL_ID]).map(
      fakeLabel,
    ),
  } as unknown as AlertEpisode;
}

function fakeIncidentEpisode(fields?: {
  title?: string | undefined;
  description?: string | undefined;
  labels?: Array<ObjectID> | undefined;
}): IncidentEpisode {
  return {
    title: fields?.title || "Production API incident episode",
    description: fields?.description || "Customer checkout is unavailable",
    labels: (fields?.labels || [PRODUCTION_LABEL_ID, CUSTOMER_LABEL_ID]).map(
      fakeLabel,
    ),
  } as unknown as IncidentEpisode;
}

const alertMatchers: Array<{ name: string; matcher: AsyncAlertRuleMatcher }> = [
  {
    name: "alert label rules",
    matcher: AlertLabelRuleEngineService as unknown as AsyncAlertRuleMatcher,
  },
  {
    name: "alert owner rules",
    matcher: AlertOwnerRuleEngineService as unknown as AsyncAlertRuleMatcher,
  },
  {
    name: "alert on-call rules",
    matcher: AlertOnCallRuleEngineService as unknown as AsyncAlertRuleMatcher,
  },
  {
    name: "alert privacy rules",
    matcher: AlertPrivacyRuleEngineService as unknown as AsyncAlertRuleMatcher,
  },
  {
    name: "alert grouping rules",
    matcher: AlertGroupingEngineService as unknown as AsyncAlertRuleMatcher,
  },
];

describe.each(alertMatchers)(
  "$name configurable criteria",
  ({ matcher }: { matcher: AsyncAlertRuleMatcher }) => {
    it("supports Match Any and ignores stale legacy fields", async () => {
      const rule: AlertRuleMatchFields = {
        alertDescriptionPattern: "this stale value must not be evaluated",
        criteria: criteria(FilterCondition.Any, [
          {
            field: "alertTitlePattern",
            operator: RuleCriteriaOperator.StartsWith,
            value: "Background worker",
          },
          {
            field: "alertLabels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: [PRODUCTION_LABEL_ID.toString()],
          },
        ]),
      };

      await expect(matcher.doesAlertMatchRule(fakeAlert(), rule)).resolves.toBe(
        true,
      );
    });

    it("supports Match All, HasAllOf, and negative conditions", async () => {
      const rule: AlertRuleMatchFields = {
        criteria: criteria(FilterCondition.All, [
          {
            field: "alertTitlePattern",
            operator: RuleCriteriaOperator.Contains,
            value: "api",
          },
          {
            field: "alertLabels",
            operator: RuleCriteriaOperator.HasAllOf,
            value: [
              PRODUCTION_LABEL_ID.toString(),
              CUSTOMER_LABEL_ID.toString(),
            ],
          },
          {
            field: "alertDescriptionPattern",
            operator: RuleCriteriaOperator.DoesNotContain,
            value: "staging",
          },
          {
            field: "alertLabels",
            operator: RuleCriteriaOperator.HasNoneOf,
            value: [STAGING_LABEL_ID.toString()],
          },
        ]),
      };

      await expect(matcher.doesAlertMatchRule(fakeAlert(), rule)).resolves.toBe(
        true,
      );
      await expect(
        matcher.doesAlertMatchRule(
          fakeAlert({ labels: [PRODUCTION_LABEL_ID] }),
          rule,
        ),
      ).resolves.toBe(false);
    });

    it("preserves legacy all-fields and empty-rule behavior", async () => {
      await expect(
        matcher.doesAlertMatchRule(fakeAlert(), {
          alertLabels: [fakeLabel(PRODUCTION_LABEL_ID)],
          alertTitlePattern: "^production",
          alertDescriptionPattern: "checkout",
        }),
      ).resolves.toBe(true);
      await expect(
        matcher.doesAlertMatchRule(fakeAlert({ title: "Worker warning" }), {
          alertTitlePattern: "^production",
        }),
      ).resolves.toBe(false);
      await expect(matcher.doesAlertMatchRule(fakeAlert(), {})).resolves.toBe(
        true,
      );
    });
  },
);

const incidentMatchers: Array<{
  name: string;
  matcher: AsyncIncidentRuleMatcher;
}> = [
  {
    name: "incident label rules",
    matcher:
      IncidentLabelRuleEngineService as unknown as AsyncIncidentRuleMatcher,
  },
  {
    name: "incident owner rules",
    matcher:
      IncidentOwnerRuleEngineService as unknown as AsyncIncidentRuleMatcher,
  },
  {
    name: "incident on-call rules",
    matcher:
      IncidentOnCallRuleEngineService as unknown as AsyncIncidentRuleMatcher,
  },
  {
    name: "incident privacy rules",
    matcher:
      IncidentPrivacyRuleEngineService as unknown as AsyncIncidentRuleMatcher,
  },
  {
    name: "incident grouping rules",
    matcher:
      IncidentGroupingEngineService as unknown as AsyncIncidentRuleMatcher,
  },
];

describe.each(incidentMatchers)(
  "$name configurable criteria",
  ({ matcher }: { matcher: AsyncIncidentRuleMatcher }) => {
    it("supports Match Any and ignores stale legacy fields", async () => {
      const rule: IncidentRuleMatchFields = {
        incidentDescriptionPattern: "this stale value must not be evaluated",
        criteria: criteria(FilterCondition.Any, [
          {
            field: "incidentTitlePattern",
            operator: RuleCriteriaOperator.StartsWith,
            value: "Background worker",
          },
          {
            field: "incidentLabels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: [PRODUCTION_LABEL_ID.toString()],
          },
        ]),
      };

      await expect(
        matcher.doesIncidentMatchRule(fakeIncident(), rule),
      ).resolves.toBe(true);
    });

    it("supports Match All, HasAllOf, and negative conditions", async () => {
      const rule: IncidentRuleMatchFields = {
        criteria: criteria(FilterCondition.All, [
          {
            field: "incidentTitlePattern",
            operator: RuleCriteriaOperator.Contains,
            value: "api",
          },
          {
            field: "incidentLabels",
            operator: RuleCriteriaOperator.HasAllOf,
            value: [
              PRODUCTION_LABEL_ID.toString(),
              CUSTOMER_LABEL_ID.toString(),
            ],
          },
          {
            field: "incidentDescriptionPattern",
            operator: RuleCriteriaOperator.DoesNotContain,
            value: "staging",
          },
          {
            field: "incidentLabels",
            operator: RuleCriteriaOperator.HasNoneOf,
            value: [STAGING_LABEL_ID.toString()],
          },
        ]),
      };

      await expect(
        matcher.doesIncidentMatchRule(fakeIncident(), rule),
      ).resolves.toBe(true);
      await expect(
        matcher.doesIncidentMatchRule(
          fakeIncident({ labels: [PRODUCTION_LABEL_ID] }),
          rule,
        ),
      ).resolves.toBe(false);
    });

    it("preserves legacy behavior and keeps grouping matchCriteria separate", async () => {
      await expect(
        matcher.doesIncidentMatchRule(fakeIncident(), {
          incidentLabels: [fakeLabel(PRODUCTION_LABEL_ID)],
          incidentTitlePattern: "^production",
          incidentDescriptionPattern: "checkout",
          matchCriteria: { unrelatedGroupingConfiguration: true },
        }),
      ).resolves.toBe(true);
      await expect(
        matcher.doesIncidentMatchRule(
          fakeIncident({ title: "Worker warning" }),
          { incidentTitlePattern: "^production" },
        ),
      ).resolves.toBe(false);
      await expect(
        matcher.doesIncidentMatchRule(fakeIncident(), {
          matchCriteria: { unrelatedGroupingConfiguration: true },
        }),
      ).resolves.toBe(true);
    });
  },
);

describe.each(incidentMatchers)(
  "$name same-monitor correlation",
  ({ matcher }: { matcher: AsyncIncidentRuleMatcher }) => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("does not let two different monitors satisfy Match All", async () => {
      const monitorA: Monitor = {
        id: MONITOR_A_ID,
        name: "production-api",
        description: "internal service",
        labels: [],
      } as unknown as Monitor;
      const monitorB: Monitor = {
        id: MONITOR_B_ID,
        name: "background-worker",
        description: "customer checkout",
        labels: [],
      } as unknown as Monitor;
      const findOneById: jest.SpiedFunction<typeof MonitorService.findOneById> =
        jest
          .spyOn(MonitorService, "findOneById")
          .mockImplementation(
            async (
              data: Parameters<typeof MonitorService.findOneById>[0],
            ): Promise<Monitor> => {
              return data.id.toString() === MONITOR_A_ID.toString()
                ? monitorA
                : monitorB;
            },
          );

      const incident: Incident = fakeIncident();
      incident.monitors = [
        { id: MONITOR_A_ID } as Monitor,
        { id: MONITOR_B_ID } as Monitor,
      ];

      await expect(
        matcher.doesIncidentMatchRule(incident, {
          criteria: criteria(FilterCondition.All, [
            {
              field: "monitorNamePattern",
              operator: RuleCriteriaOperator.Contains,
              value: "api",
            },
            {
              field: "monitorDescriptionPattern",
              operator: RuleCriteriaOperator.Contains,
              value: "customer",
            },
          ]),
        }),
      ).resolves.toBe(false);
      expect(findOneById).toHaveBeenCalledTimes(2);
    });

    it("matches when one monitor satisfies every grouped condition", async () => {
      const monitorA: Monitor = {
        id: MONITOR_A_ID,
        name: "checkout-api",
        description: "customer checkout",
        labels: [],
      } as unknown as Monitor;
      const findOneById: jest.SpiedFunction<typeof MonitorService.findOneById> =
        jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitorA);

      const incident: Incident = fakeIncident();
      incident.monitors = [
        { id: MONITOR_A_ID } as Monitor,
        { id: MONITOR_B_ID } as Monitor,
      ];

      await expect(
        matcher.doesIncidentMatchRule(incident, {
          criteria: criteria(FilterCondition.All, [
            {
              field: "monitorNamePattern",
              operator: RuleCriteriaOperator.Contains,
              value: "api",
            },
            {
              field: "monitorDescriptionPattern",
              operator: RuleCriteriaOperator.Contains,
              value: "customer",
            },
          ]),
        }),
      ).resolves.toBe(true);
      expect(findOneById).toHaveBeenCalledTimes(1);
    });
  },
);

const alertEpisodeMatchers: Array<{
  name: string;
  matcher: AlertEpisodeRuleMatcher;
}> = [
  {
    name: "alert episode label rules",
    matcher:
      AlertEpisodeLabelRuleEngineService as unknown as AlertEpisodeRuleMatcher,
  },
  {
    name: "alert episode owner rules",
    matcher:
      AlertEpisodeOwnerRuleEngineService as unknown as AlertEpisodeRuleMatcher,
  },
  {
    name: "alert episode on-call rules",
    matcher:
      AlertEpisodeOnCallRuleEngineService as unknown as AlertEpisodeRuleMatcher,
  },
  {
    name: "alert episode privacy rules",
    matcher:
      AlertEpisodePrivacyRuleEngineService as unknown as AlertEpisodeRuleMatcher,
  },
];

describe.each(alertEpisodeMatchers)(
  "$name configurable criteria",
  ({ matcher }: { matcher: AlertEpisodeRuleMatcher }) => {
    it("combines conditions and preserves synchronous legacy fallback", () => {
      const rule: AlertEpisodeRuleMatchFields = {
        episodeDescriptionPattern: "this stale value must not be evaluated",
        criteria: criteria(FilterCondition.All, [
          {
            field: "episodeTitlePattern",
            operator: RuleCriteriaOperator.Contains,
            value: "api",
          },
          {
            field: "episodeLabels",
            operator: RuleCriteriaOperator.HasAllOf,
            value: [
              PRODUCTION_LABEL_ID.toString(),
              CUSTOMER_LABEL_ID.toString(),
            ],
          },
          {
            field: "episodeLabels",
            operator: RuleCriteriaOperator.HasNoneOf,
            value: [STAGING_LABEL_ID.toString()],
          },
        ]),
      };

      expect(matcher.doesEpisodeMatchRule(fakeAlertEpisode(), rule)).toBe(true);
      expect(
        matcher.doesEpisodeMatchRule(
          fakeAlertEpisode({ labels: [PRODUCTION_LABEL_ID] }),
          rule,
        ),
      ).toBe(false);
      expect(
        matcher.doesEpisodeMatchRule(fakeAlertEpisode(), {
          episodeTitlePattern: "^production",
          episodeDescriptionPattern: "checkout",
        }),
      ).toBe(true);
      expect(matcher.doesEpisodeMatchRule(fakeAlertEpisode(), {})).toBe(true);
    });
  },
);

const incidentEpisodeMatchers: Array<{
  name: string;
  matcher: IncidentEpisodeRuleMatcher;
}> = [
  {
    name: "incident episode label rules",
    matcher:
      IncidentEpisodeLabelRuleEngineService as unknown as IncidentEpisodeRuleMatcher,
  },
  {
    name: "incident episode owner rules",
    matcher:
      IncidentEpisodeOwnerRuleEngineService as unknown as IncidentEpisodeRuleMatcher,
  },
  {
    name: "incident episode on-call rules",
    matcher:
      IncidentEpisodeOnCallRuleEngineService as unknown as IncidentEpisodeRuleMatcher,
  },
  {
    name: "incident episode privacy rules",
    matcher:
      IncidentEpisodePrivacyRuleEngineService as unknown as IncidentEpisodeRuleMatcher,
  },
];

describe.each(incidentEpisodeMatchers)(
  "$name configurable criteria",
  ({ matcher }: { matcher: IncidentEpisodeRuleMatcher }) => {
    it("supports Match Any, negation, and synchronous legacy fallback", () => {
      const rule: IncidentEpisodeRuleMatchFields = {
        episodeDescriptionPattern: "this stale value must not be evaluated",
        criteria: criteria(FilterCondition.Any, [
          {
            field: "episodeTitlePattern",
            operator: RuleCriteriaOperator.StartsWith,
            value: "Background worker",
          },
          {
            field: "episodeLabels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: [PRODUCTION_LABEL_ID.toString()],
          },
        ]),
      };

      expect(matcher.doesEpisodeMatchRule(fakeIncidentEpisode(), rule)).toBe(
        true,
      );
      expect(
        matcher.doesEpisodeMatchRule(fakeIncidentEpisode(), {
          criteria: criteria(FilterCondition.All, [
            {
              field: "episodeDescriptionPattern",
              operator: RuleCriteriaOperator.DoesNotContain,
              value: "staging",
            },
            {
              field: "episodeLabels",
              operator: RuleCriteriaOperator.HasNoneOf,
              value: [STAGING_LABEL_ID.toString()],
            },
          ]),
        }),
      ).toBe(true);
      expect(
        matcher.doesEpisodeMatchRule(fakeIncidentEpisode(), {
          episodeTitlePattern: "^production",
          episodeDescriptionPattern: "checkout",
        }),
      ).toBe(true);
      expect(matcher.doesEpisodeMatchRule(fakeIncidentEpisode(), {})).toBe(
        true,
      );
    });
  },
);

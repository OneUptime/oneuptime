import { describe, expect, test } from "@jest/globals";
import IncidentFromAlerts, {
  AlertForAcknowledgement,
  AlertForIncidentPrefill,
  AlertsToAcknowledge,
  AlertStateForAcknowledgement,
  INCIDENT_PREFILL_RESOURCE_KEYS,
  IncidentPrefillFromAlerts,
  NamedResource,
  ParsedAlertIds,
  SeverityForMapping,
} from "../../../Utils/Incident/IncidentFromAlerts";
import { MAX_ALERTS_PER_INCIDENT_LINK_ACTION } from "../../../Types/Incident/IncidentAlertLink";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * The declare-incident-from-alerts prefill. Everything the create page puts
 * into the form comes out of these functions, so the rules the product
 * promises - which alert names the incident, how severities map, what gets
 * unioned, and that on-call policies are never copied - are pinned here.
 */

/* The project defaults: alerts get High / Low, incidents get three. */
const ALERT_HIGH: SeverityForMapping = {
  id: "alert-high",
  name: "High",
  order: 1,
};
const ALERT_LOW: SeverityForMapping = {
  id: "alert-low",
  name: "Low",
  order: 2,
};

const INCIDENT_CRITICAL: SeverityForMapping = {
  id: "incident-critical",
  name: "Critical Incident",
  order: 1,
};
const INCIDENT_MAJOR: SeverityForMapping = {
  id: "incident-major",
  name: "Major Incident",
  order: 2,
};
const INCIDENT_MINOR: SeverityForMapping = {
  id: "incident-minor",
  name: "Minor Incident",
  order: 3,
};

const DEFAULT_ALERT_SEVERITIES: Array<SeverityForMapping> = [
  ALERT_LOW,
  ALERT_HIGH,
];
const DEFAULT_INCIDENT_SEVERITIES: Array<SeverityForMapping> = [
  INCIDENT_MINOR,
  INCIDENT_CRITICAL,
  INCIDENT_MAJOR,
];

type ResourceFunction = (id: string, name?: string) => NamedResource;

const resource: ResourceFunction = (
  id: string,
  name?: string,
): NamedResource => {
  return { _id: id, name: name || `Resource ${id}` };
};

type AlertFunction = (
  id: string,
  overrides?: Partial<AlertForIncidentPrefill>,
) => AlertForIncidentPrefill;

const alert: AlertFunction = (
  id: string,
  overrides?: Partial<AlertForIncidentPrefill>,
): AlertForIncidentPrefill => {
  return {
    id: id,
    title: `Alert ${id} title`,
    description: `Alert ${id} description`,
    ...overrides,
  };
};

type BuildFunction = (
  alerts: Array<AlertForIncidentPrefill>,
  alertSeverities?: Array<SeverityForMapping>,
  incidentSeverities?: Array<SeverityForMapping>,
) => IncidentPrefillFromAlerts;

const build: BuildFunction = (
  alerts: Array<AlertForIncidentPrefill>,
  alertSeverities?: Array<SeverityForMapping>,
  incidentSeverities?: Array<SeverityForMapping>,
): IncidentPrefillFromAlerts => {
  return IncidentFromAlerts.buildIncidentPrefill({
    alerts: alerts,
    alertSeverities: alertSeverities || DEFAULT_ALERT_SEVERITIES,
    incidentSeverities: incidentSeverities || DEFAULT_INCIDENT_SEVERITIES,
  });
};

type MapFunction = (
  alertSeverityId: string | undefined,
  alertSeverities: Array<SeverityForMapping>,
  incidentSeverities: Array<SeverityForMapping>,
) => string | null;

const map: MapFunction = (
  alertSeverityId: string | undefined,
  alertSeverities: Array<SeverityForMapping>,
  incidentSeverities: Array<SeverityForMapping>,
): string | null => {
  return IncidentFromAlerts.mapAlertSeverityToIncidentSeverity({
    alertSeverityId: alertSeverityId,
    alertSeverities: alertSeverities,
    incidentSeverities: incidentSeverities,
  });
};

type IdsFunction = (resources: Array<NamedResource>) => Array<string>;

const idsOf: IdsFunction = (resources: Array<NamedResource>): Array<string> => {
  return resources.map((item: NamedResource): string => {
    return item._id;
  });
};

describe("IncidentFromAlerts", () => {
  describe("parseAlertIdsQueryParam", () => {
    test("reads nothing from a missing or empty parameter", () => {
      for (const value of [null, undefined, "", ",", " , "]) {
        expect(IncidentFromAlerts.parseAlertIdsQueryParam(value)).toEqual({
          alertIds: [],
          wasTruncated: false,
        });
      }
    });

    test("splits on commas, trims, and drops invalid and repeated ids", () => {
      const first: string = ObjectID.generate().toString();
      const second: string = ObjectID.generate().toString();

      const parsed: ParsedAlertIds = IncidentFromAlerts.parseAlertIdsQueryParam(
        ` ${first} ,not-an-id,${second},${first},,<script>`,
      );

      expect(parsed.alertIds).toEqual([first, second]);
      expect(parsed.wasTruncated).toBe(false);
    });

    test("caps the ids at the per-action maximum and says it did", () => {
      const ids: Array<string> = Array.from(
        { length: MAX_ALERTS_PER_INCIDENT_LINK_ACTION + 3 },
        () => {
          return ObjectID.generate().toString();
        },
      );

      const parsed: ParsedAlertIds = IncidentFromAlerts.parseAlertIdsQueryParam(
        ids.join(","),
      );

      expect(parsed.alertIds).toEqual(
        ids.slice(0, MAX_ALERTS_PER_INCIDENT_LINK_ACTION),
      );
      expect(parsed.wasTruncated).toBe(true);
    });

    test("is not truncated at exactly the maximum", () => {
      const ids: Array<string> = Array.from(
        { length: MAX_ALERTS_PER_INCIDENT_LINK_ACTION },
        () => {
          return ObjectID.generate().toString();
        },
      );

      const parsed: ParsedAlertIds = IncidentFromAlerts.parseAlertIdsQueryParam(
        ids.join(","),
      );

      expect(parsed.alertIds).toHaveLength(MAX_ALERTS_PER_INCIDENT_LINK_ACTION);
      expect(parsed.wasTruncated).toBe(false);
    });
  });

  describe("sortSeveritiesByOrder", () => {
    test("puts the most severe (lowest order) first", () => {
      expect(
        IncidentFromAlerts.sortSeveritiesByOrder(DEFAULT_INCIDENT_SEVERITIES),
      ).toEqual([INCIDENT_CRITICAL, INCIDENT_MAJOR, INCIDENT_MINOR]);
    });

    test("sorts severities without an order after every ordered one, keeping their input order", () => {
      const unorderedA: SeverityForMapping = { id: "a", name: "A" };
      const unorderedB: SeverityForMapping = { id: "b", name: "B" };

      expect(
        IncidentFromAlerts.sortSeveritiesByOrder([
          unorderedA,
          INCIDENT_MINOR,
          unorderedB,
          INCIDENT_CRITICAL,
        ]),
      ).toEqual([INCIDENT_CRITICAL, INCIDENT_MINOR, unorderedA, unorderedB]);
    });

    test("keeps input order for equal orders and does not mutate the input", () => {
      const first: SeverityForMapping = { id: "first", order: 1 };
      const second: SeverityForMapping = { id: "second", order: 1 };
      const input: Array<SeverityForMapping> = [second, first];

      expect(IncidentFromAlerts.sortSeveritiesByOrder(input)).toEqual([
        second,
        first,
      ]);
      expect(input).toEqual([second, first]);
    });

    test("handles an empty list", () => {
      expect(IncidentFromAlerts.sortSeveritiesByOrder([])).toEqual([]);
    });
  });

  describe("getSeverityRank", () => {
    test("ranks by order, most severe as 0", () => {
      expect(
        IncidentFromAlerts.getSeverityRank(
          "alert-high",
          DEFAULT_ALERT_SEVERITIES,
        ),
      ).toBe(0);
      expect(
        IncidentFromAlerts.getSeverityRank(
          "alert-low",
          DEFAULT_ALERT_SEVERITIES,
        ),
      ).toBe(1);
    });

    test("is null for an unknown or missing severity", () => {
      expect(
        IncidentFromAlerts.getSeverityRank("nope", DEFAULT_ALERT_SEVERITIES),
      ).toBeNull();
      expect(
        IncidentFromAlerts.getSeverityRank(undefined, DEFAULT_ALERT_SEVERITIES),
      ).toBeNull();
      expect(IncidentFromAlerts.getSeverityRank("alert-high", [])).toBeNull();
    });
  });

  describe("mapAlertSeverityToIncidentSeverity", () => {
    test("maps by rank: the most severe alert severity to the most severe incident severity", () => {
      expect(
        map(
          "alert-high",
          DEFAULT_ALERT_SEVERITIES,
          DEFAULT_INCIDENT_SEVERITIES,
        ),
      ).toBe("incident-critical");
      expect(
        map("alert-low", DEFAULT_ALERT_SEVERITIES, DEFAULT_INCIDENT_SEVERITIES),
      ).toBe("incident-major");
    });

    test("clamps to the least severe incident severity when there are fewer of them", () => {
      const alertSeverities: Array<SeverityForMapping> = [
        { id: "a1", name: "P1", order: 1 },
        { id: "a2", name: "P2", order: 2 },
        { id: "a3", name: "P3", order: 3 },
        { id: "a4", name: "P4", order: 4 },
      ];
      const incidentSeverities: Array<SeverityForMapping> = [
        { id: "i1", name: "Sev 1", order: 10 },
        { id: "i2", name: "Sev 2", order: 20 },
      ];

      expect(map("a1", alertSeverities, incidentSeverities)).toBe("i1");
      expect(map("a2", alertSeverities, incidentSeverities)).toBe("i2");
      expect(map("a3", alertSeverities, incidentSeverities)).toBe("i2");
      expect(map("a4", alertSeverities, incidentSeverities)).toBe("i2");
    });

    test("an exact name match wins over rank, ignoring case and surrounding spaces", () => {
      const alertSeverities: Array<SeverityForMapping> = [
        { id: "a-critical", name: "Critical", order: 1 },
        { id: "a-warning", name: "Warning", order: 2 },
      ];
      const incidentSeverities: Array<SeverityForMapping> = [
        { id: "i-sev1", name: "SEV1", order: 1 },
        { id: "i-warning", name: "  warning ", order: 3 },
        { id: "i-critical", name: "CRITICAL", order: 2 },
      ];

      // By rank these would be SEV1 and CRITICAL.
      expect(map("a-critical", alertSeverities, incidentSeverities)).toBe(
        "i-critical",
      );
      expect(map("a-warning", alertSeverities, incidentSeverities)).toBe(
        "i-warning",
      );
    });

    test("does not treat two unnamed severities as a name match", () => {
      const alertSeverities: Array<SeverityForMapping> = [
        { id: "a1", order: 1 },
        { id: "a2", order: 2 },
      ];
      const incidentSeverities: Array<SeverityForMapping> = [
        { id: "i1", order: 1 },
        { id: "i2", order: 2 },
      ];

      expect(map("a2", alertSeverities, incidentSeverities)).toBe("i2");
    });

    test("ranks severities without an order after the ordered ones", () => {
      const alertSeverities: Array<SeverityForMapping> = [
        { id: "a-unordered", name: "Other" },
        { id: "a1", name: "P1", order: 1 },
      ];
      const incidentSeverities: Array<SeverityForMapping> = [
        { id: "i-unordered", name: "Something" },
        { id: "i1", name: "Sev 1", order: 5 },
      ];

      expect(map("a1", alertSeverities, incidentSeverities)).toBe("i1");
      expect(map("a-unordered", alertSeverities, incidentSeverities)).toBe(
        "i-unordered",
      );
    });

    test("is null without a known alert severity or without incident severities", () => {
      expect(
        map(undefined, DEFAULT_ALERT_SEVERITIES, DEFAULT_INCIDENT_SEVERITIES),
      ).toBeNull();
      expect(
        map("unknown", DEFAULT_ALERT_SEVERITIES, DEFAULT_INCIDENT_SEVERITIES),
      ).toBeNull();
      expect(map("alert-high", DEFAULT_ALERT_SEVERITIES, [])).toBeNull();
      expect(map("alert-high", [], DEFAULT_INCIDENT_SEVERITIES)).toBeNull();
    });
  });

  describe("getMostSevereAlert", () => {
    test("picks the alert whose severity ranks highest", () => {
      const low: AlertForIncidentPrefill = alert("1", {
        alertSeverityId: "alert-low",
      });
      const high: AlertForIncidentPrefill = alert("2", {
        alertSeverityId: "alert-high",
      });

      expect(
        IncidentFromAlerts.getMostSevereAlert(
          [low, high],
          DEFAULT_ALERT_SEVERITIES,
        ),
      ).toBe(high);
    });

    test("keeps the first alert on a tie", () => {
      const first: AlertForIncidentPrefill = alert("1", {
        alertSeverityId: "alert-high",
      });
      const second: AlertForIncidentPrefill = alert("2", {
        alertSeverityId: "alert-high",
      });

      expect(
        IncidentFromAlerts.getMostSevereAlert(
          [first, second],
          DEFAULT_ALERT_SEVERITIES,
        ),
      ).toBe(first);
    });

    test("never lets an alert without a known severity win over one with a severity", () => {
      const unknown: AlertForIncidentPrefill = alert("1");
      const stale: AlertForIncidentPrefill = alert("2", {
        alertSeverityId: "deleted-severity",
      });
      const low: AlertForIncidentPrefill = alert("3", {
        alertSeverityId: "alert-low",
      });

      expect(
        IncidentFromAlerts.getMostSevereAlert(
          [unknown, stale, low],
          DEFAULT_ALERT_SEVERITIES,
        ),
      ).toBe(low);
    });

    test("falls back to the first alert when none has a known severity", () => {
      const first: AlertForIncidentPrefill = alert("1");
      const second: AlertForIncidentPrefill = alert("2");

      expect(IncidentFromAlerts.getMostSevereAlert([first, second], [])).toBe(
        first,
      );
    });

    test("is null for no alerts", () => {
      expect(
        IncidentFromAlerts.getMostSevereAlert([], DEFAULT_ALERT_SEVERITIES),
      ).toBeNull();
    });
  });

  describe("getAlertReference", () => {
    test("prefers the prefixed number, then the plain number", () => {
      expect(
        IncidentFromAlerts.getAlertReference(
          alert("1", { alertNumber: 7, alertNumberWithPrefix: "ALT-7" }),
        ),
      ).toBe("Alert ALT-7");
      expect(
        IncidentFromAlerts.getAlertReference(alert("1", { alertNumber: 7 })),
      ).toBe("Alert #7");
      expect(IncidentFromAlerts.getAlertReference(alert("1"))).toBe("Alert");
    });
  });

  describe("buildIncidentPrefill", () => {
    test("returns an empty prefill for no alerts", () => {
      expect(build([])).toEqual({
        title: "",
        description: "",
        incidentSeverityId: undefined,
        monitors: [],
        hosts: [],
        kubernetesClusters: [],
        dockerHosts: [],
        podmanHosts: [],
        services: [],
        labelIds: [],
        isPrivate: false,
      });
    });

    test("a single alert gives its own title, description and mapped severity", () => {
      const prefill: IncidentPrefillFromAlerts = build([
        alert("1", {
          title: "Checkout latency is high",
          description: "p99 above 2s for 10 minutes.",
          alertSeverityId: "alert-low",
        }),
      ]);

      expect(prefill.title).toBe("Checkout latency is high");
      expect(prefill.description).toBe("p99 above 2s for 10 minutes.");
      expect(prefill.incidentSeverityId).toBe("incident-major");
    });

    test("a single alert without a description leaves the description empty", () => {
      const prefill: IncidentPrefillFromAlerts = build([
        alert("1", { description: undefined }),
      ]);

      expect(prefill.description).toBe("");
    });

    test("several alerts take the most severe alert's title and list every alert in the description", () => {
      const prefill: IncidentPrefillFromAlerts = build([
        alert("1", {
          title: "Disk filling up",
          alertNumber: 11,
          alertSeverityId: "alert-low",
        }),
        alert("2", {
          title: "Database is down",
          alertNumber: 12,
          alertNumberWithPrefix: "ALT-12",
          alertSeverityId: "alert-high",
        }),
        alert("3", { title: "Queue backing up" }),
      ]);

      expect(prefill.title).toBe("Database is down");
      expect(prefill.description).toBe(
        [
          "- Alert #11: Disk filling up",
          "- Alert ALT-12: Database is down",
          "- Alert: Queue backing up",
        ].join("\n"),
      );
      expect(prefill.incidentSeverityId).toBe("incident-critical");
    });

    test("several alerts with no severity take the first alert's title and no severity", () => {
      const prefill: IncidentPrefillFromAlerts = build([
        alert("1", { title: "First" }),
        alert("2", { title: "Second" }),
      ]);

      expect(prefill.title).toBe("First");
      expect(prefill.incidentSeverityId).toBeUndefined();
    });

    test("leaves the severity unset when the project has no incident severities", () => {
      const prefill: IncidentPrefillFromAlerts = build(
        [alert("1", { alertSeverityId: "alert-high" })],
        DEFAULT_ALERT_SEVERITIES,
        [],
      );

      expect(prefill.incidentSeverityId).toBeUndefined();
    });

    test("unions monitors across alerts without duplicates, in first-seen order", () => {
      const prefill: IncidentPrefillFromAlerts = build([
        alert("1", { monitor: resource("m1", "API") }),
        alert("2", { monitor: resource("m2", "Website") }),
        alert("3", { monitor: resource("m1", "API") }),
        alert("4"),
      ]);

      expect(prefill.monitors).toEqual([
        { _id: "m1", name: "API" },
        { _id: "m2", name: "Website" },
      ]);
    });

    test.each(INCIDENT_PREFILL_RESOURCE_KEYS)(
      "unions %s across alerts without duplicates",
      (
        key:
          | "hosts"
          | "kubernetesClusters"
          | "dockerHosts"
          | "podmanHosts"
          | "services",
      ) => {
        const prefill: IncidentPrefillFromAlerts = build([
          alert("1", { [key]: [resource("r1"), resource("r2")] }),
          alert("2", { [key]: [resource("r2"), resource("r3")] }),
          alert("3", { [key]: [] }),
        ]);

        expect(idsOf(prefill[key])).toEqual(["r1", "r2", "r3"]);

        // Nothing leaks into the other lists.
        for (const otherKey of INCIDENT_PREFILL_RESOURCE_KEYS) {
          if (otherKey !== key) {
            expect(prefill[otherKey]).toEqual([]);
          }
        }
        expect(prefill.monitors).toEqual([]);
      },
    );

    test("skips resources without an id", () => {
      const prefill: IncidentPrefillFromAlerts = build([
        alert("1", {
          monitor: resource(""),
          hosts: [resource(""), resource("h1")],
        }),
      ]);

      expect(prefill.monitors).toEqual([]);
      expect(idsOf(prefill.hosts)).toEqual(["h1"]);
    });

    test("unions labels without duplicates or blanks", () => {
      const prefill: IncidentPrefillFromAlerts = build([
        alert("1", { labelIds: ["l1", "l2"] }),
        alert("2", { labelIds: ["l2", "", "l3"] }),
      ]);

      expect(prefill.labelIds).toEqual(["l1", "l2", "l3"]);
    });

    test("is private when any alert is private", () => {
      expect(
        build([alert("1"), alert("2", { isPrivate: true })]).isPrivate,
      ).toBe(true);
      expect(
        build([alert("1", { isPrivate: false }), alert("2")]).isPrivate,
      ).toBe(false);
    });

    test("never carries on-call policies", () => {
      const prefill: IncidentPrefillFromAlerts = build([
        alert("1", {
          alertSeverityId: "alert-high",
          monitor: resource("m1"),
          labelIds: ["l1"],
        }),
      ]);

      expect(Object.keys(prefill)).not.toContain("onCallDutyPolicies");
    });
  });

  describe("applyPrefillToInitialValues", () => {
    const prefill: IncidentPrefillFromAlerts = build([
      alert("1", {
        title: "Database is down",
        description: "Primary is unreachable.",
        alertSeverityId: "alert-high",
        monitor: resource("m1", "DB"),
        hosts: [resource("h1", "db-1")],
        services: [resource("s1", "Checkout")],
        labelIds: ["l1"],
        isPrivate: true,
      }),
    ]);

    test("fills an empty form with the whole prefill", () => {
      expect(
        IncidentFromAlerts.applyPrefillToInitialValues(
          { currentIncidentState: "state-1" },
          prefill,
        ),
      ).toEqual({
        currentIncidentState: "state-1",
        title: "Database is down",
        description: "Primary is unreachable.",
        incidentSeverity: "incident-critical",
        monitors: [{ _id: "m1", name: "DB" }],
        hosts: [{ _id: "h1", name: "db-1" }],
        services: [{ _id: "s1", name: "Checkout" }],
        labels: ["l1"],
        isPrivate: true,
      });
    });

    test("keeps what a template already set, and unions resources and labels with it", () => {
      const templateValues: JSONObject = {
        title: "Template title",
        description: "Template description",
        incidentSeverity: "incident-minor",
        monitors: [
          { _id: "m0", name: "Template monitor" },
          { _id: "m1", name: "DB" },
        ],
        hosts: [{ _id: "h0", name: "Template host" }],
        labels: ["l0", "l1"],
        onCallDutyPolicies: ["policy-1"],
        isPrivate: false,
      };

      const merged: JSONObject = IncidentFromAlerts.applyPrefillToInitialValues(
        templateValues,
        prefill,
      );

      expect(merged["title"]).toBe("Template title");
      expect(merged["description"]).toBe("Template description");
      expect(merged["incidentSeverity"]).toBe("incident-minor");
      expect(merged["monitors"]).toEqual([
        { _id: "m0", name: "Template monitor" },
        { _id: "m1", name: "DB" },
      ]);
      expect(merged["hosts"]).toEqual([
        { _id: "h0", name: "Template host" },
        { _id: "h1", name: "db-1" },
      ]);
      expect(merged["labels"]).toEqual(["l0", "l1"]);
      // The template's own on-call policies stay; none come from the alerts.
      expect(merged["onCallDutyPolicies"]).toEqual(["policy-1"]);
      expect(merged["isPrivate"]).toBe(true);
      // The input is not mutated.
      expect(templateValues["title"]).toBe("Template title");
      expect(templateValues["isPrivate"]).toBe(false);
    });

    test("fills a blank template title", () => {
      const merged: JSONObject = IncidentFromAlerts.applyPrefillToInitialValues(
        { title: "  " },
        prefill,
      );

      expect(merged["title"]).toBe("Database is down");
    });

    test("does not add empty lists or a false isPrivate", () => {
      const merged: JSONObject = IncidentFromAlerts.applyPrefillToInitialValues(
        {},
        build([alert("1", { title: "Only a title", description: "" })]),
      );

      expect(merged).toEqual({ title: "Only a title" });
    });

    test("never adds on-call policies", () => {
      const merged: JSONObject = IncidentFromAlerts.applyPrefillToInitialValues(
        {},
        prefill,
      );

      expect(merged["onCallDutyPolicies"]).toBeUndefined();
    });
  });
});

/*
 * Which alerts the create page offers to acknowledge as the incident is
 * declared. States are compared by order, as the server does: anything at or
 * after the project's Acknowledged state (Resolved, or a custom state in
 * between) has been acknowledged already. An alert whose state cannot be
 * placed is offered - the server skips it if it turns out to be acknowledged.
 */
describe("IncidentFromAlerts.getAlertsToAcknowledge", () => {
  const CREATED: AlertStateForAcknowledgement = {
    id: "state-created",
    order: 1,
    isAcknowledgedState: false,
  };
  const ACKNOWLEDGED: AlertStateForAcknowledgement = {
    id: "state-acknowledged",
    order: 2,
    isAcknowledgedState: true,
  };
  const RESOLVED: AlertStateForAcknowledgement = {
    id: "state-resolved",
    order: 3,
    isAcknowledgedState: false,
  };

  const DEFAULT_ALERT_STATES: Array<AlertStateForAcknowledgement> = [
    CREATED,
    ACKNOWLEDGED,
    RESOLVED,
  ];

  type AlertInStateFunction = (
    id: string,
    currentAlertStateId?: string | undefined,
  ) => AlertForAcknowledgement;

  const alertIn: AlertInStateFunction = (
    id: string,
    currentAlertStateId?: string | undefined,
  ): AlertForAcknowledgement => {
    return { id: id, currentAlertStateId: currentAlertStateId };
  };

  type GetFunction = (
    alerts: Array<AlertForAcknowledgement>,
    alertStates?: Array<AlertStateForAcknowledgement>,
  ) => AlertsToAcknowledge | null;

  const get: GetFunction = (
    alerts: Array<AlertForAcknowledgement>,
    alertStates?: Array<AlertStateForAcknowledgement>,
  ): AlertsToAcknowledge | null => {
    return IncidentFromAlerts.getAlertsToAcknowledge({
      alerts: alerts,
      alertStates: alertStates || DEFAULT_ALERT_STATES,
    });
  };

  describe("when nothing could be acknowledged", () => {
    test("is null when the project has no alert states at all", () => {
      expect(get([alertIn("a1", CREATED.id)], [])).toBeNull();
    });

    test("is null when no state is the Acknowledged state", () => {
      expect(
        get(
          [alertIn("a1", CREATED.id)],
          [CREATED, { ...ACKNOWLEDGED, isAcknowledgedState: false }, RESOLVED],
        ),
      ).toBeNull();
    });

    test("is null when the Acknowledged flag is missing rather than false", () => {
      expect(
        get(
          [alertIn("a1", CREATED.id)],
          [
            CREATED,
            { id: ACKNOWLEDGED.id, order: ACKNOWLEDGED.order },
            RESOLVED,
          ],
        ),
      ).toBeNull();
    });

    test("is null when the Acknowledged state has no order to compare by", () => {
      expect(
        get(
          [alertIn("a1", CREATED.id)],
          [CREATED, { ...ACKNOWLEDGED, order: undefined }, RESOLVED],
        ),
      ).toBeNull();
    });

    test("is null without an Acknowledged state even when there are no alerts", () => {
      expect(get([], [CREATED, RESOLVED])).toBeNull();
    });
  });

  describe("comparing by order", () => {
    test("offers an alert whose state comes before Acknowledged", () => {
      expect(get([alertIn("a1", CREATED.id)])).toEqual({
        alertIds: ["a1"],
        alreadyAcknowledgedCount: 0,
      });
    });

    test("leaves out an alert that is in the Acknowledged state itself", () => {
      expect(get([alertIn("a1", ACKNOWLEDGED.id)])).toEqual({
        alertIds: [],
        alreadyAcknowledgedCount: 1,
      });
    });

    test("leaves out an alert that is resolved", () => {
      expect(get([alertIn("a1", RESOLVED.id)])).toEqual({
        alertIds: [],
        alreadyAcknowledgedCount: 1,
      });
    });

    test("treats a custom state between Acknowledged and Resolved as acknowledged already", () => {
      const investigating: AlertStateForAcknowledgement = {
        id: "state-investigating",
        order: 3,
      };
      const resolved: AlertStateForAcknowledgement = {
        id: "state-resolved",
        order: 4,
      };

      expect(
        get(
          [alertIn("a1", investigating.id), alertIn("a2", resolved.id)],
          [CREATED, ACKNOWLEDGED, investigating, resolved],
        ),
      ).toEqual({ alertIds: [], alreadyAcknowledgedCount: 2 });
    });

    test("offers an alert in a custom state before Acknowledged", () => {
      const triaged: AlertStateForAcknowledgement = {
        id: "state-triaged",
        order: 2,
      };
      const acknowledged: AlertStateForAcknowledgement = {
        id: "state-acknowledged",
        order: 3,
        isAcknowledgedState: true,
      };

      expect(
        get(
          [alertIn("a1", triaged.id), alertIn("a2", CREATED.id)],
          [CREATED, triaged, acknowledged, { ...RESOLVED, order: 4 }],
        ),
      ).toEqual({ alertIds: ["a1", "a2"], alreadyAcknowledgedCount: 0 });
    });

    test("compares by order, not by where the state sits in the list", () => {
      // Listed newest-first: the list position must not decide anything.
      const reversed: Array<AlertStateForAcknowledgement> = [
        RESOLVED,
        ACKNOWLEDGED,
        CREATED,
      ];

      expect(
        get(
          [
            alertIn("a1", RESOLVED.id),
            alertIn("a2", CREATED.id),
            alertIn("a3", ACKNOWLEDGED.id),
          ],
          reversed,
        ),
      ).toEqual({ alertIds: ["a2"], alreadyAcknowledgedCount: 2 });
    });

    test("an Acknowledged order of 0 is still an order", () => {
      const acknowledgedAtZero: AlertStateForAcknowledgement = {
        id: "state-acknowledged",
        order: 0,
        isAcknowledgedState: true,
      };
      const before: AlertStateForAcknowledgement = {
        id: "state-before",
        order: -1,
      };

      expect(
        get(
          [
            alertIn("a1", acknowledgedAtZero.id),
            alertIn("a2", before.id),
            alertIn("a3", RESOLVED.id),
          ],
          [before, acknowledgedAtZero, RESOLVED],
        ),
      ).toEqual({ alertIds: ["a2"], alreadyAcknowledgedCount: 2 });
    });
  });

  describe("alerts whose state cannot be placed", () => {
    test("offers an alert whose current state is not one of the project's states", () => {
      expect(get([alertIn("a1", "state-from-another-project")])).toEqual({
        alertIds: ["a1"],
        alreadyAcknowledgedCount: 0,
      });
    });

    test("offers an alert with no current state id", () => {
      expect(get([alertIn("a1", undefined), alertIn("a2", "")])).toEqual({
        alertIds: ["a1", "a2"],
        alreadyAcknowledgedCount: 0,
      });
    });

    test("offers an alert whose current state has no order", () => {
      const unordered: AlertStateForAcknowledgement = {
        id: "state-unordered",
      };

      expect(
        get(
          [alertIn("a1", unordered.id)],
          [CREATED, ACKNOWLEDGED, RESOLVED, unordered],
        ),
      ).toEqual({ alertIds: ["a1"], alreadyAcknowledgedCount: 0 });
    });
  });

  test("matches state ids case-insensitively and ignoring surrounding spaces", () => {
    const upperAcknowledged: AlertStateForAcknowledgement = {
      id: "AAAAAAAA-AAAA-4AAA-8AAA-000000000002",
      order: 2,
      isAcknowledgedState: true,
    };
    const upperCreated: AlertStateForAcknowledgement = {
      id: "AAAAAAAA-AAAA-4AAA-8AAA-000000000001",
      order: 1,
    };

    expect(
      get(
        [
          alertIn("a1", " aaaaaaaa-aaaa-4aaa-8aaa-000000000002 "),
          alertIn("a2", "aaaaaaaa-aaaa-4aaa-8aaa-000000000001"),
        ],
        [upperCreated, upperAcknowledged],
      ),
    ).toEqual({ alertIds: ["a2"], alreadyAcknowledgedCount: 1 });
  });

  test("keeps the alerts in the order they were given and counts the rest", () => {
    const result: AlertsToAcknowledge | null = get([
      alertIn("a5", CREATED.id),
      alertIn("a1", ACKNOWLEDGED.id),
      alertIn("a4", undefined),
      alertIn("a2", RESOLVED.id),
      alertIn("a3", CREATED.id),
      alertIn("a6", RESOLVED.id),
    ]);

    expect(result).toEqual({
      alertIds: ["a5", "a4", "a3"],
      alreadyAcknowledgedCount: 3,
    });
  });

  test("returns the alert ids exactly as given", () => {
    expect(get([alertIn("ALERT-One", CREATED.id)])!.alertIds).toEqual([
      "ALERT-One",
    ]);
  });

  test("is empty, not null, when there are no alerts", () => {
    expect(get([])).toEqual({ alertIds: [], alreadyAcknowledgedCount: 0 });
  });

  test("does not change its input", () => {
    const alerts: Array<AlertForAcknowledgement> = [
      alertIn("a1", CREATED.id),
      alertIn("a2", ACKNOWLEDGED.id),
    ];
    const alertStates: Array<AlertStateForAcknowledgement> = [
      RESOLVED,
      CREATED,
      ACKNOWLEDGED,
    ];

    get(alerts, alertStates);

    expect(alerts).toEqual([
      { id: "a1", currentAlertStateId: CREATED.id },
      { id: "a2", currentAlertStateId: ACKNOWLEDGED.id },
    ]);
    expect(alertStates).toEqual([RESOLVED, CREATED, ACKNOWLEDGED]);
  });
});

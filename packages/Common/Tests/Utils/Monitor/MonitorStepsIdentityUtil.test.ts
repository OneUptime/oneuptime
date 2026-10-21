import MonitorStepsIdentityUtil, {
  MonitorStepsIdentitySlot,
} from "../../../Utils/Monitor/MonitorStepsIdentityUtil";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * The server owns the ids inside monitorSteps. These tests pin the contract
 * the Terraform provider relies on: it sends steps, criteria and templates
 * with no ids at all, on create and on every update, and expects the ids the
 * server gave on create to survive every later `terraform apply`.
 */

const OPERATIONAL_STATUS_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OFFLINE_STATUS_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SEVERITY_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

interface CriteriaSpec {
  id?: string;
  name: string;
  incidents?: Array<{ id?: string; title: string }>;
  alerts?: Array<{ id?: string; title: string }>;
}

interface StepSpec {
  id?: string;
  url?: string;
  criteria: Array<CriteriaSpec>;
}

// The shape MonitorStepsToAPI (the provider) puts on the wire: no ids anywhere.
function monitorStepsJSON(data: {
  steps: Array<StepSpec>;
  defaultMonitorStatusId?: string;
}): JSONObject {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: data.steps.map((step: StepSpec) => {
        return {
          _type: "MonitorStep",
          value: {
            ...(step.id ? { id: step.id } : {}),
            monitorDestination: {
              _type: "URL",
              value: step.url || "https://example.com",
            },
            requestType: "GET",
            monitorCriteria: {
              _type: "MonitorCriteria",
              value: {
                monitorCriteriaInstanceArray: step.criteria.map(
                  (criteria: CriteriaSpec) => {
                    return {
                      _type: "MonitorCriteriaInstance",
                      value: {
                        ...(criteria.id ? { id: criteria.id } : {}),
                        name: criteria.name,
                        description: `${criteria.name} description`,
                        filterCondition: "Any",
                        filters: [
                          { checkOn: "Is Online", filterType: "False" },
                        ],
                        changeMonitorStatus: true,
                        monitorStatusId: OFFLINE_STATUS_ID,
                        createIncidents: Boolean(criteria.incidents?.length),
                        incidents: (criteria.incidents || []).map(
                          (incident: { id?: string; title: string }) => {
                            return {
                              ...(incident.id ? { id: incident.id } : {}),
                              title: incident.title,
                              description: `${incident.title} description`,
                              incidentSeverityId: SEVERITY_ID,
                              autoResolveIncident: true,
                            };
                          },
                        ),
                        createAlerts: Boolean(criteria.alerts?.length),
                        alerts: (criteria.alerts || []).map(
                          (alert: { id?: string; title: string }) => {
                            return {
                              ...(alert.id ? { id: alert.id } : {}),
                              title: alert.title,
                              description: `${alert.title} description`,
                              autoResolveAlert: true,
                            };
                          },
                        ),
                      },
                    };
                  },
                ),
              },
            },
          },
        };
      }),
      ...(data.defaultMonitorStatusId
        ? { defaultMonitorStatusId: data.defaultMonitorStatusId }
        : {}),
    },
  };
}

// What the API layer hands the service: the wire JSON, parsed.
function parse(json: JSONObject): MonitorSteps {
  return MonitorSteps.fromJSON(json);
}

// What the database hands back on the next request: a fresh parse of the saved JSON.
function saveAndReload(monitorSteps: MonitorSteps): MonitorSteps {
  return MonitorSteps.fromJSON(
    JSON.parse(JSON.stringify(monitorSteps.toJSON())) as JSONObject,
  );
}

function steps(monitorSteps: MonitorSteps): Array<MonitorStep> {
  return monitorSteps.data!.monitorStepsInstanceArray;
}

function criteriaOf(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
}

interface IdTree {
  stepIds: Array<string>;
  criteriaIds: Array<Array<string>>;
  incidentIds: Array<Array<Array<string>>>;
  alertIds: Array<Array<Array<string>>>;
}

function ids(monitorSteps: MonitorSteps): IdTree {
  return {
    stepIds: steps(monitorSteps).map((step: MonitorStep) => {
      return step.data!.id;
    }),
    criteriaIds: steps(monitorSteps).map((step: MonitorStep) => {
      return criteriaOf(step).map((criteria: MonitorCriteriaInstance) => {
        return criteria.data!.id;
      });
    }),
    incidentIds: steps(monitorSteps).map((step: MonitorStep) => {
      return criteriaOf(step).map((criteria: MonitorCriteriaInstance) => {
        return criteria.data!.incidents.map((incident: CriteriaIncident) => {
          return incident.id;
        });
      });
    }),
    alertIds: steps(monitorSteps).map((step: MonitorStep) => {
      return criteriaOf(step).map((criteria: MonitorCriteriaInstance) => {
        return criteria.data!.alerts.map((alert: CriteriaAlert) => {
          return alert.id;
        });
      });
    }),
  };
}

function allIds(tree: IdTree): Array<string> {
  return [
    ...tree.stepIds,
    ...tree.criteriaIds.flat(),
    ...tree.incidentIds.flat(2),
    ...tree.alertIds.flat(2),
  ];
}

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The customer's monitor: offline (incident + auto-resolve), slow (alert), online.
const CUSTOMER_STEPS: Array<StepSpec> = [
  {
    criteria: [
      {
        name: "Check if NPR is offline",
        incidents: [{ title: "NPR is offline" }],
      },
      { name: "Check if NPR is slow", alerts: [{ title: "NPR is slow" }] },
      { name: "Check if NPR is online" },
    ],
  },
];

function createLikeTheServer(json: JSONObject): MonitorSteps {
  return MonitorStepsIdentityUtil.assignIds({
    monitorSteps: parse(json),
    defaultMonitorStatusId: new ObjectID(OPERATIONAL_STATUS_ID),
  });
}

function updateLikeTheServer(
  json: JSONObject,
  stored: MonitorSteps,
): MonitorSteps {
  return MonitorStepsIdentityUtil.assignIds({
    monitorSteps: parse(json),
    storedMonitorSteps: saveAndReload(stored),
    defaultMonitorStatusId: new ObjectID(OPERATIONAL_STATUS_ID),
  });
}

describe("MonitorCriteriaInstance.isIdGeneratedOnParse", () => {
  it("marks a criteria that was parsed without an id", () => {
    const parsed: MonitorSteps = parse(
      monitorStepsJSON({ steps: [{ criteria: [{ name: "Offline" }] }] }),
    );
    const criteria: MonitorCriteriaInstance = criteriaOf(steps(parsed)[0]!)[0]!;

    // fromJSON still hands out an id, so nothing that reads one breaks.
    expect(criteria.data!.id).toMatch(UUID_PATTERN);
    expect(MonitorCriteriaInstance.isIdGeneratedOnParse(criteria)).toBe(true);
  });

  it("does not mark a criteria whose id was sent", () => {
    const parsed: MonitorSteps = parse(
      monitorStepsJSON({
        steps: [{ criteria: [{ id: "criteria-sent", name: "Offline" }] }],
      }),
    );
    const criteria: MonitorCriteriaInstance = criteriaOf(steps(parsed)[0]!)[0]!;

    expect(criteria.data!.id).toBe("criteria-sent");
    expect(MonitorCriteriaInstance.isIdGeneratedOnParse(criteria)).toBe(false);
  });

  it("does not mark a criteria made in code", () => {
    expect(
      MonitorCriteriaInstance.isIdGeneratedOnParse(
        new MonitorCriteriaInstance(),
      ),
    ).toBe(false);
  });

  it("does not carry the mark into a copy that went through JSON", () => {
    const parsed: MonitorSteps = parse(
      monitorStepsJSON({ steps: [{ criteria: [{ name: "Offline" }] }] }),
    );
    const copy: MonitorSteps = saveAndReload(parsed);
    const criteria: MonitorCriteriaInstance = criteriaOf(steps(copy)[0]!)[0]!;

    expect(MonitorCriteriaInstance.isIdGeneratedOnParse(criteria)).toBe(false);
  });
});

describe("MonitorStepsIdentityUtil.resolveIds", () => {
  const slot: (
    id: string | undefined,
    name?: string,
    owned?: boolean,
  ) => MonitorStepsIdentitySlot = (
    id: string | undefined,
    name?: string,
    owned?: boolean,
  ): MonitorStepsIdentitySlot => {
    return {
      id,
      name,
      isIdOwnedByCaller: owned === undefined ? Boolean(id) : owned,
    };
  };

  it("keeps the ids a caller sends", () => {
    expect(
      MonitorStepsIdentityUtil.resolveIds({
        incoming: [slot("a", "A"), slot("b", "B")],
        stored: [
          { id: "x", name: "A" },
          { id: "y", name: "B" },
        ],
      }),
    ).toEqual(["a", "b"]);
  });

  it("hands an item without an id the stored id of the same name", () => {
    expect(
      MonitorStepsIdentityUtil.resolveIds({
        incoming: [slot(undefined, "B"), slot(undefined, "A")],
        stored: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
      }),
    ).toEqual(["b", "a"]);
  });

  it("treats an id made up while parsing like no id at all", () => {
    expect(
      MonitorStepsIdentityUtil.resolveIds({
        incoming: [slot("random-1", "A", false), slot("random-2", "B", false)],
        stored: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
      }),
    ).toEqual(["a", "b"]);
  });

  it("falls back to the stored id at the same position when no name matches", () => {
    expect(
      MonitorStepsIdentityUtil.resolveIds({
        incoming: [slot(undefined, "Renamed"), slot(undefined, "B")],
        stored: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
      }),
    ).toEqual(["a", "b"]);
  });

  it("matches names that are trimmed versions of each other", () => {
    expect(
      MonitorStepsIdentityUtil.resolveIds({
        incoming: [slot(undefined, "  B "), slot(undefined, "A")],
        stored: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
      }),
    ).toEqual(["b", "a"]);
  });

  it("uses position, not name, when a name is not unique", () => {
    expect(
      MonitorStepsIdentityUtil.resolveIds({
        incoming: [slot(undefined, "Same"), slot(undefined, "Same")],
        stored: [
          { id: "a", name: "Same" },
          { id: "b", name: "Same" },
        ],
      }),
    ).toEqual(["a", "b"]);
  });

  it("never takes a stored id that another item kept", () => {
    const result: Array<string> = MonitorStepsIdentityUtil.resolveIds({
      incoming: [slot(undefined, "New"), slot("a", "A")],
      stored: [{ id: "a", name: "A" }],
    });

    expect(result[1]).toBe("a");
    expect(result[0]).not.toBe("a");
    expect(result[0]).toMatch(UUID_PATTERN);
  });

  it("gives an item a new id when nothing is left to take", () => {
    const result: Array<string> = MonitorStepsIdentityUtil.resolveIds({
      incoming: [slot(undefined, "A"), slot(undefined, "Added")],
      stored: [{ id: "a", name: "A" }],
    });

    expect(result[0]).toBe("a");
    expect(result[1]).toMatch(UUID_PATTERN);
  });

  it("keeps an id made up while parsing when nothing is stored", () => {
    expect(
      MonitorStepsIdentityUtil.resolveIds({
        incoming: [slot("random-1", "A", false)],
        stored: [],
      }),
    ).toEqual(["random-1"]);
  });

  it("gives the second of two items sent with the same id a new one", () => {
    const result: Array<string> = MonitorStepsIdentityUtil.resolveIds({
      incoming: [slot("dup", "A"), slot("dup", "B")],
      stored: [],
    });

    expect(result[0]).toBe("dup");
    expect(result[1]).not.toBe("dup");
    expect(result[1]).toMatch(UUID_PATTERN);
  });

  it("returns ids that are unique within the list", () => {
    const result: Array<string> = MonitorStepsIdentityUtil.resolveIds({
      incoming: [
        slot(undefined),
        slot(undefined),
        slot("a"),
        slot(undefined, "X"),
      ],
      stored: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });

    expect(new Set(result).size).toBe(result.length);
  });
});

describe("MonitorStepsIdentityUtil.assignIds", () => {
  it("gives every step, criteria and template an id on create", () => {
    const created: MonitorSteps = createLikeTheServer(
      monitorStepsJSON({ steps: CUSTOMER_STEPS }),
    );
    const tree: IdTree = ids(created);

    expect(tree.stepIds).toHaveLength(1);
    expect(tree.criteriaIds[0]).toHaveLength(3);
    expect(tree.incidentIds[0]![0]).toHaveLength(1);
    expect(tree.alertIds[0]![1]).toHaveLength(1);

    for (const id of allIds(tree)) {
      expect(id).toMatch(UUID_PATTERN);
    }

    expect(new Set(allIds(tree)).size).toBe(allIds(tree).length);
  });

  it("files results under a real step id - the monitor page's 'No check has completed yet'", () => {
    const created: MonitorSteps = createLikeTheServer(
      monitorStepsJSON({ steps: CUSTOMER_STEPS }),
    );

    // A probe reports its result under step.id; it used to be "".
    expect(steps(created)[0]!.id.toString()).toMatch(UUID_PATTERN);
  });

  it("keeps every id when a terraform apply resends the same steps", () => {
    const created: MonitorSteps = createLikeTheServer(
      monitorStepsJSON({ steps: CUSTOMER_STEPS }),
    );
    const updated: MonitorSteps = updateLikeTheServer(
      monitorStepsJSON({ steps: CUSTOMER_STEPS }),
      created,
    );

    expect(ids(updated)).toEqual(ids(created));
  });

  it("keeps the ids through many applies in a row", () => {
    let current: MonitorSteps = createLikeTheServer(
      monitorStepsJSON({ steps: CUSTOMER_STEPS }),
    );
    const first: IdTree = ids(current);

    for (let apply: number = 0; apply < 5; apply++) {
      current = updateLikeTheServer(
        monitorStepsJSON({ steps: CUSTOMER_STEPS }),
        current,
      );
    }

    expect(ids(current)).toEqual(first);
  });

  it("keeps a criteria's id when it moves to another position", () => {
    const created: MonitorSteps = createLikeTheServer(
      monitorStepsJSON({ steps: CUSTOMER_STEPS }),
    );
    const createdCriteriaIds: Array<string> = ids(created).criteriaIds[0]!;

    const reordered: Array<StepSpec> = [
      {
        criteria: [
          CUSTOMER_STEPS[0]!.criteria[2]!,
          CUSTOMER_STEPS[0]!.criteria[0]!,
          CUSTOMER_STEPS[0]!.criteria[1]!,
        ],
      },
    ];
    const updated: MonitorSteps = updateLikeTheServer(
      monitorStepsJSON({ steps: reordered }),
      created,
    );

    expect(ids(updated).criteriaIds[0]).toEqual([
      createdCriteriaIds[2],
      createdCriteriaIds[0],
      createdCriteriaIds[1],
    ]);
  });

  it("keeps a criteria's id when only its name changes", () => {
    const created: MonitorSteps = createLikeTheServer(
      monitorStepsJSON({ steps: CUSTOMER_STEPS }),
    );

    const renamed: Array<StepSpec> = [
      {
        criteria: [
          { ...CUSTOMER_STEPS[0]!.criteria[0]!, name: "NPR is down" },
          CUSTOMER_STEPS[0]!.criteria[1]!,
          CUSTOMER_STEPS[0]!.criteria[2]!,
        ],
      },
    ];
    const updated: MonitorSteps = updateLikeTheServer(
      monitorStepsJSON({ steps: renamed }),
      created,
    );

    expect(ids(updated).criteriaIds).toEqual(ids(created).criteriaIds);
    expect(ids(updated).incidentIds).toEqual(ids(created).incidentIds);
  });

  it("keeps the remaining ids when a criteria is removed", () => {
    const created: MonitorSteps = createLikeTheServer(
      monitorStepsJSON({ steps: CUSTOMER_STEPS }),
    );
    const createdCriteriaIds: Array<string> = ids(created).criteriaIds[0]!;

    const withoutSlow: Array<StepSpec> = [
      {
        criteria: [
          CUSTOMER_STEPS[0]!.criteria[0]!,
          CUSTOMER_STEPS[0]!.criteria[2]!,
        ],
      },
    ];
    const updated: MonitorSteps = updateLikeTheServer(
      monitorStepsJSON({ steps: withoutSlow }),
      created,
    );

    expect(ids(updated).criteriaIds[0]).toEqual([
      createdCriteriaIds[0],
      createdCriteriaIds[2],
    ]);
  });

  it("gives an added criteria a new id and keeps the others", () => {
    const created: MonitorSteps = createLikeTheServer(
      monitorStepsJSON({ steps: CUSTOMER_STEPS }),
    );
    const createdCriteriaIds: Array<string> = ids(created).criteriaIds[0]!;

    const withAdded: Array<StepSpec> = [
      {
        criteria: [
          { name: "Check if NPR is degraded" },
          ...CUSTOMER_STEPS[0]!.criteria,
        ],
      },
    ];
    const updated: MonitorSteps = updateLikeTheServer(
      monitorStepsJSON({ steps: withAdded }),
      created,
    );
    const updatedCriteriaIds: Array<string> = ids(updated).criteriaIds[0]!;

    expect(updatedCriteriaIds.slice(1)).toEqual(createdCriteriaIds);
    expect(createdCriteriaIds).not.toContain(updatedCriteriaIds[0]);
    expect(updatedCriteriaIds[0]).toMatch(UUID_PATTERN);
  });

  it("keeps template ids by title, and gives an added template a new id", () => {
    const created: MonitorSteps = createLikeTheServer(
      monitorStepsJSON({
        steps: [
          {
            criteria: [
              {
                name: "Offline",
                incidents: [{ title: "Down" }, { title: "Paging" }],
              },
            ],
          },
        ],
      }),
    );
    const [downId, pagingId] = ids(created).incidentIds[0]![0]!;

    const updated: MonitorSteps = updateLikeTheServer(
      monitorStepsJSON({
        steps: [
          {
            criteria: [
              {
                name: "Offline",
                incidents: [
                  { title: "Paging" },
                  { title: "Down" },
                  { title: "Escalate" },
                ],
              },
            ],
          },
        ],
      }),
      created,
    );
    const updatedIncidentIds: Array<string> = ids(updated).incidentIds[0]![0]!;

    expect(updatedIncidentIds[0]).toBe(pagingId);
    expect(updatedIncidentIds[1]).toBe(downId);
    expect([downId, pagingId]).not.toContain(updatedIncidentIds[2]);
    expect(updatedIncidentIds[2]).toMatch(UUID_PATTERN);
  });

  it("keeps step ids by position across several steps", () => {
    const twoSteps: Array<StepSpec> = [
      { url: "https://a.example.com", criteria: [{ name: "A" }] },
      { url: "https://b.example.com", criteria: [{ name: "B" }] },
    ];
    const created: MonitorSteps = createLikeTheServer(
      monitorStepsJSON({ steps: twoSteps }),
    );
    const updated: MonitorSteps = updateLikeTheServer(
      monitorStepsJSON({ steps: twoSteps }),
      created,
    );

    expect(ids(updated)).toEqual(ids(created));
    expect(ids(created).stepIds[0]).not.toBe(ids(created).stepIds[1]);
  });

  it("leaves the ids of a caller that sends its own - the dashboard - alone", () => {
    const dashboardSteps: Array<StepSpec> = [
      {
        id: "step-1",
        criteria: [
          {
            id: "criteria-1",
            name: "Offline",
            incidents: [{ id: "incident-1", title: "Down" }],
          },
        ],
      },
    ];
    const stored: MonitorSteps = createLikeTheServer(
      monitorStepsJSON({ steps: dashboardSteps }),
    );

    expect(ids(stored)).toEqual({
      stepIds: ["step-1"],
      criteriaIds: [["criteria-1"]],
      incidentIds: [[["incident-1"]]],
      alertIds: [[[]]],
    });

    // The dashboard adds a criteria with an id it made itself.
    const withNew: Array<StepSpec> = [
      {
        id: "step-1",
        criteria: [
          ...dashboardSteps[0]!.criteria,
          { id: "criteria-2", name: "Slow" },
        ],
      },
    ];
    const updated: MonitorSteps = updateLikeTheServer(
      monitorStepsJSON({ steps: withNew }),
      stored,
    );

    expect(ids(updated).criteriaIds).toEqual([["criteria-1", "criteria-2"]]);
  });

  it("does not hand a deleted criteria's id to one the dashboard added with its own id", () => {
    const stored: MonitorSteps = createLikeTheServer(
      monitorStepsJSON({
        steps: [
          { id: "step-1", criteria: [{ id: "criteria-1", name: "Old" }] },
        ],
      }),
    );
    const updated: MonitorSteps = updateLikeTheServer(
      monitorStepsJSON({
        steps: [
          { id: "step-1", criteria: [{ id: "criteria-2", name: "New" }] },
        ],
      }),
      stored,
    );

    expect(ids(updated).criteriaIds).toEqual([["criteria-2"]]);
  });

  it("fills in the default monitor status when the steps have none", () => {
    const created: MonitorSteps = createLikeTheServer(
      monitorStepsJSON({ steps: CUSTOMER_STEPS }),
    );

    expect(created.data!.defaultMonitorStatusId?.toString()).toBe(
      OPERATIONAL_STATUS_ID,
    );
  });

  it("keeps a default monitor status the caller sent", () => {
    const created: MonitorSteps = createLikeTheServer(
      monitorStepsJSON({
        steps: CUSTOMER_STEPS,
        defaultMonitorStatusId: OFFLINE_STATUS_ID,
      }),
    );

    expect(created.data!.defaultMonitorStatusId?.toString()).toBe(
      OFFLINE_STATUS_ID,
    );
  });

  it("keeps the stored default monitor status when an update sends none", () => {
    const stored: MonitorSteps = createLikeTheServer(
      monitorStepsJSON({
        steps: CUSTOMER_STEPS,
        defaultMonitorStatusId: OFFLINE_STATUS_ID,
      }),
    );
    const updated: MonitorSteps = updateLikeTheServer(
      monitorStepsJSON({ steps: CUSTOMER_STEPS }),
      stored,
    );

    expect(updated.data!.defaultMonitorStatusId?.toString()).toBe(
      OFFLINE_STATUS_ID,
    );
  });

  it("leaves the default monitor status unset when there is nothing to take it from", () => {
    const assigned: MonitorSteps = MonitorStepsIdentityUtil.assignIds({
      monitorSteps: parse(monitorStepsJSON({ steps: CUSTOMER_STEPS })),
    });

    expect(assigned.data!.defaultMonitorStatusId).toBeUndefined();
  });

  it("changes nothing but ids and the default status", () => {
    const json: JSONObject = monitorStepsJSON({ steps: CUSTOMER_STEPS });
    const before: JSONObject = parse(json).toJSON();
    const after: JSONObject = createLikeTheServer(json).toJSON();

    const withoutIds: (value: unknown) => unknown = (
      value: unknown,
    ): unknown => {
      return JSON.parse(
        JSON.stringify(value, (key: string, item: unknown) => {
          return key === "id" || key === "defaultMonitorStatusId"
            ? undefined
            : item;
        }),
      );
    };

    expect(withoutIds(after)).toEqual(withoutIds(before));
  });

  it("returns the same MonitorSteps it was given", () => {
    const monitorSteps: MonitorSteps = parse(
      monitorStepsJSON({ steps: CUSTOMER_STEPS }),
    );

    expect(MonitorStepsIdentityUtil.assignIds({ monitorSteps })).toBe(
      monitorSteps,
    );
  });

  it("copes with steps that carry no criteria or templates", () => {
    const monitorSteps: MonitorSteps = new MonitorSteps();
    steps(monitorSteps)[0]!.data!.id = "";

    MonitorStepsIdentityUtil.assignIds({ monitorSteps });

    expect(steps(monitorSteps)[0]!.data!.id).toMatch(UUID_PATTERN);
  });
});

describe("MonitorStepsIdentityUtil.assignIdsInJSON", () => {
  it("fills in every missing id of stored steps", () => {
    const result: { monitorSteps: JSONObject; changed: boolean } =
      MonitorStepsIdentityUtil.assignIdsInJSON({
        monitorSteps: monitorStepsJSON({ steps: CUSTOMER_STEPS }),
      });

    expect(result.changed).toBe(true);

    const tree: IdTree = ids(MonitorSteps.fromJSON(result.monitorSteps));

    for (const id of allIds(tree)) {
      expect(id).toMatch(UUID_PATTERN);
    }
  });

  it("keeps the ids that are there and changes nothing else", () => {
    const json: JSONObject = monitorStepsJSON({
      steps: [
        {
          id: "step-1",
          criteria: [
            {
              id: "criteria-1",
              name: "Offline",
              incidents: [{ title: "Down" }],
            },
          ],
        },
      ],
    });

    const result: { monitorSteps: JSONObject; changed: boolean } =
      MonitorStepsIdentityUtil.assignIdsInJSON({ monitorSteps: json });

    const step: JSONObject = (
      (result.monitorSteps["value"] as JSONObject)[
        "monitorStepsInstanceArray"
      ] as Array<JSONObject>
    )[0]!["value"] as JSONObject;
    const criteria: JSONObject = (
      (step["monitorCriteria"] as JSONObject)["value"] as JSONObject
    )["monitorCriteriaInstanceArray"] as unknown as JSONObject;
    const firstCriteria: JSONObject = (
      criteria as unknown as Array<JSONObject>
    )[0]!["value"] as JSONObject;
    const incident: JSONObject = (
      firstCriteria["incidents"] as Array<JSONObject>
    )[0]!;

    expect(step["id"]).toBe("step-1");
    expect(firstCriteria["id"]).toBe("criteria-1");
    expect(incident["id"]).toMatch(UUID_PATTERN);

    // Only the missing template id was added.
    const strip: (value: unknown) => unknown = (value: unknown): unknown => {
      return JSON.parse(
        JSON.stringify(value, (key: string, item: unknown) => {
          return key === "id" ? undefined : item;
        }),
      );
    };
    expect(strip(result.monitorSteps)).toEqual(strip(json));
  });

  it("reports no change when nothing is missing", () => {
    const complete: JSONObject = MonitorStepsIdentityUtil.assignIdsInJSON({
      monitorSteps: monitorStepsJSON({ steps: CUSTOMER_STEPS }),
    }).monitorSteps;

    expect(
      MonitorStepsIdentityUtil.assignIdsInJSON({ monitorSteps: complete })
        .changed,
    ).toBe(false);
  });

  it("does not modify the object it is given", () => {
    const json: JSONObject = monitorStepsJSON({ steps: CUSTOMER_STEPS });
    const snapshot: string = JSON.stringify(json);

    MonitorStepsIdentityUtil.assignIdsInJSON({ monitorSteps: json });

    expect(JSON.stringify(json)).toBe(snapshot);
  });

  it("fills in the default monitor status only when asked to", () => {
    const complete: JSONObject = MonitorStepsIdentityUtil.assignIdsInJSON({
      monitorSteps: monitorStepsJSON({ steps: CUSTOMER_STEPS }),
    }).monitorSteps;

    expect(
      (complete["value"] as JSONObject)["defaultMonitorStatusId"],
    ).toBeUndefined();

    const withDefault: { monitorSteps: JSONObject; changed: boolean } =
      MonitorStepsIdentityUtil.assignIdsInJSON({
        monitorSteps: complete,
        defaultMonitorStatusId: OPERATIONAL_STATUS_ID,
      });

    expect(withDefault.changed).toBe(true);
    expect(
      (withDefault.monitorSteps["value"] as JSONObject)[
        "defaultMonitorStatusId"
      ],
    ).toBe(OPERATIONAL_STATUS_ID);
  });

  it("leaves malformed steps alone", () => {
    for (const malformed of [
      {},
      { _type: "MonitorSteps" },
      { _type: "MonitorSteps", value: { monitorStepsInstanceArray: "x" } },
      {
        _type: "MonitorSteps",
        value: { monitorStepsInstanceArray: [null, 1, { value: null }] },
      },
    ] as Array<JSONObject>) {
      expect(
        MonitorStepsIdentityUtil.assignIdsInJSON({ monitorSteps: malformed })
          .changed,
      ).toBe(false);
    }
  });
});

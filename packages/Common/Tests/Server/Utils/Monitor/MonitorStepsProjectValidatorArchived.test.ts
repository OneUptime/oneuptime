import MonitorStepsProjectValidator from "../../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import IncidentRoleService from "../../../../Server/Services/IncidentRoleService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../../Server/Services/LabelService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import IncidentRole from "../../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../Models/DatabaseModels/Label";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import { ArchivedValuePickedException } from "../../../../Server/Utils/Database/ArchivedValueCheck";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject, ObjectType } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A monitor's criteria name values too: the status a monitor starts in and
 * changes to, the severities and labels of the incidents and alerts it
 * opens, the roles it assigns. A person's or an API key's save may not
 * introduce an archived one the monitor would use - the save is refused,
 * naming it and where to unarchive it. What the monitor already holds is
 * not introduced, so it keeps an archived value through every later edit and
 * keeps opening incidents with it; a value the monitor does not use (a
 * status kept while "change status" is off) is left alone; OneUptime's own
 * writes and a workflow's keep what they were set up with.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);

const STATUS_LIVE: string = "59b5ab80-63f6-4ffd-b3df-31c6ad127695";
const STATUS_ARCHIVED: string = "59b5ab80-63f6-4ffd-b3df-31c6ad127696";
const SEVERITY_ARCHIVED: string = "1de3b8f4-0f2d-4a6f-9a2e-7cf3a1b2c3d4";
const ALERT_SEVERITY_ARCHIVED: string = "1de3b8f4-0f2d-4a6f-9a2e-7cf3a1b2c3d5";
const LABEL_ARCHIVED: string = "5127fc38-4d61-4ea3-9e62-b037e5f60718";
const ROLE_ARCHIVED: string = "845af26b-7094-4bd6-8195-e36a08293a4b";

const STEP_ID: string = "4b752ccd-92e8-4295-9d33-b670e1721fbb";
const CRITERIA_ID: string = "5c863dde-a3f9-43a6-8e44-c781f2832acc";
const INCIDENT_TEMPLATE_ID: string = "6d974eef-b40a-44b7-9f55-d892031943dd";
const ALERT_TEMPLATE_ID: string = "6d974eef-b40a-44b7-9f55-d892031943de";

const PERSON: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("956b037c-81a5-4ce7-92a6-f47b193a4b5c"),
  userType: UserType.User,
};

const API_KEY: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userType: UserType.API,
};

const WORKFLOW: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userType: UserType.Workflow,
};

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

const objectIdJSON: (id: string) => JSONObject = (id: string): JSONObject => {
  return { _type: ObjectType.ObjectID, value: id };
};

const valueOf: <T extends DatabaseBaseModel>(
  modelType: { new (): T },
  id: string,
  name: string,
) => T = <T extends DatabaseBaseModel>(
  modelType: { new (): T },
  id: string,
  name: string,
): T => {
  const value: T = new modelType();
  value._id = id;
  (value as unknown as Record<string, unknown>)["name"] = name;
  (value as unknown as Record<string, unknown>)["projectId"] = PROJECT_ID;
  return value;
};

// Every value named exists in the project; these are archived.
const ARCHIVED_IDS: Array<string> = [
  STATUS_ARCHIVED,
  SEVERITY_ARCHIVED,
  ALERT_SEVERITY_ARCHIVED,
  LABEL_ARCHIVED,
  ROLE_ARCHIVED,
];

const archivedReads: Array<{ query: Record<string, unknown> }> = [];

// The ids an `_id: QueryHelper.any([...])` condition names.
const idsIn: (condition: unknown) => Array<string> = (
  condition: unknown,
): Array<string> => {
  if (condition instanceof FindOperator) {
    const parameters: Record<string, unknown> =
      (condition.objectLiteralParameters as Record<string, unknown>) || {};
    const values: Array<unknown> = Object.values(parameters).flat();
    return values.map(String);
  }

  if (Array.isArray(condition)) {
    return condition.map(String);
  }

  return condition ? [String(condition)] : [];
};

const stubValues: (values: {
  statuses?: Array<MonitorStatus>;
  severities?: Array<IncidentSeverity>;
  alertSeverities?: Array<AlertSeverity>;
  labels?: Array<Label>;
  roles?: Array<IncidentRole>;
}) => void = (values: {
  statuses?: Array<MonitorStatus>;
  severities?: Array<IncidentSeverity>;
  alertSeverities?: Array<AlertSeverity>;
  labels?: Array<Label>;
  roles?: Array<IncidentRole>;
}): void => {
  archivedReads.length = 0;

  const answer: (rows: Array<DatabaseBaseModel>) => unknown = (
    rows: Array<DatabaseBaseModel>,
  ): unknown => {
    return async (args: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    }): Promise<Array<DatabaseBaseModel>> => {
      if (args.query["isArchived"] === true) {
        archivedReads.push({ query: args.query });
        expect(args.props["isRoot"]).toBe(true);

        const ids: Array<string> = idsIn(args.query["_id"]);

        return rows.filter((row: DatabaseBaseModel) => {
          const id: string = row._id!.toString();
          return ARCHIVED_IDS.includes(id) && ids.includes(id);
        });
      }

      // The existence check: every value named is the project's.
      return rows;
    };
  };

  jest
    .spyOn(MonitorStatusService, "findBy")
    .mockImplementation(answer(values.statuses || []) as never);
  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockImplementation(answer(values.severities || []) as never);
  jest
    .spyOn(AlertSeverityService, "findBy")
    .mockImplementation(answer(values.alertSeverities || []) as never);
  jest
    .spyOn(LabelService, "findBy")
    .mockImplementation(answer(values.labels || []) as never);
  jest
    .spyOn(IncidentRoleService, "findBy")
    .mockImplementation(answer(values.roles || []) as never);
};

const ALL_VALUES: () => void = (): void => {
  stubValues({
    statuses: [
      valueOf(MonitorStatus, STATUS_LIVE, "Operational"),
      valueOf(MonitorStatus, STATUS_ARCHIVED, "Degraded (old)"),
    ],
    severities: [
      valueOf(IncidentSeverity, SEVERITY_ARCHIVED, "[DONOTUSE] Very critical"),
    ],
    alertSeverities: [valueOf(AlertSeverity, ALERT_SEVERITY_ARCHIVED, "Sev 5")],
    labels: [valueOf(Label, LABEL_ARCHIVED, "legacy-db")],
    roles: [valueOf(IncidentRole, ROLE_ARCHIVED, "Comms Lead")],
  });
};

const steps: (data: {
  defaultMonitorStatusId?: string;
  criteria?: JSONObject;
}) => JSONObject = (data: {
  defaultMonitorStatusId?: string;
  criteria?: JSONObject;
}): JSONObject => {
  return {
    _type: ObjectType.MonitorSteps,
    value: {
      defaultMonitorStatusId: data.defaultMonitorStatusId || STATUS_LIVE,
      monitorStepsInstanceArray: [
        {
          _type: ObjectType.MonitorStep,
          value: {
            id: STEP_ID,
            monitorCriteria: {
              _type: ObjectType.MonitorCriteria,
              value: {
                monitorCriteriaInstanceArray: data.criteria
                  ? [
                      {
                        _type: ObjectType.MonitorCriteriaInstance,
                        value: {
                          id: CRITERIA_ID,
                          name: "Monitor is offline",
                          description: "",
                          filterCondition: "all",
                          filters: [],
                          incidents: [],
                          alerts: [],
                          ...data.criteria,
                        },
                      },
                    ]
                  : [],
              },
            },
          },
        },
      ],
    },
  };
};

const opensIncident: (values: {
  severity?: string;
  labels?: Array<string>;
  role?: string;
}) => JSONObject = (values: {
  severity?: string;
  labels?: Array<string>;
  role?: string;
}): JSONObject => {
  return {
    createIncidents: true,
    incidents: [
      {
        id: INCIDENT_TEMPLATE_ID,
        title: "Down",
        description: "",
        incidentSeverityId: objectIdJSON(values.severity || SEVERITY_ARCHIVED),
        labelIds: (values.labels || []).map(objectIdJSON),
        incidentMemberRoles: values.role ? [{ roleId: values.role }] : [],
      },
    ],
  };
};

const refusalOf: (run: Promise<void>) => Promise<string | null> = async (
  run: Promise<void>,
): Promise<string | null> => {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(ArchivedValuePickedException);
    return (error as Error).message;
  }

  return null;
};

const save: (data: {
  monitorSteps: JSONObject;
  alreadyStoredMonitorSteps?: JSONObject | undefined;
  props?: DatabaseCommonInteractionProps | undefined;
}) => Promise<void> = (data: {
  monitorSteps: JSONObject;
  alreadyStoredMonitorSteps?: JSONObject | undefined;
  props?: DatabaseCommonInteractionProps | undefined;
}): Promise<void> => {
  return MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
    monitorSteps: data.monitorSteps,
    projectId: PROJECT_ID,
    alreadyStoredMonitorSteps: data.alreadyStoredMonitorSteps,
    props: data.props,
  });
};

describe("a person's save of a monitor's criteria", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses an archived status the monitor changes to", async () => {
    ALL_VALUES();

    expect(
      await refusalOf(
        save({
          monitorSteps: steps({
            criteria: {
              changeMonitorStatus: true,
              monitorStatusId: objectIdJSON(STATUS_ARCHIVED),
            },
          }),
          props: PERSON,
        }),
      ),
    ).toBe(
      '"Degraded (old)" is an archived monitor status and can\'t be picked. Choose another, or unarchive it in Monitors > Settings > Monitor Status.',
    );

    // Read as OneUptime, pinned to the project, archived ones only.
    expect(archivedReads).toHaveLength(1);
    expect(archivedReads[0]!.query["projectId"]).toBe(PROJECT_ID);
  });

  it("refuses an archived default status", async () => {
    ALL_VALUES();

    expect(
      await refusalOf(
        save({
          monitorSteps: steps({ defaultMonitorStatusId: STATUS_ARCHIVED }),
          props: API_KEY,
        }),
      ),
    ).toContain('"Degraded (old)" is an archived monitor status');
  });

  it("refuses the archived severity, labels and role of an incident it opens, a sentence per kind", async () => {
    ALL_VALUES();

    const refusal: string | null = await refusalOf(
      save({
        monitorSteps: steps({
          criteria: opensIncident({
            severity: SEVERITY_ARCHIVED,
            labels: [LABEL_ARCHIVED],
            role: ROLE_ARCHIVED,
          }),
        }),
        props: PERSON,
      }),
    );

    expect(refusal).toContain(
      '"[DONOTUSE] Very critical" is an archived incident severity and can\'t be picked.',
    );
    expect(refusal).toContain('"legacy-db" is an archived label');
    expect(refusal).toContain('"Comms Lead" is an archived incident role');
  });

  it("refuses an archived severity of an alert it opens", async () => {
    ALL_VALUES();

    expect(
      await refusalOf(
        save({
          monitorSteps: steps({
            criteria: {
              createAlerts: true,
              alerts: [
                {
                  id: ALERT_TEMPLATE_ID,
                  title: "Down",
                  description: "",
                  alertSeverityId: objectIdJSON(ALERT_SEVERITY_ARCHIVED),
                },
              ],
            },
          }),
          props: PERSON,
        }),
      ),
    ).toContain('"Sev 5" is an archived alert severity');
  });

  it("keeps an archived value the monitor already holds, through every later edit", async () => {
    ALL_VALUES();

    const stored: JSONObject = steps({ criteria: opensIncident({}) });

    expect(
      await refusalOf(
        save({
          monitorSteps: stored,
          alreadyStoredMonitorSteps: stored,
          props: PERSON,
        }),
      ),
    ).toBeNull();
    expect(archivedReads).toEqual([]);
  });

  it("leaves alone a value the monitor would not use", async () => {
    ALL_VALUES();

    expect(
      await refusalOf(
        save({
          monitorSteps: steps({
            criteria: {
              // Not changing the status: the status is not used.
              changeMonitorStatus: false,
              monitorStatusId: objectIdJSON(STATUS_ARCHIVED),
              // Not opening incidents: neither is the severity.
              createIncidents: false,
              incidents: [
                {
                  id: INCIDENT_TEMPLATE_ID,
                  title: "Down",
                  description: "",
                  incidentSeverityId: objectIdJSON(SEVERITY_ARCHIVED),
                },
              ],
            },
          }),
          props: PERSON,
        }),
      ),
    ).toBeNull();
  });

  it("saves live values", async () => {
    ALL_VALUES();

    expect(
      await refusalOf(
        save({
          monitorSteps: steps({
            criteria: {
              changeMonitorStatus: true,
              monitorStatusId: objectIdJSON(STATUS_LIVE),
            },
          }),
          props: PERSON,
        }),
      ),
    ).toBeNull();
  });
});

describe("whose saves are not held to it", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ["OneUptime (root)", ROOT],
    ["a workflow", WORKFLOW],
    ["a caller that names nobody", undefined],
  ])(
    "%s keeps the values it was set up with",
    async (_who: string, props: DatabaseCommonInteractionProps | undefined) => {
      ALL_VALUES();

      expect(
        await refusalOf(
          save({
            monitorSteps: steps({
              defaultMonitorStatusId: STATUS_ARCHIVED,
              criteria: opensIncident({ labels: [LABEL_ARCHIVED] }),
            }),
            props: props,
          }),
        ),
      ).toBeNull();
      expect(archivedReads).toEqual([]);
    },
  );
});

describe("refuseIntroducedArchivedValues", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads each kind of value once, for all of its ids", async () => {
    ALL_VALUES();

    await refusalOf(
      MonitorStepsProjectValidator.refuseIntroducedArchivedValues({
        projectId: PROJECT_ID,
        references: [
          {
            model: "Label" as never,
            id: LABEL_ARCHIVED,
            path: "label",
            isOperative: true,
          },
          {
            model: "Label" as never,
            id: LABEL_ARCHIVED.toUpperCase(),
            path: "label",
            isOperative: true,
          },
          {
            model: "Team" as never,
            id: "7349e15a-6f83-4ac5-9084-d259f718293a",
            path: "owner team",
            isOperative: true,
          },
          {
            model: "Label" as never,
            id: "not-an-id",
            path: "label",
            isOperative: true,
          },
        ],
      }),
    );

    expect(archivedReads).toHaveLength(1);
    expect(idsIn(archivedReads[0]!.query["_id"])).toEqual([LABEL_ARCHIVED]);
  });
});

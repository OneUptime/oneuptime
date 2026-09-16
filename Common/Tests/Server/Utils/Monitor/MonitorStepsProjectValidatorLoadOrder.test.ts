import { MonitorStepsReferenceModel } from "../../../../Server/Utils/Monitor/MonitorStepsReferenceExtractor";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentRole from "../../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../Models/DatabaseModels/Label";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import Service from "../../../../Models/DatabaseModels/Service";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import { JSONObject, ObjectType } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Regression test for a support report: a customer could not create an API
 * monitor, and every attempt answered 500 "Server Error".
 *
 * Their criteria named themselves as the incident's owner user and as an
 * incident member. MonitorStepsProjectValidator looked up the service for each
 * referenced model in a table built when the module loaded. The app's services
 * import each other in a cycle, and loading from the API server's entry point
 * reaches this module while UserService and NetworkDeviceService are still
 * loading. So the table held `undefined` for both, and the first User reference
 * threw
 *   TypeError: Cannot read properties of undefined (reading 'getModel')
 * inside ProjectScopedReferenceValidator. A TypeError is not an Exception, so
 * the API answered with a bare "Server Error".
 *
 * The existing MonitorStepsProjectValidator tests import the validator first,
 * before anything that closes the cycle, and never name a user, which is why
 * they did not catch it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0b3c3b56-7f3e-4d7c-9a0e-1f9b5a7c2d11",
);

const ID_BY_MODEL: Record<MonitorStepsReferenceModel, string> = {
  [MonitorStepsReferenceModel.MonitorStatus]:
    "11a4f1de-2b6c-4e0f-8d7a-3c5b9e1f2a01",
  [MonitorStepsReferenceModel.IncidentSeverity]:
    "22b5e2cf-3c7d-4f1a-9e8b-4d6c0f2a3b02",
  [MonitorStepsReferenceModel.AlertSeverity]:
    "33c6d3b0-4d8e-4a2b-8f9c-5e7d1a3b4c03",
  [MonitorStepsReferenceModel.OnCallDutyPolicy]:
    "44d7c4a1-5e9f-4b3c-9a0d-6f8e2b4c5d04",
  [MonitorStepsReferenceModel.Label]: "55e8b592-6fa0-4c4d-8b1e-7a9f3c5d6e05",
  [MonitorStepsReferenceModel.Team]: "66f9a683-70b1-4d5e-9c2f-8b0a4d6e7f06",
  [MonitorStepsReferenceModel.User]: "770a9774-81c2-4e6f-8d30-9c1b5e7f8007",
  [MonitorStepsReferenceModel.IncidentRole]:
    "881b8865-92d3-4f70-9e41-ad2c6f809108",
  [MonitorStepsReferenceModel.TelemetryService]:
    "992c7956-a3e4-4081-8f52-be3d7091a209",
  [MonitorStepsReferenceModel.NetworkDevice]:
    "aa3d6a47-b4f5-4192-9063-cf4e81a2b30a",
};

// Where each service lives, relative to this file.
const SERVICE_PATH_BY_MODEL: Record<MonitorStepsReferenceModel, string> = {
  [MonitorStepsReferenceModel.MonitorStatus]:
    "../../../../Server/Services/MonitorStatusService",
  [MonitorStepsReferenceModel.IncidentSeverity]:
    "../../../../Server/Services/IncidentSeverityService",
  [MonitorStepsReferenceModel.AlertSeverity]:
    "../../../../Server/Services/AlertSeverityService",
  [MonitorStepsReferenceModel.OnCallDutyPolicy]:
    "../../../../Server/Services/OnCallDutyPolicyService",
  [MonitorStepsReferenceModel.Label]:
    "../../../../Server/Services/LabelService",
  [MonitorStepsReferenceModel.Team]: "../../../../Server/Services/TeamService",
  [MonitorStepsReferenceModel.User]: "../../../../Server/Services/UserService",
  [MonitorStepsReferenceModel.IncidentRole]:
    "../../../../Server/Services/IncidentRoleService",
  [MonitorStepsReferenceModel.TelemetryService]:
    "../../../../Server/Services/ServiceService",
  [MonitorStepsReferenceModel.NetworkDevice]:
    "../../../../Server/Services/NetworkDeviceService",
};

const MODEL_TYPE_BY_MODEL: Record<
  MonitorStepsReferenceModel,
  { new (): DatabaseBaseModel }
> = {
  [MonitorStepsReferenceModel.MonitorStatus]: MonitorStatus,
  [MonitorStepsReferenceModel.IncidentSeverity]: IncidentSeverity,
  [MonitorStepsReferenceModel.AlertSeverity]: AlertSeverity,
  [MonitorStepsReferenceModel.OnCallDutyPolicy]: OnCallDutyPolicy,
  [MonitorStepsReferenceModel.Label]: Label,
  [MonitorStepsReferenceModel.Team]: Team,
  [MonitorStepsReferenceModel.User]: User,
  [MonitorStepsReferenceModel.IncidentRole]: IncidentRole,
  [MonitorStepsReferenceModel.TelemetryService]: Service,
  [MonitorStepsReferenceModel.NetworkDevice]: NetworkDevice,
};

const ALL_MODELS: Array<MonitorStepsReferenceModel> = Object.values(
  MonitorStepsReferenceModel,
);

// A record of `model` that exists and, if the model is project scoped, is in PROJECT_ID.
const existingRecord: (
  model: MonitorStepsReferenceModel,
) => DatabaseBaseModel = (
  model: MonitorStepsReferenceModel,
): DatabaseBaseModel => {
  const record: DatabaseBaseModel = new MODEL_TYPE_BY_MODEL[model]();
  record._id = ID_BY_MODEL[model];

  const tenantColumn: string | null = record.getTenantColumn();

  if (tenantColumn) {
    record.setValue(tenantColumn, PROJECT_ID);
  }

  return record;
};

const objectIdJSON: (id: string) => JSONObject = (id: string): JSONObject => {
  return { _type: ObjectType.ObjectID, value: id };
};

/*
 * monitorSteps naming one record of every model the validator knows about,
 * with incidents and alerts switched on so every reference must exist.
 */
const monitorStepsReferencingEveryModel: () => JSONObject = (): JSONObject => {
  return {
    _type: ObjectType.MonitorSteps,
    value: {
      defaultMonitorStatusId:
        ID_BY_MODEL[MonitorStepsReferenceModel.MonitorStatus],
      monitorStepsInstanceArray: [
        {
          _type: ObjectType.MonitorStep,
          value: {
            id: "b1e2f3a4-c5d6-4e7f-8091-a2b3c4d5e6f7",
            metricMonitor: {
              telemetryServiceIds: [
                objectIdJSON(
                  ID_BY_MODEL[MonitorStepsReferenceModel.TelemetryService],
                ),
              ],
            },
            networkDeviceMonitor: {
              networkDeviceId:
                ID_BY_MODEL[MonitorStepsReferenceModel.NetworkDevice],
            },
            monitorCriteria: {
              _type: ObjectType.MonitorCriteria,
              value: {
                monitorCriteriaInstanceArray: [
                  {
                    _type: ObjectType.MonitorCriteriaInstance,
                    value: {
                      id: "c2f3a4b5-d6e7-4f80-91a2-b3c4d5e6f708",
                      name: "Monitor is offline",
                      description: "",
                      filterCondition: "Any",
                      filters: [],
                      monitorStatusId:
                        ID_BY_MODEL[MonitorStepsReferenceModel.MonitorStatus],
                      changeMonitorStatus: true,
                      createIncidents: true,
                      createAlerts: true,
                      incidents: [
                        {
                          id: "d3a4b5c6-e7f8-4091-a2b3-c4d5e6f70819",
                          title: "Down",
                          description: "",
                          incidentSeverityId: objectIdJSON(
                            ID_BY_MODEL[
                              MonitorStepsReferenceModel.IncidentSeverity
                            ],
                          ),
                          onCallPolicyIds: [
                            objectIdJSON(
                              ID_BY_MODEL[
                                MonitorStepsReferenceModel.OnCallDutyPolicy
                              ],
                            ),
                          ],
                          labelIds: [
                            objectIdJSON(
                              ID_BY_MODEL[MonitorStepsReferenceModel.Label],
                            ),
                          ],
                          ownerTeamIds: [
                            objectIdJSON(
                              ID_BY_MODEL[MonitorStepsReferenceModel.Team],
                            ),
                          ],
                          ownerUserIds: [
                            objectIdJSON(
                              ID_BY_MODEL[MonitorStepsReferenceModel.User],
                            ),
                          ],
                          incidentMemberRoles: [
                            {
                              roleId: objectIdJSON(
                                ID_BY_MODEL[
                                  MonitorStepsReferenceModel.IncidentRole
                                ],
                              ),
                              userId: objectIdJSON(
                                ID_BY_MODEL[MonitorStepsReferenceModel.User],
                              ),
                            },
                          ],
                        },
                      ],
                      alerts: [
                        {
                          id: "e4b5c6d7-f809-41a2-b3c4-d5e6f708192a",
                          title: "Down",
                          description: "",
                          alertSeverityId: objectIdJSON(
                            ID_BY_MODEL[
                              MonitorStepsReferenceModel.AlertSeverity
                            ],
                          ),
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  };
};

type ValidatorModule = {
  default: {
    validateMonitorStepsBelongToProject: (data: {
      monitorSteps: JSONObject;
      projectId: ObjectID;
    }) => Promise<void>;
  };
};

type LookupService = {
  getModel: () => DatabaseBaseModel;
  findBy: (...args: Array<unknown>) => Promise<Array<DatabaseBaseModel>>;
};

type ServiceModule = {
  __esModule: true;
  default?: LookupService | undefined;
};

describe("MonitorStepsProjectValidator load order", () => {
  afterEach(() => {
    /*
     * resetModules does not forget doMock factories, and a later test that
     * loads the real import graph would otherwise be handed the partially
     * loaded stand-ins below.
     */
    for (const model of ALL_MODELS) {
      jest.dontMock(SERVICE_PATH_BY_MODEL[model]);
    }

    jest.restoreAllMocks();
    jest.resetModules();
  });

  it("finds each model's service when validating, even if the service was still loading when the validator loaded", async () => {
    /*
     * This reproduces what a CommonJS import cycle does, but on purpose. Each
     * service module gives the validator an exports object with no `default`
     * yet, which is how a module looks while it is still loading. The defaults
     * are filled in only after the validator has loaded, the way they are once
     * the cycle finishes. A table built at load time would hold `undefined` for
     * every model here.
     */
    const moduleByModel: Map<MonitorStepsReferenceModel, ServiceModule> =
      new Map();

    let validator: ValidatorModule["default"] | null = null;

    jest.isolateModules((): void => {
      for (const model of ALL_MODELS) {
        const partiallyLoaded: ServiceModule = { __esModule: true };
        moduleByModel.set(model, partiallyLoaded);

        jest.doMock(SERVICE_PATH_BY_MODEL[model], (): ServiceModule => {
          return partiallyLoaded;
        });
      }

      validator = (
        jest.requireActual(
          "../../../../Server/Utils/Monitor/MonitorStepsProjectValidator",
        ) as ValidatorModule
      ).default;
    });

    const lookups: Map<MonitorStepsReferenceModel, Array<unknown>> = new Map();

    for (const model of ALL_MODELS) {
      lookups.set(model, []);

      moduleByModel.get(model)!.default = {
        getModel: (): DatabaseBaseModel => {
          return new MODEL_TYPE_BY_MODEL[model]();
        },
        findBy: (
          ...args: Array<unknown>
        ): Promise<Array<DatabaseBaseModel>> => {
          lookups.get(model)!.push(args);
          return Promise.resolve([existingRecord(model)]);
        },
      };
    }

    await expect(
      validator!.validateMonitorStepsBelongToProject({
        monitorSteps: monitorStepsReferencingEveryModel(),
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

    for (const model of ALL_MODELS) {
      expect({ model, lookups: lookups.get(model)!.length }).toEqual({
        model,
        lookups: 1,
      });
    }
  });

  it("accepts incident owner users and members when loaded in the API server's import order", async () => {
    /*
     * This is the real import graph rather than a simulated one. BaseAPI is the
     * first module on the API server's import path (App/Index.ts ->
     * FeatureSet/BaseAPI/Index) that reaches the service graph. Loading it pulls
     * this validator in from inside the UserService cycle (BaseAPI -> ... ->
     * UserService -> ... -> MonitorTemplateService -> validator), while
     * UserService and NetworkDeviceService are still loading. The criteria have
     * the same shape as the support report: an incident with an owner team, an
     * owner user, and a member role for that same user.
     */
    let validator: ValidatorModule["default"] | null = null;
    const serviceByModel: Map<MonitorStepsReferenceModel, LookupService> =
      new Map();

    jest.isolateModules((): void => {
      jest.requireActual("../../../../Server/API/BaseAPI");

      validator = (
        jest.requireActual(
          "../../../../Server/Utils/Monitor/MonitorStepsProjectValidator",
        ) as ValidatorModule
      ).default;

      for (const model of ALL_MODELS) {
        serviceByModel.set(
          model,
          (
            jest.requireActual(SERVICE_PATH_BY_MODEL[model]) as {
              default: LookupService;
            }
          ).default,
        );
      }
    });

    for (const model of ALL_MODELS) {
      jest
        .spyOn(serviceByModel.get(model)!, "findBy")
        .mockResolvedValue([existingRecord(model)]);
    }

    const userId: string = ID_BY_MODEL[MonitorStepsReferenceModel.User];

    await expect(
      validator!.validateMonitorStepsBelongToProject({
        monitorSteps: {
          _type: ObjectType.MonitorSteps,
          value: {
            defaultMonitorStatusId:
              ID_BY_MODEL[MonitorStepsReferenceModel.MonitorStatus],
            monitorStepsInstanceArray: [
              {
                _type: ObjectType.MonitorStep,
                value: {
                  id: "f5c6d7e8-0912-4a3b-8c4d-e5f60718293b",
                  monitorDestination: {
                    _type: ObjectType.URL,
                    value: "https://api.example.com/health",
                  },
                  requestType: "GET",
                  monitorCriteria: {
                    _type: ObjectType.MonitorCriteria,
                    value: {
                      monitorCriteriaInstanceArray: [
                        {
                          _type: ObjectType.MonitorCriteriaInstance,
                          value: {
                            id: "a6d7e8f9-1a23-4b4c-9d5e-f60718293a4c",
                            name: "Check if Backend API is offline",
                            description: "",
                            filterCondition: "Any",
                            filters: [
                              { checkOn: "Is Online", filterType: "False" },
                            ],
                            monitorStatusId:
                              ID_BY_MODEL[
                                MonitorStepsReferenceModel.MonitorStatus
                              ],
                            changeMonitorStatus: true,
                            createIncidents: true,
                            createAlerts: false,
                            incidents: [
                              {
                                id: "b7e8f90a-2b34-4c5d-8e6f-0718293a4b5d",
                                title: "Backend API is offline",
                                description: "",
                                autoResolveIncident: true,
                                incidentSeverityId: objectIdJSON(
                                  ID_BY_MODEL[
                                    MonitorStepsReferenceModel.IncidentSeverity
                                  ],
                                ),
                                onCallPolicyIds: [],
                                incidentMemberRoles: [
                                  {
                                    roleId: objectIdJSON(
                                      ID_BY_MODEL[
                                        MonitorStepsReferenceModel.IncidentRole
                                      ],
                                    ),
                                    userId: objectIdJSON(userId),
                                  },
                                ],
                                ownerTeamIds: [
                                  objectIdJSON(
                                    ID_BY_MODEL[
                                      MonitorStepsReferenceModel.Team
                                    ],
                                  ),
                                ],
                                ownerUserIds: [objectIdJSON(userId)],
                              },
                            ],
                            alerts: [],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

    expect(
      serviceByModel.get(MonitorStepsReferenceModel.User)!.findBy,
    ).toHaveBeenCalledTimes(1);
    expect(
      serviceByModel.get(MonitorStepsReferenceModel.IncidentRole)!.findBy,
    ).toHaveBeenCalledTimes(1);
  });
});

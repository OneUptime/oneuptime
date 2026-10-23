import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import AlertOwnerRule from "../../../../Models/DatabaseModels/AlertOwnerRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentOwnerRule from "../../../../Models/DatabaseModels/IncidentOwnerRule";
import AlertEpisodeOwnerRuleEngineService from "../../../../Server/Services/AlertEpisodeOwnerRuleEngineService";
import AlertOwnerRuleEngineService from "../../../../Server/Services/AlertOwnerRuleEngineService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import HostService from "../../../../Server/Services/HostService";
import IncidentEpisodeOwnerRuleEngineService from "../../../../Server/Services/IncidentEpisodeOwnerRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import LabelService from "../../../../Server/Services/LabelService";
import MonitorService from "../../../../Server/Services/MonitorService";
import PodmanHostService from "../../../../Server/Services/PodmanHostService";
import ServiceService from "../../../../Server/Services/ServiceService";
import { OwnerRulePlanEntry } from "../../../../Server/Utils/Rules/OwnerRulePlan";
import OwnerRulePreviewBuilder from "../../../../Server/Utils/Rules/OwnerRulePreviewBuilder";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import OwnerRulePreview, {
  OwnerRulePreviewDraft,
  OwnerRulePreviewEvent,
  OwnerRulePreviewResult,
} from "../../../../Types/Rules/OwnerRulePreview";
import { permissionRow, tenantPermissionsFor } from "../../API/PermissionRows";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test - which owner rules would run for an incident, alert
 * or episode being created, and who they would add (Server/Utils/Rules/
 * OwnerRulePreviewBuilder, for POST /<event>/owner-rule-preview).
 *
 * The draft - the event as the create form holds it - becomes the event the
 * create would write, in the caller's project with the caller as its
 * creator, and goes to the owner rule engine of its kind (previewRules, the
 * plan the create carries out). What the caller learns is bounded: only
 * someone who may read the event's owner rules may ask; every record the
 * draft names must be the project's; the answer is ids and rule names.
 */

type AnyService = Record<string, (...args: Array<any>) => any>;

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000001");
const LABEL_ID: string = "30000000-0000-4000-8000-000000000001";
const MONITOR_ID: string = "30000000-0000-4000-8000-000000000002";
const OTHER_MONITOR_ID: string = "30000000-0000-4000-8000-000000000003";
const HOST_ID: string = "30000000-0000-4000-8000-000000000004";
const CLUSTER_ID: string = "30000000-0000-4000-8000-000000000005";
const DOCKER_HOST_ID: string = "30000000-0000-4000-8000-000000000006";
const PODMAN_HOST_ID: string = "30000000-0000-4000-8000-000000000007";
const SERVICE_ID: string = "30000000-0000-4000-8000-000000000008";
const SEVERITY_ID: string = "30000000-0000-4000-8000-000000000009";
const RULE_ID: string = "40000000-0000-4000-8000-000000000001";
const OWNER_USER: string = "50000000-0000-4000-8000-000000000001";
const OWNER_TEAM: string = "50000000-0000-4000-8000-000000000002";
const CREATOR_TEAM: string = "50000000-0000-4000-8000-000000000003";

const EVENTS: Array<OwnerRulePreviewEvent> = [
  OwnerRulePreviewEvent.Incident,
  OwnerRulePreviewEvent.Alert,
  OwnerRulePreviewEvent.IncidentEpisode,
  OwnerRulePreviewEvent.AlertEpisode,
];

// The read permission of each event's owner rules, alone.
const READ_RULES: Record<OwnerRulePreviewEvent, Permission> = {
  [OwnerRulePreviewEvent.Incident]: Permission.ReadIncidentOwnerRule,
  [OwnerRulePreviewEvent.Alert]: Permission.ReadAlertOwnerRule,
  [OwnerRulePreviewEvent.IncidentEpisode]:
    Permission.ReadIncidentEpisodeOwnerRule,
  [OwnerRulePreviewEvent.AlertEpisode]: Permission.ReadAlertEpisodeOwnerRule,
};

function caller(
  rows: Array<Permission | ReturnType<typeof permissionRow>>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userTenantAccessPermission: tenantPermissionsFor(PROJECT_ID, rows),
  };
}

function draftOf(
  fields: Partial<OwnerRulePreviewDraft> = {},
): OwnerRulePreviewDraft {
  return { ...OwnerRulePreview.emptyDraft(), ...fields };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may ask", () => {
  it.each(EVENTS)(
    "someone who may read %s owner rules, and only those",
    (event: OwnerRulePreviewEvent) => {
      expect(() => {
        OwnerRulePreviewBuilder.assertCallerMayPreview({
          props: caller([READ_RULES[event]]),
          event: event,
        });
      }).not.toThrow();

      // Another event's rules are not these.
      for (const other of EVENTS) {
        if (other === event) {
          continue;
        }

        expect(() => {
          OwnerRulePreviewBuilder.assertCallerMayPreview({
            props: caller([READ_RULES[other]]),
            event: event,
          });
        }).toThrow(NotAuthorizedException);
      }
    },
  );

  it("a project member, who reads every rule", () => {
    for (const event of EVENTS) {
      expect(() => {
        OwnerRulePreviewBuilder.assertCallerMayPreview({
          props: caller([Permission.ProjectMember]),
          event: event,
        });
      }).not.toThrow();
    }
  });

  it("never someone who holds nothing in the project, nor someone of another project", () => {
    for (const props of [
      caller([]),
      { tenantId: PROJECT_ID, userId: USER_ID },
      {
        ...caller([Permission.ProjectOwner]),
        tenantId: new ObjectID("10000000-0000-4000-8000-000000000099"),
      },
    ] as Array<DatabaseCommonInteractionProps>) {
      expect(() => {
        OwnerRulePreviewBuilder.assertCallerMayPreview({
          props: props,
          event: OwnerRulePreviewEvent.Incident,
        });
      }).toThrow(
        "You do not have permission to see which owner rules would run.",
      );
    }
  });

  it("not when a block on reading the rules takes it away", () => {
    expect(() => {
      OwnerRulePreviewBuilder.assertCallerMayPreview({
        props: caller([
          Permission.ReadIncidentOwnerRule,
          permissionRow(Permission.ReadIncidentOwnerRule, { isBlock: true }),
        ]),
        event: OwnerRulePreviewEvent.Incident,
      });
    }).toThrow(NotAuthorizedException);
  });

  it("a master admin", () => {
    expect(() => {
      OwnerRulePreviewBuilder.assertCallerMayPreview({
        props: { isMasterAdmin: true, userId: USER_ID },
        event: OwnerRulePreviewEvent.Alert,
      });
    }).not.toThrow();
  });
});

describe("the draft, as the request sends it", () => {
  it("is empty when the body is not an object", () => {
    for (const body of [undefined, null, "text", 12, ["a"]]) {
      expect(
        OwnerRulePreviewBuilder.parseDraft({
          body: body,
          event: OwnerRulePreviewEvent.Incident,
        }),
      ).toEqual(OwnerRulePreview.emptyDraft());
    }
  });

  it("reads the text, the severity and every list an incident has", () => {
    expect(
      OwnerRulePreviewBuilder.parseDraft({
        body: {
          title: "Checkout is down",
          description: "500s on /pay",
          severityId: SEVERITY_ID.toUpperCase(),
          labelIds: [LABEL_ID],
          monitorIds: [MONITOR_ID, OTHER_MONITOR_ID],
          hostIds: [HOST_ID],
          kubernetesClusterIds: [CLUSTER_ID],
          dockerHostIds: [DOCKER_HOST_ID],
          podmanHostIds: [PODMAN_HOST_ID],
          serviceIds: [SERVICE_ID],
        },
        event: OwnerRulePreviewEvent.Incident,
      }),
    ).toEqual({
      title: "Checkout is down",
      description: "500s on /pay",
      severityId: SEVERITY_ID,
      labelIds: [LABEL_ID],
      monitorIds: [MONITOR_ID, OTHER_MONITOR_ID],
      hostIds: [HOST_ID],
      kubernetesClusterIds: [CLUSTER_ID],
      dockerHostIds: [DOCKER_HOST_ID],
      podmanHostIds: [PODMAN_HOST_ID],
      serviceIds: [SERVICE_ID],
    });
  });

  it("names each id once, in the order sent, whatever its case", () => {
    expect(
      OwnerRulePreviewBuilder.parseDraft({
        body: { labelIds: [LABEL_ID, LABEL_ID.toUpperCase(), ` ${LABEL_ID} `] },
        event: OwnerRulePreviewEvent.Incident,
      }).labelIds,
    ).toEqual([LABEL_ID]);
  });

  it("reads no severity from an empty one", () => {
    for (const severityId of [undefined, null, ""]) {
      expect(
        OwnerRulePreviewBuilder.parseDraft({
          body: { severityId },
          event: OwnerRulePreviewEvent.Alert,
        }).severityId,
      ).toBeNull();
    }
  });

  it("refuses text that is not text, and ids that are not ids", () => {
    const refusals: Array<[unknown, string]> = [
      [{ title: 12 }, "title must be text."],
      [{ description: { a: 1 } }, "description must be text."],
      [{ severityId: "not-an-id" }, "severityId must be a valid ID."],
      [{ severityId: 12 }, "severityId must be a valid ID."],
      [{ labelIds: "label" }, "labelIds must be a list of IDs."],
      [{ hostIds: ["not-an-id"] }, "hostIds must be a valid ID."],
      [{ serviceIds: [null] }, "serviceIds must be a valid ID."],
    ];

    for (const [body, message] of refusals) {
      expect(() => {
        OwnerRulePreviewBuilder.parseDraft({
          body: body,
          event: OwnerRulePreviewEvent.Incident,
        });
      }).toThrow(new BadDataException(message));
    }
  });

  it("refuses more ids in a list than any form sends", () => {
    const tooMany: Array<string> = Array.from(
      { length: OwnerRulePreview.maxIdsPerList + 1 },
      (): string => {
        return ObjectID.generate().toString();
      },
    );

    expect(() => {
      OwnerRulePreviewBuilder.parseDraft({
        body: { labelIds: tooMany },
        event: OwnerRulePreviewEvent.Incident,
      });
    }).toThrow(
      `labelIds can list at most ${OwnerRulePreview.maxIdsPerList} IDs.`,
    );
  });

  it("refuses an alert with two monitors: it has one at most", () => {
    expect(() => {
      OwnerRulePreviewBuilder.parseDraft({
        body: { monitorIds: [MONITOR_ID, OTHER_MONITOR_ID] },
        event: OwnerRulePreviewEvent.Alert,
      });
    }).toThrow("An alert has one monitor at most.");
  });

  it("reads no resources for an episode, which has none", () => {
    for (const event of [
      OwnerRulePreviewEvent.IncidentEpisode,
      OwnerRulePreviewEvent.AlertEpisode,
    ]) {
      expect(
        OwnerRulePreviewBuilder.parseDraft({
          body: {
            title: "Payments",
            labelIds: [LABEL_ID],
            monitorIds: [MONITOR_ID],
            hostIds: ["not even an id"],
            serviceIds: [SERVICE_ID],
          },
          event: event,
        }),
      ).toEqual(draftOf({ title: "Payments", labelIds: [LABEL_ID] }));
    }
  });
});

/*
 * Every record the draft names is looked up, as OneUptime, in the caller's
 * project: an id of another project's record - or of none - is refused, the
 * same words for both, before any rule is read.
 */
describe("the records the draft names", () => {
  // Each service answers with the ids it is given that are in `found`.
  function projectHas(found: Array<string>): Array<jest.SpyInstance> {
    return [
      LabelService,
      MonitorService,
      HostService,
      KubernetesClusterService,
      DockerHostService,
      PodmanHostService,
      ServiceService,
      IncidentSeverityService,
      AlertSeverityService,
    ].map((service: unknown): jest.SpyInstance => {
      return jest
        .spyOn(service as AnyService, "findBy")
        .mockImplementation((async (args: Record<string, any>) => {
          const asked: string = JSON.stringify(args["query"]["_id"]);

          return found
            .filter((id: string): boolean => {
              return asked.includes(id);
            })
            .map((id: string): BaseModel => {
              const row: BaseModel = new IncidentOwnerRule();
              row.id = new ObjectID(id);
              return row;
            });
        }) as never);
    });
  }

  function previewsNothing(): jest.SpyInstance {
    return jest
      .spyOn(IncidentOwnerRuleEngineService, "previewRules")
      .mockResolvedValue([]);
  }

  it("are looked up in the caller's project, as OneUptime", async () => {
    const [labelLookup]: Array<jest.SpyInstance> = projectHas([LABEL_ID]);
    previewsNothing();

    await OwnerRulePreviewBuilder.build({
      event: OwnerRulePreviewEvent.Incident,
      projectId: PROJECT_ID,
      props: caller([Permission.ProjectMember]),
      draft: draftOf({ labelIds: [LABEL_ID] }),
    });

    const args: Record<string, any> = labelLookup!.mock.calls[0]![0] as never;

    expect(String(args["query"]["projectId"])).toBe(PROJECT_ID.toString());
    expect(JSON.stringify(args["query"]["_id"])).toContain(LABEL_ID);
    expect(args["props"]).toEqual({ isRoot: true });
  });

  it.each([
    ["labels", { labelIds: [LABEL_ID] }],
    ["monitors", { monitorIds: [MONITOR_ID] }],
    ["hosts", { hostIds: [HOST_ID] }],
    ["Kubernetes clusters", { kubernetesClusterIds: [CLUSTER_ID] }],
    ["Docker hosts", { dockerHostIds: [DOCKER_HOST_ID] }],
    ["Podman hosts", { podmanHostIds: [PODMAN_HOST_ID] }],
    ["services", { serviceIds: [SERVICE_ID] }],
  ] as Array<[string, Partial<OwnerRulePreviewDraft>]>)(
    "refuses %s that are not the project's, before any rule is read",
    async (name: string, fields: Partial<OwnerRulePreviewDraft>) => {
      projectHas([]);
      const preview: jest.SpyInstance = previewsNothing();

      await expect(
        OwnerRulePreviewBuilder.build({
          event: OwnerRulePreviewEvent.Incident,
          projectId: PROJECT_ID,
          props: caller([Permission.ProjectMember]),
          draft: draftOf(fields),
        }),
      ).rejects.toThrow(
        new BadDataException(
          `One or more of these ${name} were not found in this project.`,
        ),
      );
      expect(preview).not.toHaveBeenCalled();
    },
  );

  it.each([
    [OwnerRulePreviewEvent.Incident, "incident"],
    [OwnerRulePreviewEvent.IncidentEpisode, "incident"],
    [OwnerRulePreviewEvent.Alert, "alert"],
    [OwnerRulePreviewEvent.AlertEpisode, "alert"],
  ] as Array<[OwnerRulePreviewEvent, string]>)(
    "refuses a %s severity that is not the project's",
    async (event: OwnerRulePreviewEvent, kind: string) => {
      projectHas([]);

      await expect(
        OwnerRulePreviewBuilder.build({
          event: event,
          projectId: PROJECT_ID,
          props: caller([Permission.ProjectMember]),
          draft: draftOf({ severityId: SEVERITY_ID }),
        }),
      ).rejects.toThrow(
        new BadDataException(
          `This ${kind} severity was not found in this project.`,
        ),
      );
    },
  );

  it("checks an alert's severity among the alert severities", async () => {
    const lookups: Array<jest.SpyInstance> = projectHas([SEVERITY_ID]);
    jest
      .spyOn(AlertOwnerRuleEngineService, "previewRules")
      .mockResolvedValue([]);

    await OwnerRulePreviewBuilder.build({
      event: OwnerRulePreviewEvent.Alert,
      projectId: PROJECT_ID,
      props: caller([Permission.ProjectMember]),
      draft: draftOf({ severityId: SEVERITY_ID }),
    });

    // IncidentSeverityService, then AlertSeverityService: the last two.
    expect(lookups[7]).not.toHaveBeenCalled();
    expect(lookups[8]).toHaveBeenCalledTimes(1);
  });

  it("looks nothing up for a draft that names nothing", async () => {
    const lookups: Array<jest.SpyInstance> = projectHas([]);
    previewsNothing();

    await OwnerRulePreviewBuilder.build({
      event: OwnerRulePreviewEvent.Incident,
      projectId: PROJECT_ID,
      props: caller([Permission.ProjectMember]),
      draft: draftOf({ title: "Checkout is down" }),
    });

    for (const lookup of lookups) {
      expect(lookup).not.toHaveBeenCalled();
    }
  });
});

describe("the answer", () => {
  function entry(
    rule: BaseModel,
    fields: Partial<OwnerRulePlanEntry<BaseModel>> = {},
  ): OwnerRulePlanEntry<BaseModel> {
    return {
      rule: rule,
      notify: true,
      userIds: [],
      teamIds: [],
      creatorTeamIds: [],
      ...fields,
    };
  }

  function ruleNamed(
    name: string | undefined,
    id: string = RULE_ID,
  ): BaseModel {
    const rule: IncidentOwnerRule = new IncidentOwnerRule();
    rule.id = new ObjectID(id);

    if (name !== undefined) {
      rule.name = name;
    }

    return rule;
  }

  it("lists each rule that adds someone, by name, with whom it adds", async () => {
    jest
      .spyOn(IncidentOwnerRuleEngineService, "previewRules")
      .mockResolvedValue([
        entry(ruleNamed("Platform owns checkout"), {
          notify: false,
          userIds: [OWNER_USER],
          teamIds: [OWNER_TEAM, CREATOR_TEAM],
          creatorTeamIds: [CREATOR_TEAM],
        }),
        // A creator's team the creator is not in: it adds nobody.
        entry(
          ruleNamed("Declarer's team", "40000000-0000-4000-8000-000000000002"),
        ),
        entry(ruleNamed(undefined, "40000000-0000-4000-8000-000000000003"), {
          userIds: [OWNER_USER],
        }),
      ] as never);

    const result: OwnerRulePreviewResult = await OwnerRulePreviewBuilder.build({
      event: OwnerRulePreviewEvent.Incident,
      projectId: PROJECT_ID,
      props: caller([Permission.ProjectMember]),
      draft: draftOf(),
    });

    expect(result).toEqual({
      rules: [
        {
          ruleId: RULE_ID,
          ruleName: "Platform owns checkout",
          userIds: [OWNER_USER],
          teamIds: [OWNER_TEAM, CREATOR_TEAM],
          creatorTeamIds: [CREATOR_TEAM],
          notifiesOwners: false,
        },
        {
          ruleId: "40000000-0000-4000-8000-000000000003",
          ruleName: "",
          userIds: [OWNER_USER],
          teamIds: [],
          creatorTeamIds: [],
          notifiesOwners: true,
        },
      ],
    });
  });

  it("asks the incident engine about the incident the create would write, the caller its creator", async () => {
    const preview: jest.SpyInstance = jest
      .spyOn(IncidentOwnerRuleEngineService, "previewRules")
      .mockResolvedValue([]);
    jest
      .spyOn(LabelService, "findBy")
      .mockResolvedValue([
        Object.assign(new IncidentOwnerRule(), { id: new ObjectID(LABEL_ID) }),
      ] as never);
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([
      Object.assign(new IncidentOwnerRule(), {
        id: new ObjectID(MONITOR_ID),
      }),
    ] as never);
    jest.spyOn(IncidentSeverityService, "findBy").mockResolvedValue([
      Object.assign(new IncidentOwnerRule(), {
        id: new ObjectID(SEVERITY_ID),
      }),
    ] as never);

    await OwnerRulePreviewBuilder.build({
      event: OwnerRulePreviewEvent.Incident,
      projectId: PROJECT_ID,
      props: caller([Permission.ProjectMember]),
      draft: draftOf({
        title: "Checkout is down",
        description: "500s",
        severityId: SEVERITY_ID,
        labelIds: [LABEL_ID],
        monitorIds: [MONITOR_ID],
      }),
    });

    const incident: Incident = preview.mock.calls[0]![0] as Incident;

    expect(incident).toBeInstanceOf(Incident);
    expect(incident.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(incident.title).toBe("Checkout is down");
    expect(incident.description).toBe("500s");
    expect(incident.incidentSeverityId?.toString()).toBe(SEVERITY_ID);
    expect(incident.createdByUserId?.toString()).toBe(USER_ID.toString());
    expect(
      (incident.labels || []).map((label: BaseModel): string => {
        return label.id!.toString();
      }),
    ).toEqual([LABEL_ID]);
    expect(
      (incident.monitors || []).map((monitor: BaseModel): string => {
        return monitor.id!.toString();
      }),
    ).toEqual([MONITOR_ID]);
    // Not written: no id of its own.
    expect(incident.id).toBeFalsy();
  });

  it("names no creator for an API key, which has none", async () => {
    const preview: jest.SpyInstance = jest
      .spyOn(IncidentOwnerRuleEngineService, "previewRules")
      .mockResolvedValue([]);

    await OwnerRulePreviewBuilder.build({
      event: OwnerRulePreviewEvent.Incident,
      projectId: PROJECT_ID,
      props: {
        tenantId: PROJECT_ID,
        userTenantAccessPermission: tenantPermissionsFor(PROJECT_ID, [
          Permission.ProjectMember,
        ]),
      },
      draft: draftOf(),
    });

    expect(
      (preview.mock.calls[0]![0] as Incident).createdByUserId,
    ).toBeUndefined();
  });

  it("asks the alert engine about the alert, with its one monitor", async () => {
    const preview: jest.SpyInstance = jest
      .spyOn(AlertOwnerRuleEngineService, "previewRules")
      .mockResolvedValue([]);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        Object.assign(new AlertOwnerRule(), { id: new ObjectID(MONITOR_ID) }),
      ] as never);

    await OwnerRulePreviewBuilder.build({
      event: OwnerRulePreviewEvent.Alert,
      projectId: PROJECT_ID,
      props: caller([Permission.ProjectMember]),
      draft: draftOf({ title: "CPU", monitorIds: [MONITOR_ID] }),
    });

    const alert: Alert = preview.mock.calls[0]![0] as Alert;

    expect(alert).toBeInstanceOf(Alert);
    expect(alert.monitorId?.toString()).toBe(MONITOR_ID);
    expect(alert.createdByUserId?.toString()).toBe(USER_ID.toString());
    expect(alert.projectId?.toString()).toBe(PROJECT_ID.toString());
  });

  it("asks each episode engine about the episode, its labels and severity", async () => {
    const incidentEpisodePreview: jest.SpyInstance = jest
      .spyOn(IncidentEpisodeOwnerRuleEngineService, "previewRules")
      .mockResolvedValue([]);
    const alertEpisodePreview: jest.SpyInstance = jest
      .spyOn(AlertEpisodeOwnerRuleEngineService, "previewRules")
      .mockResolvedValue([]);
    jest
      .spyOn(LabelService, "findBy")
      .mockResolvedValue([
        Object.assign(new IncidentOwnerRule(), { id: new ObjectID(LABEL_ID) }),
      ] as never);
    jest.spyOn(IncidentSeverityService, "findBy").mockResolvedValue([
      Object.assign(new IncidentOwnerRule(), {
        id: new ObjectID(SEVERITY_ID),
      }),
    ] as never);
    jest.spyOn(AlertSeverityService, "findBy").mockResolvedValue([
      Object.assign(new IncidentOwnerRule(), {
        id: new ObjectID(SEVERITY_ID),
      }),
    ] as never);

    for (const event of [
      OwnerRulePreviewEvent.IncidentEpisode,
      OwnerRulePreviewEvent.AlertEpisode,
    ]) {
      await OwnerRulePreviewBuilder.build({
        event: event,
        projectId: PROJECT_ID,
        props: caller([Permission.ProjectMember]),
        draft: draftOf({
          title: "Payments",
          severityId: SEVERITY_ID,
          labelIds: [LABEL_ID],
        }),
      });
    }

    const incidentEpisode: IncidentEpisode = incidentEpisodePreview.mock
      .calls[0]![0] as IncidentEpisode;
    const alertEpisode: AlertEpisode = alertEpisodePreview.mock
      .calls[0]![0] as AlertEpisode;

    expect(incidentEpisode).toBeInstanceOf(IncidentEpisode);
    expect(incidentEpisode.title).toBe("Payments");
    expect(incidentEpisode.incidentSeverityId?.toString()).toBe(SEVERITY_ID);
    expect(incidentEpisode.labels?.[0]?.id?.toString()).toBe(LABEL_ID);

    expect(alertEpisode).toBeInstanceOf(AlertEpisode);
    expect(alertEpisode.alertSeverityId?.toString()).toBe(SEVERITY_ID);
    expect(alertEpisode.projectId?.toString()).toBe(PROJECT_ID.toString());
  });
});

import Host from "Common/Models/DatabaseModels/Host";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Service from "Common/Models/DatabaseModels/Service";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Recurring from "Common/Types/Events/Recurring";

/*
 * A recurring scheduled maintenance is defined once, on a template, and
 * re-materialized by this cron every time the next occurrence comes due.
 * The template can carry the full set of affected resources — monitors,
 * hosts, Kubernetes clusters, Docker hosts, Podman hosts and services —
 * but the job only ever selected and copied `monitors`. Every recurrence
 * after the first therefore silently dropped every host, cluster and
 * service the user attached, so the event no longer suppressed alerts
 * for them and no longer showed on their pages.
 *
 * These tests pin that the copy is complete: what the template names,
 * the recurrence carries.
 *
 * The job registers itself via RunCron at import time and exports
 * nothing, so the Cron util is mocked to CAPTURE the handler — the same
 * recorder the other App/Tests/Workers/Jobs suites use — and each test
 * drives one full tick.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceTemplateService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      getNextEventTime: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return { __esModule: true, default: { create: jest.fn() } };
});

jest.mock(
  "Common/Server/Services/ScheduledMaintenanceTemplateOwnerUserService",
  () => {
    return { __esModule: true, default: { findAllBy: jest.fn() } };
  },
);

jest.mock(
  "Common/Server/Services/ScheduledMaintenanceTemplateOwnerTeamService",
  () => {
    return { __esModule: true, default: { findAllBy: jest.fn() } };
  },
);

jest.mock("Common/Server/Services/ScheduledMaintenanceOwnerUserService", () => {
  return { __esModule: true, default: { create: jest.fn() } };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceOwnerTeamService", () => {
  return { __esModule: true, default: { create: jest.fn() } };
});

/*
 * OwnerRuleAssignment.createOwner skips a user owner who is not a member of
 * the project; the membership check itself is tested in Common.
 */
jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: { isUserMemberOfProject: jest.fn() },
  };
});

/*
 * The lookup services only identify which table a list is checked against;
 * the filter itself is mocked below and tested in Common.
 */
jest.mock("Common/Server/Services/MonitorService", () => {
  return { __esModule: true, default: { name: "MonitorService" } };
});

jest.mock("Common/Server/Services/LabelService", () => {
  return { __esModule: true, default: { name: "LabelService" } };
});

jest.mock("Common/Server/Services/StatusPageService", () => {
  return { __esModule: true, default: { name: "StatusPageService" } };
});

jest.mock("Common/Server/Services/HostService", () => {
  return { __esModule: true, default: { name: "HostService" } };
});

jest.mock("Common/Server/Services/KubernetesClusterService", () => {
  return { __esModule: true, default: { name: "KubernetesClusterService" } };
});

jest.mock("Common/Server/Services/DockerHostService", () => {
  return { __esModule: true, default: { name: "DockerHostService" } };
});

jest.mock("Common/Server/Services/PodmanHostService", () => {
  return { __esModule: true, default: { name: "PodmanHostService" } };
});

jest.mock("Common/Server/Services/ServiceService", () => {
  return { __esModule: true, default: { name: "ServiceService" } };
});

jest.mock(
  "Common/Server/Utils/Database/ProjectScopedReferenceValidator",
  () => {
    return {
      __esModule: true,
      default: { filterUsableInProject: jest.fn() },
    };
  },
);

import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceTemplateService from "Common/Server/Services/ScheduledMaintenanceTemplateService";
import ScheduledMaintenanceTemplateOwnerUserService from "Common/Server/Services/ScheduledMaintenanceTemplateOwnerUserService";
import ScheduledMaintenanceTemplateOwnerTeamService from "Common/Server/Services/ScheduledMaintenanceTemplateOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "Common/Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceOwnerTeamService from "Common/Server/Services/ScheduledMaintenanceOwnerTeamService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import PostgresErrorTranslator from "Common/Server/Utils/Database/PostgresErrorTranslator";
import logger from "Common/Server/Utils/Logger";
import ScheduledMaintenanceOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import ScheduledMaintenanceOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import Label from "Common/Models/DatabaseModels/Label";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import LabelService from "Common/Server/Services/LabelService";
import MonitorService from "Common/Server/Services/MonitorService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import HostService from "Common/Server/Services/HostService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import PodmanHostService from "Common/Server/Services/PodmanHostService";
import ServiceService from "Common/Server/Services/ServiceService";
import ProjectScopedReferenceValidator from "Common/Server/Utils/Database/ProjectScopedReferenceValidator";
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenance/ScheduleRecurringEvents";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB_NAME: string = "ScheduledMaintenance:ScheduleRecurringEvents";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function stub<T extends { _id?: string | undefined }>(
  ctor: { new (): T },
  id: string,
): T {
  const model: T = new ctor();
  model._id = id;
  return model;
}

/*
 * A template that is due now and names one resource of every type the
 * template model supports.
 */
function recurringTemplate(): ScheduledMaintenanceTemplate {
  const template: ScheduledMaintenanceTemplate =
    new ScheduledMaintenanceTemplate();

  template._id = "template-1";
  template.projectId = PROJECT_ID;
  template.title = "Quarterly database failover drill";
  template.description = "Failing over the primary.";
  template.isRecurringEvent = true;
  template.labels = [];
  template.statusPages = [];

  template.monitors = [stub(Monitor, "monitor-1")];
  template.hosts = [stub(Host, "host-1")];
  template.kubernetesClusters = [stub(KubernetesCluster, "k8s-1")];
  template.dockerHosts = [stub(DockerHost, "docker-1")];
  template.podmanHosts = [stub(PodmanHost, "podman-1")];
  template.services = [stub(Service, "service-1")];

  const now: Date = OneUptimeDate.getCurrentDate();

  template.firstEventScheduledAt = OneUptimeDate.addRemoveDays(now, -30);
  template.firstEventStartsAt = OneUptimeDate.addRemoveDays(now, -30);
  template.firstEventEndsAt = OneUptimeDate.addRemoveHours(
    OneUptimeDate.addRemoveDays(now, -30),
    2,
  );
  template.scheduleNextEventAt = now;

  const recurring: Recurring = new Recurring();
  template.recurringInterval = recurring;

  return template;
}

function idsOn(
  relation: Array<{ _id?: string | undefined }> | undefined,
): Array<string> {
  return (relation || []).map((item: { _id?: string | undefined }): string => {
    return String(item._id);
  });
}

describe("ScheduledMaintenance:ScheduleRecurringEvents", () => {
  let created: Array<ScheduledMaintenance> = [];

  beforeEach(() => {
    jest.clearAllMocks();
    created = [];

    (
      ScheduledMaintenanceTemplateService.findAllBy as jest.Mock
    ).mockResolvedValue([recurringTemplate()] as never);

    (
      ScheduledMaintenanceTemplateService.updateOneById as jest.Mock
    ).mockResolvedValue(undefined as never);

    (
      ScheduledMaintenanceTemplateService.getNextEventTime as jest.Mock
    ).mockReturnValue(
      OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), 1),
    );

    (ScheduledMaintenanceService.create as jest.Mock).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (args: any): Promise<ScheduledMaintenance> => {
        const model: ScheduledMaintenance = args.data as ScheduledMaintenance;
        model._id = `sm-${created.length + 1}`;
        created.push(model);
        return model;
      },
    );

    (
      ScheduledMaintenanceTemplateOwnerUserService.findAllBy as jest.Mock
    ).mockResolvedValue([] as never);

    (
      ScheduledMaintenanceTemplateOwnerTeamService.findAllBy as jest.Mock
    ).mockResolvedValue([] as never);

    // Every record belongs to the template's project unless a test says not.
    (
      ProjectScopedReferenceValidator.filterUsableInProject as jest.Mock
    ).mockImplementation((async (data: { ids: Array<string> }) => {
      return { usableIds: data.ids, droppedIds: [] };
    }) as never);

    // Every template owner is still a project member unless a test says not.
    (TeamMemberService.isUserMemberOfProject as jest.Mock).mockResolvedValue(
      true as never,
    );
  });

  test("carries every affected resource from the template onto the recurrence", async () => {
    await mockCapturedJobs[JOB_NAME]!();

    expect(created).toHaveLength(1);

    const event: ScheduledMaintenance = created[0]!;

    expect(idsOn(event.monitors)).toEqual(["monitor-1"]);
    expect(idsOn(event.hosts)).toEqual(["host-1"]);
    expect(idsOn(event.kubernetesClusters)).toEqual(["k8s-1"]);
    expect(idsOn(event.dockerHosts)).toEqual(["docker-1"]);
    expect(idsOn(event.podmanHosts)).toEqual(["podman-1"]);
    expect(idsOn(event.services)).toEqual(["service-1"]);
  });

  test("selects every affected-resource relation it copies", async () => {
    /*
     * The copy is only as good as the select: an unselected relation
     * arrives undefined and the assignment silently writes nothing.
     * This is the half of the bug that was invisible at the call site.
     */
    await mockCapturedJobs[JOB_NAME]!();

    /*
     * The job swallows every per-template error into logger.error, so
     * without this the assertions below would still pass if the whole
     * body threw before creating anything.
     */
    expect(created).toHaveLength(1);

    const findAllByArgs: {
      select: Record<string, boolean>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } = (ScheduledMaintenanceTemplateService.findAllBy as jest.Mock).mock
      .calls[0]![0] as { select: Record<string, boolean> };

    for (const relation of [
      "monitors",
      "hosts",
      "kubernetesClusters",
      "dockerHosts",
      "podmanHosts",
      "services",
    ]) {
      expect(findAllByArgs.select[relation]).toBe(true);
    }
  });

  test("copies an empty resource set without inventing one", async () => {
    const template: ScheduledMaintenanceTemplate = recurringTemplate();
    template.hosts = [];
    template.services = [];

    (
      ScheduledMaintenanceTemplateService.findAllBy as jest.Mock
    ).mockResolvedValue([template] as never);

    await mockCapturedJobs[JOB_NAME]!();

    expect(idsOn(created[0]!.hosts)).toEqual([]);
    expect(idsOn(created[0]!.services)).toEqual([]);
    expect(idsOn(created[0]!.monitors)).toEqual(["monitor-1"]);
  });

  describe("references the template's project cannot use", () => {
    /*
     * ScheduledMaintenanceService refuses another project's monitor, label,
     * status page or affected resource. Templates did not always have those
     * lists checked, so an old one can still hold such an id — and a refused
     * create here would skip the event on every recurrence, because
     * scheduleNextEventAt has already moved on.
     */
    function templateWithLists(): ScheduledMaintenanceTemplate {
      const template: ScheduledMaintenanceTemplate = recurringTemplate();
      template.monitors = [
        stub(Monitor, "monitor-1"),
        stub(Monitor, "foreign-monitor"),
      ];
      template.hosts = [stub(Host, "host-1"), stub(Host, "foreign-host")];
      template.kubernetesClusters = [
        stub(KubernetesCluster, "k8s-1"),
        stub(KubernetesCluster, "foreign-k8s"),
      ];
      template.dockerHosts = [
        stub(DockerHost, "docker-1"),
        stub(DockerHost, "foreign-docker"),
      ];
      template.podmanHosts = [
        stub(PodmanHost, "podman-1"),
        stub(PodmanHost, "foreign-podman"),
      ];
      template.services = [
        stub(Service, "service-1"),
        stub(Service, "foreign-service"),
      ];
      template.labels = [stub(Label, "label-1"), stub(Label, "foreign-label")];
      template.statusPages = [
        stub(StatusPage, "status-page-1"),
        stub(StatusPage, "foreign-status-page"),
      ];
      return template;
    }

    beforeEach(() => {
      (
        ScheduledMaintenanceTemplateService.findAllBy as jest.Mock
      ).mockResolvedValue([templateWithLists()] as never);

      (
        ProjectScopedReferenceValidator.filterUsableInProject as jest.Mock
      ).mockImplementation((async (data: { ids: Array<string> }) => {
        return {
          usableIds: data.ids.filter((id: string) => {
            return !id.startsWith("foreign-");
          }),
          droppedIds: data.ids.filter((id: string) => {
            return id.startsWith("foreign-");
          }),
        };
      }) as never);
    });

    test("creates the event with only the records the project can use", async () => {
      await mockCapturedJobs[JOB_NAME]!();

      expect(created).toHaveLength(1);
      expect(idsOn(created[0]!.monitors)).toEqual(["monitor-1"]);
      expect(idsOn(created[0]!.hosts)).toEqual(["host-1"]);
      expect(idsOn(created[0]!.kubernetesClusters)).toEqual(["k8s-1"]);
      expect(idsOn(created[0]!.dockerHosts)).toEqual(["docker-1"]);
      expect(idsOn(created[0]!.podmanHosts)).toEqual(["podman-1"]);
      expect(idsOn(created[0]!.services)).toEqual(["service-1"]);
      expect(idsOn(created[0]!.labels)).toEqual(["label-1"]);
      expect(idsOn(created[0]!.statusPages)).toEqual(["status-page-1"]);
    });

    test("checks each list against its own model and the template's project", async () => {
      await mockCapturedJobs[JOB_NAME]!();

      const calls: Array<{
        projectId: ObjectID;
        ids: Array<string>;
        service: unknown;
      }> = (
        ProjectScopedReferenceValidator.filterUsableInProject as jest.Mock
      ).mock.calls.map((call: Array<unknown>) => {
        return call[0] as {
          projectId: ObjectID;
          ids: Array<string>;
          service: unknown;
        };
      });

      expect(
        calls.map((call: { ids: Array<string>; service: unknown }) => {
          return { ids: call.ids, service: call.service };
        }),
      ).toEqual([
        { ids: ["monitor-1", "foreign-monitor"], service: MonitorService },
        { ids: ["host-1", "foreign-host"], service: HostService },
        {
          ids: ["k8s-1", "foreign-k8s"],
          service: KubernetesClusterService,
        },
        { ids: ["docker-1", "foreign-docker"], service: DockerHostService },
        { ids: ["podman-1", "foreign-podman"], service: PodmanHostService },
        { ids: ["service-1", "foreign-service"], service: ServiceService },
        {
          ids: ["status-page-1", "foreign-status-page"],
          service: StatusPageService,
        },
        { ids: ["label-1", "foreign-label"], service: LabelService },
      ]);

      for (const call of calls) {
        expect(call.projectId).toBe(PROJECT_ID);
      }
    });

    test("logs what it dropped", async () => {
      await mockCapturedJobs[JOB_NAME]!();

      const logged: string = JSON.stringify(
        (logger.error as jest.Mock).mock.calls,
      );

      expect(logged).toContain("monitor foreign-monitor");
      expect(logged).toContain("host foreign-host");
      expect(logged).toContain("Kubernetes cluster foreign-k8s");
      expect(logged).toContain("Docker host foreign-docker");
      expect(logged).toContain("Podman host foreign-podman");
      expect(logged).toContain("service foreign-service");
      expect(logged).toContain("label foreign-label");
      expect(logged).toContain("status page foreign-status-page");
    });

    test("an unusable id costs the event nothing else", async () => {
      // The event is still created, not skipped, and nothing is logged as a failure of the job.
      await mockCapturedJobs[JOB_NAME]!();

      expect(ScheduledMaintenanceService.create).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify((logger.error as jest.Mock).mock.calls),
      ).not.toContain("Error creating event for template");
    });

    test("does not look up an empty list", async () => {
      const template: ScheduledMaintenanceTemplate = recurringTemplate();
      template.labels = [];
      template.statusPages = [];

      (
        ScheduledMaintenanceTemplateService.findAllBy as jest.Mock
      ).mockResolvedValue([template] as never);

      await mockCapturedJobs[JOB_NAME]!();

      const services: Array<unknown> = (
        ProjectScopedReferenceValidator.filterUsableInProject as jest.Mock
      ).mock.calls.map((call: Array<unknown>) => {
        return (call[0] as { service: unknown }).service;
      });

      expect(services).not.toContain(LabelService);
      expect(services).not.toContain(StatusPageService);
      expect(idsOn(created[0]!.labels)).toEqual([]);
      expect(idsOn(created[0]!.statusPages)).toEqual([]);
    });
  });

  describe("owners (issue #3394)", () => {
    const USER_A: ObjectID = new ObjectID(
      "0000000e-0000-4000-8000-00000000000a",
    );
    const USER_B: ObjectID = new ObjectID(
      "0000000e-0000-4000-8000-00000000000b",
    );
    const TEAM_A: ObjectID = new ObjectID(
      "0000000b-0000-4000-8000-00000000000a",
    );

    beforeEach(() => {
      (
        ScheduledMaintenanceTemplateOwnerUserService.findAllBy as jest.Mock
      ).mockResolvedValue([{ userId: USER_A }, { userId: USER_B }] as never);
      (
        ScheduledMaintenanceTemplateOwnerTeamService.findAllBy as jest.Mock
      ).mockResolvedValue([{ teamId: TEAM_A }] as never);
      (
        ScheduledMaintenanceOwnerTeamService.create as jest.Mock
      ).mockResolvedValue({} as never);
    });

    function userIdsWritten(): Array<string> {
      return (
        ScheduledMaintenanceOwnerUserService.create as jest.Mock
      ).mock.calls.map((call: Array<unknown>): string => {
        return String(
          (call[0] as { data: ScheduledMaintenanceOwnerUser }).data.userId,
        );
      });
    }

    test("copies the template's owners onto the new event", async () => {
      (
        ScheduledMaintenanceOwnerUserService.create as jest.Mock
      ).mockResolvedValue({} as never);

      await mockCapturedJobs[JOB_NAME]!();

      expect(userIdsWritten()).toEqual([USER_A.toString(), USER_B.toString()]);

      const teamRow: ScheduledMaintenanceOwnerTeam = (
        (ScheduledMaintenanceOwnerTeamService.create as jest.Mock).mock
          .calls[0]![0] as { data: ScheduledMaintenanceOwnerTeam }
      ).data;
      expect(String(teamRow.teamId)).toBe(TEAM_A.toString());
      expect(String(teamRow.scheduledMaintenanceId)).toBe("sm-1");
    });

    test("an owner the event already has does not cost it the remaining owners", async () => {
      /*
       * Creating the event runs its owner rules, which can add one of the
       * template's owners first. Owner rows are unique now, so copying that
       * owner is refused - and must not abort the copy of everyone after.
       */
      (
        ScheduledMaintenanceOwnerUserService.create as jest.Mock
      ).mockImplementation((async (args: {
        data: ScheduledMaintenanceOwnerUser;
      }) => {
        if (String(args.data.userId) === USER_A.toString()) {
          throw PostgresErrorTranslator.createUniqueViolationException(
            "This user is already an owner of this scheduled maintenance event.",
          );
        }
        return args.data;
      }) as never);

      await mockCapturedJobs[JOB_NAME]!();

      expect(userIdsWritten()).toEqual([USER_A.toString(), USER_B.toString()]);
      expect(ScheduledMaintenanceOwnerTeamService.create).toHaveBeenCalledTimes(
        1,
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    test("a template owner who has left the project is not copied onto the new event", async () => {
      /*
       * The template's owner list is saved configuration and can still name
       * a user removed from the project since. The recurrence must not make
       * them an owner of new work - and must still copy everyone else.
       */
      (
        ScheduledMaintenanceOwnerUserService.create as jest.Mock
      ).mockResolvedValue({} as never);
      (TeamMemberService.isUserMemberOfProject as jest.Mock).mockImplementation(
        (async (data: { userId: ObjectID }) => {
          return data.userId.toString() !== USER_A.toString();
        }) as never,
      );

      await mockCapturedJobs[JOB_NAME]!();

      expect(userIdsWritten()).toEqual([USER_B.toString()]);
      expect(ScheduledMaintenanceOwnerTeamService.create).toHaveBeenCalledTimes(
        1,
      );
      expect(logger.error).not.toHaveBeenCalled();

      const checked: Array<{ projectId: ObjectID; userId: ObjectID }> = (
        TeamMemberService.isUserMemberOfProject as jest.Mock
      ).mock.calls.map((call: Array<unknown>) => {
        return call[0] as { projectId: ObjectID; userId: ObjectID };
      });

      expect(
        checked.map((call: { projectId: ObjectID; userId: ObjectID }) => {
          return {
            projectId: call.projectId.toString(),
            userId: call.userId.toString(),
          };
        }),
      ).toEqual([
        { projectId: PROJECT_ID.toString(), userId: USER_A.toString() },
        { projectId: PROJECT_ID.toString(), userId: USER_B.toString() },
      ]);
    });

    test("any other owner failure is still reported", async () => {
      (
        ScheduledMaintenanceOwnerUserService.create as jest.Mock
      ).mockRejectedValue(new Error("connection reset") as never);

      await mockCapturedJobs[JOB_NAME]!();

      expect(logger.error).toHaveBeenCalled();
    });
  });
});

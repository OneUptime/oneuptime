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

import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceTemplateService from "Common/Server/Services/ScheduledMaintenanceTemplateService";
import ScheduledMaintenanceTemplateOwnerUserService from "Common/Server/Services/ScheduledMaintenanceTemplateOwnerUserService";
import ScheduledMaintenanceTemplateOwnerTeamService from "Common/Server/Services/ScheduledMaintenanceTemplateOwnerTeamService";
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
});

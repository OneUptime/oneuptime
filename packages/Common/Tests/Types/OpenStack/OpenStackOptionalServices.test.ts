import {
  OPENSTACK_API_UP_METRIC_NAMES,
  OPENSTACK_SERVICES_EVERY_CLOUD_RUNS,
} from "../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import {
  OPENSTACK_API_UP_METRIC_BY_SERVICE,
  OpenStackAlertTemplate,
  getAllOpenStackAlertTemplates,
  getOpenStackAlertTemplatesForCloud,
} from "../../../Types/Monitor/OpenStackAlertTemplates";
import {
  OPENSTACK_EMPTY_ANSWER_SINCE_FACT,
  OPENSTACK_OPTIONAL_SERVICES,
  OPENSTACK_OPTIONAL_SERVICE_LEFT_MINUTES,
  OpenStackOptionalService,
  getOpenStackEmptyAnswerSince,
  getOpenStackOptionalServicesOf,
  hasOpenStackOptionalServiceLeft,
  isOpenStackOptionalService,
} from "../../../Types/OpenStack/OpenStackOptionalServices";
import {
  OPENSTACK_KINDS_BY_SERVICE,
  OPENSTACK_SERVICE_TITLES,
  OpenStackServiceType,
} from "../../../Types/OpenStack/OpenStackResourceKind";

/*
 * What every service a cloud may not run gets from one place, so a new one can't leave a piece out.
 * The scan and the server hold their own ends of this: OpenStackSnapshotScan.test.ts and
 * OpenStackOptionalServicesPostgres.test.ts.
 */

const CORE: Array<string> = Array.from(OPENSTACK_SERVICES_EVERY_CLOUD_RUNS);
const AT: Date = new Date("2026-11-05T12:00:00.000Z");

function minutesLater(minutes: number): Date {
  return new Date(AT.getTime() + minutes * 60 * 1000);
}

describe("every service is one a cloud always runs, or one it may not", () => {
  test.each(Object.values(OpenStackServiceType))("%s is one or the other", (
    service: OpenStackServiceType,
  ) => {
    expect(
      CORE.includes(service) !== isOpenStackOptionalService(service),
    ).toBe(true);
  });

  test("the core six are nothing else", () => {
    expect(CORE.sort()).toEqual(
      ["compute", "identity", "image", "network", "placement", "volume"].sort(),
    );
  });
});

describe.each(
  OPENSTACK_OPTIONAL_SERVICES.map(
    (entry: OpenStackOptionalService): [string, OpenStackOptionalService] => {
      return [entry.service, entry];
    },
  ),
)("%s", (_service: string, entry: OpenStackOptionalService) => {
  test("its API's series starts its rows, and the monitors read the same one", () => {
    expect(OPENSTACK_API_UP_METRIC_NAMES.get(entry.upMetricName)).toBe(
      entry.service,
    );
    expect(OPENSTACK_API_UP_METRIC_BY_SERVICE[entry.service]).toBe(
      entry.upMetricName,
    );
  });

  test("it has a title, and rows of its own for its API to vouch for", () => {
    expect(OPENSTACK_SERVICE_TITLES[entry.service]).toBeTruthy();
    expect(OPENSTACK_KINDS_BY_SERVICE[entry.service].length).toBeGreaterThan(0);
  });

  test("its templates say they need it, so a cloud without it isn't offered them", () => {
    const templates: Array<OpenStackAlertTemplate> =
      getAllOpenStackAlertTemplates().filter(
        (template: OpenStackAlertTemplate): boolean => {
          return template.forService === entry.service;
        },
      );
    expect(templates.length).toBeGreaterThan(0);

    const offeredToNone: Array<string> = getOpenStackAlertTemplatesForCloud({
      services: [],
      isCollectedByProbe: true,
    }).map((template: OpenStackAlertTemplate): string => {
      return template.id;
    });
    for (const template of templates) {
      expect(offeredToNone).not.toContain(template.id);
    }
  });
});

describe("what a check from outside reports", () => {
  function offered(cloud: {
    isApiCheckOn?: boolean;
    isLifecycleCheckOn?: boolean;
  }): Array<string> {
    return getOpenStackAlertTemplatesForCloud(cloud)
      .filter((template: OpenStackAlertTemplate): boolean => {
        return Boolean(template.requiresCheck);
      })
      .map((template: OpenStackAlertTemplate): string => {
        return template.id;
      });
  }

  test("is offered only where that check is on, because nothing else sends its series", () => {
    expect(offered({})).toEqual([]);
    expect(offered({ isApiCheckOn: true })).toEqual([
      "openstack-token-issue-failing",
      "openstack-service-api-check-failing",
      "openstack-public-certificate-expiring-30-days",
      "openstack-public-certificate-expiring-7-days",
    ]);
    expect(offered({ isLifecycleCheckOn: true })).toEqual([
      "openstack-instance-boot-failing",
      "openstack-instance-boot-slow",
      "openstack-volume-attach-failing",
      "openstack-floating-ip-unreachable",
    ]);
  });
});

describe("what a cloud is offered", () => {
  const idsFor: (cloud: {
    services?: ReadonlyArray<string> | null | undefined;
    isCollectedByProbe?: boolean | null | undefined;
    isApiCheckOn?: boolean | undefined;
    isLifecycleCheckOn?: boolean | undefined;
  }) => Array<string> = (cloud: {
    services?: ReadonlyArray<string> | null | undefined;
    isCollectedByProbe?: boolean | null | undefined;
    isApiCheckOn?: boolean | undefined;
    isLifecycleCheckOn?: boolean | undefined;
  }): Array<string> => {
    return getOpenStackAlertTemplatesForCloud(cloud).map(
      (template: OpenStackAlertTemplate): string => {
        return template.id;
      },
    );
  };

  test("a cloud with neither is offered nothing of either", () => {
    const ids: Array<string> = idsFor({ services: [] });
    expect(ids.join(" ")).not.toMatch(
      /openstack-stack|container|orchestration|heat|magnum/i,
    );
    expect(ids).toContain("openstack-compute-api-down");
  });

  test("knowing nothing about a cloud offers what every cloud has, and no more", () => {
    expect(idsFor({})).toEqual(idsFor({ services: [] }));
    expect(idsFor({ services: null })).toEqual(idsFor({ services: [] }));
  });

  test("a cloud running Heat is offered Heat's, and none of Magnum's", () => {
    const ids: Array<string> = idsFor({
      services: [OpenStackServiceType.Orchestration],
    });
    expect(ids).toEqual(
      expect.arrayContaining([
        "openstack-orchestration-api-down",
        "openstack-stack-failed",
        "openstack-stack-stuck",
      ]),
    );
    expect(ids).not.toContain("openstack-container-cluster-failed");
    expect(ids).not.toContain("openstack-container-infra-api-down");
  });

  test("a template over a series only a probe sends waits for a cloud a probe collects", () => {
    const services: Array<string> = [
      OpenStackServiceType.Orchestration,
      OpenStackServiceType.ContainerInfra,
    ];
    for (const id of [
      "openstack-orchestration-engine-down",
      "openstack-container-infra-conductor-down",
    ]) {
      expect(idsFor({ services, isCollectedByProbe: false })).not.toContain(id);
      expect(idsFor({ services })).not.toContain(id);
      expect(idsFor({ services, isCollectedByProbe: true })).toContain(id);
      // And a probe of a cloud without the service has nothing to read either.
      expect(idsFor({ services: [], isCollectedByProbe: true })).not.toContain(
        id,
      );
    }
  });

  test("every template is offered to a cloud that runs everything through a probe", () => {
    expect(
      idsFor({
        services: Object.values(OpenStackServiceType),
        isCollectedByProbe: true,
        isApiCheckOn: true,
        isLifecycleCheckOn: true,
      }).length,
    ).toBe(getAllOpenStackAlertTemplates().length);
  });
});

describe("what a cloud runs, from its API rows", () => {
  test("the optional ones its rows name, and only those", () => {
    expect(
      getOpenStackOptionalServicesOf([
        "compute",
        "orchestration",
        null,
        undefined,
        "load-balancer-it-has-never-heard-of",
      ]),
    ).toEqual([OpenStackServiceType.Orchestration]);
    expect(getOpenStackOptionalServicesOf([])).toEqual([]);
  });
});

/*
 * An empty answer is what a service that left the catalog gives, and also what every service gives
 * while Keystone can't be logged in to. Only the second clause tells them apart.
 */
describe("when a service has left the cloud", () => {
  const left: (data: {
    emptySince: Date | null;
    coreAnsweredAt: Date | null;
    windowInMinutes?: number;
  }) => boolean = (data: {
    emptySince: Date | null;
    coreAnsweredAt: Date | null;
    windowInMinutes?: number;
  }): boolean => {
    return hasOpenStackOptionalServiceLeft({
      emptySince: data.emptySince,
      coreAnsweredAt: data.coreAnsweredAt,
      windowInMinutes: data.windowInMinutes ?? 15,
    });
  };

  test.each([
    {
      why: "never read empty",
      emptySince: null,
      coreAnsweredAt: minutesLater(100),
      expected: false,
    },
    {
      why: "no core service has ever answered",
      emptySince: AT,
      coreAnsweredAt: null,
      expected: false,
    },
    {
      why: "Keystone went at the same moment: nothing has answered since",
      emptySince: AT,
      coreAnsweredAt: minutesLater(-1),
      expected: false,
    },
    {
      why: "the rest of the cloud has answered for less than the wait",
      emptySince: AT,
      coreAnsweredAt: minutesLater(14),
      expected: false,
    },
    {
      why: "the rest of the cloud has answered for the whole wait",
      emptySince: AT,
      coreAnsweredAt: minutesLater(15),
      expected: true,
    },
    {
      why: "and long past it",
      emptySince: AT,
      coreAnsweredAt: minutesLater(600),
      expected: true,
    },
  ])("$why: $expected", (row: {
    emptySince: Date | null;
    coreAnsweredAt: Date | null;
    expected: boolean;
  }) => {
    expect(
      left({ emptySince: row.emptySince, coreAnsweredAt: row.coreAnsweredAt }),
    ).toBe(row.expected);
  });

  test("a stale window set short never takes fewer than three of its collections", () => {
    expect(OPENSTACK_OPTIONAL_SERVICE_LEFT_MINUTES).toBe(15);
    expect(
      left({
        emptySince: AT,
        coreAnsweredAt: minutesLater(5),
        windowInMinutes: 5,
      }),
    ).toBe(false);
  });

  test("a stale window set long waits that much longer", () => {
    expect(
      left({
        emptySince: AT,
        coreAnsweredAt: minutesLater(30),
        windowInMinutes: 60,
      }),
    ).toBe(false);
    expect(
      left({
        emptySince: AT,
        coreAnsweredAt: minutesLater(60),
        windowInMinutes: 60,
      }),
    ).toBe(true);
  });
});

describe("when an empty answer started, from a row's facts", () => {
  test("reads what the server wrote", () => {
    expect(
      getOpenStackEmptyAnswerSince({
        [OPENSTACK_EMPTY_ANSWER_SINCE_FACT]: AT.toISOString(),
      })?.getTime(),
    ).toBe(AT.getTime());
  });

  test.each([
    ["no facts", null],
    ["no such fact", {}],
    ["one set to null, as a good answer leaves it", { emptyAnswerSince: null }],
    ["one that is no date", { emptyAnswerSince: "yesterday-ish" }],
    ["one that is no text", { emptyAnswerSince: 12 }],
  ])("%s says never", (_why: string, facts: unknown) => {
    expect(getOpenStackEmptyAnswerSince(facts as never)).toBeNull();
  });
});

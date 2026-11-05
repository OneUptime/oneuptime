import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import { OpenStackResourceBufferEntry } from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  OPENSTACK_SHARE_STUCK_MINUTES,
  isOpenStackShareInError,
  isOpenStackShareStuck,
} from "../../../../Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_SERVICE_STATUS_STOPPED,
  OPENSTACK_SHARE_ERROR_STATUSES,
  OPENSTACK_SHARE_TRANSITIONAL_STATUSES,
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  RECORDED_AT,
  RecordedServiceScene,
  factsOfRow,
  namesOfRows,
  scanRecordedOtlp,
} from "../../../Helpers/OpenStackServiceRecording";
import {
  OpenStackTemplateReading,
  isAnythingFiring,
  namesFiredBy,
  readOpenStackTemplateOnRecording,
} from "../../../Types/Monitor/Utils/OpenStackTemplateOnRecording";
import {
  assessOpenStackResource,
  assessOpenStackService,
  getOpenStackAttentionItems,
  getOpenStackHealth,
} from "../../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";

/*
 * MANILA, ON WHAT A REAL CLOUD SAID.
 *
 * Tests/Ops/openstack-e2e/services-manila.sh ran Manila on a real stable/2026.1 DevStack with the
 * dummy driver: its API, scheduler and share manager are real, only the backends are not. All eight
 * of its scenes are in Tests/Fixtures/OpenStack/services-manila, each what the agent's exporter
 * answered once Manila had got there by itself.
 */

const GROUP: string = "services-manila";

function scene(name: string): RecordedServiceScene {
  return new RecordedServiceScene({ group: GROUP, scene: name });
}

function shares(recorded: RecordedServiceScene): Array<OpenStackResource> {
  return recorded.ofKind(OpenStackResourceKind.Share);
}

function share(
  recorded: RecordedServiceScene,
  name: string,
): OpenStackResource {
  return recorded.named(OpenStackResourceKind.Share, name);
}

function severityOf(
  row: OpenStackResource,
  now: Date = RECORDED_AT,
): ResourceAttentionSeverity | null {
  return assessOpenStackResource({ row, now }).severity;
}

function minutesAfter(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60000);
}

describe("every scene with Manila answering", () => {
  test.each([
    ["baseline", 2],
    ["share-error", 3],
    ["share-stuck", 4],
    ["share-service-stopped", 4],
    ["share-service-killed", 4],
    ["scheduler-stopped", 4],
    ["recovered", 4],
  ])("%s holds %i shares, and its API reads up", (name: string, count: number) => {
    const recorded: RecordedServiceScene = scene(name);

    expect(shares(recorded)).toHaveLength(count);
    expect(
      recorded.seriesNamed("openstack_sharev2_shares_counter")[0]?.value,
    ).toBe(count);
    expect(recorded.api(OpenStackServiceType.SharedFileSystems)?.status).toBe(
      "up",
    );
  });

  test.each([
    "share-error",
    "share-stuck",
    "share-service-stopped",
    "share-service-killed",
    "scheduler-stopped",
    "recovered",
  ])(
    "%s: every share has one row, however many series speak of it",
    (name: string) => {
      const recorded: RecordedServiceScene = scene(name);
      const ids: Array<string | undefined> = shares(recorded).map(
        (row: OpenStackResource): string | undefined => {
          return row.externalId;
        },
      );

      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.sort()).toEqual(
        Array.from(
          new Set(
            recorded
              .seriesNamed("openstack_sharev2_share_status")
              .map((series: { labels: Record<string, string> }): string => {
                return series.labels["id"] as string;
              }),
          ),
        ).sort(),
      );
    },
  );

  test("nothing about a service is on a share's series, so the agent can't say one stopped", () => {
    const stopped: RecordedServiceScene = scene("share-service-stopped");

    expect(stopped.ofKind(OpenStackResourceKind.Service)).toEqual([]);
    expect(
      stopped.series.filter((series: { name: string }): boolean => {
        return series.name.includes("agent") || series.name.includes("service");
      }),
    ).toEqual([]);
  });
});

describe("baseline: shares available, in two projects", () => {
  const recorded: RecordedServiceScene = scene("baseline");

  test("a share reads as Manila said it, whose it is included", () => {
    const row: OpenStackResource = share(recorded, "ou-share-payments");
    const other: OpenStackResource = share(recorded, "ou-share-admin");

    expect(row.status).toBe("available");
    expect(row.availabilityZone).toBe("manila-zone-0");
    expect(row.regionName).toBe("RegionOne");
    expect(row.diskCapacityBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(factsOfRow(row)["shareProtocol"]).toBe("NFS");
    // share_type_name is empty, because the exporter asks for no microversion. This is the name.
    expect(factsOfRow(row)["shareType"]).toBe("ou-alpha");

    expect(row.openStackProjectId).toBeTruthy();
    expect(other.openStackProjectId).toBeTruthy();
    expect(row.openStackProjectId).not.toBe(other.openStackProjectId);
  });

  test("the same project and size the API says, which is where the exporter got them", () => {
    const answer: JSONObject = recorded.readApi("manila-shares-versioned");

    for (const item of answer["shares"] as JSONArray) {
      const said: JSONObject = item as JSONObject;
      const row: OpenStackResource = share(recorded, said["name"] as string);

      expect(row.externalId).toBe(said["id"]);
      expect(row.openStackProjectId).toBe(said["project_id"]);
      expect(row.diskCapacityBytes).toBe(
        (said["size"] as number) * 1024 * 1024 * 1024,
      );
      expect(said["share_type_name"]).toBe("ou-alpha");
    }
  });

  test("what only a probe says stays unsaid on the agent's rows, rather than left behind", () => {
    const facts: JSONObject = factsOfRow(share(recorded, "ou-share-admin"));

    expect(facts).toHaveProperty("accessRulesStatus", null);
    expect(facts).toHaveProperty("backendHost", null);
  });

  test("needs nobody", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: recorded.rows,
      now: RECORDED_AT,
    });

    expect(items).toEqual([]);
    expect(getOpenStackHealth(items)).toBe("Healthy");
  });
});

describe("share-error: no backend could take it", () => {
  const recorded: RecordedServiceScene = scene("share-error");
  const row: OpenStackResource = share(recorded, "ou-share-error");

  test("reads Manila's word, with no zone, because nothing ever placed it", () => {
    expect(row.status).toBe("error");
    expect(row.availabilityZone).toBeUndefined();
    expect(factsOfRow(row)["shareType"]).toBe("ou-nowhere");
    expect(isOpenStackShareInError(row.status)).toBe(true);
  });

  test("reaches Needs attention by name, and only it does", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: recorded.rows,
      now: RECORDED_AT,
    });

    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual(["ou-share-error"]);
    expect(items[0]?.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(items[0]?.reasons[0]?.values).toEqual({ status: "error" });
  });

  test("however long ago it happened, because nothing moves it on", () => {
    expect(severityOf(row, minutesAfter(RECORDED_AT, 60 * 24 * 30))).toBe(
      ResourceAttentionSeverity.Warning,
    );
  });

  test("Share in Error fires on it, and on nothing else in the scene", async () => {
    const readings: Array<OpenStackTemplateReading> =
      await readOpenStackTemplateOnRecording({
        templateId: "openstack-share-in-error",
        series: recorded.series,
      });

    expect(namesFiredBy(readings)).toEqual(["ou-share-error"]);
  });

  test("and has nothing to fire on before, or once the share has gone", async () => {
    for (const name of ["baseline"]) {
      expect(
        isAnythingFiring(
          await readOpenStackTemplateOnRecording({
            templateId: "openstack-share-in-error",
            series: scene(name).series,
          }),
        ),
      ).toBe(false);
    }
    // Every share deleted: the word's series goes with it, and that is how this recovers.
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-share-in-error",
          series: recorded.series.filter(
            (series: { labels: Record<string, string> }): boolean => {
              return series.labels["name"] !== "ou-share-error";
            },
          ),
        }),
      ),
    ).toBe(false);
  });
});

describe("share-stuck: a backend that does not finish", () => {
  const recorded: RecordedServiceScene = scene("share-stuck");
  const row: OpenStackResource = share(recorded, "ou-share-stuck");

  test("reads creating, with the zone its backend is in", () => {
    expect(row.status).toBe("creating");
    expect(row.availabilityZone).toBe("manila-zone-1");
    expect(OPENSTACK_SHARE_TRANSITIONAL_STATUSES.has("creating")).toBe(true);
  });

  test("the status series' value is a code, and creating's is 0, so a template can't read it", () => {
    const status: { value: number } | undefined = recorded
      .seriesNamed("openstack_sharev2_share_status")
      .find((series: { labels: Record<string, string> }): boolean => {
        return series.labels["name"] === "ou-share-stuck";
      });
    const size: { value: number } | undefined = recorded
      .seriesNamed("openstack_sharev2_share_gb")
      .find((series: { labels: Record<string, string> }): boolean => {
        return series.labels["name"] === "ou-share-stuck";
      });

    expect(status?.value).toBe(0);
    expect(size?.value).toBe(1);
  });

  test("is on its way for an hour, recorded taking 50 minutes on purpose, and stuck after", () => {
    expect(severityOf(row, minutesAfter(RECORDED_AT, 50))).toBe(null);
    expect(
      isOpenStackShareStuck({
        status: row.status,
        stateChangedAt: row.stateChangedAt,
        now: minutesAfter(RECORDED_AT, OPENSTACK_SHARE_STUCK_MINUTES - 1),
      }),
    ).toBe(false);
    expect(
      severityOf(row, minutesAfter(RECORDED_AT, OPENSTACK_SHARE_STUCK_MINUTES)),
    ).toBe(ResourceAttentionSeverity.Warning);
  });

  test("Share Stuck reads it, and every word it reads is one a share's size is on", async () => {
    const readings: Array<OpenStackTemplateReading> =
      await readOpenStackTemplateOnRecording({
        templateId: "openstack-share-stuck",
        series: recorded.series,
      });

    expect(namesFiredBy(readings)).toEqual(["ou-share-stuck"]);
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-share-stuck",
          series: scene("baseline").series,
        }),
      ),
    ).toBe(false);
  });
});

describe("api-down: Manila's API stopped", () => {
  const recorded: RecordedServiceScene = scene("api-down");

  test("the exporter does say so, unlike Ironic's and Designate's", () => {
    expect(
      recorded.seriesNamed("openstack_sharev2_up")[0]?.value,
    ).toBe(0);
    expect(recorded.api(OpenStackServiceType.SharedFileSystems)?.status).toBe(
      "down",
    );
  });

  test("and says nothing of its shares, so their rows stay what they were", () => {
    expect(shares(recorded)).toEqual([]);
    expect(recorded.series).toHaveLength(1);
  });

  test("Shared File Systems API Down fires on it, and recovers on the scene after", async () => {
    const down: Array<OpenStackTemplateReading> =
      await readOpenStackTemplateOnRecording({
        templateId: "openstack-shared-file-systems-api-down",
        series: recorded.series,
      });
    const back: Array<OpenStackTemplateReading> =
      await readOpenStackTemplateOnRecording({
        templateId: "openstack-shared-file-systems-api-down",
        series: scene("recovered").series,
      });

    expect(isAnythingFiring(down)).toBe(true);
    expect(isAnythingFiring(back)).toBe(false);
    expect(
      back.every((reading: OpenStackTemplateReading): boolean => {
        return reading.healthy;
      }),
    ).toBe(true);
  });
});

describe("recovered: everything started again", () => {
  const recorded: RecordedServiceScene = scene("recovered");

  test("the share in error stays in error, and the stuck one is what it was", () => {
    expect(share(recorded, "ou-share-error").status).toBe("error");
    expect(share(recorded, "ou-share-stuck").status).toBe("creating");
    expect(recorded.api(OpenStackServiceType.SharedFileSystems)?.status).toBe(
      "up",
    );
  });
});

describe("what Manila's API lists that the exporter never reads", () => {
  function services(name: string): Array<JSONObject> {
    return scene(name).readApi("manila-services")[
      "services"
    ] as Array<JSONObject>;
  }

  function stateOf(name: string, binary: string): Array<unknown> {
    return services(name)
      .filter((service: JSONObject): boolean => {
        return service["binary"] === binary;
      })
      .map((service: JSONObject): unknown => {
        return service["state"];
      });
  }

  test("a clean stop reads stopped, and a kill reads down", () => {
    expect(stateOf("share-service-stopped", "manila-share")).toEqual([
      OPENSTACK_SERVICE_STATUS_STOPPED,
      OPENSTACK_SERVICE_STATUS_STOPPED,
    ]);
    expect(stateOf("share-service-killed", "manila-share")).toEqual([
      "down",
      "down",
    ]);
    expect(stateOf("scheduler-stopped", "manila-scheduler")).toEqual([
      OPENSTACK_SERVICE_STATUS_STOPPED,
    ]);
    expect(stateOf("recovered", "manila-share")).toEqual(["up", "up"]);
  });

  test("a worker reading stopped is a warning, and says it stopped cleanly", () => {
    const row: OpenStackResource = Object.assign(new OpenStackResource(), {
      kind: OpenStackResourceKind.Service,
      name: "manila-share",
      status: OPENSTACK_SERVICE_STATUS_STOPPED,
      adminState: "enabled",
    });

    const assessment: ReturnType<typeof assessOpenStackService> =
      assessOpenStackService({ row, now: RECORDED_AT });

    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.reasons[0]?.text).toContain("Stopped cleanly");
  });

  test("Manila's pools can't be read without its scheduler, so nothing may read that as no pools", () => {
    expect(
      scene("share-service-stopped").readApi("manila-pools")["pools"],
    ).not.toEqual([]);
  });
});

describe("what each credential got", () => {
  function reader(level: string): RecordedServiceScene {
    return new RecordedServiceScene({
      group: GROUP,
      scene: "access-check/exporter",
      exporterFolder: level,
    });
  }

  test.each(["admin", "monitoring-admin-get"])(
    "%s reads every project's shares",
    (level: string) => {
      expect(namesOfRows(shares(reader(level)))).toEqual([
        "ou-share-admin",
        "ou-share-error",
        "ou-share-payments",
        "ou-share-stuck",
      ]);
    },
  );

  test.each([
    ["reader", ["ou-share-payments"]],
    ["role-on-a-project", ["ou-share-payments"]],
    ["monitoring-role", []],
  ])(
    "%s reads only its own project's, and no error says so",
    (level: string, names: Array<string>) => {
      const recorded: RecordedServiceScene = reader(level);

      expect(namesOfRows(shares(recorded))).toEqual(names);
      expect(recorded.api(OpenStackServiceType.SharedFileSystems)?.status).toBe(
        "up",
      );
    },
  );
});

describe("what the agent's real collector sent", () => {
  const scanned: {
    entries: Array<OpenStackResourceBufferEntry>;
    scrapes: Array<{ service: string; up: number; samples: number }>;
  } = scanRecordedOtlp(GROUP);

  test("a share reads the same as it does from the exporter's text", () => {
    const share: OpenStackResourceBufferEntry | undefined =
      scanned.entries.find((entry: OpenStackResourceBufferEntry): boolean => {
        return (
          entry.kind === OpenStackResourceKind.Share &&
          entry.name === "ou-share-payments"
        );
      });

    expect(share?.status).toBe("available");
    expect(share?.regionName).toBe("RegionOne");
    expect(share?.facts["shareType"]).toBe("ou-alpha");
    expect(share?.facts["shareProtocol"]).toBe("NFS");
  });

  test("a service this cloud doesn't run reads up 1 with nothing, and makes no row", () => {
    const absent: { service: string; up: number; samples: number } | undefined =
      scanned.scrapes.find(
        (scrape: { service: string; samples: number }): boolean => {
          return scrape.service !== OpenStackServiceType.SharedFileSystems;
        },
      );

    expect(absent).toEqual({
      service: "load-balancer",
      up: 1,
      samples: 0,
    });
    expect(
      scanned.entries.filter((entry: OpenStackResourceBufferEntry): boolean => {
        return entry.kind === OpenStackResourceKind.Api;
      }).map((entry: OpenStackResourceBufferEntry): string | null => {
        return entry.name;
      }),
    ).toEqual([OpenStackServiceType.SharedFileSystems]);
  });
});

describe("the words themselves", () => {
  test("no word is both an error and on its way", () => {
    for (const status of OPENSTACK_SHARE_ERROR_STATUSES) {
      expect(OPENSTACK_SHARE_TRANSITIONAL_STATUSES.has(status)).toBe(false);
    }
  });

  test("every word the exporter counts is either accounted for or plainly fine", () => {
    const counted: Array<string> = scene("baseline")
      .seriesNamed("openstack_sharev2_share_status_counter")
      .map((series: { labels: Record<string, string> }): string => {
        return series.labels["status"] as string;
      });

    expect(counted).toHaveLength(19);

    const neither: Array<string> = counted.filter((status: string): boolean => {
      return (
        !OPENSTACK_SHARE_ERROR_STATUSES.has(status) &&
        !OPENSTACK_SHARE_TRANSITIONAL_STATUSES.has(status)
      );
    });

    // Fine, an off switch, and what lasts as long as its data takes to copy, because someone asked.
    expect(neither.sort()).toEqual(["available", "inactive", "migrating"]);
  });

  test.each([
    ["available", null],
    ["inactive", null],
    ["migrating", null],
    ["error", ResourceAttentionSeverity.Warning],
    ["shrinking_possible_data_loss_error", ResourceAttentionSeverity.Warning],
    ["migration_error", ResourceAttentionSeverity.Warning],
    ["soft_deleting", null],
    [null, null],
  ])(
    "a share reading %s, just now, reads as %s",
    (status: string | null, severity: ResourceAttentionSeverity | null) => {
      expect(
        severityOf(
          Object.assign(new OpenStackResource(), {
            kind: OpenStackResourceKind.Share,
            status: status || undefined,
            stateChangedAt: RECORDED_AT,
          }),
        ),
      ).toBe(severity);
    },
  );

  test("a word Manila has added since reads as nothing rather than as a failure", () => {
    expect(
      severityOf(
        Object.assign(new OpenStackResource(), {
          kind: OpenStackResourceKind.Share,
          status: "some_word_from_a_later_release",
          stateChangedAt: new Date(0),
        }),
      ),
    ).toBe(null);
  });

  test("a stuck share with no time on it says nothing", () => {
    expect(
      isOpenStackShareStuck({
        status: "creating",
        stateChangedAt: null,
        now: RECORDED_AT,
      }),
    ).toBe(false);
  });
});

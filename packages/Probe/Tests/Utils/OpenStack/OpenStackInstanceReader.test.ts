import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import OpenStackCollectorMemory from "../../../Utils/OpenStack/OpenStackCollectorMemory";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
} from "../../../Utils/OpenStack/OpenStackHttp";
import {
  CHANGES_SINCE_OVERLAP_IN_MS,
  FULL_INSTANCE_READ_INTERVAL_IN_MS,
  OpenStackInstanceRead,
  readOpenStackInstances,
  toChangesSince,
} from "../../../Utils/OpenStack/OpenStackInstanceReader";
import { NovaServerRecord } from "../../../Utils/OpenStack/OpenStackInventory";
import {
  OpenStackKeystoneSession,
  OpenStackToken,
  parseKeystoneToken,
} from "../../../Utils/OpenStack/OpenStackKeystone";
import OpenStackServiceClient from "../../../Utils/OpenStack/OpenStackServiceClient";
import { FakeClock, createFakeClock } from "./Helpers/CollectorHarness";

/*
 * Instances read by what changed: a full read now and then, and only the changes between,
 * with every collection still knowing every instance.
 */

const STATE_KEY: string = "credential/RegionOne/instances";

function server(id: string, overrides: JSONObject = {}): JSONObject {
  return {
    id: id,
    name: id,
    status: "ACTIVE",
    tenant_id: "project-1",
    ...overrides,
  };
}

interface Nova {
  client: OpenStackServiceClient;
  clock: FakeClock;
  memory: OpenStackCollectorMemory;
  requests: Array<OpenStackHttpRequest>;
  answer: (handler: (url: globalThis.URL) => OpenStackHttpResponse) => void;
  read: () => Promise<OpenStackInstanceRead>;
}

function nova(): Nova {
  const clock: FakeClock = createFakeClock();
  const memory: OpenStackCollectorMemory = new OpenStackCollectorMemory();
  const requests: Array<OpenStackHttpRequest> = [];
  let handler: (url: globalThis.URL) => OpenStackHttpResponse = () => {
    return { status: 500, headers: {}, body: "" };
  };

  const client: OpenStackServiceClient = new OpenStackServiceClient({
    service: OpenStackServiceType.Compute,
    regionName: "RegionOne",
    baseUrl: "https://nova.example.com/v2.1",
    clock: clock,
    deadlineAt: clock.now() + 24 * 60 * 60_000,
    session: new OpenStackKeystoneSession({
      token: parseKeystoneToken({ tokenId: "t", body: { token: {} } }),
      isFresh: true,
      login: async (): Promise<OpenStackToken> => {
        throw new Error("No login here.");
      },
    }),
    userAgent: "test",
    transport: async (
      request: OpenStackHttpRequest,
    ): Promise<OpenStackHttpResponse> => {
      requests.push(request);
      return handler(new globalThis.URL(request.url));
    },
  });

  return {
    client,
    clock,
    memory,
    requests,
    answer: (next: (url: globalThis.URL) => OpenStackHttpResponse): void => {
      handler = next;
    },
    read: (): Promise<OpenStackInstanceRead> => {
      return readOpenStackInstances({
        client,
        memory,
        stateKey: STATE_KEY,
      });
    },
  };
}

function servers(
  items: Array<JSONObject>,
  date?: string,
): OpenStackHttpResponse {
  return {
    status: 200,
    headers: date ? { date: date } : {},
    body: JSON.stringify({ servers: items }),
  };
}

function namesOf(read: OpenStackInstanceRead): Array<string> {
  return read.servers
    .map((record: NovaServerRecord): string => {
      return record.id;
    })
    .sort();
}

describe("the time asked from", () => {
  test("is the service's own clock, a little early, in the form Nova's schema takes", () => {
    expect(
      toChangesSince({
        date: "Wed, 04 Nov 2026 11:50:00 GMT",
        now: Date.parse("2020-01-01T00:00:00Z"),
      }),
    ).toBe("2026-11-04T11:48:00Z");
  });

  test("a service that sends no Date goes by the probe's clock", () => {
    expect(
      toChangesSince({ date: null, now: Date.parse("2026-11-04T12:00:00Z") }),
    ).toBe("2026-11-04T11:58:00Z");
    expect(
      toChangesSince({
        date: "not a date",
        now: Date.parse("2026-11-04T12:00:00Z"),
      }),
    ).toBe("2026-11-04T11:58:00Z");
  });

  test("the overlap is what catches a change made while a list was being paged", () => {
    expect(CHANGES_SINCE_OVERLAP_IN_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe("reading instances", () => {
  test("the first read is a full one, of every project", async () => {
    const cloud: Nova = nova();

    cloud.answer(() => {
      return servers([server("a"), server("b")]);
    });

    const read: OpenStackInstanceRead = await cloud.read();

    expect(read.mode).toBe("Full");
    expect(read.isOwnProjectOnly).toBe(false);
    expect(namesOf(read)).toEqual(["a", "b"]);

    const url: globalThis.URL = new globalThis.URL(cloud.requests[0]!.url);

    expect(url.pathname).toBe("/v2.1/servers/detail");
    expect(url.searchParams.get("all_tenants")).toBe("1");
    expect(url.searchParams.get("changes-since")).toBeNull();
    expect(url.searchParams.get("limit")).toBe("1000");
  });

  test("the next asks only for what changed, from Nova's own time", async () => {
    const cloud: Nova = nova();

    cloud.answer(() => {
      return servers(
        [server("a"), server("b")],
        "Wed, 04 Nov 2026 11:50:00 GMT",
      );
    });
    await cloud.read();

    cloud.clock.advance(120_000);
    cloud.answer((url: globalThis.URL) => {
      expect(url.searchParams.get("changes-since")).toBe(
        "2026-11-04T11:48:00Z",
      );
      expect(url.searchParams.get("all_tenants")).toBe("1");
      return servers([], "Wed, 04 Nov 2026 11:52:00 GMT");
    });

    const read: OpenStackInstanceRead = await cloud.read();

    expect(read.mode).toBe("Incremental");
    // Nothing changed, and every instance is still there to send.
    expect(namesOf(read)).toEqual(["a", "b"]);
  });

  test("each read moves the time on, so a change is not asked about for ever", async () => {
    const cloud: Nova = nova();

    cloud.answer(() => {
      return servers([server("a")], "Wed, 04 Nov 2026 11:50:00 GMT");
    });
    await cloud.read();

    cloud.answer(() => {
      return servers([], "Wed, 04 Nov 2026 11:52:00 GMT");
    });
    await cloud.read();

    cloud.answer((url: globalThis.URL) => {
      expect(url.searchParams.get("changes-since")).toBe(
        "2026-11-04T11:50:00Z",
      );
      return servers([], "Wed, 04 Nov 2026 11:54:00 GMT");
    });
    await cloud.read();
  });

  test("what changed replaces what it was, and what is new joins", async () => {
    const cloud: Nova = nova();

    cloud.answer(() => {
      return servers([server("a"), server("b")]);
    });
    await cloud.read();

    cloud.answer(() => {
      return servers([server("b", { status: "SHUTOFF" }), server("c")]);
    });

    const read: OpenStackInstanceRead = await cloud.read();

    expect(namesOf(read)).toEqual(["a", "b", "c"]);
    expect(
      read.servers.find((record: NovaServerRecord): boolean => {
        return record.id === "b";
      })?.status,
    ).toBe("SHUTOFF");
  });

  test.each(["DELETED", "SOFT_DELETED"])(
    "%s is how an instance leaves without a full read",
    async (status: string) => {
      const cloud: Nova = nova();

      cloud.answer(() => {
        return servers([server("a"), server("b")]);
      });
      await cloud.read();

      cloud.answer(() => {
        return servers([server("b", { status: status })]);
      });

      expect(namesOf(await cloud.read())).toEqual(["a"]);
    },
  );

  test("one that comes and goes between reads never appears", async () => {
    const cloud: Nova = nova();

    cloud.answer(() => {
      return servers([server("a")]);
    });
    await cloud.read();

    cloud.answer(() => {
      return servers([server("gone-already", { status: "DELETED" })]);
    });

    expect(namesOf(await cloud.read())).toEqual(["a"]);
  });

  test("a full read now and then puts right anything missed", async () => {
    const cloud: Nova = nova();

    cloud.answer(() => {
      return servers([server("a"), server("left-without-saying")]);
    });
    await cloud.read();

    cloud.clock.advance(FULL_INSTANCE_READ_INTERVAL_IN_MS);
    cloud.answer((url: globalThis.URL) => {
      expect(url.searchParams.get("changes-since")).toBeNull();
      return servers([server("a")]);
    });

    const read: OpenStackInstanceRead = await cloud.read();

    expect(read.mode).toBe("Full");
    expect(namesOf(read)).toEqual(["a"]);
  });

  test("a failed read leaves the list and the time as they were", async () => {
    const cloud: Nova = nova();

    cloud.answer(() => {
      return servers([server("a")], "Wed, 04 Nov 2026 11:50:00 GMT");
    });
    await cloud.read();

    cloud.answer(() => {
      return { status: 500, headers: {}, body: "" };
    });
    await expect(cloud.read()).rejects.toMatchObject({ kind: "failing" });

    cloud.answer((url: globalThis.URL) => {
      expect(url.searchParams.get("changes-since")).toBe(
        "2026-11-04T11:48:00Z",
      );
      return servers([]);
    });

    expect(namesOf(await cloud.read())).toEqual(["a"]);
  });

  test("a first read that fails keeps nothing, and the next is full again", async () => {
    const cloud: Nova = nova();

    cloud.answer(() => {
      return { status: 503, headers: {}, body: "" };
    });
    await expect(cloud.read()).rejects.toMatchObject({ kind: "overloaded" });

    cloud.answer(() => {
      return servers([server("a")]);
    });

    expect((await cloud.read()).mode).toBe("Full");
  });

  test("a credential refused every project's gets its own, and says so", async () => {
    const cloud: Nova = nova();

    cloud.answer((url: globalThis.URL) => {
      return url.searchParams.get("all_tenants")
        ? { status: 403, headers: {}, body: "" }
        : servers([server("mine")]);
    });

    const read: OpenStackInstanceRead = await cloud.read();

    expect(read.isOwnProjectOnly).toBe(true);
    expect(namesOf(read)).toEqual(["mine"]);
  });

  test("it stays with its own between full reads, not asking to be refused each time", async () => {
    const cloud: Nova = nova();

    cloud.answer((url: globalThis.URL) => {
      return url.searchParams.get("all_tenants")
        ? { status: 403, headers: {}, body: "" }
        : servers([server("mine")]);
    });
    await cloud.read();

    const before: number = cloud.requests.length;
    await cloud.read();

    expect(cloud.requests.length).toBe(before + 1);
    expect(
      new globalThis.URL(
        cloud.requests[cloud.requests.length - 1]!.url,
      ).searchParams.get("all_tenants"),
    ).toBeNull();
  });

  test("a full read asks every project's again, in case the credential was given more", async () => {
    const cloud: Nova = nova();

    cloud.answer((url: globalThis.URL) => {
      return url.searchParams.get("all_tenants")
        ? { status: 403, headers: {}, body: "" }
        : servers([server("mine")]);
    });
    await cloud.read();

    cloud.clock.advance(FULL_INSTANCE_READ_INTERVAL_IN_MS);
    cloud.answer(() => {
      return servers([server("mine"), server("theirs")]);
    });

    const read: OpenStackInstanceRead = await cloud.read();

    expect(read.isOwnProjectOnly).toBe(false);
    expect(namesOf(read)).toEqual(["mine", "theirs"]);
  });

  test("each region and credential has its own list", async () => {
    const cloud: Nova = nova();

    cloud.answer(() => {
      return servers([server("a")]);
    });
    await cloud.read();

    cloud.answer(() => {
      return servers([server("b")]);
    });

    const other: OpenStackInstanceRead = await readOpenStackInstances({
      client: cloud.client,
      memory: cloud.memory,
      stateKey: "credential/RegionTwo/instances",
    });

    expect(other.mode).toBe("Full");
    expect(namesOf(other)).toEqual(["b"]);
  });

  test("a list unused for an hour is forgotten: the cloud moved to another probe", async () => {
    const cloud: Nova = nova();

    cloud.answer(() => {
      return servers([server("a")]);
    });
    await cloud.read();

    cloud.clock.advance(60 * 60_000 + 1);

    expect(
      cloud.memory.getInstanceState(STATE_KEY, cloud.clock.now()),
    ).toBeNull();
  });

  test("only what the series read is kept of each, so the list stays small", async () => {
    const cloud: Nova = nova();

    cloud.answer(() => {
      return servers([
        server("a", {
          links: [{ rel: "self", href: "https://nova.example.com/a" }],
          fault: {
            message: "No valid host",
            details: "Traceback (most recent call last)",
          },
          flavor: { original_name: "m1.tiny", extra_specs: { "hw:big": "x" } },
        }),
      ]);
    });

    const record: NovaServerRecord = (await cloud.read()).servers[0]!;

    expect(JSON.stringify(record)).not.toContain("Traceback");
    expect(JSON.stringify(record)).not.toContain("links");
    expect(record.faultMessage).toBe("No valid host");
    expect(record.flavorName).toBe("m1.tiny");
  });
});

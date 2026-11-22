import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { FindOperator } from "typeorm";
import Probe from "../../../../Models/DatabaseModels/Probe";
import ProbeService from "../../../../Server/Services/ProbeService";
import OneUptimeProbeAddresses, {
  ONEUPTIME_CLOUD_PROBES_NAME,
  OneUptimeProbeAddressSource,
  OneUptimeProbeKind,
  OneUptimeProbeRead,
} from "../../../../Server/Utils/Probe/OneUptimeProbeAddresses";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import { getJestSpyOn } from "../../../Spy";

/*
 * THE ONE LIST OF ONEUPTIME'S OWN PROBE ADDRESSES (#10338, #10429): the
 * blocklist never blocks them, and Security Events knows a probe's own
 * polls and checks in the project's flows by them. Each probe is read by
 * the address it checks in from and by those on its own interfaces, and is
 * one probe however it was found.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

const READER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
};

interface FindInput {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
  props: DatabaseCommonInteractionProps;
}

let nextId: number = 1;

function probe(data: {
  name: string;
  egress?: string;
  interfaces?: string;
  isGlobal?: boolean;
  lastAlive?: Date;
}): Probe {
  const model: Probe = new Probe();
  model.id = new ObjectID(
    `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
  );
  model.name = data.name;
  model.isGlobalProbe = Boolean(data.isGlobal);

  if (data.egress !== undefined) {
    model.egressIpAddress = data.egress;
  }

  if (data.interfaces !== undefined) {
    model.interfaceIpAddresses = data.interfaces;
  }

  if (data.lastAlive) {
    model.lastAlive = data.lastAlive;
  }

  return model;
}

// The text a query holds a column to, or null for any value at all.
function searchedText(filter: unknown): string | null {
  const parameters: Record<string, unknown> | undefined =
    filter instanceof FindOperator
      ? (filter.objectLiteralParameters as Record<string, unknown>)
      : undefined;
  const value: unknown = parameters ? Object.values(parameters)[0] : undefined;

  return typeof value === "string" ? value.slice(1, -1) : null;
}

function matches(filter: unknown, value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const text: string | null = searchedText(filter);

  return text === null || value.toLowerCase().includes(text.toLowerCase());
}

// A findBy that answers as the database would.
function stand(rows: Array<Probe>): jest.SpyInstance {
  return getJestSpyOn(ProbeService, "findBy").mockImplementation((async (
    input: FindInput,
  ): Promise<Array<Probe>> => {
    return rows
      .filter((row: Probe): boolean => {
        if (
          Boolean(row.isGlobalProbe) !==
          (input.query["isGlobalProbe"] === true)
        ) {
          return false;
        }

        return input.query["interfaceIpAddresses"] !== undefined
          ? matches(
              input.query["interfaceIpAddresses"],
              row.interfaceIpAddresses,
            )
          : matches(input.query["egressIpAddress"], row.egressIpAddress);
      })
      .slice(0, input.limit);
  }) as never);
}

function inputsOf(spy: jest.SpyInstance): Array<FindInput> {
  return spy.mock.calls.map((call: Array<unknown>): FindInput => {
    return call[0] as FindInput;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the project's own probes", () => {
  test("each with the address it checks in from, then those on its interfaces, each once", async () => {
    const office: Probe = probe({
      name: "Office probe",
      egress: "203.0.113.7",
      interfaces: "10.0.0.5, 203.0.113.7, 2001:db8::5",
    });
    stand([office]);

    const read: OneUptimeProbeRead =
      await OneUptimeProbeAddresses.readProjectProbes({
        projectId: PROJECT_ID,
        contains: null,
        limit: 50,
        props: READER,
      });

    expect(read).toEqual({
      probes: [
        {
          kind: OneUptimeProbeKind.Project,
          probeId: office.id!.toString(),
          name: "Office probe",
          lastAlive: null,
          addresses: [
            {
              value: "203.0.113.7",
              source: OneUptimeProbeAddressSource.CheckIn,
            },
            {
              value: "10.0.0.5",
              source: OneUptimeProbeAddressSource.Interface,
            },
            {
              value: "2001:db8::5",
              source: OneUptimeProbeAddressSource.Interface,
            },
          ],
        },
      ],
      isComplete: true,
    });
  });

  test("read by both columns, as the reader, the project's alone", async () => {
    const spy: jest.SpyInstance = stand([]);

    await OneUptimeProbeAddresses.readProjectProbes({
      projectId: PROJECT_ID,
      contains: "10.0.0.",
      limit: 2000,
      props: READER,
    });

    const inputs: Array<FindInput> = inputsOf(spy);

    expect(inputs).toHaveLength(2);

    for (const input of inputs) {
      expect(input.query["projectId"]).toEqual(PROJECT_ID);
      expect(input.props).toBe(READER);
      // One more than it keeps, to know whether that was all.
      expect(input.limit).toBe(2001);
      // When it last checked in is read only when asked for.
      expect(input.select["lastAlive"]).toBeUndefined();
    }

    expect(searchedText(inputs[0]!.query["egressIpAddress"])).toBe("10.0.0.");
    expect(searchedText(inputs[1]!.query["interfaceIpAddresses"])).toBe(
      "10.0.0.",
    );
  });

  test("a probe found by an address on its interfaces alone is found", async () => {
    const lab: Probe = probe({
      name: "Lab probe",
      egress: "203.0.113.7",
      interfaces: "10.20.0.9",
    });
    stand([lab]);

    const read: OneUptimeProbeRead =
      await OneUptimeProbeAddresses.readProjectProbes({
        projectId: PROJECT_ID,
        contains: "10.20.0.9",
        limit: 2000,
        props: READER,
      });

    expect(
      read.probes.map((found: { name: string }): string => {
        return found.name;
      }),
    ).toEqual(["Lab probe"]);
  });

  test("when each last checked in, for a reader that asks", async () => {
    const lastAlive: Date = new Date("2026-11-21T10:00:00.000Z");
    const spy: jest.SpyInstance = stand([
      probe({ name: "Office probe", egress: "203.0.113.7", lastAlive }),
    ]);

    const read: OneUptimeProbeRead =
      await OneUptimeProbeAddresses.readProjectProbes({
        projectId: PROJECT_ID,
        contains: null,
        limit: 50,
        props: { isRoot: true },
        withLastAlive: true,
      });

    expect(read.probes[0]!.lastAlive).toEqual(lastAlive);
    expect(inputsOf(spy)[0]!.select["lastAlive"]).toBe(true);
  });

  test("a probe that holds no address is not listed", async () => {
    stand([
      probe({ name: "Never checked in", interfaces: "not-an-address" }),
      probe({ name: "Office probe", egress: "203.0.113.7" }),
    ]);

    const read: OneUptimeProbeRead =
      await OneUptimeProbeAddresses.readProjectProbes({
        projectId: PROJECT_ID,
        contains: null,
        limit: 50,
        props: READER,
      });

    expect(
      read.probes.map((found: { name: string }): string => {
        return found.name;
      }),
    ).toEqual(["Office probe"]);
  });

  test("more than the limit: the rest are not read, and it says so", async () => {
    stand(
      Array.from({ length: 4 }, (_: unknown, index: number): Probe => {
        return probe({ name: `Probe ${index}`, egress: `203.0.113.${index}` });
      }),
    );

    const read: OneUptimeProbeRead =
      await OneUptimeProbeAddresses.readProjectProbes({
        projectId: PROJECT_ID,
        contains: null,
        limit: 3,
        props: READER,
      });

    expect(read.probes).toHaveLength(3);
    expect(read.isComplete).toBe(false);
  });

  test("probes found by different columns count together against the limit", async () => {
    stand([
      probe({ name: "A", egress: "203.0.113.1" }),
      probe({ name: "B", egress: "203.0.113.2" }),
      probe({ name: "C", interfaces: "10.0.0.3" }),
      probe({ name: "D", interfaces: "10.0.0.4" }),
    ]);

    const read: OneUptimeProbeRead =
      await OneUptimeProbeAddresses.readProjectProbes({
        projectId: PROJECT_ID,
        contains: null,
        limit: 3,
        props: READER,
      });

    expect(read.probes).toHaveLength(3);
    expect(read.isComplete).toBe(false);
  });
});

describe("OneUptime's own probes", () => {
  test("read as OneUptime, by the address each checks in from", async () => {
    const usEast: Probe = probe({
      name: "US East",
      egress: "34.1.2.3",
      isGlobal: true,
    });
    const spy: jest.SpyInstance = stand([usEast]);

    const read: OneUptimeProbeRead =
      await OneUptimeProbeAddresses.readGlobalProbes({
        contains: "34.1.",
        limit: 2000,
      });

    expect(read).toEqual({
      probes: [
        {
          kind: OneUptimeProbeKind.Global,
          probeId: usEast.id!.toString(),
          name: "US East",
          lastAlive: null,
          addresses: [
            {
              value: "34.1.2.3",
              source: OneUptimeProbeAddressSource.CheckIn,
            },
          ],
        },
      ],
      isComplete: true,
    });

    const [input] = inputsOf(spy);

    expect(input!.query["isGlobalProbe"]).toBe(true);
    expect(input!.query["projectId"]).toBeUndefined();
    expect(input!.props).toEqual({ isRoot: true });
    // A global probe keeps no interface addresses.
    expect(input!.select["interfaceIpAddresses"]).toBeUndefined();
  });
});

describe("OneUptime Cloud's probe addresses", () => {
  test("each address or range the setting lists, written the one way", () => {
    expect(
      OneUptimeProbeAddresses.getOneUptimeCloud(
        "34.1.2.3, 35.205.11.0/24 2001:DB8::/32,,not-an-address,34.1.2.3",
      ),
    ).toEqual({
      kind: OneUptimeProbeKind.OneUptimeCloud,
      probeId: "",
      name: ONEUPTIME_CLOUD_PROBES_NAME,
      lastAlive: null,
      addresses: [
        { value: "34.1.2.3", source: OneUptimeProbeAddressSource.Setting },
        {
          value: "35.205.11.0/24",
          source: OneUptimeProbeAddressSource.Setting,
        },
        {
          value: "2001:db8::/32",
          source: OneUptimeProbeAddressSource.Setting,
        },
      ],
    });
  });

  test("a setting that lists none: no such probes", () => {
    expect(OneUptimeProbeAddresses.getOneUptimeCloud("")).toBeNull();
    expect(OneUptimeProbeAddresses.getOneUptimeCloud("nothing")).toBeNull();
  });
});

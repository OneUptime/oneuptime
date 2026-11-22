import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import logger from "../../../../../Server/Utils/Logger";
import OneUptimeProbeAddresses, {
  OneUptimeProbe,
  OneUptimeProbeAddressSource,
} from "../../../../../Server/Utils/Probe/OneUptimeProbeAddresses";
import ProbeOwnTraffic, {
  MAX_PROBE_SOURCE_ADDRESSES,
  PROBE_ALIVE_GRACE_IN_MINUTES,
  ProbeFlowSources,
  wasCheckingIn,
} from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/ProbeOwnTraffic";
import ObjectID from "../../../../../Types/ObjectID";
import OneUptimeProbeKind from "../../../../../Types/Probe/OneUptimeProbeKind";
import { FlowWindow } from "../../../../../Utils/SecurityEvent/TelemetryScan/FlowSignals";

/*
 * Which sources of a window's flows are OneUptime's own probes (#10429): the
 * one list of their addresses, each probe only while it was checking in, and
 * OneUptime Cloud's ranges matched address by address.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000c201",
);

const WINDOW: FlowWindow = {
  from: new Date("2026-11-21T10:00:00.000Z"),
  to: new Date("2026-11-21T10:05:00.000Z"),
};

function probe(data: {
  kind?: OneUptimeProbeKind;
  probeId: string;
  name: string;
  addresses: Array<string>;
  lastAlive?: Date | null;
}): OneUptimeProbe {
  return {
    kind: data.kind || OneUptimeProbeKind.Project,
    probeId: data.probeId,
    name: data.name,
    lastAlive:
      data.lastAlive === undefined
        ? new Date("2026-11-21T10:03:00.000Z")
        : data.lastAlive,
    addresses: data.addresses.map((value: string) => {
      return { value, source: OneUptimeProbeAddressSource.Interface };
    }),
  };
}

const OFFICE: OneUptimeProbe = probe({
  probeId: "0192f1a0-0000-7000-8000-00000000c202",
  name: "Office probe",
  addresses: ["10.0.0.250", "2001:db8::250"],
});

const STORE: OneUptimeProbe = probe({
  probeId: "0192f1a0-0000-7000-8000-00000000c203",
  name: "Store probe",
  addresses: ["10.0.0.250"],
});

const US_EAST_ID: string = "0192f1a0-0000-7000-8000-00000000c204";

const CLOUD: OneUptimeProbe = {
  kind: OneUptimeProbeKind.OneUptimeCloud,
  probeId: "",
  name: "OneUptime Cloud",
  lastAlive: null,
  addresses: [
    { value: "35.205.11.0/24", source: OneUptimeProbeAddressSource.Setting },
    { value: "34.1.2.3", source: OneUptimeProbeAddressSource.Setting },
  ],
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which of OneUptime's probes a source is", () => {
  const sources: ProbeFlowSources = new ProbeFlowSources({
    probes: [OFFICE, STORE, CLOUD],
    globalProbeIds: [new ObjectID(US_EAST_ID)],
  });

  test("by an address a probe holds, however it is written", () => {
    expect(sources.findProbes("2001:DB8:0::250")).toEqual([OFFICE]);
  });

  test("probes that share an address are each that address's", () => {
    expect(sources.findProbes("10.0.0.250")).toEqual([OFFICE, STORE]);
  });

  test("by a range of OneUptime Cloud's", () => {
    expect(sources.findProbes("35.205.11.131")).toEqual([CLOUD]);
    expect(sources.findProbes("34.1.2.3")).toEqual([CLOUD]);
  });

  test("anything else is no probe's", () => {
    expect(sources.findProbes("10.0.0.251")).toEqual([]);
    expect(sources.findProbes("35.205.12.1")).toEqual([]);
    expect(sources.findProbes("not an address")).toEqual([]);
  });

  test("the reads are held apart by the single addresses, each once; a range is matched on the rows", () => {
    expect(sources.getAddresses()).toEqual([
      "10.0.0.250",
      "2001:db8::250",
      "34.1.2.3",
    ]);
    expect(sources.getFilter(false)).toEqual({
      addresses: ["10.0.0.250", "2001:db8::250", "34.1.2.3"],
      only: false,
    });
    expect(sources.getFilter(true)?.only).toBe(true);
  });

  test("no probes: nothing to hold apart", () => {
    const none: ProbeFlowSources = new ProbeFlowSources({
      probes: [],
      globalProbeIds: [],
    });

    expect(none.isEmpty()).toBe(true);
    expect(none.getFilter(false)).toBeUndefined();
    expect(none.getFilter(true)).toBeUndefined();
  });

  test("at most so many addresses held apart; the rest are anyone's", () => {
    const many: ProbeFlowSources = new ProbeFlowSources({
      probes: [
        probe({
          probeId: "0192f1a0-0000-7000-8000-00000000c205",
          name: "Big",
          addresses: Array.from(
            { length: MAX_PROBE_SOURCE_ADDRESSES + 5 },
            (_: unknown, index: number): string => {
              return `10.${Math.floor(index / 250)}.${index % 250}.1`;
            },
          ),
        }),
      ],
      globalProbeIds: [],
    });

    expect(many.getAddresses()).toHaveLength(MAX_PROBE_SOURCE_ADDRESSES);
    // One past the cap is not held apart, so it is no probe's here.
    const past: string = `10.${Math.floor(MAX_PROBE_SOURCE_ADDRESSES / 250)}.${MAX_PROBE_SOURCE_ADDRESSES % 250}.1`;
    expect(many.findProbes(past)).toEqual([]);
  });

  test("whose work is read: each probe's own, and every global probe's for OneUptime Cloud's", () => {
    expect(
      sources.getJobProbeIds([OFFICE, STORE]).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([OFFICE.probeId, STORE.probeId].sort());
    expect(
      sources.getJobProbeIds([CLOUD]).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([US_EAST_ID]);
  });
});

describe("whether a probe was checking in while a window's flows were sent", () => {
  test("checked in during the window, or shortly before it", () => {
    expect(wasCheckingIn(OFFICE, WINDOW)).toBe(true);
    expect(
      wasCheckingIn(
        probe({
          probeId: "x",
          name: "x",
          addresses: [],
          lastAlive: new Date(
            WINDOW.from.getTime() -
              (PROBE_ALIVE_GRACE_IN_MINUTES - 1) * 60 * 1000,
          ),
        }),
        WINDOW,
      ),
    ).toBe(true);
  });

  test("silent since long before the window, or never: its address may be someone else's now", () => {
    expect(
      wasCheckingIn(
        probe({
          probeId: "x",
          name: "x",
          addresses: [],
          lastAlive: new Date(
            WINDOW.from.getTime() -
              (PROBE_ALIVE_GRACE_IN_MINUTES + 1) * 60 * 1000,
          ),
        }),
        WINDOW,
      ),
    ).toBe(false);
    expect(
      wasCheckingIn(
        probe({ probeId: "x", name: "x", addresses: [], lastAlive: null }),
        WINDOW,
      ),
    ).toBe(false);
  });

  test("OneUptime Cloud's addresses are a setting, always in force", () => {
    expect(wasCheckingIn(CLOUD, WINDOW)).toBe(true);
  });
});

describe("reading a window's probes", () => {
  test("the project's and OneUptime's that were checking in, read as OneUptime with when each last did, and OneUptime Cloud's", async () => {
    const asleep: OneUptimeProbe = probe({
      probeId: "0192f1a0-0000-7000-8000-00000000c206",
      name: "Asleep",
      addresses: ["10.0.0.99"],
      lastAlive: new Date("2026-11-21T06:00:00.000Z"),
    });
    const usEast: OneUptimeProbe = probe({
      kind: OneUptimeProbeKind.Global,
      probeId: US_EAST_ID,
      name: "US East",
      addresses: ["34.9.9.9"],
      lastAlive: new Date("2026-11-21T06:00:00.000Z"),
    });
    const own: SpyInstance<typeof OneUptimeProbeAddresses.readProjectProbes> =
      jest
        .spyOn(OneUptimeProbeAddresses, "readProjectProbes")
        .mockResolvedValue({ probes: [OFFICE, asleep], isComplete: true });
    const global: SpyInstance<typeof OneUptimeProbeAddresses.readGlobalProbes> =
      jest
        .spyOn(OneUptimeProbeAddresses, "readGlobalProbes")
        .mockResolvedValue({ probes: [usEast], isComplete: true });
    jest
      .spyOn(OneUptimeProbeAddresses, "getOneUptimeCloud")
      .mockReturnValue(CLOUD);

    const sources: ProbeFlowSources = await ProbeOwnTraffic.readSources({
      projectId: PROJECT_ID,
      window: WINDOW,
    });

    expect(own).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        contains: null,
        props: { isRoot: true },
        withLastAlive: true,
      }),
    );
    expect(global).toHaveBeenCalledWith(
      expect.objectContaining({ contains: null, withLastAlive: true }),
    );

    expect(sources.findProbes("10.0.0.250")).toEqual([OFFICE]);
    // Not checking in: its address is anyone's.
    expect(sources.findProbes("10.0.0.99")).toEqual([]);
    expect(sources.findProbes("34.9.9.9")).toEqual([]);
    expect(sources.findProbes("35.205.11.7")).toEqual([CLOUD]);
    // A global probe asleep is still one whose monitors OneUptime Cloud's addresses check.
    expect(
      sources.getJobProbeIds([CLOUD]).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([US_EAST_ID]);
  });

  test("probes that cannot be read: none, and the window is read as anyone's", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(OneUptimeProbeAddresses, "readProjectProbes")
      .mockRejectedValue(new Error("The database is down."));
    jest
      .spyOn(OneUptimeProbeAddresses, "readGlobalProbes")
      .mockResolvedValue({ probes: [], isComplete: true });

    const sources: ProbeFlowSources = await ProbeOwnTraffic.readSources({
      projectId: PROJECT_ID,
      window: WINDOW,
    });

    expect(sources.isEmpty()).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });
});

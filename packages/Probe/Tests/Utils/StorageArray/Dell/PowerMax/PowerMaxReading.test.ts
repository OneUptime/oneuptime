import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  GB,
  MB,
  PowerMaxAlert,
  PowerMaxArrayReading,
  PowerMaxCapacity,
  PowerMaxDirector,
  PowerMaxPort,
  PowerMaxSrdfGroup,
  PowerMaxSrp,
  PowerMaxStorageGroup,
  PowerMaxVolume,
  TB,
  deriveSrdfGroupsFromStorageGroups,
  getDirectorRole,
  getInstances,
  getPortProtocol,
  getSrdfGroupPortIds,
  getSrdfGroupProblem,
  getSrdfStatesByGroup,
  getWorstSrdfState,
  readAlert,
  readCapacity,
  readDirector,
  readHealthScores,
  readPort,
  readPortInstanceId,
  readRegistration,
  readSrdfGroup,
  readSrp,
  readStorageGroup,
  readVolume,
} from "../../../../../Utils/StorageArray/Dell/PowerMax/PowerMaxReading";
import {
  ARRAY_REMOTE,
  ARRAY_V4,
  v3Array,
  v4Array,
} from "./Helpers/PowerMaxScenario";
import {
  HEALTH,
  SRP_1,
  alert,
  classicDirector,
  enhancedDirectors,
  enhancedPorts,
  enhancedRdfGroups,
  enhancedStorageGroup,
  enhancedVolume,
  registrationDetails,
  sloProvisioningSymmetrix,
} from "./Helpers/UnisphereRecordings";

/*
 * What Dell's answers mean (#11004), read from Dell's own examples: the
 * units (TB and GB are binary), which states are up, which SRDF states
 * mean the remote copy is no longer current, which alerts are open - in
 * one place, so the builder and the extractor never read Dell's names.
 */

function srpOf(answer: JSONObject): PowerMaxSrp {
  return readSrp(answer)!;
}

describe("PowerMaxReading: units", () => {
  test("TB, GB and MB are Unisphere's binary units", () => {
    expect(TB).toBe(2 ** 40);
    expect(GB).toBe(2 ** 30);
    expect(MB).toBe(2 ** 20);
  });
});

describe("PowerMaxReading: capacity", () => {
  test("reads the array's usable, used and subscribed capacity and its data reduction, from Dell's example", () => {
    const capacity: PowerMaxCapacity | null = readCapacity(
      sloProvisioningSymmetrix(ARRAY_V4),
      null,
    );

    expect(capacity).toEqual({
      usableBytes: 61.12 * TB,
      usedBytes: 17.27 * TB,
      subscribedBytes: 261.74 * TB,
      dataReductionRatio: 3,
    });
  });

  test("an array that reports capacity per pool only is the pools' sum", () => {
    const answer: JSONObject = v3Array().provisioning!;
    const srps: Array<PowerMaxSrp> = Object.values(v3Array().srps).map(srpOf);

    // Summed pool by pool, as the reading adds them.
    expect(readCapacity(answer, srps)).toEqual({
      usableBytes: 62.87 * TB + 20 * TB,
      usedBytes: 36.96 * TB + 5 * TB,
      subscribedBytes: 347.88 * TB + 40 * TB,
      dataReductionRatio: 3,
    });
  });

  test("a pool with no usable capacity adds nothing; none known is no capacity", () => {
    const empty: PowerMaxSrp = {
      id: "SRP_X",
      emulation: null,
      usableBytes: null,
      usedBytes: null,
      subscribedBytes: null,
      dataReductionRatio: null,
    };
    expect(readCapacity(null, [empty])).toBeNull();
    expect(readCapacity({}, [])).toBeNull();
    expect(readCapacity(null, null)).toBeNull();
  });

  test("a data reduction of 0 (Dell's for none) is no ratio", () => {
    expect(
      readCapacity(
        {
          system_capacity: { usable_total_tb: 1, usable_used_tb: 0.5 },
          system_efficiency: { data_reduction_ratio_to_one: 0 },
        },
        null,
      ),
    ).toEqual({
      usableBytes: TB,
      usedBytes: 0.5 * TB,
      subscribedBytes: null,
      dataReductionRatio: null,
    });
  });

  test("a negative capacity is no capacity", () => {
    expect(
      readCapacity({ system_capacity: { usable_total_tb: -1 } }, null),
    ).toBeNull();
  });
});

describe("PowerMaxReading: health scores", () => {
  test("reads Dell's example: the scores that are current and have a score", () => {
    expect(readHealthScores(HEALTH)).toEqual([
      { metric: "service_level_compliance", score: 100 },
      { metric: "capacity", score: 100 },
    ]);
  });

  test("an expired score is left out", () => {
    expect(
      readHealthScores({
        health_score_metric: [
          { metric: "OVERALL", health_score: 40, expired: true },
          { metric: "CONFIGURATION", health_score: 90, expired: false },
        ],
      }),
    ).toEqual([{ metric: "configuration", score: 90 }]);
  });

  test("no answer, no scores", () => {
    expect(readHealthScores(null)).toEqual([]);
    expect(readHealthScores({})).toEqual([]);
  });
});

describe("PowerMaxReading: performance registration", () => {
  test("reads Dell's example: diagnostic and real time on, the groups registered for real time", () => {
    const answer: JSONObject = registrationDetails({
      symmetrixId: ARRAY_V4,
      realtime: true,
      diagnostic: true,
      selectedSGs: "000_policy_1",
    });
    expect(
      readRegistration(
        (answer["registrationDetailsInfo"] as Array<JSONObject>)[0]!,
      ),
    ).toEqual({
      diagnostic: true,
      realtime: true,
      realtimeStorageGroups: ["000_policy_1"],
    });
  });

  test("the groups come as Dell's comma-separated text or as a list, each once", () => {
    expect(
      readRegistration({
        diagnostic: true,
        realtime: true,
        selectedSGs: "sg1, sg2,,sg1 ",
      }).realtimeStorageGroups,
    ).toEqual(["sg1", "sg2"]);
    expect(
      readRegistration({
        diagnostic: true,
        realtime: true,
        selectedSGs: ["sg3", "sg3", "sg4"],
      }).realtimeStorageGroups,
    ).toEqual(["sg3", "sg4"]);
  });

  test("no registration is unknown, not off", () => {
    expect(readRegistration(null)).toEqual({
      diagnostic: null,
      realtime: null,
      realtimeStorageGroups: [],
    });
    expect(readRegistration({ diagnostic: "yes" })).toEqual({
      diagnostic: null,
      realtime: null,
      realtimeStorageGroups: [],
    });
  });
});

describe("PowerMaxReading: storage resource pools", () => {
  test("reads Dell's SRP_1 example", () => {
    expect(readSrp(SRP_1)).toEqual({
      id: "SRP_1",
      emulation: "FBA",
      usableBytes: 62.87 * TB,
      usedBytes: 36.96 * TB,
      subscribedBytes: 347.88 * TB,
      dataReductionRatio: 38.2,
    });
  });

  test("a pool with no id is none; one with no capacity has none", () => {
    expect(readSrp({ emulation: "FBA" })).toBeNull();
    expect(readSrp({ srpId: "SRP_2" })).toEqual({
      id: "SRP_2",
      emulation: null,
      usableBytes: null,
      usedBytes: null,
      subscribedBytes: null,
      dataReductionRatio: null,
    });
  });
});

describe("PowerMaxReading: storage groups", () => {
  test("reads an enhanced storage group: capacity in binary GB, its SRDF states, modes and local group", () => {
    const group: PowerMaxStorageGroup | null = readStorageGroup(
      enhancedStorageGroup({
        id: "VMware_DS_SG",
        symmetrixId: ARRAY_V4,
        serviceLevel: "Gold",
        volumes: 8,
        capGb: 4096,
        usedGb: 1024,
        rdf: {
          states: ["Suspended", "Suspended"],
          modes: ["Asynchronous"],
          localGroup: "12",
          remoteGroup: "12",
          remoteSystem: ARRAY_REMOTE,
        },
      }),
      new Set(["Oracle_PROD_SG"]),
    );

    expect(group).toEqual({
      id: "VMware_DS_SG",
      type: "child",
      srp: "SRP_1",
      serviceLevel: "Gold",
      volumeCount: 8,
      capacityBytes: 4096 * GB,
      usedBytes: 1024 * GB,
      dataReductionRatio: 2.5,
      isRealtime: false,
      srdfStates: ["Suspended"],
      srdfModes: ["Asynchronous"],
      srdfGroups: ["12"],
    });
  });

  test("a group registered for real time says so", () => {
    expect(
      readStorageGroup({ id: "Oracle_PROD_SG" }, new Set(["Oracle_PROD_SG"]))!
        .isRealtime,
    ).toBe(true);
  });

  test("a group read with few attributes has nulls, not zeros", () => {
    expect(readStorageGroup({ id: "SG" }, new Set())).toEqual({
      id: "SG",
      type: null,
      srp: null,
      serviceLevel: null,
      volumeCount: null,
      capacityBytes: null,
      usedBytes: null,
      dataReductionRatio: null,
      isRealtime: false,
      srdfStates: [],
      srdfModes: [],
      srdfGroups: [],
    });
  });

  test("the SRP and service level come as objects or as plain ids", () => {
    const group: PowerMaxStorageGroup = readStorageGroup(
      { id: "SG", srp: "SRP_9", service_level: { id: "Bronze" } },
      new Set(),
    )!;
    expect(group.srp).toBe("SRP_9");
    expect(group.serviceLevel).toBe("Bronze");
  });

  test("a group with no id is none", () => {
    expect(readStorageGroup({ type: "parent" }, new Set())).toBeNull();
  });

  test("the SRDF state shown is the first broken one, else the first healthy one", () => {
    expect(getWorstSrdfState(["Synchronized", "Suspended"])).toBe("Suspended");
    expect(getWorstSrdfState(["Split", "Consistent"])).toBe("Split");
    expect(getWorstSrdfState(["SyncInProg", "Unknown"])).toBe("SyncInProg");
    expect(getWorstSrdfState(["Unknown"])).toBe("Unknown");
    expect(getWorstSrdfState(["Failed Over"])).toBe("Failed Over");
    expect(getWorstSrdfState([])).toBeNull();
  });
});

describe("PowerMaxReading: volumes", () => {
  test("reads Dell's volume example with its first storage group", () => {
    expect(
      readVolume(
        enhancedVolume({
          id: "00847",
          symmetrixId: ARRAY_V4,
          identifier: "ora_data_01",
          capGb: 2000,
          usedGb: 10,
          storageGroups: ["Oracle_PROD_SG", "Oracle_PARENT_SG"],
        }),
      ),
    ).toEqual({
      id: "00847",
      identifier: "ora_data_01",
      type: "TDEV",
      status: "Ready",
      emulation: "FBA",
      capacityBytes: 2000 * GB,
      usedBytes: 10 * GB,
      storageGroup: "Oracle_PROD_SG",
    });
  });

  test("Dell's empty identifier is no identifier; no groups is no group", () => {
    const volume: PowerMaxVolume = readVolume(
      enhancedVolume({
        id: "00001",
        symmetrixId: ARRAY_V4,
        capGb: 1,
        usedGb: 0,
        storageGroups: [],
      }),
    )!;
    expect(volume.identifier).toBeNull();
    expect(volume.storageGroup).toBeNull();
    expect(readVolume({ cap_gb: 1 })).toBeNull();
  });
});

describe("PowerMaxReading: directors", () => {
  test("a director's role is its emulation's", () => {
    for (const [id, role] of [
      ["FA-1D", "frontend"],
      ["FN-2D", "frontend"],
      ["SE-2E", "frontend"],
      ["EF-1H", "frontend"],
      ["OR-1C", "frontend"],
      ["OS-1C", "frontend"],
      ["DF-1C", "backend"],
      ["DN-1C", "backend"],
      ["DX-1F", "backend"],
      ["DA-1A", "backend"],
      ["RF-1E", "srdf"],
      ["RE-2G", "srdf"],
      ["IM-1A", "infrastructure"],
      ["ED-1B", "infrastructure"],
      ["EM-4A", "infrastructure"],
      ["fa-7d", "frontend"],
    ] as Array<[string, string]>) {
      expect({ id, role: getDirectorRole(id) }).toEqual({ id, role });
    }
  });

  test("reads Dell's enhanced directors: type, status, engine and slot", () => {
    const directors: Array<PowerMaxDirector | null> =
      enhancedDirectors(ARRAY_V4).map(readDirector);

    expect(directors[3]).toEqual({
      id: "OR-1C",
      role: "frontend",
      type: "OSHostAndRDF",
      status: "Online",
      isOnline: true,
      engine: 1,
      slot: 1,
    });
    expect(directors[0]).toMatchObject({
      id: "EM-4A",
      role: "infrastructure",
      type: "ArrayAndDataService",
      engine: 2,
      slot: 4,
    });
  });

  test("reads Dell's classic director: availability, its slot; its role in words", () => {
    expect(readDirector(classicDirector("DF-1C"))).toEqual({
      id: "DF-1C",
      role: "backend",
      type: "Back end",
      status: "Online",
      isOnline: true,
      engine: null,
      slot: 1,
    });
  });

  test("a director that is not Online is not online", () => {
    for (const status of ["Offline", "Failed", "Dead", "PendOn", ""]) {
      const entry: JSONObject = { id: "FA-3D" };
      if (status) {
        entry["status"] = status;
      }
      expect(readDirector(entry)!.isOnline).toBe(false);
    }
    expect(readDirector({ id: "FA-3D", status: "online" })!.isOnline).toBe(
      true,
    );
    expect(readDirector({})).toBeNull();
  });
});

describe("PowerMaxReading: ports", () => {
  test("names what a port carries in a storage admin's words", () => {
    for (const [entry, protocol] of [
      [{ protocol: "Host_NVMe/FC" }, "NVMe over FC"],
      [{ protocol: "RDF_FC" }, "SRDF over FC"],
      [{ protocol: "RDF_GigE" }, "SRDF over IP"],
      [{ type: "rdf" }, "SRDF over FC"],
      [{ protocol: "Host_iSCSI" }, "iSCSI"],
      [{ iscsi_endpoint: true }, "iSCSI"],
      [{ protocol: "FC" }, "Fibre Channel"],
      [{ protocol: "FICON" }, "FICON"],
      [{ protocol: "GigE" }, "Ethernet"],
      [{ nvmetcp_endpoint: true, protocol: "Host_GigE" }, "NVMe/TCP"],
      [{ protocol: "SAS" }, "SAS"],
      [{ type: "Unknown" }, "Unknown"],
      [{}, "Port"],
    ] as Array<[JSONObject, string]>) {
      expect({ entry, protocol: getPortProtocol(entry) }).toEqual({
        entry,
        protocol,
      });
    }
  });

  test("reads Dell's ports example: director and number, speed, light levels, and who relies on it", () => {
    const [nvme, rdf, iscsi] = enhancedPorts(ARRAY_V4).map(
      (entry: JSONObject): PowerMaxPort | null => {
        return readPort(entry, new Set(["OR-2C:6"]));
      },
    );

    expect(nvme).toEqual({
      id: "OR-3C:35",
      director: "OR-3C",
      port: "35",
      protocol: "NVMe over FC",
      type: "OSHostAndRDF",
      status: "ON",
      isOnline: true,
      isInUse: true,
      speedGbps: 16,
      rxPowerMilliwatts: null,
      txPowerMilliwatts: null,
    });
    // In an SRDF group: in use, though in no port group.
    expect(rdf).toMatchObject({
      id: "OR-2C:6",
      protocol: "SRDF over FC",
      status: "PendOn",
      isOnline: false,
      isInUse: true,
      speedGbps: 32,
      rxPowerMilliwatts: 0.512,
      txPowerMilliwatts: 0.618,
    });
    // In a masking view, offline.
    expect(iscsi).toMatchObject({
      id: "OR-4C:4",
      protocol: "iSCSI",
      isOnline: false,
      isInUse: true,
      speedGbps: 0,
    });
  });

  test("a port in no port group, masking view or SRDF group is not in use", () => {
    const port: PowerMaxPort = readPort(
      {
        director: { id: "FA-1D" },
        port_number: "4",
        port_status: "OFF",
      },
      new Set(),
    )!;
    expect(port.isInUse).toBe(false);
    expect(port.isOnline).toBe(false);
    expect(port.speedGbps).toBeNull();
  });

  test("a port with no director or number is none", () => {
    expect(readPort({ port_number: "4" }, new Set())).toBeNull();
    expect(readPort({ director: { id: "FA-1D" } }, new Set())).toBeNull();
    expect(readPort({ director: "FA-1D", port_number: 0 }, new Set())!.id).toBe(
      "FA-1D:0",
    );
  });

  test("a port's instance in a port performance category is director and unpadded number", () => {
    expect(readPortInstanceId("FA-1D:4")).toBe("FA-1D:4");
    expect(readPortInstanceId("OR-3C:035")).toBe("OR-3C:35");
    expect(readPortInstanceId("FA-1D")).toBeNull();
    expect(readPortInstanceId("bogus")).toBeNull();
  });
});

describe("PowerMaxReading: SRDF groups", () => {
  const [syncGroup, asyncGroup] = enhancedRdfGroups(ARRAY_V4, ARRAY_REMOTE);

  test("the ports an SRDF group replicates through", () => {
    expect(getSrdfGroupPortIds(syncGroup!)).toEqual(["OR-1C:2", "OR-1C:1"]);
    expect(getSrdfGroupPortIds(asyncGroup!)).toEqual([]);
    expect(getSrdfGroupPortIds({ ports: [{ port_number: "1" }, "x"] })).toEqual(
      [],
    );
  });

  test("reads Dell's group 88: synchronous, to the remote array, no lag", () => {
    expect(
      readSrdfGroup(syncGroup!, new Map([["88", ["Synchronized"]]])),
    ).toEqual({
      id: "88",
      label: "SGKG20a5ba",
      type: "Dynamic",
      modes: ["Synchronous"],
      states: ["Synchronized"],
      isOffline: false,
      remoteSymmetrixId: ARRAY_REMOTE,
      remoteGroup: "88",
      lagSeconds: null,
      volumeCount: 1,
      capacityBytes: 3.22 * GB,
      isWitnessDegraded: false,
    });
  });

  test("an asynchronous group's lag is its RDFA R1 to R2 lag", () => {
    expect(readSrdfGroup(asyncGroup!, new Map())!.lagSeconds).toBe(42);
  });

  test("a group with no id is none", () => {
    expect(readSrdfGroup({ label: "x" }, new Map())).toBeNull();
  });

  test("an older Unisphere's groups come from its storage groups' SRDF infos", () => {
    const groups: Array<PowerMaxStorageGroup> = v4Array().storageGroups.map(
      (entry: JSONObject): PowerMaxStorageGroup => {
        return readStorageGroup(entry, new Set())!;
      },
    );

    expect(deriveSrdfGroupsFromStorageGroups(groups)).toEqual([
      expect.objectContaining({
        id: "88",
        states: ["Synchronized"],
        modes: ["Synchronous"],
      }),
      expect.objectContaining({
        id: "12",
        states: ["Suspended"],
        modes: ["Asynchronous"],
      }),
    ]);
    expect(getSrdfStatesByGroup(groups)).toEqual(
      new Map([
        ["88", ["Synchronized"]],
        ["12", ["Suspended"]],
      ]),
    );
  });

  test("two storage groups replicated through one SRDF group add up their states", () => {
    const base: PowerMaxStorageGroup = readStorageGroup(
      { id: "A" },
      new Set(),
    )!;
    expect(
      deriveSrdfGroupsFromStorageGroups([
        {
          ...base,
          id: "A",
          srdfGroups: ["5"],
          srdfStates: ["Consistent"],
          srdfModes: ["Asynchronous"],
        },
        {
          ...base,
          id: "B",
          srdfGroups: ["5"],
          srdfStates: ["Partitioned"],
          srdfModes: ["Asynchronous"],
        },
      ])[0],
    ).toMatchObject({
      id: "5",
      states: ["Consistent", "Partitioned"],
      modes: ["Asynchronous"],
    });
  });

  test("a group is unhealthy when its link is offline or a pair is broken", () => {
    const group: PowerMaxSrdfGroup = readSrdfGroup(syncGroup!, new Map())!;
    expect(getSrdfGroupProblem(group)).toBeNull();
    expect(getSrdfGroupProblem({ ...group, isOffline: true })).toBe("Offline");
    expect(
      getSrdfGroupProblem({ ...group, states: ["Synchronized", "Suspended"] }),
    ).toBe("Suspended");
    expect(getSrdfGroupProblem({ ...group, states: ["Trans Idle"] })).toBe(
      "Trans Idle",
    );
    expect(
      getSrdfGroupProblem({ ...group, states: ["SyncInProg", "Consistent"] }),
    ).toBeNull();
  });
});

describe("PowerMaxReading: alerts", () => {
  test("Critical and Fatal are critical, Warning and Minor warning", () => {
    for (const [severity, mapped] of [
      ["FATAL", "critical"],
      ["CRITICAL", "critical"],
      ["WARNING", "warning"],
      ["MINOR", "warning"],
      ["critical", "critical"],
    ] as Array<[string, string]>) {
      expect(
        readAlert(alert({ alertId: "a", symmetrixId: ARRAY_V4, severity }))!
          .severity,
      ).toBe(mapped);
    }
  });

  test("Dell's example alert, INFORMATION, is not open; nor is Normal", () => {
    expect(
      readAlert(
        alert({ alertId: "a", symmetrixId: ARRAY_V4, severity: "INFORMATION" }),
      ),
    ).toBeNull();
    expect(
      readAlert(
        alert({ alertId: "a", symmetrixId: ARRAY_V4, severity: "NORMAL" }),
      ),
    ).toBeNull();
  });

  test("an acknowledged or cleared alert is not open", () => {
    expect(
      readAlert(
        alert({
          alertId: "a",
          symmetrixId: ARRAY_V4,
          severity: "CRITICAL",
          acknowledged: true,
        }),
      ),
    ).toBeNull();
    for (const state of ["CLEARED", "ACKNOWLEDGED", "cleared"]) {
      expect(
        readAlert(
          alert({
            alertId: "a",
            symmetrixId: ARRAY_V4,
            severity: "CRITICAL",
            state,
          }),
        ),
      ).toBeNull();
    }
  });

  test("reads what the alert is about, and when it was raised", () => {
    const expected: PowerMaxAlert = {
      id: "7b15910a",
      severity: "critical",
      type: "ARRAY",
      object: "OR-2C",
      objectType: "Director",
      description: "Director OR-2C is offline.",
      createdMs: 1629119437000,
    };
    expect(
      readAlert(
        alert({
          alertId: "7b15910a",
          symmetrixId: ARRAY_V4,
          severity: "CRITICAL",
          type: "ARRAY",
          object: "OR-2C",
          objectType: "Director",
          description: "Director OR-2C is offline.",
          createdMs: 1629119437000,
        }),
      ),
    ).toEqual(expected);
  });

  test("a description is cut to 500 characters; none is Unisphere alert", () => {
    expect(
      readAlert({
        alertId: "a",
        severity: "WARNING",
        description: "y".repeat(800),
      })!.description,
    ).toHaveLength(500);
    expect(readAlert({ alertId: "a", severity: "WARNING" })!.description).toBe(
      "Unisphere alert",
    );
    expect(readAlert({ severity: "WARNING" })).toBeNull();
  });
});

describe("PowerMaxReading: performance", () => {
  test("a category not read has no instances", () => {
    const reading: Pick<PowerMaxArrayReading, "performance"> = {
      performance: new Map([
        ["Array", [{ id: ARRAY_V4, metrics: {}, timestampMs: 1 }]],
      ]),
    };
    expect(getInstances(reading as PowerMaxArrayReading, "Array")).toHaveLength(
      1,
    );
    expect(getInstances(reading as PowerMaxArrayReading, "SRP")).toEqual([]);
  });
});

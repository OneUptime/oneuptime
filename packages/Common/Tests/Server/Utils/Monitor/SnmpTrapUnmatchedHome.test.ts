import Probe from "../../../../Models/DatabaseModels/Probe";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import ProbeService from "../../../../Server/Services/ProbeService";
import SnmpTrapUnmatchedHome, {
  SnmpTrapUnmatchedHomeResult,
} from "../../../../Server/Utils/Monitor/SnmpTrapUnmatchedHome";
import SnmpTrap from "../../../../Types/Monitor/SnmpMonitor/SnmpTrap";
import SnmpSecurityLevel from "../../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import ObjectID from "../../../../Types/ObjectID";
import { SnmpV3CredentialHolders } from "../../../../Types/Probe/SnmpV3CredentialHolders";
import { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHERE A TRAP FROM AN ADDRESS NO DEVICE HAS IS KEPT (#11174).
 *
 * A new device's first trap is kept as from an unknown source, so its event
 * offers Add as device - but only in a project that can be told it is
 * theirs. A project's own probe: its project. A global probe serves many,
 * and keeps an SNMPv3 trap it authenticated only for the one project whose
 * credential signed it, and only while that project uses the probe.
 */

const PROBE: ObjectID = new ObjectID("11740000-0000-4000-8000-000000000001");
const ACME: ObjectID = new ObjectID("11740000-0000-4000-8000-00000000ac0e");
const GLOBEX: ObjectID = new ObjectID("11740000-0000-4000-8000-000000060be8");
const SITE: ObjectID = new ObjectID("11740000-0000-4000-8000-000000000501");
const OTHER_SITE: ObjectID = new ObjectID(
  "11740000-0000-4000-8000-000000000502",
);

function probe(fields: { isGlobalProbe: boolean; projectId?: ObjectID }): Probe {
  const model: Probe = new Probe(PROBE);
  model.isGlobalProbe = fields.isGlobalProbe;

  if (fields.projectId) {
    model.projectId = fields.projectId;
  }

  return model;
}

function trap(fields: Partial<SnmpTrap> = {}): SnmpTrap {
  return {
    sourceIpAddress: "198.51.100.40",
    trapOid: "1.3.6.1.6.3.1.1.5.1",
    snmpVersion: "3",
    securityName: "site-default",
    securityLevel: SnmpSecurityLevel.AuthPriv,
    receivedAt: new Date("2026-11-27T10:00:00.000Z"),
    varbinds: [],
    ...fields,
  };
}

function signedBy(
  projects: Array<ObjectID>,
  sites: Array<ObjectID> = [],
): SnmpV3CredentialHolders {
  return {
    projectIds: projects.map((id: ObjectID): string => {
      return id.toString();
    }),
    deviceIds: [],
    siteIds: sites.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

let findProbe: MockFunction;
let findProbeUse: MockFunction;

function probeIs(model: Probe | null): void {
  findProbe.mockResolvedValue(model as never);
}

function projectUses(use: { isUsed: boolean; siteIds: Array<string> }): void {
  findProbeUse.mockResolvedValue(use as never);
}

async function home(
  receivedTrap: SnmpTrap,
): Promise<{ projectId: string; siteId?: string } | null> {
  const found: SnmpTrapUnmatchedHomeResult | null =
    await SnmpTrapUnmatchedHome.find({ probeId: PROBE, trap: receivedTrap });

  if (!found) {
    return null;
  }

  return {
    projectId: found.projectId.toString(),
    ...(found.siteId ? { siteId: found.siteId.toString() } : {}),
  };
}

beforeEach(() => {
  SnmpTrapUnmatchedHome.clearCache();
  findProbe = jest
    .spyOn(ProbeService, "findOneById")
    .mockResolvedValue(null as never) as unknown as MockFunction;
  findProbeUse = jest
    .spyOn(NetworkDeviceService, "findProbeUseByProject")
    .mockResolvedValue({ isUsed: false, siteIds: [] } as never) as unknown as MockFunction;
});

afterEach(() => {
  jest.restoreAllMocks();
  SnmpTrapUnmatchedHome.clearCache();
});

describe("a project's own probe", () => {
  test("keeps it in its project, as it always has, and reads nothing more", async () => {
    probeIs(probe({ isGlobalProbe: false, projectId: ACME }));

    for (const received of [
      trap({ snmpVersion: "2c", securityLevel: undefined }),
      trap({ securityLevel: SnmpSecurityLevel.NoAuthNoPriv }),
      trap(),
      trap({ signedBy: signedBy([ACME]) }),
    ]) {
      expect(await home(received)).toEqual({ projectId: ACME.toString() });
    }

    expect(findProbeUse).not.toHaveBeenCalled();
  });

  test("with the site whose default signed it, once that site is checked to name the probe", async () => {
    probeIs(probe({ isGlobalProbe: false, projectId: ACME }));
    projectUses({ isUsed: true, siteIds: [SITE.toString()] });

    expect(await home(trap({ signedBy: signedBy([ACME], [SITE]) }))).toEqual({
      projectId: ACME.toString(),
      siteId: SITE.toString(),
    });
    expect(findProbeUse).toHaveBeenCalledWith({
      probeId: PROBE,
      projectId: ACME,
      siteIds: [SITE.toString()],
    });
  });

  test("a site that does not check out names none, and the trap is still its project's", async () => {
    probeIs(probe({ isGlobalProbe: false, projectId: ACME }));
    projectUses({ isUsed: true, siteIds: [] });

    expect(await home(trap({ signedBy: signedBy([ACME], [SITE]) }))).toEqual({
      projectId: ACME.toString(),
    });
  });

  test("two sites whose defaults it could be name none: Add as device asks", async () => {
    probeIs(probe({ isGlobalProbe: false, projectId: ACME }));
    projectUses({
      isUsed: true,
      siteIds: [SITE.toString(), OTHER_SITE.toString()],
    });

    expect(
      await home(trap({ signedBy: signedBy([ACME], [SITE, OTHER_SITE]) })),
    ).toEqual({ projectId: ACME.toString() });
  });
});

describe("a global probe", () => {
  test("keeps an authenticated SNMPv3 trap in the one project whose credential signed it", async () => {
    probeIs(probe({ isGlobalProbe: true }));
    projectUses({ isUsed: true, siteIds: [SITE.toString()] });

    expect(await home(trap({ signedBy: signedBy([ACME], [SITE]) }))).toEqual({
      projectId: ACME.toString(),
      siteId: SITE.toString(),
    });
  });

  test("not while that project does not use the probe: the probe only says whose credential it was", async () => {
    probeIs(probe({ isGlobalProbe: true }));
    projectUses({ isUsed: false, siteIds: [] });

    expect(await home(trap({ signedBy: signedBy([ACME]) }))).toBeNull();
  });

  test("not a credential two projects hold: it cannot say whose the trap is", async () => {
    probeIs(probe({ isGlobalProbe: true }));
    projectUses({ isUsed: true, siteIds: [] });

    expect(await home(trap({ signedBy: signedBy([ACME, GLOBEX]) }))).toBeNull();
    expect(findProbeUse).not.toHaveBeenCalled();
  });

  test("not a v1, v2c or noAuthNoPriv trap, nor one that says nothing of who signed it", async () => {
    probeIs(probe({ isGlobalProbe: true }));
    projectUses({ isUsed: true, siteIds: [] });

    for (const received of [
      trap({ snmpVersion: "2c", securityLevel: undefined }),
      trap({
        securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
        signedBy: signedBy([ACME]),
      }),
      trap(),
      trap({ snmpVersion: "1", signedBy: signedBy([ACME]) }),
    ]) {
      expect(await home(received)).toBeNull();
    }
  });

  test("whether a project uses the probe is asked once a minute, not once a trap", async () => {
    probeIs(probe({ isGlobalProbe: true }));
    projectUses({ isUsed: true, siteIds: [] });

    for (let index: number = 0; index < 5; index++) {
      expect(await home(trap({ signedBy: signedBy([ACME]) }))).toEqual({
        projectId: ACME.toString(),
      });
    }

    expect(findProbeUse).toHaveBeenCalledTimes(1);
  });
});

test("a probe that is not there keeps nothing", async () => {
  probeIs(null);

  expect(await home(trap({ signedBy: signedBy([ACME]) }))).toBeNull();
});

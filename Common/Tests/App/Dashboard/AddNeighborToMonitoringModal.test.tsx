import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";

/*
 * Issue #3435 — what the "Add to Monitoring" dialog actually opens with.
 *
 * AdoptNeighborUtil.test.ts (in App/Tests) proves the pre-fill RULES are
 * right. This proves the dialog hangs them off the right fields, having first
 * asked the map's own devices what site and probe to inherit — and that is
 * the half a refactor drops silently, because dropping a key from an
 * initialValues object is type-safe, render-safe, and puts the operator back
 * to retyping what OneUptime already discovered.
 *
 * Every device the dialog creates is probe-polled: there is no monitoring
 * method to choose, the probe is required for a phone exactly as for a
 * switch, and the SNMP step is optional for both. The cases below that used
 * to split on "will this device be polled?" now assert that no such split
 * exists.
 *
 * The form itself is configuration passed as props, so ModelFormModal is
 * mocked to capture them and the capture is asserted directly — the same
 * approach DiscoveryScanWizardValidation.test.tsx uses for the Discovery
 * page's ModelTable.
 */

type CapturedModalProps = {
  title: string;
  description: string;
  initialValues: Record<string, unknown>;
  onBeforeCreate?:
    | ((
        item: NetworkDevice,
        miscDataProps: Record<string, unknown>,
      ) => Promise<NetworkDevice>)
    | undefined;
  formProps: {
    steps: Array<{ id: string; title: string; showIf?: unknown }>;
    fields: Array<{
      field: Record<string, boolean>;
      required?: boolean | undefined;
      stepId?: string | undefined;
      dropdownOptions?: Array<{ label: string; value: string }> | undefined;
    }>;
  };
};

let captured: CapturedModalProps | null = null;

jest.mock(
  "../../../UI/Components/ModelFormModal/ModelFormModal",
  (): Record<string, unknown> => {
    return {
      __esModule: true,
      default: (props: CapturedModalProps): React.ReactElement => {
        captured = props;
        return <div data-testid="model-form-modal" />;
      },
    };
  },
);

/*
 * The two lists the dialog reads before it can pre-fill anything: the
 * project's probes (so the inherited one has an option to match) and the
 * devices this peer is cabled to (so there is something to inherit).
 */
const PROBES: Array<{ _id: string; name: string }> = [
  { _id: "probe-a", name: "Branch probe" },
  { _id: "probe-b", name: "Datacenter probe" },
];

let neighborRows: Array<Record<string, unknown>> = [];
/*
 * Captured so the tests can assert WHICH devices were asked about, not just
 * what came back. A mock that ignores its query answers "the neighbours
 * disagree" identically whether the dialog looked up the right switches or
 * no switches at all.
 */
let neighborQueries: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/Probe",
  (): Record<string, unknown> => {
    return {
      __esModule: true,
      default: {
        getAllProbes: () => {
          return Promise.resolve(PROBES);
        },
      },
    };
  },
);

jest.mock(
  "../../../UI/Utils/ModelAPI/ModelAPI",
  (): Record<string, unknown> => {
    return {
      __esModule: true,
      default: {
        getList: (request: Record<string, unknown>) => {
          neighborQueries.push(request);
          return Promise.resolve({ data: neighborRows, count: 0 });
        },
      },
    };
  },
);

import AddNeighborToMonitoringModal from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/AddNeighborToMonitoringModal";

const SWITCH_NODE: NetworkTopologyNode = {
  id: "switch-1",
  name: "UN1289LANSWI01",
  isManaged: true,
  kind: "device",
  role: "switch",
  status: "up",
};

const SECOND_SWITCH_NODE: NetworkTopologyNode = {
  id: "switch-2",
  name: "UN1289LANSWI02",
  isManaged: true,
  kind: "device",
  role: "switch",
  status: "up",
};

/*
 * Carries the role stamp the topology builder puts on a node now that roles
 * are per-project rows: `roleId` is the project's row for the classified role,
 * and it is what the form can actually preselect - the role is a relation, and
 * a form cannot resolve a key to a row.
 */
const PHONE_ROLE_ID: string = "b7a1a0f6-3a4b-4a0e-9c3f-4f1f7f2a91cd";

const SWITCH_ROLE_ID: string = "0c2d5b41-9f22-4a3e-8f61-2d7c6a4e8b03";

const PHONE_NODE: NetworkTopologyNode = {
  id: "unmanaged:sep6026aaf2b46b",
  name: "SEP6026AAF2B46B",
  isManaged: false,
  kind: "unmanaged",
  role: "phone",
  roleKey: "phone",
  roleLabel: "IP phone",
  roleId: PHONE_ROLE_ID,
  isSnmpWalkableRole: false,
  status: "unknown",
  deviceModel: "Cisco IP Phone 8811",
  ipAddress: "10.0.12.41",
};

const PHONE_EDGE: NetworkTopologyEdge = {
  fromNodeId: "switch-1",
  toNodeId: "unmanaged:sep6026aaf2b46b",
  fromPort: "GigabitEthernet1/0/12",
  toPort: "SW PORT",
  protocols: ["cdp"],
};

async function openDialog(
  node: NetworkTopologyNode = PHONE_NODE,
  edges: Array<NetworkTopologyEdge> = [PHONE_EDGE],
): Promise<CapturedModalProps> {
  const nodeById: Map<string, NetworkTopologyNode> = new Map<
    string,
    NetworkTopologyNode
  >([
    [SWITCH_NODE.id, SWITCH_NODE],
    [SECOND_SWITCH_NODE.id, SECOND_SWITCH_NODE],
    [node.id, node],
  ]);

  render(
    <MemoryRouter>
      <AddNeighborToMonitoringModal
        node={node}
        edges={edges}
        nodeById={nodeById}
        onClose={() => {}}
        onSuccess={() => {}}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(captured).not.toBeNull();
  });

  return captured!;
}

function fieldFor(
  props: CapturedModalProps,
  name: string,
): { required?: boolean | undefined } | undefined {
  return props.formProps.fields.find(
    (candidate: { field: Record<string, boolean> }) => {
      return Boolean(candidate.field[name]);
    },
  );
}

describe("the Add to Monitoring dialog", () => {
  beforeEach(() => {
    captured = null;
    neighborQueries = [];
    neighborRows = [{ _id: "switch-1", probeId: "probe-a", siteId: "site-a" }];
  });

  afterEach(() => {
    cleanup();
  });

  /*
   * THE assertion. The topology builder re-matches a neighbour report to a
   * managed device by comparing the advertised string against the device's
   * name and hostname after nothing more forgiving than trim-and-lowercase,
   * so a decorated name leaves the peer on the map as a separate node beside
   * the device that was supposed to replace it.
   */
  test("opens with the advertised name and address, undecorated", async () => {
    const props: CapturedModalProps = await openDialog();

    expect(props.initialValues["name"]).toBe("SEP6026AAF2B46B");
    expect(props.initialValues["hostname"]).toBe("10.0.12.41");
  });

  test("carries the platform string and where the device was found", async () => {
    const props: CapturedModalProps = await openDialog();

    expect(props.initialValues["description"]).toBe(
      "Cisco IP Phone 8811. Discovered by CDP as a neighbour of UN1289LANSWI01 (GigabitEthernet1/0/12).",
    );
    expect(props.description).toContain("UN1289LANSWI01");
  });

  test("opens on the role the map classified the device as", async () => {
    const props: CapturedModalProps = await openDialog();

    /*
     * The row's id, not the classifier's key: the role is a relation to the
     * project's own NetworkDeviceRole table, so this is what the picker binds
     * to and what a rename or a custom role travels through.
     */
    expect(props.initialValues["networkDeviceRole"]).toBe(PHONE_ROLE_ID);
  });

  /*
   * There is no monitoring-method question any more. A phone is never
   * SNMP-walkable, but it is pingable — and pinging is all a probe-polled
   * device needs to have a status — so the dialog asks nothing and writes
   * Probe on the way out. ModelForm sends only the fields it renders, which
   * is why the method travels through onBeforeCreate rather than
   * initialValues: a seeded value with no field behind it would never reach
   * the server.
   */
  test("asks no monitoring-method question and writes Probe on the way out", async () => {
    const props: CapturedModalProps = await openDialog();

    expect(fieldFor(props, "monitoringMethod")).toBeUndefined();
    expect(props.initialValues["monitoringMethod"]).toBeUndefined();
    expect(props.onBeforeCreate).toBeDefined();

    const device: NetworkDevice = await props.onBeforeCreate!(
      new NetworkDevice(),
      {},
    );

    expect(device.monitoringMethod).toBe("Probe");
  });

  /*
   * And the same for an infrastructure peer: the method is not a function of
   * the role, so a switch and a phone leave the dialog identically.
   */
  test("writes Probe for a walkable peer too", async () => {
    const props: CapturedModalProps = await openDialog({
      ...PHONE_NODE,
      role: "switch",
      roleKey: "switch",
      roleLabel: "Switch",
      roleId: SWITCH_ROLE_ID,
      isSnmpWalkableRole: true,
    });

    const device: NetworkDevice = await props.onBeforeCreate!(
      new NetworkDevice(),
      {},
    );

    expect(device.monitoringMethod).toBe("Probe");
  });

  /*
   * A device on a switch port is on that switch's network, so the probe that
   * reaches the switch reaches it and the site that contains the switch
   * contains it. This is the difference between a form the operator can
   * submit as it stands and one with two more decisions in it.
   */
  test("inherits the site of the device it is cabled to", async () => {
    const props: CapturedModalProps = await openDialog();

    expect(props.initialValues["site"]).toBe("site-a");
  });

  /*
   * And asks about the RIGHT devices. Reading the site off whatever the
   * server happened to return would inherit from an unrelated device the
   * moment the query drifted, and no assertion about the returned values
   * can tell the two apart.
   */
  test("asks only about the devices this peer is cabled to", async () => {
    await openDialog();

    const query: Record<string, unknown> = (neighborQueries[0]?.["query"] ||
      {}) as Record<string, unknown>;
    const idFilter: { values?: Array<string> } = query["_id"] as {
      values?: Array<string>;
    };

    expect(neighborQueries).toHaveLength(1);
    expect(idFilter?.values).toEqual(["switch-1"]);
    expect(neighborQueries[0]?.["select"]).toEqual({
      _id: true,
      probeId: true,
      siteId: true,
    });
  });

  /*
   * A peer with no managed neighbour left has nothing to inherit from, and
   * asking the server about an empty id list would either error or return
   * the whole fleet.
   */
  test("asks about nothing when the peer has no managed neighbour", async () => {
    const props: CapturedModalProps = await openDialog(PHONE_NODE, []);

    expect(neighborQueries).toHaveLength(0);
    expect(props.initialValues["site"]).toBeUndefined();
    expect(props.initialValues["probe"]).toBeUndefined();
  });

  /*
   * The probe is inherited for EVERY device. It used to be withheld from a
   * leaf device, which opened on a monitor-backed branch with the probe
   * field hidden; a phone is as probe-polled as a switch now, so the probe
   * its neighbours agree on is the right head start for both. The phone
   * fixture carries the handset's isSnmpWalkableRole: false, which is
   * exactly the case the seed used to be withheld from.
   */
  test("inherits a probe for a leaf device", async () => {
    const props: CapturedModalProps = await openDialog();

    expect(props.initialValues["probe"]).toBe("probe-a");
  });

  test("inherits a probe for a walkable device", async () => {
    const props: CapturedModalProps = await openDialog({
      ...PHONE_NODE,
      role: "switch",
      roleKey: "switch",
      roleLabel: "Switch",
      roleId: SWITCH_ROLE_ID,
      isSnmpWalkableRole: true,
    });

    expect(props.initialValues["probe"]).toBe("probe-a");
  });

  /*
   * Required for a phone exactly as for a switch: a probe-polled device with
   * no probe is claimed by nothing and never polls, which is the "Pending
   * forever" this flow exists to end. The server does not insist, so the
   * form does.
   */
  test("requires a probe for a leaf device", async () => {
    const props: CapturedModalProps = await openDialog();

    expect(fieldFor(props, "probe")?.required).toBe(true);
  });

  /*
   * A device silently filed in the wrong site is worse than an empty field,
   * and a probe that cannot reach the device produces a monitored device
   * that is permanently down. Disagreement leaves both to the operator.
   */
  test("inherits nothing when the neighbouring devices disagree", async () => {
    neighborRows = [
      { _id: "switch-1", probeId: "probe-a", siteId: "site-a" },
      { _id: "switch-2", probeId: "probe-b", siteId: "site-b" },
    ];

    const props: CapturedModalProps = await openDialog({
      ...PHONE_NODE,
      role: "switch",
    });

    expect(props.initialValues["site"]).toBeUndefined();
    expect(props.initialValues["probe"]).toBeUndefined();
  });

  /*
   * No Monitor binding field at all. The binding is the override for gear a
   * probe cannot reach, chosen on a device's Settings page; a neighbour the
   * probe just heard about from the switch beside it is, by construction,
   * reachable — so the dialog does not offer a field whose only honest value
   * here is "empty".
   */
  test("has no monitor binding field", async () => {
    const props: CapturedModalProps = await openDialog();

    expect(fieldFor(props, "monitor")).toBeUndefined();
  });

  test("still demands the two things a device cannot exist without", async () => {
    const props: CapturedModalProps = await openDialog();

    expect(fieldFor(props, "name")?.required).toBe(true);
    expect(fieldFor(props, "hostname")?.required).toBe(true);
  });

  /*
   * The address is optional on the wire — lldpRemManAddrTable is optional and
   * cdpCacheAddress is frequently empty — and hostname is NOT NULL, so the
   * dialog has to hand the operator an empty required field and say why
   * rather than pre-filling something that cannot work.
   */
  test("leaves the address empty, and says so, when none was advertised", async () => {
    const props: CapturedModalProps = await openDialog({
      ...PHONE_NODE,
      ipAddress: undefined,
    });

    expect(props.initialValues["hostname"]).toBe("");
    expect(props.description).toContain("No management address");
  });

  test("offers the project's probes as the probe options", async () => {
    const props: CapturedModalProps = await openDialog({
      ...PHONE_NODE,
      role: "switch",
    });

    expect(
      props.formProps.fields.find(
        (candidate: { field: Record<string, boolean> }) => {
          return Boolean(candidate.field["probe"]);
        },
      )?.dropdownOptions,
    ).toEqual([
      { label: "Branch probe", value: "probe-a" },
      { label: "Datacenter probe", value: "probe-b" },
    ]);
  });

  test("walks the operator through Device Details, Probe & Site and SNMP", async () => {
    const props: CapturedModalProps = await openDialog();

    expect(
      props.formProps.steps.map((step: { id: string }) => {
        return step.id;
      }),
    ).toEqual(["device-details", "probe-and-site", "snmp"]);
  });

  /*
   * The SNMP step is walked through by every device, a phone included. It
   * used to be hidden wholesale for a leaf device (nothing polled it, so
   * nothing could use a credential); now the probe walks whatever it has
   * credentials for, and leaving the step empty is the "ping only" answer.
   */
  test("shows the SNMP step to a leaf device, unconditionally", async () => {
    const props: CapturedModalProps = await openDialog();

    const snmpStep: { id: string; showIf?: unknown } | undefined =
      props.formProps.steps.find((step: { id: string }) => {
        return step.id === "snmp";
      });

    expect(snmpStep).toBeDefined();
    expect(snmpStep?.showIf).toBeUndefined();
    expect(fieldFor(props, "snmpVersion")).toBeDefined();
    expect(fieldFor(props, "snmpCommunityString")?.required).toBe(false);
  });

  /*
   * Every step the wizard declares is claimed by a field, and every field
   * names a declared step — the two silent failures NetworkFormStepsInvariants
   * pins against the source, asserted here against the props the form is
   * actually handed.
   */
  test("every field lands on a step the wizard declares, and no step is empty", async () => {
    const props: CapturedModalProps = await openDialog();

    const declared: Array<string> = props.formProps.steps.map(
      (step: { id: string }) => {
        return step.id;
      },
    );
    const used: Array<string> = props.formProps.fields.map(
      (field: { stepId?: string | undefined }) => {
        return field.stepId || "";
      },
    );

    for (const stepId of used) {
      expect(declared).toContain(stepId);
    }

    for (const stepId of declared) {
      expect(used).toContain(stepId);
    }
  });
});

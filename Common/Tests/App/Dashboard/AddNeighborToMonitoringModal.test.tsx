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
 * The form itself is configuration passed as props, so ModelFormModal is
 * mocked to capture them and the capture is asserted directly — the same
 * approach DiscoveryScanWizardValidation.test.tsx uses for the Discovery
 * page's ModelTable.
 */

type CapturedModalProps = {
  title: string;
  description: string;
  initialValues: Record<string, unknown>;
  formProps: {
    steps: Array<{ id: string; title: string }>;
    fields: Array<{
      field: Record<string, boolean>;
      required?: boolean | undefined;
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

const PHONE_NODE: NetworkTopologyNode = {
  id: "unmanaged:sep6026aaf2b46b",
  name: "SEP6026AAF2B46B",
  isManaged: false,
  kind: "unmanaged",
  role: "phone",
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

    expect(props.initialValues["deviceRole"]).toBe("phone");
  });

  /*
   * A phone is never SNMP-walkable, so opening on SNMP would create a device
   * that queues a walk it can only fail and then reads "pending" forever.
   */
  test("opens a leaf device on monitor-backed rather than SNMP", async () => {
    const props: CapturedModalProps = await openDialog();

    expect(props.initialValues["monitoringMethod"]).toBe("Monitor");
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
   * The probe is only offered to a device something will actually poll —
   * a monitor-backed device has no poller, and the field is hidden on that
   * branch anyway.
   */
  test("inherits a probe for a device that will be polled", async () => {
    const props: CapturedModalProps = await openDialog({
      ...PHONE_NODE,
      role: "switch",
    });

    expect(props.initialValues["monitoringMethod"]).toBe("SNMP");
    expect(props.initialValues["probe"]).toBe("probe-a");
  });

  test("does not hand a probe to a device nothing will poll", async () => {
    const props: CapturedModalProps = await openDialog();

    expect(props.initialValues["probe"]).toBeUndefined();
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
   * The create form on the Devices list requires a monitor for a
   * monitor-backed device. Here it must not: an operator adopting a phone
   * from the map has no Ping monitor for it yet, and the server has always
   * allowed the two to be bound later — the same contract the discovery
   * import relies on.
   */
  test("does not demand a monitor that does not exist yet", async () => {
    const props: CapturedModalProps = await openDialog();

    expect(fieldFor(props, "monitor")?.required).toBe(false);
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

  test("walks the operator through the same steps the Devices form does", async () => {
    const props: CapturedModalProps = await openDialog();

    expect(
      props.formProps.steps.map((step: { id: string }) => {
        return step.id;
      }),
    ).toEqual([
      "monitoring-method",
      "device-details",
      "probe-and-site",
      "snmp",
    ]);
  });
});

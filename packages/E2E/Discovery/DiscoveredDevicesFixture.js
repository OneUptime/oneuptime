/*
 * The Discovered Devices list, offline (OneUptime issue #5775): every device
 * two offices' switches, a router's ARP table and a network controller have
 * seen, answered by the in-memory list API the rendered Dashboard suites use
 * (Common/Tests/App/Dashboard/DiscoveredDevicesFakeServer) - the search,
 * counts, sort, paging, select-all and Hide from map / Show on map are the
 * server's, row by row.
 *
 * Synthetic and worked out from position, never random: a head office with
 * a lobby camera, a printer, desk phones and a device with no address yet;
 * a warehouse whose label printer and scanners sit on another switch; a
 * spare laptop hidden from the map and not seen for days; a projector no
 * switch has seen for ten days; a router that is already a monitored
 * device. 21 devices: 20 not monitored (the laptop is hidden), 1 monitored.
 */
import DiscoveredDevicesFakeServer from "Common/Tests/App/Dashboard/DiscoveredDevicesFakeServer";

export const HEAD_OFFICE = {
  id: "52000000-0000-4000-8000-000000000001",
  name: "Head office",
};
export const WAREHOUSE = {
  id: "52000000-0000-4000-8000-000000000002",
  name: "Warehouse",
};

// The switches that saw them: devices the project monitors.
const CORE_SWITCH = {
  id: "53000000-0000-4000-8000-000000000001",
  name: "core-sw-01",
};
const ACCESS_SWITCH = {
  id: "53000000-0000-4000-8000-000000000002",
  name: "access-sw-02",
};
const WAREHOUSE_SWITCH = {
  id: "53000000-0000-4000-8000-000000000003",
  name: "warehouse-sw-01",
};

export const BRANCH_ROUTER_DEVICE = {
  id: "53000000-0000-4000-8000-000000000010",
  name: "branch-rtr-01",
};

export function discoveredDeviceId(index) {
  return `51000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const MINUTE = 60000;

function ago(minutes) {
  return new Date(Date.now() - minutes * MINUTE).toISOString();
}

function hex(value) {
  return value.toString(16).padStart(2, "0");
}

function mac(index) {
  return `00:1a:2b:3c:${hex(Math.floor(index / 256))}:${hex(index % 256)}`;
}

function row(index, fields) {
  const site = fields.site || HEAD_OFFICE;
  const seenOn = fields.seenOn || ACCESS_SWITCH;
  const result = {
    id: discoveredDeviceId(index),
    name: fields.name,
    macAddress: fields.macAddress || mac(index),
    site: { id: site.id, name: site.name },
    siteId: site.id,
    seenOn: { id: seenOn.id, name: seenOn.name },
    portName: fields.portName || `Gi1/0/${index}`,
    vlanId: fields.vlanId === undefined ? 20 : fields.vlanId,
    firstSeenAt: ago(60 * 24 * 30 + index),
    lastSeenAt: ago(fields.lastSeenMinutesAgo || 4 + index),
    isSeenRecently: fields.isSeenRecently !== false,
    isFromController: fields.isFromController === true,
    isHidden: fields.isHidden === true,
  };

  for (const key of ["ipAddress", "hostname", "vendor", "classification"]) {
    if (fields[key]) {
      result[key] = fields[key];
    }
  }

  if (fields.monitoredDevice) {
    result.monitoredDevice = fields.monitoredDevice;
    result.monitoredBy = "macAddress";
  }

  if (fields.vlanId === null) {
    delete result.vlanId;
  }

  return result;
}

export function buildDiscoveredDevices() {
  const rows = [
    row(1, {
      name: "Lobby camera",
      classification: "Lobby camera",
      hostname: "cam-lobby.example.internal",
      ipAddress: "10.20.0.11",
      vendor: "Axis Communications",
      vlanId: 30,
    }),
    row(2, {
      name: "printer-2f.example.internal",
      hostname: "printer-2f.example.internal",
      ipAddress: "10.20.0.12",
      vendor: "HP",
    }),
    // A router's ARP table has not bound it to an address yet.
    row(3, {
      name: "00:1a:2b:3c:00:03",
      vendor: "Raspberry Pi Trading",
      seenOn: CORE_SWITCH,
      portName: "Gi1/0/24",
      vlanId: 99,
    }),
    row(4, {
      name: "Spare laptop",
      classification: "Spare laptop",
      hostname: "laptop-spare-04.example.internal",
      ipAddress: "10.20.0.14",
      vendor: "Dell",
      isHidden: true,
      isSeenRecently: false,
      lastSeenMinutesAgo: 60 * 24 * 3,
    }),
    row(5, {
      name: "Branch router",
      classification: "Branch router",
      ipAddress: "10.20.0.1",
      vendor: "Cisco",
      seenOn: CORE_SWITCH,
      portName: "Gi1/0/1",
      vlanId: 1,
      monitoredDevice: BRANCH_ROUTER_DEVICE,
    }),
    // On the map still, but no switch has seen it for ten days.
    row(6, {
      name: "projector-3f.example.internal",
      hostname: "projector-3f.example.internal",
      ipAddress: "10.20.0.16",
      vendor: "Epson",
      isSeenRecently: false,
      lastSeenMinutesAgo: 60 * 24 * 10,
    }),
  ];

  // Ten desk phones on the voice VLAN, named by DHCP.
  for (let phone = 0; phone < 10; phone++) {
    rows.push(
      row(10 + phone, {
        name: `desk-phone-${101 + phone}`,
        hostname: `desk-phone-${101 + phone}`,
        ipAddress: `10.20.1.${101 + phone}`,
        vendor: "Yealink",
        vlanId: 40,
      }),
    );
  }

  rows.push(
    row(30, {
      name: "Label printer",
      classification: "Label printer",
      hostname: "label-printer-01.example.internal",
      ipAddress: "10.30.0.21",
      vendor: "Zebra Technologies",
      site: WAREHOUSE,
      seenOn: WAREHOUSE_SWITCH,
    }),
    // A network controller's client list placed it, not a walk.
    row(31, {
      name: "door-controller",
      hostname: "door-controller",
      ipAddress: "10.30.0.40",
      vendor: "HID Global",
      site: WAREHOUSE,
      seenOn: WAREHOUSE_SWITCH,
      isFromController: true,
      vlanId: null,
    }),
  );

  for (let scanner = 0; scanner < 3; scanner++) {
    rows.push(
      row(32 + scanner, {
        name: `scanner-${String(scanner + 1).padStart(2, "0")}`,
        hostname: `scanner-${String(scanner + 1).padStart(2, "0")}`,
        ipAddress: `10.30.0.${51 + scanner}`,
        vendor: "Zebra Technologies",
        site: WAREHOUSE,
        seenOn: WAREHOUSE_SWITCH,
        vlanId: 50,
      }),
    );
  }

  return rows;
}

/*
 * `?devices=many`: a site of 320 point-of-sale terminals, enough for paging
 * and for "select every device that matches" to reach past one page.
 */
export function buildManyDiscoveredDevices() {
  const rows = [];

  for (let index = 0; index < 320; index++) {
    rows.push(
      row(1000 + index, {
        name: `pos-${String(index + 1).padStart(3, "0")}`,
        hostname: `pos-${String(index + 1).padStart(3, "0")}`,
        ipAddress: `10.40.${Math.floor(index / 200)}.${(index % 200) + 10}`,
        vendor: "Verifone",
        macAddress: mac(1000 + index),
        vlanId: 60,
      }),
    );
  }

  return rows;
}

export function createDiscoveredDevicesApi(rows) {
  return new DiscoveredDevicesFakeServer(rows);
}

import { describe, expect, test } from "@jest/globals";
import {
  HOSTNAME_FIELD_DESCRIPTION,
  MONITOR_BINDING_FIELD_DESCRIPTION,
  MONITOR_BINDING_FIELD_PLACEHOLDER,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/MonitoringMethodFormFields";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * A NetworkDevice never needs a monitor to be registered. That was already
 * true of the server (discovery import creates monitor-backed devices with
 * nothing bound, on purpose), of the Settings edit form, and of the topology
 * map's "Add to Monitoring" dialog — and false of exactly one surface: the
 * create form on the Devices list, whose Monitor field was
 * `required: isMonitorBackedDevice`. An operator recording a device before
 * its monitor existed was blocked there and nowhere else, and the product
 * could not explain why the same device was fine to save from three other
 * places.
 *
 * That form no longer asks for a monitor AT ALL. Registering a device says
 * what the device is; every device it creates is probe-polled, and binding a
 * monitor is an override applied afterwards, on the device's Settings page.
 * So the surface that used to demand a binding is now the surface that must
 * not offer one — a create form with a Monitor dropdown is a create form
 * asking which of two monitoring stories the operator wants, which is the
 * question this whole change removed.
 *
 * What is left to pin is one form and one shape: the Settings page's Monitor
 * field is optional, and worded in the shared sentence, because "the monitor
 * is what gives the device a status, so surely it should be required" is a
 * well-meant refactor that comes back.
 *
 * METHOD. Source-text assertions, comments stripped and whitespace squashed,
 * the same approach as MonitorBackedDeviceColumnHonesty.test.ts — the App
 * suite runs in a plain Node environment with no React renderer, so the
 * forms cannot be mounted and submitted. The BEHAVIOUR of the create form's
 * fields is pinned in Common/Tests/App/Dashboard, which can render them.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * Every form that can write NetworkDevice.monitorId. Paths are relative to
 * the Dashboard's `src/` and use "/" regardless of platform — they are split
 * before joining.
 *
 * There is one. The topology map's "Add to Monitoring" dialog and the
 * Devices list's create form both dropped their binding field when the
 * monitoring-method question went: every device either of them creates is
 * probe-polled (AddNeighborToMonitoringWiring.test.ts and the NO_BINDING
 * surfaces below pin that). Both still appear in HOSTNAME_SURFACES.
 */
const NETWORK_DEVICE_FORMS: Array<string> = [
  "Pages/NetworkDevice/View/Settings.tsx",
];

/*
 * The forms that create a device and must NOT ask for a monitor. A binding
 * offered here is not a small extra field: it is the monitoring-method
 * question wearing a different hat, and the device it produces is the one
 * kind nothing polls.
 */
const NO_BINDING_FORMS: Array<string> = [
  "Pages/NetworkDevice/Devices.tsx",
  "Components/Topology/AddNeighborToMonitoringModal.tsx",
];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readCode(page: string): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...page.split("/")), "utf8"),
  ).replace(/\s+/g, " ");
}

/**
 * The Monitor field's definition: from `field: { monitor: true, }` to the
 * next field's `field: {`. Asserts its markers were found, because a bare
 * indexOf returning -1 would make the slice cover the whole file and every
 * assertion under it pass for the wrong reason.
 */
function monitorField(page: string): string {
  const code: string = readCode(page);
  const marker: string = "field: { monitor: true, }";
  const start: number = code.indexOf(marker);

  expect({ page: page, found: start > -1 }).toEqual({
    page: page,
    found: true,
  });

  /*
   * The next field of EITHER spelling: the create form's Ping opt-in fields
   * are `overrideField: {`, which a case-sensitive "field: {" search skips
   * straight over — and a slice that overruns into a neighbour can pass on
   * the neighbour's `required: false`.
   */
  const nextFieldStarts: Array<number> = ["field: {", "overrideField: {"]
    .map((needle: string): number => {
      return code.indexOf(needle, start + marker.length);
    })
    .filter((index: number): boolean => {
      return index > -1;
    });
  const end: number =
    nextFieldStarts.length > 0 ? Math.min(...nextFieldStarts) : -1;

  expect({ page: page, terminated: end > start }).toEqual({
    page: page,
    terminated: true,
  });

  return code.slice(start, end);
}

describe("the forms that register a device do not ask for a monitor", () => {
  test.each(NO_BINDING_FORMS)("%s has no Monitor field", (page: string) => {
    const code: string = readCode(page);

    expect(code).not.toContain("field: { monitor: true, }");
    /*
     * And no leftovers of the field that was there: the shared copy is the
     * binding's, and a form that still imports it is a form one paste away
     * from offering it again.
     */
    expect(code).not.toContain("MONITOR_BINDING_FIELD_DESCRIPTION");
    expect(code).not.toContain("MONITOR_BINDING_FIELD_PLACEHOLDER");
  });

  /*
   * The other half of the same removal. `monitoringMethod` is what the
   * binding field used to branch on, so a form that asks the question again
   * will grow the field back to answer it.
   */
  test.each(NO_BINDING_FORMS)(
    "%s asks no monitoring-method question",
    (page: string) => {
      const code: string = readCode(page);

      expect(code).not.toContain("field: { monitoringMethod: true, }");
      expect(code).not.toContain("MONITORING_METHOD_OPTIONS");
      expect(code).not.toContain('id: "monitoring-method"');
    },
  );
});

describe("the Monitor binding is optional on every NetworkDevice form", () => {
  test.each(NETWORK_DEVICE_FORMS)(
    "%s marks the field required: false",
    (page: string) => {
      const field: string = monitorField(page);

      expect(field).toContain("required: false");
      /*
       * Exactly one field's worth: a slice that ran on into a neighbouring
       * field would carry that field's `required:` and `title:` too, and
       * could pass on them.
       */
      expect((field.match(/required:/g) || []).length).toBe(1);
      expect((field.match(/title:/g) || []).length).toBe(1);
    },
  );

  test.each(NETWORK_DEVICE_FORMS)(
    "%s does not make the field conditionally required",
    (page: string) => {
      const field: string = monitorField(page);

      expect(field).not.toContain("required: isMonitorBackedDevice");
      expect(field).not.toMatch(/required: \(/);
      expect(field).not.toContain("required: true");
    },
  );

  /*
   * The regression this file exists for, stated as a whole-file check so it
   * cannot hide in a second Monitor field added later.
   */
  test.each(NETWORK_DEVICE_FORMS)(
    "%s never spells `required: isMonitorBackedDevice` anywhere",
    (page: string) => {
      expect(readCode(page)).not.toContain("required: isMonitorBackedDevice");
    },
  );
});

describe("the binding is explained by the shared sentence, not a local one", () => {
  /*
   * Shared even though one form now uses it, because the words are also what
   * the Overview hero and the device list's "No monitor" tooltip send an
   * operator here expecting to read. A local copy drifts from those.
   */
  test.each(NETWORK_DEVICE_FORMS)(
    "%s uses the shared description and placeholder",
    (page: string) => {
      const field: string = monitorField(page);

      expect(field).toContain("MONITOR_BINDING_FIELD_DESCRIPTION");
      expect(field).toContain("MONITOR_BINDING_FIELD_PLACEHOLDER");
    },
  );

  /*
   * The copy is the only thing that tells an operator they may leave the
   * field empty; a placeholder that just says "Select Monitor" reads as a
   * demand.
   */
  test("the placeholder says the field is optional", () => {
    expect(MONITOR_BINDING_FIELD_PLACEHOLDER.toLowerCase()).toContain(
      "optional",
    );
  });

  test("the description says the device can be recorded now and bound later", () => {
    expect(MONITOR_BINDING_FIELD_DESCRIPTION).toContain("Leave it empty");
    expect(MONITOR_BINDING_FIELD_DESCRIPTION).toContain("bind a monitor later");
  });

  test("the description names the status an unbound device reads", () => {
    /*
     * Pending, tagged "No monitor", is what the device list pill and the
     * Overview hero show for that state, so the form has to use the same
     * words or the operator cannot connect the two.
     */
    expect(MONITOR_BINDING_FIELD_DESCRIPTION).toContain("reads Pending");
    expect(MONITOR_BINDING_FIELD_DESCRIPTION).toContain('"No monitor"');
  });
});

/*
 * The hostname is asked for on four surfaces, and two of them used to say
 * the probe "will poll it via SNMP" — false for a monitor-backed device, and
 * exactly the sentence that sends an operator looking for a probe the
 * device is designed never to have.
 */
describe("the hostname is explained the same way on every surface", () => {
  const HOSTNAME_SURFACES: Array<string> = [
    "Pages/NetworkDevice/Devices.tsx",
    "Pages/NetworkDevice/View/Settings.tsx",
    "Pages/NetworkDevice/View/Index.tsx",
    "Components/Topology/AddNeighborToMonitoringModal.tsx",
  ];

  test.each(HOSTNAME_SURFACES)(
    "%s uses the shared hostname description",
    (page: string) => {
      expect(readCode(page)).toContain(
        "description: HOSTNAME_FIELD_DESCRIPTION",
      );
    },
  );

  /*
   * The address is used differently by each kind of device, and one sentence
   * serves all four surfaces, so it has to name both cases. "SNMP device"
   * was the old name for a probe-polled one and is retired: the address is
   * where the device is PINGED, with the SNMP walk as an upgrade that
   * happens only once credentials resolve.
   */
  test("the shared description covers both kinds of device", () => {
    expect(HOSTNAME_FIELD_DESCRIPTION).toContain("probe-polled device");
    expect(HOSTNAME_FIELD_DESCRIPTION).toContain("monitor-backed device");
  });
});

import { describe, expect, test } from "@jest/globals";
import Probe from "Common/Models/DatabaseModels/Probe";
import fs from "fs";
import path from "path";
import {
  ADD_DEVICE_NO_PROBE_DESCRIPTION,
  ADD_PROBE_LINK_TEXT,
  CLOUD_PROBES_GROUP_LABEL,
  OWN_PROBES_GROUP_LABEL,
  ProbeDropdownOption,
  ProbeDropdownOptionGroup,
  SCAN_NO_PROBE_DESCRIPTION,
  SERVER_PROBES_GROUP_LABEL,
  getDefaultProbeId,
  getGroupedProbeDropdownOptions,
  getProbeDropdownOptions,
  hasProjectProbe,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/ProbeOptions";

/*
 * The probe pickers on the Add Device form and the new-scan form share
 * these: which probes they list, and which one they start on. "Which probe
 * can reach this address?" is a question with one answer surprisingly
 * often, and a form that asks it anyway is a form with one question too
 * many.
 */

function probe(data: {
  id?: string | undefined;
  name?: string | undefined;
  isGlobalProbe?: boolean | undefined;
}): Probe {
  const item: Probe = new Probe();

  if (data.id) {
    item._id = data.id;
  }

  if (data.name !== undefined) {
    item.name = data.name;
  }

  if (data.isGlobalProbe !== undefined) {
    item.isGlobalProbe = data.isGlobalProbe;
  }

  return item;
}

const HQ: string = "11111111-0000-4000-8000-000000000001";
const BRANCH: string = "11111111-0000-4000-8000-000000000002";
const GLOBAL: string = "11111111-0000-4000-8000-000000000003";

describe("getProbeDropdownOptions", () => {
  test("lists every probe by its name and id, in the order given", () => {
    const options: Array<ProbeDropdownOption> = getProbeDropdownOptions([
      probe({ id: HQ, name: "HQ Probe" }),
      probe({ id: BRANCH, name: "Branch Probe" }),
    ]);

    expect(options).toEqual([
      { label: "HQ Probe", value: HQ },
      { label: "Branch Probe", value: BRANCH },
    ]);
  });

  /*
   * This used to throw, during the page's render, so one unnamed probe row
   * blanked the whole Devices page - its list as well as its form.
   */
  test("lists a probe with no name by its id instead of throwing", () => {
    const options: Array<ProbeDropdownOption> = getProbeDropdownOptions([
      probe({ id: HQ }),
    ]);

    expect(options).toEqual([{ label: `Probe ${HQ}`, value: HQ }]);
  });

  test("an empty name is treated as no name", () => {
    expect(
      getProbeDropdownOptions([probe({ id: HQ, name: "" })])[0]!.label,
    ).toBe(`Probe ${HQ}`);
  });

  test("leaves out a probe with no id - it cannot be picked", () => {
    expect(
      getProbeDropdownOptions([
        probe({ name: "Ghost" }),
        probe({ id: HQ, name: "HQ Probe" }),
      ]),
    ).toEqual([{ label: "HQ Probe", value: HQ }]);
  });

  test("lists global probes too - picking one is the person's call", () => {
    expect(
      getProbeDropdownOptions([
        probe({ id: GLOBAL, name: "US East", isGlobalProbe: true }),
      ]),
    ).toEqual([{ label: "US East", value: GLOBAL }]);
  });

  test("no probes is an empty list", () => {
    expect(getProbeDropdownOptions([])).toEqual([]);
  });

  test("values are plain strings, as the dropdown compares them", () => {
    for (const option of getProbeDropdownOptions([
      probe({ id: HQ, name: "HQ Probe" }),
    ])) {
      expect(typeof option.value).toBe("string");
    }
  });
});

describe("getDefaultProbeId", () => {
  test("starts on the project's only custom probe", () => {
    expect(getDefaultProbeId([probe({ id: HQ, name: "HQ Probe" })])).toBe(HQ);
  });

  test("counts a probe not marked global as custom", () => {
    expect(
      getDefaultProbeId([
        probe({ id: HQ, name: "HQ Probe", isGlobalProbe: false }),
      ]),
    ).toBe(HQ);
  });

  test("ignores global probes when picking the only custom one", () => {
    expect(
      getDefaultProbeId([
        probe({ id: GLOBAL, name: "US East", isGlobalProbe: true }),
        probe({ id: HQ, name: "HQ Probe", isGlobalProbe: false }),
      ]),
    ).toBe(HQ);
  });

  /*
   * A global probe sits on the public internet and cannot reach a private
   * address: a device started on one reads Down for no reason anyone can
   * see. So it is never the default, even when it is the only probe.
   */
  test("never starts on a global probe, even the only one", () => {
    expect(
      getDefaultProbeId([
        probe({ id: GLOBAL, name: "US East", isGlobalProbe: true }),
      ]),
    ).toBe("");
  });

  test("does not guess between two custom probes", () => {
    expect(
      getDefaultProbeId([
        probe({ id: HQ, name: "HQ Probe" }),
        probe({ id: BRANCH, name: "Branch Probe" }),
      ]),
    ).toBe("");
  });

  test("no probes, no default", () => {
    expect(getDefaultProbeId([])).toBe("");
  });

  test("a custom probe with no id is not a default", () => {
    expect(getDefaultProbeId([probe({ name: "Ghost" })])).toBe("");
  });

  test("an id-less custom row does not stop the one real custom probe being the default", () => {
    expect(
      getDefaultProbeId([
        probe({ name: "Ghost" }),
        probe({ id: HQ, name: "HQ Probe" }),
      ]),
    ).toBe(HQ);
  });
});

/*
 * The project's own probes first, OneUptime's after them, each under a
 * heading: "which of these is on my network?" is answered by the list.
 */
describe("getGroupedProbeDropdownOptions", () => {
  const BOTH: Array<Probe> = [
    probe({ id: GLOBAL, name: "US East", isGlobalProbe: true }),
    probe({ id: HQ, name: "HQ Probe" }),
    probe({ id: BRANCH, name: "Branch Probe", isGlobalProbe: false }),
  ];

  test("the project's own probes first, under their own heading", () => {
    const groups: Array<ProbeDropdownOption | ProbeDropdownOptionGroup> =
      getGroupedProbeDropdownOptions(BOTH, { isOneUptimeCloud: true });

    expect(groups).toEqual([
      {
        label: "Your probes",
        options: [
          { label: "HQ Probe", value: HQ },
          { label: "Branch Probe", value: BRANCH },
        ],
      },
      {
        label: "OneUptime probes, on the internet",
        options: [{ label: "US East", value: GLOBAL }],
      },
    ]);
  });

  test("on OneUptime Cloud, OneUptime's probes are said to be on the internet", () => {
    const groups: Array<ProbeDropdownOption | ProbeDropdownOptionGroup> =
      getGroupedProbeDropdownOptions(BOTH, { isOneUptimeCloud: true });

    expect((groups[1] as ProbeDropdownOptionGroup).label).toBe(
      CLOUD_PROBES_GROUP_LABEL,
    );
  });

  test("on a self-hosted server, they are the server's own probes", () => {
    const groups: Array<ProbeDropdownOption | ProbeDropdownOptionGroup> =
      getGroupedProbeDropdownOptions(BOTH, { isOneUptimeCloud: false });

    expect((groups[0] as ProbeDropdownOptionGroup).label).toBe(
      OWN_PROBES_GROUP_LABEL,
    );
    expect((groups[1] as ProbeDropdownOptionGroup).label).toBe(
      SERVER_PROBES_GROUP_LABEL,
    );
  });

  test("a list of one kind has no headings: one heading over everything says nothing", () => {
    expect(
      getGroupedProbeDropdownOptions([probe({ id: HQ, name: "HQ Probe" })], {
        isOneUptimeCloud: true,
      }),
    ).toEqual([{ label: "HQ Probe", value: HQ }]);
    expect(
      getGroupedProbeDropdownOptions(
        [probe({ id: GLOBAL, name: "US East", isGlobalProbe: true })],
        { isOneUptimeCloud: true },
      ),
    ).toEqual([{ label: "US East", value: GLOBAL }]);
    expect(
      getGroupedProbeDropdownOptions([], { isOneUptimeCloud: false }),
    ).toEqual([]);
  });

  test("a probe with no id is left out of its group too", () => {
    const groups: Array<ProbeDropdownOption | ProbeDropdownOptionGroup> =
      getGroupedProbeDropdownOptions([...BOTH, probe({ name: "Ghost" })], {
        isOneUptimeCloud: true,
      });

    expect((groups[0] as ProbeDropdownOptionGroup).options).toHaveLength(2);
  });
});

describe("hasProjectProbe", () => {
  test("a probe of the project's own counts", () => {
    expect(hasProjectProbe([probe({ id: HQ, name: "HQ Probe" })])).toBe(true);
  });

  test("OneUptime's probes do not: they cannot reach a private address", () => {
    expect(
      hasProjectProbe([
        probe({ id: GLOBAL, name: "US East", isGlobalProbe: true }),
      ]),
    ).toBe(false);
  });

  test("a row with no id is no probe", () => {
    expect(hasProjectProbe([probe({ name: "Ghost" })])).toBe(false);
    expect(hasProjectProbe([])).toBe(false);
  });
});

/*
 * With no probe of the project's own, the probe fields of Add Device and of
 * a new scan say why, and link to the Overview's "Add a probe" dialog in a
 * new tab - so the form being filled in is not lost - and read the probes
 * again when the person comes back to the tab.
 */
describe("the probe fields, for a project with no probe of its own", () => {
  const PAGES: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
    "Pages",
    "NetworkDevice",
  );

  function readPage(name: string): string {
    return fs.readFileSync(path.join(PAGES, name), "utf8").replace(/\s+/g, " ");
  }

  test.each([
    ["Devices.tsx", "ADD_DEVICE_NO_PROBE_DESCRIPTION"],
    ["Discovery.tsx", "SCAN_NO_PROBE_DESCRIPTION"],
  ])(
    "%s says why the list cannot reach the network, and links to add a probe",
    (page: string, description: string) => {
      const code: string = readPage(page);

      expect(code).toContain(`: ${description}`);
      expect(code).toContain("hasProjectProbe(");
      expect(code).toContain("text: ADD_PROBE_LINK_TEXT,");
      expect(code).toContain(
        "url: getNetworkQuickActionRoute(NetworkQuickAction.AddProbe)",
      );
      expect(code).toContain("openLinkInNewTab: true");
      expect(code).toContain("useRefreshProbesOnFocus(");
      expect(code).toContain("getGroupedProbeDropdownOptions(");
    },
  );

  /*
   * A device's own Settings (Edit Polling) picks its probe from the same
   * list, with the same way to add one - and no longer throws on a probe row
   * without a name, which blanked the whole page.
   */
  test("a device's Settings picks its probe from the same list, with the same link", () => {
    const code: string = readPage("View/Settings.tsx");

    expect(code).toContain("getGroupedProbeDropdownOptions(probes, {");
    expect(code).toContain("text: ADD_PROBE_LINK_TEXT,");
    expect(code).toContain(
      "url: getNetworkQuickActionRoute(NetworkQuickAction.AddProbe)",
    );
    expect(code).toContain("useRefreshProbesOnFocus(setProbes);");
    expect(code).not.toContain("Probe name or id is missing");
  });

  test("the words are translation keys", () => {
    const en: Record<string, unknown> = JSON.parse(
      fs.readFileSync(
        path.join(PAGES, "..", "..", "Locales", "en.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;

    for (const text of [
      ADD_PROBE_LINK_TEXT,
      ADD_DEVICE_NO_PROBE_DESCRIPTION,
      SCAN_NO_PROBE_DESCRIPTION,
      OWN_PROBES_GROUP_LABEL,
      CLOUD_PROBES_GROUP_LABEL,
      SERVER_PROBES_GROUP_LABEL,
    ]) {
      expect(en[text]).toBe(text);
    }
  });

  test("each says a probe on the internet cannot reach the network", () => {
    expect(ADD_DEVICE_NO_PROBE_DESCRIPTION).toContain(
      "which a probe on the internet cannot reach",
    );
    expect(SCAN_NO_PROBE_DESCRIPTION).toContain(
      "which a probe on the internet cannot reach",
    );
  });
});

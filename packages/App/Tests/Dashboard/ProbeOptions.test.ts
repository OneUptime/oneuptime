import { describe, expect, test } from "@jest/globals";
import Probe from "Common/Models/DatabaseModels/Probe";
import {
  ProbeDropdownOption,
  getDefaultProbeId,
  getProbeDropdownOptions,
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

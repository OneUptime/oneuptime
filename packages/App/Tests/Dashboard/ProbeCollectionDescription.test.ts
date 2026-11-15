import { describe, expect, test } from "@jest/globals";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import { ProbeConnectionStatus } from "Common/Models/DatabaseModels/Probe";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import ObjectID from "Common/Types/ObjectID";
import {
  Translator,
  createTranslator,
  translatableTerm,
} from "Common/UI/Utils/TranslateTemplate";
import { getOpenStackCollectionStop } from "Common/Utils/OpenStack/OpenStackCollectionStop";
import { getVMwareCollectionStop } from "Common/Utils/VMware/VMwareCollectionStop";
import fs from "fs";
import path from "path";
import {
  OPENSTACK_COLLECTION_OVERDUE_AFTER_IN_MS,
  getOpenStackCollectionDescription,
} from "../../FeatureSet/Dashboard/src/Components/OpenStack/OpenStackProbeCollectionView";
import { getProbeCollectionDescription } from "../../FeatureSet/Dashboard/src/Components/Probe/ProbeCollectionDescription";
import {
  VMWARE_COLLECTION_OVERDUE_AFTER_IN_MS,
  getVMwareCollectionDescription,
} from "../../FeatureSet/Dashboard/src/Components/VMware/VMwareProbeCollectionView";

/*
 * THE DATA COLLECTION CARD'S DESCRIPTION, FOR A CLOUD OR A VCENTER A PROBE
 * COLLECTS (OneUptime issue #8326).
 *
 * It read "Collected by Datacenter probe from https://keystone.example.com:
 * 5000, every 5 minutes." beside a badge that said Not collecting, and
 * "Collected by its probe" for a row with no probe at all. A promise only
 * while a probe comes for the row; otherwise what it is set to, or nothing
 * when the setting is what is missing.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json") && name !== "en.json";
  })
  .map((name: string): string => {
    return name.replace(/\.json$/, "");
  })
  .sort();

// Japanese, Korean and Chinese have no "one" plural form: it is never read.
const NO_ONE_FORM: ReadonlyArray<string> = ["ja", "ko", "zh-CN", "zh-TW"];

const SET_TO_KEY: string =
  "Set to be collected by {{probe}} from {{address}}, every {{count}} minutes.";

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function translatorFor(language: string): Translator {
  const values: Record<string, string> = locale(language);

  return createTranslator((text: string): string | undefined => {
    return values[text];
  }, language);
}

const NOW: Date = new Date("2026-11-15T12:00:00.000Z");
const PROJECT: string = "13131313-0000-4000-8000-000000000001";
const OTHER_PROJECT: string = "13131313-0000-4000-8000-000000000002";
const PROBE: string = "13131313-0000-4000-8000-000000000003";

function minutesFromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

describe("getProbeCollectionDescription", () => {
  const COLLECTED: Parameters<typeof getProbeCollectionDescription>[0] = {
    isCollected: true,
    hasProbe: true,
    probeName: "Datacenter probe",
    address: "https://keystone.example.com:5000",
    intervalInMinutes: 5,
  };

  test("while a probe comes for it: a promise, as the card always said", () => {
    expect(getProbeCollectionDescription(COLLECTED, ENGLISH)).toBe(
      "Collected by Datacenter probe from https://keystone.example.com:5000, every 5 minutes. No agent runs for it.",
    );
  });

  test("while none may, or none has come: what it is set to, never 'Collected by'", () => {
    expect(
      getProbeCollectionDescription(
        { ...COLLECTED, isCollected: false },
        ENGLISH,
      ),
    ).toBe(
      "Set to be collected by Datacenter probe from https://keystone.example.com:5000, every 5 minutes.",
    );
  });

  test("the one form names the count: every 1 minute", () => {
    expect(
      getProbeCollectionDescription(
        { ...COLLECTED, isCollected: false, intervalInMinutes: 1 },
        ENGLISH,
      ),
    ).toBe(
      "Set to be collected by Datacenter probe from https://keystone.example.com:5000, every 1 minute.",
    );
    expect(
      getProbeCollectionDescription(
        { ...COLLECTED, intervalInMinutes: 1 },
        ENGLISH,
      ),
    ).toBe(
      "Collected by Datacenter probe from https://keystone.example.com:5000, every 1 minute. No agent runs for it.",
    );
  });

  test("a probe the reader may not read is 'its probe', translated with the sentence", () => {
    expect(
      getProbeCollectionDescription(
        {
          ...COLLECTED,
          isCollected: false,
          probeName: translatableTerm("its probe"),
        },
        ENGLISH,
      ),
    ).toBe(
      "Set to be collected by its probe from https://keystone.example.com:5000, every 5 minutes.",
    );
  });

  test("no probe named, or no address: no setting to say, so no description", () => {
    for (const facts of [
      { ...COLLECTED, isCollected: false, hasProbe: false },
      { ...COLLECTED, isCollected: false, address: null },
      { ...COLLECTED, isCollected: false, address: undefined },
      { ...COLLECTED, isCollected: false, address: "" },
      { ...COLLECTED, isCollected: false, hasProbe: false, address: null },
    ]) {
      expect(getProbeCollectionDescription(facts, ENGLISH)).toBeUndefined();
    }
  });
});

describe("an OpenStack cloud's card description", () => {
  const OWN_PROBE: Record<string, unknown> = {
    name: "Datacenter probe",
    isGlobalProbe: false,
    projectId: new ObjectID(PROJECT),
    connectionStatus: ProbeConnectionStatus.Connected,
  };

  function cloud(data: Record<string, unknown> = {}): OpenStackCloud {
    const item: OpenStackCloud = new OpenStackCloud();
    Object.assign(item, {
      projectId: new ObjectID(PROJECT),
      isCredentialSet: true,
      authUrl: "https://keystone.example.com:5000",
      collectionProbeId: new ObjectID(PROBE),
      collectionProbe: OWN_PROBE,
      collectionIntervalInMinutes: 5,
      nextCollectionAt: minutesFromNow(2),
      ...data,
    });
    return item;
  }

  function describeCloud(
    data: Record<string, unknown> = {},
    isBillingEnabled: boolean = true,
  ): string | undefined {
    return getOpenStackCollectionDescription(
      cloud(data),
      ENGLISH,
      NOW,
      isBillingEnabled,
    );
  }

  const PROMISE: string =
    "Collected by Datacenter probe from https://keystone.example.com:5000, every 5 minutes. No agent runs for it.";
  const SETTING: string =
    "Set to be collected by Datacenter probe from https://keystone.example.com:5000, every 5 minutes.";

  test("due later, or due now: a probe comes for it, so the promise", () => {
    expect(describeCloud()).toBe(PROMISE);
    expect(describeCloud({ nextCollectionAt: null })).toBe(PROMISE);
    expect(describeCloud({ nextCollectionAt: minutesFromNow(-10) })).toBe(
      PROMISE,
    );
  });

  test("archived: still collected (#8324), so the promise", () => {
    expect(describeCloud({ isArchived: true })).toBe(PROMISE);
  });

  test.each([
    ["no credential", { isCredentialSet: false }],
    [
      "another project's probe",
      {
        collectionProbe: {
          ...OWN_PROBE,
          projectId: new ObjectID(OTHER_PROJECT),
        },
      },
    ],
    [
      "a disconnected probe",
      {
        collectionProbe: {
          ...OWN_PROBE,
          connectionStatus: ProbeConnectionStatus.Disconnected,
        },
      },
    ],
    [
      "overdue: no probe has come for it",
      {
        nextCollectionAt: new Date(
          NOW.getTime() - OPENSTACK_COLLECTION_OVERDUE_AFTER_IN_MS - 60_000,
        ),
      },
    ],
  ])(
    "%s: what it is set to",
    (_name: string, data: Record<string, unknown>) => {
      expect(describeCloud(data)).toBe(SETTING);
    },
  );

  test("a shared probe: not allowed on OneUptime Cloud, so the setting; an instance's own collects it", () => {
    const shared: Record<string, unknown> = {
      collectionProbe: { ...OWN_PROBE, isGlobalProbe: true, projectId: null },
    };

    expect(describeCloud(shared, true)).toBe(SETTING);
    expect(describeCloud(shared, false)).toBe(PROMISE);
  });

  test("no probe, or no Keystone address: no description; the card's body says what is missing", () => {
    expect(
      describeCloud({ collectionProbeId: null, collectionProbe: null }),
    ).toBeUndefined();
    expect(describeCloud({ authUrl: null })).toBeUndefined();
  });

  test("whenever the card's rule finds a stop, the description never promises", () => {
    for (const data of [
      { isCredentialSet: false },
      { authUrl: null },
      { collectionProbeId: null, collectionProbe: null },
      { collectionProbe: { ...OWN_PROBE, isGlobalProbe: true } },
      {
        collectionProbe: {
          ...OWN_PROBE,
          connectionStatus: ProbeConnectionStatus.Disconnected,
        },
      },
    ]) {
      expect(getOpenStackCollectionStop(cloud(data), true)).not.toBeNull();
      expect(describeCloud(data) || "").not.toMatch(/^Collected by /);
    }
  });
});

describe("a vCenter's card description", () => {
  const OWN_PROBE: Record<string, unknown> = {
    name: "Datacenter probe",
    isGlobalProbe: false,
    projectId: new ObjectID(PROJECT),
    connectionStatus: ProbeConnectionStatus.Connected,
  };

  function vcenter(data: Record<string, unknown> = {}): VMwareVCenter {
    const item: VMwareVCenter = new VMwareVCenter();
    Object.assign(item, {
      projectId: new ObjectID(PROJECT),
      isVCenterPasswordSet: true,
      vcenterUrl: "https://vcsa.example.com",
      vcenterUsername: "oneuptime@vsphere.local",
      collectionProbeId: new ObjectID(PROBE),
      collectionProbe: OWN_PROBE,
      collectionIntervalInMinutes: 5,
      nextCollectionAt: minutesFromNow(2),
      ...data,
    });
    return item;
  }

  function describeVCenter(
    data: Record<string, unknown> = {},
    isBillingEnabled: boolean = true,
  ): string | undefined {
    return getVMwareCollectionDescription(
      vcenter(data),
      ENGLISH,
      NOW,
      isBillingEnabled,
    );
  }

  const PROMISE: string =
    "Collected by Datacenter probe from https://vcsa.example.com, every 5 minutes. No agent runs for it.";
  const SETTING: string =
    "Set to be collected by Datacenter probe from https://vcsa.example.com, every 5 minutes.";

  test("due later, or due now, archived or not: the promise", () => {
    expect(describeVCenter()).toBe(PROMISE);
    expect(describeVCenter({ nextCollectionAt: null })).toBe(PROMISE);
    expect(describeVCenter({ isArchived: true })).toBe(PROMISE);
  });

  test.each([
    ["no password", { isVCenterPasswordSet: false }],
    ["no user name", { vcenterUsername: null }],
    [
      "another project's probe",
      {
        collectionProbe: {
          ...OWN_PROBE,
          projectId: new ObjectID(OTHER_PROJECT),
        },
      },
    ],
    [
      "a disconnected probe",
      {
        collectionProbe: {
          ...OWN_PROBE,
          connectionStatus: ProbeConnectionStatus.Disconnected,
        },
      },
    ],
    [
      "overdue: no probe has come for it",
      {
        nextCollectionAt: new Date(
          NOW.getTime() - VMWARE_COLLECTION_OVERDUE_AFTER_IN_MS - 60_000,
        ),
      },
    ],
  ])(
    "%s: what it is set to",
    (_name: string, data: Record<string, unknown>) => {
      expect(describeVCenter(data)).toBe(SETTING);
    },
  );

  test("no probe, or no address: no description", () => {
    expect(
      describeVCenter({ collectionProbeId: null, collectionProbe: null }),
    ).toBeUndefined();
    expect(describeVCenter({ vcenterUrl: null })).toBeUndefined();
  });

  test("whenever the card's rule finds a stop, the description never promises", () => {
    for (const data of [
      { isVCenterPasswordSet: false },
      { vcenterUrl: null },
      { vcenterUsername: null },
      { collectionProbeId: null, collectionProbe: null },
      { collectionProbe: { ...OWN_PROBE, isGlobalProbe: true } },
    ]) {
      expect(getVMwareCollectionStop(vcenter(data), true)).not.toBeNull();
      expect(describeVCenter(data) || "").not.toMatch(/^Collected by /);
    }
  });
});

describe("the setting, in every language", () => {
  test.each(LANGUAGES)(
    "%s words both forms, keeps their placeholders, and never says it is collected",
    (language: string) => {
      const values: Record<string, string> = locale(language);
      const english: Record<string, string> = locale("en");

      for (const key of [SET_TO_KEY, `${SET_TO_KEY}_one`]) {
        const value: string | undefined = values[key];

        expect(value).toBeDefined();

        for (const placeholder of ["{{probe}}", "{{address}}", "{{count}}"]) {
          expect(value).toContain(placeholder);
        }

        if (key === SET_TO_KEY || !NO_ONE_FORM.includes(language)) {
          // Translated, not English left in the file.
          expect(value).not.toBe(english[key]);
        }

        // Not the promise's own words: the setting reads apart from it.
        expect(value).not.toBe(
          values[
            "Collected by {{probe}} from {{address}}, every {{count}} minutes. No agent runs for it."
          ],
        );
      }
    },
  );

  test.each(LANGUAGES)(
    "%s fills the setting with the probe, the address and the count",
    (language: string) => {
      const description: string | undefined = getProbeCollectionDescription(
        {
          isCollected: false,
          hasProbe: true,
          probeName: "Datacenter probe",
          address: "https://keystone.example.com:5000",
          intervalInMinutes: 5,
        },
        translatorFor(language),
      );

      expect(description).toBeDefined();
      expect(description).toContain("Datacenter probe");
      expect(description).toContain("https://keystone.example.com:5000");
      expect(description).not.toContain("{{");
      expect(description).not.toMatch(/^Set to be collected by /);
    },
  );
});

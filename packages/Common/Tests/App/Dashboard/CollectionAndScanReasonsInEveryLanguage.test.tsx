import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import fs from "fs";
import path from "path";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHY A CLOUD OR A VCENTER IS NOT COLLECTED, AND WHY NOTHING SCANS A DATA STORE'S CONTENT, IN
 * THE READER'S LANGUAGE (OneUptime issue #8448).
 *
 * The Overview of a probe-collected OpenStack cloud or vCenter says why no probe collects it
 * (OpenStackProbeCollectionView, VMwareProbeCollectionView), and a data store's Overview says why
 * nothing scans its content (StoreNextContentScan). Only Persian and Arabic worded those
 * sentences: a German page read "No credential is saved for this cloud." and "Save an
 * application credential or a password in Settings, and test the connection." in English,
 * beside its translated badge. Here every reason is worked out in every Dashboard language, and
 * the cards are drawn in English, German, Arabic and Persian.
 *
 * Only the network and the signed-in user's permissions are stubbed.
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: async (): Promise<unknown> => {
        return {};
      },
      create: async (): Promise<unknown> => {
        return { data: {} };
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: async (): Promise<Array<unknown>> => {
        return [];
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import StoreNextContentScan, {
  getStoreNextContentScanWords,
  getStoreScanNowRefusal,
  getStoreScanStopDetail,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/StoreNextContentScan";
import OpenStackCollectionStatusCard from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackCollectionStatusCard";
import {
  OpenStackCollectionStatusView,
  getOpenStackCollectionStatusView,
  getOpenStackInventoryPhrases,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackProbeCollectionView";
import VMwareCollectionStatusCard from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareCollectionStatusCard";
import {
  VMwareCollectionStatusView,
  getVMwareCollectionStatusView,
  getVMwareInventoryPhrases,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareProbeCollectionView";
import {
  ExtractedString,
  scanSourceText,
} from "../../../../App/FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import {
  DataStoreKind,
  DataStoreProvider,
} from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import OpenStackCollectionStatus from "../../../Types/OpenStack/OpenStackCollectionStatus";
import { OpenStackCollectionSummary } from "../../../Types/OpenStack/OpenStackProbeCollection";
import { VMwareCollectionSummary } from "../../../Types/VMware/VMwareProbeCollection";
import VMwareCollectionMethod from "../../../Types/VMware/VMwareCollectionMethod";
import VMwareCollectionStatus from "../../../Types/VMware/VMwareCollectionStatus";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  DataStoreContentScanFacts,
  DataStoreContentScanStop,
  getDataStoreNextContentScan,
} from "../../../Utils/DataSecurity/DataStoreContentScanSchedule";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
  readDashboardLocaleAsDrawn,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const ENGLISH: Translator = createTranslator(undefined, "en");

// The languages the cards are drawn in.
const DRAWN: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const REPOSITORY: string = path.resolve(__dirname, "../../../../..");
const DASHBOARD_SRC: string = "packages/App/FeatureSet/Dashboard/src";

// The files whose sentences say why nothing collects or scans.
const SOURCES: ReadonlyArray<string> = [
  `${DASHBOARD_SRC}/Components/OpenStack/OpenStackProbeCollectionView.ts`,
  `${DASHBOARD_SRC}/Components/VMware/VMwareProbeCollectionView.ts`,
  `${DASHBOARD_SRC}/Components/DataSecurity/StoreNextContentScan.tsx`,
  `${DASHBOARD_SRC}/Components/Probe/ProbeCollectionDescription.ts`,
];

// The store's Overview words Scan Now's answer for a store a probe scans.
const SCAN_NOW_BY_PROBE: string =
  "The next time {{probe}} asks for work, it scans this store's content. What it finds shows on What's Inside when it is done.";

const PROBE_NAME: string = "Datacenter probe";
const PROJECT: string = "84488448-0000-4000-8000-000000000001";
const PROBE: string = "84488448-0000-4000-8000-000000000002";
const CLOUD_ID: string = "84488448-0000-4000-8000-000000000003";
const VCENTER_ID: string = "84488448-0000-4000-8000-000000000004";
const MINUTE_IN_MS: number = 60 * 1000;

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * MINUTE_IN_MS);
}

function text(value: string | null | undefined): string {
  return withoutIsolateMarks(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Every sentence of these files the Dashboard looks up, and every count's two forms (the
 * general key, and "<key>_one").
 */
function sentencesOfTheReasons(): Array<string> {
  const keys: Set<string> = new Set<string>();

  for (const file of SOURCES) {
    const source: string = fs.readFileSync(path.join(REPOSITORY, file), "utf8");

    for (const found of scanSourceText(file, source, { kind: "ui" })
      .strings as Array<ExtractedString>) {
      if (found.nestedPath) {
        continue;
      }

      keys.add(found.text);

      if (found.pluralOne) {
        keys.add(`${found.text}_one`);
      }
    }
  }

  return [...keys];
}

function probeOf(
  connectionStatus: ProbeConnectionStatus = ProbeConnectionStatus.Connected,
  isNameless: boolean = false,
): Probe {
  const probe: Probe = new Probe();
  probe._id = PROBE;

  if (!isNameless) {
    probe.name = PROBE_NAME;
  }

  probe.isGlobalProbe = false;
  probe.projectId = new ObjectID(PROJECT);
  probe.connectionStatus = connectionStatus;

  return probe;
}

// What the claim needs to hand a cloud to its probe, and what makes each reason.
const COLLECTABLE_CLOUD: Record<string, unknown> = {
  projectId: new ObjectID(PROJECT),
  collectionMethod: OpenStackCollectionMethod.Probe,
  isCredentialSet: true,
  authUrl: "https://keystone.example.com:5000/v3",
  collectionProbeId: new ObjectID(PROBE),
  collectionIntervalInMinutes: 5,
  collectionStatus: OpenStackCollectionStatus.Succeeded,
  nextCollectionAt: minutesFromNow(3),
};

const COLLECTABLE_VCENTER: Record<string, unknown> = {
  projectId: new ObjectID(PROJECT),
  collectionMethod: VMwareCollectionMethod.Probe,
  isVCenterPasswordSet: true,
  vcenterUrl: "https://vcsa.example.com",
  vcenterUsername: "monitoring@vsphere.local",
  collectionProbeId: new ObjectID(PROBE),
  collectionIntervalInMinutes: 5,
  collectionStatus: VMwareCollectionStatus.Succeeded,
  nextCollectionAt: minutesFromNow(3),
};

interface Reason {
  name: string;
  columns: () => Record<string, unknown>;
  // The sentences the card says, as en.json keys: the title, the next step, and a message.
  title: string;
  nextStep: string | null;
  message: string | null;
}

const CLOUD_REASONS: ReadonlyArray<Reason> = [
  {
    name: "no credential",
    columns: () => {
      return { isCredentialSet: false };
    },
    title: "No credential is saved for this cloud.",
    nextStep:
      "Save an application credential or a password in Settings, and test the connection.",
    message: null,
  },
  {
    name: "no Keystone address",
    columns: () => {
      return { authUrl: undefined };
    },
    title: "This cloud has no Keystone address.",
    nextStep: "Enter Keystone's address in Settings, and test the connection.",
    message: null,
  },
  {
    name: "no probe",
    columns: () => {
      return { collectionProbeId: undefined, collectionProbe: undefined };
    },
    title: "No probe is set to collect this cloud.",
    nextStep: "Pick one of this project's probes in Settings.",
    message: null,
  },
  {
    name: "a disconnected probe",
    columns: () => {
      return { collectionProbe: probeOf(ProbeConnectionStatus.Disconnected) };
    },
    title: "",
    nextStep: null,
    message: "Nothing collects this cloud while {{probe}} is disconnected.",
  },
  {
    name: "overdue",
    columns: () => {
      return { nextCollectionAt: minutesFromNow(-90) };
    },
    title: "",
    nextStep: null,
    message:
      "This cloud was due to be collected {{time}}, and no probe has come for it.",
  },
];

const VCENTER_REASONS: ReadonlyArray<Reason> = [
  {
    name: "no password",
    columns: () => {
      return { isVCenterPasswordSet: false };
    },
    title: "No password is saved for this vCenter.",
    nextStep:
      "Enter the vCenter user's password in Settings, and test the connection.",
    message: null,
  },
  {
    name: "no address",
    columns: () => {
      return { vcenterUrl: undefined };
    },
    title: "This vCenter has no address.",
    nextStep: "Enter vCenter's address in Settings, and test the connection.",
    message: null,
  },
  {
    name: "no user name",
    columns: () => {
      return { vcenterUsername: undefined };
    },
    title: "This vCenter has no user name.",
    nextStep:
      "Enter the vCenter user's name in Settings, and test the connection.",
    message: null,
  },
  {
    name: "no probe",
    columns: () => {
      return { collectionProbeId: undefined, collectionProbe: undefined };
    },
    title: "No probe is set to collect this vCenter.",
    nextStep: "Pick one of this project's probes in Settings.",
    message: null,
  },
  {
    name: "a disconnected probe",
    columns: () => {
      return { collectionProbe: probeOf(ProbeConnectionStatus.Disconnected) };
    },
    title: "",
    nextStep: null,
    message: "Nothing collects this vCenter while {{probe}} is disconnected.",
  },
  {
    name: "overdue",
    columns: () => {
      return { nextCollectionAt: minutesFromNow(-90) };
    },
    title: "",
    nextStep: null,
    message:
      "This vCenter was due to be collected {{time}}, and no probe has come for it.",
  },
];

function cloudOf(columns: Record<string, unknown>): OpenStackCloud {
  const cloud: OpenStackCloud = new OpenStackCloud();
  cloud._id = CLOUD_ID;
  Object.assign(
    cloud,
    COLLECTABLE_CLOUD,
    { collectionProbe: probeOf() },
    columns,
  );
  return cloud;
}

function vcenterOf(columns: Record<string, unknown>): VMwareVCenter {
  const vcenter: VMwareVCenter = new VMwareVCenter();
  vcenter._id = VCENTER_ID;
  Object.assign(
    vcenter,
    COLLECTABLE_VCENTER,
    { collectionProbe: probeOf() },
    columns,
  );
  return vcenter;
}

function cloudView(
  columns: Record<string, unknown>,
  translator: Translator,
): OpenStackCollectionStatusView {
  return getOpenStackCollectionStatusView(
    cloudOf(columns),
    translator,
    new Date(),
    true,
  );
}

function vcenterView(
  columns: Record<string, unknown>,
  translator: Translator,
): VMwareCollectionStatusView {
  return getVMwareCollectionStatusView(
    vcenterOf(columns),
    translator,
    new Date(),
    true,
  );
}

// A PostgreSQL database the project's own connected probe scans, due later.
function probeStore(
  store: Partial<DataStoreContentScanFacts["store"]> = {},
  rest: Partial<DataStoreContentScanFacts> = {},
): DataStoreContentScanFacts {
  return {
    store: {
      kind: DataStoreKind.PostgreSql,
      provider: DataStoreProvider.SelfManaged,
      projectId: PROJECT,
      isContentScanEnabled: true,
      isArchived: false,
      scanProbeId: PROBE,
      probeConnectionVariable: "ORDERS_DB_URL",
      nextContentScanAt: minutesFromNow(30),
      ...store,
    },
    scanProbe: {
      isGlobalProbe: false,
      projectId: PROJECT,
      connectionStatus: ProbeConnectionStatus.Connected,
    },
    projectSetting: null,
    ...rest,
  };
}

// An S3 bucket OneUptime's workers scan, due later.
function workerStore(
  store: Partial<DataStoreContentScanFacts["store"]> = {},
  rest: Partial<DataStoreContentScanFacts> = {},
): DataStoreContentScanFacts {
  return {
    store: {
      kind: DataStoreKind.AwsS3Bucket,
      provider: DataStoreProvider.Aws,
      projectId: PROJECT,
      isContentScanEnabled: true,
      isArchived: false,
      nextContentScanAt: minutesFromNow(30),
      ...store,
    },
    projectSetting: null,
    ...rest,
  };
}

function telemetryStore(
  rest: Partial<DataStoreContentScanFacts> = {},
): DataStoreContentScanFacts {
  return {
    store: {
      kind: DataStoreKind.TelemetryLogs,
      provider: DataStoreProvider.OneUptime,
      projectId: PROJECT,
      isContentScanEnabled: true,
      isArchived: false,
      nextContentScanAt: minutesFromNow(-600),
    },
    projectSetting: null,
    ...rest,
  };
}

// Each store whose Next Content Scan says why nothing scans it, or that it is late.
const STORE_CASES: ReadonlyArray<{
  name: string;
  facts: DataStoreContentScanFacts;
  detail: string;
}> = [
  {
    name: "its Scan Content off",
    facts: probeStore({ isContentScanEnabled: false }),
    detail:
      "Content scanning is off for this store. Turn it on in its Settings.",
  },
  {
    name: "no longer found",
    facts: workerStore({ isArchived: true }),
    detail:
      "A store that is no longer found is not scanned. It is scanned again once it is found.",
  },
  {
    name: "the project's content scanning off",
    facts: workerStore({}, { projectSetting: { isContentScanEnabled: false } }),
    detail:
      "Content scanning is off for this project. Turn it on in Data Security's Settings.",
  },
  {
    name: "the project's telemetry scanning off",
    facts: telemetryStore({
      projectSetting: { isTelemetryScanEnabled: false },
    }),
    detail:
      "Telemetry scanning is off for this project. Turn it on in Data Security's Settings.",
  },
  {
    name: "a kind a probe does not scan",
    facts: probeStore({
      kind: DataStoreKind.AwsS3Bucket,
      provider: DataStoreProvider.Aws,
    }),
    detail:
      "A probe scans only stores you run: PostgreSQL, MySQL, SQL Server, Elasticsearch and OpenSearch. Scan this store from OneUptime's workers in its Settings.",
  },
  // Nothing samples it, a probe no more than OneUptime's workers (#11140).
  {
    name: "a kind nothing samples, set to scan from a probe",
    facts: probeStore({ kind: DataStoreKind.MongoDb }),
    detail: "OneUptime cannot sample this kind of store's content yet.",
  },
  {
    name: "no variable for the connection string",
    facts: probeStore({ probeConnectionVariable: null }),
    detail:
      "Name the probe's environment variable that holds the connection string, in its Settings.",
  },
  {
    name: "another project's probe",
    facts: probeStore(
      {},
      {
        scanProbe: {
          isGlobalProbe: false,
          projectId: "84488448-0000-4000-8000-0000000000ff",
          connectionStatus: ProbeConnectionStatus.Connected,
        },
      },
    ),
    detail:
      "Only a probe of this project's own scans a store. Pick one in its Settings.",
  },
  {
    name: "a disconnected probe",
    facts: probeStore(
      {},
      {
        scanProbe: {
          isGlobalProbe: false,
          projectId: PROJECT,
          connectionStatus: ProbeConnectionStatus.Disconnected,
        },
      },
    ),
    detail: "Nothing scans this store while {{probe}} is disconnected.",
  },
  {
    name: "overdue on its probe",
    facts: probeStore({ nextContentScanAt: minutesFromNow(-180) }),
    detail: "Due {{time}}. Check that {{probe}} is connected and up to date.",
  },
  {
    name: "overdue on OneUptime's workers",
    facts: workerStore({ nextContentScanAt: minutesFromNow(-180) }),
    detail: "Due {{time}}, and OneUptime's workers have not scanned it yet.",
  },
  {
    name: "a service's telemetry",
    facts: telemetryStore(),
    detail:
      "With the project's telemetry scan, from what its service sent in the last hour.",
  },
];

function storeDetail(
  facts: DataStoreContentScanFacts,
  translator: Translator,
  probeName: string | null = PROBE_NAME,
): string {
  return text(
    getStoreNextContentScanWords(
      getDataStoreNextContentScan(facts, new Date()),
      translator,
      probeName,
    ).detail,
  );
}

describe("the reasons are worded in every Dashboard language", () => {
  test("every sentence and every count of the four files is worded in every language, or kept as the language keeps it", () => {
    const sentences: Array<string> = sentencesOfTheReasons();

    // The scan read the files: the reasons are among what it found.
    expect(sentences).toEqual(
      expect.arrayContaining([
        "No credential is saved for this cloud.",
        "No password is saved for this vCenter.",
        "Nothing scans this store while {{probe}} is disconnected.",
        "{{count}} datastores",
        "{{count}} datastores_one",
      ]),
    );

    const english: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      for (const key of [...sentences, SCAN_NOW_BY_PROBE]) {
        if (!isWordedInDashboardLocale(key, language)) {
          english.push(`${language}: ${key}`);
        }
      }
    }

    expect(english).toEqual([]);
  });

  test("the Archived stop's two sentences, which nothing says since #8324, are gone from every file", () => {
    for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
      const words: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        title: words["This cloud is archived, so no probe collects it."],
        nextStep: words["Unarchive it to collect it again."],
      }).toEqual({ language, title: undefined, nextStep: undefined });
    }
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s: each cloud's reason, in its own words, with the probe named",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const reason of CLOUD_REASONS) {
        const english: OpenStackCollectionStatusView = cloudView(
          reason.columns(),
          ENGLISH,
        );
        const view: OpenStackCollectionStatusView = cloudView(
          reason.columns(),
          translator,
        );

        if (reason.title) {
          expect({ reason: reason.name, title: english.title }).toEqual({
            reason: reason.name,
            title: reason.title,
          });
          expect(english.nextStep).toBe(reason.nextStep);
        }

        for (const said of [view.title, view.nextStep, view.message]) {
          if (said) {
            expect(said).not.toContain("{{");
          }
        }

        expect({ reason: reason.name, title: view.title }).not.toEqual({
          reason: reason.name,
          title: english.title,
        });
        expect(view.nextStep).not.toBe(english.nextStep);

        if (reason.message) {
          expect(text(english.message)).toContain(
            reason.message.split(" {{")[0]!.split("{{")[0]!.trim() ||
              reason.message,
          );
          expect(text(view.message)).not.toBe(text(english.message));
        }
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s: each vCenter's reason, in its own words, with the probe named",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const reason of VCENTER_REASONS) {
        const english: VMwareCollectionStatusView = vcenterView(
          reason.columns(),
          ENGLISH,
        );
        const view: VMwareCollectionStatusView = vcenterView(
          reason.columns(),
          translator,
        );

        if (reason.title) {
          expect({ reason: reason.name, title: english.title }).toEqual({
            reason: reason.name,
            title: reason.title,
          });
          expect(english.nextStep).toBe(reason.nextStep);
        }

        for (const said of [view.title, view.nextStep, view.message]) {
          if (said) {
            expect(said).not.toContain("{{");
          }
        }

        expect({ reason: reason.name, title: view.title }).not.toEqual({
          reason: reason.name,
          title: english.title,
        });
        expect(view.nextStep).not.toBe(english.nextStep);

        if (reason.message) {
          expect(text(view.message)).not.toBe(text(english.message));
        }
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s: a disconnected probe is named in the cloud's and the vCenter's sentence, and 'its probe' is the language's own",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const disconnected: Probe = probeOf(ProbeConnectionStatus.Disconnected);
      const nameless: Probe = probeOf(ProbeConnectionStatus.Disconnected, true);

      for (const message of [
        cloudView({ collectionProbe: disconnected }, translator).message,
        vcenterView({ collectionProbe: disconnected }, translator).message,
      ]) {
        expect(text(message)).toContain(PROBE_NAME);
      }

      for (const message of [
        cloudView({ collectionProbe: nameless }, translator).message,
        vcenterView({ collectionProbe: nameless }, translator).message,
      ]) {
        expect(text(message)).not.toContain("its probe");
        expect(text(message)).not.toContain("{{");
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s: each reason nothing scans a store, and each late one, in its own words",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const storeCase of STORE_CASES) {
        const english: string = storeDetail(storeCase.facts, ENGLISH);
        const said: string = storeDetail(storeCase.facts, translator);

        // The case is the reason it says it is.
        expect({ store: storeCase.name, english }).toEqual({
          store: storeCase.name,
          english: expect.stringContaining(
            storeCase.detail.split("{{")[0]!.trim(),
          ),
        });
        expect({ store: storeCase.name, said }).not.toEqual({
          store: storeCase.name,
          said: english,
        });
        expect(said).not.toContain("{{");
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s: the store's reasons name its probe, or the language's 'its probe'",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const disconnected: DataStoreContentScanFacts = STORE_CASES.find(
        (storeCase: { name: string }): boolean => {
          return storeCase.name === "a disconnected probe";
        },
      )!.facts;

      expect(storeDetail(disconnected, translator)).toContain(PROBE_NAME);
      expect(
        storeDetail(
          probeStore({ nextContentScanAt: minutesFromNow(-180) }),
          translator,
        ),
      ).toContain(PROBE_NAME);

      const nameless: string = storeDetail(disconnected, translator, null);

      expect(nameless).not.toContain("its probe");
      expect(nameless).not.toContain("{{");
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s: Scan Now's refusals and its answer for a probe's store",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const stop of Object.values(DataStoreContentScanStop)) {
        const english: string = getStoreScanStopDetail(
          stop,
          ENGLISH,
          PROBE_NAME,
        );
        const said: string = getStoreScanStopDetail(
          stop,
          translator,
          PROBE_NAME,
        );

        expect({ stop, said }).not.toEqual({ stop, said: english });
      }

      expect(getStoreScanNowRefusal(telemetryStore(), translator)).not.toBe(
        getStoreScanNowRefusal(telemetryStore(), ENGLISH),
      );

      const answer: string = text(
        translator.translateTemplate(SCAN_NOW_BY_PROBE, { probe: PROBE_NAME }),
      );

      expect(answer).toContain(PROBE_NAME);
      expect(answer).not.toBe(
        text(
          ENGLISH.translateTemplate(SCAN_NOW_BY_PROBE, { probe: PROBE_NAME }),
        ),
      );
    },
  );
});

/*
 * What the last collection found, as counts: "48 hypervisors", "5 datastores" (OneUptime issue
 * #8584). Each count is a plural, written in the reader's numerals, in the form the reader's
 * language says for it: its "one" form for the counts the language calls one (0 and 1 in
 * French), its general form for every other. A language that keeps a word as English does
 * ("{{count}} datastore" in French) says so on its same-as-English list, and still reads its
 * own form.
 */
const OPENSTACK_COUNT_KEYS: ReadonlyArray<string> = [
  "{{count}} hypervisors",
  "{{count}} instances",
  "{{count}} networks",
  "{{count}} volumes",
  "{{count}} projects",
];

const VMWARE_COUNT_KEYS: ReadonlyArray<string> = [
  "{{count}} datacenters",
  "{{count}} clusters",
  "{{count}} hosts",
  "{{count}} virtual machines ({{running}} running)",
  "{{count}} datastores",
];

const COUNTS: ReadonlyArray<number> = [0, 1, 2, 5, 21, 1234];

function openStackSummary(count: number): OpenStackCollectionSummary {
  return {
    credentialKind: "applicationCredential",
    regionNames: ["RegionOne"],
    services: [],
    hypervisorCount: count,
    instanceCount: count,
    networkCount: count,
    volumeCount: count,
    projectCount: count,
    warnings: [],
  };
}

function vmwareSummary(count: number): VMwareCollectionSummary {
  return {
    datacenterCount: count,
    clusterCount: count,
    hostCount: count,
    vmCount: count,
    poweredOnVmCount: count,
    templateCount: 0,
    datastoreCount: count,
    resourcePoolCount: 0,
  } as VMwareCollectionSummary;
}

// The form `language`'s file has for `count`, filled as the page fills it.
function expectedCount(
  language: string,
  key: string,
  count: number,
  translator: Translator,
): string {
  const words: Record<string, string> = readDashboardLocale(language);
  const category: string = new Intl.PluralRules(language).select(count);
  const form: string = category === "one" ? words[`${key}_one`]! : words[key]!;
  const number: string = translator.formatNumber(count);

  return text(
    form.split("{{count}}").join(number).split("{{running}}").join(number),
  );
}

describe("the inventory's counts read in every Dashboard language", () => {
  test.each(DASHBOARD_LANGUAGES)(
    "%s: each count of a cloud and of a vCenter, in its form for the count and in the reader's numerals",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const count of COUNTS) {
        const cloud: Array<string> = getOpenStackInventoryPhrases(
          openStackSummary(count),
          translator,
        ).map(text);
        const vcenter: Array<string> = getVMwareInventoryPhrases(
          vmwareSummary(count),
          translator,
        ).map(text);

        expect({ language, count, cloud }).toEqual({
          language,
          count,
          cloud: OPENSTACK_COUNT_KEYS.map((key: string): string => {
            return expectedCount(language, key, count, translator);
          }),
        });
        expect({ language, count, vcenter }).toEqual({
          language,
          count,
          vcenter: VMWARE_COUNT_KEYS.map((key: string): string => {
            return expectedCount(language, key, count, translator);
          }),
        });

        for (const phrase of [...cloud, ...vcenter]) {
          expect(phrase).toContain(text(translator.formatNumber(count)));
          expect(phrase).not.toContain("{{");
        }
      }
    },
  );

  test("French says its one form at 0 and 1, the words it keeps as English does included", () => {
    const french: Translator = dashboardTranslator("fr");

    expect(
      getVMwareInventoryPhrases(vmwareSummary(0), french).map(text),
    ).toEqual(
      expect.arrayContaining(["0 datacenter", "0 datastore", "0 cluster"]),
    );
    expect(
      getVMwareInventoryPhrases(vmwareSummary(1), french).map(text),
    ).toEqual(
      expect.arrayContaining(["1 datacenter", "1 datastore", "1 hôte"]),
    );
    expect(
      getVMwareInventoryPhrases(vmwareSummary(2), french).map(text),
    ).toEqual(
      expect.arrayContaining(["2 datacenters", "2 datastores", "2 hôtes"]),
    );
    expect(
      getOpenStackInventoryPhrases(openStackSummary(0), french).map(text),
    ).toEqual(expect.arrayContaining(["0 instance", "0 volume"]));
  });

  test("German writes a thousand its own way; Persian and Arabic in their own numerals", () => {
    expect(
      text(
        getOpenStackInventoryPhrases(
          openStackSummary(1234),
          dashboardTranslator("de"),
        )[0],
      ),
    ).toMatch(/^1\.234 /);

    for (const language of ["fa", "ar"]) {
      const translator: Translator = dashboardTranslator(language);
      const phrase: string = text(
        getOpenStackInventoryPhrases(openStackSummary(1234), translator)[0],
      );

      expect(phrase).toContain(text(translator.formatNumber(1234)));
    }
  });
});

/*
 * The cards and the store's Next Content Scan, drawn: the reader's i18next, switched to each
 * language, as the Dashboard's is.
 */
describe("drawn in English, German, Arabic and Persian", () => {
  let stored: Record<string, unknown> = {};

  async function inLanguage(language: string): Promise<void> {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage(language);
    });
  }

  async function flush(): Promise<void> {
    await act(async () => {
      for (let index: number = 0; index < 10; index++) {
        await Promise.resolve();
      }
    });
  }

  function translatorIn(language: string): Translator {
    return language === "en" ? ENGLISH : dashboardTranslator(language);
  }

  beforeAll(async () => {
    const resources: Record<string, { translation: Record<string, string> }> =
      {};

    for (const language of DRAWN) {
      if (language !== "en") {
        resources[language] = {
          translation: readDashboardLocaleAsDrawn(language),
        };
      }
    }

    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: resources,
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  beforeEach(() => {
    PermissionGate.clearPermissionPropsCache();
    getItemMock.mockReset();
    getItemMock.mockImplementation(async (): Promise<unknown> => {
      const item: Record<string, unknown> = { ...stored };
      return item;
    });
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await inLanguage("en");
  });

  test.each(DRAWN)(
    "%s: a cloud's card says why no probe collects it, and the one thing that fixes it",
    async (language: string) => {
      await inLanguage(language);

      for (const reason of CLOUD_REASONS) {
        const cloud: OpenStackCloud = cloudOf(reason.columns());
        stored = { ...cloud };
        getItemMock.mockImplementation(async (): Promise<unknown> => {
          return cloudOf(reason.columns());
        });

        render(
          <OpenStackCollectionStatusCard modelId={new ObjectID(CLOUD_ID)} />,
        );
        await flush();

        const expected: OpenStackCollectionStatusView = cloudView(
          reason.columns(),
          translatorIn(language),
        );
        const drawn: string = text(
          screen.getByTestId("openstack-collection-status").textContent,
        );

        expect({ language, reason: reason.name, drawn }).toEqual({
          language,
          reason: reason.name,
          drawn: expect.stringContaining(text(expected.title)),
        });

        for (const said of [expected.nextStep, expected.message]) {
          if (said) {
            expect(drawn).toContain(text(said));
          }
        }

        if (language !== "en") {
          // Nothing of the English reason is left on the page.
          for (const key of [reason.title, reason.nextStep]) {
            if (key) {
              expect(drawn).not.toContain(key);
            }
          }
        }

        cleanup();
      }
    },
  );

  test.each(DRAWN)(
    "%s: a vCenter's card says why no probe collects it, and the one thing that fixes it",
    async (language: string) => {
      await inLanguage(language);

      for (const reason of VCENTER_REASONS) {
        getItemMock.mockImplementation(async (): Promise<unknown> => {
          return vcenterOf(reason.columns());
        });

        render(
          <VMwareCollectionStatusCard modelId={new ObjectID(VCENTER_ID)} />,
        );
        await flush();

        const expected: VMwareCollectionStatusView = vcenterView(
          reason.columns(),
          translatorIn(language),
        );
        const drawn: string = text(
          screen.getByTestId("vmware-collection-status").textContent,
        );

        expect({ language, reason: reason.name, drawn }).toEqual({
          language,
          reason: reason.name,
          drawn: expect.stringContaining(text(expected.title)),
        });

        for (const said of [expected.nextStep, expected.message]) {
          if (said) {
            expect(drawn).toContain(text(said));
          }
        }

        if (language !== "en") {
          for (const key of [reason.title, reason.nextStep]) {
            if (key) {
              expect(drawn).not.toContain(key);
            }
          }
        }

        cleanup();
      }
    },
  );

  test.each(DRAWN)(
    "%s: a collected cloud's card counts what it read in the reader's words and numerals",
    async (language: string) => {
      await inLanguage(language);

      for (const count of [1, 1234]) {
        getItemMock.mockImplementation(async (): Promise<unknown> => {
          return cloudOf({
            collectionStatus: OpenStackCollectionStatus.Succeeded,
            lastCollectionAt: new Date(),
            lastSuccessfulCollectionAt: new Date(),
            collectionSummary: openStackSummary(count),
          });
        });

        render(
          <OpenStackCollectionStatusCard modelId={new ObjectID(CLOUD_ID)} />,
        );
        await flush();

        const drawn: string = text(
          screen.getByTestId("openstack-collection-inventory").textContent,
        );

        for (const phrase of getOpenStackInventoryPhrases(
          openStackSummary(count),
          translatorIn(language),
        )) {
          expect({ language, count, drawn }).toEqual({
            language,
            count,
            drawn: expect.stringContaining(text(phrase)),
          });
        }

        cleanup();
      }
    },
  );

  test.each(DRAWN)(
    "%s: a store's Next Content Scan says why nothing scans it, or that it is late",
    async (language: string) => {
      await inLanguage(language);

      for (const storeCase of STORE_CASES) {
        render(
          <StoreNextContentScan
            facts={storeCase.facts}
            probeName={PROBE_NAME}
          />,
        );

        const drawn: string = text(
          screen.getByTestId("data-store-next-content-scan").textContent,
        );
        const expected: string = storeDetail(
          storeCase.facts,
          translatorIn(language),
        );

        expect({ language, store: storeCase.name, drawn }).toEqual({
          language,
          store: storeCase.name,
          drawn: expect.stringContaining(expected),
        });

        if (language !== "en") {
          expect(drawn).not.toContain(storeCase.detail.split("{{")[0]!.trim());
        }

        cleanup();
      }
    },
  );
});

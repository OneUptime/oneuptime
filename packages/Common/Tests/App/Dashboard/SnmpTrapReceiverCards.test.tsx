/** @timezone UTC */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import DeviceProbeSnmpEngineId from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceProbeSnmpEngineId";
import DeviceSnmpTrapRefusals from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSnmpTrapRefusals";
import ProbeSnmpTraps from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/ProbeSnmpTraps";
import {
  DEVICE_PROBE_ENGINE_ID_NOT_REPORTED,
  DEVICE_SNMP_TRAP_REFUSALS_DESCRIPTION,
  SNMP_TRAP_REFUSAL_ENGINE_ID_FIX,
  SNMP_TRAP_REFUSAL_FIXES,
  SNMP_TRAP_REFUSAL_HEADLINE,
  SNMP_TRAP_REFUSAL_REASONS,
  SNMP_TRAPS_CARD_TITLE,
  SNMP_TRAPS_ENGINE_ID_HINT,
  SNMP_TRAPS_LISTEN_ERROR_OTHER,
  SNMP_TRAPS_LISTEN_ERRORS,
  SNMP_TRAPS_NONE_RECEIVED,
  SNMP_TRAPS_NONE_REFUSED,
  SNMP_TRAPS_NO_USERS,
  SNMP_TRAPS_NOT_REPORTED,
  SNMP_TRAPS_REFUSED_TITLE,
  SNMP_TRAPS_TURNED_OFF,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/SnmpTrapReceiverCopy";
import GlobalProbeSnmpTrapReport from "../../../Models/DatabaseModels/GlobalProbeSnmpTrapReport";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Probe from "../../../Models/DatabaseModels/Probe";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ObjectID from "../../../Types/ObjectID";
import {
  SnmpTrapReceiverReport,
  SnmpTrapRefusal,
  SnmpTrapRefusalReason,
} from "../../../Types/Probe/SnmpTrapReceiver";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * A PROBE'S SNMP TRAPS CARD, AND A DEVICE'S REFUSED SNMPv3 TRAPS (#11005).
 *
 * The probe's page says where its trap receiver listens, the SNMPv3 engine
 * ID a device sending informs needs (to copy), how many SNMPv3 users it
 * takes traps from, and every SNMPv3 trap it refused in the last day: one
 * sentence per source, reason and user - "12 SNMPv3 traps from 10.20.0.5
 * failed: unknown user “san-monitor”" - with what to change under it. A
 * device's pages say the same of the refusals from the device's own
 * addresses, with the way to its credentials and to its probe, and say
 * nothing while its traps are taken. Neither shows a reader who may not
 * read the probe's report, and neither asks for it then.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const DE: Record<string, string> = readLocale("de");
const FA: Record<string, string> = readLocale("fa");

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const PROBE_ID: ObjectID = new ObjectID("30000000-0000-4000-8000-000000000001");
const DEVICE_ID: ObjectID = new ObjectID(
  "40000000-0000-4000-8000-000000000001",
);

const ENGINE_ID: string = "8000B98380A1B2C3D4E5F60718293A4B";

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function refusal(fields: Partial<SnmpTrapRefusal>): SnmpTrapRefusal {
  return {
    sourceAddress: "10.20.0.5",
    reason: SnmpTrapRefusalReason.UnknownUser,
    userName: "san-monitor",
    count: 12,
    firstSeenAt: minutesAgo(5 * 60),
    lastSeenAt: minutesAgo(3),
    ...fields,
  };
}

// A probe whose receiver listens, and refused three sources' traps.
function listening(): SnmpTrapReceiverReport {
  return {
    isEnabled: true,
    port: 162,
    engineId: ENGINE_ID,
    userCount: 14,
    lastReceivedAt: minutesAgo(1),
    refusals: [
      refusal({}),
      refusal({
        sourceAddress: "10.20.0.9",
        reason: SnmpTrapRefusalReason.WrongDigest,
        userName: "fabric-monitor",
        count: 3,
        firstSeenAt: minutesAgo(50),
        lastSeenAt: minutesAgo(12),
      }),
      refusal({
        sourceAddress: "10.20.0.12",
        reason: SnmpTrapRefusalReason.UnknownEngineId,
        count: 1,
        firstSeenAt: minutesAgo(26),
        lastSeenAt: minutesAgo(26),
      }),
    ],
  };
}

// What the API holds, which each test sets.
let report: SnmpTrapReceiverReport | undefined;
let device: {
  hostname: string;
  otherAddresses?: string | undefined;
  hasProbe: boolean;
  // On one of OneUptime's global probes, which many projects share.
  isGlobalProbe?: boolean | undefined;
};
let readError: Error | HTTPErrorResponse | null;
/*
 * This project's share of a global probe's refusals, as its row holds them:
 * null is no row yet.
 */
let share: Array<SnmpTrapRefusal> | null;
let shareError: Error | null;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: DE },
      fa: { translation: FA },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  report = listening();
  device = {
    hostname: "10.20.0.5",
    // Its management address, from which it sends informs.
    otherAddresses: "10.20.0.12",
    hasProbe: true,
  };
  readError = null;
  share = null;
  shareError = null;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ModelAPI, "getList").mockImplementation(((data: {
    modelType: unknown;
  }): Promise<unknown> => {
    if (data.modelType !== GlobalProbeSnmpTrapReport) {
      return Promise.reject(new Error("not asked for in these tests"));
    }

    if (shareError) {
      return Promise.reject(shareError);
    }

    const rows: Array<GlobalProbeSnmpTrapReport> = [];

    if (share) {
      const row: GlobalProbeSnmpTrapReport = new GlobalProbeSnmpTrapReport();
      row._id = "50000000-0000-4000-8000-000000000001";
      row.refusals = share;
      rows.push(row);
    }

    return Promise.resolve({
      data: rows,
      count: rows.length,
      skip: 0,
      limit: 1,
    });
  }) as never);
  jest.spyOn(ModelAPI, "getItem").mockImplementation(((data: {
    modelType: unknown;
  }): Promise<unknown> => {
    if (readError) {
      return Promise.reject(readError);
    }

    const probe: Probe = new Probe();
    probe._id = PROBE_ID.toString();
    probe.isGlobalProbe = Boolean(device.isGlobalProbe);

    if (report) {
      probe.snmpTrapReceiver = report;
    }

    if (data.modelType === NetworkDevice) {
      const item: NetworkDevice = new NetworkDevice();
      item._id = DEVICE_ID.toString();
      item.hostname = device.hostname;

      if (device.otherAddresses !== undefined) {
        item.otherAddresses = device.otherAddresses;
      }

      if (device.hasProbe) {
        item.probeId = PROBE_ID;
        item.probe = probe;
      }

      return Promise.resolve(item);
    }

    return Promise.resolve(probe);
  }) as never);
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

async function renderProbeCard(language: string = "en"): Promise<HTMLElement> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });

  render(
    <MemoryRouter>
      <ProbeSnmpTraps probeId={PROBE_ID} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(ModelAPI.getItem).toHaveBeenCalled();
  });

  return document.body;
}

// The card once it has read the probe: listening, off, not reported.
async function findCardBody(testId: string): Promise<HTMLElement> {
  return screen.findByTestId(testId);
}

function rows(): Array<HTMLElement> {
  return screen.getAllByTestId("snmp-trap-refusal");
}

function fill(template: string, values: Record<string, string>): string {
  let text: string = template;

  for (const [name, value] of Object.entries(values)) {
    text = text.split(`{{${name}}}`).join(value);
  }

  return text;
}

describe("a probe's SNMP Traps card", () => {
  test("asks for the probe's receiver report, and nothing else of it", async () => {
    await renderProbeCard();
    await findCardBody("probe-snmp-traps");

    expect(ModelAPI.getItem).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: Probe,
        id: PROBE_ID,
        select: { _id: true, snmpTrapReceiver: true },
      }),
    );
  });

  test("a probe that has not reported its receiver yet says so", async () => {
    report = undefined;
    await renderProbeCard();

    expect(
      await findCardBody("probe-snmp-traps-not-reported"),
    ).toHaveTextContent(SNMP_TRAPS_NOT_REPORTED);
    expect(screen.getByText(SNMP_TRAPS_CARD_TITLE)).toBeInTheDocument();
    expect(
      screen.queryByTestId("probe-snmp-engine-id"),
    ).not.toBeInTheDocument();
  });

  test("a receiver that is off says who turned it off, and nothing else", async () => {
    report = { isEnabled: false, refusals: [] };
    await renderProbeCard();

    expect(await findCardBody("probe-snmp-traps-off")).toHaveTextContent(
      SNMP_TRAPS_TURNED_OFF,
    );
    expect(
      screen.queryByTestId("probe-snmp-engine-id"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(SNMP_TRAPS_REFUSED_TITLE),
    ).not.toBeInTheDocument();
  });

  test("a listening receiver says where it listens, its engine ID to copy, its users and its last trap", async () => {
    await renderProbeCard();
    const card: HTMLElement = await findCardBody("probe-snmp-traps");

    expect(card).toHaveTextContent("Listens OnUDP port 162");
    expect(within(card).getByTestId("probe-snmp-engine-id")).toHaveTextContent(
      ENGINE_ID,
    );
    expect(
      within(card).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
    expect(card).toHaveTextContent(SNMP_TRAPS_ENGINE_ID_HINT);
    expect(within(card).getByTestId("probe-snmp-users")).toHaveTextContent(
      "14 users, from the devices and sites that use this probe",
    );
    expect(card).toHaveTextContent("Last Trap");
    expect(card).not.toHaveTextContent(SNMP_TRAPS_NONE_RECEIVED);
  });

  test("a receiver on another port says that port", async () => {
    report = { ...listening(), port: 1162 };
    await renderProbeCard();

    expect(await findCardBody("probe-snmp-traps")).toHaveTextContent(
      "UDP port 1162",
    );
  });

  test("one user is one user", async () => {
    report = { ...listening(), userCount: 1 };
    await renderProbeCard();
    await findCardBody("probe-snmp-traps");

    expect(screen.getByTestId("probe-snmp-users")).toHaveTextContent(
      "1 user, from the devices and sites that use this probe",
    );
  });

  test("no users yet says what gives it some", async () => {
    report = { ...listening(), userCount: 0 };
    await renderProbeCard();
    await findCardBody("probe-snmp-traps");

    expect(screen.getByTestId("probe-snmp-users")).toHaveTextContent(
      SNMP_TRAPS_NO_USERS,
    );
  });

  test("no trap received yet says none yet", async () => {
    report = { ...listening(), lastReceivedAt: undefined };
    await renderProbeCard();

    expect(await findCardBody("probe-snmp-traps")).toHaveTextContent(
      `Last Trap${SNMP_TRAPS_NONE_RECEIVED}`,
    );
  });

  test("each refused source is one sentence, with what to change under it and when it happened", async () => {
    await renderProbeCard();
    await findCardBody("probe-snmp-traps");

    const refused: Array<HTMLElement> = rows();

    expect(refused).toHaveLength(3);
    expect(refused[0]).toHaveTextContent(
      "12 SNMPv3 traps from 10.20.0.5 failed: unknown user “san-monitor”",
    );
    expect(refused[0]).toHaveTextContent(
      SNMP_TRAP_REFUSAL_FIXES[SnmpTrapRefusalReason.UnknownUser],
    );
    expect(refused[0]).toHaveTextContent(
      "Last refused 3 minutes ago, first 5 hours ago",
    );
    expect(refused[1]).toHaveTextContent(
      "3 SNMPv3 traps from 10.20.0.9 failed: wrong authentication passphrase or protocol for “fabric-monitor”",
    );
    // One is one.
    expect(refused[2]).toHaveTextContent(
      "1 SNMPv3 trap from 10.20.0.12 failed: informs from “san-monitor” sent to another engine ID than this probe's",
    );
  });

  test.each(Object.values(SnmpTrapRefusalReason))(
    "a trap refused for %s says why, as whom it came, and what to change",
    async (reason: SnmpTrapRefusalReason) => {
      report = {
        ...listening(),
        refusals: [
          refusal({ reason: reason, userName: "brocade-traps", count: 2 }),
        ],
      };
      await renderProbeCard();
      await findCardBody("probe-snmp-traps");

      const [row] = rows();

      expect(row).toHaveTextContent(
        fill(SNMP_TRAP_REFUSAL_HEADLINE.other, {
          count: "2",
          address: "10.20.0.5",
          reason: fill(SNMP_TRAP_REFUSAL_REASONS[reason], {
            user: "brocade-traps",
          }),
        }),
      );
      expect(row).toHaveTextContent(SNMP_TRAP_REFUSAL_FIXES[reason]);
    },
  );

  test("every reason has its own sentence and its own fix", () => {
    const reasons: Array<SnmpTrapRefusalReason> = Object.values(
      SnmpTrapRefusalReason,
    );

    expect(
      new Set(
        reasons.map((reason: SnmpTrapRefusalReason) => {
          return SNMP_TRAP_REFUSAL_REASONS[reason];
        }),
      ).size,
    ).toBe(reasons.length);
    expect(
      new Set(
        reasons.map((reason: SnmpTrapRefusalReason) => {
          return SNMP_TRAP_REFUSAL_FIXES[reason];
        }),
      ).size,
    ).toBe(reasons.length);

    for (const reason of reasons) {
      // Each names the user the traps came as.
      expect(SNMP_TRAP_REFUSAL_REASONS[reason]).toContain("“{{user}}”");
    }
  });

  test("nothing refused says so", async () => {
    report = { ...listening(), refusals: [] };
    await renderProbeCard();

    expect(
      await findCardBody("probe-snmp-traps-none-refused"),
    ).toHaveTextContent(SNMP_TRAPS_NONE_REFUSED);
    expect(screen.queryByTestId("snmp-trap-refusal")).not.toBeInTheDocument();
  });

  test.each([
    ["EACCES", SNMP_TRAPS_LISTEN_ERRORS["EACCES"] as string],
    ["EADDRINUSE", SNMP_TRAPS_LISTEN_ERRORS["EADDRINUSE"] as string],
    ["ENODEV", SNMP_TRAPS_LISTEN_ERROR_OTHER],
  ])(
    "a receiver that cannot listen (%s) says so first, and what it costs",
    async (code: string, words: string) => {
      report = { ...listening(), listenError: code, refusals: [] };
      await renderProbeCard();
      await findCardBody("probe-snmp-traps");

      expect(
        screen.getByTestId("probe-snmp-traps-listen-error"),
      ).toHaveTextContent(fill(words, { port: "162", code: code }));
    },
  );

  test("a receiver that listens shows no listening error", async () => {
    await renderProbeCard();
    await findCardBody("probe-snmp-traps");

    expect(
      screen.queryByTestId("probe-snmp-traps-listen-error"),
    ).not.toBeInTheDocument();
  });

  test("a report that cannot be read says why, in the card", async () => {
    readError = new HTTPErrorResponse(
      400,
      { message: "This probe could not be read." },
      {},
    );
    await renderProbeCard();

    expect(
      await screen.findByText("This probe could not be read."),
    ).toBeInTheDocument();
    expect(screen.getByText(SNMP_TRAPS_CARD_TITLE)).toBeInTheDocument();
  });

  test("a reader who may not read the report sees no card, and nothing is asked", async () => {
    jest.spyOn(PermissionGate, "hasPermissionSnapshot").mockReturnValue(true);
    jest.spyOn(PermissionGate, "canReadColumn").mockReturnValue(false);

    const { container } = render(
      <MemoryRouter>
        <ProbeSnmpTraps probeId={PROBE_ID} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
    expect(ModelAPI.getItem).not.toHaveBeenCalled();
  });

  test("in German, each refused source is a German sentence, in its plural form", async () => {
    await renderProbeCard("de");
    await findCardBody("probe-snmp-traps");

    const refused: Array<HTMLElement> = rows();
    const headline: string = SNMP_TRAP_REFUSAL_HEADLINE.other;

    expect(refused[0]).toHaveTextContent(
      fill(DE[headline] as string, {
        count: "12",
        address: "10.20.0.5",
        reason: fill(
          DE[
            SNMP_TRAP_REFUSAL_REASONS[SnmpTrapRefusalReason.UnknownUser]
          ] as string,
          { user: "san-monitor" },
        ),
      }),
    );
    expect(refused[2]).toHaveTextContent(
      fill(DE[`${headline}_one`] as string, {
        count: "1",
        address: "10.20.0.12",
        reason: fill(
          DE[
            SNMP_TRAP_REFUSAL_REASONS[SnmpTrapRefusalReason.UnknownEngineId]
          ] as string,
          { user: "san-monitor" },
        ),
      }),
    );
    expect(
      screen.getByText(DE[SNMP_TRAPS_CARD_TITLE] as string),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("failed:");
  });

  test("in Persian, every sentence is Persian, the count in Persian digits", async () => {
    await renderProbeCard("fa");
    await findCardBody("probe-snmp-traps");

    const [first] = rows();
    const reason: string = fill(
      FA[
        SNMP_TRAP_REFUSAL_REASONS[SnmpTrapRefusalReason.UnknownUser]
      ] as string,
      { user: "san-monitor" },
    );

    expect(first).toHaveTextContent(reason);
    expect(first).toHaveTextContent("10.20.0.5");
    expect(first).toHaveTextContent("۱۲");
    expect(first).toHaveTextContent(
      FA[SNMP_TRAP_REFUSAL_FIXES[SnmpTrapRefusalReason.UnknownUser]] as string,
    );
    expect(document.body).not.toHaveTextContent("failed:");
  });
});

async function renderDevicePage(): Promise<HTMLElement> {
  const { container } = render(
    <MemoryRouter>
      <DeviceSnmpTrapRefusals modelId={DEVICE_ID} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(ModelAPI.getItem).toHaveBeenCalled();
  });

  return container;
}

describe("a device's refused SNMPv3 traps", () => {
  test("asks for the device's addresses and its probe's report, and nothing else", async () => {
    await renderDevicePage();
    await screen.findByTestId("device-snmp-trap-refusals");

    expect(ModelAPI.getItem).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: NetworkDevice,
        id: DEVICE_ID,
        select: {
          hostname: true,
          otherAddresses: true,
          probeId: true,
          probe: { _id: true, isGlobalProbe: true, snmpTrapReceiver: true },
        },
      }),
    );
    // A project probe keeps its whole report: no share is asked for.
    expect(ModelAPI.getList).not.toHaveBeenCalled();
  });

  test("says how many of its own traps were refused, which, what to change, and the way to change it", async () => {
    await renderDevicePage();
    const banner: HTMLElement = await screen.findByTestId(
      "device-snmp-trap-refusals",
    );

    expect(banner).toHaveTextContent(
      "13 SNMPv3 traps from this device were refused",
    );
    expect(banner).toHaveTextContent(DEVICE_SNMP_TRAP_REFUSALS_DESCRIPTION);

    const refused: Array<HTMLElement> =
      within(banner).getAllByTestId("snmp-trap-refusal");

    // Its hostname's and its Other Address's - not another device's.
    expect(refused).toHaveLength(2);
    expect(refused[0]).toHaveTextContent("from 10.20.0.5 failed");
    expect(refused[1]).toHaveTextContent("from 10.20.0.12 failed");
    expect(banner).not.toHaveTextContent("10.20.0.9");

    expect(
      within(banner).getByRole("link", { name: "Edit SNMP Credentials" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/network-devices/${DEVICE_ID.toString()}/settings`,
    );
    expect(
      within(banner).getByRole("link", { name: "View Probe" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/monitors/settings/probes/${PROBE_ID.toString()}`,
    );
  });

  test("one refused trap is one", async () => {
    device = {
      hostname: "10.20.0.77",
      otherAddresses: "10.20.0.12",
      hasProbe: true,
    };
    await renderDevicePage();

    expect(
      await screen.findByTestId("device-snmp-trap-refusals"),
    ).toHaveTextContent("1 SNMPv3 trap from this device was refused");
  });

  test("a device named by its hostname is matched by its Other Addresses", async () => {
    device = {
      hostname: "san-switch-01.example.com",
      otherAddresses: "10.20.0.5",
      hasProbe: true,
    };
    await renderDevicePage();

    expect(
      await screen.findByTestId("device-snmp-trap-refusals"),
    ).toHaveTextContent("12 SNMPv3 traps from this device were refused");
  });

  test.each([
    [
      "none of its addresses was refused",
      (): void => {
        device = { hostname: "10.20.0.77", hasProbe: true };
      },
    ],
    [
      "it has no probe",
      (): void => {
        device = { ...device, hasProbe: false };
      },
    ],
    [
      "its probe has not reported",
      (): void => {
        report = undefined;
      },
    ],
    [
      "its probe refused nothing",
      (): void => {
        report = { ...listening(), refusals: [] };
      },
    ],
    [
      "its probe could not be read",
      (): void => {
        readError = new Error("offline");
      },
    ],
  ])("says nothing when %s", async (_case: string, arrange: () => void) => {
    arrange();
    const container: HTMLElement = await renderDevicePage();

    // Give the read its turn to land.
    await act(async () => {
      await Promise.resolve();
    });

    expect(container).toBeEmptyDOMElement();
  });

  test("can be put away", async () => {
    await renderDevicePage();
    const banner: HTMLElement = await screen.findByTestId(
      "device-snmp-trap-refusals",
    );

    fireEvent.click(within(banner).getByRole("button", { name: "Close" }));

    expect(
      screen.queryByTestId("device-snmp-trap-refusals"),
    ).not.toBeInTheDocument();
  });

  test("a reader who may not read the probe's report sees nothing, and nothing is asked", async () => {
    jest.spyOn(PermissionGate, "hasPermissionSnapshot").mockReturnValue(true);
    jest.spyOn(PermissionGate, "canReadColumn").mockReturnValue(false);

    const { container } = render(
      <MemoryRouter>
        <DeviceSnmpTrapRefusals modelId={DEVICE_ID} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
    expect(ModelAPI.getItem).not.toHaveBeenCalled();
  });

  test("an inform sent to another engine ID says the probe's engine ID there, to copy, beside View Probe", async () => {
    await renderDevicePage();
    const banner: HTMLElement = await screen.findByTestId(
      "device-snmp-trap-refusals",
    );
    const refused: Array<HTMLElement> =
      within(banner).getAllByTestId("snmp-trap-refusal");

    // 10.20.0.12, its management address, sent informs to another engine ID.
    const fix: HTMLElement = within(refused[1]!).getByTestId(
      "snmp-trap-refusal-engine-id-fix",
    );

    expect(fix).toHaveTextContent(SNMP_TRAP_REFUSAL_ENGINE_ID_FIX);
    expect(
      within(fix).getByTestId("snmp-trap-refusal-probe-engine-id"),
    ).toHaveTextContent(ENGINE_ID);
    expect(within(fix).getByRole("button", { name: /Copy/ })).toBeVisible();
    expect(refused[1]).not.toHaveTextContent(
      SNMP_TRAP_REFUSAL_FIXES[SnmpTrapRefusalReason.UnknownEngineId],
    );

    // Every other reason keeps its own fix, with no engine ID.
    expect(refused[0]).toHaveTextContent(
      SNMP_TRAP_REFUSAL_FIXES[SnmpTrapRefusalReason.UnknownUser],
    );
    expect(
      within(refused[0]!).queryByTestId("snmp-trap-refusal-engine-id-fix"),
    ).not.toBeInTheDocument();
    expect(
      within(banner).getByRole("link", { name: "View Probe" }),
    ).toBeVisible();
  });
});

/*
 * A DEVICE ON A GLOBAL PROBE (#11173).
 *
 * OneUptime's global probes serve many projects, so what one refuses is
 * split by the project whose devices sent it, and a project reads only its
 * own share (GlobalProbeSnmpTrapReport). The probe's own row says only what
 * belongs to no project: whether it listens, where, and its engine ID. A
 * device's pages read the refusals from the share - never from the probe's
 * row - and say the probe's engine ID where a link to the probe's page
 * would be: a global probe has no page a project opens.
 */
describe("a device on a global probe's refused SNMPv3 traps", () => {
  beforeEach(() => {
    device = { ...device, isGlobalProbe: true };
    // What a global probe's row holds: what belongs to no project.
    report = { isEnabled: true, port: 162, engineId: ENGINE_ID, refusals: [] };
    share = [
      refusal({}),
      // Another device of this project, at an address of its own.
      refusal({
        sourceAddress: "10.20.0.9",
        reason: SnmpTrapRefusalReason.WrongDigest,
        userName: "fabric-monitor",
        count: 3,
      }),
      refusal({
        sourceAddress: "10.20.0.12",
        reason: SnmpTrapRefusalReason.UnknownEngineId,
        userName: "san-informs",
        count: 1,
      }),
    ];
  });

  test("asks for this project's share of the probe's refusals, by the probe, and nothing else of it", async () => {
    await renderDevicePage();
    await screen.findByTestId("device-snmp-trap-refusals");

    expect(ModelAPI.getList).toHaveBeenCalledTimes(1);
    expect(ModelAPI.getList).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: GlobalProbeSnmpTrapReport,
        query: { probeId: PROBE_ID },
        select: { _id: true, refusals: true },
        limit: 1,
        skip: 0,
      }),
    );
  });

  test("says the refused traps from its own addresses, out of its project's share", async () => {
    await renderDevicePage();
    const banner: HTMLElement = await screen.findByTestId(
      "device-snmp-trap-refusals",
    );

    expect(banner).toHaveTextContent(
      "13 SNMPv3 traps from this device were refused",
    );

    const refused: Array<HTMLElement> =
      within(banner).getAllByTestId("snmp-trap-refusal");

    expect(refused).toHaveLength(2);
    expect(refused[0]).toHaveTextContent("from 10.20.0.5 failed");
    expect(refused[0]).toHaveTextContent("unknown user “san-monitor”");
    expect(refused[1]).toHaveTextContent("from 10.20.0.12 failed");
    expect(banner).not.toHaveTextContent("10.20.0.9");
    expect(banner).not.toHaveTextContent("fabric-monitor");
  });

  test("an inform sent to another engine ID says the global probe's engine ID, to copy", async () => {
    await renderDevicePage();
    const banner: HTMLElement = await screen.findByTestId(
      "device-snmp-trap-refusals",
    );
    const fix: HTMLElement = within(banner).getByTestId(
      "snmp-trap-refusal-engine-id-fix",
    );

    expect(fix).toHaveTextContent(SNMP_TRAP_REFUSAL_ENGINE_ID_FIX);
    expect(
      within(fix).getByTestId("snmp-trap-refusal-probe-engine-id"),
    ).toHaveTextContent(ENGINE_ID);
    // Not "shown on the probe's page": there is no such page here.
    expect(banner).not.toHaveTextContent(
      SNMP_TRAP_REFUSAL_FIXES[SnmpTrapRefusalReason.UnknownEngineId],
    );
  });

  test("links to the device's credentials, and to no probe page", async () => {
    await renderDevicePage();
    const banner: HTMLElement = await screen.findByTestId(
      "device-snmp-trap-refusals",
    );

    expect(
      within(banner).getByRole("link", { name: "Edit SNMP Credentials" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/network-devices/${DEVICE_ID.toString()}/settings`,
    );
    expect(
      within(banner).queryByRole("link", { name: "View Probe" }),
    ).not.toBeInTheDocument();
  });

  test("never reads refusals off the probe's own row: only its project's share", async () => {
    // A row written before the split, holding every project's refusals.
    report = listening();
    share = [];

    const container: HTMLElement = await renderDevicePage();

    await waitFor(() => {
      expect(ModelAPI.getList).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container).toBeEmptyDOMElement();
  });

  test.each([
    [
      "its project has no share yet",
      (): void => {
        share = null;
      },
    ],
    [
      "its project's share refused nothing",
      (): void => {
        share = [];
      },
    ],
    [
      "its project's share refused only other addresses",
      (): void => {
        share = [refusal({ sourceAddress: "10.20.0.9" })];
      },
    ],
    [
      "its project's share cannot be read",
      (): void => {
        shareError = new Error("offline");
      },
    ],
  ])("says nothing when %s", async (_case: string, arrange: () => void) => {
    arrange();
    const container: HTMLElement = await renderDevicePage();

    await waitFor(() => {
      expect(ModelAPI.getList).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container).toBeEmptyDOMElement();
  });

  test("a reader who may not read the probe's report sees nothing, and neither the device nor a share is asked for", async () => {
    jest.spyOn(PermissionGate, "hasPermissionSnapshot").mockReturnValue(true);
    jest.spyOn(PermissionGate, "canReadColumn").mockReturnValue(false);

    const { container } = render(
      <MemoryRouter>
        <DeviceSnmpTrapRefusals modelId={DEVICE_ID} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
    expect(ModelAPI.getItem).not.toHaveBeenCalled();
    expect(ModelAPI.getList).not.toHaveBeenCalled();
  });
});

async function renderProbeEngineId(language: string = "en"): Promise<HTMLElement> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });

  const { container } = render(
    <MemoryRouter>
      <DeviceProbeSnmpEngineId modelId={DEVICE_ID} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(ModelAPI.getItem).toHaveBeenCalled();
  });

  return container;
}

/*
 * ITS PROBE'S ENGINE ID, ON A DEVICE'S LOGS PAGE (#11173).
 *
 * A device that sends SNMPv3 informs authenticates them with its probe's
 * engine ID, and some must be given it. A project probe's page shows it; a
 * device on a global probe has nowhere else to read it.
 */
describe("a device's probe's SNMPv3 engine ID, on its Logs page", () => {
  test("asks for its probe's report through the device, and nothing else", async () => {
    await renderProbeEngineId();
    await screen.findByTestId("device-probe-snmp-engine-id");

    expect(ModelAPI.getItem).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: NetworkDevice,
        id: DEVICE_ID,
        select: {
          probeId: true,
          probe: { _id: true, snmpTrapReceiver: true },
        },
      }),
    );
    expect(ModelAPI.getList).not.toHaveBeenCalled();
  });

  test("says the engine ID, to copy, and what a device does with it", async () => {
    await renderProbeEngineId();
    const block: HTMLElement = await screen.findByTestId(
      "device-probe-snmp-engine-id",
    );

    expect(block).toHaveTextContent("SNMPv3 Engine ID");
    expect(
      within(block).getByTestId("device-probe-snmp-engine-id-value"),
    ).toHaveTextContent(ENGINE_ID);
    expect(within(block).getByRole("button", { name: /Copy/ })).toBeVisible();
    expect(block).toHaveTextContent(SNMP_TRAPS_ENGINE_ID_HINT);
  });

  test("a global probe's too, from what it says of itself to every project", async () => {
    device = { ...device, isGlobalProbe: true };
    report = { isEnabled: true, port: 162, engineId: ENGINE_ID, refusals: [] };

    await renderProbeEngineId();

    expect(
      await screen.findByTestId("device-probe-snmp-engine-id-value"),
    ).toHaveTextContent(ENGINE_ID);
  });

  test("a probe that has not reported its receiver yet says the engine ID will be here", async () => {
    report = undefined;
    await renderProbeEngineId();

    expect(
      await screen.findByTestId("device-probe-snmp-engine-id-not-reported"),
    ).toHaveTextContent(DEVICE_PROBE_ENGINE_ID_NOT_REPORTED);
    expect(
      screen.queryByTestId("device-probe-snmp-engine-id"),
    ).not.toBeInTheDocument();
  });

  test.each([
    [
      "it has no probe",
      (): void => {
        device = { ...device, hasProbe: false };
      },
    ],
    [
      "its probe's receiver is off",
      (): void => {
        report = { isEnabled: false, refusals: [] };
      },
    ],
    [
      "its probe could not be read",
      (): void => {
        readError = new Error("offline");
      },
    ],
  ])("says nothing when %s", async (_case: string, arrange: () => void) => {
    arrange();
    const container: HTMLElement = await renderProbeEngineId();

    await act(async () => {
      await Promise.resolve();
    });

    expect(container).toBeEmptyDOMElement();
  });

  test("a reader who may not read the probe's report sees nothing, and nothing is asked", async () => {
    jest.spyOn(PermissionGate, "hasPermissionSnapshot").mockReturnValue(true);
    jest.spyOn(PermissionGate, "canReadColumn").mockReturnValue(false);

    const { container } = render(
      <MemoryRouter>
        <DeviceProbeSnmpEngineId modelId={DEVICE_ID} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
    expect(ModelAPI.getItem).not.toHaveBeenCalled();
  });

  test("in German, the hint is German, and the engine ID reads as it is", async () => {
    await renderProbeEngineId("de");
    const block: HTMLElement = await screen.findByTestId(
      "device-probe-snmp-engine-id",
    );

    expect(block).toHaveTextContent(DE[SNMP_TRAPS_ENGINE_ID_HINT] as string);
    expect(
      within(block).getByTestId("device-probe-snmp-engine-id-value"),
    ).toHaveTextContent(ENGINE_ID);
    expect(
      within(block).getByTestId("device-probe-snmp-engine-id-value"),
    ).toHaveAttribute("dir", "ltr");
  });
});

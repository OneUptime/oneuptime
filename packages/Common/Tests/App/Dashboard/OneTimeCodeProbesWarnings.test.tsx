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
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import OneTimeCodeProbesWarning from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/OneTimeCodeProbesWarning";
import {
  ONE_TIME_CODE_PROBES_COPY,
  ONE_TIME_CODE_PROBES_WARNING_TEST_ID,
  UPDATE_A_PROBE_DOCS_PATH,
  getProbesTooOldForOneTimeCodes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/OneTimeCodeProbes";
import ProbeVersionElement, {
  PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID,
  PROBE_VERSION_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/ProbeVersion";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorSecret from "../../../Models/DatabaseModels/MonitorSecret";
import Probe from "../../../Models/DatabaseModels/Probe";
import URL from "../../../Types/API/URL";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { FIRST_PROBE_VERSION_WITH_TOTP_CODES } from "../../../Types/Probe/ProbeCapability";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A CUSTOM PROBE TOO OLD TO MAKE ONE-TIME CODES, SAID WHERE IT MATTERS
 * (OneUptime issue #9759).
 *
 * A custom probe older than 17.0.1 cannot make the code of a one-time code
 * (TOTP) secret: the check fails on it, with a sentence saying to update
 * it. Before that happens:
 *
 *   - the monitor forms - where the steps that use a code are written, and
 *     where a monitor's probes are picked or listed - name the probes that
 *     check the monitor and are too old, say how to update a custom probe
 *     and link the docs that say it; only when a step needs a code, never
 *     for a global probe, and never from a version its reader may not read;
 *   - the probe's own page shows the release it runs, and that it cannot
 *     run the monitors that use a one-time code secret.
 *
 * Drawn with the real components and every Dashboard locale; the reads are
 * stood in for.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_ID: string = "a1a1a1a1-0000-4000-8000-0000000000a1";

const OLD_PROBE_ID: string = "0d0d0d0d-0000-4000-8000-00000000000d";
const CURRENT_PROBE_ID: string = "c0c0c0c0-0000-4000-8000-00000000000c";
const NEW_PROBE_ID: string = "e0e0e0e0-0000-4000-8000-00000000000e";
const GLOBAL_PROBE_ID: string = "9a9a9a9a-0000-4000-8000-00000000009a";

const CONNECTED_AT: Date = new Date("2026-11-19T10:00:00.000Z");

const DASHBOARD: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

interface ListRead {
  modelType: { new (): unknown };
  query: Record<string, unknown>;
  select: Record<string, unknown>;
}

const listCalls: Array<ListRead> = [];
let projectProbes: Array<Probe> = [];
let totpSecrets: Array<MonitorSecret> = [];
let monitorProbes: Array<MonitorProbe> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (read: ListRead): Promise<{ data: Array<unknown> }> => {
        listCalls.push(read);

        /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        const ProbeModel: unknown =
          require("../../../Models/DatabaseModels/Probe").default;
        const SecretModel: unknown =
          require("../../../Models/DatabaseModels/MonitorSecret").default;
        /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

        if (read.modelType === ProbeModel) {
          return { data: projectProbes };
        }

        if (read.modelType === SecretModel) {
          return { data: totpSecrets };
        }

        return { data: monitorProbes };
      },
    },
  };
});

function probe(data: {
  id: string;
  name: string;
  reportedVersion?: string | null;
  lastAlive?: Date | null;
}): Probe {
  const item: Probe = new Probe(new ObjectID(data.id));
  item.name = data.name;
  item.reportedVersion = data.reportedVersion || undefined;
  item.lastAlive = data.lastAlive || undefined;
  return item;
}

function secret(name: string): MonitorSecret {
  const item: MonitorSecret = new MonitorSecret();
  item.name = name;
  return item;
}

function monitorProbe(probeId: string): MonitorProbe {
  const item: MonitorProbe = new MonitorProbe();
  item.probeId = new ObjectID(probeId);
  return item;
}

function apiSteps(header: string): MonitorSteps {
  const step: MonitorStep = new MonitorStep();
  step.data = {
    ...MonitorStep.getDefaultMonitorStep({
      monitorType: MonitorType.API,
      defaultMonitorStatusId: ObjectID.generate(),
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      monitorName: "Sign-in",
    } as never).data!,
    monitorDestination: URL.fromString("https://app.example.com/login"),
    requestHeaders: { "X-Login": header },
  };

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };
  return steps;
}

function scriptSteps(script: string): MonitorSteps {
  const steps: MonitorSteps = apiSteps("none");
  steps.data!.monitorStepsInstanceArray[0]!.data!.customCode = script;
  return steps;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
    resources[language] = { translation: readDashboardLocale(language) };
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
  listCalls.length = 0;
  projectProbes = [
    probe({
      id: OLD_PROBE_ID,
      name: "Office probe",
      lastAlive: CONNECTED_AT,
    }),
    probe({
      id: CURRENT_PROBE_ID,
      name: "Data centre probe",
      reportedVersion: FIRST_PROBE_VERSION_WITH_TOTP_CODES,
      lastAlive: CONNECTED_AT,
    }),
    probe({ id: NEW_PROBE_ID, name: "Probe never started" }),
  ];
  totpSecrets = [secret("LoginCode")];
  monitorProbes = [];

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(PermissionGate, "canReadColumn").mockReturnValue(true);
});

afterEach(async () => {
  jest.restoreAllMocks();
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

async function draw(element: ReactElement): Promise<void> {
  render(<MemoryRouter>{element}</MemoryRouter>);

  for (let tick: number = 0; tick < 5; tick++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function warning(): HTMLElement | null {
  return screen.queryByTestId(ONE_TIME_CODE_PROBES_WARNING_TEST_ID);
}

function listedProbes(): Array<string> {
  return within(
    screen.getByTestId(`${ONE_TIME_CODE_PROBES_WARNING_TEST_ID}-probes`),
  )
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

describe("the monitor forms", () => {
  test("name the picked probes too old to make the code a step sends, how to update one, and the docs", async () => {
    await draw(
      <OneTimeCodeProbesWarning
        monitorSteps={apiSteps("{{monitorSecrets.LoginCode}}")}
        monitorType={MonitorType.API}
        probeIds={[OLD_PROBE_ID, CURRENT_PROBE_ID, GLOBAL_PROBE_ID]}
      />,
    );

    expect(warning()).toBeInTheDocument();
    // Only the old custom probe: never the current one, never a global one.
    expect(listedProbes()).toEqual(["Office probe"]);
    expect(
      screen.getByText(
        "These probes are too old to make one-time codes, so this monitor's check fails on them:",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "To update a probe, start it again with the latest probe image (OneUptime 17.0.1 or later).",
      ),
    ).toBeInTheDocument();

    const docs: HTMLElement = screen.getByTestId(
      `${ONE_TIME_CODE_PROBES_WARNING_TEST_ID}-docs`,
    );

    expect(docs).toHaveTextContent("How to update a custom probe");
    expect(docs.getAttribute("href")).toContain(UPDATE_A_PROBE_DOCS_PATH);
  });

  test("say nothing when the step sends a Text secret: no code is made", async () => {
    await draw(
      <OneTimeCodeProbesWarning
        monitorSteps={apiSteps("{{monitorSecrets.ApiKey}}")}
        monitorType={MonitorType.API}
        probeIds={[OLD_PROBE_ID]}
      />,
    );

    expect(warning()).not.toBeInTheDocument();
  });

  test("say nothing when every probe that checks the monitor makes codes", async () => {
    await draw(
      <OneTimeCodeProbesWarning
        monitorSteps={apiSteps("{{monitorSecrets.LoginCode}}")}
        monitorType={MonitorType.API}
        probeIds={[CURRENT_PROBE_ID, GLOBAL_PROBE_ID]}
      />,
    );

    expect(warning()).not.toBeInTheDocument();
  });

  test("never flag a probe that has not connected yet: nothing says what it runs", async () => {
    await draw(
      <OneTimeCodeProbesWarning
        monitorSteps={apiSteps("{{monitorSecrets.LoginCode}}")}
        monitorType={MonitorType.API}
        probeIds={[NEW_PROBE_ID]}
      />,
    );

    expect(warning()).not.toBeInTheDocument();
  });

  test("warn of a script that asks for a code, even for a reader who may not list the secrets", async () => {
    jest
      .spyOn(PermissionGate, "canReadColumn")
      .mockImplementation((model: unknown): boolean => {
        return !(model instanceof MonitorSecret);
      });

    await draw(
      <OneTimeCodeProbesWarning
        monitorSteps={scriptSteps(
          'await page.fill("#otp", await oneuptime.getTotpCode("LoginCode"));',
        )}
        monitorType={MonitorType.SyntheticMonitor}
        probeIds={[OLD_PROBE_ID]}
      />,
    );

    expect(listedProbes()).toEqual(["Office probe"]);
    // The secrets were not asked for.
    expect(
      listCalls.some((call: ListRead): boolean => {
        return call.modelType === MonitorSecret;
      }),
    ).toBe(false);
  });

  test("tell a reader who may not read probes' releases nothing, rather than something wrong", async () => {
    jest
      .spyOn(PermissionGate, "canReadColumn")
      .mockImplementation((model: unknown, column: string): boolean => {
        return !(model instanceof Probe && column === "reportedVersion");
      });

    await draw(
      <OneTimeCodeProbesWarning
        monitorSteps={apiSteps("{{monitorSecrets.LoginCode}}")}
        monitorType={MonitorType.API}
        probeIds={[OLD_PROBE_ID]}
      />,
    );

    expect(warning()).not.toBeInTheDocument();
    expect(listCalls).toHaveLength(0);
  });

  test("read nothing for a monitor whose steps reference no secret where a code goes", async () => {
    await draw(
      <OneTimeCodeProbesWarning
        monitorSteps={apiSteps("Bearer abc")}
        monitorType={MonitorType.API}
        probeIds={[OLD_PROBE_ID]}
      />,
    );

    expect(warning()).not.toBeInTheDocument();
    expect(listCalls).toHaveLength(0);
  });

  test("on a monitor that exists, read the probes switched on to check it", async () => {
    monitorProbes = [
      monitorProbe(OLD_PROBE_ID),
      monitorProbe(CURRENT_PROBE_ID),
    ];

    await draw(
      <OneTimeCodeProbesWarning
        monitorSteps={apiSteps("{{monitorSecrets.LoginCode}}")}
        monitorType={MonitorType.API}
        monitorId={new ObjectID(MONITOR_ID)}
        refreshToggle="1"
      />,
    );

    expect(listedProbes()).toEqual(["Office probe"]);

    const read: ListRead | undefined = listCalls.find(
      (call: ListRead): boolean => {
        return call.modelType === MonitorProbe;
      },
    );

    expect(read?.query["isEnabled"]).toBe(true);
    expect(String(read?.query["monitorId"])).toBe(MONITOR_ID);
  });

  test("say it in the reader's language", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    await draw(
      <OneTimeCodeProbesWarning
        monitorSteps={apiSteps("{{monitorSecrets.LoginCode}}")}
        monitorType={MonitorType.API}
        probeIds={[OLD_PROBE_ID]}
      />,
    );

    const text: string = withoutIsolateMarks(warning()?.textContent || "");

    expect(text).not.toContain("These probes are too old");
    expect(text).toContain("Office probe");
    expect(text).toContain("17.0.1");
  });
});

describe("getProbesTooOldForOneTimeCodes", () => {
  test("keeps the order the ids give, each probe once, and only the project's own", () => {
    expect(
      getProbesTooOldForOneTimeCodes({
        projectProbes: [
          probe({ id: OLD_PROBE_ID, name: "B", lastAlive: CONNECTED_AT }),
          probe({
            id: CURRENT_PROBE_ID,
            name: "A",
            reportedVersion: "16.0.0",
            lastAlive: CONNECTED_AT,
          }),
        ],
        probeIds: [
          CURRENT_PROBE_ID,
          GLOBAL_PROBE_ID,
          OLD_PROBE_ID,
          OLD_PROBE_ID,
        ],
      }),
    ).toEqual([
      { id: CURRENT_PROBE_ID, name: "A" },
      { id: OLD_PROBE_ID, name: "B" },
    ]);
  });
});

describe("the probe's page", () => {
  test("shows the release a probe says it runs, and nothing more for one that makes codes", async () => {
    await draw(
      <ProbeVersionElement
        probe={probe({
          id: CURRENT_PROBE_ID,
          name: "Data centre probe",
          reportedVersion: "17.0.1",
          lastAlive: CONNECTED_AT,
        })}
      />,
    );

    expect(screen.getByTestId(PROBE_VERSION_TEST_ID)).toHaveTextContent(
      "17.0.1",
    );
    expect(
      screen.queryByTestId(PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("says a probe that says no release is older than 17.0.1, and cannot run monitors that use a one-time code", async () => {
    await draw(
      <ProbeVersionElement
        probe={probe({
          id: OLD_PROBE_ID,
          name: "Office probe",
          lastAlive: CONNECTED_AT,
        })}
      />,
    );

    expect(screen.getByTestId(PROBE_VERSION_TEST_ID)).toHaveTextContent(
      "Older than 17.0.1",
    );

    const tooOld: HTMLElement = screen.getByTestId(
      PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID,
    );

    expect(tooOld).toHaveTextContent(
      "Too old to make one-time codes. Monitors that use a one-time code secret fail their check on this probe until it is updated.",
    );
    expect(
      screen
        .getByTestId(`${PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID}-docs`)
        .getAttribute("href"),
    ).toContain(UPDATE_A_PROBE_DOCS_PATH);
  });

  test("flags a probe that says an older release, by that release", async () => {
    await draw(
      <ProbeVersionElement
        probe={probe({
          id: OLD_PROBE_ID,
          name: "Office probe",
          reportedVersion: "16.0.0",
          lastAlive: CONNECTED_AT,
        })}
      />,
    );

    expect(screen.getByTestId(PROBE_VERSION_TEST_ID)).toHaveTextContent(
      "16.0.0",
    );
    expect(
      screen.getByTestId(PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID),
    ).toBeInTheDocument();
  });

  test("shows the quiet dash for a probe that never connected, and a build's own words as written, flagging neither", async () => {
    await draw(
      <ProbeVersionElement
        probe={probe({ id: NEW_PROBE_ID, name: "Probe never started" })}
      />,
    );

    expect(
      screen.queryByTestId(PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(PROBE_VERSION_TEST_ID)).not.toHaveTextContent(
      "Older than",
    );

    cleanup();

    await draw(
      <ProbeVersionElement
        probe={probe({
          id: NEW_PROBE_ID,
          name: "Built here",
          reportedVersion: "unknown",
          lastAlive: CONNECTED_AT,
        })}
      />,
    );

    expect(screen.getByTestId(PROBE_VERSION_TEST_ID)).toHaveTextContent(
      "unknown",
    );
    expect(
      screen.queryByTestId(PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("never flags a global probe", async () => {
    const global: Probe = probe({
      id: GLOBAL_PROBE_ID,
      name: "Global probe",
      lastAlive: CONNECTED_AT,
    });
    global.isGlobalProbe = true;

    await draw(<ProbeVersionElement probe={global} />);

    expect(
      screen.queryByTestId(PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("says it in the reader's language", async () => {
    await act(async () => {
      await i18next.changeLanguage("fa");
    });

    await draw(
      <ProbeVersionElement
        probe={probe({
          id: OLD_PROBE_ID,
          name: "Office probe",
          lastAlive: CONNECTED_AT,
        })}
      />,
    );

    const text: string = withoutIsolateMarks(
      screen.getByTestId(PROBE_VERSION_TEST_ID).textContent || "",
    );

    expect(text).not.toContain("Older than");
    expect(text).not.toContain("Too old to make one-time codes");
  });
});

describe("where they are drawn", () => {
  function source(relativePath: string): string {
    return fs.readFileSync(path.join(DASHBOARD, relativePath), "utf8");
  }

  test("the probe's page shows its Version in Probe Status, drawn by ProbeVersionElement", () => {
    const page: string = source("Pages/Monitor/Settings/MonitorProbeView.tsx");
    const versionField: number = page.indexOf("reportedVersion: true");

    expect(versionField).toBeGreaterThan(page.indexOf('title: "Probe Status"'));
    expect(page.slice(versionField, versionField + 400)).toContain(
      "<ProbeVersionElement probe={item} />",
    );
  });

  test("the steps form warns, of the probes that would check the monitor", () => {
    expect(source("Components/Form/Monitor/MonitorSteps.tsx")).toContain(
      "probeIds={props.testProbeIds || []}",
    );
  });

  test("Create Monitor warns under the Probes picker, of the probes picked", () => {
    const page: string = source("Pages/Monitor/Create.tsx");
    const footer: number = page.indexOf("<OneTimeCodeProbesWarning");

    expect(footer).toBeGreaterThan(page.indexOf('title: "Probes"'));
    expect(page.slice(footer, footer + 400)).toContain(
      'probeIds={toProbeIds((values as JSONObject)["probes"])}',
    );
  });

  test("a monitor's Probes & Interval page warns above its probes, read again with the list", () => {
    const page: string = source("Pages/Monitor/View/Probes.tsx");

    expect(page).toContain("topContent={");
    expect(page).toContain("monitorId={modelId}");
    expect(page).toContain("refreshToggle={String(probesReadCount)}");
  });

  test("the words are the copy's, in every Dashboard language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of Object.values(ONE_TIME_CODE_PROBES_COPY)) {
        expect({ language, key, worded: Boolean(words[key]) }).toEqual({
          language,
          key,
          worded: true,
        });
      }
    }
  });
});

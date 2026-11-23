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
import ProbesTooOldWarning from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/ProbesTooOldWarning";
import {
  PROBES_TOO_OLD_COPY,
  PROBES_TOO_OLD_FOR_FEATURE_COPY,
  PROBES_TOO_OLD_WARNING_TEST_ID,
  UPDATE_A_PROBE_DOCS_PATH,
  doStepsNeedProbeThatSendsAnyBody,
  getFeaturesStepsMayNeed,
  getNeededFeatures,
  getProbesTooOldFor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/ProbesTooOld";
import ProbeVersionElement, {
  PROBE_TOO_OLD_FOR_ANY_REQUEST_BODY_TEST_ID,
  PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID,
  PROBE_UPDATE_DOCS_TEST_ID,
  PROBE_VERSION_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/ProbeVersion";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorSecret from "../../../Models/DatabaseModels/MonitorSecret";
import Probe from "../../../Models/DatabaseModels/Probe";
import URL from "../../../Types/API/URL";
import MonitorRequestBodyFormat from "../../../Types/Monitor/MonitorRequestBodyFormat";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY,
  FIRST_PROBE_VERSION_WITH_TOTP_CODES,
} from "../../../Types/Probe/ProbeCapability";
import { ProbeFeature } from "../../../Types/Probe/ProbeReportedVersion";
import MonitorRequestBody from "../../../Utils/Monitor/MonitorRequestBody";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * A CUSTOM PROBE TOO OLD FOR WHAT A MONITOR'S STEPS NEED, SAID WHERE IT
 * MATTERS (OneUptime issues #9759, #10788).
 *
 * A custom probe too old to make the code of a one-time code (TOTP)
 * secret, or to send an API step's request body that is a JSON array, a
 * single value or text, fails such a check, with a sentence saying to
 * update it. Before that happens:
 *
 *   - the monitor forms - where the steps are written, and where a
 *     monitor's probes are picked or listed - name, for each thing the
 *     steps need, the probes that check the monitor and are too old for
 *     it, say how to update a custom probe and link the docs that say it;
 *     only when a step needs it, never for a global probe, and never from a
 *     version its reader may not read;
 *   - the probe's own page shows the release it runs, and what it cannot
 *     run until it is updated.
 *
 * One warning for every such need (ProbesTooOldWarning), not a copy for
 * each. Drawn with the real components and every Dashboard locale; the
 * reads are stood in for.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_ID: string = "a1a1a1a1-0000-4000-8000-0000000000a1";

// Says no release: older than the first that says one, so too old for both.
const OLD_PROBE_ID: string = "0d0d0d0d-0000-4000-8000-00000000000d";
// The first release with one-time codes, which sends no array body yet.
const CODES_PROBE_ID: string = "c0c0c0c0-0000-4000-8000-00000000000c";
// The first release that sends any body: current for both.
const CURRENT_PROBE_ID: string = "b0b0b0b0-0000-4000-8000-00000000000b";
const NEW_PROBE_ID: string = "e0e0e0e0-0000-4000-8000-00000000000e";
const GLOBAL_PROBE_ID: string = "9a9a9a9a-0000-4000-8000-00000000009a";

const CONNECTED_AT: Date = new Date("2026-11-19T10:00:00.000Z");

const DASHBOARD: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const CODES_HEADING: string =
  "These probes are too old to make one-time codes, so this monitor's check fails on them:";
const BODY_HEADING: string =
  "These probes are too old to send a request body that is a JSON array, a single value or text, so this monitor's check fails on them:";
const HOW_TO_UPDATE: string =
  "To update a probe, start it again with the latest probe image.";

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

  // A probe that never said, or was never seen, has no value at all.
  if (data.reportedVersion) {
    item.reportedVersion = data.reportedVersion;
  }

  if (data.lastAlive) {
    item.lastAlive = data.lastAlive;
  }

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

// An API monitor's steps, as the form holds them: secrets not filled in.
function apiSteps(data: {
  header?: string | undefined;
  body?: string | undefined;
  bodyFormat?: MonitorRequestBodyFormat | undefined;
  steps?: number | undefined;
}): MonitorSteps {
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [],
    defaultMonitorStatusId: undefined,
  };

  for (let index: number = 0; index < (data.steps || 1); index++) {
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
      requestHeaders: { "X-Login": data.header || "none" },
    };

    // The body on the last step only, so a later step is read too.
    if (index === (data.steps || 1) - 1) {
      step.data.requestBody = data.body;
      step.data.requestBodyFormat = data.bodyFormat;
    }

    steps.data.monitorStepsInstanceArray.push(step);
  }

  return steps;
}

function scriptSteps(script: string): MonitorSteps {
  const steps: MonitorSteps = apiSteps({});
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
      id: CODES_PROBE_ID,
      name: "Data centre probe",
      reportedVersion: FIRST_PROBE_VERSION_WITH_TOTP_CODES,
      lastAlive: CONNECTED_AT,
    }),
    probe({
      id: CURRENT_PROBE_ID,
      name: "Edge probe",
      reportedVersion: FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY,
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
  return screen.queryByTestId(PROBES_TOO_OLD_WARNING_TEST_ID);
}

function listedProbes(feature: ProbeFeature): Array<string> {
  return within(
    screen.getByTestId(`${PROBES_TOO_OLD_WARNING_TEST_ID}-${feature}-probes`),
  )
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

function hasList(feature: ProbeFeature): boolean {
  return Boolean(
    screen.queryByTestId(`${PROBES_TOO_OLD_WARNING_TEST_ID}-${feature}`),
  );
}

describe("the monitor forms: one-time codes (#9759)", () => {
  test("name the picked probes too old to make the code a step sends, how to update one, and the docs", async () => {
    await draw(
      <ProbesTooOldWarning
        monitorSteps={apiSteps({ header: "{{monitorSecrets.LoginCode}}" })}
        monitorType={MonitorType.API}
        probeIds={[OLD_PROBE_ID, CODES_PROBE_ID, GLOBAL_PROBE_ID]}
      />,
    );

    expect(warning()).toBeInTheDocument();
    // Only the old custom probe: never the current one, never a global one.
    expect(listedProbes(ProbeFeature.OneTimeCodes)).toEqual(["Office probe"]);
    expect(hasList(ProbeFeature.AnyRequestBody)).toBe(false);
    expect(screen.getByText(CODES_HEADING)).toBeInTheDocument();
    // No release is named: the latest image makes the codes.
    expect(screen.getByText(HOW_TO_UPDATE)).toBeInTheDocument();
    expect(warning()?.textContent).not.toMatch(/\d+\.\d+\.\d+/);

    const docs: HTMLElement = screen.getByTestId(
      `${PROBES_TOO_OLD_WARNING_TEST_ID}-docs`,
    );

    expect(docs).toHaveTextContent("How to update a custom probe");
    expect(docs.getAttribute("href")).toContain(UPDATE_A_PROBE_DOCS_PATH);
  });

  test("say nothing when the step sends a Text secret: no code is made", async () => {
    await draw(
      <ProbesTooOldWarning
        monitorSteps={apiSteps({ header: "{{monitorSecrets.ApiKey}}" })}
        monitorType={MonitorType.API}
        probeIds={[OLD_PROBE_ID]}
      />,
    );

    expect(warning()).not.toBeInTheDocument();
  });

  test("say nothing when every probe that checks the monitor makes codes", async () => {
    await draw(
      <ProbesTooOldWarning
        monitorSteps={apiSteps({ header: "{{monitorSecrets.LoginCode}}" })}
        monitorType={MonitorType.API}
        probeIds={[CODES_PROBE_ID, CURRENT_PROBE_ID, GLOBAL_PROBE_ID]}
      />,
    );

    expect(warning()).not.toBeInTheDocument();
  });

  test("never flag a probe that has not connected yet: nothing says what it runs", async () => {
    await draw(
      <ProbesTooOldWarning
        monitorSteps={apiSteps({ header: "{{monitorSecrets.LoginCode}}" })}
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
      <ProbesTooOldWarning
        monitorSteps={scriptSteps(
          'await page.fill("#otp", await oneuptime.getTotpCode("LoginCode"));',
        )}
        monitorType={MonitorType.SyntheticMonitor}
        probeIds={[OLD_PROBE_ID]}
      />,
    );

    expect(listedProbes(ProbeFeature.OneTimeCodes)).toEqual(["Office probe"]);
    // The secrets were not asked for.
    expect(
      listCalls.some((call: ListRead): boolean => {
        return call.modelType === MonitorSecret;
      }),
    ).toBe(false);
  });
});

describe("the monitor forms: a request body only a newer probe sends (#10788)", () => {
  test.each([
    ["a JSON array", '[{"id": 1}, {"id": 2}]', undefined],
    ["a single value", '"ping"', undefined],
    ["a number", "42", undefined],
    ["an array of a secret's values", "[{{monitorSecrets.Ids}}]", undefined],
    ["a secret alone, as written", "{{monitorSecrets.Payload}}", undefined],
    ["XML sent as text", "<ping>1</ping>", MonitorRequestBodyFormat.Text],
    ["form fields sent as text", "a=1&b=2", MonitorRequestBodyFormat.Text],
    [
      "an object sent as text",
      '{"ping": true}',
      MonitorRequestBodyFormat.Text,
    ],
  ])(
    "name the probes too old to send %s, and how to update one",
    async (
      _what: string,
      body: string,
      bodyFormat: MonitorRequestBodyFormat | undefined,
    ) => {
      await draw(
        <ProbesTooOldWarning
          monitorSteps={apiSteps({ body, bodyFormat })}
          monitorType={MonitorType.API}
          probeIds={[
            OLD_PROBE_ID,
            CODES_PROBE_ID,
            CURRENT_PROBE_ID,
            NEW_PROBE_ID,
            GLOBAL_PROBE_ID,
          ]}
        />,
      );

      /*
       * The probe that says no release, and the first release of one-time
       * codes, which sends no such body: never the current one, one that
       * never connected, or a global one.
       */
      expect(listedProbes(ProbeFeature.AnyRequestBody)).toEqual([
        "Office probe",
        "Data centre probe",
      ]);
      expect(hasList(ProbeFeature.OneTimeCodes)).toBe(false);
      expect(screen.getByText(BODY_HEADING)).toBeInTheDocument();
      expect(screen.getByText(HOW_TO_UPDATE)).toBeInTheDocument();
      expect(warning()?.textContent).not.toMatch(/\d+\.\d+\.\d+/);
      /*
       * The body alone tells: the secrets are read only for a reference in
       * it, which may name a one-time code secret.
       */
      expect(
        listCalls.some((call: ListRead): boolean => {
          return call.modelType === MonitorSecret;
        }),
      ).toBe(body.includes("{{monitorSecrets."));
    },
  );

  test("an object holding a Text secret needs no newer probe: nothing is said", async () => {
    await draw(
      <ProbesTooOldWarning
        monitorSteps={apiSteps({
          body: '{"key": "{{monitorSecrets.ApiKey}}"}',
        })}
        monitorType={MonitorType.API}
        probeIds={[OLD_PROBE_ID]}
      />,
    );

    // ApiKey may have been a one-time code secret: the secrets said it is not.
    expect(warning()).not.toBeInTheDocument();
    expect(
      listCalls.some((call: ListRead): boolean => {
        return call.modelType === MonitorSecret;
      }),
    ).toBe(true);
  });

  test.each([
    ["no body", undefined],
    ["an empty body", "   "],
    ["a JSON object", '{"ping": true}'],
    ["a body that is no JSON, which no probe sends", "<ping/>"],
  ])(
    "say nothing, and read nothing, for %s",
    async (_what: string, body: string | undefined) => {
      await draw(
        <ProbesTooOldWarning
          monitorSteps={apiSteps({ body })}
          monitorType={MonitorType.API}
          probeIds={[OLD_PROBE_ID]}
        />,
      );

      expect(warning()).not.toBeInTheDocument();
      expect(listCalls).toHaveLength(0);
    },
  );

  test("say nothing for another monitor type: only an API step sends a body", async () => {
    await draw(
      <ProbesTooOldWarning
        monitorSteps={apiSteps({ body: "[1, 2]" })}
        monitorType={MonitorType.Website}
        probeIds={[OLD_PROBE_ID]}
      />,
    );

    expect(warning()).not.toBeInTheDocument();
    expect(listCalls).toHaveLength(0);
  });

  test("read a step after the first, as the server reads every step", async () => {
    await draw(
      <ProbesTooOldWarning
        monitorSteps={apiSteps({ body: "[1, 2]", steps: 3 })}
        monitorType={MonitorType.API}
        probeIds={[CODES_PROBE_ID]}
      />,
    );

    expect(listedProbes(ProbeFeature.AnyRequestBody)).toEqual([
      "Data centre probe",
    ]);
  });

  test("say nothing when every probe that checks the monitor sends any body", async () => {
    await draw(
      <ProbesTooOldWarning
        monitorSteps={apiSteps({ body: "[1, 2]" })}
        monitorType={MonitorType.API}
        probeIds={[CURRENT_PROBE_ID, GLOBAL_PROBE_ID, NEW_PROBE_ID]}
      />,
    );

    expect(warning()).not.toBeInTheDocument();
  });
});

describe("the monitor forms: a monitor that needs both", () => {
  test("one list for each need, each of its own probes, and one way to update them", async () => {
    await draw(
      <ProbesTooOldWarning
        monitorSteps={apiSteps({
          header: "{{monitorSecrets.LoginCode}}",
          body: '["{{monitorSecrets.LoginCode}}"]',
        })}
        monitorType={MonitorType.API}
        probeIds={[OLD_PROBE_ID, CODES_PROBE_ID, CURRENT_PROBE_ID]}
      />,
    );

    expect(listedProbes(ProbeFeature.OneTimeCodes)).toEqual(["Office probe"]);
    expect(listedProbes(ProbeFeature.AnyRequestBody)).toEqual([
      "Office probe",
      "Data centre probe",
    ]);
    // In ProbeFeature's order: the codes first.
    const text: string = warning()?.textContent || "";

    expect(text.indexOf(CODES_HEADING)).toBeLessThan(
      text.indexOf(BODY_HEADING),
    );
    expect(screen.getAllByText(HOW_TO_UPDATE)).toHaveLength(1);
    expect(
      screen.getAllByTestId(`${PROBES_TOO_OLD_WARNING_TEST_ID}-docs`),
    ).toHaveLength(1);
  });
});

describe("the monitor forms: who reads what", () => {
  test("tell a reader who may not read probes' releases nothing, rather than something wrong", async () => {
    jest
      .spyOn(PermissionGate, "canReadColumn")
      .mockImplementation((model: unknown, column: string): boolean => {
        return !(model instanceof Probe && column === "reportedVersion");
      });

    await draw(
      <ProbesTooOldWarning
        monitorSteps={apiSteps({
          header: "{{monitorSecrets.LoginCode}}",
          body: "[1]",
        })}
        monitorType={MonitorType.API}
        probeIds={[OLD_PROBE_ID]}
      />,
    );

    expect(warning()).not.toBeInTheDocument();
    expect(listCalls).toHaveLength(0);
  });

  test("read nothing for a monitor whose steps need no newer probe", async () => {
    await draw(
      <ProbesTooOldWarning
        monitorSteps={apiSteps({ header: "Bearer abc", body: '{"a": 1}' })}
        monitorType={MonitorType.API}
        probeIds={[OLD_PROBE_ID]}
      />,
    );

    expect(warning()).not.toBeInTheDocument();
    expect(listCalls).toHaveLength(0);
  });

  test("on a monitor that exists, read the probes switched on to check it", async () => {
    monitorProbes = [monitorProbe(OLD_PROBE_ID), monitorProbe(CURRENT_PROBE_ID)];

    await draw(
      <ProbesTooOldWarning
        monitorSteps={apiSteps({ body: "[1, 2]" })}
        monitorType={MonitorType.API}
        monitorId={new ObjectID(MONITOR_ID)}
        refreshToggle="1"
      />,
    );

    expect(listedProbes(ProbeFeature.AnyRequestBody)).toEqual([
      "Office probe",
    ]);

    const read: ListRead | undefined = listCalls.find(
      (call: ListRead): boolean => {
        return call.modelType === MonitorProbe;
      },
    );

    expect(read?.query["isEnabled"]).toBe(true);
    expect(String(read?.query["monitorId"])).toBe(MONITOR_ID);
  });

  test.each(["de", "fa", "ja"])(
    "say it in the reader's language: %s",
    async (language: string) => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      await draw(
        <ProbesTooOldWarning
          monitorSteps={apiSteps({
            header: "{{monitorSecrets.LoginCode}}",
            body: "[1]",
          })}
          monitorType={MonitorType.API}
          probeIds={[OLD_PROBE_ID]}
        />,
      );

      const text: string = withoutIsolateMarks(warning()?.textContent || "");

      expect(text).not.toContain("These probes are too old");
      expect(text).not.toContain("To update a probe");
      expect(text).toContain("Office probe");
    },
  );
});

describe("what the steps need, read from the steps alone", () => {
  test("a reference where a code goes may need one: only the secrets tell", () => {
    const steps: MonitorSteps = apiSteps({
      header: "{{monitorSecrets.Unknown}}",
    });

    expect(
      getFeaturesStepsMayNeed({
        monitorSteps: steps,
        monitorType: MonitorType.API,
      }),
    ).toEqual([ProbeFeature.OneTimeCodes]);
    expect(
      getNeededFeatures({
        monitorSteps: steps,
        monitorType: MonitorType.API,
        totpSecretNames: ["LoginCode"],
      }),
    ).toEqual([]);
    expect(
      getNeededFeatures({
        monitorSteps: steps,
        monitorType: MonitorType.API,
        totpSecretNames: null,
      }),
    ).toEqual([]);
  });

  test("a body only a newer probe sends needs one, told from the body alone", () => {
    expect(
      getNeededFeatures({
        monitorSteps: apiSteps({
          header: "{{monitorSecrets.LoginCode}}",
          body: "[]",
        }),
        monitorType: MonitorType.API,
        totpSecretNames: ["LoginCode"],
      }),
    ).toEqual([ProbeFeature.OneTimeCodes, ProbeFeature.AnyRequestBody]);
  });

  test("agrees with the server's gate, which reads the body once its secrets are in, on 300 seeded-random bodies", () => {
    const random: SeededRandom = seededRandom(10788);
    const pieces: Array<string> = [
      "1",
      "true",
      "null",
      '"text"',
      "[1, 2]",
      '{"a": 1}',
      "{{monitorSecrets.Value}}",
      '"{{monitorSecrets.Value}}"',
      "<xml/>",
      "a=1&b=2",
      "",
      "  ",
    ];
    // A secret that stands where a value goes holds a value of that shape.
    const values: Array<string> = ["42", "true", "null", "7.5", "0"];

    for (let round: number = 0; round < 300; round++) {
      let body: string = pieces[random(pieces.length)] as string;

      if (random(2) === 0) {
        body = `[${body}, ${pieces[random(pieces.length)]}]`;
      } else if (random(3) === 0) {
        body = `{"a": ${body || "0"}}`;
      }

      const bodyFormat: MonitorRequestBodyFormat | undefined = [
        undefined,
        MonitorRequestBodyFormat.JSON,
        MonitorRequestBodyFormat.Text,
      ][random(3)];

      // As the form holds it.
      const needs: boolean = doStepsNeedProbeThatSendsAnyBody({
        monitorSteps: apiSteps({ body, bodyFormat }),
        monitorType: MonitorType.API,
      });

      // As the server hands it over: its secrets filled in.
      const filled: string = MonitorRequestBody.fillSecrets(
        body,
        new Map([["Value", values[random(values.length)] as string]]),
      );

      expect({ round, body, bodyFormat, needs }).toEqual({
        round,
        body,
        bodyFormat,
        needs: MonitorRequestBody.needsProbeThatSendsAnyBody(
          filled,
          bodyFormat,
        ),
      });
    }
  });
});

describe("getProbesTooOldFor", () => {
  test("keeps the order the ids give, each probe once, and only the project's own", () => {
    expect(
      getProbesTooOldFor({
        projectProbes: [
          probe({ id: OLD_PROBE_ID, name: "B", lastAlive: CONNECTED_AT }),
          probe({
            id: CODES_PROBE_ID,
            name: "A",
            reportedVersion: "16.0.0",
            lastAlive: CONNECTED_AT,
          }),
        ],
        probeIds: [
          CODES_PROBE_ID,
          GLOBAL_PROBE_ID,
          OLD_PROBE_ID,
          OLD_PROBE_ID,
        ],
        feature: ProbeFeature.OneTimeCodes,
      }),
    ).toEqual([
      { id: CODES_PROBE_ID, name: "A" },
      { id: OLD_PROBE_ID, name: "B" },
    ]);
  });

  test.each([
    ["16.0.0", true, true],
    ["17.0.0", true, true],
    [FIRST_PROBE_VERSION_WITH_TOTP_CODES, false, true],
    // 17.2.0 does not send such a body: it was cut before the probe could.
    ["17.2.0", false, true],
    [FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY, false, false],
    ["17.3.0", false, false],
    ["18.0.0", false, false],
    // A test build cannot be told: never flagged.
    ["17.2.0-test", false, false],
    ["unknown", false, false],
  ])(
    "a probe that says %s: too old for codes %s, for any body %s",
    (reportedVersion: string, forCodes: boolean, forBody: boolean) => {
      const probes: Array<Probe> = [
        probe({
          id: CODES_PROBE_ID,
          name: "Probe",
          reportedVersion: reportedVersion,
          lastAlive: CONNECTED_AT,
        }),
      ];

      const tooOld: (feature: ProbeFeature) => boolean = (
        feature: ProbeFeature,
      ): boolean => {
        return (
          getProbesTooOldFor({
            projectProbes: probes,
            probeIds: [CODES_PROBE_ID],
            feature: feature,
          }).length > 0
        );
      };

      expect(tooOld(ProbeFeature.OneTimeCodes)).toBe(forCodes);
      expect(tooOld(ProbeFeature.AnyRequestBody)).toBe(forBody);
    },
  );
});

describe("the probe's page", () => {
  test("shows the release a probe says it runs, and nothing more for one that has every feature", async () => {
    await draw(
      <ProbeVersionElement
        probe={probe({
          id: CURRENT_PROBE_ID,
          name: "Edge probe",
          reportedVersion: FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY,
          lastAlive: CONNECTED_AT,
        })}
      />,
    );

    expect(screen.getByTestId(PROBE_VERSION_TEST_ID)).toHaveTextContent(
      FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY,
    );
    expect(
      screen.queryByTestId(PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(PROBE_TOO_OLD_FOR_ANY_REQUEST_BODY_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("says a 17.2.0 probe cannot send an array body, and makes one-time codes", async () => {
    await draw(
      <ProbeVersionElement
        probe={probe({
          id: CODES_PROBE_ID,
          name: "Data centre probe",
          reportedVersion: "17.2.0",
          lastAlive: CONNECTED_AT,
        })}
      />,
    );

    expect(
      screen.getByTestId(PROBE_TOO_OLD_FOR_ANY_REQUEST_BODY_TEST_ID),
    ).toHaveTextContent(
      "Too old to send a request body that is a JSON array, a single value or text. API monitors with such a body fail their check on this probe until it is updated.",
    );
    expect(
      screen.queryByTestId(PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("says a probe that says no release is older than 17.1.0, and cannot run monitors that use a one-time code", async () => {
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
      "Older than 17.1.0",
    );

    const tooOld: HTMLElement = screen.getByTestId(
      PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID,
    );

    expect(tooOld).toHaveTextContent(
      "Too old to make one-time codes. Monitors that use a one-time code secret fail their check on this probe until it is updated.",
    );
    expect(
      screen.getByTestId(PROBE_TOO_OLD_FOR_ANY_REQUEST_BODY_TEST_ID),
    ).toBeInTheDocument();
    // One link for every reason to update: ProbeOlderThanOneUptime.test.tsx.
    expect(
      screen.getByTestId(PROBE_UPDATE_DOCS_TEST_ID).getAttribute("href"),
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
    expect(
      screen.queryByTestId(PROBE_TOO_OLD_FOR_ANY_REQUEST_BODY_TEST_ID),
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
    expect(text).not.toContain("Too old to send a request body");
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
    const form: string = source("Components/Form/Monitor/MonitorSteps.tsx");

    expect(form).toContain("<ProbesTooOldWarning");
    expect(form).toContain("probeIds={props.testProbeIds || []}");
  });

  test("Create Monitor warns under the Probes picker, of the probes picked", () => {
    const page: string = source("Pages/Monitor/Create.tsx");
    const footer: number = page.indexOf("<ProbesTooOldWarning");

    expect(footer).toBeGreaterThan(page.indexOf('title: "Probes"'));
    expect(page.slice(footer, footer + 400)).toContain(
      'probeIds={toProbeIds((values as JSONObject)["probes"])}',
    );
  });

  test("a monitor's Probes & Interval page warns above its probes, read again with the list", () => {
    const page: string = source("Pages/Monitor/View/Probes.tsx");

    expect(page).toContain("<ProbesTooOldWarning");
    expect(page).toContain("topContent={");
    expect(page).toContain("monitorId={modelId}");
    expect(page).toContain("refreshToggle={String(probesReadCount)}");
  });

  test("one warning for every need: the one-time code warning is gone", () => {
    expect(
      fs.existsSync(
        path.join(DASHBOARD, "Components/Monitor/OneTimeCodeProbesWarning.tsx"),
      ),
    ).toBe(false);

    for (const feature of Object.values(ProbeFeature)) {
      expect(PROBES_TOO_OLD_FOR_FEATURE_COPY[feature]).toBeTruthy();
    }
  });

  test("the words are the copy's, in every Dashboard language", () => {
    const keys: Array<string> = [
      ...Object.values(PROBES_TOO_OLD_COPY),
      ...Object.values(PROBES_TOO_OLD_FOR_FEATURE_COPY),
    ];

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);
      const english: Record<string, string> = readDashboardLocale("en");

      for (const key of keys) {
        expect({
          language,
          key,
          worded: Boolean(words[key]) && words[key] !== english[key],
        }).toEqual({
          language,
          key,
          worded: true,
        });
      }
    }
  });
});

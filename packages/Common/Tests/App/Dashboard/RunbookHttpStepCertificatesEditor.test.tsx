import "@testing-library/jest-dom";
import {
  afterEach,
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
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import Steps from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps";
import { GLOBAL_RUNNERS_ROUTE } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import {
  HTTP_ALLOW_SELF_SIGNED_DESCRIPTION,
  HTTP_ALLOW_SELF_SIGNED_TITLE,
  HTTP_CA_CERTIFICATE_HELP,
  HTTP_CA_CERTIFICATE_PLACEHOLDER,
  HTTP_CA_CERTIFICATE_PROBLEMS,
  HTTP_CA_CERTIFICATE_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Steps/RunbookStepEditorModel";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import RunbookVariable from "../../../Models/DatabaseModels/RunbookVariable";
import Runner from "../../../Models/DatabaseModels/Runner";
import Route from "../../../Types/API/Route";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { CaCertificateProblem } from "../../../Types/Runbook/HttpStepCertificates";
import {
  HttpRequestStepConfig,
  RunbookStep,
} from "../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * AN HTTP REQUEST STEP'S CERTIFICATE SETTINGS, ON A RUNBOOK'S STEPS PAGE
 * (issue #10277).
 *
 * Under an HTTP request step's More fields, after its headers: the switch
 * "Allow self-signed certificates", named as a monitor's, whose line says
 * what it does and what it risks, and - while it is off - the CA
 * certificate the step trusts instead, the safer way. The folded line names
 * what is set, a save sends exactly what the page shows, and a reload shows
 * what was saved. A CA certificate that is not one says so under its box.
 * One runbook variable alone is taken as a CA certificate too (#10441): the
 * help line says how to write it, and the step's variables note names it
 * when the project has no such variable - unless the switch is on, which
 * leaves the CA certificate, and its variable, unused.
 *
 * The real page; only the model API is stubbed.
 */

const RUNBOOK_ID: string = "77777777-0000-4000-8000-0000000102f7";
const WAIT: { timeout: number } = { timeout: 20000 };

const DASHBOARD_LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const CERTIFICATE: string = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBszCCAVmgAwIBAgIUQ2VydGlmaWNhdGUgc2hhcGUgb25seQ==",
  "-----END CERTIFICATE-----",
].join("\n");

function httpStep(
  id: string,
  order: number,
  title: string,
  config: Partial<HttpRequestStepConfig>,
): RunbookStep {
  return {
    id,
    order,
    type: RunbookStepType.HttpRequest,
    title,
    config: {
      url: `https://${id}.internal.example/health`,
      method: "GET",
      ...config,
    } as HttpRequestStepConfig,
    continueOnFailure: false,
    requireApprovalBeforeRunning: false,
  };
}

function steps(): Array<RunbookStep> {
  return [
    httpStep("plain", 0, "Check the public status", {}),
    httpStep("skips", 1, "Call the lab switch", {
      allowSelfSignedCertificates: true,
    }),
    httpStep("trusts", 2, "Call the billing service", {
      caCertificate: CERTIFICATE,
    }),
  ];
}

let stored: Array<RunbookStep> = steps();
let saved: Array<RunbookStep> | null = null;
// The project's global variables, as the variables list answers them.
let globalVariables: Array<RunbookVariable> = [];

function variable(name: string): RunbookVariable {
  return Object.assign(new RunbookVariable(), {
    _id: `variable-${name}`,
    name,
    isSecret: false,
    isAvailableToGlobalRunners: false,
    runners: [],
  });
}

// The help under the CA certificate, as it reads: its slot drawn as code.
const CA_CERTIFICATE_HELP_READ: string = HTTP_CA_CERTIFICATE_HELP.replace(
  "{{reference}}",
  "{{global.variables.NAME}}",
);

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/steps`);

  stored = steps();
  saved = null;
  globalVariables = [];

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async (args: {
    modelType: unknown;
  }) => {
    if (args.modelType === Project) {
      return Object.assign(new Project(), {
        _id: PROJECT_ID,
        useGlobalRunners: true,
      });
    }

    const runbook: Runbook = new Runbook();
    runbook._id = RUNBOOK_ID;
    runbook.steps = JSON.parse(JSON.stringify(stored)) as never;
    return runbook;
  }) as never);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
    modelType: unknown;
    query?: Record<string, unknown>;
    requestOptions?: { overrideRequestUrl?: unknown };
  }): Promise<ListResult<never>> => {
    let data: Array<unknown> = [];

    if (args.modelType === Runner) {
      data = String(args.requestOptions?.overrideRequestUrl || "").endsWith(
        GLOBAL_RUNNERS_ROUTE,
      )
        ? []
        : [];
    } else if (args.modelType === RunbookVariable) {
      // The project's own, asked for with no runbook; the runbook has none.
      data = args.query?.["runbookId"] instanceof IsNull ? globalVariables : [];
    }

    return {
      data: data as Array<never>,
      count: data.length,
      skip: 0,
      limit: 10,
    };
  }) as never);

  jest.spyOn(ModelAPI, "updateById").mockImplementation((async (args: {
    data: { steps: Array<RunbookStep> };
  }) => {
    saved = JSON.parse(JSON.stringify(args.data.steps)) as Array<RunbookStep>;
    return {} as never;
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async () => {
    throw new Error("No AI providers here.");
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderSteps(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <Steps
          pageRoute={RouteMap[PageMap.RUNBOOK_VIEW_STEPS] as Route}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });

  await screen.findAllByTestId("runbook-step-header", {}, WAIT);
}

function header(title: string): HTMLElement {
  const found: HTMLElement | undefined = screen
    .getAllByTestId("runbook-step-header")
    .find((element: HTMLElement): boolean => {
      return (element.textContent || "").includes(title);
    });

  if (!found) {
    throw new Error(`No step titled "${title}".`);
  }

  return found;
}

// A step's card, opened.
function open(title: string): void {
  const toggle: HTMLElement | undefined = within(header(title))
    .getAllByRole("button")
    .find((button: HTMLElement): boolean => {
      return button.getAttribute("aria-expanded") === "false";
    });

  if (toggle) {
    fireEvent.click(toggle);
  }
}

// A step's More fields.
function fold(index: number): HTMLElement {
  return screen.getByTestId(`runbook-step-${index}-more-fields`);
}

/*
 * The line a step's More fields reads while folded: what it holds that is
 * set. Folded first, if it is open - an open fold lists nothing there.
 */
function foldedLine(index: number): string {
  const line: HTMLElement = within(fold(index)).getByTestId(
    "folded-section-header",
  );

  if (line.getAttribute("aria-expanded") === "true") {
    fireEvent.click(line);
  }

  return line.textContent || "";
}

// A step's More fields, opened.
function openMoreFields(index: number): HTMLElement {
  const found: HTMLElement = fold(index);
  const button: HTMLElement = within(found).getByRole("button", {
    name: "More fields",
  });

  if (button.getAttribute("aria-expanded") === "false") {
    fireEvent.click(button);
  }

  return found;
}

function certificateSwitch(index: number): HTMLElement {
  return within(openMoreFields(index)).getByRole("switch", {
    name: HTTP_ALLOW_SELF_SIGNED_TITLE,
  });
}

async function save(): Promise<Array<RunbookStep>> {
  fireEvent.click(screen.getByRole("button", { name: "Save Steps" }));

  await waitFor(() => {
    expect(saved).not.toBeNull();
  }, WAIT);

  return saved!;
}

function configOf(all: Array<RunbookStep>, id: string): HttpRequestStepConfig {
  return all.find((step: RunbookStep): boolean => {
    return step.id === id;
  })!.config as HttpRequestStepConfig;
}

describe("an HTTP request step's More fields", () => {
  test("hold the switch, named and worded as a monitor's, off by default, then the CA certificate", async () => {
    await renderSteps();
    open("Check the public status");

    const found: HTMLElement = openMoreFields(0);
    const toggle: HTMLElement = within(found).getByRole("switch", {
      name: HTTP_ALLOW_SELF_SIGNED_TITLE,
    });

    expect(HTTP_ALLOW_SELF_SIGNED_TITLE).toBe("Allow self-signed certificates");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription(
      HTTP_ALLOW_SELF_SIGNED_DESCRIPTION,
    );
    // What "on" does, and what it risks, in one short line.
    expect(HTTP_ALLOW_SELF_SIGNED_DESCRIPTION).toBe(
      "Skips certificate checks for this step's request, so self-signed certificates work, but anyone on the network path could read or change the request.",
    );
    expect(HTTP_ALLOW_SELF_SIGNED_DESCRIPTION.length).toBeLessThanOrEqual(150);

    const caField: HTMLElement = within(found).getByTestId(
      "runbook-step-0-http-ca-certificate-field",
    );
    const ca: HTMLElement = within(caField).getByLabelText(
      HTTP_CA_CERTIFICATE_TITLE,
    );

    expect(ca).toHaveValue("");
    expect(ca).toHaveAttribute("placeholder", HTTP_CA_CERTIFICATE_PLACEHOLDER);
    expect(ca).toHaveAccessibleDescription(CA_CERTIFICATE_HELP_READ);
    expect(HTTP_CA_CERTIFICATE_HELP.length).toBeLessThanOrEqual(150);

    // It says a variable can hold the certificate, and how one is written.
    expect(CA_CERTIFICATE_HELP_READ).toBe(
      "The step trusts only this certificate (PEM): the signing CA's, or a self-signed server's own. Or keep it in a variable and write {{global.variables.NAME}} here.",
    );
    expect(within(caField).getByText("{{global.variables.NAME}}").tagName).toBe(
      "CODE",
    );

    // After the headers, before the notes.
    const text: string = found.textContent || "";

    expect(text.indexOf("Headers (JSON)")).toBeLessThan(
      text.indexOf(HTTP_ALLOW_SELF_SIGNED_TITLE),
    );
    expect(text.indexOf(HTTP_ALLOW_SELF_SIGNED_TITLE)).toBeLessThan(
      text.indexOf(HTTP_CA_CERTIFICATE_TITLE),
    );
    expect(text.indexOf(HTTP_CA_CERTIFICATE_TITLE)).toBeLessThan(
      text.indexOf("Description"),
    );
  });

  test("the folded line says the switch is on while it is, and names a CA certificate that is set", async () => {
    await renderSteps();
    open("Check the public status");
    open("Call the lab switch");
    open("Call the billing service");

    // Nothing set: the switch is named, as what the fold holds, not "On".
    expect(foldedLine(0)).toBe(
      "More fields· Require approval, Continue on failure, Headers (JSON), Allow self-signed certificates, 3 more",
    );

    // The switch on: said so, and no CA certificate, which it turns off.
    expect(foldedLine(1)).toContain("Allow self-signed certificates: On");
    expect(foldedLine(1)).not.toContain(HTTP_CA_CERTIFICATE_TITLE);

    // A CA certificate set is always named, never its text.
    expect(foldedLine(2)).toContain(HTTP_CA_CERTIFICATE_TITLE);
    expect(foldedLine(2)).not.toContain("Allow self-signed certificates: On");
    expect(foldedLine(2)).not.toContain("BEGIN CERTIFICATE");
  });

  test("a step that skips the checks shows no CA certificate: it would not be used", async () => {
    await renderSteps();
    open("Call the lab switch");

    expect(certificateSwitch(1)).toHaveAttribute("aria-checked", "true");
    expect(
      screen.queryByTestId("runbook-step-1-http-ca-certificate-field"),
    ).toBeNull();
  });
});

describe("saving the switch", () => {
  test("turned on, it is saved on that step only, as true", async () => {
    await renderSteps();
    open("Check the public status");

    fireEvent.click(certificateSwitch(0));

    expect(certificateSwitch(0)).toHaveAttribute("aria-checked", "true");
    // The CA certificate goes: it would not be used.
    expect(
      screen.queryByTestId("runbook-step-0-http-ca-certificate-field"),
    ).toBeNull();
    expect(foldedLine(0)).toContain("Allow self-signed certificates: On");

    const all: Array<RunbookStep> = await save();

    expect(configOf(all, "plain").allowSelfSignedCertificates).toBe(true);
    expect(configOf(all, "skips").allowSelfSignedCertificates).toBe(true);
    expect(configOf(all, "trusts")).not.toHaveProperty(
      "allowSelfSignedCertificates",
    );
    expect(configOf(all, "trusts").caCertificate).toBe(CERTIFICATE);
  });

  test("turned off, its key is left out, not saved as false", async () => {
    await renderSteps();
    open("Call the lab switch");

    fireEvent.click(certificateSwitch(1));

    expect(certificateSwitch(1)).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByTestId("runbook-step-1-http-ca-certificate-field"),
    ).toBeInTheDocument();

    const all: Array<RunbookStep> = await save();

    expect(configOf(all, "skips")).not.toHaveProperty(
      "allowSelfSignedCertificates",
    );
  });

  test("turned on and off again, it leaves nothing to save", async () => {
    await renderSteps();
    open("Check the public status");

    expect(screen.getByRole("button", { name: "Save Steps" })).toBeDisabled();

    fireEvent.click(certificateSwitch(0));
    expect(screen.getByRole("button", { name: "Save Steps" })).toBeEnabled();

    fireEvent.click(certificateSwitch(0));
    expect(screen.getByRole("button", { name: "Save Steps" })).toBeDisabled();
  });

  test("saved, the page shows it again when it is opened", async () => {
    await renderSteps();
    open("Check the public status");
    fireEvent.click(certificateSwitch(0));

    stored = await save();
    cleanup();

    await renderSteps();
    open("Check the public status");

    expect(foldedLine(0)).toContain("Allow self-signed certificates: On");
    expect(certificateSwitch(0)).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Save Steps" })).toBeDisabled();
  });
});

describe("the CA certificate", () => {
  function caBox(index: number): HTMLElement {
    openMoreFields(index);

    return screen.getByTestId(`runbook-step-${index}-http-ca-certificate`);
  }

  test("pasted, is saved as pasted, and read back", async () => {
    await renderSteps();
    open("Check the public status");

    expect(foldedLine(0)).not.toContain(HTTP_CA_CERTIFICATE_TITLE);
    fireEvent.change(caBox(0), { target: { value: CERTIFICATE } });
    expect(foldedLine(0)).toContain(HTTP_CA_CERTIFICATE_TITLE);

    stored = await save();
    expect(configOf(stored, "plain").caCertificate).toBe(CERTIFICATE);

    cleanup();
    await renderSteps();
    open("Check the public status");

    expect(caBox(0)).toHaveValue(CERTIFICATE);
  });

  test("cleared, its key is left out", async () => {
    await renderSteps();
    open("Call the billing service");

    expect(caBox(2)).toHaveValue(CERTIFICATE);
    fireEvent.change(caBox(2), { target: { value: "  " } });

    const all: Array<RunbookStep> = await save();

    expect(configOf(all, "trusts")).not.toHaveProperty("caCertificate");
  });

  test.each([
    ["text", "my internal CA", CaCertificateProblem.NotACertificate],
    [
      "a private key",
      "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49\n-----END PRIVATE KEY-----",
      CaCertificateProblem.PrivateKey,
    ],
    [
      "a variable beside a certificate",
      `${CERTIFICATE}\n{{global.variables.INTERNAL_CA}}`,
      CaCertificateProblem.VariableAmongText,
    ],
    [
      "two variables",
      "{{global.variables.INTERNAL_CA}} {{global.variables.LAB_CA}}",
      CaCertificateProblem.VariableAmongText,
    ],
  ])(
    "that is %s says why under its box",
    async (_what: string, value: string, problem: CaCertificateProblem) => {
      await renderSteps();
      open("Check the public status");

      fireEvent.change(caBox(0), { target: { value } });

      expect(caBox(0)).toHaveAttribute("aria-invalid", "true");
      expect(
        within(
          screen.getByTestId("runbook-step-0-http-ca-certificate-field"),
        ).getByText(HTTP_CA_CERTIFICATE_PROBLEMS[problem]),
      ).toBeInTheDocument();
    },
  );

  test("that is one says nothing under its box", async () => {
    await renderSteps();
    open("Call the billing service");

    expect(caBox(2)).not.toHaveAttribute("aria-invalid");

    for (const problem of Object.values(CaCertificateProblem)) {
      expect(
        screen.queryByText(HTTP_CA_CERTIFICATE_PROBLEMS[problem]),
      ).toBeNull();
    }
  });

  test("one variable alone says nothing under its box, is saved as written, and is named on the folded line, never its text", async () => {
    globalVariables = [variable("INTERNAL_CA")];
    await renderSteps();
    open("Check the public status");

    fireEvent.change(caBox(0), {
      target: { value: "{{global.variables.INTERNAL_CA}}" },
    });

    expect(caBox(0)).not.toHaveAttribute("aria-invalid");

    for (const problem of Object.values(CaCertificateProblem)) {
      expect(
        screen.queryByText(HTTP_CA_CERTIFICATE_PROBLEMS[problem]),
      ).toBeNull();
    }

    expect(foldedLine(0)).toContain(HTTP_CA_CERTIFICATE_TITLE);
    expect(foldedLine(0)).not.toContain("INTERNAL_CA");

    stored = await save();
    expect(configOf(stored, "plain").caCertificate).toBe(
      "{{global.variables.INTERNAL_CA}}",
    );

    cleanup();
    await renderSteps();
    open("Check the public status");

    expect(caBox(0)).toHaveValue("{{global.variables.INTERNAL_CA}}");
  });

  test("a variable the project does not have is named with the step's other variables; with the switch on, it is not used, so none is", async () => {
    stored = [
      httpStep("names", 0, "Call the ledger", {
        caCertificate: "{{global.variables.INTERNAL_CA}}",
      }),
      httpStep("skips-names", 1, "Call the lab switch", {
        allowSelfSignedCertificates: true,
        caCertificate: "{{global.variables.GONE}}",
      }),
    ];
    globalVariables = [variable("SOMETHING_ELSE")];

    await renderSteps();
    open("Call the ledger");
    open("Call the lab switch");

    const note: HTMLElement = await screen.findByTestId(
      "runbook-step-0-http-unknown-variables",
      {},
      WAIT,
    );

    expect(note).toHaveTextContent(
      "No variable is named {{global.variables.INTERNAL_CA}}, so the step will fail when it runs.",
    );
    expect(
      screen.queryByTestId("runbook-step-1-http-unknown-variables"),
    ).toBeNull();
  });

  test("a variable the project has is named nowhere as missing", async () => {
    stored = [
      httpStep("names", 0, "Call the ledger", {
        caCertificate: "{{global.variables.INTERNAL_CA}}",
      }),
    ];
    globalVariables = [variable("INTERNAL_CA")];

    await renderSteps();
    open("Call the ledger");

    // The variables are read: the chips to copy them show.
    await screen.findByTestId("runbook-step-0-http-variables", {}, WAIT);

    expect(
      screen.queryByTestId("runbook-step-0-http-unknown-variables"),
    ).toBeNull();
  });
});

describe("the words", () => {
  test("every Dashboard language has each of them, translated", () => {
    const files: Array<string> = fs
      .readdirSync(DASHBOARD_LOCALES)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(18);

    const words: Array<string> = [
      HTTP_ALLOW_SELF_SIGNED_TITLE,
      HTTP_ALLOW_SELF_SIGNED_DESCRIPTION,
      HTTP_CA_CERTIFICATE_TITLE,
      HTTP_CA_CERTIFICATE_HELP,
      ...Object.values(HTTP_CA_CERTIFICATE_PROBLEMS),
    ];

    for (const file of files) {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(DASHBOARD_LOCALES, file), "utf8"),
      );

      for (const word of words) {
        const value: string | undefined = locale[word];

        expect([file, word, typeof value]).toEqual([file, word, "string"]);

        if (file === "en.json") {
          expect(value).toBe(word);
        } else {
          expect([file, word, value === word]).toEqual([file, word, false]);
        }
      }
    }
  });

  test("the CA certificate's help keeps its one slot, where the reference is drawn, in every language", () => {
    for (const file of fs.readdirSync(DASHBOARD_LOCALES)) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(DASHBOARD_LOCALES, file), "utf8"),
      );
      const help: string | undefined = locale[HTTP_CA_CERTIFICATE_HELP];

      expect([file, help?.split("{{reference}}").length]).toEqual([file, 2]);
      // Still a certificate in PEM, whatever the language calls it.
      expect([file, help?.includes("PEM")]).toEqual([file, true]);
    }
  });

  test("a CA certificate's problems quote its PEM lines as written, in every language", () => {
    const pemLines: Array<string> = [
      "-----BEGIN CERTIFICATE-----",
      "-----END CERTIFICATE-----",
    ];
    const notACertificate: string =
      HTTP_CA_CERTIFICATE_PROBLEMS[CaCertificateProblem.NotACertificate];

    for (const file of fs.readdirSync(DASHBOARD_LOCALES)) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(DASHBOARD_LOCALES, file), "utf8"),
      );

      for (const line of pemLines) {
        expect([file, locale[notACertificate]?.includes(line)]).toEqual([
          file,
          true,
        ]);
      }
    }
  });
});

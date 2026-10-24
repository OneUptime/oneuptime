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
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Connect Meraki (issue #5140), drawn for real: the key, then the
 * organization. The key is tested as the second step opens - the
 * organizations it reads, picked for you when it reads one - and the
 * organization picked is counted, so the dialog says what a read will cover
 * before anything is saved. Connect is offered only once that test passed,
 * and the connection it creates holds the key in its secrets alone.
 *
 * A failed test offers its way on: Change API key - back to the key,
 * selected to paste over - for a key Meraki refused, Try again for what may
 * pass in a minute, both for a key that cannot read the organization. A
 * refused key names the dashboard that refused it; a test that never
 * reached Meraki never blames Meraki.
 *
 * The network (the test POST and the create) is replaced.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const API_KEY: string = "0123456789abcdef0123456789abcdef01234567";

const apiPostMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: Array<unknown>): unknown => {
        return createMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10000000-0000-4000-8000-000000000001" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import MerakiConnectModal from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiConnectModal";
import NetworkControllerConnection from "../../../Models/DatabaseModels/NetworkControllerConnection";
import { JSONObject } from "../../../Types/JSON";
import { listedNames } from "../../UI/Components/FoldedSection/FoldedSectionQueries";

interface TestBody {
  provider: string;
  config: JSONObject;
  secrets: JSONObject;
}

type Answer = (body: TestBody) => JSONObject;

const ACME: JSONObject = { id: "549236", name: "Acme Retail" };
const WAREHOUSES: JSONObject = { id: "777001", name: "Acme Warehouses" };

function pass(overrides: JSONObject = {}): JSONObject {
  return {
    provider: "meraki",
    status: "pass",
    message: "Reads 312 networks and 287 appliances in Acme Retail.",
    organizations: [ACME],
    organizationId: "549236",
    networkCount: 312,
    applianceCount: 287,
    durationMs: 120,
    ...overrides,
  };
}

function answerWith(answer: Answer): void {
  apiPostMock.mockImplementation(async (args: unknown) => {
    return { data: answer((args as { data: TestBody }).data) };
  });
}

function testBodies(): Array<TestBody> {
  return apiPostMock.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { data: TestBody }).data;
  });
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

let onClose: MockFunction;
let onConnected: MockFunction;

async function open(): Promise<void> {
  render(<MerakiConnectModal onClose={onClose} onConnected={onConnected} />);
  await flush();
}

async function enterKeyAndGoOn(key: string = API_KEY): Promise<void> {
  fireEvent.change(screen.getByTestId("meraki-api-key"), {
    target: { value: key },
  });
  fireEvent.click(screen.getByTestId("modal-footer-next-button"));
  await flush();
}

function connectButton(): HTMLElement {
  return screen.getByTestId("modal-footer-submit-button");
}

beforeEach(() => {
  apiPostMock.mockReset();
  createMock.mockReset();
  createMock.mockImplementation(async () => {
    return { data: {} };
  });
  onClose = getJestMockFunction();
  onConnected = getJestMockFunction();
  answerWith(() => {
    return pass();
  });
});

afterEach(() => {
  cleanup();
});

describe("the key", () => {
  test("opens on the key, with the region folded away and Connect not offered yet", async () => {
    await open();

    expect(screen.getByTestId("meraki-connect-key-step")).toBeInTheDocument();
    expect(screen.getByTestId("meraki-api-key")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.queryByTestId("modal-footer-submit-button")).toBeNull();
    const more: HTMLElement = screen.getByTestId("meraki-connect-key-more");
    expect(within(more).getByTestId("folded-section-header")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(listedNames(more)).toEqual(["Dashboard region"]);
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  test("Next without a key says so, and asks nothing", async () => {
    await open();

    fireEvent.click(screen.getByTestId("modal-footer-next-button"));
    await flush();

    expect(
      screen.getByText("Enter the Meraki dashboard API key."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("meraki-connect-key-step")).toBeInTheDocument();
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  test("the key is tested as the next step opens, against the region's dashboard", async () => {
    await open();

    fireEvent.click(
      within(screen.getByTestId("meraki-connect-key-more")).getByTestId(
        "folded-section-header",
      ),
    );
    fireEvent.change(screen.getByTestId("meraki-region"), {
      target: { value: "canada" },
    });
    await enterKeyAndGoOn(`  ${API_KEY}  `);

    expect(testBodies()).toEqual([
      {
        provider: "meraki",
        config: { region: "canada" },
        secrets: { apiKey: API_KEY },
      },
    ]);
    expect(
      String((apiPostMock.mock.calls[0]![0] as { url: unknown }).url),
    ).toContain("/network-controller-connection/test");
  });
});

describe("the organization", () => {
  test("a key that reads one: picked, counted, and Connect creates the connection", async () => {
    await open();
    await enterKeyAndGoOn();

    expect(
      screen.getByTestId("meraki-connect-only-organization"),
    ).toHaveTextContent("Acme Retail");
    const result: HTMLElement = screen.getByTestId("meraki-test-result");
    expect(result).toHaveAttribute("data-status", "pass");
    expect(result).toHaveTextContent("Ready to read Acme Retail.");
    expect(screen.getByTestId("meraki-test-counts")).toHaveTextContent("312");
    expect(screen.getByTestId("meraki-test-counts")).toHaveTextContent("287");
    expect(connectButton()).not.toBeDisabled();

    fireEvent.click(connectButton());
    await flush();

    expect(createMock).toHaveBeenCalledTimes(1);
    const created: NetworkControllerConnection = (
      createMock.mock.calls[0]![0] as { model: NetworkControllerConnection }
    ).model;
    expect(created.projectId?.toString()).toBe(PROJECT_ID);
    expect(created.name).toBe("Acme Retail");
    expect(created.provider).toBe("meraki");
    expect(created.config).toEqual({
      region: "global",
      organizationId: "549236",
      organizationName: "Acme Retail",
      readIntervalInMinutes: 5,
    });
    expect(JSON.parse(created.secrets as string)).toEqual({ apiKey: API_KEY });
    expect(onConnected).toHaveBeenCalledWith({ name: "Acme Retail" });
  });

  test("a key that reads several: Connect waits until one is picked and counted", async () => {
    answerWith((body: TestBody) => {
      if (!body.config["organizationId"]) {
        return {
          provider: "meraki",
          status: "pass",
          message: "The key reads 2 organizations. Pick the one to read.",
          organizations: [ACME, WAREHOUSES],
          durationMs: 80,
        };
      }

      return pass({
        organizations: [ACME, WAREHOUSES],
        organizationId: body.config["organizationId"],
        networkCount: 12,
        applianceCount: 12,
      });
    });

    await open();
    await enterKeyAndGoOn();

    const radios: Array<HTMLElement> = screen.getAllByTestId(
      "meraki-connect-organization",
    );
    expect(radios).toHaveLength(2);
    expect(connectButton()).toBeDisabled();

    fireEvent.click(radios[1]!);
    await flush();

    expect(testBodies()[1]).toEqual({
      provider: "meraki",
      config: { region: "global", organizationId: "777001" },
      secrets: { apiKey: API_KEY },
    });
    expect(screen.getByTestId("meraki-test-result")).toHaveTextContent(
      "Ready to read Acme Warehouses.",
    );
    expect(connectButton()).not.toBeDisabled();

    fireEvent.click(connectButton());
    await flush();

    expect(
      (createMock.mock.calls[0]![0] as { model: NetworkControllerConnection })
        .model.config,
    ).toMatchObject({
      organizationId: "777001",
      organizationName: "Acme Warehouses",
    });
  });

  test("only the newest pick's count lands", async () => {
    const pending: Array<(value: unknown) => void> = [];

    apiPostMock.mockImplementation((args: unknown) => {
      const body: TestBody = (args as { data: TestBody }).data;

      if (!body.config["organizationId"]) {
        return Promise.resolve({
          data: {
            provider: "meraki",
            status: "pass",
            message: "",
            organizations: [ACME, WAREHOUSES],
            durationMs: 1,
          },
        });
      }

      return new Promise((resolve: (value: unknown) => void) => {
        pending.push(() => {
          resolve({
            data: pass({
              organizations: [ACME, WAREHOUSES],
              organizationId: body.config["organizationId"],
              networkCount: body.config["organizationId"] === "549236" ? 1 : 2,
            }),
          });
        });
      });
    });

    await open();
    await enterKeyAndGoOn();

    const radios: Array<HTMLElement> = screen.getAllByTestId(
      "meraki-connect-organization",
    );
    fireEvent.click(radios[0]!);
    fireEvent.click(radios[1]!);
    await flush();

    // The second pick answers first, then the first: the first is dropped.
    pending[1]!(undefined);
    await flush();
    pending[0]!(undefined);
    await flush();

    expect(screen.getByTestId("meraki-test-result")).toHaveTextContent(
      "Ready to read Acme Warehouses.",
    );
    expect(screen.getByTestId("meraki-test-counts")).toHaveTextContent("2");
  });

  test("a name and an interval of its own, under More fields", async () => {
    await open();
    await enterKeyAndGoOn();

    fireEvent.click(
      within(
        screen.getByTestId("meraki-connect-organization-more"),
      ).getByTestId("folded-section-header"),
    );
    fireEvent.change(screen.getByTestId("meraki-connection-name"), {
      target: { value: "Stores (EMEA)" },
    });
    fireEvent.change(screen.getByTestId("meraki-read-interval"), {
      target: { value: "15" },
    });

    fireEvent.click(connectButton());
    await flush();

    const created: NetworkControllerConnection = (
      createMock.mock.calls[0]![0] as { model: NetworkControllerConnection }
    ).model;
    expect(created.name).toBe("Stores (EMEA)");
    expect((created.config as JSONObject)["readIntervalInMinutes"]).toBe(15);
  });
});

function refused(kind: string, message: string): JSONObject {
  return {
    provider: "meraki",
    status: "fail",
    message,
    failureKind: kind,
    organizations: [],
    durationMs: 40,
  };
}

describe("the steps", () => {
  test("the step done is checked, and opens again; the one to come cannot be opened yet", async () => {
    await open();

    expect(screen.getByTestId("meraki-connect-step-1")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByTestId("meraki-connect-step-2")).toBeDisabled();

    await enterKeyAndGoOn();

    const first: HTMLElement = screen.getByTestId("meraki-connect-step-1");
    expect(first).not.toBeDisabled();
    // Checked rather than numbered.
    expect(first).not.toHaveTextContent("1");
    expect(first.querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("meraki-connect-step-2")).toHaveAttribute(
      "aria-current",
      "step",
    );

    fireEvent.click(first);
    await flush();

    expect(screen.getByTestId("meraki-connect-key-step")).toBeInTheDocument();
  });
});

describe("when the key does not work", () => {
  test("a refused key: the dashboard that refused it, what to do - and Change API key, back on the key, selected", async () => {
    answerWith(() => {
      return refused(
        "authentication",
        "The Meraki dashboard (dashboard.meraki.com) did not accept this API key.",
      );
    });

    await open();
    await enterKeyAndGoOn();

    const result: HTMLElement = screen.getByTestId("meraki-test-result");
    expect(result).toHaveAttribute("data-status", "fail");
    expect(result).toHaveTextContent(
      "The Meraki dashboard at dashboard.meraki.com did not accept this API key.",
    );
    expect(result).toHaveTextContent(
      "Copy the key again from the Meraki dashboard (Organization > API & Webhooks), and check the region is the dashboard you sign in to.",
    );
    // Meraki's answer would only say the headline again.
    expect(screen.queryByTestId("meraki-test-details")).toBeNull();
    // Testing the same key again would only fail again.
    expect(screen.queryByTestId("meraki-test-try-again")).toBeNull();
    expect(connectButton()).toBeDisabled();

    fireEvent.click(screen.getByTestId("meraki-test-change-key"));
    await flush();

    const key: HTMLInputElement = screen.getByTestId(
      "meraki-api-key",
    ) as HTMLInputElement;
    expect(screen.getByTestId("meraki-connect-key-step")).toBeInTheDocument();
    expect(document.activeElement).toBe(key);
    expect(key.value).toBe(API_KEY);
    expect(key.selectionStart).toBe(0);
    expect(key.selectionEnd).toBe(API_KEY.length);

    answerWith(() => {
      return pass();
    });
    await enterKeyAndGoOn("fedcba9876543210fedcba9876543210fedcba98");

    expect(screen.getByTestId("meraki-test-result")).toHaveAttribute(
      "data-status",
      "pass",
    );
    expect(testBodies()[1]!.secrets).toEqual({
      apiKey: "fedcba9876543210fedcba9876543210fedcba98",
    });
  });

  test("refused on another region's dashboard: that dashboard is named", async () => {
    answerWith(() => {
      return refused(
        "authentication",
        "The Meraki dashboard (dashboard.meraki.ca) did not accept this API key.",
      );
    });

    await open();
    fireEvent.click(
      within(screen.getByTestId("meraki-connect-key-more")).getByTestId(
        "folded-section-header",
      ),
    );
    fireEvent.change(screen.getByTestId("meraki-region"), {
      target: { value: "canada" },
    });
    await enterKeyAndGoOn();

    expect(screen.getByTestId("meraki-test-result")).toHaveTextContent(
      "The Meraki dashboard at dashboard.meraki.ca did not accept this API key.",
    );
  });

  test("a key that cannot read the organization: Try again once it is fixed in Meraki, or another key", async () => {
    answerWith(() => {
      return refused(
        "permission",
        "API access is turned off for Acme Retail.",
      );
    });

    await open();
    await enterKeyAndGoOn();

    const result: HTMLElement = screen.getByTestId("meraki-test-result");
    expect(result).toHaveTextContent("This key cannot read the organization.");
    // What Meraki said, under it: it says more than the headline.
    expect(screen.getByTestId("meraki-test-details")).toHaveTextContent(
      "API access is turned off for Acme Retail.",
    );
    expect(screen.getByTestId("meraki-test-change-key")).toBeInTheDocument();

    answerWith(() => {
      return pass();
    });
    fireEvent.click(screen.getByTestId("meraki-test-try-again"));
    await flush();

    expect(apiPostMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("meraki-test-result")).toHaveAttribute(
      "data-status",
      "pass",
    );
  });

  test("Meraki slowing OneUptime down: Try again, and the key is not doubted", async () => {
    answerWith(() => {
      return refused(
        "rate-limited",
        "Meraki answered the list of organizations with HTTP 429: Too Many Requests",
      );
    });

    await open();
    await enterKeyAndGoOn();

    expect(screen.getByTestId("meraki-test-result")).toHaveTextContent(
      "Meraki asked OneUptime to slow down.",
    );
    expect(screen.getByTestId("meraki-test-try-again")).toBeInTheDocument();
    expect(screen.queryByTestId("meraki-test-change-key")).toBeNull();
  });

  test("a test request that fails is shown as a failure, never a crash", async () => {
    apiPostMock.mockImplementation(async () => {
      const { default: HTTPErrorResponse } = jest.requireActual(
        "../../../Types/API/HTTPErrorResponse",
      ) as {
        default: new (
          status: number,
          data: JSONObject,
          headers: JSONObject,
        ) => unknown;
      };
      return new HTTPErrorResponse(502, { message: "Bad gateway" }, {});
    });

    await open();
    await enterKeyAndGoOn();

    const result: HTMLElement = screen.getByTestId("meraki-test-result");
    expect(result).toHaveAttribute("data-status", "fail");
    // OneUptime's request failed: Meraki is not blamed for it.
    expect(result).toHaveTextContent("The test could not run");
    expect(result).not.toHaveTextContent("Meraki refused the request.");
    expect(screen.getByTestId("meraki-test-try-again")).toBeInTheDocument();
    expect(connectButton()).toBeDisabled();
  });

  test("a save the server refuses keeps the dialog open, saying why", async () => {
    createMock.mockImplementation(async () => {
      throw new Error(
        'This Meraki organization is connected already, as "Acme stores". Edit that connection instead.',
      );
    });

    await open();
    await enterKeyAndGoOn();
    fireEvent.click(connectButton());
    await flush();

    await waitFor(() => {
      expect(
        screen.getByText(
          'This Meraki organization is connected already, as "Acme stores". Edit that connection instead.',
        ),
      ).toBeInTheDocument();
    });
    expect(onConnected).not.toHaveBeenCalled();
  });

  test("the key is never drawn as text", async () => {
    await open();
    await enterKeyAndGoOn();

    expect(document.body.textContent || "").not.toContain(API_KEY);
  });
});

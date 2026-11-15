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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import TelemetryDocumentation, {
  OTEL_SIGNALS_FOR_TYPE,
  TELEMETRY_LANGUAGES,
  TelemetryType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/Documentation";
import {
  OTEL_SIGNALS,
  OtelSignal,
  getEnvVarSnippet,
  getOtelConfigSnippet,
  getOtelInstallSnippet,
  replacePlaceholders,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/OtelSdkSnippets";
import Protocol from "../../../Types/API/Protocol";
import { TelemetryGuideLanguageKey } from "../../../Types/Telemetry/OpenTelemetryGuides";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import API from "../../../UI/Utils/API/API";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";
import { preloadProviderLogoMarks } from "../../Helpers/ProviderLogoMarks";

/*
 * Telemetry > Setup Guide > OpenTelemetry, language by language, on the two
 * kinds of server (issue #7885): a self-hosted one at
 * http://localhost:18811, and an https one with no port. Each language's
 * Configure the SDK step shows its snippet as OtelSdkSnippets builds it,
 * filled with that server's OTLP endpoint (the one the first step shows) and
 * the picked key, and its Install Dependencies step the versions that
 * snippet is for. Python's and .NET's exporters were given the endpoint
 * itself and posted to /otlp (404); Go's was given the host alone and
 * posted to https://<host>/v1/traces, which no server block sends to the
 * App.
 *
 * And each guide shows its own signal's snippets (issue #7927): Send your
 * first logs the logs ones, Send your first metrics the metrics ones,
 * traces and exceptions the traces ones, and a guide for a whole service
 * (everySignal) all three. The logs and metrics guides showed the traces
 * code, which for most languages set up traces alone.
 */

let mockHost: string | undefined = undefined;
let mockProtocol: Protocol | undefined = undefined;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "HOST", {
    get: (): unknown => {
      return mockHost === undefined ? actual["HOST"] : mockHost;
    },
  });
  Object.defineProperty(mocked, "HTTP_PROTOCOL", {
    get: (): unknown => {
      return mockProtocol === undefined
        ? actual["HTTP_PROTOCOL"]
        : mockProtocol;
    },
  });

  return mocked;
});

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const SECRET: string = "6b4a1d5c-0c5e-4a8f-9a30-1f1f2b7d1e11";

const serverKey: () => TelemetryIngestionKey = (): TelemetryIngestionKey => {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID("key-1");
  key.name = "Production Key";
  key.secretKey = new ObjectID(SECRET);
  key.keyType = TelemetryIngestionKeyType.Server;
  return key;
};

interface Server {
  label: string;
  protocol: Protocol;
  protocolName: string;
  host: string;
}

const SERVERS: Array<Server> = [
  {
    label: "a self-hosted server at http://localhost:18811",
    protocol: Protocol.HTTP,
    protocolName: "http",
    host: "localhost:18811",
  },
  {
    label: "an https server with no port",
    protocol: Protocol.HTTPS,
    protocolName: "https",
    host: "oneuptime.example.com",
  },
];

const LANGUAGES: Array<[string, TelemetryGuideLanguageKey]> =
  TELEMETRY_LANGUAGES.map(
    (language: {
      shortLabel: string;
      key: TelemetryGuideLanguageKey;
    }): [string, TelemetryGuideLanguageKey] => {
      return [language.shortLabel, language.key];
    },
  );

const otlpEndpointOf: (server: Server) => string = (server: Server): string => {
  return `${server.protocolName}://${server.host}/otlp`;
};

// The code in the step with this title.
const stepCode: (title: string) => string = (title: string): string => {
  const heading: HTMLElement = screen.getByRole("heading", {
    level: 4,
    name: title,
  });
  const code: Element | null =
    heading.parentElement?.querySelector("pre code") || null;

  if (!code) {
    throw new Error(`No code in the step "${title}"`);
  }

  return code.textContent || "";
};

interface Guide {
  telemetryType: TelemetryType;
  everySignal?: boolean;
}

const TRACES_GUIDE: Guide = { telemetryType: "traces" };

/*
 * Opens a guide (the traces one unless told) on a server and picks a
 * language. Returns once the first step shows the OTLP endpoint and the SDK
 * step carries the picked key.
 */
const openGuide: (
  server: Server,
  label: string,
  guide?: Guide,
) => Promise<void> = async (
  server: Server,
  label: string,
  guide: Guide = TRACES_GUIDE,
): Promise<void> => {
  mockHost = server.host;
  mockProtocol = server.protocol;

  render(
    <MemoryRouter>
      <TelemetryDocumentation
        telemetryType={guide.telemetryType}
        everySignal={guide.everySignal}
      />
    </MemoryRouter>,
  );

  await screen.findByText(otlpEndpointOf(server));
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => {
    expect(stepCode("Configure the SDK")).toContain(SECRET);
  });
};

describe("the OpenTelemetry snippets carry the server's own OTLP addresses", () => {
  beforeAll(async (): Promise<void> => {
    await preloadProviderLogoMarks();
  });

  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [serverKey()],
      count: 1,
      skip: 0,
      limit: 50,
    } as never);
    jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    mockHost = undefined;
    mockProtocol = undefined;
  });

  describe.each(SERVERS)("$label", (server: Server) => {
    test.each(LANGUAGES)(
      "%s: the snippet built for the language, with this server's OTLP endpoint and the picked key",
      async (label: string, key: TelemetryGuideLanguageKey) => {
        await openGuide(server, label);

        expect([label, stepCode("Configure the SDK")]).toEqual([
          label,
          replacePlaceholders(
            getOtelConfigSnippet(key, "traces").code,
            otlpEndpointOf(server),
            SECRET,
            `${server.protocolName}://${server.host}/pyroscope`,
          ),
        ]);
        expect([label, stepCode("Install Dependencies")]).toEqual([
          label,
          getOtelInstallSnippet(key, "traces").code,
        ]);
      },
    );
  });

  /*
   * The guides each product's Send your first ... opens, and the guided
   * setup's: the snippets of the signals the guide is about, and only
   * those.
   */
  const GUIDES: Array<[string, Guide, ReadonlyArray<OtelSignal>]> = [
    ["Send your first logs", { telemetryType: "logs" }, ["logs"]],
    ["Send your first metrics", { telemetryType: "metrics" }, ["metrics"]],
    ["Send your first exceptions", { telemetryType: "exceptions" }, ["traces"]],
    [
      "a whole service's guide",
      { telemetryType: "traces", everySignal: true },
      OTEL_SIGNALS,
    ],
  ];

  describe.each(GUIDES)(
    "%s",
    (_title: string, guide: Guide, signals: ReadonlyArray<OtelSignal>) => {
      test.each(LANGUAGES)(
        "%s: its own signals' snippets, filled with the server's OTLP endpoint",
        async (label: string, key: TelemetryGuideLanguageKey) => {
          const server: Server = SERVERS[0]!;

          await openGuide(server, label, guide);
          const code: string = stepCode("Configure the SDK");

          expect([label, code]).toEqual([
            label,
            replacePlaceholders(
              getOtelConfigSnippet(key, signals).code,
              otlpEndpointOf(server),
              SECRET,
              `${server.protocolName}://${server.host}/pyroscope`,
            ),
          ]);
          expect([label, stepCode("Install Dependencies")]).toEqual([
            label,
            getOtelInstallSnippet(key, signals).code,
          ]);

          // Each signal it is about posts to the server's route for it.
          for (const signal of signals) {
            const posted: boolean =
              key === "java"
                ? code.includes(`=${otlpEndpointOf(server)} `)
                : code.includes(`${otlpEndpointOf(server)}/v1/${signal}`);

            expect([label, signal, posted]).toEqual([label, signal, true]);
          }
        },
      );
    },
  );

  test("the guides ask for the signals they are about", () => {
    expect(OTEL_SIGNALS_FOR_TYPE).toEqual({
      logs: ["logs"],
      metrics: ["metrics"],
      traces: ["traces"],
      exceptions: ["traces"],
    });
  });

  test.each(LANGUAGES)(
    "%s: the logs guide's snippet is not the traces guide's",
    async (label: string) => {
      await openGuide(SERVERS[0]!, label, { telemetryType: "logs" });
      const logs: string = stepCode("Configure the SDK");

      cleanup();
      await openGuide(SERVERS[0]!, label, TRACES_GUIDE);

      expect([label, logs === stepCode("Configure the SDK")]).toEqual([
        label,
        false,
      ]);
    },
  );

  test("a guide that sets up logs says what is sent: what a logger writes", async () => {
    await openGuide(SERVERS[0]!, "Node.js", { telemetryType: "logs" });

    expect(
      screen.getByText(
        "Initialize OpenTelemetry with the OTLP exporter pointing to your OneUptime instance. Logs are what your logger writes, not print or console.log lines.",
      ),
    ).toBeInTheDocument();

    cleanup();
    await openGuide(SERVERS[0]!, "Node.js", TRACES_GUIDE);

    expect(
      screen.getByText(
        "Initialize OpenTelemetry with the OTLP exporter pointing to your OneUptime instance.",
      ),
    ).toBeInTheDocument();
  });

  // A whole service's guide, which sets up every signal.
  test.each<[string, Array<string>]>([
    [
      "Python",
      [
        'endpoint="http://localhost:18811/otlp/v1/traces", headers=headers',
        'endpoint="http://localhost:18811/otlp/v1/metrics", headers=headers',
        'endpoint="http://localhost:18811/otlp/v1/logs", headers=headers',
      ],
    ],
    [
      "Go",
      [
        'otlptracehttp.WithEndpointURL("http://localhost:18811/otlp/v1/traces"),',
        'otlpmetrichttp.WithEndpointURL("http://localhost:18811/otlp/v1/metrics"),',
        'otlploghttp.WithEndpointURL("http://localhost:18811/otlp/v1/logs"),',
      ],
    ],
    [
      ".NET",
      [
        'options.Endpoint = new Uri("http://localhost:18811/otlp/v1/traces");',
        'options.Endpoint = new Uri("http://localhost:18811/otlp/v1/metrics");',
        'options.Endpoint = new Uri("http://localhost:18811/otlp/v1/logs");',
      ],
    ],
    [
      "Rust",
      [
        '.with_endpoint("http://localhost:18811/otlp/v1/traces")',
        '.with_endpoint("http://localhost:18811/otlp/v1/metrics")',
        '.with_endpoint("http://localhost:18811/otlp/v1/logs")',
      ],
    ],
  ])(
    "%s: an exporter given its address in code gets its signal's URL, which it posts to as written",
    async (label: string, lines: Array<string>) => {
      await openGuide(SERVERS[0]!, label, {
        telemetryType: "traces",
        everySignal: true,
      });

      const code: string = stepCode("Configure the SDK");

      for (const line of lines) {
        expect(code).toContain(line);
      }
      // Not the endpoint itself, nor the host alone.
      expect(code).not.toMatch(/"http:\/\/localhost:18811\/otlp"/);
      expect(code).not.toContain('"localhost:18811"');
    },
  );

  test("the environment variables give the endpoint itself, to which every SDK adds the signal's path", async () => {
    await openGuide(SERVERS[0]!, "Python");

    fireEvent.click(screen.getByTestId("telemetry-guide-advanced-toggle"));
    const topic: HTMLElement | undefined = screen
      .getAllByTestId("setup-guide-topic")
      .find((element: HTMLElement): boolean => {
        return (
          within(element).queryByText(
            "Configure with environment variables instead",
          ) !== null
        );
      });

    if (!topic) {
      throw new Error("No topic on the environment variables");
    }

    fireEvent.click(within(topic).getByRole("button"));
    const code: string = topic.querySelector("pre code")?.textContent || "";

    expect(code).toBe(
      replacePlaceholders(
        getEnvVarSnippet(),
        "http://localhost:18811/otlp",
        SECRET,
        "http://localhost:18811/pyroscope",
      ),
    );
    expect(code).toContain(
      'export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:18811/otlp"\n',
    );
  });
});

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
  TELEMETRY_LANGUAGES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/Documentation";
import {
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

/*
 * Opens the traces guide on a server and picks a language. Returns once the
 * first step shows the OTLP endpoint and the SDK step carries the picked key.
 */
const openGuide: (server: Server, label: string) => Promise<void> = async (
  server: Server,
  label: string,
): Promise<void> => {
  mockHost = server.host;
  mockProtocol = server.protocol;

  render(
    <MemoryRouter>
      <TelemetryDocumentation telemetryType="traces" />
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
            getOtelConfigSnippet(key).code,
            otlpEndpointOf(server),
            SECRET,
            `${server.protocolName}://${server.host}/pyroscope`,
          ),
        ]);
        expect([label, stepCode("Install Dependencies")]).toEqual([
          label,
          getOtelInstallSnippet(key).code,
        ]);
      },
    );
  });

  test.each<[string, Array<string>]>([
    [
      "Python",
      [
        'endpoint="http://localhost:18811/otlp/v1/traces",',
        'endpoint="http://localhost:18811/otlp/v1/metrics",',
      ],
    ],
    [
      "Go",
      [
        'otlptracehttp.WithEndpointURL("http://localhost:18811/otlp/v1/traces"),',
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
    ["Rust", ['.with_endpoint("http://localhost:18811/otlp/v1/traces")']],
  ])(
    "%s: an exporter given its address in code gets its signal's URL, which it posts to as written",
    async (label: string, lines: Array<string>) => {
      await openGuide(SERVERS[0]!, label);

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

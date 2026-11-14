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
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import TelemetryDocumentation from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/Documentation";
import {
  getFluentBitConfig,
  getFluentdConfig,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/LogShipperSnippets";
import Protocol from "../../../Types/API/Protocol";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import API from "../../../UI/Utils/API/API";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";
import { preloadProviderLogoMarks } from "../../Helpers/ProviderLogoMarks";

/*
 * Logs > Send your first logs (and the Logs Setup Guide) > FluentBit or
 * Fluentd, on the two kinds of server the newcomer walks met (issue #7753):
 * a self-hosted one at http://localhost:18811, and an https one with no
 * port, as OneUptime Cloud. The file each step shows is the one built from
 * that server's address, with the picked key, and Fluent Bit posts under
 * the OTLP endpoint the first step shows.
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

// The code block whose code starts with this line.
const codeStartingWith: (firstLine: string) => string = (
  firstLine: string,
): string => {
  const block: Element | undefined = Array.from(
    document.querySelectorAll("pre code"),
  ).find((element: Element): boolean => {
    return (element.textContent || "").startsWith(firstLine);
  });

  if (!block) {
    throw new Error(`No code block starts with "${firstLine}"`);
  }

  return block.textContent || "";
};

/*
 * Opens the logs guide on a server and picks a way to send. Returns its
 * file once the picked key is in it, and the first step shows the OTLP
 * endpoint.
 */
const openGuide: (
  server: Server,
  method: string,
  firstLine: string,
) => Promise<string> = async (
  server: Server,
  method: string,
  firstLine: string,
): Promise<string> => {
  mockHost = server.host;
  mockProtocol = server.protocol;

  render(
    <MemoryRouter>
      <TelemetryDocumentation telemetryType="logs" />
    </MemoryRouter>,
  );

  fireEvent.click(screen.getByText(method, { selector: "div" }));

  await screen.findByText(`${server.protocolName}://${server.host}/otlp`);
  await waitFor(() => {
    expect(codeStartingWith(firstLine)).toContain(SECRET);
  });

  return codeStartingWith(firstLine);
};

describe("the log shippers' files carry the server's own address", () => {
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

  test.each(SERVERS)(
    "FluentBit, $label: the file built from that address, posting under the OTLP endpoint shown",
    async (server: Server) => {
      const config: string = await openGuide(
        server,
        "FluentBit",
        "# fluent-bit.conf",
      );

      expect(config).toBe(
        getFluentBitConfig({
          protocol: server.protocolName,
          host: server.host,
          key: SECRET,
        }),
      );
      expect(config).toContain("Logs_uri     /otlp/v1/logs");
    },
  );

  test("FluentBit on a self-hosted server: the host alone, its own port, TLS off", async () => {
    const config: string = await openGuide(
      SERVERS[0]!,
      "FluentBit",
      "# fluent-bit.conf",
    );

    expect(config).toContain("Host         localhost\n");
    expect(config).toContain("Port         18811\n");
    expect(config).toContain("Tls          Off\n");
  });

  test("FluentBit on an https server with no port: port 443, TLS on", async () => {
    const config: string = await openGuide(
      SERVERS[1]!,
      "FluentBit",
      "# fluent-bit.conf",
    );

    expect(config).toContain("Host         oneuptime.example.com\n");
    expect(config).toContain("Port         443\n");
    expect(config).toContain("Tls          On\n");
  });

  test.each(SERVERS)(
    "Fluentd, $label: the file built from that address",
    async (server: Server) => {
      const config: string = await openGuide(
        server,
        "Fluentd",
        "# fluentd.conf",
      );

      expect(config).toBe(
        getFluentdConfig({
          protocol: server.protocolName,
          host: server.host,
          key: SECRET,
        }),
      );
      expect(config).toContain(
        `endpoint ${server.protocolName}://${server.host}/fluentd/logs\n`,
      );
    },
  );
});

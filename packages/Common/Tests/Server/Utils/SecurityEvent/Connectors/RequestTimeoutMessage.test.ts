import axios from "axios";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../Server/Utils/DataSource/HttpFetch";
import { ResolvedAddress } from "../../../../../Server/Utils/DataSource/EgressGuard";
import CrowdStrikeFalconClient from "../../../../../Server/Utils/SecurityEvent/Connectors/CrowdStrikeFalcon/CrowdStrikeFalconClient";
import ElasticSecurityClient from "../../../../../Server/Utils/SecurityEvent/Connectors/ElasticSecurity/ElasticSecurityClient";
import MicrosoftDefenderXdrClient from "../../../../../Server/Utils/SecurityEvent/Connectors/MicrosoftDefenderXdr/MicrosoftDefenderXdrClient";
import OktaClient from "../../../../../Server/Utils/SecurityEvent/Connectors/Okta/OktaClient";
import isRequestTimeoutMessage from "../../../../../Server/Utils/SecurityEvent/Connectors/RequestTimeoutMessage";
import SplunkClient from "../../../../../Server/Utils/SecurityEvent/Connectors/Splunk/SplunkClient";
import { ConnectorTransport } from "../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import { describe, expect, test } from "@jest/globals";
import { startEachTestOnSelfHostedEgressPolicy } from "../../EgressPolicyEnvironment";

/*
 * A request that times out halves the next poll window
 * (SecurityEventConnectionPoller), so the poller has to recognize a timeout
 * in the words each connector really fails with. The clients of Splunk,
 * Elastic Security, Okta, Microsoft Defender XDR and CrowdStrike Falcon
 * have no deadline of their own: their timeout is axios's, and the shared
 * data source fetch words it "Could not reach data source: Timeout Error."
 * The poller's old pattern knew only axios's own "timeout of Nms exceeded",
 * which never reaches a connector, so their timed-out windows were retried
 * whole on every poll, against what the docs say.
 *
 * Here the real DataSourceHttpFetch runs under each client, with axios
 * failing the way it does when a request runs out of time, and the message
 * each client fails with must read as a timeout. axios is mocked at the
 * module boundary, as in HttpFetch.test.ts, so no socket is opened.
 */

jest.mock("axios", () => {
  type IsAxiosErrorFunction = (candidate: unknown) => boolean;
  const isAxiosError: IsAxiosErrorFunction = (candidate: unknown): boolean => {
    return Boolean(
      candidate &&
        typeof candidate === "object" &&
        (candidate as { isAxiosError?: boolean }).isAxiosError === true,
    );
  };
  const axiosFunction: jest.Mock = Object.assign(jest.fn(), {
    isAxiosError: isAxiosError,
  });
  return {
    __esModule: true,
    default: axiosFunction,
  };
});

const axiosMock: jest.Mock = axios as unknown as jest.Mock;

const PUBLIC_IP: string = "93.184.216.34";
const WINDOW_START: Date = new Date("2026-09-14T00:00:00.000Z");
const WINDOW_END: Date = new Date("2026-09-15T00:00:00.000Z");
const TIMEOUT_IN_MS: number = 60000;

/*
 * The production transport, with name resolution answered by a public
 * address so the egress guard lets the request through to axios.
 */
const realFetch: ConnectorTransport = (
  request: DataSourceHttpRequest,
): Promise<DataSourceHttpResponse> => {
  return DataSourceHttpFetch.fetch({
    ...request,
    egressOptions: {
      ...(request.egressOptions || {}),
      blockPrivateAddresses: true,
      resolveFunction: (): Promise<Array<ResolvedAddress>> => {
        return Promise.resolve([{ address: PUBLIC_IP, family: 4 }]);
      },
    },
  });
};

// What axios rejects with when a request runs past its timeout.
function axiosTimeout(): unknown {
  return {
    isAxiosError: true,
    code: "ECONNABORTED",
    message: `timeout of ${TIMEOUT_IN_MS}ms exceeded`,
    response: undefined,
  };
}

async function messageOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }

  throw new Error("Expected the request to fail");
}

interface TimedOutClient {
  name: string;
  run: () => Promise<unknown>;
  // How the client's message starts, before the transport's words.
  prefix: string;
}

const CLIENTS: Array<TimedOutClient> = [
  {
    name: "Splunk Enterprise Security",
    prefix: "Splunk Enterprise Security search export did not complete:",
    run: () => {
      return new SplunkClient({
        url: "https://splunk.example.com:8089",
        apiToken: "a-splunk-authentication-token",
        searchString: "index=notable",
        transport: realFetch,
        requestTimeoutInMs: TIMEOUT_IN_MS,
      }).exportSearch({
        startTime: WINDOW_START,
        endTime: WINDOW_END,
        maxResults: 10000,
      });
    },
  },
  {
    name: "Elastic Security",
    prefix: "Elastic Security alerts search did not complete:",
    run: () => {
      return new ElasticSecurityClient({
        kibanaUrl: "https://kibana.example.com",
        space: "",
        apiKey: "VnVhQ2ZHY0JDZGJrUW0tZTVhT3g6dWkybHAyYXhUTm1zeWFrdzl0dk5udw==",
        transport: realFetch,
        requestTimeoutInMs: TIMEOUT_IN_MS,
      }).searchAlerts({
        startTime: WINDOW_START,
        endTime: WINDOW_END,
        size: 1000,
      });
    },
  },
  {
    name: "Okta System Log",
    prefix: "Okta System Log events request did not complete:",
    run: () => {
      return new OktaClient({
        orgUrl: "https://acme.okta.com",
        apiToken: "00a-test-okta-api-token",
        transport: realFetch,
        requestTimeoutInMs: TIMEOUT_IN_MS,
      }).listLogEvents({
        startTime: WINDOW_START,
        endTime: WINDOW_END,
        limit: 1000,
      });
    },
  },
  {
    name: "Microsoft Defender XDR",
    prefix: "Microsoft Defender XDR token request did not complete:",
    run: () => {
      return new MicrosoftDefenderXdrClient({
        tenantId: "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c",
        clientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
        clientSecret: "a-client-secret-for-the-tests",
        cloud: "public",
        transport: realFetch,
        requestTimeoutInMs: TIMEOUT_IN_MS,
      }).getAccessToken();
    },
  },
  {
    name: "CrowdStrike Falcon",
    prefix: "CrowdStrike Falcon token request could not be completed:",
    run: () => {
      return new CrowdStrikeFalconClient({
        clientId: "falcon-client-id",
        clientSecret: "a-client-secret-for-the-tests",
        cloud: "us-1",
        transport: realFetch,
        requestTimeoutInMs: TIMEOUT_IN_MS,
      }).getAccessToken();
    },
  },
];

describe("a request that runs out of time reads as a timeout to the poller", () => {
  startEachTestOnSelfHostedEgressPolicy();

  test.each(CLIENTS)(
    "$name: the client's message says the shared fetch timed out, and the poller recognizes it",
    async (entry: TimedOutClient) => {
      axiosMock.mockReset();
      axiosMock.mockRejectedValue(axiosTimeout());

      const message: string = await messageOf(entry.run);

      expect(axiosMock).toHaveBeenCalled();
      expect(message.startsWith(entry.prefix)).toBe(true);
      expect(message).toContain("Could not reach data source: Timeout Error.");
      expect(isRequestTimeoutMessage(message)).toBe(true);
    },
  );

  test.each(CLIENTS)(
    "$name: an answer that is an error status is not a timeout",
    async (entry: TimedOutClient) => {
      axiosMock.mockReset();
      axiosMock.mockRejectedValue({
        isAxiosError: true,
        message: "Request failed with status code 500",
        response: { status: 500, data: "internal error" },
      });

      const message: string = await messageOf(entry.run);

      expect(message).toContain("500");
      expect(isRequestTimeoutMessage(message)).toBe(false);
    },
  );
});

describe("every wording of a timeout", () => {
  test("is recognized: a client's own deadline, axios's words, the shared fetch's words and a socket's", () => {
    for (const message of [
      "Microsoft Sentinel incidents list timed out after 60 seconds with no response.",
      "AWS Security Hub findings request timed out after 20 seconds with no response.",
      "Google SecOps legacySearchDetections timed out after 60 seconds with no response.",
      "Splunk Enterprise Security search export did not complete: timeout of 60000ms exceeded",
      "Okta System Log events request did not complete: Could not reach data source: Timeout Error.",
      "CrowdStrike Falcon alerts query could not be completed: connect ETIMEDOUT 203.0.113.10:443",
    ]) {
      expect({ message, timeout: isRequestTimeoutMessage(message) }).toEqual({
        message,
        timeout: true,
      });
    }
  });

  test("leaves every other failure alone, and an empty message", () => {
    for (const message of [
      "Okta System Log events request failed (HTTP 401): invalid token",
      "Elastic Security status request did not complete: Could not reach data source: Connection Refused.",
      "Splunk Enterprise Security search export did not complete: Could not reach data source: Cannot Find Host.",
      "",
    ]) {
      expect({ message, timeout: isRequestTimeoutMessage(message) }).toEqual({
        message,
        timeout: false,
      });
    }

    expect(isRequestTimeoutMessage(undefined)).toBe(false);
  });
});

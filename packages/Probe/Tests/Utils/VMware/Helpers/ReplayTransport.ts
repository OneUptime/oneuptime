import {
  VSphereHttpRequest,
  VSphereHttpResponse,
  VSphereTransport,
} from "../../../../Utils/VMware/VSphereSoapClient";
import fs from "fs";
import path from "path";

/*
 * Answers recorded from the govmomi vSphere simulator (vcsim, vCenter and
 * standalone-ESXi modes), replayed in order. Each exchange keeps the method,
 * path and SOAP method the probe called and vSphere's answer; the request
 * bodies are not kept (the login's holds the password). The PerformanceManager
 * counter list is trimmed to the counters the collector uses and two it does
 * not. See Fixtures/README.md for how they were recorded.
 */

export interface RecordedExchange {
  method: "GET" | "POST";
  path: string;
  soapMethod: string | null;
  status: number;
  body: string;
  setCookie?: string | Array<string> | undefined;
}

export const FIXTURES_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "Fixtures",
);

export function loadExchanges(name: string): Array<RecordedExchange> {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIRECTORY, name), "utf8"),
  ) as Array<RecordedExchange>;
}

export function loadJsonFixture<T>(name: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIRECTORY, name), "utf8"),
  ) as T;
}

// The SOAP method a request calls: the first element of its Body.
export function soapMethodOf(body: string | undefined): string | null {
  if (!body) {
    return null;
  }

  const marker: string = "<soapenv:Body><";
  const start: number = body.indexOf(marker);

  if (start === -1) {
    return null;
  }

  const rest: string = body.substring(start + marker.length);
  let end: number = 0;

  while (end < rest.length && rest[end] !== " " && rest[end] !== ">") {
    end++;
  }

  return rest.substring(0, end);
}

export interface ReplayTransport {
  transport: VSphereTransport;
  requests: Array<VSphereHttpRequest>;
  remaining: () => number;
}

/*
 * A transport that answers each request with the next recorded exchange,
 * after checking it is the call that was recorded - so a change in what the
 * collector asks, or in what order, fails loudly instead of replaying the
 * wrong answer.
 */
export function createReplayTransport(
  exchanges: Array<RecordedExchange>,
): ReplayTransport {
  const queue: Array<RecordedExchange> = [...exchanges];
  const requests: Array<VSphereHttpRequest> = [];

  const transport: VSphereTransport = async (
    request: VSphereHttpRequest,
  ): Promise<VSphereHttpResponse> => {
    requests.push(request);
    const next: RecordedExchange | undefined = queue.shift();

    if (!next) {
      throw new Error(
        `Unexpected request ${request.method} ${request.path} ${soapMethodOf(
          request.body,
        )}: the recording has no more exchanges.`,
      );
    }

    const soapMethod: string | null = soapMethodOf(request.body);

    if (
      next.method !== request.method ||
      next.path !== request.path ||
      next.soapMethod !== soapMethod
    ) {
      throw new Error(
        `Expected ${next.method} ${next.path} ${next.soapMethod}, got ${request.method} ${request.path} ${soapMethod}.`,
      );
    }

    return {
      status: next.status,
      headers: next.setCookie ? { "set-cookie": next.setCookie } : {},
      body: next.body,
    };
  };

  return {
    transport: transport,
    requests: requests,
    remaining: (): number => {
      return queue.length;
    },
  };
}

// A SOAP envelope around a body, as vSphere answers.
export function soapEnvelope(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
}

// A SOAP fault with a typed detail, as vCenter answers one.
export function soapFault(data: {
  faultType: string;
  faultString: string;
  detailXml?: string | undefined;
}): string {
  return soapEnvelope(
    `<soapenv:Fault><faultcode>ServerFaultCode</faultcode><faultstring>${data.faultString}</faultstring><detail><${data.faultType}Fault xmlns="urn:vim25" xsi:type="${data.faultType}">${
      data.detailXml || ""
    }</${data.faultType}Fault></detail></soapenv:Fault>`,
  );
}

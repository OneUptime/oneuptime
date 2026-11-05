/*
 * Runs the probe's own check code against a real cloud, from Node, with nothing around it: no
 * OneUptime, no probe, no server. What it prints is what a probe would have reported.
 *
 *   OS_CHECK_JOB=<job.json> OS_CHECK_OUT=<scene dir> node --require ts-node/register checks-run.ts lifecycle
 *
 * The job names the credential, and never leaves the runner. Every request it makes is written to
 * requests.jsonl with what it was answered, without its headers, so that what the code asked a real
 * cloud can be read back and held to the mocks. What Keystone answered is kept too, without its token.
 *
 * Two things differ from a probe, and each is said in what it writes:
 *
 *   OS_CHECK_PLAIN_HTTP=1   DevStack's endpoints are plain HTTP unless it is given tls-proxy, and a
 *                           probe never sends a token over HTTP. So this transport speaks HTTP where
 *                           the real one would refuse. The real one is used on the entry with TLS.
 *   OS_CHECK_CLOCK_MINUTES  Moves the check's clock on, so what the janitor waits two intervals for
 *                           does not take an hour of a runner's time. Its deletes are real.
 */
import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import OpenStackApiCheck from "../../../packages/Probe/Utils/OpenStack/Checks/OpenStackApiCheck";
import {
  DEFAULT_OPENSTACK_CHECK_DEPENDENCIES,
  OpenStackCheckDependencies,
} from "../../../packages/Probe/Utils/OpenStack/Checks/OpenStackCheckDependencies";
import OpenStackLifecycleCheck from "../../../packages/Probe/Utils/OpenStack/Checks/OpenStackLifecycleCheck";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
  OpenStackTransport,
  OpenStackTransportHandle,
} from "../../../packages/Probe/Utils/OpenStack/OpenStackHttp";
import { OpenStackPresentedCertificate } from "Common/Types/OpenStack/OpenStackProbeCollection";

const kind: string = process.argv[2] || "";
const outputDir: string = process.env["OS_CHECK_OUT"] || ".";
const job: Record<string, unknown> = JSON.parse(
  fs.readFileSync(process.env["OS_CHECK_JOB"] as string, "utf8"),
);
const isPlainHttp: boolean = process.env["OS_CHECK_PLAIN_HTTP"] === "1";
const clockOffsetInMs: number =
  Number(process.env["OS_CHECK_CLOCK_MINUTES"] || 0) * 60_000;

fs.mkdirSync(outputDir, { recursive: true });

const requestsFile: string = path.join(outputDir, "requests.jsonl");

function scrub(text: string): string {
  let scrubbed: string = text;
  const credential: Record<string, string> = (job["credential"] ||
    {}) as Record<string, string>;

  for (const secret of [
    credential["secret"],
    credential["password"],
    job["osProfilerKey"] as string | undefined,
  ]) {
    if (secret) {
      scrubbed = scrubbed.split(secret).join("<removed>");
    }
  }

  return scrubbed;
}

// Each request and its answer, as a line. Long lists are cut: what is wanted is their shape.
function record(
  request: OpenStackHttpRequest,
  response: OpenStackHttpResponse | null,
  error: unknown,
): void {
  const url: globalThis.URL = new globalThis.URL(request.url);
  const isLogin: boolean = url.pathname.endsWith("/auth/tokens");

  fs.appendFileSync(
    requestsFile,
    `${scrub(
      JSON.stringify({
        at: new Date().toISOString(),
        method: request.method,
        path: `${url.pathname}${url.search}`,
        // Whether it was signed, and never with what.
        isSigned: Boolean(request.headers["X-Trace-HMAC"]),
        body: isLogin ? undefined : request.body,
        status: response?.status,
        answer: response?.body.substring(0, 16_384),
        error: error ? String(error) : undefined,
      }),
    )}\n`,
  );
}

function recording(handle: OpenStackTransportHandle): OpenStackTransportHandle {
  const transport: OpenStackTransport = async (
    request: OpenStackHttpRequest,
  ): Promise<OpenStackHttpResponse> => {
    try {
      const response: OpenStackHttpResponse = await handle.transport(request);

      record(request, response, null);

      return response;
    } catch (error) {
      record(request, null, error);
      throw error;
    }
  };

  return { transport: transport, close: handle.close };
}

// Speaks HTTP where the real transport would refuse: see the top of this file.
function createPlainTransport(): OpenStackTransportHandle {
  return {
    close: (): void => {
      // Nothing is kept open.
    },
    transport: (
      request: OpenStackHttpRequest,
    ): Promise<OpenStackHttpResponse> => {
      return new Promise<OpenStackHttpResponse>(
        (
          resolve: (response: OpenStackHttpResponse) => void,
          reject: (error: Error) => void,
        ) => {
          const url: globalThis.URL = new globalThis.URL(
            request.url.replace(/^https:/, "http:"),
          );
          const body: Buffer | undefined =
            request.body === undefined ? undefined : Buffer.from(request.body);
          const client: typeof http | typeof https =
            url.protocol === "https:" ? https : http;

          const outgoing: http.ClientRequest = client.request(
            url,
            {
              method: request.method,
              headers: {
                ...request.headers,
                ...(body ? { "Content-Length": body.length } : {}),
              },
              timeout: request.timeoutInMs,
            },
            (incoming: http.IncomingMessage) => {
              const chunks: Array<Buffer> = [];

              incoming.on("data", (chunk: Buffer) => {
                chunks.push(chunk);
              });
              incoming.on("end", () => {
                resolve({
                  status: incoming.statusCode || 0,
                  headers: incoming.headers as Record<
                    string,
                    string | Array<string> | undefined
                  >,
                  body: Buffer.concat(chunks).toString("utf8"),
                });
              });
            },
          );

          outgoing.on("timeout", () => {
            outgoing.destroy(new Error(`${url.host} did not answer in time.`));
          });
          outgoing.on("error", reject);

          if (body) {
            outgoing.write(body);
          }

          outgoing.end();
        },
      );
    },
  };
}

const deps: OpenStackCheckDependencies = {
  ...DEFAULT_OPENSTACK_CHECK_DEPENDENCIES,
  createTransport: (data: {
    trustedFingerprints: ReadonlyArray<string>;
    resolve: (url: string) => Promise<Array<string>>;
    onCertificate?:
      | ((certificate: OpenStackPresentedCertificate) => void)
      | undefined;
  }): OpenStackTransportHandle => {
    return recording(
      isPlainHttp
        ? createPlainTransport()
        : DEFAULT_OPENSTACK_CHECK_DEPENDENCIES.createTransport(data),
    );
  },
  clock: {
    ...DEFAULT_OPENSTACK_CHECK_DEPENDENCIES.clock,
    now: (): number => {
      return Date.now() + clockOffsetInMs;
    },
  },
};

async function main(): Promise<void> {
  let result: unknown;

  if (kind === "lifecycle") {
    result = await OpenStackLifecycleCheck.run(job as never, deps);
  } else if (kind === "api") {
    result = await OpenStackApiCheck.run(job as never, deps);
  } else {
    throw new Error(`Run "lifecycle" or "api", not "${kind}".`);
  }

  fs.writeFileSync(
    path.join(outputDir, "report.json"),
    `${scrub(JSON.stringify(result, null, 2))}\n`,
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  });

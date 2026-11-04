import GzipRequestBodyMiddleware from "Common/Server/Middleware/GzipRequestBody";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import { parseInflatedJsonBody } from "../../FeatureSet/Telemetry/API/ProbeIngest/OpenStackCollection";
import { PassThrough } from "stream";
import zlib from "zlib";
import { describe, expect, jest, test } from "@jest/globals";

// Nothing here reaches the database, and the services take minutes to load on a busy machine.
jest.mock("Common/Server/Services/OpenStackCloudService", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/OpenStackCloudConnectionTestService", () => {
  return { __esModule: true, default: {} };
});

/*
 * A probe posts a collection gzip-compressed: several megabytes of metrics for a large cloud.
 * The server's own gzip reader, mounted for every route and before routing, inflates it under
 * its limits into a Buffer, and the collection route reads that Buffer as the report it is:
 * the two, end to end, on the bytes a probe sends. Nothing about the route has to name it.
 */

function gzipRequest(body: Buffer): ExpressRequest {
  const stream: PassThrough = new PassThrough();
  const req: ExpressRequest = stream as unknown as ExpressRequest;

  (req as unknown as { headers: Record<string, string> }).headers = {
    "content-encoding": "gzip",
    "content-type": "application/json",
    "content-length": String(body.length),
  };

  setImmediate(() => {
    stream.end(body);
  });

  return req;
}

function runMiddleware(
  middleware: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => void,
  req: ExpressRequest,
): Promise<unknown> {
  return new Promise<unknown>((resolve: (value: unknown) => void) => {
    middleware(
      req,
      {} as ExpressResponse,
      ((error?: unknown) => {
        resolve(error);
      }) as NextFunction,
    );
  });
}

describe("a gzip-compressed collection report", () => {
  test("arrives as the report the probe sent", async () => {
    const report: JSONObject = {
      probeKey: "probe-key",
      probeId: "11111111-1111-4111-8111-111111111111",
      openStackCloudId: "44444444-4444-4444-8444-444444444444",
      settingsVersion: 3,
      status: "Succeeded",
      durationInMs: 900,
      resourceMetrics: Array.from(
        { length: 2000 },
        (_value: unknown, index: number) => {
          return {
            resource: { attributes: [] },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "openstack_nova_server_status",
                    gauge: {
                      dataPoints: [
                        {
                          asDouble: 0,
                          attributes: [
                            {
                              key: "name",
                              value: { stringValue: `instance-${index}` },
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          };
        },
      ),
    };

    const json: Buffer = Buffer.from(JSON.stringify(report));
    const compressed: Buffer = zlib.gzipSync(json);

    // Metrics compress well: what travels is a fraction of the JSON.
    expect(compressed.length).toBeLessThan(json.length / 5);

    const req: ExpressRequest = gzipRequest(compressed);

    expect(
      await runMiddleware(GzipRequestBodyMiddleware.parseBody, req),
    ).toBeUndefined();

    expect(Buffer.isBuffer((req as unknown as { body: unknown }).body)).toBe(
      true,
    );

    expect(
      await runMiddleware(
        parseInflatedJsonBody as unknown as Parameters<typeof runMiddleware>[0],
        req,
      ),
    ).toBeUndefined();

    expect((req as unknown as { body: unknown }).body).toEqual(report);
  });
});

import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import {
  parseCollectionBody,
  readCollectionBody,
} from "../../FeatureSet/Telemetry/Middleware/ProbeCollectionRequest";
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
 * Nothing here checks a key: the key checks are ProbeCollectionKeyBeforeParse's.
 * An older probe's report opening is let through, and recorded as it arrived.
 */
const mockOpenings: Array<string> = [];

jest.mock("../../FeatureSet/Telemetry/Middleware/ProbeAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedFromReportOpening: async (data: {
        req: { probe?: unknown };
        opening: Uint8Array;
        next: (err?: unknown) => void;
      }): Promise<void> => {
        mockOpenings.push(Buffer.from(data.opening).toString("utf8"));
        data.req.probe = { id: "11111111-1111-4111-8111-111111111111" };
        data.next();
      },
    },
  };
});

/*
 * A probe posts a collection gzip-compressed: several megabytes of metrics for a large cloud.
 * The collection route reads it itself once it has checked the probe's key (#10222),
 * inflating it under its limits into a Buffer, and reads that Buffer as the report it is:
 * the two, end to end, on the bytes a probe sends.
 */

/*
 * The request a probe sends: its probe named by its headers already (`probe`),
 * or, for a probe from before them, by the start of its report alone.
 */
function gzipRequest(body: Buffer, probe?: { id: string }): ExpressRequest {
  const stream: PassThrough = new PassThrough();
  const req: ExpressRequest = stream as unknown as ExpressRequest;

  if (probe) {
    (req as unknown as { probe: { id: string } }).probe = probe;
  }

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

    for (const probe of [
      { id: "11111111-1111-4111-8111-111111111111" },
      undefined,
    ]) {
      mockOpenings.length = 0;

      const req: ExpressRequest = gzipRequest(compressed, probe);

      expect(await runMiddleware(readCollectionBody, req)).toBeUndefined();

      // An older probe's report has its opening checked first: its first 4 KiB.
      expect(mockOpenings).toEqual(
        probe ? [] : [json.subarray(0, 4096).toString("utf8")],
      );

      expect(Buffer.isBuffer((req as unknown as { body: unknown }).body)).toBe(
        true,
      );

      expect(
        await runMiddleware(
          parseCollectionBody as unknown as Parameters<typeof runMiddleware>[0],
          req,
        ),
      ).toBeUndefined();

      expect((req as unknown as { body: unknown }).body).toEqual(report);
    }
  });
});

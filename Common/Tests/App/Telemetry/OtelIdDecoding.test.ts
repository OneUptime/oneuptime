/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr)
 * at import time via the services' queue imports; nothing queue-related
 * is under test here, so the module is replaced — same idiom as
 * TelemetryQueueService.test.ts in this directory.
 */
jest.mock("../../../Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

import OtelTracesIngestService from "../../../../App/FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelProfilesIngestService from "../../../../App/FeatureSet/Telemetry/Services/OtelProfilesIngestService";
import OtelMetricsIngestService from "../../../../App/FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import { describe, expect, test } from "@jest/globals";

/*
 * OTLP id decoding must accept BOTH wire forms:
 *   - OTLP/JSON: 32-char (trace/profile) or 16-char (span) hex strings
 *   - OTLP/protobuf via protobuf decoders: base64 of the raw 16/8 bytes
 * Hex strings satisfy the base64 alphabet, so a naive base64 decode
 * turns them into garbage — which silently breaks log↔trace and
 * trace↔profile correlation. The traces and profiles services route ids
 * through a private convertBase64ToHexSafe (reached here via the same
 * cast idiom other suites use for private statics); the logs service
 * calls Text.convertOtlpIdToHex inline, which Common/Tests/Types/
 * Text.test.ts covers directly.
 */

type IdConverter = (value: string | undefined) => string;

const HEX_TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const HEX_SPAN_ID: string = "00f067aa0ba902b7";
const BASE64_TRACE_ID: string = Buffer.from(HEX_TRACE_ID, "hex").toString(
  "base64",
);
const BASE64_SPAN_ID: string = Buffer.from(HEX_SPAN_ID, "hex").toString(
  "base64",
);

describe("OTLP id decoding in telemetry ingest services", () => {
  const cases: Array<{ name: string; convert: IdConverter }> = [
    {
      name: "OtelTracesIngestService",
      convert: (
        OtelTracesIngestService as unknown as {
          convertBase64ToHexSafe: IdConverter;
        }
      ).convertBase64ToHexSafe.bind(OtelTracesIngestService),
    },
    {
      name: "OtelProfilesIngestService",
      convert: (
        OtelProfilesIngestService as unknown as {
          convertBase64ToHexSafe: IdConverter;
        }
      ).convertBase64ToHexSafe.bind(OtelProfilesIngestService),
    },
    {
      name: "OtelMetricsIngestService (exemplar ids)",
      convert: (
        OtelMetricsIngestService as unknown as {
          convertBase64ToHexSafe: IdConverter;
        }
      ).convertBase64ToHexSafe.bind(OtelMetricsIngestService),
    },
  ];

  for (const { name, convert } of cases) {
    describe(name, () => {
      test("passes OTLP/JSON hex ids through unchanged", () => {
        expect(convert(HEX_TRACE_ID)).toEqual(HEX_TRACE_ID);
        expect(convert(HEX_SPAN_ID)).toEqual(HEX_SPAN_ID);
      });

      test("decodes OTLP/protobuf base64 ids to hex", () => {
        expect(convert(BASE64_TRACE_ID)).toEqual(HEX_TRACE_ID);
        expect(convert(BASE64_SPAN_ID)).toEqual(HEX_SPAN_ID);
      });

      test("returns empty string for missing ids", () => {
        expect(convert(undefined)).toEqual("");
        expect(convert("")).toEqual("");
      });
    });
  }
});

import { describe, expect, test } from "@jest/globals";
import path from "path";
import { OTLP_PROTO_LOADER_OPTIONS } from "../../FeatureSet/Telemetry/GrpcServer";

/*
 * The Queue module (pulled in transitively through the per-signal queue
 * services GrpcServer imports) loads BullMQ / bull-board at import time;
 * nothing queue-side is under test here, so it is replaced with an inert
 * stub. Same stub as GrpcServerAuth.test.ts.
 */
/*
 * PasswordHash has a pre-existing TS5.9 ts-jest compile error (crypto
 * BinaryLike vs Buffer) and is pulled in transitively through the service
 * layer GrpcServer imports. Nothing password-related is under test here,
 * so the module is replaced WITH A FACTORY — an automock would still
 * require (and type-check) the real file. Same workaround as the other
 * suites in this directory.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Infrastructure/Queue", () => {
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

/*
 * Pins the shared proto-loader option set used for all four OTLP service
 * definitions. These options are load-bearing and cannot be covered by a
 * behavioral test:
 *
 * - `defaults: false` is the payload-lean guarantee — the workers were
 *   deliberately made tolerant of BOTH the defaulted and omitted shapes,
 *   so a revert to `defaults: true` would silently re-bloat every
 *   Redis-queued gRPC job while the whole suite stays green.
 * - `longs: String` protects uint64 timestamps (timeUnixNano ~1.7e18 >
 *   Number.MAX_SAFE_INTEGER): a Long object would JSON.stringify as
 *   {low, high, unsigned} and corrupt every trace/log/metric timestamp.
 * - `enums: String` / `keepCase: false` / `oneofs: true` keep the gRPC
 *   producer's output shape identical to protobufjs `.toJSON()` on the
 *   HTTP protobuf path, so worker code sees one shape regardless of
 *   producer.
 */
describe("GrpcServer OTLP proto-loader options", () => {
  test("pins the exact option values for all four service definitions", () => {
    expect(OTLP_PROTO_LOADER_OPTIONS).toEqual({
      keepCase: false,
      longs: String,
      enums: String,
      defaults: false,
      oneofs: true,
      includeDirs: [expect.any(String)],
    });
  });

  test("defaults stays false — the worker-visible lean-payload guarantee", () => {
    expect(OTLP_PROTO_LOADER_OPTIONS.defaults).toBe(false);
  });

  test("longs stays String — uint64 timeUnixNano must not become a Long object", () => {
    expect(OTLP_PROTO_LOADER_OPTIONS.longs).toBe(String);
  });

  test("includeDirs points at the bundled OTel v1 proto directory", () => {
    const includeDirs: Array<string> =
      OTLP_PROTO_LOADER_OPTIONS.includeDirs as Array<string>;

    expect(includeDirs).toHaveLength(1);
    expect(includeDirs[0]).toContain(path.join("ProtoFiles", "OTel", "v1"));
  });
});

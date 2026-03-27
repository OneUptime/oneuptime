import OtelProfilesIngestService from "../../Services/OtelProfilesIngestService";
import { JSONObject, JSONArray } from "Common/Types/JSON";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const service: any = OtelProfilesIngestService as any;

describe("OtelProfilesIngestService", () => {
  describe("resolveStackFrames", () => {
    const baseStringTable: Array<string> = [
      "", // 0 - empty
      "main", // 1
      "app.go", // 2
      "runtime.main", // 3
      "runtime/proc.go", // 4
      "handleRequest", // 5
      "server.go", // 6
      "kernel", // 7
      "native", // 8
      "go", // 9
    ];

    const baseFunctionTable: JSONArray = [
      { name: 1, systemName: 1, filename: 2, startLine: 10 }, // 0: main@app.go
      { name: 3, systemName: 3, filename: 4, startLine: 100 }, // 1: runtime.main@runtime/proc.go
      { name: 5, systemName: 5, filename: 6, startLine: 50 }, // 2: handleRequest@server.go
    ];

    const baseLocationTable: JSONArray = [
      {
        mappingIndex: 0,
        address: 4096,
        line: [{ functionIndex: 0, line: 15, column: 0 }],
        isFolded: false,
        typeIndex: 0,
        attributeIndices: [],
      }, // 0: main@app.go:15
      {
        mappingIndex: 0,
        address: 8192,
        line: [{ functionIndex: 1, line: 120, column: 0 }],
        isFolded: false,
        typeIndex: 0,
        attributeIndices: [],
      }, // 1: runtime.main@runtime/proc.go:120
      {
        mappingIndex: 0,
        address: 12288,
        line: [{ functionIndex: 2, line: 55, column: 0 }],
        isFolded: false,
        typeIndex: 0,
        attributeIndices: [],
      }, // 2: handleRequest@server.go:55
    ];

    const baseAttributeTable: JSONArray = [
      { key: "profile.frame.type", value: { stringValue: "go" } },
    ];

    test("resolves simple stack via stack_table", () => {
      const stackTable: JSONArray = [
        { locationIndices: [0, 1] }, // stack 0: main, runtime.main
      ];

      const sample: JSONObject = { stackIndex: 0 };

      const result: { frames: Array<string>; frameTypes: Array<string> } =
        service["resolveStackFrames"]({
          sample,
          stackTable,
          locationTable: baseLocationTable,
          functionTable: baseFunctionTable,
          stringTable: baseStringTable,
          attributeTable: baseAttributeTable,
        });

      expect(result.frames).toHaveLength(2);
      expect(result.frames[0]).toBe("main@app.go:15");
      expect(result.frames[1]).toBe("runtime.main@runtime/proc.go:120");
      expect(result.frameTypes[0]).toBe("go");
      expect(result.frameTypes[1]).toBe("go");
    });

    test("resolves stack with three frames", () => {
      const stackTable: JSONArray = [
        { locationIndices: [2, 0, 1] }, // handleRequest -> main -> runtime.main
      ];

      const sample: JSONObject = { stackIndex: 0 };

      const result: { frames: Array<string>; frameTypes: Array<string> } =
        service["resolveStackFrames"]({
          sample,
          stackTable,
          locationTable: baseLocationTable,
          functionTable: baseFunctionTable,
          stringTable: baseStringTable,
          attributeTable: baseAttributeTable,
        });

      expect(result.frames).toHaveLength(3);
      expect(result.frames[0]).toBe("handleRequest@server.go:55");
      expect(result.frames[1]).toBe("main@app.go:15");
      expect(result.frames[2]).toBe("runtime.main@runtime/proc.go:120");
    });

    test("handles inline frames (multiple lines per location)", () => {
      const locationTableWithInline: JSONArray = [
        {
          mappingIndex: 0,
          address: 4096,
          line: [
            { functionIndex: 0, line: 15, column: 0 }, // main@app.go:15
            { functionIndex: 2, line: 55, column: 0 }, // handleRequest@server.go:55 (inlined)
          ],
          isFolded: false,
          typeIndex: 0,
          attributeIndices: [],
        },
      ];

      const stackTable: JSONArray = [{ locationIndices: [0] }];

      const sample: JSONObject = { stackIndex: 0 };

      const result: { frames: Array<string>; frameTypes: Array<string> } =
        service["resolveStackFrames"]({
          sample,
          stackTable,
          locationTable: locationTableWithInline,
          functionTable: baseFunctionTable,
          stringTable: baseStringTable,
          attributeTable: baseAttributeTable,
        });

      // Inline frames should expand into separate frames
      expect(result.frames).toHaveLength(2);
      expect(result.frames[0]).toBe("main@app.go:15");
      expect(result.frames[1]).toBe("handleRequest@server.go:55");
    });

    test("handles location without line info (uses hex address)", () => {
      const locationTableNoLine: JSONArray = [
        {
          mappingIndex: 0,
          address: 65535,
          line: [],
          isFolded: false,
          typeIndex: 0,
          attributeIndices: [],
        },
      ];

      const stackTable: JSONArray = [{ locationIndices: [0] }];

      const sample: JSONObject = { stackIndex: 0 };

      const result: { frames: Array<string>; frameTypes: Array<string> } =
        service["resolveStackFrames"]({
          sample,
          stackTable,
          locationTable: locationTableNoLine,
          functionTable: baseFunctionTable,
          stringTable: baseStringTable,
          attributeTable: baseAttributeTable,
        });

      expect(result.frames).toHaveLength(1);
      expect(result.frames[0]).toBe("0xffff");
    });

    test("handles empty stack", () => {
      const stackTable: JSONArray = [{ locationIndices: [] }];

      const sample: JSONObject = { stackIndex: 0 };

      const result: { frames: Array<string>; frameTypes: Array<string> } =
        service["resolveStackFrames"]({
          sample,
          stackTable,
          locationTable: baseLocationTable,
          functionTable: baseFunctionTable,
          stringTable: baseStringTable,
          attributeTable: baseAttributeTable,
        });

      expect(result.frames).toHaveLength(0);
      expect(result.frameTypes).toHaveLength(0);
    });

    test("handles out-of-bounds location index gracefully", () => {
      const stackTable: JSONArray = [{ locationIndices: [999] }];

      const sample: JSONObject = { stackIndex: 0 };

      const result: { frames: Array<string>; frameTypes: Array<string> } =
        service["resolveStackFrames"]({
          sample,
          stackTable,
          locationTable: baseLocationTable,
          functionTable: baseFunctionTable,
          stringTable: baseStringTable,
          attributeTable: baseAttributeTable,
        });

      expect(result.frames).toHaveLength(1);
      expect(result.frames[0]).toBe("<unknown>");
      expect(result.frameTypes[0]).toBe("unknown");
    });

    test("falls back to locationsStartIndex/locationsLength when no stackIndex", () => {
      const sample: JSONObject = {
        locationsStartIndex: 0,
        locationsLength: 2,
      };

      const result: { frames: Array<string>; frameTypes: Array<string> } =
        service["resolveStackFrames"]({
          sample,
          stackTable: [],
          locationTable: baseLocationTable,
          functionTable: baseFunctionTable,
          stringTable: baseStringTable,
          attributeTable: baseAttributeTable,
        });

      expect(result.frames).toHaveLength(2);
      expect(result.frames[0]).toBe("main@app.go:15");
      expect(result.frames[1]).toBe("runtime.main@runtime/proc.go:120");
    });

    test("handles function without filename", () => {
      const stringTableNoFile: Array<string> = [
        "", // 0
        "anonymous", // 1
      ];

      const functionTableNoFile: JSONArray = [
        { name: 1, systemName: 1, filename: 0, startLine: 0 }, // anonymous (no file)
      ];

      const locationTableNoFile: JSONArray = [
        {
          mappingIndex: 0,
          address: 4096,
          line: [{ functionIndex: 0, line: 0, column: 0 }],
          isFolded: false,
          typeIndex: 0,
          attributeIndices: [],
        },
      ];

      const stackTable: JSONArray = [{ locationIndices: [0] }];
      const sample: JSONObject = { stackIndex: 0 };

      const result: { frames: Array<string>; frameTypes: Array<string> } =
        service["resolveStackFrames"]({
          sample,
          stackTable,
          locationTable: locationTableNoFile,
          functionTable: functionTableNoFile,
          stringTable: stringTableNoFile,
          attributeTable: [],
        });

      expect(result.frames).toHaveLength(1);
      // Should just be function name without file or line
      expect(result.frames[0]).toBe("anonymous");
    });
  });

  describe("safeParseUnixNano", () => {
    test("parses numeric value correctly", () => {
      const nanos: number = 1700000000000000000;
      const result: {
        unixNano: number;
        nano: string;
        iso: string;
        date: Date;
      } = service["safeParseUnixNano"](nanos, "test");

      expect(result.unixNano).toBe(nanos);
      expect(result.nano).toBe(nanos.toString());
      expect(result.date).toBeInstanceOf(Date);
    });

    test("parses string value correctly", () => {
      const nanos: string = "1700000000000000000";
      const result: {
        unixNano: number;
        nano: string;
        iso: string;
        date: Date;
      } = service["safeParseUnixNano"](nanos, "test");

      expect(result.unixNano).toBe(1700000000000000000);
      expect(result.date).toBeInstanceOf(Date);
    });

    test("falls back to current time for undefined", () => {
      const result: {
        unixNano: number;
        nano: string;
        iso: string;
        date: Date;
      } = service["safeParseUnixNano"](undefined, "test");

      expect(result.unixNano).toBeGreaterThan(0);
      expect(result.date).toBeInstanceOf(Date);
    });

    test("falls back to current time for NaN string", () => {
      const result: {
        unixNano: number;
        nano: string;
        iso: string;
        date: Date;
      } = service["safeParseUnixNano"]("not-a-number", "test");

      expect(result.unixNano).toBeGreaterThan(0);
      expect(result.date).toBeInstanceOf(Date);
    });

    test("falls back to current time for Infinity", () => {
      const result: {
        unixNano: number;
        nano: string;
        iso: string;
        date: Date;
      } = service["safeParseUnixNano"](Infinity, "test");

      expect(result.unixNano).toBeGreaterThan(0);
      expect(result.date).toBeInstanceOf(Date);
    });
  });

  describe("convertBase64ToHexSafe", () => {
    test("returns empty string for undefined", () => {
      const result: string = service["convertBase64ToHexSafe"](undefined);
      expect(result).toBe("");
    });

    test("returns empty string for empty string", () => {
      const result: string = service["convertBase64ToHexSafe"]("");
      expect(result).toBe("");
    });

    test("converts valid base64 to hex", () => {
      // "AQID" is base64 for bytes [1, 2, 3] which is hex "010203"
      const result: string = service["convertBase64ToHexSafe"]("AQID");
      expect(result).toBe("010203");
    });
  });

  describe("buildProfileRow", () => {
    test("builds profile row with all fields", () => {
      const row: JSONObject = service["buildProfileRow"]({
        projectId: {
          toString: () => {
            return "proj-123";
          },
        },
        serviceId: {
          toString: () => {
            return "svc-456";
          },
        },
        profileId: "profile-789",
        traceId: "trace-abc",
        spanId: "span-def",
        startTime: {
          unixNano: 1700000000000000000,
          nano: "1700000000000000000",
          iso: "2023-11-14T22:13:20.000Z",
          date: new Date("2023-11-14T22:13:20.000Z"),
        },
        endTime: {
          unixNano: 1700000001000000000,
          nano: "1700000001000000000",
          iso: "2023-11-14T22:13:21.000Z",
          date: new Date("2023-11-14T22:13:21.000Z"),
        },
        durationNano: 1000000000,
        profileType: "cpu",
        unit: "nanoseconds",
        periodType: "cpu",
        period: 10000000,
        attributes: { "resource.service.name": "my-service" },
        attributeKeys: ["resource.service.name"],
        sampleCount: 100,
        originalPayloadFormat: "pprofext",
        dataRetentionInDays: 15,
      });

      expect(row["projectId"]).toBe("proj-123");
      expect(row["serviceId"]).toBe("svc-456");
      expect(row["profileId"]).toBe("profile-789");
      expect(row["traceId"]).toBe("trace-abc");
      expect(row["spanId"]).toBe("span-def");
      expect(row["profileType"]).toBe("cpu");
      expect(row["unit"]).toBe("nanoseconds");
      expect(row["periodType"]).toBe("cpu");
      expect(row["sampleCount"]).toBe(100);
      expect(row["originalPayloadFormat"]).toBe("pprofext");
      expect(row["_id"]).toBeDefined();
      expect(row["retentionDate"]).toBeDefined();
    });
  });

  describe("buildSampleRow", () => {
    test("builds sample row with all fields", () => {
      const row: JSONObject = service["buildSampleRow"]({
        projectId: {
          toString: () => {
            return "proj-123";
          },
        },
        serviceId: {
          toString: () => {
            return "svc-456";
          },
        },
        profileId: "profile-789",
        traceId: "trace-abc",
        spanId: "span-def",
        time: {
          unixNano: 1700000000000000000,
          nano: "1700000000000000000",
          iso: "2023-11-14T22:13:20.000Z",
          date: new Date("2023-11-14T22:13:20.000Z"),
        },
        stacktrace: ["main@app.go:15", "runtime.main@runtime/proc.go:120"],
        stacktraceHash: "abc123",
        frameTypes: ["go", "go"],
        value: 50000,
        profileType: "cpu",
        labels: { "thread.name": "main" },
        dataRetentionInDays: 15,
      });

      expect(row["projectId"]).toBe("proj-123");
      expect(row["serviceId"]).toBe("svc-456");
      expect(row["profileId"]).toBe("profile-789");
      expect(row["traceId"]).toBe("trace-abc");
      expect(row["stacktrace"]).toEqual([
        "main@app.go:15",
        "runtime.main@runtime/proc.go:120",
      ]);
      expect(row["stacktraceHash"]).toBe("abc123");
      expect(row["frameTypes"]).toEqual(["go", "go"]);
      expect(row["value"]).toBe("50000");
      expect(row["profileType"]).toBe("cpu");
      expect(row["labels"]).toEqual({ "thread.name": "main" });
      expect(row["_id"]).toBeDefined();
      expect(row["retentionDate"]).toBeDefined();
    });
  });
});

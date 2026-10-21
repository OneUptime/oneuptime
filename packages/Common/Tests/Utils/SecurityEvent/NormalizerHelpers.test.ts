import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  ProcessFields,
  buildObservables,
  buildProcessFields,
  contentHashEventUid,
  fileNameOfPath,
  flattenPayload,
  joinPath,
  mergeProcessReadings,
  namesProcess,
  parseEventTime,
  readNumber,
  readString,
  readStringArray,
} from "../../../Utils/SecurityEvent/NormalizerHelpers";
import { fastestRun } from "../../Helpers/FastestRun";

/*
 * Every normalizer leans on these helpers for the parts that silently
 * corrupt data when they drift: `attributes` is a Map(String,String)
 * ClickHouse column so flattening must always produce scalar strings; UDM
 * nests entities inside arrays so path reads must tolerate arrays mid-path;
 * timestamps arrive in four different epoch scales and picking the wrong
 * one puts an event 50,000 years out; and the content-hash eventUid is the
 * dedupe key for sources that send no id — if it wobbles between deliveries
 * of the same payload, duplicates multiply. These tests pin each contract.
 */
describe("NormalizerHelpers", () => {
  describe("flattenPayload", () => {
    test("nested objects become dot-notation keys", () => {
      const payload: JSONObject = {
        metadata: { event_type: "USER_LOGIN", nested: { deep: "value" } },
      };

      expect(flattenPayload(payload)).toEqual({
        "metadata.event_type": "USER_LOGIN",
        "metadata.nested.deep": "value",
      });
    });

    test("scalar arrays collapse to a comma-joined string", () => {
      const payload: JSONObject = {
        ip: ["10.0.0.1", "10.0.0.2"],
        ports: [80, 443],
      };

      expect(flattenPayload(payload)).toEqual({
        ip: "10.0.0.1,10.0.0.2",
        ports: "80,443",
      });
    });

    test("arrays of objects recurse with the index in the key", () => {
      const payload: JSONObject = {
        security_result: [{ severity: "LOW" }, { severity: "HIGH" }],
      };

      expect(flattenPayload(payload)).toEqual({
        "security_result.0.severity": "LOW",
        "security_result.1.severity": "HIGH",
      });
    });

    test("mixed arrays recurse per element", () => {
      const payload: JSONObject = { mixed: ["scalar", { key: "value" }] };

      expect(flattenPayload(payload)).toEqual({
        "mixed.0": "scalar",
        "mixed.1.key": "value",
      });
    });

    test("objects past the depth cap fall back to JSON.stringify", () => {
      const payload: JSONObject = { a: { b: { c: "d" } } };

      expect(flattenPayload(payload, 2)).toEqual({
        "a.b": JSON.stringify({ c: "d" }),
      });
    });

    test("null, undefined, empty arrays and empty objects emit nothing", () => {
      const payload: JSONObject = {
        gone: null,
        missing: undefined,
        emptyList: [],
        emptyObject: {},
        kept: "value",
      };

      expect(flattenPayload(payload)).toEqual({ kept: "value" });
    });

    test("scalars stringify", () => {
      const payload: JSONObject = { count: 42, active: true, label: "x" };

      expect(flattenPayload(payload)).toEqual({
        count: "42",
        active: "true",
        label: "x",
      });
    });
  });

  describe("readString", () => {
    test("reads a nested scalar by dot path", () => {
      const payload: JSONObject = { metadata: { id: "evt-1" } };

      expect(readString(payload, "metadata.id")).toBe("evt-1");
    });

    test("arrays along the path take the first element", () => {
      const payload: JSONObject = {
        security_result: [{ severity: "LOW" }, { severity: "HIGH" }],
      };

      expect(readString(payload, "security_result.severity")).toBe("LOW");
    });

    test("an array value returns its first scalar", () => {
      const payload: JSONObject = { ip: ["10.0.0.1", "10.0.0.2"] };

      expect(readString(payload, "ip")).toBe("10.0.0.1");
    });

    test("missing path, object value and null all read as empty string", () => {
      const payload: JSONObject = {
        metadata: { nested: { x: "y" } },
        gone: null,
      };

      expect(readString(payload, "does.not.exist")).toBe("");
      expect(readString(payload, "metadata.nested")).toBe("");
      expect(readString(payload, "gone")).toBe("");
    });

    test("numbers stringify", () => {
      const payload: JSONObject = { target: { port: 443 } };

      expect(readString(payload, "target.port")).toBe("443");
    });
  });

  describe("readNumber", () => {
    test("reads numbers and numeric strings", () => {
      const payload: JSONObject = { a: 42, b: "42", c: "4.5" };

      expect(readNumber(payload, "a")).toBe(42);
      expect(readNumber(payload, "b")).toBe(42);
      expect(readNumber(payload, "c")).toBe(4.5);
    });

    test("missing paths and non-numeric values -> null", () => {
      const payload: JSONObject = { a: "abc", b: "", c: true };

      expect(readNumber(payload, "a")).toBeNull();
      expect(readNumber(payload, "b")).toBeNull();
      expect(readNumber(payload, "c")).toBeNull();
      expect(readNumber(payload, "missing")).toBeNull();
    });
  });

  describe("readStringArray", () => {
    test("keeps scalars, drops objects and nulls, stringifies the rest", () => {
      const payload: JSONObject = { list: ["x", 1, null, { o: 1 }, true] };

      expect(readStringArray(payload, "list")).toEqual(["x", "1", "true"]);
    });

    test("a lone scalar wraps into a one-element array", () => {
      const payload: JSONObject = { host: "web-1" };

      expect(readStringArray(payload, "host")).toEqual(["web-1"]);
    });

    test("arrays along the path take the first element", () => {
      const payload: JSONObject = { a: [{ b: ["x", "y"] }, { b: ["z"] }] };

      expect(readStringArray(payload, "a.b")).toEqual(["x", "y"]);
    });

    test("missing path -> empty array", () => {
      expect(readStringArray({}, "nope")).toEqual([]);
    });
  });

  describe("parseEventTime", () => {
    // 2024-05-01T12:00:00Z in every scale the dialects use.
    const expectedMillis: number = 1714564800000;

    test("RFC3339 string", () => {
      expect(parseEventTime("2024-05-01T12:00:00Z")?.getTime()).toBe(
        expectedMillis,
      );
    });

    test("epoch seconds", () => {
      expect(parseEventTime(1714564800)?.getTime()).toBe(expectedMillis);
    });

    test("epoch millis", () => {
      expect(parseEventTime(1714564800000)?.getTime()).toBe(expectedMillis);
    });

    test("epoch micros", () => {
      expect(parseEventTime(1714564800000000)?.getTime()).toBe(expectedMillis);
    });

    test("epoch nanos", () => {
      expect(parseEventTime(1714564800000000000)?.getTime()).toBe(
        expectedMillis,
      );
    });

    test("numeric string routes through the epoch-scale logic", () => {
      expect(parseEventTime("1714564800")?.getTime()).toBe(expectedMillis);
    });

    test.each<[string]>([["garbage"], ["not a date"]])(
      "garbage string %s -> null",
      (input: string) => {
        expect(parseEventTime(input)).toBeNull();
      },
    );

    test("null, empty, zero and negative values -> null", () => {
      expect(parseEventTime(null)).toBeNull();
      expect(parseEventTime(undefined)).toBeNull();
      expect(parseEventTime("")).toBeNull();
      expect(parseEventTime("   ")).toBeNull();
      expect(parseEventTime(0)).toBeNull();
      expect(parseEventTime(-1714564800)).toBeNull();
    });
  });

  describe("buildObservables", () => {
    test("dedupes case-insensitively but keeps the first casing", () => {
      expect(buildObservables(["Alice", "alice", "ALICE", "bob"])).toEqual([
        "Alice",
        "bob",
      ]);
    });

    test("drops empties and trims whitespace", () => {
      expect(
        buildObservables(["", "  ", undefined, " host-1 ", "10.0.0.1"]),
      ).toEqual(["host-1", "10.0.0.1"]);
    });

    test("preserves input order", () => {
      expect(buildObservables(["b", "a", "c", "a"])).toEqual(["b", "a", "c"]);
    });
  });

  describe("contentHashEventUid", () => {
    test("same payload -> same uid with the sha256: prefix", () => {
      const payload: JSONObject = { metadata: { event_type: "USER_LOGIN" } };

      const first: string = contentHashEventUid(payload);
      const second: string = contentHashEventUid({
        metadata: { event_type: "USER_LOGIN" },
      });

      expect(first).toBe(second);
      expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    test("key order does not change the uid", () => {
      expect(contentHashEventUid({ a: "1", b: "2" })).toBe(
        contentHashEventUid({ b: "2", a: "1" }),
      );
    });

    test("different payloads -> different uids", () => {
      expect(contentHashEventUid({ a: "1" })).not.toBe(
        contentHashEventUid({ a: "2" }),
      );
    });
  });
});

/*
 * The process an event is about and its parent arrive as whatever a source
 * names: a file name, a full path, a folder and a file name, a command line,
 * or several readings of one process. These helpers turn that into the six
 * fields Sigma's Image, CommandLine, ParentImage and ParentCommandLine read.
 */
describe("process fields", () => {
  describe("fileNameOfPath", () => {
    test.each([
      ["C:\\Windows\\System32\\cmd.exe", "cmd.exe"],
      ["/usr/bin/cat", "cat"],
      ["\\Device\\HarddiskVolume3\\Windows\\explorer.exe", "explorer.exe"],
      ["C:/tools/x.exe", "x.exe"],
      ["/usr/bin/", "bin"],
      ["  /usr/sbin/sshd  ", "sshd"],
      ["powershell.exe", "powershell.exe"],
      ["", ""],
    ])("%j -> %j", (path: string, name: string) => {
      expect(fileNameOfPath(path)).toBe(name);
    });

    test("reads a path of any length in time in line with it", () => {
      const path: string = `${"\\".repeat(500000)}x${"/".repeat(500000)}`;

      const run: { result: string; inMs: number } = fastestRun({
        run: (): string => {
          return fileNameOfPath(path);
        },
        limitInMs: 2000,
      });

      expect(run.result).toBe("x");
      expect(run.inMs).toBeLessThan(2000);
    });
  });

  describe("joinPath", () => {
    test("joins a Windows folder with a backslash, a Unix one with a slash", () => {
      expect(joinPath("C:\\Windows\\System32", "cmd.exe")).toBe(
        "C:\\Windows\\System32\\cmd.exe",
      );
      expect(joinPath("/usr/bin", "cat")).toBe("/usr/bin/cat");
      expect(joinPath("C:", "boot.ini")).toBe("C:\\boot.ini");
    });

    test("adds no second separator, and takes a folder that is already the path", () => {
      expect(joinPath("/usr/bin/", "cat")).toBe("/usr/bin/cat");
      expect(joinPath("C:\\Temp\\", "a.exe")).toBe("C:\\Temp\\a.exe");
      expect(joinPath("C:\\Temp\\A.EXE", "a.exe")).toBe("C:\\Temp\\A.EXE");
    });

    test("is no path without both a folder and a name", () => {
      expect(joinPath("", "cmd.exe")).toBe("");
      expect(joinPath("C:\\Windows", "")).toBe("");
    });
  });

  describe("namesProcess", () => {
    test("any of a name, a path or a command line names a process; a pid alone does not", () => {
      expect(namesProcess({ name: "cmd.exe" })).toBe(true);
      expect(namesProcess({ path: "/usr/bin/cat" })).toBe(true);
      expect(namesProcess({ commandLine: "cat /etc/hosts" })).toBe(true);
      expect(namesProcess({ name: "  ", path: "", commandLine: "" })).toBe(
        false,
      );
      expect(namesProcess(undefined)).toBe(false);
    });
  });

  describe("mergeProcessReadings", () => {
    test("one process read twice: the first reading's fields first, the gaps from the second", () => {
      expect(
        mergeProcessReadings(
          { name: "explorer.exe" },
          {
            name: "Explorer.EXE",
            path: "C:\\Windows\\explorer.exe",
            commandLine: "C:\\Windows\\Explorer.EXE",
          },
        ),
      ).toEqual({
        name: "explorer.exe",
        path: "C:\\Windows\\explorer.exe",
        commandLine: "C:\\Windows\\Explorer.EXE",
      });
    });

    test("a reading that names no process takes the other whole", () => {
      expect(
        mergeProcessReadings({}, { name: "bash", commandLine: "-bash" }),
      ).toEqual({ name: "bash", path: undefined, commandLine: "-bash" });
      expect(
        mergeProcessReadings({ path: "/usr/bin/sudo" }, undefined),
      ).toEqual({
        name: undefined,
        path: "/usr/bin/sudo",
        commandLine: undefined,
      });
    });

    test("two readings that name different processes are never mixed", () => {
      expect(
        mergeProcessReadings(
          { name: "cmd.exe" },
          { path: "C:\\Windows\\explorer.exe", commandLine: "explorer.exe" },
        ),
      ).toEqual({ name: "cmd.exe" });
    });
  });

  describe("buildProcessFields", () => {
    test("the process and its parent, trimmed", () => {
      expect(
        buildProcessFields({
          process: {
            name: " powershell.exe ",
            path: "C:\\Windows\\powershell.exe",
            commandLine: " powershell.exe -enc JAB ",
          },
          parent: { name: "winword.exe", commandLine: "winword.exe /n" },
        }),
      ).toEqual({
        processName: "powershell.exe",
        processPath: "C:\\Windows\\powershell.exe",
        processCommandLine: "powershell.exe -enc JAB",
        parentProcessName: "winword.exe",
        parentProcessPath: "",
        parentProcessCommandLine: "winword.exe /n",
      } satisfies ProcessFields);
    });

    test("a process named only by its path is named by the path's file name", () => {
      const fields: ProcessFields = buildProcessFields({
        process: { path: "/usr/bin/curl" },
        parent: { path: "C:\\Windows\\System32\\cmd.exe" },
      });

      expect(fields.processName).toBe("curl");
      expect(fields.parentProcessName).toBe("cmd.exe");
    });

    test("nothing said is six empty fields", () => {
      expect(buildProcessFields({})).toEqual({
        processName: "",
        processPath: "",
        processCommandLine: "",
        parentProcessName: "",
        parentProcessPath: "",
        parentProcessCommandLine: "",
      });
    });
  });
});

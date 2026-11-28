import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The simulator's recordings (Examples/snmp-simulator/data/<device>/*.snmprec)
 * are served by snmpsim as written, and the probe's end-to-end tests serve
 * the SAN switches' through a test agent (Probe/Tests/TestingUtils/
 * RecordedSnmpAgent). snmpsim answers GETNEXT by position in the file, so a
 * record out of order makes a walk skip or repeat part of the device: every
 * file holds one `OID|type|value` record a line, in ascending OID order, with
 * no comments, and a type snmpsim knows.
 */

const REPO_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..", "..");
const DATA_DIR: string = path.join(
  REPO_ROOT,
  "Examples",
  "snmp-simulator",
  "data",
);

// Integer, OctetString (and its hex form), OID, IpAddress, the counters, TimeTicks.
const TYPE: RegExp = /^(2|4|4x|6|64|65|66|67|70)(:numeric)?$/;
const OID: RegExp = /^\d+(\.\d+)+$/;

interface Recording {
  file: string;
  lines: Array<string>;
}

function recordings(): Array<Recording> {
  const found: Array<Recording> = [];

  for (const device of fs.readdirSync(DATA_DIR)) {
    const directory: string = path.join(DATA_DIR, device);

    if (!fs.statSync(directory).isDirectory()) {
      continue;
    }

    for (const file of fs.readdirSync(directory)) {
      if (file.endsWith(".snmprec")) {
        found.push({
          file: `${device}/${file}`,
          lines: fs
            .readFileSync(path.join(directory, file), "utf8")
            .split("\n")
            .filter((line: string) => {
              return line.length > 0;
            }),
        });
      }
    }
  }

  return found;
}

function compareOids(a: string, b: string): number {
  const left: Array<number> = a.split(".").map(Number);
  const right: Array<number> = b.split(".").map(Number);

  for (
    let index: number = 0;
    index < Math.min(left.length, right.length);
    index++
  ) {
    if (left[index] !== right[index]) {
      return left[index]! - right[index]!;
    }
  }

  return left.length - right.length;
}

const ALL: Array<Recording> = recordings();

describe("the simulator's recordings", () => {
  test("include the SAN switches: Brocade's default and FID 20 logical switches, and the MDS", () => {
    expect(
      ALL.map((recording: Recording) => {
        return recording.file;
      }),
    ).toEqual(
      expect.arrayContaining([
        "brocade-g620/public.snmprec",
        "brocade-g620/fid20.snmprec",
        "cisco-mds/public.snmprec",
      ]),
    );
  });

  test.each(
    ALL.map((recording: Recording): [string, Recording] => {
      return [recording.file, recording];
    }),
  )(
    "%s: one record a line, a type snmpsim knows, OIDs ascending and unique",
    (_file: string, recording: Recording) => {
      let previous: string | undefined = undefined;

      for (const line of recording.lines) {
        const [oid, type] = line.split("|") as [string, string | undefined];

        expect({ line, oid: OID.test(oid) }).toEqual({ line, oid: true });
        expect({ line, type: TYPE.test(type || "") }).toEqual({
          line,
          type: true,
        });
        expect(line.split("|").length).toBeGreaterThanOrEqual(3);

        if (previous !== undefined) {
          expect({ line, ascending: compareOids(previous, oid) < 0 }).toEqual({
            line,
            ascending: true,
          });
        }

        previous = oid;
      }
    },
  );

  test("every Fabric OS recording is a switch the Brocade pack is for", () => {
    for (const file of [
      "brocade-g620/public.snmprec",
      "brocade-g620/fid20.snmprec",
    ]) {
      const recording: Recording | undefined = ALL.find(
        (candidate: Recording) => {
          return candidate.file === file;
        },
      );

      expect(recording?.lines).toContain(
        "1.3.6.1.2.1.1.2.0|6|1.3.6.1.4.1.1588.2.1.1.1",
      );
    }
  });

  test("the MDS recording is an MDS 9396S by its chassis sysObjectID", () => {
    const mds: Recording | undefined = ALL.find((candidate: Recording) => {
      return candidate.file === "cisco-mds/public.snmprec";
    });

    expect(mds?.lines).toContain(
      "1.3.6.1.2.1.1.2.0|6|1.3.6.1.4.1.9.12.3.1.3.1660",
    );
  });
});

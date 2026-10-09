import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { resolve } from "path";

/*
 * Packet captures run tcpdump, so every probe image carries it - the
 * operator turns captures on with PROBE_PACKET_CAPTURE_ENABLED, without
 * installing anything. It is a runtime package: the production image's
 * purge of the build toolchain must leave it, and it is given no setuid
 * bit or file capability of its own - the container's NET_RAW is the only
 * privilege a capture has, and the docs say how to grant it.
 */

const probeRoot: string = resolve(__dirname, "../..");
const dockerfile: string = readFileSync(
  resolve(probeRoot, "Dockerfile.tpl"),
  "utf8",
);

const COMMENT_LINE: RegExp = /^\s*#/;
const CONTINUATION: RegExp = /\\\n/g;
const SPACES: RegExp = /\s+/g;

// RUN instructions, comments dropped and continuations joined.
function runInstructions(text: string): Array<string> {
  return text
    .split("\n")
    .filter((line: string): boolean => {
      return !COMMENT_LINE.test(line);
    })
    .join("\n")
    .replace(CONTINUATION, " ")
    .split("\n")
    .map((line: string): string => {
      return line.trim().replace(SPACES, " ");
    })
    .filter((line: string): boolean => {
      return line.startsWith("RUN ");
    });
}

const runs: Array<string> = runInstructions(dockerfile);

describe("the probe image and packet capture", () => {
  test("installs tcpdump with the other runtime tools, in every image", () => {
    const install: string | undefined = runs.find((line: string): boolean => {
      return line.includes("apt-get install") && line.includes("traceroute");
    });

    expect(install).toBeDefined();
    expect(install!.split(" ")).toContain("tcpdump");

    // Before the development/production split, so both images have it.
    expect(dockerfile.indexOf("tcpdump")).toBeLessThan(
      dockerfile.indexOf('{{ if eq .Env.ENVIRONMENT "development" }}'),
    );
  });

  test("the production image's toolchain purge leaves it", () => {
    for (const line of runs) {
      if (!line.includes("apt-get purge")) {
        continue;
      }

      const purged: Array<string> = line
        .slice(line.indexOf("apt-get purge"))
        .split("&&")[0]!
        .split(" ");

      expect(purged).not.toContain("tcpdump");
      expect(purged).not.toContain("libpcap0.8");
    }
  });

  test("gives tcpdump no privilege of its own: no setuid, no file capability", () => {
    expect(dockerfile).not.toMatch(/setcap[^\n]*tcpdump/);
    expect(dockerfile).not.toMatch(/chmod[^\n]*\+s[^\n]*tcpdump/);
    expect(dockerfile).not.toMatch(/chmod[^\n]*u\+s/);
  });

  test("says why it is there", () => {
    expect(dockerfile).toContain(
      "#   - tcpdump: packet captures started from the dashboard",
    );
  });
});

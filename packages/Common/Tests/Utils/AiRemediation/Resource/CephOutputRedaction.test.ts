import {
  GENERIC_REDACTED_MARKER,
  GenericOutputRedactor,
  ShieldedOutput,
  redactResourceCommandOutput,
  redactResourceCommandOutputWithCount,
  shieldCephStatusDataSection,
} from "../../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the ceph kit's output redaction:
 *
 * - `ceph status` / `ceph -s` in its plain format calls its usage section
 *   "data:". The generic rules (kubectl's) read a "data:" block as a
 *   Kubernetes Secret's and would mask all of it; for exactly ceph's shape
 *   the section is shielded from that one rule, and every line in it still
 *   gets the generic per-line rules.
 * - Any other shape — an unknown key in the section, no cluster/fsid
 *   header, another program — is masked exactly as before.
 * - cephx keys are masked wherever they appear.
 */

// What ceph 19.2.3 printed for `ceph -s` (a blank separator line is " ").
const CEPH_STATUS: string = [
  "  cluster:",
  "    id:     e8fbdea0-d86b-4173-b675-a3eb7337179d",
  "    health: HEALTH_WARN",
  "            1 osds down",
  "            Degraded data redundancy: 12/345 objects degraded (3.478%), 5 pgs degraded",
  " ",
  "  services:",
  "    mon: 3 daemons, quorum a,b,c (age 30m)",
  "    mgr: x(active, since 24m), standbys: y",
  "    osd: 12 osds: 11 up (since 2m), 12 in (since 3d)",
  " ",
  "  data:",
  "    volumes: 1/1 healthy",
  "    pools:   4 pools, 97 pgs",
  "    objects: 115 objects, 453 MiB",
  "    usage:   1.4 GiB used, 299 GiB / 300 GiB avail",
  "    pgs:     12/345 objects degraded (3.478%)",
  "             85 active+clean",
  "             12 active+undersized+degraded",
  " ",
  "  io:",
  "    client:   1.2 KiB/s rd, 3 op/s rd, 0 op/s wr",
  " ",
].join("\n");

function redactCeph(text: string): string {
  return redactResourceCommandOutput({
    resourceType: AiResourceType.CephCluster,
    program: "ceph",
    text,
  });
}

describe("ceph status keeps its usage section", () => {
  test("the whole status passes through unchanged", () => {
    expect(redactCeph(CEPH_STATUS)).toBe(CEPH_STATUS);
    expect(
      redactResourceCommandOutputWithCount({
        resourceType: AiResourceType.CephCluster,
        program: "ceph",
        text: CEPH_STATUS,
      }).redactionCount,
    ).toBe(0);
  });

  test("without the shield the generic rules would mask it (the bug this guards)", () => {
    const generic: string = GenericOutputRedactor.redact(CEPH_STATUS).text;

    expect(generic).not.toContain("4 pools, 97 pgs");
    expect(generic).toContain(GENERIC_REDACTED_MARKER);
  });

  test("a status without volumes, a fresh cluster's, and CRLF line endings", () => {
    const fresh: string = CEPH_STATUS.split("\n")
      .filter((line: string): boolean => {
        return !line.includes("volumes:");
      })
      .join("\n");

    expect(redactCeph(fresh)).toBe(fresh);

    // The generic rules normalize CRLF to LF; the section survives either way.
    const crlf: string = CEPH_STATUS.split("\n").join("\r\n");
    expect(redactCeph(crlf)).toBe(CEPH_STATUS);
  });

  test("the lines inside still get the generic per-line rules", () => {
    const withSecret: string = CEPH_STATUS.replace(
      "    usage:   1.4 GiB used, 299 GiB / 300 GiB avail",
      "    usage:   1.4 GiB used password=hunter2 token=abcdef0123456789abcdef",
    ).replace(
      "    objects: 115 objects, 453 MiB",
      "    objects: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    );

    const redacted: string = redactCeph(withSecret);

    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("abcdef0123456789abcdef");
    expect(redacted).not.toContain("eyJzdWIiOiIxMjM0NTY3ODkwIn0");
    expect(redacted).toContain("    pools:   4 pools, 97 pgs");
    expect(redacted).toContain("  data:");
  });

  test("a cephx key anywhere in it is still masked", () => {
    const withKey: string = CEPH_STATUS.replace(
      "            1 osds down",
      "            1 osds down AQAwjrtqK5MvFxAA37KrFISvJt/1Kqk3QP9GSA==",
    );

    const redacted: string = redactCeph(withKey);

    expect(redacted).not.toContain("AQAwjrtqK5MvFxAA37KrFISvJt");
    expect(redacted).toContain("    pools:   4 pools, 97 pgs");
  });
});

describe("any other shape is masked exactly as before", () => {
  test.each([
    [
      "an unknown key in the section",
      CEPH_STATUS.replace("    volumes: 1/1 healthy", "    token: abc123"),
    ],
    [
      "a line without a key in the section",
      CEPH_STATUS.replace("    volumes: 1/1 healthy", "    something odd"),
    ],
    ["no cluster header", CEPH_STATUS.replace("  cluster:", "  clusters:")],
    [
      "no fsid line under it",
      CEPH_STATUS.replace(
        "    id:     e8fbdea0-d86b-4173-b675-a3eb7337179d",
        "    id:     not-an-fsid",
      ),
    ],
    [
      "no services section before it",
      CEPH_STATUS.replace("  services:", "  service:"),
    ],
    [
      "an empty section",
      CEPH_STATUS.replace(/ {2}data:\n(?: {4}.*\n| {13}.*\n)+/, "  data:\n"),
    ],
    [
      "output that already holds the placeholder",
      `${CEPH_STATUS}\n  ceph-status-usage-section: x`,
    ],
    [
      "a Kubernetes Secret",
      "apiVersion: v1\nkind: Secret\ndata:\n  password: aHVudGVyMg==\n",
    ],
  ])("%s", (_name: string, text: string) => {
    expect(redactCeph(text)).toBe(GenericOutputRedactor.redact(text).text);
  });

  test.each([["docker"], ["pvesh"], ["govc"], ["systemctl"], ["db"]])(
    "%s output of the same shape",
    (program: string) => {
      const redacted: string = redactResourceCommandOutput({
        resourceType: AiResourceType.CephCluster,
        program,
        text: CEPH_STATUS,
      });

      expect(redacted).not.toContain("4 pools, 97 pgs");
    },
  );
});

describe("shieldCephStatusDataSection", () => {
  test("renames only the section header, and restores it", () => {
    const shield: ShieldedOutput | null =
      shieldCephStatusDataSection(CEPH_STATUS);

    expect(shield).not.toBeNull();
    expect(shield!.text).not.toContain("\n  data:\n");
    expect(shield!.text).toContain("\n  ceph-status-usage-section:\n");
    expect(shield!.text.replace("ceph-status-usage-section:", "data:")).toBe(
      CEPH_STATUS,
    );
    expect(shield!.restore(shield!.text)).toBe(CEPH_STATUS);
  });

  test.each([
    [""],
    ["HEALTH_OK"],
    ['{"fsid":"e8fbdea0-d86b-4173-b675-a3eb7337179d","health":{}}'],
    [CEPH_STATUS.replace("  data:", "  data: inline")],
  ])("nothing to shield in %p", (text: string) => {
    expect(shieldCephStatusDataSection(text)).toBeNull();
  });

  test("anything that is not text", () => {
    expect(shieldCephStatusDataSection(undefined as unknown as string)).toBe(
      null,
    );
  });
});

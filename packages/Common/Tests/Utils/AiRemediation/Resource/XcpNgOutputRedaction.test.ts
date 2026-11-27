import {
  RESOURCE_REDACTED_MARKER,
  getResourceOutputRedactionHooks,
  maskXenOrchestraSecrets,
  redactResourceCommandOutput,
  redactResourceCommandOutputWithCount,
} from "../../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * Contract under test - what reaches OneUptime AI of Xen Orchestra's REST
 * answers, as the XCP-ng AI agent prints them (indented JSON, one pair to a
 * line): no password, key or token survives, and the facts an
 * investigation needs (names, states, UUIDs, addresses, sizes) do.
 *
 * The answers are Xen Orchestra's own shapes, from @xen-orchestra/rest-api
 * 0.42.0's OpenAPI examples (pbd, vm, pool, task, backup-log), with the
 * secrets a customer's pool really holds put where Xen Orchestra keeps
 * them: a CIFS repository's password and an iSCSI target's CHAP secrets in
 * a PBD's device_config, a cloud-init payload in a VM's xenStoreData, an
 * SDN controller's pre-shared key in a network's other_config, a token in
 * a task's arguments, storage credentials in a backup log's error.
 */

const XO_TOKEN: string = "LB_DqCNhcmAoyiioNnajySHIYHrWfsIhYSYn3n8FfJA";
const OTHER_XO_TOKEN: string = "fhIUz8AtMLndzMd3ksfoTpHb0tWyKHmT6-M3o_hUbRg";

function redact(text: string): string {
  return redactResourceCommandOutput({
    resourceType: AiResourceType.XcpNgPool,
    program: "xo-cli",
    text,
  });
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

describe("the hook", () => {
  test("is xo-cli's", () => {
    expect(getResourceOutputRedactionHooks("xo-cli")).toEqual([
      maskXenOrchestraSecrets,
    ]);
  });

  test("leaves an answer without secrets exactly as it was", () => {
    const answer: string = pretty([
      {
        name_label: "web-01",
        power_state: "Running",
        uuid: "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
        $pool: "b7569d99-30f8-178a-7d94-801de3e29b5b",
        $container: "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d",
        _xapiRef: "OpaqueRef:ffdf8863-5331-9394-5c1b-d1db7de20a76",
        mainIpAddress: "10.0.0.21",
        memory: { size: 4294967296 },
        tags: ["production", "web"],
        href: "/rest/v0/vms/e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
      },
    ]);

    expect(redact(answer)).toBe(answer);
    expect(
      redactResourceCommandOutputWithCount({
        resourceType: AiResourceType.XcpNgPool,
        program: "xo-cli",
        text: answer,
      }).redactionCount,
    ).toBe(0);
  });

  test("anything that is not text comes back empty", () => {
    expect(
      redactResourceCommandOutput({
        resourceType: AiResourceType.XcpNgPool,
        program: "xo-cli",
        text: undefined as unknown as string,
      }),
    ).toBe("");
  });
});

describe("a PBD's device_config", () => {
  const cifs: string = pretty({
    type: "PBD",
    attached: false,
    host: "4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7",
    SR: "1d2c3b4a-5e6f-4789-9abc-def012345678",
    device_config: {
      server: "//nas01.example.lan/vmstore",
      username: "xcp-storage",
      password: "Sup3r-S3cret!",
      vers: "3.0",
    },
    otherConfig: {},
    id: "16b2a60f-7c4d-f45f-7c7a-963b06fc587d",
    $pool: "b7569d99-30f8-178a-7d94-801de3e29b5b",
  });

  const iscsi: string = pretty({
    type: "PBD",
    attached: true,
    device_config: {
      target: "10.0.5.20",
      targetIQN: "iqn.2026-01.lan.example:storage.target01",
      SCSIid: "36001405a7b8c9d0e1f2a3b4c5d6e7f80",
      chapuser: "xcp",
      chappassword: "chap-Secret-123",
      incoming_chapuser: "array",
      incoming_chappassword: "Mutual-Chap-456",
      chappassword_secret: "5a7b9c1d-3e5f-4a7b-9c1d-3e5f7a9b1c3d",
    },
  });

  test("a CIFS repository's password is masked, and where it is kept stays readable", () => {
    const out: string = redact(cifs);

    expect(out).not.toContain("Sup3r-S3cret!");
    expect(out).toContain("//nas01.example.lan/vmstore");
    expect(out).toContain('"username": "xcp-storage"');
    expect(out).toContain('"attached": false');
    expect(out).toContain("4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7");
  });

  test("an iSCSI target's CHAP secrets are masked, its address and IQN are not", () => {
    const out: string = redact(iscsi);

    expect(out).not.toContain("chap-Secret-123");
    expect(out).not.toContain("Mutual-Chap-456");
    expect(out).not.toContain("5a7b9c1d-3e5f-4a7b-9c1d-3e5f7a9b1c3d");
    expect(out).toContain("10.0.5.20");
    expect(out).toContain("iqn.2026-01.lan.example:storage.target01");
  });

  test("compact JSON is masked too", () => {
    const out: string = redact(JSON.stringify(JSON.parse(cifs)));

    expect(out).not.toContain("Sup3r-S3cret!");
  });
});

describe("a VM's xenStoreData, other config and boot arguments", () => {
  const vm: string = pretty({
    type: "VM",
    name_label: "app-02",
    power_state: "Halted",
    PV_args:
      "graphical utf8 -- passwd=Hunter2Root ks=http://deploy:Kick4rt@10.0.0.9/ks.cfg",
    other: {
      base_template_name: "Debian Bookworm 12",
      "install-repository": "http://mirror:M1rr0rPass@deb.example.lan/debian",
      mac_seed: "ebcb83b9-b96d-6341-931c-9d5105656bf2",
      "xo:f07ab729":
        '{"creation":{"date":"2024-12-18T15:08:43.142Z"},"password":"InJs0n"}',
    },
    xenStoreData: {
      "vm-data/mmio-hole-size": "268435456",
      "vm-data/user-data":
        "#cloud-config\nchpasswd:\n  list: |\n    root:CloudInitRoot1\n",
      "vm-data/root-password": "XenStoreRoot2",
      "vm-data/ssh-key":
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl",
      "vm-data/vendor-data": "vendor-secret-blob",
      "vm-data/network-config": "wifi: { psk: W1f1Secret }",
    },
    bios_strings: {
      "oem-2": "MS_VM_CERT/SHA1/bdbeb6e0a816d43fa6d3fe8aaef04c2bad9d3e3d",
      "system-serial-number": "",
    },
  });

  test("nothing a VM's owner put there survives", () => {
    const out: string = redact(vm);

    for (const secret of [
      "Hunter2Root",
      "Kick4rt",
      "M1rr0rPass",
      "InJs0n",
      "CloudInitRoot1",
      "XenStoreRoot2",
      "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl",
      "vendor-secret-blob",
      "W1f1Secret",
    ]) {
      expect({ secret, leaked: out.includes(secret) }).toEqual({
        secret,
        leaked: false,
      });
    }
  });

  test("what an investigation needs of it survives", () => {
    const out: string = redact(vm);

    expect(out).toContain('"name_label": "app-02"');
    expect(out).toContain('"power_state": "Halted"');
    expect(out).toContain("Debian Bookworm 12");
    expect(out).toContain('"vm-data/mmio-hole-size": "268435456"');
    expect(out).toContain("deb.example.lan/debian");
    expect(out).toContain("ebcb83b9-b96d-6341-931c-9d5105656bf2");
  });

  test("a cloud-init payload Xen Orchestra parsed into JSON is masked to its end", () => {
    const out: string = redact(
      pretty({
        xenStoreData: {
          "vm-data/user-data": {
            users: [{ name: "root", plain_text_passwd: "Parsed-Secret" }],
            runcmd: ["echo Parsed-Command"],
          },
          "vm-data/after": "kept",
        },
      }),
    );

    expect(out).not.toContain("Parsed-Secret");
    expect(out).not.toContain("Parsed-Command");
    expect(out).toContain('"vm-data/after": "kept"');
  });
});

describe("a pool's and a network's configuration", () => {
  test("a pool's xscontainer secrets are masked, its other facts are not", () => {
    const out: string = redact(
      pretty({
        type: "pool",
        name_label: "Production",
        HA_enabled: false,
        master: "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d",
        otherConfig: {
          "xscontainer-public-secret-uuid":
            "d95d1d3c-29b9-e1b3-1c03-5d27ab82ef76",
          "xscontainer-private-secret-uuid":
            "68c7c1a0-eb42-f21a-e872-7a19468dbd6d",
          "memory-ratio-hvm": "0.25",
          migrationCompression: "true",
        },
      }),
    );

    expect(out).not.toContain("d95d1d3c-29b9-e1b3-1c03-5d27ab82ef76");
    expect(out).not.toContain("68c7c1a0-eb42-f21a-e872-7a19468dbd6d");
    expect(out).toContain('"memory-ratio-hvm": "0.25"');
    expect(out).toContain('"master": "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d"');
  });

  test("an SDN controller's pre-shared key is masked", () => {
    const out: string = redact(
      pretty({
        type: "network",
        name_label: "Private SDN",
        other_config: {
          "xo:sdn-controller:private-network-uuid":
            "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
          "xo:sdn-controller:encrypted": "true",
          "xo:sdn-controller:psk": "SdnPsk-Value-1",
          "xo:sdn-controller:pre-shared-key": "SdnPsk-Value-2",
        },
      }),
    );

    expect(out).not.toContain("SdnPsk-Value-1");
    expect(out).not.toContain("SdnPsk-Value-2");
    expect(out).toContain('"xo:sdn-controller:encrypted": "true"');
    expect(out).toContain("5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b");
  });

  test("psk inside a word is no key", () => {
    const answer: string = pretty({ name_label: "pskwarehouse", desk: "x" });

    expect(redact(answer)).toBe(answer);
  });
});

describe("tasks and backup logs", () => {
  test("a task's arguments lose their token and password, its outcome stays", () => {
    const out: string = redact(
      pretty({
        id: "0mdd1basu",
        status: "failure",
        properties: {
          method: "server.add",
          params: {
            host: "10.0.0.11",
            username: "root",
            password: "Xapi-Root-Pass",
            token: XO_TOKEN,
          },
          name: "API call: server.add",
        },
        result: {
          message: "HOST_OFFLINE",
          code: "HOST_OFFLINE",
        },
      }),
    );

    expect(out).not.toContain("Xapi-Root-Pass");
    expect(out).not.toContain(XO_TOKEN);
    expect(out).toContain('"status": "failure"');
    expect(out).toContain("HOST_OFFLINE");
    expect(out).toContain("10.0.0.11");
  });

  test("a failed backup's error loses the storage credentials it quotes", () => {
    const out: string = redact(
      pretty({
        jobName: "nightly",
        status: "failure",
        scheduleId: "1c7cfc78-a006-4942-aab6-b4c825ce9a4e",
        result: {
          message:
            "connect ETIMEDOUT s3://AKIAEXAMPLE7Q:wJalrXUtnFEMI-bPxRfiCYKEY@s3.example.lan/backups and smb://backup:SmbPass9@nas01/share",
          name: "Error",
        },
      }),
    );

    expect(out).not.toContain("wJalrXUtnFEMI-bPxRfiCYKEY");
    expect(out).not.toContain("SmbPass9");
    expect(out).toContain("s3.example.lan/backups");
    expect(out).toContain("1c7cfc78-a006-4942-aab6-b4c825ce9a4e");
    expect(out).toContain('"status": "failure"');
  });
});

describe("tokens wherever they stand", () => {
  test("a token in a URL's user part is masked", () => {
    const out: string = redact(
      `error: cannot reach https://${XO_TOKEN}@xo.example.lan/rest/v0 (ECONNREFUSED)\nws://${OTHER_XO_TOKEN}@xo:8080/api`,
    );

    expect(out).not.toContain(XO_TOKEN);
    expect(out).not.toContain(OTHER_XO_TOKEN);
    expect(out).toContain("xo.example.lan/rest/v0");
    expect(out).toContain(`https://${RESOURCE_REDACTED_MARKER}@xo.example.lan`);
  });

  test("a bare token is masked whole", () => {
    for (const token of [XO_TOKEN, OTHER_XO_TOKEN]) {
      const out: string = redact(pretty({ note: `token ${token} here` }));

      expect(out).not.toContain(token);
      expect(out).toContain(`token ${RESOURCE_REDACTED_MARKER} here`);
    }
  });

  test("an authenticationToken cookie is masked", () => {
    const out: string = redact(`Cookie: authenticationToken=${XO_TOKEN}`);

    expect(out).not.toContain(XO_TOKEN);
  });

  test("what only looks like a token is kept: UUIDs, OpaqueRefs, names, hex", () => {
    const answer: string = pretty({
      uuid: "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
      ref: "OpaqueRef:ffdf8863-5331-9394-5c1b-d1db7de20a76",
      name_label: "a-very-long-name-of-forty-three-characters",
      hash: "bdbeb6e0a816d43fa6d3fe8aaef04c2bad9d3e3d",
      lower: "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopq",
      email: "admin@example.lan",
    });

    expect(redact(answer)).toBe(answer);
  });

  test("a user part already masked by the generic rule is not masked twice", () => {
    const out: string = redact("https://backup:Pass1234@nas01/share");

    expect(out).not.toContain("Pass1234");
    expect(out.split(RESOURCE_REDACTED_MARKER).length - 1).toBe(1);
  });
});

describe("linear time", () => {
  test("a VM's 64 KB of xenStoreData costs no more than its length", () => {
    const value: string = "a".repeat(64 * 1024);
    const answer: string = pretty({
      xenStoreData: {
        [`vm-data/${"k".repeat(60_000)}`]: value,
        "vm-data/user-data": value,
      },
      note: `${"x".repeat(100_000)}://${"y".repeat(100_000)}`,
    });
    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return redact(answer);
      },
      limitInMs: 3000,
    });

    expect(timed.inMs).toBeLessThan(3000);
    expect(timed.result).not.toContain(`"vm-data/user-data": "${value}"`);
  });

  test("many short tokens and URLs in one answer", () => {
    const answer: string = Array.from(
      { length: 5000 },
      (_: unknown, i: number) => {
        return `line ${i}: https://u${i}@h${i}/ ${XO_TOKEN}`;
      },
    ).join("\n");
    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return redact(answer);
      },
      limitInMs: 3000,
    });

    expect(timed.inMs).toBeLessThan(3000);
    expect(timed.result).not.toContain(XO_TOKEN);
  });
});

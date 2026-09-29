import {
  GENERIC_REDACTED_MARKER,
  GenericOutputRedactor,
  RESOURCE_OUTPUT_REDACTION_HOOKS,
  RESOURCE_REDACTED_MARKER,
  ResourceOutputRedaction,
  getResourceOutputRedactionHooks,
  redactResourceCommandOutput,
  redactResourceCommandOutputWithCount,
} from "../../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";
import KubectlOutputRedactor, {
  KUBECTL_REDACTED_MARKER,
} from "../../../../Utils/AiRemediation/KubectlOutputRedactor";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — redaction of a resource command's output, applied
 * on the agent before the output leaves the host and on the server before
 * it is stored or shown to a model.
 *
 * - The generic rules are KubectlOutputRedactor's, copied (the directory is
 *   import-closed): same marker, same answers on the same input.
 * - Per-program hooks run first: every `docker inspect` Env value, a Ceph
 *   keyring's key. A program without hooks gets the generic rules only.
 * - It is total: anything that is not text is "", and a hook that throws
 *   never lets the output through without the generic rules.
 */

function redact(
  text: string,
  program: string = "docker",
  resourceType: AiResourceType = AiResourceType.DockerHost,
): string {
  return redactResourceCommandOutput({ resourceType, program, text });
}

const PRETTY_DOCKER_INSPECT: string = `[
    {
        "Id": "3f2a9c1b7d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8",
        "Name": "/web",
        "Config": {
            "Hostname": "3f2a9c1b7d4e",
            "Env": [
                "APP_CONFIG=eyJob3N0IjoiZGIifQ",
                "DATABASE=postgres://app:hunter2@db:5432/app",
                "POSTGRES_PASSWORD=hunter2",
                "PATH=/usr/local/bin:/usr/bin",
                "EMPTY=",
                "PASSTHROUGH"
            ],
            "Image": "nginx:1.27"
        }
    }
]`;

describe("the generic rules are KubectlOutputRedactor's", () => {
  test("the marker is the same", () => {
    expect(GENERIC_REDACTED_MARKER).toBe(KUBECTL_REDACTED_MARKER);
    expect(RESOURCE_REDACTED_MARKER).toBe("[redacted]");
  });

  const corpus: Array<string> = [
    "",
    "no secrets here\nCONTAINER ID   IMAGE   STATUS",
    "DB_PASSWORD=hunter2 started",
    'password: "hunter2"\napi_key: abcdef123456',
    "connecting to postgres://app:hunter2@db:5432/app",
    "Authorization: Bearer abcdefghijklmnop.qrstuvwxyz",
    "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
    '{"name":"DB_PASSWORD","value":"hunter2"}',
    "--db-password hunter2 --verbose",
    "mysql -phunter2 -u root",
    "cGFzc3dvcmQ= and a long run QWxhZGRpbjpvcGVuIHNlc2FtZQQWxhZGRpbjpvcGVuIHNlc2FtZQ",
    "data:\n  password: aHVudGVyMg==\n  user: YWRtaW4=",
    "kind: Secret\ndata:\n  x: eQ==",
    "line with\r\nwindows endings DB_TOKEN=abc",
  ];

  test.each(
    corpus.map((text: string) => {
      return [text];
    }),
  )("gives KubectlOutputRedactor's answer for %p", (text: string) => {
    expect(GenericOutputRedactor.redact(text)).toEqual(
      KubectlOutputRedactor.redact(text),
    );
  });
});

describe("docker: every Env value is masked", () => {
  test("pretty-printed docker inspect keeps names, masks values", () => {
    const text: string = redact(PRETTY_DOCKER_INSPECT);

    expect(text).toContain('"APP_CONFIG=[redacted]"');
    expect(text).toContain('"DATABASE=[redacted]"');
    expect(text).toContain('"POSTGRES_PASSWORD=[redacted]"');
    expect(text).toContain('"PATH=[redacted]"');
    // Nothing to hide in an empty value or a pass-through name.
    expect(text).toContain('"EMPTY="');
    expect(text).toContain('"PASSTHROUGH"');
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("eyJob3N0IjoiZGIifQ");
    // Everything outside the Env list is untouched.
    expect(text).toContain('"Name": "/web"');
    expect(text).toContain('"Image": "nginx:1.27"');
  });

  test("counts each masked value", () => {
    const redaction: ResourceOutputRedaction =
      redactResourceCommandOutputWithCount({
        resourceType: AiResourceType.DockerHost,
        program: "docker",
        text: '"Env": ["A=1", "B=2", "C"]',
      });

    expect(redaction.text).toBe('"Env": ["A=[redacted]", "B=[redacted]", "C"]');
    expect(redaction.redactionCount).toBe(2);
  });

  test("compact JSON (docker inspect -f '{{json .Config}}')", () => {
    expect(redact('{"Env":["APP_KEY=abc","MODE=prod"],"Cmd":["nginx"]}')).toBe(
      '{"Env":["APP_KEY=[redacted]","MODE=[redacted]"],"Cmd":["nginx"]}',
    );
  });

  test("several containers, several Env lists", () => {
    const text: string = redact(
      '[{"Config":{"Env":["A=secret-one"]}},{"Config":{"Env":["B=secret-two"]}}]',
    );

    expect(text).not.toContain("secret-one");
    expect(text).not.toContain("secret-two");
  });

  test("a value holding an escaped quote or a bracket is masked whole", () => {
    const text: string = redact(
      '"Env": ["JSON_CFG={\\"pw\\":\\"x]y\\"}", "NEXT=secret"]',
    );

    expect(text).toBe('"Env": ["JSON_CFG=[redacted]", "NEXT=[redacted]"]');
  });

  test("JSON escaped inside another JSON string", () => {
    const text: string = redact(
      '{"output":"{\\"Env\\":[\\"TOKEN=abc123\\",\\"MODE=prod\\"]}"}',
    );

    expect(text).not.toContain("abc123");
    expect(text).not.toContain("MODE=prod");
    expect(text).toContain("MODE=[redacted]");
  });

  test("output truncated inside the Env list is masked to the end", () => {
    const text: string = redact('"Env": [\n  "A=visible-secret",\n  "B=trunc');

    expect(text).not.toContain("visible-secret");
    expect(text).not.toContain("trunc");
  });

  test("a null Env and an empty list are left alone", () => {
    expect(redact('"Env": null, "Cmd": []')).toBe('"Env": null, "Cmd": []');
    expect(redact('"Env": []')).toBe('"Env": []');
  });

  test("docker service inspect (swarm) is masked the same way", () => {
    expect(
      redact(
        '"ContainerSpec": {"Env": ["SECRET_SAUCE=ketchup"]}',
        "docker",
        AiResourceType.DockerSwarmCluster,
      ),
    ).toBe('"ContainerSpec": {"Env": ["SECRET_SAUCE=[redacted]"]}');
  });

  test("only docker output gets the Env hook", () => {
    expect(redact('"Env": ["MODE=prod"]', "pvesh")).toBe(
      '"Env": ["MODE=prod"]',
    );
  });
});

describe("ceph: keyring keys are masked", () => {
  test.each([
    [
      '[client.oneuptime-ai]\n\tkey = AQDxJ2ZmAAAAABAAxyz0123456789abcdefghij==\n\tcaps mon = "allow r"',
      "\tkey = [redacted]",
    ],
    [
      "client.admin\n\tkey: AQDxJ2ZmAAAAABAAxyz0123456789abcdefghij==\n\tcaps: [mds] allow *",
      "\tkey: [redacted]",
    ],
    [
      '[{"entity":"client.admin","key":"AQDxJ2ZmAAAAABAAxyz0123456789abcdefghij==","caps":{}}]',
      '"key":"[redacted]"',
    ],
  ])("%p", (text: string, expected: string) => {
    const redacted: string = redact(text, "ceph", AiResourceType.CephCluster);

    expect(redacted).toContain(expected);
    expect(redacted).not.toContain("AQDxJ2ZmAAAAABAAxyz0123456789abcdefghij");
  });

  test("ceph output without keys is untouched", () => {
    const text: string = "HEALTH_WARN 1 osds down\nosd.3 is down";

    expect(redact(text, "ceph", AiResourceType.CephCluster)).toBe(text);
  });
});

describe("the generic rules apply to every program", () => {
  test.each([
    ["docker", AiResourceType.DockerHost],
    ["pvesh", AiResourceType.ProxmoxCluster],
    ["govc", AiResourceType.VMwareVCenter],
    ["ceph", AiResourceType.CephCluster],
    ["db", AiResourceType.DatabaseServer],
    ["journalctl", AiResourceType.Host],
    ["cat", AiResourceType.Host],
    ["unknown-program", AiResourceType.Host],
  ])("%s", (program: string, resourceType: AiResourceType) => {
    const text: string = redact(
      [
        '"cipassword": "hunter2"',
        "DB_PASSWORD=hunter2",
        "url: postgres://app:hunter2@db:5432/app",
        "Authorization: Bearer abcdefghijklmnop",
      ].join("\n"),
      program,
      resourceType,
    );

    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("abcdefghijklmnop");
  });

  test("ordinary output passes through unchanged", () => {
    const text: string =
      "CONTAINER ID   IMAGE        STATUS\n3f2a9c1b7d4e   nginx:1.27   Up 3 hours";

    expect(redact(text)).toBe(text);
  });
});

describe("the hook table", () => {
  test("lists the programs whose kits extend it", () => {
    expect(Object.keys(RESOURCE_OUTPUT_REDACTION_HOOKS).sort()).toEqual(
      ["ceph", "db", "docker", "govc", "ps", "pvesh", "top"].sort(),
    );
    expect(getResourceOutputRedactionHooks("docker").length).toBeGreaterThan(0);
    expect(getResourceOutputRedactionHooks("ceph").length).toBeGreaterThan(0);
  });

  test.each([
    ["systemctl"],
    ["__proto__"],
    ["constructor"],
    ["toString"],
    [""],
  ])("%p has no hooks", (program: string) => {
    expect(getResourceOutputRedactionHooks(program)).toEqual([]);
  });

  test("a non-string program has no hooks", () => {
    expect(getResourceOutputRedactionHooks(null as unknown as string)).toEqual(
      [],
    );
  });
});

describe("totality", () => {
  test.each([[null], [undefined], [42], [{}], [""]])(
    "text %p redacts to an empty string",
    (text: unknown) => {
      expect(
        redactResourceCommandOutputWithCount({
          resourceType: AiResourceType.DockerHost,
          program: "docker",
          text: text as string,
        }),
      ).toEqual({ text: "", redactionCount: 0 });
    },
  );

  test("a missing request redacts to an empty string", () => {
    expect(
      redactResourceCommandOutput(
        null as unknown as Parameters<typeof redactResourceCommandOutput>[0],
      ),
    ).toBe("");
  });

  test("a hook that throws never skips the generic rules", () => {
    const hooks: Array<unknown> = RESOURCE_OUTPUT_REDACTION_HOOKS[
      "pvesh"
    ] as unknown as Array<unknown>;

    hooks.push((): never => {
      throw new Error("broken hook");
    });

    try {
      expect(redact("DB_PASSWORD=hunter2", "pvesh")).toBe(
        "DB_PASSWORD=[redacted]",
      );
    } finally {
      hooks.pop();
    }
  });

  test("a hook that returns garbage is ignored", () => {
    const hooks: Array<unknown> = RESOURCE_OUTPUT_REDACTION_HOOKS[
      "govc"
    ] as unknown as Array<unknown>;

    hooks.push((): unknown => {
      return null;
    });

    try {
      expect(redact("password=x", "govc")).toBe("password=[redacted]");
    } finally {
      hooks.pop();
    }
  });
});

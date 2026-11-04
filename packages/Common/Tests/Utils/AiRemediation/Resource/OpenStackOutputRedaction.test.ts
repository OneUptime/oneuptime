import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_REDACTED_MARKER,
  ResourceOutputRedaction,
  getResourceOutputRedactionHooks,
  redactResourceCommandOutput,
  redactResourceCommandOutputWithCount,
} from "../../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";

/*
 * What an OpenStack cloud's answers hold that must never reach a model or a
 * log: an instance's user data, whatever it holds, metadata marked secret,
 * tokens and credentials. On what real clouds answered, with the field holding
 * what real people put there, and in every shape the agent prints an answer in.
 */

const FIXTURES: string = path.resolve(
  __dirname,
  "../../../Fixtures/OpenStack/hibiscus-ovn/healthy/api",
);

const PASSWORD: string = "hunter2-correct-horse";
// Base64 of a cloud-init script that sets that password.
const USER_DATA: string = Buffer.from(
  `#cloud-config\nchpasswd:\n  list: |\n    root:${PASSWORD}\n`,
).toString("base64");
const FERNET: string = `gAAAAA${"bCdEfGhIjKlMnOpQrStUvWxYz0123456789_-".repeat(4)}`;

function redact(text: string): string {
  return redactResourceCommandOutput({
    resourceType: AiResourceType.OpenStackCloud,
    program: "openstack",
    text,
  });
}

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"),
  ) as Record<string, unknown>;
}

// A recorded instance, as Nova answers an admin at microversion 2.90.
function recordedServer(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const servers: Array<Record<string, unknown>> = readFixture("nova-servers")[
    "servers"
  ] as Array<Record<string, unknown>>;

  return { ...servers[0], ...extra };
}

describe("the openstack program has a redaction hook", () => {
  test("and only the openstack program runs it", () => {
    expect(getResourceOutputRedactionHooks("openstack").length).toBe(1);
    expect(
      redactResourceCommandOutput({
        resourceType: AiResourceType.DockerHost,
        program: "docker",
        text: `user_data: plain-${USER_DATA.slice(0, 8)}`,
      }),
    ).toContain("plain-");
  });
});

describe("user data", () => {
  test("recorded instances hold the field, empty, and it stays readable", () => {
    const server: Record<string, unknown> = recordedServer();

    expect(server["OS-EXT-SRV-ATTR:user_data"]).toBeNull();
    expect(redact(JSON.stringify(server, null, 2))).toContain(
      '"OS-EXT-SRV-ATTR:user_data": null',
    );
  });

  test.each([
    [
      "a recorded instance, pretty",
      (): string => {
        return JSON.stringify(
          recordedServer({ "OS-EXT-SRV-ATTR:user_data": USER_DATA }),
          null,
          2,
        );
      },
    ],
    [
      "a recorded instance, compact",
      (): string => {
        return JSON.stringify(
          recordedServer({ "OS-EXT-SRV-ATTR:user_data": USER_DATA }),
        );
      },
    ],
    [
      "a recorded instance inside a recorded list",
      (): string => {
        return JSON.stringify({
          servers: [
            recordedServer({ "OS-EXT-SRV-ATTR:user_data": USER_DATA }),
            recordedServer(),
          ],
        });
      },
    ],
    [
      "as its own key",
      (): string => {
        return JSON.stringify({ user_data: USER_DATA });
      },
    ],
    [
      "as a key: value line",
      (): string => {
        return `name: web-1\nOS-EXT-SRV-ATTR:user_data: ${USER_DATA}\nstatus: ACTIVE`;
      },
    ],
    [
      "as a table row",
      (): string => {
        return `| name | web-1 |\n| OS-EXT-SRV-ATTR:user_data | ${USER_DATA} |\n| status | ACTIVE |`;
      },
    ],
    [
      "as the real client's box table",
      (): string => {
        return `│ OS-EXT-SRV-ATTR:user_data │ ${USER_DATA} │`;
      },
    ],
    [
      "escaped inside another JSON string",
      (): string => {
        return JSON.stringify({
          log: JSON.stringify({ user_data: USER_DATA }),
        });
      },
    ],
    [
      "with spaces around the colon",
      (): string => {
        return `{"user_data"  :   "${USER_DATA}"}`;
      },
    ],
    [
      "written key=value",
      (): string => {
        return `update server user_data=${USER_DATA} status=ACTIVE`;
      },
    ],
    [
      "unquoted plain text holding the password itself",
      (): string => {
        return `user_data: #!/bin/sh echo root:${PASSWORD} | chpasswd`;
      },
    ],
  ])("is masked: %s", (_what: string, build: () => string) => {
    const text: string = redact(build());

    expect(text).not.toContain(USER_DATA);
    expect(text).not.toContain(PASSWORD);
    expect(text).toContain(RESOURCE_REDACTED_MARKER);
  });

  test("the rest of the recorded instance stays readable", () => {
    const text: string = redact(
      JSON.stringify(
        recordedServer({ "OS-EXT-SRV-ATTR:user_data": USER_DATA }),
        null,
        2,
      ),
    );

    expect(text).toContain('"name": "ou-research-1"');
    expect(text).toContain('"status": "ACTIVE"');
    expect(text).toContain('"OS-EXT-SRV-ATTR:host": "compute-01"');
    expect(text).toContain('"host_status": "UP"');
  });

  test("a field that only sounds like it is left alone", () => {
    for (const line of [
      "user_data_present: true",
      '"user_data_size": 12',
      "user_data: null",
      '"user_data": null',
      '"user_data": ""',
      "user_data: 12",
    ]) {
      expect(redact(line)).toBe(line);
    }
  });

  test("counts what it masked, and does not mask twice", () => {
    const once: ResourceOutputRedaction = redactResourceCommandOutputWithCount({
      resourceType: AiResourceType.OpenStackCloud,
      program: "openstack",
      text: `{"user_data": "${USER_DATA}"}`,
    });

    expect(once.redactionCount).toBeGreaterThanOrEqual(1);

    const twice: ResourceOutputRedaction = redactResourceCommandOutputWithCount(
      {
        resourceType: AiResourceType.OpenStackCloud,
        program: "openstack",
        text: once.text,
      },
    );

    expect(twice.text).toBe(once.text);
    expect(twice.redactionCount).toBe(0);
  });
});

describe("metadata marked secret", () => {
  const SECRET: string = "s3cr3t-value-of-a-key";

  test.each([
    ["password"],
    ["db_password"],
    ["admin_pass"],
    ["adminPass"],
    ["secret"],
    ["app_secret"],
    ["secret_key"],
    ["api_key"],
    ["api_token"],
    ["auth_token"],
    ["private_key"],
    ["credential"],
    ["os_password"],
  ])("%s, in a recorded instance's metadata", (key: string) => {
    const metadata: Record<string, string> = {
      [key]: SECRET,
      role: "web",
    };
    const pretty: string = redact(
      JSON.stringify(recordedServer({ metadata }), null, 2),
    );
    const compact: string = redact(JSON.stringify(recordedServer({ metadata })));
    const line: string = redact(`metadata: ${JSON.stringify(metadata)}`);

    expect(pretty).not.toContain(SECRET);
    expect(compact).not.toContain(SECRET);
    expect(line).not.toContain(SECRET);
    // What is not a secret stays, for the person reading.
    expect(pretty).toContain('"role": "web"');
  });

  test("a recorded volume's and image's metadata the same way", () => {
    const volumes: Array<Record<string, unknown>> = readFixture(
      "cinder-volumes",
    )["volumes"] as Array<Record<string, unknown>>;
    const images: Array<Record<string, unknown>> = readFixture("glance-images")[
      "images"
    ] as Array<Record<string, unknown>>;

    const volume: string = redact(
      JSON.stringify(
        { ...volumes[0], metadata: { backup_password: SECRET } },
        null,
        2,
      ),
    );
    const image: string = redact(
      JSON.stringify({ ...images[0], signature_secret: SECRET }, null, 2),
    );

    expect(volume).not.toContain(SECRET);
    expect(image).not.toContain(SECRET);
  });
});

describe("tokens and credentials", () => {
  test.each([
    ["a Fernet token on its own", (): string => FERNET],
    ["in a sentence", (): string => `Authentication with ${FERNET} failed`],
    ["as an auth header", (): string => `X-Auth-Token: ${FERNET}`],
    ["as a subject header", (): string => `X-Subject-Token: ${FERNET}`],
    ["in JSON", (): string => JSON.stringify({ "X-Auth-Token": FERNET })],
    ["in a fault's text", (): string => JSON.stringify({ details: `token ${FERNET} expired` })],
  ])("masks %s", (_what: string, build: () => string) => {
    expect(redact(build())).not.toContain(FERNET);
  });

  test("a word that merely starts the same way stays", () => {
    expect(redact("gAAAAh")).toBe("gAAAAh");
  });

  test.each([
    ["application_credential_secret"],
    ["application_credential_id: not-a-secret-but-masked-by-name"],
  ])("a credential's own name: %s", (key: string) => {
    expect(redact(`${key.split(":")[0]}: value-in-the-output`)).not.toContain(
      "value-in-the-output",
    );
  });

  test("a connection string in a fault's traceback", () => {
    const text: string = redact(
      JSON.stringify(recordedServer({
        fault: {
          code: 500,
          message: "DB error",
          details:
            "OperationalError: mysql+pymysql://nova:db-pass-1234@10.0.0.5/nova refused",
        },
      })),
    );

    expect(text).not.toContain("db-pass-1234");
    expect(text).toContain("OperationalError");
  });

  test("a Glance image's direct_url, and a volume's provider_auth", () => {
    const image: string = redact(
      JSON.stringify({
        id: "a",
        direct_url: "swift+config://ref1/glance/abc-holds-a-reference",
        name: "cirros",
      }),
    );
    const volume: string = redact(
      JSON.stringify({
        provider_auth: "CHAP chap-user chap-password-1234",
        name: "vol",
      }),
    );

    expect(image).not.toContain("abc-holds-a-reference");
    expect(image).toContain('"name":"cirros"');
    expect(volume).not.toContain("chap-password-1234");
    expect(volume).toContain('"name":"vol"');
  });
});

describe("what a recorded answer keeps", () => {
  test.each([
    ["nova-services"],
    ["nova-hypervisors"],
    ["neutron-agents"],
    ["cinder-services"],
    ["placement-providers"],
    ["placement-usages"],
    ["keystone-endpoints"],
  ])("%s has nothing to mask: an investigation reads it whole", (name: string) => {
    const text: string = JSON.stringify(readFixture(name), null, 2);

    expect(redact(text)).toBe(text);
  });

  test("a recorded server list keeps every fact a report names", () => {
    const text: string = redact(
      JSON.stringify(readFixture("nova-servers"), null, 2),
    );

    for (const fact of [
      "ou-research-1",
      "ou-failed",
      "ou-stopped",
      "ou-running",
      "compute-01",
      "compute-01.example.internal",
      "No valid host was found",
    ]) {
      expect(text).toContain(fact);
    }
  });
});

describe("hostile output", () => {
  test("a field name with nothing after it, at the end of the text", () => {
    for (const text of [
      "user_data",
      '"user_data"',
      '"user_data":',
      '"user_data": ',
      '"user_data": "',
      '"user_data": "unterminated value with no end',
      'user_data=',
      "| user_data |",
      '\\"user_data\\": \\"unterminated',
    ]) {
      expect(typeof redact(text)).toBe("string");
      expect(redact(text)).not.toContain("unterminated value");
    }
  });

  test("a long run of field names is read once each", () => {
    const text: string = '"user_data": "x", '.repeat(5000);
    const masked: string = redact(text);

    expect(masked).not.toContain('"x"');
  });
});

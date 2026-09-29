import {
  RESOURCE_REDACTED_MARKER,
  getResourceOutputRedactionHooks,
  redactResourceCommandOutput,
  redactResourceCommandOutputWithCount,
} from "../../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — what the docker hooks of ResourceOutputRedactor
 * mask in the output of the commands the docker policies allow, before it
 * leaves the agent and before a model reads it:
 *
 * - every value of an "Env" list in inspect JSON (container, image and
 *   service inspect; pretty-printed, compact, or escaped one level);
 * - every value on the one-line "Env:" of `docker service inspect --pretty`,
 *   whatever spaces the values hold;
 * - and, through the generic rules, credentials anywhere else (proxy URLs,
 *   credential-named labels and options, bearer tokens, private keys).
 *
 * Names stay, so the model still knows which variables are set.
 */

const DOCKER_TYPES: Array<AiResourceType> = [
  AiResourceType.DockerHost,
  AiResourceType.PodmanHost,
  AiResourceType.DockerSwarmCluster,
];

function redact(
  text: string,
  resourceType: AiResourceType = AiResourceType.DockerSwarmCluster,
  program: string = "docker",
): string {
  return redactResourceCommandOutput({ resourceType, program, text });
}

const SERVICE_INSPECT_PRETTY: string = [
  "",
  "ID:\t\tx2k9mvq3",
  "Name:\t\tapp_web",
  "Labels:",
  " com.docker.stack.image=nginx:1.27",
  " com.docker.stack.namespace=app",
  "Service Mode:\tReplicated",
  " Replicas:\t3",
  "ContainerSpec:",
  " Image:\t\tnginx:1.27@sha256:0123abcd",
  " Env:\t\tAPP_KEY=abc123 LOG_LEVEL=debug JAVA_OPTS=-Xmx1g -Dsecret=hunter2 GREETING=hello world EMPTY= ",
  " Init:\t\tfalse",
  "Resources:",
  " Limits:",
  "  Memory:\t512MiB",
].join("\n");

describe("docker: the pretty service inspect Env line", () => {
  test("keeps every name and masks every value", () => {
    const redacted: string = redact(SERVICE_INSPECT_PRETTY);

    expect(redacted).toContain(
      " Env:\t\tAPP_KEY=[redacted] LOG_LEVEL=[redacted] JAVA_OPTS=[redacted] GREETING=[redacted] EMPTY=",
    );

    for (const value of [
      "abc123",
      "debug",
      "-Xmx1g",
      "-Dsecret",
      "hunter2",
      "hello",
      "world",
    ]) {
      expect(redacted).not.toContain(value);
    }
  });

  test("leaves the rest of the service readable", () => {
    const redacted: string = redact(SERVICE_INSPECT_PRETTY);

    expect(redacted).toContain("Name:\t\tapp_web");
    expect(redacted).toContain(" com.docker.stack.namespace=app");
    expect(redacted).toContain(" Image:\t\tnginx:1.27@sha256:0123abcd");
    expect(redacted).toContain("  Memory:\t512MiB");
  });

  test("counts one redaction per masked value", () => {
    const hooked: number = redactResourceCommandOutputWithCount({
      resourceType: AiResourceType.DockerSwarmCluster,
      program: "docker",
      text: " Env:\t\tA=1 B=2 C=three words ",
    }).redactionCount;

    expect(hooked).toBeGreaterThanOrEqual(3);
  });

  test.each([
    [" Env:\tPASSWORD=hunter2", " Env:\tPASSWORD=[redacted]"],
    ["Env: A=1", "Env: A=[redacted]"],
    ["  Env:  A=x=y B=", "  Env:  A=[redacted] B="],
    [" Env:\tjust words here", " Env:\t"],
  ])("%p becomes %p", (line: string, expected: string) => {
    expect(redact(line)).toBe(expected);
  });

  test("a line that only mentions Env is left alone", () => {
    for (const text of [
      "Environment: production",
      "the Env: A=1 line", // not at the start of the line
      " Env:",
    ]) {
      expect(redact(text)).toBe(text);
    }
  });

  test("only docker output gets the docker hooks", () => {
    expect(redact(" Env:\tMODE=prod", AiResourceType.CephCluster, "ceph")).toBe(
      " Env:\tMODE=prod",
    );
  });

  test("the docker program has both hooks", () => {
    expect(
      getResourceOutputRedactionHooks("docker").length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("docker: a pretty Env block a multi-line value spread over several lines", () => {
  /*
   * The CLI's template prints each entry raw, so the newlines inside
   * CA_CERT's value push the rest of the list onto the following lines.
   */
  const MULTI_LINE_ENV: string = [
    "",
    "ID:\t\tx2k9mvq3",
    "Name:\t\tapp_web",
    "Service Mode:\tReplicated",
    " Replicas:\t3",
    "ContainerSpec:",
    " Image:\t\tapp:1.4",
    " Env:\t\tCA_CERT=-----BEGIN CERTIFICATE-----",
    "MIIBabcCertBody",
    "-----END CERTIFICATE----- DATABASE=prod-db-01:5432/app?pw=Tr0ub4dor APP_CONFIG=eyJhcGkiOiJ4In0 STRIPE=sk_live_abcdef123 ",
    " Dir:\t\t/srv/app",
    "Resources:",
    " Limits:",
    "  Memory:\t512MiB",
    "Endpoint Mode:\tvip",
  ].join("\n");

  test("masks every entry after the multi-line value, and the value's own lines", () => {
    const redacted: string = redact(MULTI_LINE_ENV);

    for (const value of [
      "Tr0ub4dor",
      "prod-db-01",
      "eyJhcGkiOiJ4In0",
      "sk_live_abcdef123",
      "MIIBabcCertBody",
      "END CERTIFICATE",
    ]) {
      expect(redacted).not.toContain(value);
    }

    expect(redacted).toContain(
      " Env:\t\tCA_CERT=[redacted] DATABASE=[redacted] APP_CONFIG=[redacted] STRIPE=[redacted]",
    );
  });

  test("the lines the template starts after the Env block stay readable", () => {
    const redacted: string = redact(MULTI_LINE_ENV);

    expect(redacted).toContain(" Image:\t\tapp:1.4");
    expect(redacted).toContain(" Dir:\t\t/srv/app");
    expect(redacted).toContain("  Memory:\t512MiB");
    expect(redacted).toContain("Endpoint Mode:\tvip");
  });

  test("a private key in an env value leaves none of its lines, nor the entries after it", () => {
    const redacted: string = redact(
      [
        "ContainerSpec:",
        " Image:\t\tapp:1",
        " Env:\t\tTLS_KEY=-----BEGIN PRIVATE KEY-----",
        "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7",
        "Zm9vYmFyYmF6cXV4",
        "-----END PRIVATE KEY----- NEXT_SETTING=plainvalue ",
        "Endpoint Mode:\tvip",
      ].join("\n"),
    );

    expect(redacted).not.toContain("Zm9vYmFyYmF6cXV4");
    expect(redacted).not.toContain(
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7",
    );
    expect(redacted).not.toContain("plainvalue");
    expect(redacted).toContain(
      " Env:\t\tTLS_KEY=[redacted] NEXT_SETTING=[redacted]",
    );
    expect(redacted).toContain("Endpoint Mode:\tvip");
  });

  test("with no section after it, the Env block runs to the end of the text", () => {
    const redacted: string = redact(
      "ContainerSpec:\n Env:\t\tA=first\nline two B=second",
    );

    expect(redacted).toBe("ContainerSpec:\n Env:\t\tA=[redacted] B=[redacted]");
  });

  test("outside a ContainerSpec section only the Env line itself is masked", () => {
    expect(redact(" Env:\tMODE=prod\nnext line stays")).toBe(
      " Env:\tMODE=[redacted]\nnext line stays",
    );
  });
});

describe("docker: inspect JSON Env lists", () => {
  test.each(
    DOCKER_TYPES.map((type: AiResourceType) => {
      return [type];
    }),
  )(
    "%s: container inspect keeps names and masks values",
    (type: AiResourceType) => {
      const redacted: string = redact(
        [
          "[{",
          '  "Name": "/web",',
          '  "Config": {',
          '    "Env": [',
          '      "APP_CONFIG=eyJob3N0IjoiZGIifQ",',
          '      "DATABASE_URL=postgres://app:hunter2@db:5432/app",',
          '      "PATH=/usr/local/bin:/usr/bin"',
          "    ],",
          '    "Image": "nginx:1.27"',
          "  }",
          "}]",
        ].join("\n"),
        type,
      );

      expect(redacted).toContain(`"APP_CONFIG=${RESOURCE_REDACTED_MARKER}"`);
      expect(redacted).toContain(`"DATABASE_URL=${RESOURCE_REDACTED_MARKER}"`);
      expect(redacted).toContain(`"PATH=${RESOURCE_REDACTED_MARKER}"`);
      expect(redacted).toContain('"Image": "nginx:1.27"');
      expect(redacted).not.toContain("hunter2");
      expect(redacted).not.toContain("eyJob3N0IjoiZGIifQ");
    },
  );

  test("service inspect JSON masks the ContainerSpec's Env, previous spec included", () => {
    const redacted: string = redact(
      '[{"Spec":{"TaskTemplate":{"ContainerSpec":{"Image":"nginx","Env":["TOKEN=abc","MODE=prod"]}}},"PreviousSpec":{"TaskTemplate":{"ContainerSpec":{"Env":["TOKEN=old"]}}}}]',
    );

    expect(redacted).not.toContain("abc");
    expect(redacted).not.toContain("old");
    expect(redacted).not.toContain("prod");
    expect(redacted).toContain('"MODE=[redacted]"');
  });

  test("image inspect Env is masked too", () => {
    expect(
      redact(
        '{"Config":{"Env":["NODE_VERSION=22.1.0"]}}',
        AiResourceType.DockerHost,
      ),
    ).toBe('{"Config":{"Env":["NODE_VERSION=[redacted]"]}}');
  });

  test("an Env list escaped inside a label keeps its walker in step past an entry's escaped quote", () => {
    const inner: string = JSON.stringify({
      Env: [
        'A=pa"ss',
        "SESSION_SIGNING=zq8Xv0PlmN3k",
        "PLAIN=hello world",
        "BACKSLASH=C:\\dir\\",
        "AFTER=still-masked",
      ],
    });
    const text: string = JSON.stringify({
      Config: { Labels: { "com.example.spec": inner }, Image: "app:1" },
    });

    const redacted: string = redact(text, AiResourceType.DockerHost);

    for (const value of [
      "zq8Xv0PlmN3k",
      "hello world",
      'pa\\\\\\"ss',
      "C:\\\\\\\\dir",
      "still-masked",
    ]) {
      expect(redacted).not.toContain(value);
    }

    expect(redacted).toContain('\\"SESSION_SIGNING=[redacted]\\"');
    expect(redacted).toContain('\\"AFTER=[redacted]\\"');
    expect(redacted).toContain('"Image":"app:1"');
    // The masked label is still one well-formed JSON document.
    expect(() => {
      return JSON.parse(redacted);
    }).not.toThrow();
  });
});

describe("docker: the generic rules cover the rest", () => {
  test("a proxy URL's password in docker info", () => {
    const redacted: string = redact(
      " HTTP Proxy: http://proxyuser:s3cr3tpass@proxy.internal:3128\n Registry: https://index.docker.io/v1/",
      AiResourceType.DockerHost,
    );

    expect(redacted).not.toContain("s3cr3tpass");
    expect(redacted).toContain("Registry: https://index.docker.io/v1/");
  });

  test("a credential-named container label", () => {
    const redacted: string = redact(
      '{"Labels": {"com.example.api_token": "tok_live_123456789", "com.example.team": "payments"}}',
      AiResourceType.DockerHost,
    );

    expect(redacted).not.toContain("tok_live_123456789");
    expect(redacted).toContain("payments");
  });

  test("a password in a logging driver option", () => {
    const redacted: string = redact(
      '"LogConfig": {"Type": "splunk", "Config": {"splunk-token": "00000000-1111-2222-3333-444444444444"}}',
      AiResourceType.DockerHost,
    );

    expect(redacted).not.toContain("00000000-1111-2222-3333-444444444444");
  });

  test("a CIFS volume's mount password in docker volume inspect", () => {
    const redacted: string = redact(
      '[{"Driver": "local", "Options": {"device": "//server/share", "o": "addr=10.0.0.5,username=svc,password=hunter2,vers=3.0", "type": "cifs"}}]',
      AiResourceType.DockerHost,
    );

    expect(redacted).not.toContain("hunter2");
    expect(redacted).toContain("//server/share");
  });

  test("credential arguments in a container's Cmd and Args", () => {
    const redacted: string = redact(
      '"Cmd": ["postgres", "-c", "password=hunter2"], "Args": ["--db-password", "s3cr3t", "--api-key=abc123456"]',
      AiResourceType.DockerHost,
    );

    for (const value of ["hunter2", "s3cr3t", "abc123456"]) {
      expect(redacted).not.toContain(value);
    }
  });

  test("a basic-auth label in docker ps --format json", () => {
    const redacted: string = redact(
      '{"Labels":"traefik.http.middlewares.auth.basicauth.users=admin:$apr1$xyz,com.docker.compose.project=app","Names":"web"}',
      AiResourceType.DockerHost,
    );

    expect(redacted).not.toContain("$apr1$xyz");
    expect(redacted).toContain("com.docker.compose.project=app");
  });

  test("a private key a container logged", () => {
    const redacted: string = redact(
      "starting\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\nready",
      AiResourceType.DockerHost,
    );

    expect(redacted).not.toContain("MIIEowIBAAKCAQEA");
    expect(redacted).toContain("ready");
  });

  test("ordinary docker ps output passes through unchanged", () => {
    const text: string =
      'CONTAINER ID   IMAGE        COMMAND                  STATUS          NAMES\n3f2a9c1b7d4e   nginx:1.27   "/docker-entrypoint.…"   Up 3 hours      web';

    expect(redact(text, AiResourceType.DockerHost)).toBe(text);
  });
});

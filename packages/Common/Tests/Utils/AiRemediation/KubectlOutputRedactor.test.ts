import KubectlOutputRedactor, {
  KUBECTL_REDACTED_MARKER,
  KubectlOutputRedaction,
} from "../../../Utils/AiRemediation/KubectlOutputRedactor";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — KubectlOutputRedactor is the pure, deterministic
 * pass every kubectl output goes through before a model sees it or it is
 * stored next to an AI run:
 *  1. Secret data/stringData blocks (YAML, JSON, Lists) lose every value
 *     and keep every key; an object whose kind cannot be seen is treated as
 *     a Secret (fail closed); a ConfigMap keeps its non-credential values.
 *  2. Env entries whose name looks credential-like lose their value in
 *     YAML, JSON and describe output; valueFrom references are kept.
 *  3. Credential-like keys are masked wherever they appear, block scalars
 *     included; the last-applied-configuration annotation is dropped.
 *  4. Inline material (URL passwords, Bearer/Basic, JWTs, PEM keys, base64,
 *     one-line JSON) is masked regardless of structure.
 *  5. Ordinary kubectl output — tables, events, taints, flags, names,
 *     trace ids — passes through untouched, and the pass is idempotent.
 */

const PASSWORD_B64: string = "cGFzc3dvcmQ=";
const ADMIN_B64: string = "YWRtaW4=";
const JWT: string = `eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9.${"a".repeat(24)}.${"b".repeat(16)}`;

function redact(text: string): KubectlOutputRedaction {
  return KubectlOutputRedactor.redact(text);
}

function lines(...parts: Array<string>): string {
  return parts.join("\n");
}

describe("KubectlOutputRedactor", () => {
  describe("Secret data blocks", () => {
    const secretYaml: string = lines(
      "apiVersion: v1",
      "data:",
      `  DB_PASSWORD: ${PASSWORD_B64}`,
      `  username: ${ADMIN_B64}`,
      "  tls.key: LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQo=",
      "kind: Secret",
      "metadata:",
      "  annotations:",
      "    kubectl.kubernetes.io/last-applied-configuration: |",
      `      {"apiVersion":"v1","data":{"DB_PASSWORD":"${PASSWORD_B64}"},"kind":"Secret","metadata":{"name":"db"}}`,
      "  name: db",
      "  namespace: prod",
      "type: Opaque",
    );

    it("masks every value of a Secret's data block and keeps the keys", () => {
      const result: KubectlOutputRedaction = redact(secretYaml);

      expect(result.text).not.toContain(PASSWORD_B64);
      expect(result.text).not.toContain(ADMIN_B64);
      expect(result.text).not.toContain("LS0tLS1CRUdJTi");
      expect(result.text).toContain(
        `  DB_PASSWORD: ${KUBECTL_REDACTED_MARKER}`,
      );
      expect(result.text).toContain(`  username: ${KUBECTL_REDACTED_MARKER}`);
      expect(result.text).toContain(`  tls.key: ${KUBECTL_REDACTED_MARKER}`);
      // Structure the model needs stays readable.
      expect(result.text).toContain("kind: Secret");
      expect(result.text).toContain("  name: db");
      expect(result.text).toContain("  namespace: prod");
      expect(result.text).toContain("type: Opaque");
      expect(result.redactionCount).toBeGreaterThanOrEqual(4);
    });

    it("drops the last-applied-configuration annotation, which repeats the whole object", () => {
      const result: KubectlOutputRedaction = redact(secretYaml);

      expect(result.text).toContain(
        `    kubectl.kubernetes.io/last-applied-configuration: ${KUBECTL_REDACTED_MARKER}`,
      );
      expect(result.text).not.toContain('"apiVersion":"v1"');
    });

    it("masks stringData too", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "apiVersion: v1",
          "kind: Secret",
          "metadata:",
          "  name: app",
          "stringData:",
          "  api-key: sk-live-1234567890abcdef",
          "  config.json: |",
          '    {"endpoint":"https://api.example.com","key":"hunter2"}',
          "type: Opaque",
        ),
      );

      expect(result.text).not.toContain("sk-live-1234567890abcdef");
      expect(result.text).not.toContain("hunter2");
      expect(result.text).not.toContain("api.example.com");
      expect(result.text).toContain(`  api-key: ${KUBECTL_REDACTED_MARKER}`);
      expect(result.text).toContain(
        `  config.json: ${KUBECTL_REDACTED_MARKER}`,
      );
      expect(result.text).toContain("type: Opaque");
    });

    it("masks every Secret in a kind: List and leaves a ConfigMap item's plain values readable", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "apiVersion: v1",
          "items:",
          "- apiVersion: v1",
          "  data:",
          `    password: ${PASSWORD_B64}`,
          "  kind: Secret",
          "  metadata:",
          "    name: first",
          "- apiVersion: v1",
          "  data:",
          "    LOG_LEVEL: debug",
          "    DB_PASSWORD: hunter2",
          "  kind: ConfigMap",
          "  metadata:",
          "    name: settings",
          "- apiVersion: v1",
          "  data:",
          `    token: ${ADMIN_B64}`,
          "  kind: Secret",
          "  metadata:",
          "    name: second",
          "kind: List",
        ),
      );

      expect(result.text).not.toContain(PASSWORD_B64);
      expect(result.text).not.toContain(ADMIN_B64);
      expect(result.text).not.toContain("hunter2");
      expect(result.text).toContain(`    password: ${KUBECTL_REDACTED_MARKER}`);
      expect(result.text).toContain(`    token: ${KUBECTL_REDACTED_MARKER}`);
      expect(result.text).toContain("    LOG_LEVEL: debug");
      expect(result.text).toContain("    name: first");
      expect(result.text).toContain("    name: settings");
      expect(result.text).toContain("kind: List");
    });

    it("masks a pretty-printed JSON Secret and keeps the document parseable", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "{",
          '    "apiVersion": "v1",',
          '    "data": {',
          `        "password": "${PASSWORD_B64}",`,
          `        "username": "${ADMIN_B64}"`,
          "    },",
          '    "kind": "Secret",',
          '    "metadata": {',
          '        "name": "db"',
          "    },",
          '    "type": "Opaque"',
          "}",
        ),
      );

      expect(result.text).not.toContain(PASSWORD_B64);
      expect(result.text).not.toContain(ADMIN_B64);

      const parsed: Record<string, unknown> = JSON.parse(result.text) as Record<
        string,
        unknown
      >;
      expect(parsed["data"]).toEqual({
        password: KUBECTL_REDACTED_MARKER,
        username: KUBECTL_REDACTED_MARKER,
      });
      expect(parsed["kind"]).toBe("Secret");
      expect(parsed["metadata"]).toEqual({ name: "db" });
      expect(parsed["type"]).toBe("Opaque");
    });

    it("masks a JSON List of Secrets item by item", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "{",
          '    "apiVersion": "v1",',
          '    "items": [',
          "        {",
          '            "apiVersion": "v1",',
          '            "data": {',
          `                "password": "${PASSWORD_B64}"`,
          "            },",
          '            "kind": "Secret",',
          '            "metadata": {',
          '                "name": "first"',
          "            }",
          "        },",
          "        {",
          '            "apiVersion": "v1",',
          '            "data": {',
          '                "LOG_LEVEL": "debug"',
          "            },",
          '            "kind": "ConfigMap",',
          '            "metadata": {',
          '                "name": "settings"',
          "            }",
          "        }",
          "    ],",
          '    "kind": "List"',
          "}",
        ),
      );

      expect(result.text).not.toContain(PASSWORD_B64);
      const parsed: { items: Array<{ data: Record<string, string> }> } =
        JSON.parse(result.text) as {
          items: Array<{ data: Record<string, string> }>;
        };
      expect(parsed.items[0]!.data).toEqual({
        password: KUBECTL_REDACTED_MARKER,
      });
      expect(parsed.items[1]!.data).toEqual({ LOG_LEVEL: "debug" });
    });

    it("fails closed: a data block whose kind was truncated away is masked like a Secret", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "apiVersion: v1",
          "data:",
          "  LOG_LEVEL: debug",
          `  something: ${ADMIN_B64}`,
          "  plain: hello",
        ),
      );

      expect(result.text).toContain(`  LOG_LEVEL: ${KUBECTL_REDACTED_MARKER}`);
      expect(result.text).toContain(`  something: ${KUBECTL_REDACTED_MARKER}`);
      expect(result.text).toContain(`  plain: ${KUBECTL_REDACTED_MARKER}`);
      expect(result.text).not.toContain("hello");
    });

    it("stops at the end of a YAML document so a following object is not mistaken for the kind", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "apiVersion: v1",
          "data:",
          "  LOG_LEVEL: debug",
          "---",
          "apiVersion: v1",
          "kind: ConfigMap",
        ),
      );

      // No kind in the first document: fail closed.
      expect(result.text).toContain(`  LOG_LEVEL: ${KUBECTL_REDACTED_MARKER}`);
      expect(result.text).toContain("kind: ConfigMap");
    });

    it("leaves an empty data mapping alone", () => {
      const yaml: string = lines(
        "apiVersion: v1",
        "data: {}",
        "kind: Secret",
        "metadata:",
        "  name: empty",
      );
      expect(redact(yaml).text).toBe(yaml);
      expect(redact(yaml).redactionCount).toBe(0);
    });
  });

  describe("ConfigMap data blocks", () => {
    const configMapYaml: string = lines(
      "apiVersion: v1",
      "data:",
      "  LOG_LEVEL: debug",
      "  DATABASE_URL: postgres://app:hunter2@db.prod.svc:5432/app",
      "  API_TOKEN: abcdef123456",
      "  app.yaml: |",
      "    server:",
      "      port: 8080",
      "    database:",
      "      host: db",
      "      password: hunter2",
      "    tls:",
      "      key: |",
      "        -----BEGIN RSA PRIVATE KEY-----",
      "        MIIEowIBAAKCAQEA",
      "        -----END RSA PRIVATE KEY-----",
      "kind: ConfigMap",
      "metadata:",
      "  name: settings",
    );

    it("keeps plain configuration readable", () => {
      const result: KubectlOutputRedaction = redact(configMapYaml);

      expect(result.text).toContain("  LOG_LEVEL: debug");
      expect(result.text).toContain("    server:");
      expect(result.text).toContain("      port: 8080");
      expect(result.text).toContain("      host: db");
      expect(result.text).toContain("kind: ConfigMap");
    });

    it("masks credential-like keys, URL passwords and private keys nested in a config file", () => {
      const result: KubectlOutputRedaction = redact(configMapYaml);

      expect(result.text).toContain(`  API_TOKEN: ${KUBECTL_REDACTED_MARKER}`);
      expect(result.text).toContain(
        `  DATABASE_URL: postgres://app:${KUBECTL_REDACTED_MARKER}@db.prod.svc:5432/app`,
      );
      expect(result.text).toContain(
        `      password: ${KUBECTL_REDACTED_MARKER}`,
      );
      expect(result.text).not.toContain("hunter2");
      expect(result.text).not.toContain("MIIEowIBAAKCAQEA");
      expect(result.text).not.toContain("BEGIN RSA PRIVATE KEY");
    });
  });

  describe("container env entries", () => {
    const podYaml: string = lines(
      "apiVersion: v1",
      "kind: Pod",
      "metadata:",
      "  name: web-1",
      "spec:",
      "  containers:",
      "  - name: auth-service",
      "    image: registry.example.com/auth:1.2.3",
      "    env:",
      "    - name: DB_HOST",
      "      value: postgres",
      "    - name: DB_PASSWORD",
      "      value: s3cr3t-value",
      "    - name: API_TOKEN",
      "      valueFrom:",
      "        secretKeyRef:",
      "          key: token",
      "          name: api-secret",
      "    - value: sk-live-abc",
      "      name: STRIPE_KEY",
      "    - name: AWS_ACCESS_KEY_ID",
      "      value: AKIAIOSFODNN7EXAMPLE",
      "    - name: KEYCLOAK_URL",
      "      value: https://sso.example.com",
      "    livenessProbe:",
      "      httpGet:",
      "        httpHeaders:",
      "        - name: Authorization",
      "          value: Bearer live-probe-token-12345",
      "        path: /healthz",
      "  serviceAccountName: default",
      "  automountServiceAccountToken: false",
      "  tolerations:",
      "  - effect: NoSchedule",
      "    key: node-role.kubernetes.io/control-plane",
      "  volumes:",
      "  - name: certs",
      "    secret:",
      "      secretName: tls-cert",
    );

    it("masks the value of credential-like env names and keeps the others", () => {
      const result: KubectlOutputRedaction = redact(podYaml);

      expect(result.text).toContain("    - name: DB_HOST");
      expect(result.text).toContain("      value: postgres");
      expect(result.text).toContain("    - name: DB_PASSWORD");
      expect(result.text).toContain(`      value: ${KUBECTL_REDACTED_MARKER}`);
      expect(result.text).not.toContain("s3cr3t-value");
      expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(result.text).toContain("      value: https://sso.example.com");
    });

    it("handles an entry whose value precedes its name", () => {
      const result: KubectlOutputRedaction = redact(podYaml);

      expect(result.text).toContain(`    - value: ${KUBECTL_REDACTED_MARKER}`);
      expect(result.text).toContain("      name: STRIPE_KEY");
      expect(result.text).not.toContain("sk-live-abc");
    });

    it("keeps valueFrom references, the container name and the secret references a pod needs", () => {
      const result: KubectlOutputRedaction = redact(podYaml);

      expect(result.text).toContain("    - name: API_TOKEN");
      expect(result.text).toContain("      valueFrom:");
      expect(result.text).toContain("          name: api-secret");
      expect(result.text).toContain("  - name: auth-service");
      expect(result.text).toContain(
        "    image: registry.example.com/auth:1.2.3",
      );
      expect(result.text).toContain("      secretName: tls-cert");
      expect(result.text).toContain("  automountServiceAccountToken: false");
      expect(result.text).toContain(
        "    key: node-role.kubernetes.io/control-plane",
      );
    });

    it("masks a credential-like probe header value", () => {
      const result: KubectlOutputRedaction = redact(podYaml);

      expect(result.text).toContain("        - name: Authorization");
      expect(result.text).not.toContain("live-probe-token-12345");
      expect(result.text).toContain("        path: /healthz");
    });

    it("masks env values in pretty-printed JSON and keeps the document parseable", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "{",
          '    "spec": {',
          '        "containers": [',
          "            {",
          '                "env": [',
          "                    {",
          '                        "name": "DB_HOST",',
          '                        "value": "postgres"',
          "                    },",
          "                    {",
          '                        "name": "DB_PASSWORD",',
          '                        "value": "s3cr3t"',
          "                    },",
          "                    {",
          '                        "value": "sk-live",',
          '                        "name": "STRIPE_KEY"',
          "                    }",
          "                ],",
          '                "name": "web"',
          "            }",
          "        ]",
          "    }",
          "}",
        ),
      );

      const parsed: {
        spec: {
          containers: Array<{ env: Array<{ name: string; value: string }> }>;
        };
      } = JSON.parse(result.text) as {
        spec: {
          containers: Array<{ env: Array<{ name: string; value: string }> }>;
        };
      };
      expect(parsed.spec.containers[0]!.env).toEqual([
        { name: "DB_HOST", value: "postgres" },
        { name: "DB_PASSWORD", value: KUBECTL_REDACTED_MARKER },
        { value: KUBECTL_REDACTED_MARKER, name: "STRIPE_KEY" },
      ]);
    });

    it("does not let one entry's value bleed into the next entry", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "    env:",
          "    - name: DB_PASSWORD",
          "      valueFrom:",
          "        secretKeyRef:",
          "          name: db",
          "          key: password",
          "    - name: DB_HOST",
          "      value: postgres",
        ),
      );

      expect(result.text).toContain("      value: postgres");
    });

    it("masks describe output's Environment section by env name", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "    Environment:",
          "      DB_PASSWORD:  s3cr3t",
          "      DB_HOST:      postgres",
          "      API_TOKEN:    <set to the key 'token' in secret 'api-secret'>  Optional: false",
          "    Mounts:",
          "      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-x7k2q (ro)",
        ),
      );

      expect(result.text).toContain(
        `      DB_PASSWORD:  ${KUBECTL_REDACTED_MARKER}`,
      );
      expect(result.text).toContain("      DB_HOST:      postgres");
      expect(result.text).toContain(
        "      API_TOKEN:    <set to the key 'token' in secret 'api-secret'>  Optional: false",
      );
      expect(result.text).toContain(
        "      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-x7k2q (ro)",
      );
    });
  });

  describe("credential-like keys anywhere", () => {
    it("masks a ServiceAccount token shown by describe secret", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "Name:         default-token-x7k2q",
          "Namespace:    default",
          "Type:  kubernetes.io/service-account-token",
          "",
          "Data",
          "====",
          "ca.crt:     1099 bytes",
          "namespace:  7 bytes",
          `token:      ${JWT}`,
        ),
      );

      expect(result.text).toContain("Name:         default-token-x7k2q");
      expect(result.text).toContain(
        "Type:  kubernetes.io/service-account-token",
      );
      expect(result.text).toContain("namespace:  7 bytes");
      expect(result.text).toContain(`token:      ${KUBECTL_REDACTED_MARKER}`);
      expect(result.text).not.toContain(JWT);
    });

    it("masks kubeconfig-like material and keeps the cluster address", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "clusters:",
          "- cluster:",
          "    certificate-authority-data: LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUM=",
          "    server: https://10.0.0.1:6443",
          "  name: prod",
          "users:",
          "- name: admin",
          "  user:",
          "    client-certificate-data: LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUQ=",
          "    client-key-data: LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQo=",
          "    token: bootstrap-abcdef.0123456789abcdef",
          "    password: hunter2",
          "    username: admin",
        ),
      );

      expect(result.text).toContain("    server: https://10.0.0.1:6443");
      expect(result.text).toContain("  name: prod");
      expect(result.text).toContain("- name: admin");
      expect(result.text).toContain("    username: admin");
      expect(result.text).toContain(
        `    certificate-authority-data: ${KUBECTL_REDACTED_MARKER}`,
      );
      expect(result.text).toContain(
        `    client-certificate-data: ${KUBECTL_REDACTED_MARKER}`,
      );
      expect(result.text).toContain(
        `    client-key-data: ${KUBECTL_REDACTED_MARKER}`,
      );
      expect(result.text).toContain(`    token: ${KUBECTL_REDACTED_MARKER}`);
      expect(result.text).toContain(`    password: ${KUBECTL_REDACTED_MARKER}`);
      expect(result.text).not.toContain("LS0tLS1CRUdJTi");
      expect(result.text).not.toContain("bootstrap-abcdef");
      expect(result.text).not.toContain("hunter2");
    });

    it("masks a credential-like block scalar together with its whole body", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "  tls.key: |",
          "    -----BEGIN EC PRIVATE KEY-----",
          "    MHcCAQEEIA",
          "    -----END EC PRIVATE KEY-----",
          "  next: value",
        ),
      );

      expect(result.text).toBe(
        lines(`  tls.key: ${KUBECTL_REDACTED_MARKER}`, "  next: value"),
      );
    });

    it("masks a credential-like annotation but keeps the pod's other annotations", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "  annotations:",
          '    kubectl.kubernetes.io/restartedAt: "2026-09-22T10:00:00Z"',
          "    vault.hashicorp.com/agent-inject-token: abc123",
          "    cert-manager.io/cluster-issuer: letsencrypt",
          '    prometheus.io/scrape: "true"',
        ),
      );

      expect(result.text).toContain(
        '    kubectl.kubernetes.io/restartedAt: "2026-09-22T10:00:00Z"',
      );
      expect(result.text).toContain(
        `    vault.hashicorp.com/agent-inject-token: ${KUBECTL_REDACTED_MARKER}`,
      );
      expect(result.text).toContain(
        "    cert-manager.io/cluster-issuer: letsencrypt",
      );
      expect(result.text).toContain('    prometheus.io/scrape: "true"');
    });

    /*
     * `host/path:tag` has the shape of an inline pair whose key is
     * credential-like ("auth", "secret-service"). It is an image reference
     * and the tag is what the on-call engineer needs most.
     */
    it("keeps image references whose path looks credential-like, tag included", () => {
      const text: string = lines(
        "    Image:          registry.example.com/auth:1.2.3",
        "    image: ghcr.io/org/secret-service:2.0",
        '    "image": "docker.io/vault/token-broker:v3",',
        "  Image ID:       registry.example.com/auth@sha256:3f5a9c1e2b4d",
        'Normal  Pulled  Successfully pulled image "ghcr.io/org/secret-service:2.0" in 1.2s',
      );

      const result: KubectlOutputRedaction = redact(text);

      expect(result.text).toBe(text);
      expect(result.redactionCount).toBe(0);
    });

    it("still masks a path-shaped annotation key when describe prints it as a pair", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "Annotations:  vault.hashicorp.com/agent-inject-token: abc123",
          "              prometheus.io/scrape: true",
        ),
      );

      expect(result.text).toContain(
        `vault.hashicorp.com/agent-inject-token: ${KUBECTL_REDACTED_MARKER}`,
      );
      expect(result.text).not.toContain("abc123");
      expect(result.text).toContain("prometheus.io/scrape: true");
    });

    it("masks credential-like flags and log pairs in the middle of a line", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "    Args:",
          "      --token-auth-file=/etc/kubernetes/known_tokens.csv",
          "      --authorization-mode=Node,RBAC",
          "      --feature-gates=RotateKubeletServerCertificate=true",
          "      --kubeconfig=/var/lib/kubelet/kubeconfig",
          "2026-09-22T10:00:00Z INFO starting with DB_PASSWORD=hunter2 timeout=1s",
          "2026-09-22T10:00:01Z INFO request x-api-key: abc-123-def op=Exists",
        ),
      );

      expect(result.text).toContain(
        `      --token-auth-file=${KUBECTL_REDACTED_MARKER}`,
      );
      expect(result.text).toContain("      --authorization-mode=Node,RBAC");
      expect(result.text).toContain(
        "      --feature-gates=RotateKubeletServerCertificate=true",
      );
      expect(result.text).toContain(
        "      --kubeconfig=/var/lib/kubelet/kubeconfig",
      );
      expect(result.text).toContain(
        `starting with DB_PASSWORD=${KUBECTL_REDACTED_MARKER} timeout=1s`,
      );
      expect(result.text).toContain(
        `request x-api-key: ${KUBECTL_REDACTED_MARKER} op=Exists`,
      );
      expect(result.text).not.toContain("hunter2");
      expect(result.text).not.toContain("abc-123-def");
    });
  });

  describe("inline material", () => {
    it("masks the password in a URL, with or without a user", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "postgres://app:hunter2@db:5432/app",
          "redis://:s3cr3t@cache:6379/0",
          "https://api.example.com:8443/health",
          "http://user@host/path",
        ),
      );

      expect(result.text).toBe(
        lines(
          `postgres://app:${KUBECTL_REDACTED_MARKER}@db:5432/app`,
          `redis://:${KUBECTL_REDACTED_MARKER}@cache:6379/0`,
          "https://api.example.com:8443/health",
          "http://user@host/path",
        ),
      );
      expect(result.redactionCount).toBe(2);
    });

    it("masks Bearer and Basic authorization tokens but not prose", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "curl -H 'Authorization: Bearer abcdefghijklmnop1234567890'",
          "curl -H 'Authorization: Basic dXNlcjpwYXNz'",
          "Basic configuration loaded",
          "Bearer authentication enabled",
        ),
      );

      expect(result.text).not.toContain("abcdefghijklmnop1234567890");
      expect(result.text).not.toContain("dXNlcjpwYXNz");
      expect(result.text).toContain(
        `Authorization: ${KUBECTL_REDACTED_MARKER}`,
      );
      expect(result.text).toContain("Basic configuration loaded");
      expect(result.text).toContain("Bearer authentication enabled");
    });

    it("masks a bearer token that is not at the start of a line", () => {
      const result: KubectlOutputRedaction = redact(
        "2026-09-22T10:00:00Z DEBUG outbound header Bearer abcdefghijklmnop1234567890 sent",
      );

      expect(result.text).toBe(
        `2026-09-22T10:00:00Z DEBUG outbound header Bearer ${KUBECTL_REDACTED_MARKER} sent`,
      );
    });

    it("masks JWTs and PEM private keys, including a key the output truncated", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          `token=${JWT}`,
          "-----BEGIN RSA PRIVATE KEY-----",
          "MIIEowIBAAKCAQEA",
          "-----END RSA PRIVATE KEY-----",
          "after the key",
          "-----BEGIN PRIVATE KEY-----",
          "MIIEvQIBADANBg",
        ),
      );

      expect(result.text).not.toContain(JWT);
      expect(result.text).not.toContain("MIIEowIBAAKCAQEA");
      expect(result.text).not.toContain("MIIEvQIBADANBg");
      expect(result.text).toContain("[redacted-private-key]");
      expect(result.text).toContain("after the key");
    });

    it("masks padded base64 and long mixed base64 runs but keeps identifiers", () => {
      const longBase64: string =
        "QWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwQUJDREVGR0hJSktMTU5PUA";
      const traceId: string = "4bf92f3577b34da6a3ce929d0e0e4736";
      const result: KubectlOutputRedaction = redact(
        lines(
          `value ${PASSWORD_B64} trailing`,
          `run ${longBase64} trailing`,
          `traceId=${traceId} pod=web-7d9f4c8b5d-x2k9q`,
          "containerID: containerd://3f5a9c1e2b4d6f8a0c1e2b4d6f8a0c1e2b4d6f8a0c1e2b4d6f8a0c1e2b4d6f8a",
          "image: nginx:1.25.3-alpine",
          "revision: NetworkPolicyDefaultDeny",
        ),
      );

      expect(result.text).not.toContain(PASSWORD_B64);
      expect(result.text).not.toContain(longBase64);
      expect(result.text).toContain("[redacted-base64]");
      expect(result.text).toContain(
        `traceId=${traceId} pod=web-7d9f4c8b5d-x2k9q`,
      );
      expect(result.text).toContain(
        "containerID: containerd://3f5a9c1e2b4d6f8a0c1e2b4d6f8a0c1e2b4d6f8a0c1e2b4d6f8a0c1e2b4d6f8a",
      );
      expect(result.text).toContain("image: nginx:1.25.3-alpine");
      expect(result.text).toContain("revision: NetworkPolicyDefaultDeny");
    });

    it("masks one-line JSON data objects and env pairs as jsonpath and logs print them", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          `{"apiVersion":"v1","data":{"password":"${PASSWORD_B64}"},"kind":"Secret"}`,
          '[{"name":"DB_HOST","value":"postgres"},{"name":"DB_PASSWORD","value":"hunter2"},{"value":"sk-live","name":"STRIPE_KEY"}]',
          `map[password:${PASSWORD_B64} username:${ADMIN_B64}]`,
          `{\\"data\\":{\\"password\\":\\"${PASSWORD_B64}\\"},\\"kind\\":\\"Secret\\"}`,
        ),
      );

      expect(result.text).not.toContain(PASSWORD_B64);
      expect(result.text).not.toContain(ADMIN_B64);
      expect(result.text).not.toContain("hunter2");
      expect(result.text).not.toContain("sk-live");
      expect(result.text).toContain('"kind":"Secret"');
      expect(result.text).toContain('{"name":"DB_HOST","value":"postgres"}');
      expect(result.text).toContain(
        `{"name":"DB_PASSWORD","value":"${KUBECTL_REDACTED_MARKER}"}`,
      );
      expect(result.text).toContain(
        `{"value":"${KUBECTL_REDACTED_MARKER}","name":"STRIPE_KEY"}`,
      );
      expect(result.text).toContain(`map[password:${KUBECTL_REDACTED_MARKER}`);
    });

    it("masks a one-line data object the output truncated before its closing brace", () => {
      const result: KubectlOutputRedaction = redact(
        `{"apiVersion":"v1","data":{"password":"${PASSWORD_B64}","token":"${ADMIN_B64}`,
      );

      expect(result.text).not.toContain(PASSWORD_B64);
      expect(result.text).not.toContain(ADMIN_B64);
    });
  });

  describe("ordinary output passes through", () => {
    const untouched: Array<string> = [
      lines(
        "NAME                    READY   STATUS             RESTARTS   AGE",
        "web-7d9f4c8b5d-x2k9q    0/1     CrashLoopBackOff   5          12m",
        "api-6c8b9f7d4-abcde     1/1     Running            0          3d",
      ),
      lines(
        "LAST SEEN   TYPE      REASON      OBJECT                     MESSAGE",
        "2m          Warning   BackOff     pod/web-7d9f4c8b5d-x2k9q   Back-off restarting failed container web in pod web-7d9f4c8b5d-x2k9q_prod(3f5a9c1e-2b4d-6f8a-0c1e-2b4d6f8a0c1e)",
        '5m          Warning   FailedMount pod/web-7d9f4c8b5d-x2k9q   MountVolume.SetUp failed for volume "certs" : secret "tls-cert" not found',
      ),
      lines(
        "  tolerations:",
        "  - effect: NoExecute",
        "    key: node.kubernetes.io/not-ready",
        "    operator: Exists",
        "    tolerationSeconds: 300",
        "  nodeSelector:",
        "    kubernetes.io/os: linux",
        "  affinity:",
        "    nodeAffinity:",
        "      requiredDuringSchedulingIgnoredDuringExecution:",
        "        nodeSelectorTerms:",
        "        - matchExpressions:",
        "          - key: topology.kubernetes.io/zone",
        "            operator: In",
        "            values:",
        "            - us-east-1a",
      ),
      lines(
        "Name:                default",
        "Namespace:           prod",
        "Image pull secrets:  <none>",
        "Mountable secrets:   <none>",
        "Tokens:              <none>",
        "Events:              <none>",
      ),
      lines(
        "  volumes:",
        "  - name: kube-api-access-x7k2q",
        "    projected:",
        "      sources:",
        "      - serviceAccountToken:",
        "          expirationSeconds: 3607",
        "          path: token",
        "      - configMap:",
        "          name: kube-root-ca.crt",
      ),
      lines(
        "Liveness:   http-get http://:8080/healthz delay=0s timeout=1s period=10s #success=1 #failure=3",
        "Node-Selectors:  kubernetes.io/os=linux",
        "Tolerations:     node.kubernetes.io/not-ready:NoExecute op=Exists for 300s",
      ),
      lines(
        "Client Version: v1.31.0",
        "Kustomize Version: v5.4.2",
        "Server Version: v1.30.4-eks-a737599",
      ),
    ];

    it.each(untouched)("leaves %s unchanged", (text: string) => {
      const result: KubectlOutputRedaction = redact(text);
      expect(result.text).toBe(text);
      expect(result.redactionCount).toBe(0);
    });
  });

  describe("shape", () => {
    it("returns empty output for empty input", () => {
      expect(redact("")).toEqual({ text: "", redactionCount: 0 });
    });

    it("normalizes CRLF line endings and still finds the structure", () => {
      const result: KubectlOutputRedaction = redact(
        `apiVersion: v1\r\ndata:\r\n  password: ${PASSWORD_B64}\r\nkind: Secret\r\n`,
      );

      expect(result.text).toBe(
        lines(
          "apiVersion: v1",
          "data:",
          `  password: ${KUBECTL_REDACTED_MARKER}`,
          "kind: Secret",
          "",
        ),
      );
    });

    it("is deterministic and idempotent", () => {
      const input: string = lines(
        "apiVersion: v1",
        "data:",
        `  password: ${PASSWORD_B64}`,
        "kind: Secret",
        "---",
        "env:",
        "- name: API_KEY",
        "  value: abc",
        `Authorization: Bearer ${JWT}`,
      );

      const first: KubectlOutputRedaction = redact(input);
      const second: KubectlOutputRedaction = redact(input);
      expect(second).toEqual(first);
      expect(redact(first.text).text).toBe(first.text);
    });

    it("counts what it masked", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "data:",
          `  a: ${PASSWORD_B64}`,
          `  b: ${ADMIN_B64}`,
          "kind: Secret",
          "password=hunter2",
        ),
      );

      expect(result.redactionCount).toBe(3);
    });
  });
});

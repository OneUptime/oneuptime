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
 *  6. Credential names are recognised in their common spellings (DB_PASS,
 *     RABBITMQ_DEFAULT_PASS, requirepass) without catching "bypass" or
 *     "passthrough".
 *  7. A credential flag whose value is the next argv element — a YAML or
 *     JSON list item, a line of describe's Args block, the next word of a
 *     command line — loses that value; a tool's short password flag
 *     (`mysql -pX`, `redis-cli -a X`) only where the tool is named, so
 *     `mkdir -p` and `ssh -p 22` stay.
 *  8. One-line JSON (`{.data}` jsonpath, structured logs) loses the values
 *     of credential-like keys and still parses.
 *  9. `kubectl describe configmap`'s "KEY:" / "----" / value layout loses a
 *     credential-like key's whole value, however many lines it has.
 * 10. Every rule runs in linear time: ~200 KB shaped to make a regex
 *     backtrack (long dotted runs, flag runs, quote runs, deep indentation)
 *     is redacted in well under a second.
 */

const PASSWORD_B64: string = "cGFzc3dvcmQ=";
const ADMIN_B64: string = "YWRtaW4=";
const JWT: string = `eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9.${"a".repeat(24)}.${"b".repeat(16)}`;

const MARKER: string = KUBECTL_REDACTED_MARKER;

function redact(text: string): KubectlOutputRedaction {
  return KubectlOutputRedactor.redact(text);
}

function lines(...parts: Array<string>): string {
  return parts.join("\n");
}

/*
 * The fixture with the given whole lines replaced, in order. Used as the
 * expected output of a realistic fixture, it pins both what is masked and
 * that every other line passes through byte for byte.
 */
function replaceLines(
  text: string,
  replacements: Array<[string, string]>,
): string {
  const all: Array<string> = text.split("\n");
  let searchFrom: number = 0;
  for (const [from, to] of replacements) {
    const index: number = all.indexOf(from, searchFrom);
    if (index === -1) {
      throw new Error(`The fixture has no line ${JSON.stringify(from)}`);
    }
    all[index] = to;
    searchFrom = index + 1;
  }
  return all.join("\n");
}

// Masking twice changes nothing and finds nothing more to mask.
function expectIdempotent(text: string): void {
  const once: KubectlOutputRedaction = redact(text);
  const twice: KubectlOutputRedaction = redact(once.text);
  expect(twice.text).toBe(once.text);
  expect(twice.redactionCount).toBe(0);
}

/*
 * `kubectl get deployment api -o yaml` — keys sorted as kubectl prints
 * them — with credentials in split-flag args, `*_PASS` env names and an
 * exec probe's `mysqladmin -p…`, next to ordinary configuration that must
 * stay readable.
 */
const DEPLOYMENT_YAML: string = lines(
  "apiVersion: apps/v1",
  "kind: Deployment",
  "metadata:",
  "  annotations:",
  '    deployment.kubernetes.io/revision: "3"',
  '  creationTimestamp: "2026-09-20T08:15:30Z"',
  "  generation: 3",
  "  labels:",
  "    app: api",
  "  name: api",
  "  namespace: prod",
  '  resourceVersion: "48213377"',
  "  uid: 5b1c7f0e-3a2d-4c8e-9f61-2d7a9b0c4e11",
  "spec:",
  "  progressDeadlineSeconds: 600",
  "  replicas: 2",
  "  revisionHistoryLimit: 10",
  "  selector:",
  "    matchLabels:",
  "      app: api",
  "  strategy:",
  "    rollingUpdate:",
  "      maxSurge: 25%",
  "      maxUnavailable: 25%",
  "    type: RollingUpdate",
  "  template:",
  "    metadata:",
  "      creationTimestamp: null",
  "      labels:",
  "        app: api",
  "    spec:",
  "      containers:",
  "      - args:",
  "        - --port",
  '        - "8080"',
  "        - --log-level",
  "        - info",
  "        - --db-password",
  "        - Sup3rS3cretPw",
  "        - --api-token",
  "        - tok_live_9f8e7d6c5b",
  "        - --tail",
  '        - "100"',
  "        - --feature-gates",
  "        - Foo=true",
  "        - --verbose",
  "        command:",
  "        - /app/server",
  "        env:",
  "        - name: DB_HOST",
  "          value: postgres.prod.svc",
  "        - name: DB_PASS",
  "          value: Hunter2DbPass",
  "        - name: SMTP_PASS",
  "          value: SmtpPw-771",
  "        - name: RABBITMQ_DEFAULT_PASS",
  "          value: rabbitPw12",
  "        - name: BYPASS_CACHE",
  '          value: "true"',
  "        - name: DB_PASSWORD",
  "          valueFrom:",
  "            secretKeyRef:",
  "              key: password",
  "              name: db-creds",
  "        image: ghcr.io/acme/api:2.14.1",
  "        imagePullPolicy: IfNotPresent",
  "        livenessProbe:",
  "          exec:",
  "            command:",
  "            - mysqladmin",
  "            - ping",
  "            - -uroot",
  "            - -pRootPw99",
  "          failureThreshold: 3",
  "          initialDelaySeconds: 10",
  "          periodSeconds: 10",
  "          successThreshold: 1",
  "          timeoutSeconds: 5",
  "        name: api",
  "        ports:",
  "        - containerPort: 8080",
  "          protocol: TCP",
  "        resources: {}",
  "        terminationMessagePath: /dev/termination-log",
  "        terminationMessagePolicy: File",
  "      - args:",
  "        - --requirepass",
  "        - R3disPw",
  "        - --appendonly",
  '        - "yes"',
  "        command:",
  "        - redis-server",
  "        image: redis:7.2.4",
  "        imagePullPolicy: IfNotPresent",
  "        name: cache",
  "        resources: {}",
  "      dnsPolicy: ClusterFirst",
  "      restartPolicy: Always",
  "      schedulerName: default-scheduler",
  "      securityContext: {}",
  "      terminationGracePeriodSeconds: 30",
  "status:",
  "  availableReplicas: 2",
  "  conditions:",
  '  - lastTransitionTime: "2026-09-20T08:16:02Z"',
  '    lastUpdateTime: "2026-09-20T08:16:02Z"',
  "    message: Deployment has minimum availability.",
  "    reason: MinimumReplicasAvailable",
  '    status: "True"',
  "    type: Available",
  "  observedGeneration: 3",
  "  readyReplicas: 2",
  "  replicas: 2",
  "  updatedReplicas: 2",
);

// `kubectl describe pod` for the same workload.
const DESCRIBE_POD: string = lines(
  "Name:             api-7d9f4c8b5d-x2k9q",
  "Namespace:        prod",
  "Priority:         0",
  "Service Account:  default",
  "Node:             ip-10-0-1-23.ec2.internal/10.0.1.23",
  "Start Time:       Tue, 22 Sep 2026 10:00:00 +0000",
  "Labels:           app=api",
  "                  pod-template-hash=7d9f4c8b5d",
  "Annotations:      <none>",
  "Status:           Running",
  "IP:               10.0.1.57",
  "IPs:",
  "  IP:           10.0.1.57",
  "Controlled By:  ReplicaSet/api-7d9f4c8b5d",
  "Containers:",
  "  api:",
  "    Container ID:  containerd://3f5a9c1e2b4d6f8a0c1e2b4d6f8a0c1e2b4d6f8a0c1e2b4d6f8a0c1e2b4d6f8a",
  "    Image:         ghcr.io/acme/api:2.14.1",
  "    Image ID:      ghcr.io/acme/api@sha256:9b2d4f6a8c0e1a3b5d7f9b2d4f6a8c0e1a3b5d7f9b2d4f6a8c0e1a3b5d7f9b2d",
  "    Port:          8080/TCP",
  "    Host Port:     0/TCP",
  "    Command:",
  "      /app/server",
  "    Args:",
  "      --port",
  "      8080",
  "      --log-level",
  "      info",
  "      --db-password",
  "      Sup3rS3cretPw",
  "      --api-token",
  "      tok_live_9f8e7d6c5b",
  "      --verbose",
  "    State:          Running",
  "      Started:      Tue, 22 Sep 2026 10:00:05 +0000",
  "    Ready:          True",
  "    Restart Count:  0",
  "    Liveness:       exec [mysqladmin ping -uroot -pRootPw99] delay=10s timeout=5s period=10s #success=1 #failure=3",
  "    Environment:",
  "      DB_HOST:                postgres.prod.svc",
  "      DB_PASS:                Hunter2DbPass",
  "      SMTP_PASS:              SmtpPw-771",
  "      RABBITMQ_DEFAULT_PASS:  rabbitPw12",
  "      BYPASS_CACHE:           true",
  "      DB_PASSWORD:            <set to the key 'password' in secret 'db-creds'>  Optional: false",
  "    Mounts:",
  "      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-x7k2q (ro)",
  "  cache:",
  "    Container ID:  containerd://8c0e1a3b5d7f9b2d4f6a8c0e1a3b5d7f9b2d4f6a8c0e1a3b5d7f9b2d4f6a8c0e",
  "    Image:         redis:7.2.4",
  "    Image ID:      docker.io/library/redis@sha256:1a3b5d7f9b2d4f6a8c0e1a3b5d7f9b2d4f6a8c0e1a3b5d7f9b2d4f6a8c0e1a3b",
  "    Port:          <none>",
  "    Host Port:     <none>",
  "    Command:",
  "      redis-server",
  "    Args:",
  "      --requirepass",
  "      R3disPw",
  "      --appendonly",
  "      yes",
  "    State:          Running",
  "      Started:      Tue, 22 Sep 2026 10:00:04 +0000",
  "    Ready:          True",
  "    Restart Count:  0",
  "    Environment:    <none>",
  "    Mounts:",
  "      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-x7k2q (ro)",
  "Conditions:",
  "  Type                        Status",
  "  PodReadyToStartContainers   True",
  "  Initialized                 True",
  "  Ready                       True",
  "  ContainersReady             True",
  "  PodScheduled                True",
  "Volumes:",
  "  kube-api-access-x7k2q:",
  "    Type:                    Projected (a volume that contains injected data from multiple sources)",
  "    TokenExpirationSeconds:  3607",
  "    ConfigMapName:           kube-root-ca.crt",
  "    ConfigMapOptional:       <nil>",
  "    DownwardAPI:             true",
  "QoS Class:                   BestEffort",
  "Node-Selectors:              <none>",
  "Tolerations:                 node.kubernetes.io/not-ready:NoExecute op=Exists for 300s",
  "                             node.kubernetes.io/unreachable:NoExecute op=Exists for 300s",
  "Events:",
  "  Type    Reason     Age   From               Message",
  "  ----    ------     ----  ----               -------",
  "  Normal  Scheduled  2m    default-scheduler  Successfully assigned prod/api-7d9f4c8b5d-x2k9q to ip-10-0-1-23.ec2.internal",
  '  Normal  Pulled     2m    kubelet            Container image "ghcr.io/acme/api:2.14.1" already present on machine',
  "  Normal  Created    2m    kubelet            Created container: api",
  "  Normal  Started    2m    kubelet            Started container api",
);

// The literals no fixture may leak.
const POD_SECRETS: Array<string> = [
  "Sup3rS3cretPw",
  "tok_live_9f8e7d6c5b",
  "Hunter2DbPass",
  "SmtpPw-771",
  "rabbitPw12",
  "RootPw99",
  "R3disPw",
];

/*
 * The values a Pod object carries in its credential-bearing fields, so the
 * same builder yields both the fixture and the expected redaction.
 */
interface PodCredentials {
  lastApplied: string;
  dbPasswordArg: string;
  apiTokenArg: string;
  dbPass: string;
  smtpPass: string;
  mysqlPasswordFlag: string;
  redisPassArg: string;
}

const REAL_POD_CREDENTIALS: PodCredentials = {
  lastApplied: `${JSON.stringify({
    apiVersion: "v1",
    kind: "Pod",
    spec: {
      containers: [
        {
          args: ["--db-password", "Sup3rS3cretPw"],
          env: [{ name: "DB_PASS", value: "Hunter2DbPass" }],
          name: "api",
        },
      ],
    },
  })}\n`,
  dbPasswordArg: "Sup3rS3cretPw",
  apiTokenArg: "tok_live_9f8e7d6c5b",
  dbPass: "Hunter2DbPass",
  smtpPass: "SmtpPw-771",
  mysqlPasswordFlag: "-pRootPw99",
  redisPassArg: "R3disPw",
};

const MASKED_POD_CREDENTIALS: PodCredentials = {
  lastApplied: MARKER,
  dbPasswordArg: MARKER,
  apiTokenArg: MARKER,
  dbPass: MARKER,
  smtpPass: MARKER,
  mysqlPasswordFlag: `-p${MARKER}`,
  redisPassArg: MARKER,
};

// `kubectl get pod -o json` for the same workload.
function buildPod(credentials: PodCredentials): Record<string, unknown> {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      annotations: {
        "kubectl.kubernetes.io/last-applied-configuration":
          credentials.lastApplied,
        "prometheus.io/scrape": "true",
      },
      creationTimestamp: "2026-09-22T10:00:00Z",
      generateName: "api-7d9f4c8b5d-",
      labels: { app: "api", "pod-template-hash": "7d9f4c8b5d" },
      name: "api-7d9f4c8b5d-x2k9q",
      namespace: "prod",
      ownerReferences: [
        {
          apiVersion: "apps/v1",
          blockOwnerDeletion: true,
          controller: true,
          kind: "ReplicaSet",
          name: "api-7d9f4c8b5d",
          uid: "0d6e8f1a-2b3c-4d5e-8f90-a1b2c3d4e5f6",
        },
      ],
      resourceVersion: "48213377",
      uid: "5b1c7f0e-3a2d-4c8e-9f61-2d7a9b0c4e11",
    },
    spec: {
      automountServiceAccountToken: true,
      containers: [
        {
          args: [
            "--port",
            "8080",
            "--log-level",
            "info",
            "--db-password",
            credentials.dbPasswordArg,
            "--api-token",
            credentials.apiTokenArg,
            "--verbose",
          ],
          command: ["/app/server"],
          env: [
            { name: "DB_HOST", value: "postgres.prod.svc" },
            { name: "DB_PASS", value: credentials.dbPass },
            { name: "SMTP_PASS", value: credentials.smtpPass },
            { name: "BYPASS_CACHE", value: "true" },
            {
              name: "DB_PASSWORD",
              valueFrom: {
                secretKeyRef: { key: "password", name: "db-creds" },
              },
            },
          ],
          image: "ghcr.io/acme/api:2.14.1",
          livenessProbe: {
            exec: {
              command: [
                "mysqladmin",
                "ping",
                "-uroot",
                credentials.mysqlPasswordFlag,
              ],
            },
            initialDelaySeconds: 10,
            periodSeconds: 10,
          },
          name: "api",
          ports: [{ containerPort: 8080, protocol: "TCP" }],
          volumeMounts: [
            {
              mountPath: "/var/run/secrets/kubernetes.io/serviceaccount",
              name: "kube-api-access-x7k2q",
              readOnly: true,
            },
          ],
        },
        {
          args: [
            "--requirepass",
            credentials.redisPassArg,
            "--appendonly",
            "yes",
          ],
          command: ["redis-server"],
          image: "redis:7.2.4",
          name: "cache",
        },
      ],
      serviceAccountName: "default",
      tolerations: [
        {
          effect: "NoExecute",
          key: "node.kubernetes.io/not-ready",
          operator: "Exists",
          tolerationSeconds: 300,
        },
      ],
      volumes: [
        {
          name: "kube-api-access-x7k2q",
          projected: {
            defaultMode: 420,
            sources: [
              {
                serviceAccountToken: { expirationSeconds: 3607, path: "token" },
              },
              {
                configMap: {
                  items: [{ key: "ca.crt", path: "ca.crt" }],
                  name: "kube-root-ca.crt",
                },
              },
            ],
          },
        },
        {
          name: "db-creds",
          secret: { defaultMode: 420, secretName: "db-creds" },
        },
      ],
    },
    status: {
      containerStatuses: [
        {
          containerID:
            "containerd://3f5a9c1e2b4d6f8a0c1e2b4d6f8a0c1e2b4d6f8a0c1e2b4d6f8a0c1e2b4d6f8a",
          image: "ghcr.io/acme/api:2.14.1",
          imageID:
            "ghcr.io/acme/api@sha256:9b2d4f6a8c0e1a3b5d7f9b2d4f6a8c0e1a3b5d7f9b2d4f6a8c0e1a3b5d7f9b2d",
          lastState: {},
          name: "api",
          ready: true,
          restartCount: 0,
          started: true,
          state: { running: { startedAt: "2026-09-22T10:00:05Z" } },
        },
      ],
      hostIP: "10.0.1.23",
      phase: "Running",
      podIP: "10.0.1.57",
      podIPs: [{ ip: "10.0.1.57" }],
      qosClass: "BestEffort",
      startTime: "2026-09-22T10:00:00Z",
    },
  };
}

/*
 * `kubectl describe configmap app-config`, in the layout kubectl's
 * describeConfigMap writes: "KEY:", "----", the value verbatim, a blank
 * line; then "BinaryData" / "====".
 */
const DESCRIBE_CONFIGMAP: string = lines(
  "Name:         app-config",
  "Namespace:    prod",
  "Labels:       app=api",
  "Annotations:  <none>",
  "",
  "Data",
  "====",
  "DB_PASSWORD:",
  "----",
  "hunter2",
  "",
  "LOG_LEVEL:",
  "----",
  "debug",
  "",
  "api_token:",
  "----",
  "tok-abc-123",
  "",
  "app.properties:",
  "----",
  "server.port=8080",
  "db.user=app",
  "db.password=propPw77",
  "",
  "tls.key:",
  "----",
  "-----BEGIN EC PRIVATE KEY-----",
  "MHcCAQEEIA",
  "",
  "MHcCAQEEIB",
  "-----END EC PRIVATE KEY-----",
  "",
  "SMTP_PASS:",
  "----",
  "smtpPw-771",
  "",
  "",
  "BinaryData",
  "====",
  "",
  "Events:  <none>",
);

// `kubectl logs` of an app that writes structured JSON next to plain lines.
const JSON_LOGS: string = lines(
  "2026-09-22T10:00:00.000Z INFO  server listening on :8080",
  '{"level":"info","ts":"2026-09-22T10:00:00.120Z","msg":"starting","version":"2.14.1","pod":"api-7d9f4c8b5d-x2k9q"}',
  '{"level":"debug","ts":"2026-09-22T10:00:00.130Z","msg":"db config","host":"postgres.prod.svc","user":"app","password":"hunter2-jsonlog","token":"tok-jsonlog-123","timeout":"30s"}',
  '{"level": "debug", "msg": "smtp config", "SMTP_PASS": "smtp-spaced-1", "port": 587}',
  '{"level":"info","msg":"request","method":"GET","path":"/healthz","status":200,"duration_ms":3,"trace_id":"4bf92f3577b34da6a3ce929d0e0e4736"}',
  '{"level":"warn","msg":"retrying with body={\\"password\\":\\"hunter2-esc\\",\\"user\\":\\"bob\\"}"}',
  '{"level":"info","msg":"loaded config\\npassword: hunter2-nl\\nuser: bob"}',
  '{"level":"error","msg":"auth failed","error":"invalid credentials","attempt":3}',
  '{"level":"info","msg":"session","api_key":12345678,"mfa":true}',
);

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

    it("masks a URL password after any scheme spelling, and leaves a non-scheme alone", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "mongodb+srv://app:hunter2@cluster0.example.net/db",
          "HTTPS://admin:s3cr3t@internal.example.com",
          "url=(postgres://app:hunter2@db)",
          "'amqp://guest:guest@rabbit:5672'",
          "see.postgres://app:hunter2@db and x-redis://:pw@cache",
          `${"a.".repeat(2000)}postgres://app:hunter2@db`,
          "1://app:hunter2@db",
        ),
      );

      expect(result.text).toBe(
        lines(
          `mongodb+srv://app:${MARKER}@cluster0.example.net/db`,
          `HTTPS://admin:${MARKER}@internal.example.com`,
          `url=(postgres://app:${MARKER}@db)`,
          `'amqp://guest:${MARKER}@rabbit:5672'`,
          `see.postgres://app:${MARKER}@db and x-redis://:${MARKER}@cache`,
          `${"a.".repeat(2000)}postgres://app:${MARKER}@db`,
          // A scheme starts with a letter.
          "1://app:hunter2@db",
        ),
      );
    });

    /*
     * The URL rule used to start its match at the scheme,
     * /(\b[a-z][a-z0-9+.-]*:\/\/)…/, which retried from every word boundary
     * of a long dotted run and backtracked through the whole run each time
     * (200 KB of "eyJ.eyJ.…" took over 30 seconds). It now starts at "://"
     * and checks the scheme behind it. This pins that the rewrite masks
     * exactly what the scheme-first pattern masked, over a seeded corpus of
     * URL-shaped strings with every awkward neighbour a scheme, a user or a
     * password can have.
     */
    it("masks exactly what the scheme-first URL pattern masked", () => {
      const schemeFirst: RegExp =
        /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/:@"']*):([^\s/@"']+)@/gi;
      /*
       * No "=": with it, a password such as "2p1=" is also padded base64,
       * which another rule masks — this compares the URL rule alone.
       */
      const junk: Array<string> = [
        " ",
        "x",
        ".",
        "-",
        "+",
        "_",
        "1",
        "(",
        "'",
        '"',
        "/",
        ":",
        "@",
        "A",
      ];
      const scheme: Array<string> = [
        "a",
        "b",
        "Z",
        "1",
        ".",
        "-",
        "+",
        "_",
        "p",
        "g",
      ];
      const user: Array<string> = [
        "u",
        "1",
        ".",
        "-",
        "_",
        "%",
        "@",
        ":",
        "/",
        " ",
      ];
      const pass: Array<string> = [
        "p",
        "2",
        ":",
        "!",
        "#",
        "%",
        ".",
        "-",
        "/",
        "@",
        " ",
        "'",
      ];
      let state: number = 3953;
      const random: () => number = (): number => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
      };
      const word: (alphabet: Array<string>, max: number) => string = (
        alphabet: Array<string>,
        max: number,
      ): string => {
        let text: string = "";
        const length: number = Math.floor(random() * (max + 1));
        for (let i: number = 0; i < length; i++) {
          text += alphabet[Math.floor(random() * alphabet.length)];
        }
        return text;
      };

      const maskSchemeFirst: (text: string) => string = (
        text: string,
      ): string => {
        return text.replace(
          schemeFirst,
          (_match: string, prefix: string, name: string): string => {
            return `${prefix}${name}:${MARKER}@`;
          },
        );
      };

      let maskedByBoth: number = 0;

      for (let sample: number = 0; sample < 10000; sample++) {
        const text: string = `${word(junk, 3)}${word(scheme, 5)}://${word(user, 3)}${random() < 0.8 ? ":" : ""}${word(pass, 4)}${random() < 0.8 ? "@" : ""}${word(junk, 3)}`;
        const expected: string = maskSchemeFirst(text);

        if (expected !== text) {
          maskedByBoth++;
        }

        expect({ text, redacted: redact(text).text }).toEqual({
          text,
          redacted: expected,
        });
      }

      // The corpus is not vacuous: hundreds of samples carry a password.
      expect(maskedByBoth).toBeGreaterThan(700);
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

  describe("credential name spellings", () => {
    it("masks *_PASS, *_PW and *_CREDS env values in describe's Environment section and keeps the keys", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "    Environment:",
          "      DB_HOST:                postgres",
          "      DB_PASS:                Hunter2DbPass",
          "      SMTP_PASS:              SmtpPw-771",
          "      REDIS_PASS:             R3disPw",
          "      RABBITMQ_DEFAULT_PASS:  rabbitPw12",
          "      MYSQL_ROOT_PASS:        rootPw-445",
          "      LDAP_BIND_PW:           ldapPw-9",
          "      DB_CREDS:               app:credsPw1",
          "      API_TOKEN:              <set to the key 'token' in secret 'api-secret'>  Optional: false",
        ),
      );

      expect(result.text).toBe(
        lines(
          "    Environment:",
          "      DB_HOST:                postgres",
          `      DB_PASS:                ${MARKER}`,
          `      SMTP_PASS:              ${MARKER}`,
          `      REDIS_PASS:             ${MARKER}`,
          `      RABBITMQ_DEFAULT_PASS:  ${MARKER}`,
          `      MYSQL_ROOT_PASS:        ${MARKER}`,
          `      LDAP_BIND_PW:           ${MARKER}`,
          `      DB_CREDS:               ${MARKER}`,
          "      API_TOKEN:              <set to the key 'token' in secret 'api-secret'>  Optional: false",
        ),
      );
      expect(result.redactionCount).toBe(7);
    });

    it("masks *_PASS env values in YAML, with the value after or before the name", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "    env:",
          "    - name: DB_PASS",
          "      value: hunter2-yaml-pass",
          "    - value: rabbit1",
          "      name: RABBITMQ_DEFAULT_PASS",
          "    - name: LOG_LEVEL",
          "      value: debug",
        ),
      );

      expect(result.text).toBe(
        lines(
          "    env:",
          "    - name: DB_PASS",
          `      value: ${MARKER}`,
          `    - value: ${MARKER}`,
          "      name: RABBITMQ_DEFAULT_PASS",
          "    - name: LOG_LEVEL",
          "      value: debug",
        ),
      );
    });

    it("masks *_PASS names in one-line JSON env pairs, log pairs and ConfigMap data", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          '[{"name":"SMTP_PASS","value":"x1y2"},{"name":"LOG_LEVEL","value":"debug"}]',
          "2026-09-22T10:00:00Z INFO connecting DB_PASS=log-leak SMTP_PASS=smtp-leak timeout=1s",
          "apiVersion: v1",
          "data:",
          "  DB_PASS: cm-leak",
          "  LOG_LEVEL: info",
          "kind: ConfigMap",
        ),
      );

      expect(result.text).toBe(
        lines(
          `[{"name":"SMTP_PASS","value":"${MARKER}"},{"name":"LOG_LEVEL","value":"debug"}]`,
          `2026-09-22T10:00:00Z INFO connecting DB_PASS=${MARKER} SMTP_PASS=${MARKER} timeout=1s`,
          "apiVersion: v1",
          "data:",
          `  DB_PASS: ${MARKER}`,
          "  LOG_LEVEL: info",
          "kind: ConfigMap",
        ),
      );
    });

    it("masks Redis's requirepass / masterauth and a bare --pass flag", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "requirepass: r3dis-conf",
          "masterauth: m4ster",
          "      --requirepass=R3disPw",
          "      --pass=plainPw1",
          "dbpass: glued-prefix-1",
        ),
      );

      expect(result.text).toBe(
        lines(
          `requirepass: ${MARKER}`,
          `masterauth: ${MARKER}`,
          `      --requirepass=${MARKER}`,
          `      --pass=${MARKER}`,
          `dbpass: ${MARKER}`,
        ),
      );
    });

    /*
     * "pass" only counts as a whole segment: these are ordinary settings,
     * test results and ingress annotations, not credentials.
     */
    it.each([
      "bypass: true",
      "BYPASS_CACHE: true",
      "compass: north",
      "surpass: 1",
      "passthrough: enabled",
      'ssl-passthrough: "true"',
      '    nginx.ingress.kubernetes.io/ssl-passthrough: "true"',
      "pass-through-mode: on",
      'PASS_THROUGH: "1"',
      "PASSIVE_MODE: true",
      "MAX_PASSES: 3",
      "Passed: 3",
      "passenger_count=4",
    ])("keeps %s", (text: string) => {
      const result: KubectlOutputRedaction = redact(text);
      expect(result.text).toBe(text);
      expect(result.redactionCount).toBe(0);
    });
  });

  describe("credential flags whose value is the next argv element", () => {
    it("masks the element after a credential flag in a YAML args list and keeps every other element", () => {
      const yaml: string = lines(
        "      - args:",
        "        - --port",
        '        - "8080"',
        "        - --db-password",
        "        - Sup3rS3cretPw",
        "        - --log-level",
        "        - debug",
        "        - --api-token",
        '        - "tok_live_9f8e7d6c5b"',
        "        - --tail",
        '        - "100"',
        "        - --verbose",
        "        name: api",
      );

      const result: KubectlOutputRedaction = redact(yaml);

      expect(result.text).toBe(
        replaceLines(yaml, [
          ["        - Sup3rS3cretPw", `        - ${MARKER}`],
          ['        - "tok_live_9f8e7d6c5b"', `        - "${MARKER}"`],
        ]),
      );
      expect(result.redactionCount).toBe(2);
    });

    it("keeps a credential flag's next element when it is itself a flag", () => {
      const yaml: string = lines(
        "        - --db-password",
        "        - --next-flag",
        "        - --password-stdin",
        "        - --username",
        "        - admin",
      );

      const result: KubectlOutputRedaction = redact(yaml);

      expect(result.text).toBe(yaml);
      expect(result.redactionCount).toBe(0);
    });

    it("does not pair a flag with a line of a different list or shape", () => {
      const yaml: string = lines(
        "        - --db-password",
        "        command:",
        "        - /app/server",
        "      - --api-token",
        "        name: api",
        "    - name: x",
        "      value: y",
      );

      const result: KubectlOutputRedaction = redact(yaml);

      expect(result.text).toBe(yaml);
    });

    it("masks describe's one-token-per-line Args block", () => {
      const describeOutput: string = lines(
        "    Command:",
        "      /app/server",
        "    Args:",
        "      --port",
        "      8080",
        "      --db-password",
        "      Sup3rS3cretPw",
        "      --api-token",
        "      tok_live_x",
        "      --verbose",
        "    State:          Running",
      );

      const result: KubectlOutputRedaction = redact(describeOutput);

      expect(result.text).toBe(
        replaceLines(describeOutput, [
          ["      Sup3rS3cretPw", `      ${MARKER}`],
          ["      tok_live_x", `      ${MARKER}`],
        ]),
      );
    });

    it("masks an argument describe prints with ': ' in it, since it follows a credential flag", () => {
      const result: KubectlOutputRedaction = redact(
        lines("    Args:", "      --db-password", "      s3cr3t: with colon"),
      );

      expect(result.text).toBe(
        lines("    Args:", "      --db-password", `      ${MARKER}`),
      );
    });

    it("masks a pretty-printed JSON args array and keeps it parseable", () => {
      const json: string = JSON.stringify(
        {
          args: [
            "--db-password",
            "Sup3rS3cretPw",
            "--port",
            "8080",
            "--requirepass",
            "R3disPw",
          ],
        },
        null,
        4,
      );

      const result: KubectlOutputRedaction = redact(json);

      expect(JSON.parse(result.text)).toEqual({
        args: [
          "--db-password",
          MARKER,
          "--port",
          "8080",
          "--requirepass",
          MARKER,
        ],
      });
    });

    it("masks a one-line JSON args array — plain, escaped inside a string, and Python-quoted", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          '["--db-password","Sup3rS3cretPw","--port","8080"] ["--requirepass", "R3disPw", "--appendonly", "yes"]',
          '{"msg":"container args [\\"--db-password\\",\\"EscPw1\\"]"}',
          "argv=['--api-token', 'tok_live_py']",
        ),
      );

      expect(result.text).toBe(
        lines(
          `["--db-password","${MARKER}","--port","8080"] ["--requirepass", "${MARKER}", "--appendonly", "yes"]`,
          `{"msg":"container args [\\"--db-password\\",\\"${MARKER}\\"]"}`,
          `argv=['--api-token', '${MARKER}']`,
        ),
      );
      expect(result.redactionCount).toBe(4);
    });

    it("masks a credential flag's value inside one command line", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "redis-server --requirepass R3disPw --appendonly yes",
          "mysqld --password Hunter2Mysql --port 3306",
          "influxd -password Infl8x --http-bind-address :8086",
          'app --db-password "pass phrase" --verbose',
          "        - redis-server --requirepass R3disPw2 --masterauth M4ster",
          "    Liveness:  exec [redis-cli --pass R3disPw3 ping] delay=0s timeout=1s",
          '{"cmd":"redis-server --requirepass EscR3dis\\"}',
        ),
      );

      expect(result.text).toBe(
        lines(
          `redis-server --requirepass ${MARKER} --appendonly yes`,
          `mysqld --password ${MARKER} --port 3306`,
          `influxd -password ${MARKER} --http-bind-address :8086`,
          `app --db-password "${MARKER}" --verbose`,
          `        - redis-server --requirepass ${MARKER} --masterauth ${MARKER}`,
          `    Liveness:  exec [redis-cli --pass ${MARKER} ping] delay=0s timeout=1s`,
          `{"cmd":"redis-server --requirepass ${MARKER}\\"}`,
        ),
      );
    });

    it.each([
      [
        "mysql -h db -uroot -pS3cretPw -e 'select 1'",
        `mysql -h db -uroot -p${MARKER} -e 'select 1'`,
      ],
      [
        "mysqldump --single-transaction -u app -pDumpPw1 app > /backup/app.sql",
        `mysqldump --single-transaction -u app -p${MARKER} app > /backup/app.sql`,
      ],
      [
        "/usr/bin/mysqladmin ping -uroot -pRootPw99",
        `/usr/bin/mysqladmin ping -uroot -p${MARKER}`,
      ],
      [
        "mongosh --host db -u admin -p M0ngoPw --quiet",
        `mongosh --host db -u admin -p ${MARKER} --quiet`,
      ],
      [
        "sshpass -p SshPw1 scp backup.tgz host:/backups",
        `sshpass -p ${MARKER} scp backup.tgz host:/backups`,
      ],
      [
        "redis-cli -h cache -p 6379 -a R3disPw ping",
        `redis-cli -h cache -p 6379 -a ${MARKER} ping`,
      ],
      [
        "sh -c 'mysqladmin ping -uroot -pRootPw99 && echo ok'",
        `sh -c 'mysqladmin ping -uroot -p${MARKER} && echo ok'`,
      ],
      [
        "    Liveness:       exec [mysqladmin ping -uroot -pRootPw99] delay=10s timeout=5s period=10s #success=1 #failure=3",
        `    Liveness:       exec [mysqladmin ping -uroot -p${MARKER}] delay=10s timeout=5s period=10s #success=1 #failure=3`,
      ],
      [
        '["mysqladmin","ping","-uroot","-pRootPw99"] ["sshpass","-p","SshPw1","ssh","host"]',
        `["mysqladmin","ping","-uroot","-p${MARKER}"] ["sshpass","-p","${MARKER}","ssh","host"]`,
      ],
    ])(
      "masks a tool's short password flag where the tool is named: %s",
      (input: string, expected: string) => {
        const result: KubectlOutputRedaction = redact(input);
        expect(result.text).toBe(expected);
        // One redaction per marker in the expected text.
        expect(result.redactionCount).toBe(expected.split(MARKER).length - 1);
      },
    );

    it("masks a tool's short password flag in a one-element-per-line list that names the tool", () => {
      const yaml: string = lines(
        "          exec:",
        "            command:",
        "            - mysqladmin",
        "            - ping",
        "            - -uroot",
        "            - -pRootPw99",
        "    Command:",
        "      sshpass",
        "      -p",
        "      SshPw1",
        "      ssh",
        "      host",
      );

      const result: KubectlOutputRedaction = redact(yaml);

      expect(result.text).toBe(
        replaceLines(yaml, [
          ["            - -pRootPw99", `            - -p${MARKER}`],
          ["      SshPw1", `      ${MARKER}`],
        ]),
      );
    });

    /*
     * `-p` is a port, "make parents", "preserve"… for every other tool:
     * without a password tool named on the line or in the list, it and
     * its neighbour stay.
     */
    it.each([
      "mkdir -p /data/cache && chown -R 1000 /data",
      "docker run -p 8080:80 nginx:1.25",
      "ssh -p 2222 deploy@bastion",
      "psql -h db -p 5432 -U app -d orders",
      "redis-cli -h cache -p 6379 ping",
      "tar -pxzf backup.tar.gz -C /restore",
      "cp -p /etc/app/config.yaml /tmp/",
      "mysql -h db -P 3306 -u app --protocol=tcp orders",
      "app --port 8080 --tail 100 --log-level debug --feature-gates Foo=true",
      "Flags: --since 1h --timestamps",
      lines("        - -p", '        - "8080"'),
      lines("      - mkdir", "      - -p", "      - /data"),
      lines("    Args:", "      -p", "      8080"),
    ])("keeps %s", (text: string) => {
      const result: KubectlOutputRedaction = redact(text);
      expect(result.text).toBe(text);
      expect(result.redactionCount).toBe(0);
    });

    /*
     * The exact shapes the review reproduced: a pod YAML's split args, a
     * describe Args block, a JSON args array and a describe Environment
     * `*_PASS` entry all leaked through with a count of 0.
     */
    it("leaves none of the reproduced literals and counts each one", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "    args:",
          "    - --db-password",
          "    - Sup3rS3cretPw",
          "    Args:",
          "      --api-token",
          "      tok_live_x",
          '    "args": ["--password", "JsonArgPw"],',
          "    Environment:",
          "      DB_PASS:  Hunter2",
        ),
      );

      for (const literal of [
        "Sup3rS3cretPw",
        "tok_live_x",
        "JsonArgPw",
        "Hunter2",
      ]) {
        expect(result.text).not.toContain(literal);
      }
      expect(result.redactionCount).toBe(4);
    });
  });

  describe("one-line JSON with credential-like keys", () => {
    it("masks a jsonpath {.data} ConfigMap map and keeps its other values", () => {
      const input: string =
        '{"DB_PASSWORD":"hunter2","LOG_LEVEL":"info","api_key":"k3y-value","secretName":"db-creds","SMTP_PASS":"smtp9"}';

      const result: KubectlOutputRedaction = redact(input);

      expect(result.text).toBe(
        `{"DB_PASSWORD":"${MARKER}","LOG_LEVEL":"info","api_key":"${MARKER}","secretName":"db-creds","SMTP_PASS":"${MARKER}"}`,
      );
      expect(JSON.parse(result.text)).toEqual({
        DB_PASSWORD: MARKER,
        LOG_LEVEL: "info",
        api_key: MARKER,
        secretName: "db-creds",
        SMTP_PASS: MARKER,
      });
      expect(result.redactionCount).toBe(3);
    });

    it("masks a credential key and keeps the next one", () => {
      expect(redact('{"password":"x","LOG_LEVEL":"debug"}').text).toBe(
        `{"password":"${MARKER}","LOG_LEVEL":"debug"}`,
      );
      expect(redact('{"password":"x","token":"y"}').text).toBe(
        `{"password":"${MARKER}","token":"${MARKER}"}`,
      );
    });

    it("masks structured log lines, compact, spaced, escaped and with escaped line breaks, and every JSON line still parses", () => {
      const result: KubectlOutputRedaction = redact(JSON_LOGS);

      expect(result.text).toBe(
        replaceLines(JSON_LOGS, [
          [
            '{"level":"debug","ts":"2026-09-22T10:00:00.130Z","msg":"db config","host":"postgres.prod.svc","user":"app","password":"hunter2-jsonlog","token":"tok-jsonlog-123","timeout":"30s"}',
            `{"level":"debug","ts":"2026-09-22T10:00:00.130Z","msg":"db config","host":"postgres.prod.svc","user":"app","password":"${MARKER}","token":"${MARKER}","timeout":"30s"}`,
          ],
          [
            '{"level": "debug", "msg": "smtp config", "SMTP_PASS": "smtp-spaced-1", "port": 587}',
            `{"level": "debug", "msg": "smtp config", "SMTP_PASS": "${MARKER}", "port": 587}`,
          ],
          [
            '{"level":"warn","msg":"retrying with body={\\"password\\":\\"hunter2-esc\\",\\"user\\":\\"bob\\"}"}',
            `{"level":"warn","msg":"retrying with body={\\"password\\":\\"${MARKER}\\",\\"user\\":\\"bob\\"}"}`,
          ],
          [
            '{"level":"info","msg":"loaded config\\npassword: hunter2-nl\\nuser: bob"}',
            `{"level":"info","msg":"loaded config\\npassword: ${MARKER}\\nuser: bob"}`,
          ],
          [
            '{"level":"info","msg":"session","api_key":12345678,"mfa":true}',
            `{"level":"info","msg":"session","api_key":"${MARKER}","mfa":true}`,
          ],
        ]),
      );
      expect(result.redactionCount).toBe(6);

      for (const line of result.text.split("\n")) {
        if (line.startsWith("{")) {
          expect(() => {
            return JSON.parse(line);
          }).not.toThrow();
        }
      }
    });

    it("masks a credential string the output truncated before its closing quote", () => {
      expect(redact('{"level":"info","password":"hunter').text).toBe(
        `{"level":"info","password":"${MARKER}`,
      );
    });

    it("replaces the last-applied-configuration annotation wholesale in jsonpath {.metadata.annotations}", () => {
      const result: KubectlOutputRedaction = redact(
        '{"deployment.kubernetes.io/revision":"3","kubectl.kubernetes.io/last-applied-configuration":"{\\"apiVersion\\":\\"v1\\",\\"data\\":{\\"DB_PASSWORD\\":\\"hunter2\\"},\\"kind\\":\\"ConfigMap\\"}\\n","vault.hashicorp.com/agent-inject-token":"hvs-abc123"}',
      );

      expect(result.text).toBe(
        `{"deployment.kubernetes.io/revision":"3","kubectl.kubernetes.io/last-applied-configuration":"${MARKER}","vault.hashicorp.com/agent-inject-token":"${MARKER}"}`,
      );
    });

    it("masks jsonpath env and args output", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          '[{"name":"DB_HOST","value":"postgres.prod.svc"},{"name":"DB_PASS","value":"Hunter2DbPass"},{"name":"DB_PASSWORD","valueFrom":{"secretKeyRef":{"key":"password","name":"db-creds"}}}]',
          '["--port","8080","--db-password","Sup3rS3cretPw"] ["--requirepass","R3disPw","--appendonly","yes"]',
        ),
      );

      expect(result.text).toBe(
        lines(
          `[{"name":"DB_HOST","value":"postgres.prod.svc"},{"name":"DB_PASS","value":"${MARKER}"},{"name":"DB_PASSWORD","valueFrom":{"secretKeyRef":{"key":"password","name":"db-creds"}}}]`,
          `["--port","8080","--db-password","${MARKER}"] ["--requirepass","${MARKER}","--appendonly","yes"]`,
        ),
      );
    });

    it("keeps an escaped closing quote intact when it masks a pair inside an escaped JSON string", () => {
      const result: KubectlOutputRedaction = redact(
        '{"msg":"exec {\\"cmd\\":\\"run --password=S3cret\\"}"}',
      );

      expect(result.text).toBe(
        `{"msg":"exec {\\"cmd\\":\\"run --password=${MARKER}\\"}"}`,
      );
      expect(() => {
        return JSON.parse(result.text);
      }).not.toThrow();
    });

    it.each([
      '[{"name":"DB_PASSWORD","valueFrom":{"secretKeyRef":{"key":"password","name":"db"}}}]',
      '{"key":"password","operator":"Exists"}',
      '{"image":"ghcr.io/org/secret-service:2.0"}',
      '{"secretName":"db-creds","serviceAccountName":"default","automountServiceAccountToken":false}',
      '{"level":"info","msg":"auth failed","error":"invalid credentials","attempt":3}',
      '{"otp_enabled":true,"auth":{"method":"oidc"},"tokens":[]}',
      '{"kind":"Secret","type":"kubernetes.io/service-account-token","metadata":{"name":"default-token"}}',
      '[{"name":"DB_PASSWORD","value":""},{"value":"","name":"API_TOKEN"}]',
      // Prose in an event message, not a JSON pair: a bare word is no JSON value.
      'MountVolume.SetUp failed for volume "db-creds" : secret "db-creds" not found',
    ])("keeps %s byte for byte", (text: string) => {
      const result: KubectlOutputRedaction = redact(text);
      expect(result.text).toBe(text);
      expect(result.redactionCount).toBe(0);
    });
  });

  describe("kubectl describe configmap", () => {
    it("masks a credential-like entry's whole value, blank lines included, and keeps the other entries", () => {
      const result: KubectlOutputRedaction = redact(DESCRIBE_CONFIGMAP);

      expect(result.text).toBe(
        lines(
          "Name:         app-config",
          "Namespace:    prod",
          "Labels:       app=api",
          "Annotations:  <none>",
          "",
          "Data",
          "====",
          "DB_PASSWORD:",
          "----",
          MARKER,
          "",
          "LOG_LEVEL:",
          "----",
          "debug",
          "",
          "api_token:",
          "----",
          MARKER,
          "",
          "app.properties:",
          "----",
          "server.port=8080",
          "db.user=app",
          `db.password=${MARKER}`,
          "",
          "tls.key:",
          "----",
          MARKER,
          "",
          "SMTP_PASS:",
          "----",
          MARKER,
          "",
          "",
          "BinaryData",
          "====",
          "",
          "Events:  <none>",
        ),
      );
      expect(result.redactionCount).toBe(5);
    });

    it("masks the smallest describe entry", () => {
      expect(redact("DB_PASSWORD:\n----\nvalue\n").text).toBe(
        `DB_PASSWORD:\n----\n${MARKER}\n`,
      );
    });

    it("fails closed: a value the output truncated is masked to the end", () => {
      expect(
        redact(lines("Data", "====", "DB_PASSWORD:", "----", "hunt")).text,
      ).toBe(lines("Data", "====", "DB_PASSWORD:", "----", MARKER));
    });

    it("fails closed: without the BinaryData heading the last value runs to the end", () => {
      expect(
        redact(
          lines("DB_PASSWORD:", "----", "hunter2", "", "", "Events:  <none>"),
        ).text,
      ).toBe(lines("DB_PASSWORD:", "----", MARKER));
    });

    it("does not end a value at a KEY: / ---- pair inside it that no blank line precedes", () => {
      const result: KubectlOutputRedaction = redact(
        lines(
          "notes.creds:",
          "----",
          "line one",
          "LOG_LEVEL:",
          "----",
          "hunter2",
          "",
          "BinaryData",
          "====",
        ),
      );

      expect(result.text).toBe(
        lines("notes.creds:", "----", MARKER, "", "BinaryData", "===="),
      );
    });

    it.each([
      lines("LOG_LEVEL:", "----", "debug", ""),
      lines("some heading", "----", "hunter2"),
      lines("DB_PASSWORD: <none>", "----", "text"),
      lines(
        "  Type    Reason  Age  From  Message",
        "  ----    ------  ---  ----  -------",
      ),
    ])("keeps %s", (text: string) => {
      const result: KubectlOutputRedaction = redact(text);
      expect(result.text).toBe(text);
      expect(result.redactionCount).toBe(0);
    });
  });

  describe("free-text keys", () => {
    it("masks a credential pair in text the line parser took for a key", () => {
      const result: KubectlOutputRedaction = redact(
        "connecting DB_PASSWORD=hunter2 host: db",
      );

      expect(result.text).not.toContain("hunter2");
      expect(result.text).toContain(`DB_PASSWORD=${MARKER}`);
    });

    it("masks a credential flag in a shell line the parser took for a key", () => {
      const result: KubectlOutputRedaction = redact(
        "sh -c redis-server --requirepass R3disPw && echo done: ok",
      );

      expect(result.text).not.toContain("R3disPw");
    });

    it("still judges the whole free-text key, so a credential after it is masked", () => {
      expect(redact("Password for user=bob: hunter2").text).toBe(
        `Password for user=bob: ${MARKER}`,
      );
    });
  });

  describe("realistic fixtures", () => {
    it("masks kubectl get deployment -o yaml and leaves every other line byte for byte", () => {
      const result: KubectlOutputRedaction = redact(DEPLOYMENT_YAML);

      expect(result.text).toBe(
        replaceLines(DEPLOYMENT_YAML, [
          ["        - Sup3rS3cretPw", `        - ${MARKER}`],
          ["        - tok_live_9f8e7d6c5b", `        - ${MARKER}`],
          ["          value: Hunter2DbPass", `          value: ${MARKER}`],
          ["          value: SmtpPw-771", `          value: ${MARKER}`],
          ["          value: rabbitPw12", `          value: ${MARKER}`],
          ["            - -pRootPw99", `            - -p${MARKER}`],
          ["        - R3disPw", `        - ${MARKER}`],
        ]),
      );
      expect(result.redactionCount).toBe(7);
    });

    it("masks kubectl describe pod and leaves every other line byte for byte", () => {
      const result: KubectlOutputRedaction = redact(DESCRIBE_POD);

      expect(result.text).toBe(
        replaceLines(DESCRIBE_POD, [
          ["      Sup3rS3cretPw", `      ${MARKER}`],
          ["      tok_live_9f8e7d6c5b", `      ${MARKER}`],
          [
            "    Liveness:       exec [mysqladmin ping -uroot -pRootPw99] delay=10s timeout=5s period=10s #success=1 #failure=3",
            `    Liveness:       exec [mysqladmin ping -uroot -p${MARKER}] delay=10s timeout=5s period=10s #success=1 #failure=3`,
          ],
          [
            "      DB_PASS:                Hunter2DbPass",
            `      DB_PASS:                ${MARKER}`,
          ],
          [
            "      SMTP_PASS:              SmtpPw-771",
            `      SMTP_PASS:              ${MARKER}`,
          ],
          [
            "      RABBITMQ_DEFAULT_PASS:  rabbitPw12",
            `      RABBITMQ_DEFAULT_PASS:  ${MARKER}`,
          ],
          ["      R3disPw", `      ${MARKER}`],
        ]),
      );
      expect(result.redactionCount).toBe(7);
    });

    it("masks kubectl get pod -o json, pretty-printed as kubectl prints it, and changes nothing else", () => {
      const result: KubectlOutputRedaction = redact(
        JSON.stringify(buildPod(REAL_POD_CREDENTIALS), null, 4),
      );

      for (const literal of POD_SECRETS) {
        expect(result.text).not.toContain(literal);
      }
      expect(JSON.parse(result.text)).toEqual(buildPod(MASKED_POD_CREDENTIALS));
    });

    it("masks the same pod as one line of JSON and changes nothing else", () => {
      const result: KubectlOutputRedaction = redact(
        JSON.stringify(buildPod(REAL_POD_CREDENTIALS)),
      );

      for (const literal of POD_SECRETS) {
        expect(result.text).not.toContain(literal);
      }
      expect(JSON.parse(result.text)).toEqual(buildPod(MASKED_POD_CREDENTIALS));
    });

    it("keeps the fixtures unchanged once their credentials are gone", () => {
      const withoutCredentials: Array<string> = [
        JSON.stringify(buildPod(MASKED_POD_CREDENTIALS)),
        JSON.stringify(buildPod(MASKED_POD_CREDENTIALS), null, 4),
      ];

      for (const text of withoutCredentials) {
        expect(redact(text).text).toBe(text);
        expect(redact(text).redactionCount).toBe(0);
      }
    });

    it.each([
      ["deployment YAML", DEPLOYMENT_YAML],
      ["describe pod", DESCRIBE_POD],
      ["describe configmap", DESCRIBE_CONFIGMAP],
      ["JSON logs", JSON_LOGS],
      ["pod JSON", JSON.stringify(buildPod(REAL_POD_CREDENTIALS), null, 4)],
      ["one-line pod JSON", JSON.stringify(buildPod(REAL_POD_CREDENTIALS))],
    ])("is idempotent on the %s fixture", (_name: string, text: string) => {
      expectIdempotent(text);
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
      lines(
        "NAME                   READY   STATUS    RESTARTS   AGE   IP           NODE                        NOMINATED NODE   READINESS GATES",
        "api-7d9f4c8b5d-x2k9q   1/1     Running   0          3d    10.0.1.57    ip-10-0-1-23.ec2.internal   <none>           <none>",
        "cache-0                1/1     Running   2          9d    10.0.1.58    ip-10-0-1-24.ec2.internal   <none>           <none>",
      ),
      lines(
        "NAME                   CPU(cores)   MEMORY(bytes)",
        "api-7d9f4c8b5d-x2k9q   12m          184Mi",
      ),
      lines(
        "deployment.apps/api",
        "REVISION  CHANGE-CAUSE",
        "1         <none>",
        "2         kubectl set image deployment/api api=ghcr.io/acme/api:2.14.1 --record=true",
      ),
      lines(
        '10.0.1.23 - - [22/Sep/2026:10:00:00 +0000] "GET /api/v1/users?page=2 HTTP/1.1" 200 512 "-" "kube-probe/1.30"',
        'level=info ts=2026-09-22T10:00:00.120Z caller=main.go:42 msg="GET /healthz" status=200 duration=3ms trace_id=4bf92f3577b34da6a3ce929d0e0e4736',
        '{"level":"info","ts":"2026-09-22T10:00:00.120Z","msg":"request","method":"GET","path":"/healthz","status":200,"pod":"api-7d9f4c8b5d-x2k9q","resourceVersion":"48213377"}',
        "I0922 10:00:00.000000       1 leaderelection.go:250] attempting to acquire leader lease kube-system/kube-controller-manager...",
      ),
      "api-7d9f4c8b5d-x2k9q\t48213377\t2026-09-20T08:15:30Z\tghcr.io/acme/api:2.14.1",
      lines(
        "      containers:",
        "      - args:",
        "        - --port",
        '        - "8080"',
        "        - --tail",
        '        - "100"',
        "        - --feature-gates",
        "        - Foo=true",
        "        - --leader-elect",
        "        - --authorization-mode",
        "        - Node,RBAC",
        "        command:",
        "        - /bin/sh",
        "        - -c",
        "        - mkdir -p /data && exec /app/server --port 8080",
        "        image: ghcr.io/acme/api:2.14.1",
      ),
      lines(
        "    Command:",
        "      /bin/sh",
        "      -c",
        "      mkdir -p /data && exec /app/server --port 8080",
        "    Args:",
        "      --log-level",
        "      info",
        "      --secure-port",
        "      10250",
        "    State:          Running",
      ),
    ];

    it.each(untouched)("leaves %s unchanged", (text: string) => {
      const result: KubectlOutputRedaction = redact(text);
      expect(result.text).toBe(text);
      expect(result.redactionCount).toBe(0);
    });
  });

  /*
   * Pod logs are attacker-influenced text, and the redactor runs on the
   * server for every kubectl output. Every rule must stay linear on a large
   * input shaped to make a regex backtrack: ~200 KB of repeated key=value
   * text, long flag runs, runs of quotes and escaped quotes, deep YAML
   * indentation, long dotted runs (the URL rule's old worst case, over 30
   * seconds for "eyJ.eyJ.…") and the like. Each finishes in well under a
   * second on a laptop; the bound leaves room for a loaded CI runner while
   * still catching anything quadratic.
   */
  describe("linear time on large, adversarial output", () => {
    const size: number = 200 * 1024;
    const fill: (unit: string) => string = (unit: string): string => {
      return unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
    };
    const boundMs: number = 3000;

    const adversarial: Array<[string, string]> = [
      [
        "repeated key=value lines",
        fill("password=hunter2 user=admin token=abc123 level=info\n"),
      ],
      [
        "repeated key=value on one line",
        fill("password=hunter2 user=admin token=abc123 "),
      ],
      ["a long run of credential flags", fill("--password ")],
      ["flags glued with =", fill("--password=--password=")],
      ["a tool's short password flag, repeated", fill("mysql -p -p ")],
      ["double quotes", fill('"')],
      ["single quotes", fill("'")],
      ["JSON key/value openings", fill('"a":"')],
      ["escaped quotes", fill('\\"')],
      [
        "escaped JSON env pairs",
        fill('\\"name\\":\\"PASSWORD\\",\\"value\\":\\"'),
      ],
      ["JSON env pairs", fill('"name":"PASSWORD","value":"')],
      ["one-line JSON credentials", `{${fill('"password":"x",')}}`],
      [
        "deep YAML indentation",
        Array.from({ length: 2000 }, (_value: unknown, index: number) => {
          return `${" ".repeat(index % 400)}password: x`;
        }).join("\n"),
      ],
      [
        "a deep Secret data block",
        `kind: Secret\ndata:\n${Array.from(
          { length: 3000 },
          (_value: unknown, index: number) => {
            return `${" ".repeat(2 + (index % 300))}k${index}: dmFsdWU=`;
          },
        ).join("\n")}`,
      ],
      ["one long word", fill("a")],
      ["a long base64 run", fill("QUJD")],
      ["padded base64 words", fill("QUJD=")],
      ["Bearer, repeated", fill("Bearer ")],
      ["a long dotted run (JWT-like)", fill("eyJ.")],
      ["a long dotted run", fill("a.")],
      ["a long dotted run ending in a URL", `${fill("a.")}://u:p@h`],
      ["scheme separators", fill("a://")],
      ["URLs with credentials", fill("https://user:pass@")],
      ["dashes", fill("-")],
      ["PEM openings", fill("-----BEGIN ")],
      ["an env list", fill("- name: API_KEY\n  value: abc\n")],
      ["an args list", fill("- --password\n")],
      ["escaped line breaks", fill("\\npassword=x")],
      [
        "describe's data layout",
        `Data\n====\n${fill("password:\n----\nvalue\n")}`,
      ],
      ["quoted flag pairs", fill('"--password","')],
      ["keys without a space after the colon", fill("password:x ")],
    ];

    it.each(adversarial)(
      "redacts %s in linear time",
      (_label: string, text: string) => {
        const started: number = Date.now();
        const result: KubectlOutputRedaction = redact(text);
        const elapsedMs: number = Date.now() - started;

        expect(result.text.length).toBeGreaterThan(0);
        expect(elapsedMs).toBeLessThan(boundMs);
      },
    );
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

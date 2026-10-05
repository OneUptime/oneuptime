import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  codeBlock,
  resolveSetupGuideOption,
  shellQuote,
} from "../../../Components/SetupGuide/SetupGuide";
import StorageSystem from "Common/Types/StorageArray/StorageSystem";

/*
 * The in-app install guide for the OneUptime Storage Array Agent
 * (agents/StorageArrayAgent): a stock OpenTelemetry collector that scrapes
 * the array's OpenMetrics endpoints with a read-only API token. The guide
 * asks which array it is for — a FlashArray serving its metrics itself, an
 * older FlashArray read through Pure's exporter, or a FlashBlade — and shows
 * only that path, with the install script or Docker Compose as tabs of the
 * install step. Everything else is folded under Advanced and
 * Troubleshooting.
 *
 * Pure Storage renamed itself Everpure in February 2026; FlashArray,
 * FlashBlade, Purity and the purefa_ / purefb_ metrics kept their names.
 */

export type StorageArrayPlatform =
  | "flasharray"
  | "flasharray-exporter"
  | "flashblade";

export const STORAGE_ARRAY_PLATFORMS: Array<
  SetupGuideOption<StorageArrayPlatform>
> = [
  {
    key: "flasharray",
    label: "FlashArray",
    description:
      "Purity//FA 6.7 or later. The agent reads the metrics the array serves itself.",
    badge: "Recommended",
  },
  {
    key: "flasharray-exporter",
    label: "FlashArray, older Purity",
    description:
      "An older Purity//FA. The agent runs Pure's FlashArray exporter next to it.",
  },
  {
    key: "flashblade",
    label: "FlashBlade",
    description: "The agent runs Pure's FlashBlade exporter next to it.",
  },
];

export const DEFAULT_STORAGE_ARRAY_PLATFORM: StorageArrayPlatform =
  "flasharray";

export function resolveStorageArrayPlatform(
  platform: string | null | undefined,
): StorageArrayPlatform {
  return (
    resolveSetupGuideOption(STORAGE_ARRAY_PLATFORMS, platform) ||
    DEFAULT_STORAGE_ARRAY_PLATFORM
  );
}

/*
 * The option an array's own Documentation tab opens on: its platform, once
 * the array has reported one. A FlashArray opens on the native endpoint,
 * which every current Purity//FA serves.
 */
export function getStorageArrayPlatformForSystem(
  storageSystem: string | null | undefined,
): StorageArrayPlatform | undefined {
  if (storageSystem === StorageSystem.PureStorageFlashBlade) {
    return "flashblade";
  }
  if (storageSystem === StorageSystem.PureStorageFlashArray) {
    return "flasharray";
  }
  return undefined;
}

// Where the agent's files are published, and where install.sh puts them.
export const STORAGE_ARRAY_AGENT_RAW_URL: string =
  "https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent";
export const STORAGE_ARRAY_AGENT_SOURCE_URL: string =
  "https://github.com/OneUptime/oneuptime/tree/master/agents/StorageArrayAgent";
export const STORAGE_ARRAY_AGENT_INSTALL_DIR: string =
  "/opt/oneuptime-storage-array-agent";

// The containers docker-compose.yml runs (their container_name / service).
export const STORAGE_ARRAY_AGENT_CONTAINER: string =
  "oneuptime-storage-array-agent";
export const STORAGE_ARRAY_FA_EXPORTER_SERVICE: string = "pure-fa-exporter";
export const STORAGE_ARRAY_FB_EXPORTER_SERVICE: string = "pure-fb-exporter";

// The name the guide suggests when it is not installing for a known array.
export const STORAGE_ARRAY_EXAMPLE_NAME: string = "my-storage-array";

// The read-only user the guide creates on the array.
export const STORAGE_ARRAY_READ_ONLY_USER: string = "oneuptime";

// Stands in for the array's API token, which OneUptime never sees.
export const STORAGE_ARRAY_TOKEN_PLACEHOLDER: string = "<read-only-api-token>";

// The syslog port the optional syslog receivers listen on.
export const STORAGE_ARRAY_SYSLOG_PORT: number = 5514;

export const STORAGE_ARRAY_COMPOSE_FILE: string = "docker-compose.yml";

interface PlatformSettings {
  storageSystem: StorageSystem;
  collectorConfigFile: string;
  composeProfile: string;
  endpointVariable: "PURE_FA_ENDPOINT" | "PURE_FB_ENDPOINT";
  tokenVariable: "PURE_FA_API_TOKEN" | "PURE_FB_API_TOKEN";
  exampleEndpoint: string;
  // The exporter sidecar the platform needs; null for the native endpoint.
  exporterService: string | null;
  // A readable name for the array kind in sentences.
  arrayNoun: string;
}

export const STORAGE_ARRAY_PLATFORM_SETTINGS: Record<
  StorageArrayPlatform,
  PlatformSettings
> = {
  flasharray: {
    storageSystem: StorageSystem.PureStorageFlashArray,
    collectorConfigFile: "otel-collector-config.yaml",
    composeProfile: "",
    endpointVariable: "PURE_FA_ENDPOINT",
    tokenVariable: "PURE_FA_API_TOKEN",
    exampleEndpoint: "fa-prod-01.example.com",
    exporterService: null,
    arrayNoun: "FlashArray",
  },
  "flasharray-exporter": {
    storageSystem: StorageSystem.PureStorageFlashArray,
    collectorConfigFile: "otel-collector-config.flasharray-exporter.yaml",
    composeProfile: "flasharray-exporter",
    endpointVariable: "PURE_FA_ENDPOINT",
    tokenVariable: "PURE_FA_API_TOKEN",
    exampleEndpoint: "fa-prod-01.example.com",
    exporterService: STORAGE_ARRAY_FA_EXPORTER_SERVICE,
    arrayNoun: "FlashArray",
  },
  flashblade: {
    storageSystem: StorageSystem.PureStorageFlashBlade,
    collectorConfigFile: "otel-collector-config.flashblade.yaml",
    composeProfile: "flashblade",
    endpointVariable: "PURE_FB_ENDPOINT",
    tokenVariable: "PURE_FB_API_TOKEN",
    exampleEndpoint: "fb-prod-01.example.com",
    exporterService: STORAGE_ARRAY_FB_EXPORTER_SERVICE,
    arrayNoun: "FlashBlade",
  },
};

// The files Docker Compose needs: the compose file and all three configs.
export const STORAGE_ARRAY_AGENT_FILES: Array<string> = [
  STORAGE_ARRAY_COMPOSE_FILE,
  "otel-collector-config.yaml",
  "otel-collector-config.flasharray-exporter.yaml",
  "otel-collector-config.flashblade.yaml",
];

/*
 * agents/StorageArrayAgent/otel-collector-config*.yaml, verbatim — the
 * guide shows the reader the exact file the agent runs.
 * StorageArraySetupGuide.test.ts fails when a shipped file changes and its
 * copy here does not.
 */
export const STORAGE_ARRAY_FLASHARRAY_COLLECTOR_CONFIG: string = `receivers:
  # Pure Storage FlashArray with the native OpenMetrics endpoint (Purity//FA
  # 6.7 and later, see README.md): the array serves its metrics itself at
  # https://<array>/metrics/<endpoint>?namespace=purefa, so the collector
  # scrapes the array directly — no exporter sidecar. (An older Purity//FA
  # has no such endpoint: use otel-collector-config.flasharray-exporter.yaml
  # with the pure-fa-exporter sidecar instead. A FlashBlade uses
  # otel-collector-config.flashblade.yaml.)
  #
  # One scrape job per endpoint, so each is read as often as it is worth
  # (Pure's own guidance: the array endpoint often, directories rarely —
  # directory space is expensive for the array to compute). Every job
  # authenticates with the API token of a dedicated array user holding the
  # readonly role (see README.md), sent as a Bearer token.
  #
  # Every job labels its series \`scrape_endpoint: <endpoint>\`. Each endpoint
  # also exports purefa_info, so OneUptime knows which families a batch is
  # the COMPLETE list of — that is how a deleted volume, host or pod leaves
  # the inventory instead of lingering. Keep the labels as shipped.
  prometheus:
    config:
      scrape_configs:
        # Array identity (purefa_info), capacity, performance, open alerts,
        # hardware components, controllers, drives and network interfaces.
        - job_name: purefa-array
          scheme: https
          metrics_path: /metrics/array
          params:
            # Required by the array; \`purefa\` is the only value it accepts.
            namespace: [purefa]
          authorization:
            type: Bearer
            credentials: "\${env:PURE_FA_API_TOKEN}"
          tls_config:
            # FlashArrays ship a self-signed certificate, so verification is
            # off by default (STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true). The
            # placeholder is deliberately UNQUOTED: a quoted "\${env:...}" is
            # a string, and this field is a boolean.
            insecure_skip_verify: \${env:STORAGE_ARRAY_INSECURE_SKIP_VERIFY}
          scrape_interval: 60s
          scrape_timeout: 50s
          # Read a response whose Content-Type the scraper does not recognise
          # as the Prometheus text format rather than failing the scrape.
          fallback_scrape_protocol: PrometheusText0.0.4
          static_configs:
            # The array's management address: host name or IP, no scheme.
            - targets: ["\${env:PURE_FA_ENDPOINT}"]
              labels:
                scrape_endpoint: array

        # Per-volume performance, space and data reduction.
        - job_name: purefa-volumes
          scheme: https
          metrics_path: /metrics/volumes
          params:
            namespace: [purefa]
          authorization:
            type: Bearer
            credentials: "\${env:PURE_FA_API_TOKEN}"
          tls_config:
            insecure_skip_verify: \${env:STORAGE_ARRAY_INSECURE_SKIP_VERIFY}
          scrape_interval: 120s
          scrape_timeout: 100s
          fallback_scrape_protocol: PrometheusText0.0.4
          static_configs:
            - targets: ["\${env:PURE_FA_ENDPOINT}"]
              labels:
                scrape_endpoint: volumes
          # Each volume's latency is exported in up to sixteen \`dimension\`s.
          # Keep the three a host actually waits on (usec_per_read_op,
          # usec_per_write_op, usec_per_mirrored_write_op) and drop the
          # breakdown (QoS rate limit, queue, SAN and service time) — it
          # multiplies the series count of a large array several times over,
          # and the same breakdown stays available for the whole array on
          # purefa_array_performance_latency_usec. Delete this rule to keep
          # the per-volume breakdown too.
          metric_relabel_configs:
            - source_labels: [__name__, dimension]
              regex: purefa_(volume|host)_performance_latency_usec;(qos_rate_limit|queue|san|service)_usec_per_.*
              action: drop

        # Per-host performance, space, connectivity and volume connections.
        - job_name: purefa-hosts
          scheme: https
          metrics_path: /metrics/hosts
          params:
            namespace: [purefa]
          authorization:
            type: Bearer
            credentials: "\${env:PURE_FA_API_TOKEN}"
          tls_config:
            insecure_skip_verify: \${env:STORAGE_ARRAY_INSECURE_SKIP_VERIFY}
          scrape_interval: 120s
          scrape_timeout: 100s
          fallback_scrape_protocol: PrometheusText0.0.4
          static_configs:
            - targets: ["\${env:PURE_FA_ENDPOINT}"]
              labels:
                scrape_endpoint: hosts
          # The same latency breakdown drop as the volumes job, for hosts.
          metric_relabel_configs:
            - source_labels: [__name__, dimension]
              regex: purefa_(volume|host)_performance_latency_usec;(qos_rate_limit|queue|san|service)_usec_per_.*
              action: drop

        # ActiveCluster / ActiveDR pods: performance, space, replica link lag.
        - job_name: purefa-pods
          scheme: https
          metrics_path: /metrics/pods
          params:
            namespace: [purefa]
          authorization:
            type: Bearer
            credentials: "\${env:PURE_FA_API_TOKEN}"
          tls_config:
            insecure_skip_verify: \${env:STORAGE_ARRAY_INSECURE_SKIP_VERIFY}
          scrape_interval: 120s
          scrape_timeout: 100s
          fallback_scrape_protocol: PrometheusText0.0.4
          static_configs:
            - targets: ["\${env:PURE_FA_ENDPOINT}"]
              labels:
                scrape_endpoint: pods

        # File directories (FlashArray File Services). Expensive for the
        # array to compute, so Pure recommends reading it rarely.
        - job_name: purefa-directories
          scheme: https
          metrics_path: /metrics/directories
          params:
            namespace: [purefa]
          authorization:
            type: Bearer
            credentials: "\${env:PURE_FA_API_TOKEN}"
          tls_config:
            insecure_skip_verify: \${env:STORAGE_ARRAY_INSECURE_SKIP_VERIFY}
          scrape_interval: 30m
          scrape_timeout: 15m
          fallback_scrape_protocol: PrometheusText0.0.4
          static_configs:
            - targets: ["\${env:PURE_FA_ENDPOINT}"]
              labels:
                scrape_endpoint: directories

  # Optional: receive the syslog the array forwards (alerts and audit
  # events) — this is what powers the Logs tab of the storage array. Off by
  # default because it needs a listening port published on this machine. To
  # enable it:
  #   1. Uncomment the two \`syslog/*\` receivers below, the \`logs\` pipeline at
  #      the bottom of this file, and the port mapping in docker-compose.yml.
  #   2. On the array, add a syslog server udp://<agent-host>:5514 or
  #      tcp://<agent-host>:5514 (FlashArray: Settings → System → Syslog
  #      Servers; see README.md).
  # Purity sends classic BSD syslog (RFC 3164), whose timestamps carry no
  # time zone: set \`location\` to the array's time zone unless its clock runs
  # on UTC. The resource processor below stamps storage.array.name on these
  # logs too, so they land on this array. A syslog receiver honours only one
  # of \`tcp:\` / \`udp:\`, so TCP and UDP are two named receivers — uncomment
  # both to accept either transport.
  # syslog/tcp:
  #   tcp:
  #     listen_address: "0.0.0.0:5514"
  #   protocol: rfc3164
  #   location: UTC
  # syslog/udp:
  #   udp:
  #     listen_address: "0.0.0.0:5514"
  #   protocol: rfc3164
  #   location: UTC

processors:
  # Stamp every metric with the array's identity. OneUptime auto-registers
  # the storage array from \`storage.array.name\`, and every Storage Arrays
  # page and monitor scopes on it — this attribute is what makes the data
  # appear under the Storage Arrays section of the dashboard. Keep it
  # stable: changing it later registers a brand-new array.
  resource:
    attributes:
      - key: storage.array.name
        value: "\${env:STORAGE_ARRAY_NAME}"
        action: upsert
      # The platform: purestorage.flasharray or purestorage.flashblade.
      - key: storage.system
        value: "\${env:STORAGE_SYSTEM}"
        action: upsert
      # Optional: promote resource attributes to project labels on the
      # array — oneuptime.label.<dimension>=<value> becomes the label
      # <dimension>:<value> (see README.md, "Auto-tag with Project Labels").
      # - key: oneuptime.label.env
      #   value: production
      #   action: upsert
      # The prometheus receiver synthesizes service.name (= the scrape job
      # name, e.g. "purefa-volumes") and service.instance.id on every batch
      # per the Prometheus->OTLP compatibility spec. Drop them: OneUptime
      # routes batches by service.name first, so leaving them in would
      # register phantom "purefa-*" Services instead of routing this data to
      # the storage array discovered from \`storage.array.name\` (which would
      # also break per-array retention settings). Do not remove these two
      # deletes.
      - key: service.name
        action: delete
      - key: service.instance.id
        action: delete
  batch:
    timeout: 10s
    # Large enough to hold a whole scrape of a big array. There is
    # deliberately NO send_batch_max_size: a scrape must never be split
    # across exports, because OneUptime reads a whole endpoint per request
    # to rebuild the inventory (volume, host and pod counts, hardware health,
    # open alerts) — a split scrape would make objects vanish and counts
    # drop until the next one.
    send_batch_size: 8192
  memory_limiter:
    check_interval: 5s
    # A FlashArray with thousands of volumes returns a large scrape; 512 MiB
    # leaves ample headroom.
    limit_mib: 512
    spike_limit_mib: 128

exporters:
  otlphttp:
    endpoint: "\${env:ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-token: "\${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [memory_limiter, resource, batch]
      exporters: [otlphttp]
    # Uncomment together with the syslog receivers above to ship the
    # array's syslog (powers the Logs tab of the storage array):
    # logs:
    #   receivers: [syslog/tcp, syslog/udp]
    #   processors: [memory_limiter, resource, batch]
    #   exporters: [otlphttp]
`;

export const STORAGE_ARRAY_FLASHARRAY_EXPORTER_COLLECTOR_CONFIG: string = `receivers:
  # Pure Storage FlashArray running a Purity//FA release WITHOUT the native
  # OpenMetrics endpoint (older than 6.7, see README.md): the collector
  # scrapes Pure's pure-fa-openmetrics-exporter, which docker-compose.yml
  # runs as the \`pure-fa-exporter\` service
  # (COMPOSE_PROFILES=flasharray-exporter). The exporter logs in to the
  # array's REST API with the API token it receives on every scrape and
  # answers with the same metric names and labels as the native endpoint, so
  # everything downstream is identical. Pure has deprecated this exporter in
  # favour of the native endpoint: once the array serves
  # https://<array>/metrics/array?namespace=purefa, switch to
  # otel-collector-config.yaml.
  #
  # The \`endpoint\` parameter tells the exporter which array to read; the
  # API token (of a dedicated array user holding the readonly role, see
  # README.md) travels as a Bearer token from the collector to the exporter
  # over the compose network only — the exporter's port is never published.
  # The exporter does not verify the array's TLS certificate (its own
  # default), so STORAGE_ARRAY_INSECURE_SKIP_VERIFY does not apply here.
  #
  # Every job labels its series \`scrape_endpoint: <endpoint>\`. Each endpoint
  # also exports purefa_info, so OneUptime knows which families a batch is
  # the COMPLETE list of — that is how a deleted volume, host or pod leaves
  # the inventory instead of lingering. Keep the labels as shipped.
  prometheus:
    config:
      scrape_configs:
        # Array identity (purefa_info), capacity, performance, open alerts,
        # hardware components, controllers, drives and network interfaces.
        - job_name: purefa-array
          scheme: http
          metrics_path: /metrics/array
          params:
            # The array's management address: host name or IP, no scheme.
            endpoint: ["\${env:PURE_FA_ENDPOINT}"]
          authorization:
            type: Bearer
            credentials: "\${env:PURE_FA_API_TOKEN}"
          scrape_interval: 60s
          scrape_timeout: 50s
          static_configs:
            - targets: ["pure-fa-exporter:9490"]
              labels:
                scrape_endpoint: array

        # Per-volume performance, space and data reduction.
        - job_name: purefa-volumes
          scheme: http
          metrics_path: /metrics/volumes
          params:
            endpoint: ["\${env:PURE_FA_ENDPOINT}"]
          authorization:
            type: Bearer
            credentials: "\${env:PURE_FA_API_TOKEN}"
          scrape_interval: 120s
          scrape_timeout: 100s
          static_configs:
            - targets: ["pure-fa-exporter:9490"]
              labels:
                scrape_endpoint: volumes
          # Each volume's latency is exported in up to sixteen \`dimension\`s.
          # Keep the three a host actually waits on (usec_per_read_op,
          # usec_per_write_op, usec_per_mirrored_write_op) and drop the
          # breakdown (QoS rate limit, queue, SAN and service time) — it
          # multiplies the series count of a large array several times over,
          # and the same breakdown stays available for the whole array on
          # purefa_array_performance_latency_usec. Delete this rule to keep
          # the per-volume breakdown too.
          metric_relabel_configs:
            - source_labels: [__name__, dimension]
              regex: purefa_(volume|host)_performance_latency_usec;(qos_rate_limit|queue|san|service)_usec_per_.*
              action: drop

        # Per-host performance, space, connectivity and volume connections.
        - job_name: purefa-hosts
          scheme: http
          metrics_path: /metrics/hosts
          params:
            endpoint: ["\${env:PURE_FA_ENDPOINT}"]
          authorization:
            type: Bearer
            credentials: "\${env:PURE_FA_API_TOKEN}"
          scrape_interval: 120s
          scrape_timeout: 100s
          static_configs:
            - targets: ["pure-fa-exporter:9490"]
              labels:
                scrape_endpoint: hosts
          # The same latency breakdown drop as the volumes job, for hosts.
          metric_relabel_configs:
            - source_labels: [__name__, dimension]
              regex: purefa_(volume|host)_performance_latency_usec;(qos_rate_limit|queue|san|service)_usec_per_.*
              action: drop

        # ActiveCluster / ActiveDR pods: performance, space, replica link lag.
        - job_name: purefa-pods
          scheme: http
          metrics_path: /metrics/pods
          params:
            endpoint: ["\${env:PURE_FA_ENDPOINT}"]
          authorization:
            type: Bearer
            credentials: "\${env:PURE_FA_API_TOKEN}"
          scrape_interval: 120s
          scrape_timeout: 100s
          static_configs:
            - targets: ["pure-fa-exporter:9490"]
              labels:
                scrape_endpoint: pods

        # File directories (FlashArray File Services). Expensive for the
        # array to compute, so Pure recommends reading it rarely.
        - job_name: purefa-directories
          scheme: http
          metrics_path: /metrics/directories
          params:
            endpoint: ["\${env:PURE_FA_ENDPOINT}"]
          authorization:
            type: Bearer
            credentials: "\${env:PURE_FA_API_TOKEN}"
          scrape_interval: 30m
          scrape_timeout: 15m
          static_configs:
            - targets: ["pure-fa-exporter:9490"]
              labels:
                scrape_endpoint: directories

  # Optional: receive the syslog the array forwards (alerts and audit
  # events) — this is what powers the Logs tab of the storage array. Off by
  # default because it needs a listening port published on this machine. To
  # enable it:
  #   1. Uncomment the two \`syslog/*\` receivers below, the \`logs\` pipeline at
  #      the bottom of this file, and the port mapping in docker-compose.yml.
  #   2. On the array, add a syslog server udp://<agent-host>:5514 or
  #      tcp://<agent-host>:5514 (FlashArray: Settings → System → Syslog
  #      Servers; see README.md).
  # Purity sends classic BSD syslog (RFC 3164), whose timestamps carry no
  # time zone: set \`location\` to the array's time zone unless its clock runs
  # on UTC. The resource processor below stamps storage.array.name on these
  # logs too, so they land on this array. A syslog receiver honours only one
  # of \`tcp:\` / \`udp:\`, so TCP and UDP are two named receivers — uncomment
  # both to accept either transport.
  # syslog/tcp:
  #   tcp:
  #     listen_address: "0.0.0.0:5514"
  #   protocol: rfc3164
  #   location: UTC
  # syslog/udp:
  #   udp:
  #     listen_address: "0.0.0.0:5514"
  #   protocol: rfc3164
  #   location: UTC

processors:
  # Stamp every metric with the array's identity. OneUptime auto-registers
  # the storage array from \`storage.array.name\`, and every Storage Arrays
  # page and monitor scopes on it — this attribute is what makes the data
  # appear under the Storage Arrays section of the dashboard. Keep it
  # stable: changing it later registers a brand-new array.
  resource:
    attributes:
      - key: storage.array.name
        value: "\${env:STORAGE_ARRAY_NAME}"
        action: upsert
      # The platform: purestorage.flasharray or purestorage.flashblade.
      - key: storage.system
        value: "\${env:STORAGE_SYSTEM}"
        action: upsert
      # Optional: promote resource attributes to project labels on the
      # array — oneuptime.label.<dimension>=<value> becomes the label
      # <dimension>:<value> (see README.md, "Auto-tag with Project Labels").
      # - key: oneuptime.label.env
      #   value: production
      #   action: upsert
      # The prometheus receiver synthesizes service.name (= the scrape job
      # name, e.g. "purefa-volumes") and service.instance.id on every batch
      # per the Prometheus->OTLP compatibility spec. Drop them: OneUptime
      # routes batches by service.name first, so leaving them in would
      # register phantom "purefa-*" Services instead of routing this data to
      # the storage array discovered from \`storage.array.name\` (which would
      # also break per-array retention settings). Do not remove these two
      # deletes.
      - key: service.name
        action: delete
      - key: service.instance.id
        action: delete
  batch:
    timeout: 10s
    # Large enough to hold a whole scrape of a big array. There is
    # deliberately NO send_batch_max_size: a scrape must never be split
    # across exports, because OneUptime reads a whole endpoint per request
    # to rebuild the inventory (volume, host and pod counts, hardware health,
    # open alerts) — a split scrape would make objects vanish and counts
    # drop until the next one.
    send_batch_size: 8192
  memory_limiter:
    check_interval: 5s
    # A FlashArray with thousands of volumes returns a large scrape; 512 MiB
    # leaves ample headroom.
    limit_mib: 512
    spike_limit_mib: 128

exporters:
  otlphttp:
    endpoint: "\${env:ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-token: "\${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [memory_limiter, resource, batch]
      exporters: [otlphttp]
    # Uncomment together with the syslog receivers above to ship the
    # array's syslog (powers the Logs tab of the storage array):
    # logs:
    #   receivers: [syslog/tcp, syslog/udp]
    #   processors: [memory_limiter, resource, batch]
    #   exporters: [otlphttp]
`;

export const STORAGE_ARRAY_FLASHBLADE_COLLECTOR_CONFIG: string = `receivers:
  # Pure Storage FlashBlade: the collector scrapes Pure's
  # pure-fb-openmetrics-exporter, which docker-compose.yml runs as the
  # \`pure-fb-exporter\` service (COMPOSE_PROFILES=flashblade). The exporter
  # logs in to the FlashBlade's REST API with the API token it receives on
  # every scrape and answers in OpenMetrics with Pure's purefb_* metrics.
  #
  # The \`endpoint\` parameter tells the exporter which FlashBlade to read;
  # the API token (of a user holding the readonly role, see README.md)
  # travels as a Bearer token from the collector to the exporter over the
  # compose network only — the exporter's port is never published. The
  # exporter does not verify the FlashBlade's TLS certificate (its own
  # default), so STORAGE_ARRAY_INSECURE_SKIP_VERIFY does not apply here.
  #
  # Pure's guidance for this exporter: read the array endpoint most often
  # and the file system and object store endpoints less often — the
  # FlashBlade REST API is not built to report every file system and bucket
  # quickly — and never below 30 seconds. Every job labels its series
  # \`scrape_endpoint: <endpoint>\`; each endpoint also exports purefb_info, so
  # OneUptime knows which families a batch is the COMPLETE list of — that is
  # how a deleted file system or bucket leaves the inventory instead of
  # lingering. Keep the labels as shipped.
  prometheus:
    config:
      scrape_configs:
        # FlashBlade identity (purefb_info), capacity, performance per
        # protocol, open alerts and hardware health.
        - job_name: purefb-array
          scheme: http
          metrics_path: /metrics/array
          params:
            # The FlashBlade's management address: host name or IP, no
            # scheme.
            endpoint: ["\${env:PURE_FB_ENDPOINT}"]
          authorization:
            type: Bearer
            credentials: "\${env:PURE_FB_API_TOKEN}"
          scrape_interval: 60s
          scrape_timeout: 50s
          static_configs:
            - targets: ["pure-fb-exporter:9491"]
              labels:
                scrape_endpoint: array

        # Per-file-system space, data reduction and performance.
        - job_name: purefb-filesystems
          scheme: http
          metrics_path: /metrics/filesystems
          params:
            endpoint: ["\${env:PURE_FB_ENDPOINT}"]
          authorization:
            type: Bearer
            credentials: "\${env:PURE_FB_API_TOKEN}"
          scrape_interval: 300s
          scrape_timeout: 240s
          static_configs:
            - targets: ["pure-fb-exporter:9491"]
              labels:
                scrape_endpoint: filesystems

        # Per-bucket space, object counts and performance, and object store
        # accounts.
        - job_name: purefb-objectstore
          scheme: http
          metrics_path: /metrics/objectstore
          params:
            endpoint: ["\${env:PURE_FB_ENDPOINT}"]
          authorization:
            type: Bearer
            credentials: "\${env:PURE_FB_API_TOKEN}"
          scrape_interval: 300s
          scrape_timeout: 240s
          static_configs:
            - targets: ["pure-fb-exporter:9491"]
              labels:
                scrape_endpoint: objectstore

  # Optional: receive the syslog the FlashBlade forwards — this is what
  # powers the Logs tab of the storage array. Off by default because it
  # needs a listening port published on this machine. To enable it:
  #   1. Uncomment the two \`syslog/*\` receivers below, the \`logs\` pipeline at
  #      the bottom of this file, and the port mapping in docker-compose.yml.
  #   2. On the FlashBlade, add a syslog server udp://<agent-host>:5514 or
  #      tcp://<agent-host>:5514 (see README.md).
  # The receivers expect classic BSD syslog (RFC 3164), the format Purity//FA
  # sends; switch \`protocol\` to rfc5424 if your FlashBlade's messages start
  # with a version number after the priority (\`<14>1 2026-...\`). RFC 3164
  # timestamps carry no time zone: set \`location\` to the FlashBlade's time
  # zone unless its clock runs on UTC. The resource processor below stamps
  # storage.array.name on these logs too, so they land on this array. A
  # syslog receiver honours only one of \`tcp:\` / \`udp:\`, so TCP and UDP are
  # two named receivers — uncomment both to accept either transport.
  # syslog/tcp:
  #   tcp:
  #     listen_address: "0.0.0.0:5514"
  #   protocol: rfc3164
  #   location: UTC
  # syslog/udp:
  #   udp:
  #     listen_address: "0.0.0.0:5514"
  #   protocol: rfc3164
  #   location: UTC

processors:
  # Stamp every metric with the array's identity. OneUptime auto-registers
  # the storage array from \`storage.array.name\`, and every Storage Arrays
  # page and monitor scopes on it — this attribute is what makes the data
  # appear under the Storage Arrays section of the dashboard. Keep it
  # stable: changing it later registers a brand-new array.
  resource:
    attributes:
      - key: storage.array.name
        value: "\${env:STORAGE_ARRAY_NAME}"
        action: upsert
      # The platform: purestorage.flashblade for this config.
      - key: storage.system
        value: "\${env:STORAGE_SYSTEM}"
        action: upsert
      # Optional: promote resource attributes to project labels on the
      # array — oneuptime.label.<dimension>=<value> becomes the label
      # <dimension>:<value> (see README.md, "Auto-tag with Project Labels").
      # - key: oneuptime.label.env
      #   value: production
      #   action: upsert
      # The prometheus receiver synthesizes service.name (= the scrape job
      # name, e.g. "purefb-filesystems") and service.instance.id on every
      # batch per the Prometheus->OTLP compatibility spec. Drop them:
      # OneUptime routes batches by service.name first, so leaving them in
      # would register phantom "purefb-*" Services instead of routing this
      # data to the storage array discovered from \`storage.array.name\` (which
      # would also break per-array retention settings). Do not remove these
      # two deletes.
      - key: service.name
        action: delete
      - key: service.instance.id
        action: delete
  batch:
    timeout: 10s
    # Large enough to hold a whole scrape of a big FlashBlade. There is
    # deliberately NO send_batch_max_size: a scrape must never be split
    # across exports, because OneUptime reads a whole endpoint per request
    # to rebuild the inventory (file system and bucket counts, hardware
    # health, open alerts) — a split scrape would make objects vanish and
    # counts drop until the next one.
    send_batch_size: 8192
  memory_limiter:
    check_interval: 5s
    # A FlashBlade with thousands of file systems and buckets returns a
    # large scrape; 512 MiB leaves ample headroom.
    limit_mib: 512
    spike_limit_mib: 128

exporters:
  otlphttp:
    endpoint: "\${env:ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-token: "\${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [memory_limiter, resource, batch]
      exporters: [otlphttp]
    # Uncomment together with the syslog receivers above to ship the
    # FlashBlade's syslog (powers the Logs tab of the storage array):
    # logs:
    #   receivers: [syslog/tcp, syslog/udp]
    #   processors: [memory_limiter, resource, batch]
    #   exporters: [otlphttp]
`;

export const STORAGE_ARRAY_COLLECTOR_CONFIGS: Record<
  StorageArrayPlatform,
  string
> = {
  flasharray: STORAGE_ARRAY_FLASHARRAY_COLLECTOR_CONFIG,
  "flasharray-exporter": STORAGE_ARRAY_FLASHARRAY_EXPORTER_COLLECTOR_CONFIG,
  flashblade: STORAGE_ARRAY_FLASHBLADE_COLLECTOR_CONFIG,
};

export interface StorageArraySetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  // False while no key is picked and `apiKey` is the placeholder.
  hasApiKey: boolean;
  platform: StorageArrayPlatform;
  /*
   * The array the guide installs for (an array's own Documentation tab).
   * Omitted on the product pages, where the guide suggests a name instead.
   */
  arrayName?: string | undefined;
}

interface GuideContext {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  platform: StorageArrayPlatform;
  settings: PlatformSettings;
  arrayName: string;
  isArrayNameKnown: boolean;
}

function isPrefilled(context: { apiKey: string; hasApiKey: boolean }): boolean {
  return (
    context.hasApiKey && context.apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER
  );
}

/*
 * install.sh prompts only for the values its environment does not already
 * hold, so the command carries the platform the reader picked (as the
 * collector config, which decides the platform and compose profile), the
 * array's name when it is known, and the reader's URL and key. Only a real
 * key goes there: the script writes whatever it is given into .env, and a
 * placeholder would become the key the agent sends.
 */
export function getStorageArrayInstallScriptCommand(data: {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  platform: StorageArrayPlatform;
  arrayName?: string | undefined;
}): string {
  const settings: PlatformSettings =
    STORAGE_ARRAY_PLATFORM_SETTINGS[data.platform];
  const environment: Array<string> = [];

  if (isPrefilled(data)) {
    if (data.oneuptimeUrl !== SETUP_GUIDE_URL_PLACEHOLDER) {
      environment.push(`ONEUPTIME_URL=${shellQuote(data.oneuptimeUrl)}`);
    }
    environment.push(
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${shellQuote(data.apiKey)}`,
    );
  }

  const arrayName: string = (data.arrayName || "").trim();
  if (arrayName) {
    environment.push(`STORAGE_ARRAY_NAME=${shellQuote(arrayName)}`);
  }

  environment.push(
    `STORAGE_ARRAY_COLLECTOR_CONFIG=${settings.collectorConfigFile}`,
  );

  return [
    `curl -sSL ${STORAGE_ARRAY_AGENT_RAW_URL}/install.sh -o install.sh`,
    [...environment, "bash install.sh"].join(" "),
  ].join("\n");
}

/*
 * The .env file a Docker Compose install writes, for one platform. Only the
 * native FlashArray endpoint verifies (or not) the array's certificate:
 * Pure's exporters never verify it, so their .env leaves the setting out.
 */
export function getStorageArrayEnvFile(data: {
  oneuptimeUrl: string;
  apiKey: string;
  platform: StorageArrayPlatform;
  arrayName: string;
}): string {
  const settings: PlatformSettings =
    STORAGE_ARRAY_PLATFORM_SETTINGS[data.platform];

  const lines: Array<string> = [
    `ONEUPTIME_URL=${data.oneuptimeUrl}`,
    `ONEUPTIME_TELEMETRY_INGESTION_KEY=${data.apiKey}`,
    `STORAGE_ARRAY_NAME=${shellQuote(data.arrayName)}`,
    `STORAGE_SYSTEM=${settings.storageSystem}`,
    `STORAGE_ARRAY_COLLECTOR_CONFIG=${settings.collectorConfigFile}`,
    `COMPOSE_PROFILES=${settings.composeProfile}`,
    `${settings.endpointVariable}=${settings.exampleEndpoint}`,
    `${settings.tokenVariable}=${STORAGE_ARRAY_TOKEN_PLACEHOLDER}`,
  ];

  if (!settings.exporterService) {
    lines.push("STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true");
  }

  return lines.join("\n");
}

function getPrerequisites(context: GuideContext): Array<string> {
  const prerequisites: Array<string> = [
    `Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the ${context.settings.arrayNoun}'s management address over HTTPS (TCP 443)`,
    `An administrator account on the ${context.settings.arrayNoun}, to create the agent's read-only user`,
  ];

  if (context.settings.exporterService) {
    prerequisites.push(
      "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image",
    );
  }

  return prerequisites;
}

function getReadOnlyUserStep(context: GuideContext): SetupGuideStep {
  if (context.settings.storageSystem === StorageSystem.PureStorageFlashBlade) {
    return {
      title: "Create a read-only user and API token",
      description:
        "The agent only ever reads. Give it its own user with the readonly role, never an administrator.",
      markdown: `On the FlashBlade, as an administrator, create a user named \`${STORAGE_ARRAY_READ_ONLY_USER}\` with the **readonly** role — in the FlashBlade GUI's user settings, or with \`pureadmin\` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.

FlashBlade API tokens start with \`T-\`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.`,
    };
  }

  return {
    title: "Create a read-only user and API token",
    description:
      "The agent only ever reads. Give it its own user with the readonly role, never an administrator.",
    markdown: `Create the token **without an expiry**, or the agent stops the day it expires.`,
    variants: [
      {
        label: "Purity CLI",
        markdown: `SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:

${codeBlock(
  "bash",
  `pureadmin create --role readonly ${STORAGE_ARRAY_READ_ONLY_USER}
pureadmin create --api-token ${STORAGE_ARRAY_READ_ONLY_USER}`,
)}`,
      },
      {
        label: "FlashArray GUI",
        markdown: `1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).
2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it \`${STORAGE_ARRAY_READ_ONLY_USER}\` and give it the **readonly** role.
3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.`,
      },
    ],
  };
}

/*
 * Pure documents the native OpenMetrics endpoint for Purity//FA 6.7.0 and
 * later (agents/StorageArrayAgent/README.md leads with the same release);
 * its exporter's deprecation notice says 6.6.11. Asking the array settles
 * it.
 */
function getCheckNativeEndpointStep(): SetupGuideStep {
  return {
    title: "Check the array serves its own metrics",
    description:
      "Purity//FA 6.7 and later serve OpenMetrics natively. Ask the array from the machine that will run the agent.",
    markdown: `${codeBlock(
      "bash",
      `curl -k 'https://<array>/metrics/array?namespace=purefa' --header 'Authorization: Bearer ${STORAGE_ARRAY_TOKEN_PLACEHOLDER}' | grep purefa_info`,
    )}

A \`purefa_info{...} 1\` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.`,
  };
}

function getArrayNameNote(context: GuideContext): string {
  if (context.isArrayNameKnown) {
    return `This installs the agent for **\`${context.arrayName}\`** — keep \`STORAGE_ARRAY_NAME\` exactly as it is, or the data registers as a new storage array.`;
  }
  return `Replace \`${context.arrayName}\` with a name for this array, such as \`fa-prod-01\`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.`;
}

function getInstallScriptVariant(context: GuideContext): string {
  const prefilled: boolean = isPrefilled(context);
  const asks: Array<string> = [];

  if (!prefilled) {
    asks.push(
      "your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)",
    );
  }

  if (!context.isArrayNameKnown) {
    asks.push(
      "an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array",
    );
  }

  asks.push(
    `the ${context.settings.arrayNoun}'s **management address** (host name or IP, no \`https://\`) and the read-only user's **API token**, which it reads without echoing`,
  );

  if (!context.settings.exporterService) {
    asks.push(
      "whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)",
    );
  }

  const intro: string = prefilled
    ? "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:"
    : "The command carries the platform you picked above. The script asks for:";

  const knownName: string = context.isArrayNameKnown
    ? `\n\nIt registers the array as **\`${context.arrayName}\`** — the name this array already has in OneUptime.`
    : "";

  return `${codeBlock(
    "bash",
    getStorageArrayInstallScriptCommand({
      oneuptimeUrl: context.oneuptimeUrl,
      apiKey: context.apiKey,
      hasApiKey: context.hasApiKey,
      platform: context.platform,
      arrayName: context.isArrayNameKnown ? context.arrayName : undefined,
    }),
  )}

${intro}

${asks
  .map((ask: string): string => {
    return `- ${ask}`;
  })
  .join("\n")}${knownName}

It installs to \`${STORAGE_ARRAY_AGENT_INSTALL_DIR}\`, writes a \`.env\` file only you can read (it holds the API token) and starts the agent with Docker Compose.`;
}

function getDockerComposeVariant(context: GuideContext): string {
  const notes: Array<string> = [
    getArrayNameNote(context),
    `Set \`${context.settings.endpointVariable}\` to the ${context.settings.arrayNoun}'s management address — host name or IP, no \`https://\` — and \`${context.settings.tokenVariable}\` to the read-only user's API token. Run \`chmod 600 .env\`: it holds the token.`,
  ];

  if (context.settings.exporterService) {
    notes.push(
      `\`COMPOSE_PROFILES=${context.settings.composeProfile}\` starts \`${context.settings.exporterService}\`, Pure's exporter, next to the collector; the two must match.`,
    );
  }

  return `Download the compose file and the three collector configs from the [StorageArrayAgent directory](${STORAGE_ARRAY_AGENT_SOURCE_URL}) into a new folder:

${codeBlock(
  "bash",
  [
    "mkdir oneuptime-storage-array-agent && cd oneuptime-storage-array-agent",
    ...STORAGE_ARRAY_AGENT_FILES.map((file: string): string => {
      return `curl -fsSLO ${STORAGE_ARRAY_AGENT_RAW_URL}/${file}`;
    }),
  ].join("\n"),
)}

Create a \`.env\` file next to them:

${codeBlock(
  "bash",
  getStorageArrayEnvFile({
    oneuptimeUrl: context.oneuptimeUrl,
    apiKey: context.apiKey,
    platform: context.platform,
    arrayName: context.arrayName,
  }),
)}

${notes
  .map((note: string): string => {
    return `- ${note}`;
  })
  .join("\n")}

Start the agent:

${codeBlock("bash", "docker compose up -d")}${
    context.apiKey === SETUP_GUIDE_API_KEY_PLACEHOLDER
      ? `

Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`
      : ""
  }`;
}

function getInstallStep(context: GuideContext): SetupGuideStep {
  return {
    title: "Install the agent",
    description:
      "Run it on any machine that can reach the array's management address. One agent monitors one array.",
    variants: [
      {
        label: "Install script",
        markdown: getInstallScriptVariant(context),
      },
      {
        label: "Docker Compose",
        markdown: getDockerComposeVariant(context),
      },
    ],
  };
}

function getVerifyStep(context: GuideContext): SetupGuideStep {
  const exporter: string = context.settings.exporterService
    ? `

\`docker compose ps\` in the agent's folder also lists **\`${context.settings.exporterService}\`**, Pure's exporter, which the collector reads the ${context.settings.arrayNoun} through.`
    : "";

  return {
    title: "Verify the installation",
    description: "Check that the collector is running and ready.",
    markdown: `${codeBlock(
      "bash",
      `docker ps --filter name=${STORAGE_ARRAY_AGENT_CONTAINER}
docker logs -f ${STORAGE_ARRAY_AGENT_CONTAINER}`,
    )}

Look for \`Everything is ready. Begin running and processing data.\` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.${exporter}`,
  };
}

function inAgentFolder(commands: Array<string>): string {
  return [`cd ${STORAGE_ARRAY_AGENT_INSTALL_DIR}`, ...commands].join("\n");
}

function getEnvironmentVariablesTopic(context: GuideContext): SetupGuideTopic {
  return {
    title: "Environment variables",
    summary: "Every setting the collector reads from its .env file.",
    markdown: `The install script writes these to \`${STORAGE_ARRAY_AGENT_INSTALL_DIR}/.env\`; a Docker Compose install reads them from the \`.env\` file next to \`docker-compose.yml\`. After changing one, apply it with \`docker compose up -d\` in the agent's folder.

| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime instance URL (e.g. \`${context.oneuptimeUrl}\`) |
| \`ONEUPTIME_TELEMETRY_INGESTION_KEY\` | Yes | Telemetry ingestion key — the one picked in step 1 |
| \`STORAGE_ARRAY_NAME\` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the \`storage.array.name\` resource attribute. Keep it stable — changing it registers a new storage array |
| \`STORAGE_SYSTEM\` | No | The platform, stamped as the \`storage.system\` resource attribute: \`purestorage.flasharray\` or \`purestorage.flashblade\` (default: \`purestorage.flasharray\`) |
| \`STORAGE_ARRAY_COLLECTOR_CONFIG\` | No | Which shipped config runs: \`otel-collector-config.yaml\` (FlashArray, native — the default), \`otel-collector-config.flasharray-exporter.yaml\` (older FlashArray) or \`otel-collector-config.flashblade.yaml\` (FlashBlade) |
| \`COMPOSE_PROFILES\` | No | Starts the exporter the config needs: empty for the native FlashArray config, \`flasharray-exporter\` or \`flashblade\` for the others |
| \`PURE_FA_ENDPOINT\` | FlashArray | The FlashArray's management address — host name or IP, no \`https://\` |
| \`PURE_FA_API_TOKEN\` | FlashArray | API token of the FlashArray user with the readonly role |
| \`PURE_FB_ENDPOINT\` | FlashBlade | The FlashBlade's management address — host name or IP, no \`https://\` |
| \`PURE_FB_API_TOKEN\` | FlashBlade | API token of the FlashBlade user with the readonly role |
| \`STORAGE_ARRAY_INSECURE_SKIP_VERIFY\` | No | \`true\` accepts the array's self-signed certificate on the native endpoint; \`false\` verifies it (default: \`true\`). Pure's exporters never verify the array's certificate, so it does not apply to them |`,
  };
}

function getCollectorConfigTopic(context: GuideContext): SetupGuideTopic {
  const intervals: string =
    context.settings.storageSystem === StorageSystem.PureStorageFlashBlade
      ? "`/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly"
      : "`/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute";

  const source: string = context.settings.exporterService
    ? `The collector reads the ${context.settings.arrayNoun} through \`${context.settings.exporterService}\`, Pure's exporter, which logs in to the ${context.settings.arrayNoun}'s REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.`
    : "The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.";

  const relabel: string =
    context.settings.storageSystem === StorageSystem.PureStorageFlashArray
      ? "\n- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept."
      : "";

  return {
    title: "How the agent scrapes, and its collector config",
    summary:
      "One scrape job per endpoint, each as often as it is worth, and the full collector config.",
    markdown: `- ${source}
- **One scrape job per endpoint**, each read as often as it is worth: ${intervals}.
- **Every job labels its series \`scrape_endpoint: <endpoint>\`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.${relabel}
- **No \`send_batch_max_size\`.** OneUptime rebuilds the inventory from one whole scrape, so the \`batch\` processor never splits one.

This is the full \`${context.settings.collectorConfigFile}\` the agent runs; the \`.env\` file supplies the \`\${env:...}\` values:

${codeBlock("yaml", STORAGE_ARRAY_COLLECTOR_CONFIGS[context.platform])}`,
  };
}

function getSyslogTopic(context: GuideContext): SetupGuideTopic {
  const pointArray: string =
    context.settings.storageSystem === StorageSystem.PureStorageFlashBlade
      ? `On the FlashBlade, as an administrator, add a syslog server \`udp://<agent-host>:${STORAGE_ARRAY_SYSLOG_PORT}\` (or \`tcp://\`) in its syslog settings.`
      : `On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add \`udp://<agent-host>:${STORAGE_ARRAY_SYSLOG_PORT}\` (or \`tcp://<agent-host>:${STORAGE_ARRAY_SYSLOG_PORT}\`) and send a test message.`;

  return {
    title: "Ship the array's syslog",
    summary:
      "Receive the alerts and audit events the array forwards, to fill the Logs page.",
    markdown: `The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps \`storage.array.name\` on every line, so they land on this array's **Logs** page.

1. In \`${context.settings.collectorConfigFile}\`, uncomment the \`syslog/tcp\` and \`syslog/udp\` receivers and the \`logs\` pipeline. Classic BSD syslog timestamps carry no time zone: set \`location\` to the array's time zone unless its clock runs on UTC.
2. In \`docker-compose.yml\`, uncomment the \`ports:\` block that publishes \`${STORAGE_ARRAY_SYSLOG_PORT}/tcp\` and \`${STORAGE_ARRAY_SYSLOG_PORT}/udp\`, and open the port on the machine's firewall for the array's management network.
3. Apply both:

${codeBlock("bash", inAgentFolder(["docker compose up -d"]))}

4. ${pointArray}`,
  };
}

function getLabelsTopic(): SetupGuideTopic {
  return {
    title: "Tag the array with project labels",
    summary:
      "Attach labels such as team or environment to the array from the collector config.",
    markdown: `Any resource attribute prefixed with \`oneuptime.label.\` becomes a project label on the array: \`oneuptime.label.<dimension>=<value>\` is the label \`<dimension>:<value>\`. Add them to the \`resource\` processor of the collector config you use, next to \`storage.array.name\`:

${codeBlock(
  "yaml",
  `processors:
  resource:
    attributes:
      # ...existing attributes...
      - key: oneuptime.label.team
        value: storage
        action: upsert
      - key: oneuptime.label.env
        value: production
        action: upsert`,
)}

Then restart the collector so it reads the new config:

${codeBlock(
  "bash",
  inAgentFolder([`docker compose restart ${STORAGE_ARRAY_AGENT_CONTAINER}`]),
)}

The array shows up tagged \`team:storage\` and \`env:production\`. Labels are matched case-insensitively, so an existing \`Production\` label is reused; labels added in the OneUptime UI are never removed by the agent.`,
  };
}

function getCollectedDataTopic(context: GuideContext): SetupGuideTopic {
  if (context.settings.storageSystem === StorageSystem.PureStorageFlashBlade) {
    return {
      title: "What the agent collects",
      summary:
        "Capacity, performance, alerts, hardware, file systems and buckets.",
      markdown: `Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:

| Endpoint | Data |
|----------|------|
| **Array** (\`/metrics/array\`) | \`purefb_info\`, capacity and data reduction (\`purefb_array_space_*\`), performance per protocol, open alerts (\`purefb_alerts_open\`), hardware health (\`purefb_hardware_health\`) |
| **File systems** (\`/metrics/filesystems\`) | Space, data reduction and performance per file system |
| **Object store** (\`/metrics/objectstore\`) | Space, quota, object counts and performance per bucket |`,
    };
  }

  return {
    title: "What the agent collects",
    summary:
      "Capacity, performance, alerts, hardware, volumes, hosts, pods and directories.",
    markdown: `Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:

| Endpoint | Data |
|----------|------|
| **Array** (\`/metrics/array\`) | \`purefa_info\`, capacity and data reduction (\`purefa_array_space_*\`), performance, open alerts (\`purefa_alerts_open\`), hardware components, drives, controllers and network interfaces |
| **Volumes** (\`/metrics/volumes\`) | Latency, IOPS, bandwidth, space and data reduction per volume |
| **Hosts** (\`/metrics/hosts\`) | Connectivity, connected volumes, latency, IOPS and space per host |
| **Pods** (\`/metrics/pods\`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |
| **Directories** (\`/metrics/directories\`) | Space and performance of FlashArray file services' managed directories |`,
  };
}

function getSeveralArraysTopic(): SetupGuideTopic {
  return {
    title: "Monitor several arrays",
    summary: "One agent per array, each in its own folder with its own name.",
    markdown: `One agent reads one array. To monitor several from the same machine, install each into its own folder with its own \`.env\`, and give each its own \`container_name\` in its \`docker-compose.yml\` (for example \`${STORAGE_ARRAY_AGENT_CONTAINER}-fa02\`) — two containers cannot share a name:

${codeBlock(
  "bash",
  `INSTALL_DIR=${STORAGE_ARRAY_AGENT_INSTALL_DIR}-fa02 bash install.sh`,
)}`,
  };
}

function getSystemdTopic(): SetupGuideTopic {
  return {
    title: "Run as a systemd service",
    summary:
      "Start the agent with the machine, not only by Docker's restart policy.",
    markdown: `The agent ships a systemd unit that assumes the install script's folder:

${codeBlock(
  "bash",
  inAgentFolder([
    "sudo cp systemd/oneuptime-storage-array-agent.service /etc/systemd/system/",
    "sudo systemctl daemon-reload",
    "sudo systemctl enable --now oneuptime-storage-array-agent",
  ]),
)}`,
  };
}

function getUpgradeTopic(): SetupGuideTopic {
  return {
    title: "Upgrade or uninstall the agent",
    summary: "Pull the latest images, or stop and remove the agent.",
    markdown: `**Upgrade** to the images the compose file pins:

${codeBlock(
  "bash",
  inAgentFolder(["docker compose pull", "docker compose up -d"]),
)}

When a newer OneUptime release bumps a pin, re-run \`install.sh\`: it reuses every value in your \`.env\` and refreshes the compose file and the collector configs.

**Uninstall** the agent:

${codeBlock("bash", inAgentFolder(["docker compose down"]))}

Then delete the read-only user and its API token on the array if you no longer need them.`,
  };
}

function getAdvancedTopics(context: GuideContext): Array<SetupGuideTopic> {
  return [
    getEnvironmentVariablesTopic(context),
    getCollectorConfigTopic(context),
    getSyslogTopic(context),
    getLabelsTopic(),
    getCollectedDataTopic(context),
    getSeveralArraysTopic(),
    getSystemdTopic(),
    getUpgradeTopic(),
  ];
}

function getTroubleshootingTopics(
  context: GuideContext,
): Array<SetupGuideTopic> {
  const knownName: string = context.isArrayNameKnown
    ? ` This array is **\`${context.arrayName}\`**.`
    : "";

  const topics: Array<SetupGuideTopic> = [
    {
      title: "Run the diagnostic script first",
      markdown: `\`troubleshoot.sh\` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with \`401\` or \`422\`, which the collector logs as a single \`Exporting failed\` line per batch that is easy to miss, so the script asks \`GET /otlp/v1/validate\` for a direct 200/401 verdict.

${codeBlock(
  "bash",
  `curl -sSL ${STORAGE_ARRAY_AGENT_RAW_URL}/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh -d ${STORAGE_ARRAY_AGENT_INSTALL_DIR}    # or the folder with docker-compose.yml`,
)}

It ends with a verdict naming the most likely cause.`,
    },
    {
      title: "No array appears in OneUptime",
      markdown: `1. Check the collector logs: \`docker logs ${STORAGE_ARRAY_AGENT_CONTAINER}\`. \`server returned HTTP status 401\` means the array refused the API token, \`404\` means the FlashArray has no native endpoint, \`x509\` means TLS verification is on against the array's self-signed certificate, \`no such host\` or \`connection refused\` means a wrong \`${context.settings.endpointVariable}\`, and an export \`401\` means a bad ingestion key.
2. Make sure \`STORAGE_ARRAY_NAME\` is set — discovery keys on the \`storage.array.name\` resource attribute, and the collector refuses to start without it.
3. Make sure \`STORAGE_ARRAY_COLLECTOR_CONFIG\` and \`COMPOSE_PROFILES\` name the same platform.`,
    },
  ];

  if (context.settings.storageSystem === StorageSystem.PureStorageFlashArray) {
    topics.push({
      title: "The FlashArray answers 404",
      markdown: `Its Purity//FA has no native OpenMetrics endpoint. Set \`STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml\` and \`COMPOSE_PROFILES=flasharray-exporter\` in \`.env\` and run \`docker compose up -d\` — or re-run \`install.sh\` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.`,
    });
  }

  topics.push(
    {
      title: "The array refuses the API token",
      markdown: `Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (\`pureadmin create --api-token ${STORAGE_ARRAY_READ_ONLY_USER}\` on a FlashArray), put it in \`.env\` as \`${context.settings.tokenVariable}\` and run \`docker compose up -d\`.`,
    },
    {
      title: "x509 or TLS errors",
      markdown:
        "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.",
    },
    {
      title: "The exporter does not resolve",
      markdown: `\`${STORAGE_ARRAY_FA_EXPORTER_SERVICE}\` or \`${STORAGE_ARRAY_FB_EXPORTER_SERVICE}\` is not running: \`COMPOSE_PROFILES\` must match \`STORAGE_ARRAY_COLLECTOR_CONFIG\` — \`flasharray-exporter\` for the FlashArray exporter config, \`flashblade\` for the FlashBlade config. Fix \`.env\` and run \`docker compose up -d\`; \`docker compose ps\` then lists the exporter.`,
    },
    {
      title: 'Array shows as "Disconnected"',
      markdown: `1. Check that the agent is running: \`docker ps --filter name=${STORAGE_ARRAY_AGENT_CONTAINER}\`
2. Check the agent logs for errors: \`docker logs ${STORAGE_ARRAY_AGENT_CONTAINER} 2>&1 | grep -i error\`
3. Verify your OneUptime URL and ingestion key are correct.
4. Ensure the agent machine can reach the OneUptime instance over the network.`,
    },
    {
      title: "Array appears under the wrong name",
      markdown: `The array's identity comes from \`STORAGE_ARRAY_NAME\`, stamped on every metric as \`storage.array.name\`.${knownName} Fix it in \`.env\` and apply it with \`docker compose up -d\` in the agent's folder — note that a new name registers a new storage array.`,
    },
  );

  return topics;
}

/**
 * The Storage Array Agent install guide for one platform, filled in with
 * the reader's OneUptime URL and ingestion key.
 */
export function getStorageArraySetupGuide(
  options: StorageArraySetupGuideOptions,
): SetupGuideContent {
  const knownArrayName: string = (options.arrayName || "").trim();

  const context: GuideContext = {
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    hasApiKey: options.hasApiKey,
    platform: options.platform,
    settings: STORAGE_ARRAY_PLATFORM_SETTINGS[options.platform],
    arrayName: knownArrayName || STORAGE_ARRAY_EXAMPLE_NAME,
    isArrayNameKnown: Boolean(knownArrayName),
  };

  const steps: Array<SetupGuideStep> = [getReadOnlyUserStep(context)];

  if (options.platform === "flasharray") {
    steps.push(getCheckNativeEndpointStep());
  }

  steps.push(getInstallStep(context), getVerifyStep(context));

  return {
    prerequisites: getPrerequisites(context),
    steps: steps,
    advanced: getAdvancedTopics(context),
    troubleshooting: getTroubleshootingTopics(context),
    links: [
      {
        title: "Storage Array Agent documentation",
        url: "/docs/telemetry/storage-arrays",
      },
      {
        title: "Storage array monitors and alerts",
        url: "/docs/monitor/storage-array-monitor",
      },
    ],
  };
}

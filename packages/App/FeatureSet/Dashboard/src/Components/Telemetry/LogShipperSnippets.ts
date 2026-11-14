import {
  CompatibleIngestEndpoint,
  getFluentBitHost,
  getHostAndPort,
} from "./CompatibleIngestGuide";

/*
 * THE LOG SHIPPERS' FILES: Fluent Bit's and Fluentd's, as the logs guide
 * (Send your first logs, and the Logs Setup Guide) hands them out.
 *
 * Both are built from the server's own address - its protocol and HOST - as
 * the OTLP endpoint shown above them is (issue #7753). Before, Fluent Bit
 * was given HOST as its Host, which on a self-hosted server carries the port
 * ("localhost:18811", a name Fluent Bit cannot resolve), with Port 443 and
 * Tls On whatever the server is, and Logs_uri /v1/logs, a path no server
 * serves (404). Fluentd posted to https://<HOST>/v1/logs: https always, and
 * the same 404.
 *
 * The paths are the addresses the bundled ingress (packages/Nginx) sends to
 * the App with billing on or off, so they work on a self-hosted server and
 * on OneUptime Cloud alike, and they are the ones the docs hand out.
 *
 * HOST is a host with an optional port, never a path: Common/UI/Config reads
 * it as a Hostname when the Dashboard loads, which refuses one.
 *
 * React-free on purpose: the files are tested without the guide.
 */

// The App's OTLP logs route, under the /otlp of the OTLP endpoint the guide shows.
export const FLUENT_BIT_LOGS_URI: string = "/otlp/v1/logs";

// The ingress's address for the App's /fluentd/v1/logs, which it rewrites to.
export const FLUENTD_LOGS_PATH: string = "/fluentd/logs";

export function getFluentBitConfig(endpoint: CompatibleIngestEndpoint): string {
  const { port } = getHostAndPort(endpoint);
  const isTls: boolean = endpoint.protocol !== "http";

  return `# fluent-bit.conf
[SERVICE]
    Flush        5
    Log_Level    info
    Parsers_File parsers.conf

[INPUT]
    Name         tail
    Path         /var/log/*.log
    Tag          app.logs

[OUTPUT]
    Name         opentelemetry
    Match        *
    Host         ${getFluentBitHost(endpoint)}
    Port         ${port}
    Tls          ${isTls ? "On" : "Off"}
    Header       x-oneuptime-token ${endpoint.key}
    Logs_uri     ${FLUENT_BIT_LOGS_URI}`;
}

// The address is in fluent-bit.conf alone: nothing here sets it.
export function getFluentBitDockerCompose(): string {
  return `# docker-compose.yml
services:
  fluent-bit:
    image: fluent/fluent-bit:latest
    volumes:
      - ./fluent-bit.conf:/fluent-bit/etc/fluent-bit.conf
      - /var/log:/var/log:ro`;
}

export function getFluentdConfig(endpoint: CompatibleIngestEndpoint): string {
  return `# fluentd.conf
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

<source>
  @type tail
  path /var/log/*.log
  pos_file /var/log/fluentd.pos
  tag app.logs
  <parse>
    @type json
  </parse>
</source>

<match **>
  @type http
  endpoint ${endpoint.protocol}://${endpoint.host}${FLUENTD_LOGS_PATH}
  headers {"x-oneuptime-token":"${endpoint.key}"}
  json_array true
  <format>
    @type json
  </format>
  <buffer>
    @type memory
    flush_interval 5s
  </buffer>
</match>`;
}

export function getFluentdDockerCompose(): string {
  return `# docker-compose.yml
services:
  fluentd:
    image: fluent/fluentd:latest
    volumes:
      - ./fluentd.conf:/fluentd/etc/fluentd.conf
      - /var/log:/var/log:ro
    ports:
      - "24224:24224"`;
}

import {
  CompatibleIngestEndpoint,
  getFluentBitHostAndPort,
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
  const { host, port } = getFluentBitHostAndPort(endpoint);
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
    Host         ${host}
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

/*
 * Where Fluentd runs, which says where its tail keeps its place in each file.
 *  - On the host, Fluentd's package (fluent-package) runs its service as
 *    its own user, _fluentd, who owns /var/log/fluent: the package keeps its
 *    own log and buffers there. /fluentd/log is no folder of a host's: run
 *    as _fluentd, Fluentd could not create it and the tail failed in a loop
 *    (Errno::EACCES); run as root, it made /fluentd at the root of the
 *    host's file system (issue #8007).
 *  - In Docker Compose, the image's own folder, /fluentd/log, which the
 *    Compose file keeps in a volume. /var/log is the host's, mounted
 *    read-only.
 */
export enum FluentdRunsIn {
  Host = "Host",
  DockerCompose = "DockerCompose",
}

export const FLUENTD_POSITION_FILES: Record<FluentdRunsIn, string> = {
  [FluentdRunsIn.Host]: "/var/log/fluent/fluentd.pos",
  [FluentdRunsIn.DockerCompose]: "/fluentd/log/fluentd.pos",
};

/*
 * The field the file writes the time Fluentd gave each event to, which the
 * Fluentd ingest reads a log's time from when its record has none of its
 * own (Telemetry/Utils/FluentRecordTime.ts).
 */
export const FLUENTD_EVENT_TIME_KEY: string = "fluentd_time";

/*
 * The answers Fluentd sends a batch again for: OneUptime busy (429, a
 * project over its rate) or restarting (502, 503 or 504 from the ingress).
 * Fluentd's own default is 503 alone, and it drops a batch on any other
 * answer (issue #8006).
 */
export const FLUENTD_RETRYABLE_RESPONSE_CODES: Array<number> = [
  429, 502, 503, 504,
];

/*
 * Fluentd's file, which sent nothing as it was handed out (issue #7886).
 * Now:
 *  - the tail reads each line as it is, into "message", the first field
 *    OneUptime takes a log's body from, and the filter after it reads a
 *    JSON line's own fields. A line that is not JSON goes on as it is:
 *    parsed as JSON in the tail, it was refused ("pattern not matched").
 *  - a JSON line keeps its own "time" (keep_time_key), and its event keeps
 *    the time the tail read it (reserve_time): Fluentd's json parser took
 *    "time" out of the record as the event's time, and the HTTP output
 *    sends only the record, so a log's time was lost and OneUptime stored
 *    it at the time it arrived (issue #8010). Read as Fluentd reads a time
 *    (seconds), an ISO time was a time in 1970.
 *  - every event's time is written into its record, as fluentd_time: the
 *    time the tail read a plain line, or the time a forwarded event's
 *    sender gave it. The HTTP output takes no <inject> section ("section
 *    <inject> is not used"), so a record_transformer filter writes it, to
 *    the nanosecond (Ruby, as Fluentd documents: ${time} without it is to
 *    the second only, in the host's zone).
 *  - the tail keeps its place in each file in a folder its user owns, on
 *    the host and in Docker Compose alike (FLUENTD_POSITION_FILES).
 *  - a batch OneUptime answers with 429, 502, 503 or 504 is sent again,
 *    about every 30 seconds at most, for up to 72 hours (Fluentd's own
 *    retry_timeout, said here). Fluentd's default backoff doubles without
 *    a bound: after an hour's outage, its next try could be an hour away.
 *  - Fluentd's own logs (tagged fluent.info, fluent.warn, ...) go to the
 *    @FLUENT_LOG label and stop there. With no such label, <match **> takes
 *    them too and sends them to OneUptime.
 *  - json_array sends a buffer chunk as one request, so chunk_limit_size
 *    keeps each request under the most the ingress takes on /fluentd/logs
 *    (1 MB, nginx's default), as the docs page's file does. Fluentd's own
 *    default is 8 MB a chunk.
 */
export function getFluentdConfig(
  endpoint: CompatibleIngestEndpoint,
  runsIn: FluentdRunsIn,
): string {
  return `# fluentd.conf
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

<source>
  @type tail
  path /var/log/*.log
  pos_file ${FLUENTD_POSITION_FILES[runsIn]}
  tag app.logs
  <parse>
    @type none
  </parse>
</source>

# A JSON line keeps its fields, its own time too; any other line is sent as it is
<filter app.**>
  @type parser
  key_name message
  reserve_data true
  reserve_time true
  remove_key_name_field true
  emit_invalid_record_to_error false
  <parse>
    @type json
    keep_time_key true
  </parse>
</filter>

# Send the time Fluentd gave each event: the HTTP output sends only the record
<filter **>
  @type record_transformer
  enable_ruby true
  <record>
    ${FLUENTD_EVENT_TIME_KEY} \${time.utc.strftime("%Y-%m-%dT%H:%M:%S.%NZ")}
  </record>
</filter>

<match **>
  @type http
  endpoint ${endpoint.protocol}://${endpoint.host}${FLUENTD_LOGS_PATH}
  headers {"x-oneuptime-token":"${endpoint.key}"}
  json_array true
  # Send a batch again when OneUptime is busy (429) or restarting (502, 503, 504)
  retryable_response_codes ${FLUENTD_RETRYABLE_RESPONSE_CODES.join(",")}
  <format>
    @type json
  </format>
  <buffer>
    @type memory
    flush_interval 5s
    chunk_limit_size 900k
    # Try again at least every 30 seconds, for up to 72 hours
    retry_max_interval 30s
    retry_timeout 72h
  </buffer>
</match>

# Keep Fluentd's own logs out of OneUptime
<label @FLUENT_LOG>
  <match **>
    @type null
  </match>
</label>`;
}

/*
 * On the host, as Fluentd's package runs it: its service reads
 * /etc/fluent/fluentd.conf, as its user _fluentd. That user is in no group
 * but its own, so the files in /var/log that only root and the adm group
 * may read (auth.log and kern.log on Debian and Ubuntu, root:adm 0640) were
 * skipped ("unreadable. It is excluded"); the adm group reads them (issue
 * #8005, on the host). The service stays its own user, not root: it listens
 * on port 24224 of every address the host has.
 */
export function getFluentdHostCommands(): string {
  return `# Fluentd's package runs its service with /etc/fluent/fluentd.conf
sudo cp fluentd.conf /etc/fluent/fluentd.conf
# Let the service read the logs only root and the adm group may read, such as auth.log
sudo usermod -aG adm _fluentd
sudo systemctl restart fluentd`;
}

/*
 * The image (fluent/fluentd) runs /fluentd/etc/$FLUENTD_CONF, and its
 * FLUENTD_CONF is fluent.conf: mounted as /fluentd/etc/fluentd.conf, the
 * file was never read, and Fluentd ran the image's own, which sends nothing
 * here. The fluentd-positions volume keeps the tail's place in each file
 * when the container is made again. The address is in fluentd.conf alone:
 * nothing here sets it.
 *
 * It runs as root (issue #8005). The image's user, fluent, could not read
 * the files in /var/log that only root may read (syslog, auth.log and
 * kern.log on many distributions): Fluentd logged "unreadable. It is
 * excluded" and sent nothing from them. The adm group (group_add) reads
 * Debian's and Ubuntu's, but no group reads a file of root's alone, as
 * Red Hat's are; root reads them all, on every distribution, and the
 * container keeps it in: /var/log is mounted read-only. Root also writes
 * the position volume, which the image made fluent's.
 */
export function getFluentdDockerCompose(): string {
  return `# docker-compose.yml
services:
  fluentd:
    image: fluent/fluentd:latest
    # Root reads every file in /var/log, the ones only root may read too
    user: root
    volumes:
      - ./fluentd.conf:/fluentd/etc/fluent.conf
      - /var/log:/var/log:ro
      - fluentd-positions:/fluentd/log
    ports:
      - "24224:24224"

volumes:
  fluentd-positions:`;
}

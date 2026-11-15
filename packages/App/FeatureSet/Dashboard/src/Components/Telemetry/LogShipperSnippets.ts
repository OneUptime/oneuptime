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
 * Where Fluentd runs, which says which folder it keeps what must outlive it
 * in (FLUENTD_STATE_FOLDERS): its place in each file the tail reads, and
 * the batches it has yet to send.
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

export const FLUENTD_STATE_FOLDERS: Record<FluentdRunsIn, string> = {
  [FluentdRunsIn.Host]: "/var/log/fluent",
  [FluentdRunsIn.DockerCompose]: "/fluentd/log",
};

export const FLUENTD_POSITION_FILES: Record<FluentdRunsIn, string> = {
  [FluentdRunsIn.Host]: `${FLUENTD_STATE_FOLDERS[FluentdRunsIn.Host]}/fluentd.pos`,
  [FluentdRunsIn.DockerCompose]: `${FLUENTD_STATE_FOLDERS[FluentdRunsIn.DockerCompose]}/fluentd.pos`,
};

/*
 * The folder the output keeps its batches in until OneUptime takes them
 * (issue #8242). The buffer was in memory: a restart of Fluentd while it
 * was still sending a batch again (a container made again, a reboot,
 * systemctl restart, an out-of-memory kill) lost every batch it held, and
 * the tail had already moved its place past their lines, so they were not
 * read again. A file buffer keeps them on disk, in the state folder, and
 * Fluentd sends them when it starts again. "oneuptime" is this output's own
 * folder: the package's own file keeps its buffers beside it, and Fluentd
 * refuses two buffers that share a path.
 */
export const FLUENTD_BUFFER_PATHS: Record<FluentdRunsIn, string> = {
  [FluentdRunsIn.Host]: `${FLUENTD_STATE_FOLDERS[FluentdRunsIn.Host]}/buffer/oneuptime`,
  [FluentdRunsIn.DockerCompose]: `${FLUENTD_STATE_FOLDERS[FluentdRunsIn.DockerCompose]}/buffer/oneuptime`,
};

/*
 * The most the file buffer keeps on disk: 512 MB, the most the memory
 * buffer held (Fluentd's own limit for one). A file buffer's own limit is
 * 64 GB, more than a small host has. When it is full, the tail reads no
 * more, at its place, until a batch is sent; a sender on the forward port
 * is turned away.
 */
export const FLUENTD_BUFFER_TOTAL_LIMIT: string = "512m";

// The port of Fluentd's forward input, where Docker's fluentd log driver sends.
export const FLUENTD_FORWARD_PORT: number = 24224;

/*
 * The address the forward input listens on (issue #8243). It was every
 * address, with no key: anyone who could reach the port could send logs to
 * OneUptime under the person's ingestion key, and in Docker Compose to a
 * Fluentd that runs as root. The guide's own senders are all on the host:
 * Docker's fluentd log driver connects from the Docker daemon to
 * localhost:24224, and so do apps on the host.
 *  - On the host, Fluentd listens on 127.0.0.1 alone.
 *  - In Docker Compose, on every address of the container, which a
 *    published port needs; the Compose file publishes the port on the
 *    host's 127.0.0.1 alone (FLUENTD_FORWARD_PUBLISHED).
 * The docs page says how to take events from other hosts, with a shared
 * key and TLS (FLUENTD_OTHER_HOSTS_DOCS_PATH).
 */
export const FLUENTD_FORWARD_BINDS: Record<FluentdRunsIn, string> = {
  [FluentdRunsIn.Host]: "127.0.0.1",
  [FluentdRunsIn.DockerCompose]: "0.0.0.0",
};

export const FLUENTD_FORWARD_PUBLISHED: string = `127.0.0.1:${FLUENTD_FORWARD_PORT}:${FLUENTD_FORWARD_PORT}`;

// The docs section that says how to take events from other hosts.
export const FLUENTD_OTHER_HOSTS_DOCS_PATH: string =
  "/docs/telemetry/fluentd#take-records-from-other-hosts";

// Why the forward input listens where it does, where it runs.
const FLUENTD_FORWARD_BIND_COMMENTS: Record<FluentdRunsIn, string> = {
  [FluentdRunsIn.Host]: "# This host alone may send here.",
  [FluentdRunsIn.DockerCompose]:
    "# Every address of the container: docker-compose.yml publishes the port to this host alone.",
};

/*
 * The field the file writes the time Fluentd gave each event to, which the
 * Fluentd ingest reads a log's time from when its record has none of its
 * own (Telemetry/Utils/FluentRecordTime.ts).
 */
export const FLUENTD_EVENT_TIME_KEY: string = "fluentd_time";

/*
 * The answers Fluentd sends a batch again for: OneUptime busy (429, an
 * ingestion key over its rate) or restarting (502, 503 or 504 from the
 * ingress). Fluentd's own default is 503 alone, and it drops a batch on
 * any other answer (issue #8006).
 */
export const FLUENTD_RETRYABLE_RESPONSE_CODES: Array<number> = [
  429, 502, 503, 504,
];

/*
 * Fluentd's file, which sent nothing as it was handed out (issue #7886).
 * Now:
 *  - the forward input takes events from this host alone (issue #8243,
 *    FLUENTD_FORWARD_BINDS), and the file says where the docs say how to
 *    take them from other hosts.
 *  - the tail reads each line as it is, into "message", the first field
 *    OneUptime takes a log's body from, and the filter after it reads a
 *    JSON line's own fields. A line that is not JSON goes on as it is:
 *    parsed as JSON in the tail, it was refused ("pattern not matched").
 *  - the json parser reads no line's time: its time_key is fluentd_time,
 *    a field the line does not have yet (the record_transformer filter
 *    after it writes it). So a line's "time" stays in its record as
 *    written, for the ingest to read (issue #8010), and the event keeps
 *    the time the tail read the line (reserve_time). With time_key "time"
 *    (the parser's default), Fluentd read a line's "time" itself: as
 *    seconds, so an ISO time was a time in 1970, and a "time" that was no
 *    text and no number (null, true, a list, an object) failed the parse,
 *    and the filter dropped the line without a word (issue #8241). The
 *    ingest stores such a line at the time Fluentd read it (fluentd_time),
 *    and keeps its "time" as an attribute.
 *  - every event's time is written into its record, as fluentd_time: the
 *    time the tail read a plain line, or the time a forwarded event's
 *    sender gave it. The HTTP output takes no <inject> section ("section
 *    <inject> is not used"), so a record_transformer filter writes it, to
 *    the nanosecond (Ruby, as Fluentd documents: ${time} without it is to
 *    the second only, in the host's zone).
 *  - the tail keeps its place in each file, and the output its batches, in
 *    a folder Fluentd's user owns, on the host and in Docker Compose alike
 *    (FLUENTD_STATE_FOLDERS); the batches on disk, so a restart loses none
 *    (FLUENTD_BUFFER_PATHS, issue #8242), at most 512 MB of them.
 *  - a batch OneUptime answers with 429, 502, 503 or 504 is sent again,
 *    at most about 30 seconds apart, for up to 72 hours (Fluentd's own
 *    retry_timeout, said here). Fluentd's default backoff doubles without
 *    a bound: after an hour's outage, its next try could be an hour away.
 *  - Fluentd's own logs (tagged fluent.info, fluent.warn, ...) go to the
 *    @FLUENT_LOG label and stop there. With no such label, <match **> takes
 *    them too and sends them to OneUptime.
 *  - json_array sends a buffer chunk as one request, so chunk_limit_size
 *    keeps each request under the most the ingress takes on /fluentd/logs
 *    (1 MB, nginx's default), as the docs page's file does. Fluentd's own
 *    default is 8 MB a chunk in memory, 256 MB in a file.
 */
export function getFluentdConfig(
  endpoint: CompatibleIngestEndpoint,
  runsIn: FluentdRunsIn,
): string {
  return `# fluentd.conf
<source>
  @type forward
  port ${FLUENTD_FORWARD_PORT}
  ${FLUENTD_FORWARD_BIND_COMMENTS[runsIn]}
  # To take events from other hosts, with a shared key and TLS, see
  # ${endpoint.protocol}://${endpoint.host}${FLUENTD_OTHER_HOSTS_DOCS_PATH}
  bind ${FLUENTD_FORWARD_BINDS[runsIn]}
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
    # Leave each line's "time" as it is, for OneUptime to read: Fluentd drops a line
    # whose "time" is null, true, a list or an object. The next filter adds ${FLUENTD_EVENT_TIME_KEY}.
    time_key ${FLUENTD_EVENT_TIME_KEY}
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
    # Keep the batches on disk until OneUptime takes them: a restart of Fluentd loses none
    @type file
    path ${FLUENTD_BUFFER_PATHS[runsIn]}
    # At most 512 MB: when it is full, the tail waits, at its place in each file
    total_limit_size ${FLUENTD_BUFFER_TOTAL_LIMIT}
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
 * #8005, on the host). The service stays its own user, not root: it is a
 * network service, if on 127.0.0.1 alone now (issue #8243).
 */
export function getFluentdHostCommands(): string {
  return `# Fluentd's package runs its service with /etc/fluent/fluentd.conf
sudo cp fluentd.conf /etc/fluent/fluentd.conf
# Let the service read the logs only root and the adm group may read, such as auth.log
sudo usermod -aG adm _fluentd
sudo systemctl restart fluentd`;
}

/*
 * The capabilities the Compose file leaves root (issue #8243): reading and
 * writing any file, whoever owns it, which is all it needs. Root reads a
 * file of its own without it, but not another user's that others may not
 * read (Ubuntu's syslog, syslog:adm 0640), and it writes the state volume,
 * which the image made its user fluent's. Docker gives a container thirteen
 * more by default (to change a file's owner, to kill another user's
 * process, to bind a port below 1024, ...), none of which Fluentd uses here.
 */
export const FLUENTD_COMPOSE_CAPABILITIES: Array<string> = ["DAC_OVERRIDE"];

/*
 * The image (fluent/fluentd) runs /fluentd/etc/$FLUENTD_CONF, and its
 * FLUENTD_CONF is fluent.conf: mounted as /fluentd/etc/fluentd.conf, the
 * file was never read, and Fluentd ran the image's own, which sends nothing
 * here. The fluentd-state volume keeps the tail's place in each file, and
 * the batches still to send (issue #8242), when the container is made
 * again; it was fluentd-positions when it kept the places alone. The
 * address is in fluentd.conf alone: nothing here sets it.
 *
 * It runs as root (issue #8005). The image's user, fluent, could not read
 * the files in /var/log that only root may read (syslog, auth.log and
 * kern.log on many distributions): Fluentd logged "unreadable. It is
 * excluded" and sent nothing from them. The adm group (group_add) reads
 * Debian's and Ubuntu's, but no group reads a file of root's alone, as
 * Red Hat's are; root reads them all, on every distribution, and the
 * container keeps it in: /var/log is mounted read-only, root keeps none of
 * its powers but reading and writing files (FLUENTD_COMPOSE_CAPABILITIES),
 * and the forward port is published on the host's 127.0.0.1 alone (issue
 * #8243), where Docker's fluentd log driver sends.
 */
export function getFluentdDockerCompose(): string {
  const capabilities: string = FLUENTD_COMPOSE_CAPABILITIES.map(
    (capability: string): string => {
      return `      - ${capability}`;
    },
  ).join("\n");

  return `# docker-compose.yml
services:
  fluentd:
    image: fluent/fluentd:latest
    # Root reads every file in /var/log, the ones only root may read too
    user: root
    # Of root's powers, it keeps only reading and writing any file
    cap_drop:
      - ALL
    cap_add:
${capabilities}
    volumes:
      - ./fluentd.conf:/fluentd/etc/fluent.conf
      - /var/log:/var/log:ro
      # Fluentd's place in each file, and the batches it has yet to send
      - fluentd-state:${FLUENTD_STATE_FOLDERS[FluentdRunsIn.DockerCompose]}
    ports:
      # This host alone may send: fluentd.conf says how to take events from other hosts
      - "${FLUENTD_FORWARD_PUBLISHED}"

volumes:
  fluentd-state:`;
}

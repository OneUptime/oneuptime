# Log Pipelines

Log pipelines transform logs as OneUptime ingests them, before they are stored. A pipeline has a **filter** that decides which logs it applies to and an ordered list of **processors** that each change those logs: pull fields out of the message, fix the severity, rename an attribute, or tag the log with a category.

Pipelines live under **Logs > Settings > Pipelines**.

## How a Pipeline Runs

- Pipelines run in order. A pipeline only touches the logs its filter matches, using the same filter syntax as the [log search](/docs/telemetry/search-syntax) (`attributes.service.name = 'api'`, `body LIKE 'timeout'`, `severityText = 'Error'`).
- Inside a pipeline, processors run in order and each one sees what the previous one produced, so a parser has to come before a processor that reads the fields it extracts.
- Processing happens at ingest. Changing a pipeline affects the logs that arrive afterwards; logs already stored are not reprocessed.
- A processor never drops or blanks a log. A line a parser cannot read passes through unchanged.

## Processor Types

| Processor          | What it does                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Grok Parser        | Pulls fields out of a line with a fixed shape (an nginx access line) using a named pattern.      |
| Key=Value Parser   | Splits a line of `key=value` pairs (Sophos XGS, Fortinet, logfmt) into attributes, in any order. |
| Severity Remapper  | Maps a raw level such as `warn` from an attribute onto the log's standard severity.              |
| Attribute Remapper | Renames or copies an attribute, for example `src_ip` to `source_ip`.                             |
| Category Processor | Tags a log with a category name when it matches a filter, for example "Payment Error".           |

## Key=Value Parser

Firewalls and other network appliances log every event as one line of `key=value` pairs. Which fields a line has, and in what order, depends on the event, so a single grok pattern cannot describe them. The Key=Value Parser does not need one: it walks the line and turns every pair it finds into a log attribute, whatever the order. Once they are attributes you can search and filter on them and use them in a [log monitor](/docs/monitor/logs-monitor).

### Configuration

| Setting              | Default        | Description                                                                                                                                                                                                  |
| -------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source Field         | `body`         | The field to parse: `body` for the log message, or an attribute such as `attributes.raw_line`.                                                                                                               |
| Target Prefix        | none           | A namespace for the extracted keys. `sophos` stores `con_name` as `sophos.con_name`. A separator is added unless the prefix already ends in `.`, `_`, `-` or `:`.                                            |
| Pair Delimiter       | any whitespace | What separates one pair from the next. Leave it blank for Sophos, Fortinet and logfmt; set `,`, `;` or `\|` for other formats.                                                                               |
| Key-Value Delimiter  | `=`            | What separates a key from its value, for example `:` for `status:up`.                                                                                                                                        |
| Override on Conflict | off            | Whether a key may replace an attribute the log already has. Off by default: the keys come from the line itself, so a line could otherwise rewrite attributes set at ingest, such as the device it came from. |

The two delimiters must be different, must not contain one another, and cannot contain quotes or backslashes. The processor form checks this before saving, and its tester shows the exact attributes a sample line would produce.

### Parsing Rules

- **Quoted values** keep their spaces and delimiters: `message="IPSec Connection HQ-Branch1 terminated"` is one value. Double and single quotes both work, and `\"` inside a value is a literal quote. A quote that is never closed - a line cut off by a syslog size limit - runs to the end of the line.
- **Unquoted values** run to the next pair delimiter, so `url=https://example.com/?a=b` keeps its `=`.
- **Empty values** (`key=` and `key=""`) are stored as empty strings.
- **Values are always text.** `latency=11` is stored as `"11"`, the same as an untyped grok capture.
- **Keys** start with a letter or underscore and contain letters, digits and `. _ - @`. Text before the first pair, such as an RFC 3164 syslog header, and stray words without a delimiter are skipped. A syslog priority glued to the first key (`<30>device_name="SFW"`) is dropped and the key kept.
- **A repeated key keeps its first value**; later ones are ignored.
- **Limits:** a line longer than 32 KiB is not parsed, at most 100 pairs are taken from one line, keys longer than 256 characters are skipped, and values longer than 4,096 characters are truncated.

### Example: Sophos XGS Firewall

When a Sophos XGS firewall sends syslog to a [probe](/docs/monitor/network-device-monitor), each message is stored as a log of the network device with the whole line as its body. To parse it:

1. Go to **Logs > Settings > Pipelines** and create a pipeline. Give it a filter that matches the firewall's logs, for example `attributes.networkDevice.name = 'hq-firewall'`, or `body LIKE 'log_component='` to match every Sophos line.
2. Open the pipeline and click **Add Processor**.
3. Choose **Key=Value Parser**, keep **Source Field** as `body`, and set **Target Prefix** to `sophos` (optional, but it keeps the firewall's fields together).
4. Paste a line from the firewall into the tester to check the result, then save.

A Sophos IPsec event:

```text
device_name="SFW" timestamp="2024-05-02T11:03:12+0200" device_model="XGS2100" device_serial_id="X1234" log_id="010101600001" log_type="Event" log_component="IPSec" log_subtype="System" severity="Information" con_name="HQ-Branch1" src_ip="10.171.4.117" dst_ip="10.171.4.118" status="Terminated" message="IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated."
```

becomes these attributes (among others):

| Attribute              | Value                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `sophos.log_component` | `IPSec`                                                                                              |
| `sophos.con_name`      | `HQ-Branch1`                                                                                         |
| `sophos.status`        | `Terminated`                                                                                         |
| `sophos.src_ip`        | `10.171.4.117`                                                                                       |
| `sophos.message`       | `IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated.` |

An SD-WAN SLA line has a different set of fields in a different order, and the same processor handles it:

```text
log_id=158825619025 log_type="SD-WAN" log_component="SLA" profile_name="Branch-Internet" gw_name="WAN2" latency=11 jitter=2 packet_loss=0 gw_status="up" sla_status="SLA met"
```

gives `sophos.gw_name = WAN2`, `sophos.latency = 11`, `sophos.packet_loss = 0`, `sophos.gw_status = up` and `sophos.sla_status = SLA met`. Older SFOS releases log a legacy format (`device="SFW" date=2017-01-31 time=18:02:03 timezone="IST" ... connectionname="Tunnel A"`); it parses the same way, with the tunnel name in `connectionname` instead of `con_name`.

### Example: Fortinet FortiGate

FortiGate logs use the same style:

```text
date=2024-01-01 time=10:00:00 devname="FG100" logid="0100032001" type="event" subtype="vpn" level="notice" action="tunnel-down" vpntunnel="HQ-to-Branch2" msg="IPsec tunnel down"
```

With the default settings and a `fortigate` prefix this gives `fortigate.devname = FG100`, `fortigate.subtype = vpn`, `fortigate.action = tunnel-down`, `fortigate.vpntunnel = HQ-to-Branch2` and `fortigate.time = 10:00:00` - the colons in a time value are part of the value, not a delimiter.

## Grok Parser

Pulls structured fields out of a line with a fixed shape. A grok pattern is a regular expression with named references: `%{IPV4:client_ip}` means "match an IPv4 address and store it as `client_ip`". The pattern does not have to match the whole line, a line that does not match is left unchanged, and `%{NUMBER:status:int}` stores a capture as a number. The processor form lists the available patterns and has a tester for sample lines.

| Log body                     | Pattern                                                                    | Attributes added                |
| ---------------------------- | -------------------------------------------------------------------------- | ------------------------------- |
| `10.0.1.5 - GET /health 200` | `%{IPV4:client_ip} - %{WORD:method} %{NOTSPACE:path} %{NUMBER:status:int}` | client_ip, method, path, status |

Use the Key=Value Parser instead when the line is made of `key=value` pairs whose order changes.

## Severity Remapper

Reads a raw value from an attribute (for example `level`) and maps it to a standard severity. Each mapping pairs a value your application emits, such as `warn`, with a severity, such as Warning. Matching ignores case.

## Attribute Remapper

Copies the value of one attribute to another key. Turn off **Preserve Source** to rename instead of copy, and turn off **Override on Conflict** to leave the target alone when it already exists.

## Category Processor

Evaluates a list of rules in order and stores the name of the first rule whose filter matches under a target attribute (for example `category`), so you can search for every "Payment Error" log at once.

import { JSONObject, JSONValue } from "../../../../Types/JSON";

/*
 * One Windows event, written the way each source that sends it writes it:
 * the OpenTelemetry Collector's windowseventlog receiver (its log body as
 * the OTLP value OneUptime keeps, with event_data as a map - v0.15x on -
 * or as a list of one-field maps before; and protobuf's oneof name after
 * each value, or not), the collector's map as plain JSON, NXLog, Fluent
 * Bit's winevtlog input, Winlogbeat and the event's own XML.
 *
 * Real field names and order; made-up machines, accounts and documentation
 * addresses (RFC 5737). Not a test file itself.
 */

export interface WindowsEventSpec {
  eventId: number;
  provider: string;
  channel: string;
  computer: string;
  time?: string | undefined;
  recordId?: number | undefined;
  level?: string | undefined;
  // EventData, by name, in Windows' order.
  data?: Array<[string, string]> | undefined;
  // UserData's one element and its fields.
  userData?: { name: string; fields: Array<[string, string]> } | undefined;
  message?: string | undefined;
}

export const WINDOWS_TIME: string = "2026-10-30T10:00:00.1234567Z";

function anyValue(value: unknown, oneofs: boolean): JSONObject {
  if (typeof value === "number") {
    return oneofs
      ? { intValue: String(value), value: "intValue" }
      : { intValue: String(value) };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item: unknown): JSONValue => {
          return anyValue(item, oneofs);
        }),
      },
    };
  }

  if (value && typeof value === "object") {
    const kvlist: JSONObject = {
      kvlistValue: {
        values: Object.keys(value as JSONObject).map(
          (key: string): JSONValue => {
            return {
              key,
              value: anyValue((value as JSONObject)[key], oneofs),
            };
          },
        ),
      },
    };

    return oneofs ? { ...kvlist, value: "kvlistValue" } : kvlist;
  }

  return oneofs
    ? { stringValue: String(value ?? ""), value: "stringValue" }
    : { stringValue: String(value ?? "") };
}

// The collector's body map (stanza's windows input: parseBody).
export function collectorMap(
  spec: WindowsEventSpec,
  eventDataFormat: "map" | "array" = "map",
): JSONObject {
  const data: Array<[string, string]> = spec.data || [];
  const eventData: JSONObject =
    eventDataFormat === "array"
      ? {
          data: data.map(([name, value]: [string, string]): JSONValue => {
            return { [name]: value };
          }),
        }
      : Object.fromEntries(data);
  const body: JSONObject = {
    event_id: { qualifiers: 0, id: spec.eventId },
    provider: {
      name: spec.provider,
      guid: "{00000000-0000-0000-0000-000000000000}",
      event_source: "",
    },
    system_time: spec.time || WINDOWS_TIME,
    computer: spec.computer,
    channel: spec.channel,
    record_id: spec.recordId || 81542,
    level: spec.level || "Information",
    message: spec.message || "",
    task: "",
    opcode: "Info",
    keywords: ["Audit Success"],
    event_data: eventData,
    version: 0,
  };

  if (spec.userData) {
    body["user_data"] = {
      name: spec.userData.name,
      data: Object.fromEntries(spec.userData.fields),
    };
  }

  return body;
}

// The log body OneUptime keeps for a collector's event: the OTLP AnyValue as JSON.
export function collectorOtlpBody(
  spec: WindowsEventSpec,
  options: { eventDataFormat?: "map" | "array"; oneofs?: boolean } = {},
): string {
  return JSON.stringify(
    anyValue(
      collectorMap(spec, options.eventDataFormat || "map"),
      options.oneofs ?? true,
    ),
  );
}

export function collectorJsonBody(spec: WindowsEventSpec): string {
  return JSON.stringify(collectorMap(spec));
}

export function nxlogBody(spec: WindowsEventSpec): string {
  const body: JSONObject = {
    EventTime: "2026-10-30 10:00:00",
    Hostname: spec.computer,
    Keywords: -9214364837600034816,
    EventType: "AUDIT_FAILURE",
    SeverityValue: 2,
    Severity: spec.level || "INFO",
    EventID: spec.eventId,
    SourceName: spec.provider,
    ProviderGuid: "{54849625-5478-4994-A5BA-3E3B0328C30D}",
    Version: 0,
    Task: 12544,
    OpcodeValue: 0,
    RecordNumber: spec.recordId || 81542,
    ProcessID: 716,
    ThreadID: 4284,
    Channel: spec.channel,
    Message: spec.message || "",
    Category: "Logon",
    Opcode: "Info",
    EventReceivedTime: "2026-10-30 10:00:01",
    SourceModuleName: "eventlog",
    SourceModuleType: "im_msvistalog",
  };

  // NXLog writes the event's fields, EventData and UserData alike, at the top.
  for (const [name, value] of [
    ...(spec.data || []),
    ...(spec.userData?.fields || []),
  ]) {
    body[name] = value;
  }

  return JSON.stringify(body);
}

// Fluent Bit's winevtlog: the event's fields by position only.
export function fluentBitBody(spec: WindowsEventSpec): string {
  return JSON.stringify({
    ProviderName: spec.provider,
    ProviderGuid: "{54849625-5478-4994-A5BA-3E3B0328C30D}",
    Qualifiers: "",
    EventID: spec.eventId,
    Version: 0,
    Level: 0,
    Task: 12544,
    Opcode: 0,
    Keywords: "0x8010000000000000",
    TimeCreated: "2026-10-30 10:00:00 +0000",
    EventRecordID: spec.recordId || 81542,
    ActivityID: "",
    RelatedActivityID: "",
    ProcessID: 716,
    ThreadID: 4284,
    Channel: spec.channel,
    Computer: spec.computer,
    UserID: "",
    Message: spec.message || "",
    StringInserts: (spec.data || []).map(
      ([, value]: [string, string]): string => {
        return value;
      },
    ),
  });
}

export function winlogbeatBody(spec: WindowsEventSpec): string {
  return JSON.stringify({
    "@timestamp": "2026-10-30T10:00:00.123Z",
    event: { code: String(spec.eventId), provider: spec.provider },
    host: { name: spec.computer.toLowerCase() },
    log: { level: (spec.level || "Information").toLowerCase() },
    message: spec.message || "",
    winlog: {
      channel: spec.channel,
      computer_name: spec.computer,
      event_id: String(spec.eventId),
      provider_name: spec.provider,
      record_id: String(spec.recordId || 81542),
      event_data: Object.fromEntries(spec.data || []),
      ...(spec.userData
        ? { user_data: Object.fromEntries(spec.userData.fields) }
        : {}),
    },
  });
}

function escapeXml(value: string): string {
  return value
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split("'")
    .join("&apos;");
}

// The event's own XML, as Windows renders it (and the collector sends with raw: true).
export function xmlBody(spec: WindowsEventSpec): string {
  const eventData: string = (spec.data || [])
    .map(([name, value]: [string, string]): string => {
      return `<Data Name='${escapeXml(name)}'>${escapeXml(value)}</Data>`;
    })
    .join("");
  const userData: string = spec.userData
    ? `<UserData><${spec.userData.name} xmlns='http://manifests.microsoft.com/win/2004/08/windows/eventlog'>${spec.userData.fields
        .map(([name, value]: [string, string]): string => {
          return `<${name}>${escapeXml(value)}</${name}>`;
        })
        .join("")}</${spec.userData.name}></UserData>`
    : "";

  return `<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='${escapeXml(spec.provider)}' Guid='{54849625-5478-4994-a5ba-3e3b0328c30d}'/><EventID>${spec.eventId}</EventID><Version>0</Version><Level>${spec.level === "Warning" ? "3" : "0"}</Level><Task>12544</Task><Opcode>0</Opcode><Keywords>0x8010000000000000</Keywords><TimeCreated SystemTime='${spec.time || WINDOWS_TIME}'/><EventRecordID>${spec.recordId || 81542}</EventRecordID><Correlation/><Execution ProcessID='716' ThreadID='4284'/><Channel>${escapeXml(spec.channel)}</Channel><Computer>${escapeXml(spec.computer)}</Computer><Security/></System>${spec.userData ? userData : `<EventData>${eventData}</EventData>`}</Event>`;
}

export type WindowsShape =
  | "collector map"
  | "collector list"
  | "collector without oneof names"
  | "collector JSON"
  | "NXLog"
  | "Winlogbeat"
  | "XML";

// Every shape that names its fields (Fluent Bit names them only for a few events).
export const NAMED_SHAPES: Array<
  [WindowsShape, (spec: WindowsEventSpec) => string]
> = [
  [
    "collector map",
    (spec: WindowsEventSpec): string => {
      return collectorOtlpBody(spec);
    },
  ],
  [
    "collector list",
    (spec: WindowsEventSpec): string => {
      return collectorOtlpBody(spec, { eventDataFormat: "array" });
    },
  ],
  [
    "collector without oneof names",
    (spec: WindowsEventSpec): string => {
      return collectorOtlpBody(spec, { oneofs: false });
    },
  ],
  ["collector JSON", collectorJsonBody],
  ["NXLog", nxlogBody],
  ["Winlogbeat", winlogbeatBody],
  ["XML", xmlBody],
];

const SECURITY: string = "Microsoft-Windows-Security-Auditing";

// A failed sign-in: 4625, its 21 fields in order.
export function failedSignIn(
  overrides: Partial<Record<string, string>> = {},
): WindowsEventSpec {
  const fields: Array<[string, string]> = [
    ["SubjectUserSid", "S-1-0-0"],
    ["SubjectUserName", "-"],
    ["SubjectDomainName", "-"],
    ["SubjectLogonId", "0x0"],
    ["TargetUserSid", "S-1-0-0"],
    ["TargetUserName", "alice"],
    ["TargetDomainName", "CORP"],
    ["Status", "0xc000006d"],
    ["FailureReason", "%%2313"],
    ["SubStatus", "0xc000006a"],
    ["LogonType", "3"],
    ["LogonProcessName", "NtLmSsp "],
    ["AuthenticationPackageName", "NTLM"],
    ["WorkstationName", "WKS-07"],
    ["TransmittedServices", "-"],
    ["LmPackageName", "-"],
    ["KeyLength", "0"],
    ["ProcessId", "0x0"],
    ["ProcessName", "-"],
    ["IpAddress", "203.0.113.7"],
    ["IpPort", "51234"],
  ];

  return {
    eventId: 4625,
    provider: SECURITY,
    channel: "Security",
    computer: "WIN-01.corp.example",
    data: fields.map(([name, value]: [string, string]): [string, string] => {
      return [name, overrides[name] ?? value];
    }),
  };
}

// A successful sign-in: 4624, its first 20 fields (every version has them).
export function successfulSignIn(
  overrides: Partial<Record<string, string>> = {},
): WindowsEventSpec {
  const fields: Array<[string, string]> = [
    ["SubjectUserSid", "S-1-5-18"],
    ["SubjectUserName", "WIN-01$"],
    ["SubjectDomainName", "CORP"],
    ["SubjectLogonId", "0x3e7"],
    ["TargetUserSid", "S-1-5-21-1-2-3-1104"],
    ["TargetUserName", "alice"],
    ["TargetDomainName", "CORP"],
    ["TargetLogonId", "0x8dcdc"],
    ["LogonType", "10"],
    ["LogonProcessName", "User32 "],
    ["AuthenticationPackageName", "Negotiate"],
    ["WorkstationName", "WIN-01"],
    ["LogonGuid", "{00000000-0000-0000-0000-000000000000}"],
    ["TransmittedServices", "-"],
    ["LmPackageName", "-"],
    ["KeyLength", "0"],
    ["ProcessId", "0x1c4"],
    ["ProcessName", "C:\\Windows\\System32\\svchost.exe"],
    ["IpAddress", "198.51.100.23"],
    ["IpPort", "0"],
  ];

  return {
    eventId: 4624,
    provider: SECURITY,
    channel: "Security",
    computer: "WIN-01.corp.example",
    data: fields.map(([name, value]: [string, string]): [string, string] => {
      return [name, overrides[name] ?? value];
    }),
  };
}

// A process started: 4688 version 2, its 15 fields in order.
export function processCreated(
  overrides: Partial<Record<string, string>> = {},
): WindowsEventSpec {
  const fields: Array<[string, string]> = [
    ["SubjectUserSid", "S-1-5-21-1-2-3-1104"],
    ["SubjectUserName", "alice"],
    ["SubjectDomainName", "CORP"],
    ["SubjectLogonId", "0x8dcdc"],
    ["NewProcessId", "0x1a2c"],
    [
      "NewProcessName",
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    ],
    ["TokenElevationType", "%%1936"],
    ["ProcessId", "0x2f8"],
    ["CommandLine", "powershell.exe -nop -w hidden -enc SQBFAFgA"],
    ["TargetUserSid", "S-1-0-0"],
    ["TargetUserName", "-"],
    ["TargetDomainName", "-"],
    ["TargetLogonId", "0x0"],
    ["ParentProcessName", "C:\\Windows\\System32\\cmd.exe"],
    ["MandatoryLabel", "S-1-16-12288"],
  ];

  return {
    eventId: 4688,
    provider: SECURITY,
    channel: "Security",
    computer: "WIN-01.corp.example",
    data: fields.map(([name, value]: [string, string]): [string, string] => {
      return [name, overrides[name] ?? value];
    }),
  };
}

export function windowsEvent(
  eventId: number,
  provider: string,
  channel: string,
  data: Array<[string, string]>,
  extra: Partial<WindowsEventSpec> = {},
): WindowsEventSpec {
  return {
    eventId,
    provider,
    channel,
    computer: "WIN-01.corp.example",
    data,
    ...extra,
  };
}

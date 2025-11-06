import OneUptimeDate from "Common/Types/Date";

export interface ParsedSyslogStructuredData {
  [sdId: string]: {
    [key: string]: string;
  };
}

export interface ParsedSyslogMessage {
  raw: string;
  message: string;
  priority?: number | undefined;
  severity?: number | undefined;
  facility?: number | undefined;
  version?: number | undefined;
  timestamp?: Date | undefined;
  hostname?: string | undefined;
  appName?: string | undefined;
  procId?: string | undefined;
  msgId?: string | undefined;
  structuredDataRaw?: string | undefined;
  structuredData?: ParsedSyslogStructuredData | undefined;
}

export function parseSyslogMessage(raw: string): ParsedSyslogMessage | null {
  if (!raw) {
    return null;
  }

  const trimmed: string = raw.trim();

  if (!trimmed) {
    return null;
  }

  let remaining: string = trimmed;
  let priority: number | undefined;
  let severity: number | undefined;
  let facility: number | undefined;

  const priorityMatch: RegExpMatchArray | null = remaining.match(/^<(\d{1,3})>/);

  if (priorityMatch) {
    priority = parseInt(priorityMatch[1]!, 10);

    if (!isNaN(priority)) {
      severity = priority % 8;
      facility = Math.floor(priority / 8);
    }

    remaining = remaining.slice(priorityMatch[0]!.length);
  }

  const rfc5424Parsed: ParsedSyslogMessage | null = parseRfc5424(remaining);

  if (rfc5424Parsed) {
    return {
      raw: trimmed,
      priority,
      severity: rfc5424Parsed.severity ?? severity,
      facility: rfc5424Parsed.facility ?? facility,
      version: rfc5424Parsed.version,
      timestamp: rfc5424Parsed.timestamp,
      hostname: rfc5424Parsed.hostname,
      appName: rfc5424Parsed.appName,
      procId: rfc5424Parsed.procId,
      msgId: rfc5424Parsed.msgId,
      structuredDataRaw: rfc5424Parsed.structuredDataRaw,
      structuredData: rfc5424Parsed.structuredData,
      message: stripBom(rfc5424Parsed.message ?? ""),
    };
  }

  const rfc3164Parsed: ParsedSyslogMessage | null = parseRfc3164(remaining);

  if (rfc3164Parsed) {
    return {
      raw: trimmed,
      priority,
      severity,
      facility,
      timestamp: rfc3164Parsed.timestamp,
      hostname: rfc3164Parsed.hostname,
      appName: rfc3164Parsed.appName,
      procId: rfc3164Parsed.procId,
      message: stripBom(rfc3164Parsed.message ?? ""),
    };
  }

  return {
    raw: trimmed,
    priority,
    severity,
    facility,
    message: stripBom(remaining.trim()),
  };
}

function parseRfc5424(payload: string): ParsedSyslogMessage | null {
  const tokens: Array<string> = splitTokens(payload, 7);

  if (tokens.length < 7) {
    return null;
  }

  const versionToken: string = tokens[0]!;

  if (!/^\d+$/.test(versionToken)) {
    return null;
  }

  const version: number = parseInt(versionToken, 10);
  const timestampToken: string = tokens[1]!
    .trim()
    .replace(/^NILVALUE$/i, "-");
  const hostnameToken: string = tokens[2]!;
  const appNameToken: string = tokens[3]!;
  const procIdToken: string = tokens[4]!;
  const msgIdToken: string = tokens[5]!;
  const structuredDataAndMessage: string = tokens[6]!;

  const timestamp: Date | undefined =
    timestampToken && timestampToken !== "-"
      ? OneUptimeDate.parseRfc5424Timestamp(timestampToken)
      : undefined;

  const hostname: string | undefined =
    hostnameToken && hostnameToken !== "-" ? hostnameToken : undefined;

  const appName: string | undefined =
    appNameToken && appNameToken !== "-" ? appNameToken : undefined;

  const procId: string | undefined =
    procIdToken && procIdToken !== "-" ? procIdToken : undefined;

  const msgId: string | undefined =
    msgIdToken && msgIdToken !== "-" ? msgIdToken : undefined;

  const structuredDataParsed: {
    structuredDataRaw?: string;
    message?: string;
    structuredData?: ParsedSyslogStructuredData;
  } = extractStructuredData(structuredDataAndMessage);

  return {
    raw: payload,
    version,
    timestamp,
    hostname,
    appName,
    procId,
    msgId,
    structuredDataRaw: structuredDataParsed.structuredDataRaw,
    structuredData: structuredDataParsed.structuredData,
    message: structuredDataParsed.message ?? "",
  };
}

function parseRfc3164(payload: string): ParsedSyslogMessage | null {
  const match: RegExpMatchArray | null = payload.match(
    /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(.*)$/,
  );

  if (!match) {
    return null;
  }

  const timestampToken: string = match[1]!;
  const hostname: string = match[2]!;
  const rest: string = match[3] ?? "";

  const timestamp: Date | undefined =
    OneUptimeDate.parseRfc3164Timestamp(timestampToken);

  let appName: string | undefined;
  let procId: string | undefined;
  let message: string = rest.trim();

  const colonIndex: number = rest.indexOf(":");

  if (colonIndex !== -1) {
    const tag: string = rest.slice(0, colonIndex);
    message = rest.slice(colonIndex + 1).trim();

    const procMatch: RegExpMatchArray | null = tag.match(/^([^\[]+)\[(.+)\]$/);

    if (procMatch) {
      appName = procMatch[1]?.trim();
      procId = procMatch[2]?.trim();
    } else {
      appName = tag.trim();
    }
  } else {
    const firstTokenMatch: RegExpMatchArray | null = rest.match(/^(\S+)/);

    if (firstTokenMatch) {
      const firstToken: string = firstTokenMatch[1]!;
      const procMatch: RegExpMatchArray | null = firstToken.match(
        /^([^\[]+)\[(.+)\]$/,
      );

      if (procMatch) {
        appName = procMatch[1]?.trim();
        procId = procMatch[2]?.trim();
      } else {
        appName = firstToken.trim();
      }

      message = rest.slice(firstToken.length).trim();
    }
  }

  return {
    raw: payload,
    timestamp,
    hostname,
    appName,
    procId,
    message,
  };
}

function splitTokens(source: string, expected: number): Array<string> {
  const tokens: Array<string> = [];
  let remaining: string = source.trimStart();

  for (let i: number = 0; i < expected - 1; i++) {
    if (!remaining) {
      tokens.push("");
      continue;
    }

    const match: RegExpMatchArray | null = remaining.match(/^(\S+)/);

    if (!match) {
      tokens.push("");
      remaining = "";
      continue;
    }

    const token: string = match[1]!;
    tokens.push(token);
    remaining = remaining.slice(token.length).trimStart();
  }

  tokens.push(remaining);

  return tokens;
}

function extractStructuredData(value: string): {
  structuredDataRaw?: string;
  message?: string;
  structuredData?: ParsedSyslogStructuredData;
} {
  const trimmed: string = value.trimStart();

  if (!trimmed) {
    return { message: "" };
  }

  if (trimmed.startsWith("-")) {
    return { message: trimmed.slice(1).trimStart() };
  }

  if (!trimmed.startsWith("[")) {
    return { message: trimmed };
  }

  let depth: number = 0;

  for (let i: number = 0; i < trimmed.length; i++) {
    const char: string = trimmed[i]!;

    if (char === "[") {
      depth++;
    } else if (char === "]") {
      depth--;

      if (depth === 0) {
        let peekIndex: number = i + 1;

        while (peekIndex < trimmed.length && trimmed[peekIndex] === " ") {
          peekIndex++;
        }

        if (trimmed[peekIndex] === "[") {
          i = peekIndex - 1;
          continue;
        }

        const structuredDataRaw: string = trimmed.slice(0, i + 1).trimEnd();
        const message: string = trimmed.slice(i + 1).trimStart();

        return {
          structuredDataRaw,
          structuredData: parseStructuredData(structuredDataRaw),
          message,
        };
      }
    }
  }

  const structuredDataRaw: string = trimmed.trim();

  return {
    structuredDataRaw,
    structuredData: parseStructuredData(structuredDataRaw),
    message: "",
  };
}

function parseStructuredData(raw: string): ParsedSyslogStructuredData {
  const result: ParsedSyslogStructuredData = {};
  const sdRegex: RegExp = /\[([^\s\]]+)((?:\s+[^\s=]+="[^"]*")*)\]/g;
  let match: RegExpExecArray | null;

  while ((match = sdRegex.exec(raw)) !== null) {
    const sdIdRaw: string = match[1]!;
    const params: string = match[2] ?? "";
    const sdId: string = sanitizeKey(sdIdRaw);

    if (!result[sdId]) {
      result[sdId] = {};
    }

    const paramRegex: RegExp = /([^\s=]+)="([^"]*)"/g;
    let paramMatch: RegExpExecArray | null;

    while ((paramMatch = paramRegex.exec(params)) !== null) {
      const keyRaw: string = paramMatch[1]!;
      const value: string = paramMatch[2] ?? "";
      const key: string = sanitizeKey(keyRaw);
      const entry: { [key: string]: string } = result[sdId] ?? {};
      entry[key] = value;
      result[sdId] = entry;
    }
  }

  return result;
}

function sanitizeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function stripBom(value: string): string {
  if (!value) {
    return value;
  }

  let output: string = value.replace(/^\uFEFF/, "");

  if (output.startsWith("BOM")) {
    output = output.slice(3);
  }

  return output.trimStart();
}

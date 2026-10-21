/*
 * The syslog message reader lives in Common
 * (Common/Utils/Syslog/SyslogMessageParser.ts), where the syslog a probe
 * forwards and the Dashboard read it too. This file keeps the name the
 * ingest service and its tests import it by.
 */
export { parseSyslogMessage } from "Common/Utils/Syslog/SyslogMessageParser";
export type {
  ParsedSyslogMessage,
  ParsedSyslogStructuredData,
} from "Common/Utils/Syslog/SyslogMessageParser";

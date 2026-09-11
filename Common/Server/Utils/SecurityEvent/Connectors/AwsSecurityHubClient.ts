import { createHash, createHmac } from "crypto";
import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import { JSONObject } from "../../../../Types/JSON";
import {
  defaultConnectorRequest,
  jsonObjects,
  MAX_CONNECTOR_PAGES,
  parseCredentialJson,
  requestJson,
  requiredSetting,
  stringValue,
} from "./ConnectorHttp";
import {
  SecurityEventConnectorClient,
  SecurityEventConnectorFetchResult,
  SecurityEventConnectorHttpRequest,
} from "./Types";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function awsDate(date: Date): { dateStamp: string; amzDate: string } {
  const compact: string = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { dateStamp: compact.slice(0, 8), amzDate: compact };
}

function awsDnsSuffix(region: string): string {
  return region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com";
}

export default class AwsSecurityHubClient
  implements SecurityEventConnectorClient
{
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly sessionToken: string;
  private readonly request: SecurityEventConnectorHttpRequest;

  public constructor(
    connection: SecurityEventConnection,
    request: SecurityEventConnectorHttpRequest = defaultConnectorRequest,
  ) {
    const configuration: JSONObject = connection.configuration || {};
    const credentials: JSONObject = parseCredentialJson(
      connection.credentialJson || "",
    );
    this.region = requiredSetting(configuration, "region", "AWS");
    this.accessKeyId = requiredSetting(credentials, "accessKeyId", "AWS");
    this.secretAccessKey = requiredSetting(
      credentials,
      "secretAccessKey",
      "AWS",
    );
    this.sessionToken = stringValue(credentials["sessionToken"]);
    this.request = request;
  }

  public async fetchEvents(data: {
    startTime: Date;
    endTime: Date;
    continuation?: JSONObject | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<SecurityEventConnectorFetchResult> {
    const events: Array<JSONObject> = [];
    let nextToken: string = stringValue(data.continuation?.["nextToken"]);
    let requestCount: number = 0;

    do {
      const body: JSONObject = {
        Filters: {
          UpdatedAt: [
            {
              Start: data.startTime.toISOString(),
              End: data.endTime.toISOString(),
            },
          ],
        },
        MaxResults: 100,
        ...(nextToken ? { NextToken: nextToken } : {}),
      };
      const bodyText: string = JSON.stringify(body);
      const hostname: string = `securityhub.${this.region}.${awsDnsSuffix(
        this.region,
      )}`;
      const url: string = `https://${hostname}/findings`;
      const now: Date = new Date();
      const { dateStamp, amzDate } = awsDate(now);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Host: hostname,
        "X-Amz-Date": amzDate,
      };
      if (this.sessionToken) {
        headers["X-Amz-Security-Token"] = this.sessionToken;
      }

      const canonicalHeaders: string = Object.keys(headers)
        .map((key: string): [string, string] => {
          return [key.toLowerCase(), headers[key]!.trim().replace(/\s+/g, " ")];
        })
        .sort(([left]: [string, string], [right]: [string, string]): number => {
          return left.localeCompare(right);
        })
        .map(([key, value]: [string, string]): string => {
          return `${key}:${value}\n`;
        })
        .join("");
      const signedHeaders: string = Object.keys(headers)
        .map((key: string): string => {
          return key.toLowerCase();
        })
        .sort()
        .join(";");
      const canonicalRequest: string = [
        "POST",
        "/findings",
        "",
        canonicalHeaders,
        signedHeaders,
        sha256(bodyText),
      ].join("\n");
      const scope: string = `${dateStamp}/${this.region}/securityhub/aws4_request`;
      const stringToSign: string = [
        "AWS4-HMAC-SHA256",
        amzDate,
        scope,
        sha256(canonicalRequest),
      ].join("\n");
      const signingKey: Buffer = hmac(
        hmac(
          hmac(hmac(`AWS4${this.secretAccessKey}`, dateStamp), this.region),
          "securityhub",
        ),
        "aws4_request",
      );
      const signature: string = createHmac("sha256", signingKey)
        .update(stringToSign, "utf8")
        .digest("hex");
      headers["Authorization"] =
        `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const result: { body: JSONObject } = await requestJson({
        request: this.request,
        method: "POST",
        url,
        headers,
        body: bodyText,
        label: "AWS Security Hub",
        signal: data.signal,
      });
      events.push(
        ...jsonObjects(
          result.body["Findings"],
          "AWS Security Hub findings",
          true,
        ),
      );
      nextToken = stringValue(result.body["NextToken"]);
      requestCount++;
    } while (nextToken && requestCount < MAX_CONNECTOR_PAGES);

    const complete: boolean = !nextToken;
    return {
      events,
      complete,
      requestCount,
      ...(nextToken ? { continuation: { nextToken } } : {}),
      warnings: complete
        ? []
        : [
            "AWS Security Hub returned more pages than one poll can safely read; the cursor was held for retry.",
          ],
    };
  }
}

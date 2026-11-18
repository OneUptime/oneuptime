import { JSONObject } from "Common/Types/JSON";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * SEND A TEST LOG (#7760): one command, in the logs guide's first step
 * beside the endpoint and the key it uses, that posts one log over
 * OTLP/HTTP. It shows the endpoint and the key work before any app is
 * instrumented or any shipper installed, finishes the guide's wait for the
 * first data, and gives the Logs page a line to show.
 *
 * Safe to send, and easy to tell apart and to remove:
 *
 *   - one log at INFO, timed by the server as it arrives (no timestamp of
 *     its own), with a body that says where it came from;
 *   - from a service of its own, oneuptime-test, so it never mixes into an
 *     app's logs, and the service can be deleted from Services afterwards;
 *   - the key and the endpoint are the ones the step shows just above it,
 *     so the command shows the key nowhere it is not already shown.
 *
 * The command is curl with JSON: OneUptime's OTLP endpoint takes
 * application/json as the OpenTelemetry spec writes it, and answers {} once
 * the log is queued, or says why not (a key that is wrong, switched off or
 * expired). Each value it carries goes in double quotes made safe for a
 * shell, and the body in single quotes, holding none.
 *
 * React-free on purpose: the command is tested without the guide.
 */

// The service the test log comes from: it is no app's.
export const TEST_LOG_SERVICE_NAME: string = "oneuptime-test";

// What the test log says.
export const TEST_LOG_BODY: string = "Test log from the OneUptime setup guide";

// The fold's title and the line under it.
export const TEST_LOG_TITLE: string = translationKey("Send a test log");

export const TEST_LOG_DESCRIPTION: string = translationKey(
  "Check the endpoint and the key before you set up your app.",
);

// Above the command. {{service}} is TEST_LOG_SERVICE_NAME, drawn as code.
export const TEST_LOG_HOW: string = translationKey(
  "Run this in a terminal. It sends one log from the service {{service}}, which you can delete afterwards.",
);

// OpenTelemetry's SeverityNumber for INFO, which ingest stores as Information.
const INFO_SEVERITY_NUMBER: number = 9;

// The OTLP/HTTP JSON request body: one log record, from TEST_LOG_SERVICE_NAME.
export function getTestLogPayload(): JSONObject {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: TEST_LOG_SERVICE_NAME },
            },
          ],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                severityNumber: INFO_SEVERITY_NUMBER,
                severityText: "INFO",
                body: { stringValue: TEST_LOG_BODY },
              },
            ],
          },
        ],
      },
    ],
  };
}

/*
 * A value in double quotes, as a shell reads it back unchanged: a
 * backslash, a quote, a dollar sign and a backtick are escaped.
 */
export function toShellDoubleQuoted(value: string): string {
  return `"${value.replace(/[\\"$`]/g, (character: string): string => {
    return `\\${character}`;
  })}"`;
}

/*
 * The command, for the OTLP endpoint the guide shows (its /v1/logs, as
 * every SDK snippet posts logs to) and the picked key's token.
 */
export function getTestLogCommand(data: {
  otlpUrl: string;
  token: string;
}): string {
  const url: string = `${data.otlpUrl.replace(/\/+$/, "")}/v1/logs`;

  return [
    `curl -sS ${toShellDoubleQuoted(url)} \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H ${toShellDoubleQuoted(`x-oneuptime-token: ${data.token}`)} \\`,
    `  -d '${JSON.stringify(getTestLogPayload())}'`,
  ].join("\n");
}

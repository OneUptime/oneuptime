import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * What the diagnostic bundle ships with — rendered as a checklist so admins
 * know exactly what leaves their instance before they download it.
 */
const BUNDLE_CONTENTS: Array<string> = [
  "Instance version & build",
  "Runtime & resource usage",
  "Effective configuration (secrets redacted)",
  "Component health & datastore capacity",
  "Database migration status",
  "Queue stats & failed jobs (full body, options & logs)",
  "Application, Postgres, ClickHouse & Redis logs",
  "Postgres diagnostics (connections, table stats)",
  "ClickHouse diagnostics (mutations, parts)",
  "Postgres & ClickHouse schema (structure only)",
];

// Trigger a client-side download of the given text content as a file.
const downloadFile: (
  content: string,
  filename: string,
  mimeType: string,
) => void = (content: string, filename: string, mimeType: string): void => {
  const blob: Blob = new Blob([content], { type: mimeType });
  const url: string = window.URL.createObjectURL(blob);
  const anchor: HTMLAnchorElement = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
};

const SupportBundle: FunctionComponent = (): ReactElement => {
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const downloadBundle: () => Promise<void> = async (): Promise<void> => {
    setError("");
    setIsDownloading(true);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/admin/health/support-bundle",
          ),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const timestamp: string = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);

      downloadFile(
        JSON.stringify(response.data, null, 2),
        `oneuptime-support-bundle-${timestamp}.json`,
        "application/json;charset=utf-8;",
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Card
      title="Support bundle"
      description="A diagnostic snapshot of this instance — version, configuration, component health, migrations, queue/database diagnostics, full failed-job detail and recent application & datastore logs — that you can send to the OneUptime team when you need help. Credentials are scrubbed, but it may contain customer data, so review it before sharing."
    >
      <div>
        {error ? (
          <Alert type={AlertType.DANGER} title={error} className="mb-4" />
        ) : (
          <></>
        )}

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 md:p-5">
          <div className="flex items-start gap-4">
            <div className="hidden h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 sm:flex">
              <Icon icon={IconProp.Archive} size={SizeProp.Regular} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                What&apos;s included
              </div>
              <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {BUNDLE_CONTENTS.map(
                  (item: string, index: number): ReactElement => {
                    return (
                      <div
                        key={index}
                        className="flex items-center gap-2 text-sm text-gray-700"
                      >
                        <Icon
                          icon={IconProp.CheckCircle}
                          size={SizeProp.Small}
                          className="h-4 w-4 flex-shrink-0 text-green-500"
                        />
                        <span className="truncate">{item}</span>
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Icon
                icon={IconProp.ShieldCheck}
                size={SizeProp.Small}
                className="h-4 w-4 flex-shrink-0 text-gray-400"
              />
              <span>
                Credentials are scrubbed (config, schema, connection strings).
                Failed-job bodies and logs may contain customer data — review
                before sharing externally.
              </span>
            </div>
            <Button
              title="Download support bundle"
              icon={IconProp.Download}
              buttonStyle={ButtonStyleType.PRIMARY}
              isLoading={isDownloading}
              onClick={() => {
                downloadBundle().catch(() => {
                  // handled via setError
                });
              }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
};

export default SupportBundle;

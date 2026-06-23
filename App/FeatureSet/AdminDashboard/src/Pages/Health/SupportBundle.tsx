import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement, useState } from "react";

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
      description="Download a diagnostic bundle with this instance's version, migration status and full Postgres + ClickHouse schema (structure only — no customer data). Send this file to the OneUptime team when you need help with an upgrade or schema issue."
    >
      <div>
        {error ? (
          <Alert type={AlertType.DANGER} title={error} className="mb-4" />
        ) : (
          <></>
        )}
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
    </Card>
  );
};

export default SupportBundle;

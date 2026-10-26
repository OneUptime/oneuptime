import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import HiddenText from "Common/UI/Components/HiddenText/HiddenText";
import { APP_API_URL, IDENTITY_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import { inEnglishDates } from "Common/Types/DateLanguage";
import { JSONObject } from "Common/Types/JSON";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * A SCIM connection's OAuth 2.0 client credentials, in the dialog with its
 * SCIM URLs: the token endpoint, the client ID (the connection's id), and
 * the client secret - made by the server, shown here once, and kept there
 * only as a hash (ee/Server/Identity/API/SCIMOAuthClientSecret.ts).
 *
 * For identity providers that will not keep a long-lived bearer token and
 * ask for these instead. Making a new secret keeps the one before working
 * until it expires or is deleted here, so the identity provider can be given
 * the new one with no gap in provisioning.
 */

export type ScimOAuthConnectionType = "project" | "status-page";

// The connection's CRUD path, which the secret routes sit under.
const CONNECTION_PATHS: Record<ScimOAuthConnectionType, string> = {
  project: "/project-scim",
  "status-page": "/status-page-scim",
};

export const getScimClientSecretUrl: (
  connectionType: ScimOAuthConnectionType,
  connectionId: string,
) => URL = (
  connectionType: ScimOAuthConnectionType,
  connectionId: string,
): URL => {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `${CONNECTION_PATHS[connectionType]}/${connectionId}/oauth-client-secret`,
  );
};

// The one token endpoint every connection's client ID and secret are exchanged at.
export const getScimTokenEndpoint: () => string = (): string => {
  return `${IDENTITY_URL.toString()}/scim/oauth/token`;
};

const toDate: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (!value) {
    return null;
  }

  const date: Date = new Date(value as string | Date);

  return isNaN(date.getTime()) ? null : date;
};

// In English, as the sentences around it are.
const formatDate: (date: Date) => string = (date: Date): string => {
  return inEnglishDates((): string => {
    return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date, true);
  });
};

export interface ComponentProps {
  connectionType: ScimOAuthConnectionType;
  connectionId: string;
  // As read with the connection; absent when it has none.
  clientSecretExpiresAt?: Date | string | undefined;
  previousClientSecretExpiresAt?: Date | string | undefined;
  // Whether this caller may make and delete secrets, and the license lets them.
  canChange: boolean;
  onChange?: (() => void) | undefined;
}

const ScimOAuthClientCredentials: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [expiresAt, setExpiresAt] = useState<Date | null>(
    toDate(props.clientSecretExpiresAt),
  );
  const [previousExpiresAt, setPreviousExpiresAt] = useState<Date | null>(
    toDate(props.previousClientSecretExpiresAt),
  );
  const [newSecret, setNewSecret] = useState<string>("");
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const now: Date = OneUptimeDate.getCurrentDate();
  const hasLiveSecret: boolean = Boolean(expiresAt && expiresAt > now);
  const hasLivePreviousSecret: boolean = Boolean(
    previousExpiresAt && previousExpiresAt > now,
  );

  const send: (
    method: HTTPMethod,
    url: URL,
  ) => Promise<JSONObject | null> = async (
    method: HTTPMethod,
    url: URL,
  ): Promise<JSONObject | null> => {
    setIsWorking(true);
    setError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.fetch<JSONObject>({
          method: method,
          url: url,
          data: {},
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      props.onChange?.();

      return (response.data || {}) as JSONObject;
    } catch (err) {
      setError(API.getFriendlyMessage(err as Error));
      return null;
    } finally {
      setIsWorking(false);
    }
  };

  const makeSecret: () => Promise<void> = async (): Promise<void> => {
    const answer: JSONObject | null = await send(
      HTTPMethod.POST,
      getScimClientSecretUrl(props.connectionType, props.connectionId),
    );

    if (answer) {
      setNewSecret((answer["clientSecret"] as string) || "");
      setExpiresAt(toDate(answer["clientSecretExpiresAt"]));
      setPreviousExpiresAt(toDate(answer["previousClientSecretExpiresAt"]));
    }
  };

  const deletePreviousSecret: () => Promise<void> = async (): Promise<void> => {
    const answer: JSONObject | null = await send(
      HTTPMethod.DELETE,
      getScimClientSecretUrl(props.connectionType, props.connectionId).addRoute(
        "/previous",
      ),
    );

    if (answer) {
      setPreviousExpiresAt(null);
    }
  };

  return (
    <div className="border-t pt-4" data-testid="scim-oauth-client-credentials">
      <p className="font-medium text-gray-700 mb-1">
        OAuth 2.0 Client Credentials:
      </p>
      <p className="text-xs text-gray-500 mb-3">
        For identity providers that ask for a token endpoint, client ID and
        client secret instead of a bearer token.
      </p>

      <div className="space-y-3">
        <div>
          <p className="text-sm text-gray-700 mb-1">Token Endpoint:</p>
          <code className="block p-2 bg-gray-100 rounded text-sm break-all">
            {getScimTokenEndpoint()}
          </code>
        </div>

        <div>
          <p className="text-sm text-gray-700 mb-1">Client ID:</p>
          <code className="block p-2 bg-gray-100 rounded text-sm break-all">
            {props.connectionId}
          </code>
        </div>

        <div>
          <p className="text-sm text-gray-700 mb-1">Client Secret:</p>
          {newSecret ? (
            <div data-testid="scim-oauth-new-client-secret">
              <div className="mb-2">
                <HiddenText text={newSecret} isCopyable={true} />
              </div>
              <p className="text-xs text-gray-500">
                Copy it now: OneUptime keeps only a hash of it and cannot show
                it again.
                {expiresAt ? ` It works until ${formatDate(expiresAt)}.` : ""}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              {hasLiveSecret && expiresAt
                ? `Set. It works until ${formatDate(expiresAt)}, and is never shown again.`
                : expiresAt
                  ? `Expired on ${formatDate(expiresAt)}. No access token is issued with it: make a new one.`
                  : "None yet."}
            </p>
          )}
        </div>

        {hasLivePreviousSecret && previousExpiresAt ? (
          <div data-testid="scim-oauth-previous-client-secret">
            <p className="text-sm text-gray-500">
              The secret it replaced keeps working until{" "}
              {formatDate(previousExpiresAt)}, so the identity provider can be
              moved to the new one without a gap. Delete it once the identity
              provider uses the new secret.
            </p>
            {props.canChange ? (
              <div className="mt-2">
                <Button
                  title="Delete Previous Secret"
                  buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                  buttonSize={ButtonSize.Small}
                  isLoading={isWorking}
                  disabled={isWorking}
                  onClick={() => {
                    void deletePreviousSecret();
                  }}
                  dataTestId="scim-oauth-delete-previous-client-secret"
                />
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {props.canChange ? (
          <div>
            <Button
              title={
                hasLiveSecret ? "Make New Client Secret" : "Make Client Secret"
              }
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              isLoading={isWorking}
              disabled={isWorking}
              onClick={() => {
                void makeSecret();
              }}
              dataTestId="scim-oauth-make-client-secret"
            />
          </div>
        ) : (
          <></>
        )}

        {error ? <Alert type={AlertType.DANGER} title={error} /> : <></>}
      </div>
    </div>
  );
};

export default ScimOAuthClientCredentials;

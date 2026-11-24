import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import {
  SERVER_AWS_IDENTITY_ROUTE,
  ServerAwsIdentityAnswer,
  ServerAwsIdentityVia,
  parseServerAwsIdentityAnswer,
} from "Common/Types/Email/ServerAwsIdentity";
import { JSONObject } from "Common/Types/JSON";
import { translationKey } from "Common/Types/Translator";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import { NOTIFICATION_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * "SIGNS IN AS" ON THE AMAZON SES CARD (#7380): which AWS identity this
 * server signs in as, when its own email signs in with the server's IAM
 * role. Asked of the server when the card shows (GET
 * /server-aws-identity, which asks AWS with sts:GetCallerIdentity), so a
 * missing or wrong role shows here, not first on a test email:
 *
 *   - signed in: the identity's ARN, where its credentials came from, and
 *     that the test email is what shows it may send (GetCallerIdentity
 *     needs no permission, so it proves who, not what);
 *   - not: why, in the server's words (what to give the server), with
 *     Check again for once that is done.
 */

export interface ComponentProps {
  // The Region the server's Amazon SES sends from: STS is asked there.
  region?: string | undefined;
}

// Where the credentials came from, in the reader's words.
export const SERVER_AWS_IDENTITY_VIA_KEYS: Readonly<
  Record<ServerAwsIdentityVia, string>
> = {
  [ServerAwsIdentityVia.Environment]: translationKey(
    "From AWS_ACCESS_KEY_ID in the server's environment.",
  ),
  [ServerAwsIdentityVia.Profile]: translationKey(
    "From the server's AWS profile.",
  ),
  [ServerAwsIdentityVia.WebIdentity]: translationKey(
    "From IAM roles for service accounts.",
  ),
  [ServerAwsIdentityVia.EksPodIdentity]: translationKey(
    "From EKS Pod Identity.",
  ),
  [ServerAwsIdentityVia.EcsTaskRole]: translationKey("From the ECS task role."),
  [ServerAwsIdentityVia.Container]: translationKey(
    "From the container credentials endpoint.",
  ),
  [ServerAwsIdentityVia.InstanceProfile]: translationKey(
    "From the EC2 instance profile.",
  ),
};

export const SERVER_AWS_IDENTITY_TEST_ID: string = "server-aws-identity";

// Asks the server who it signs in as. Throws when the request itself fails.
export const readServerAwsIdentity: (
  region: string | undefined,
) => Promise<ServerAwsIdentityAnswer> = async (
  region: string | undefined,
): Promise<ServerAwsIdentityAnswer> => {
  const url: URL = URL.fromURL(NOTIFICATION_URL).addRoute(
    new Route(SERVER_AWS_IDENTITY_ROUTE),
  );

  if (region) {
    url.addQueryParam("region", region);
  }

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({ url: url });

  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw response;
  }

  const answer: ServerAwsIdentityAnswer | null = parseServerAwsIdentityAnswer(
    response.data,
  );

  if (!answer) {
    throw new Error(
      "The server did not say which AWS identity it signs in as.",
    );
  }

  return answer;
};

const ServerAwsIdentityLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState<ServerAwsIdentityAnswer | null>(null);
  const [error, setError] = useState<string>("");
  const [isChecking, setIsChecking] = useState<boolean>(true);

  const check: () => Promise<void> = useCallback(async (): Promise<void> => {
    setIsChecking(true);
    setError("");

    try {
      setAnswer(await readServerAwsIdentity(props.region));
    } catch (err) {
      setAnswer(null);
      setError(API.getFriendlyMessage(err));
    }

    setIsChecking(false);
  }, [props.region]);

  useEffect(() => {
    void check();
  }, [check]);

  if (isChecking && !answer && !error) {
    return <InlineValueSkeleton widthClassName="w-80" />;
  }

  const checkAgain: ReactElement = (
    <Button
      title="Check again"
      buttonStyle={ButtonStyleType.NORMAL}
      buttonSize={ButtonSize.Small}
      isLoading={isChecking}
      onClick={() => {
        void check();
      }}
      dataTestId={`${SERVER_AWS_IDENTITY_TEST_ID}-check-again`}
    />
  );

  if (error) {
    return (
      <div
        className="flex flex-col items-start gap-2"
        data-testid={`${SERVER_AWS_IDENTITY_TEST_ID}-error`}
      >
        <p className="text-sm text-red-700">
          <ErrorSentence
            template="Couldn't ask the server which AWS identity it signs in as. {{error}}"
            error={error}
          />
        </p>
        {checkAgain}
      </div>
    );
  }

  if (answer && answer.isSignedIn) {
    return (
      <div
        className="flex flex-col gap-1"
        data-testid={`${SERVER_AWS_IDENTITY_TEST_ID}-signed-in`}
      >
        <code
          dir="ltr"
          className="break-all font-mono text-sm text-gray-900"
          data-testid={`${SERVER_AWS_IDENTITY_TEST_ID}-arn`}
        >
          {answer.arn}
        </code>
        <p className="text-sm text-gray-500">
          {answer.via ? `${t(SERVER_AWS_IDENTITY_VIA_KEYS[answer.via])} ` : ""}
          {t("A test email shows whether it may send.")}
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-start gap-2"
      data-testid={`${SERVER_AWS_IDENTITY_TEST_ID}-not-signed-in`}
    >
      <p className="text-sm text-red-700">
        <ErrorSentence
          template="This server cannot sign in to AWS. {{error}}"
          error={answer?.problem || ""}
        />
      </p>
      {checkAgain}
    </div>
  );
};

export default ServerAwsIdentityLine;

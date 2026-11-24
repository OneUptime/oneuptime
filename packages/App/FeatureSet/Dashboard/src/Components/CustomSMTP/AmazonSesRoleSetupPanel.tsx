import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  AMAZON_SES_ROLE_SETUP_ROUTE,
  AmazonSesRoleSetup,
  readAmazonSesRoleSetup,
} from "Common/Types/Email/AmazonSesRoleSetup";
import { AMAZON_SES_ROLE_NOT_AVAILABLE } from "Common/Types/Email/AmazonSesRoleWords";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import { DOCS_URL, NOTIFICATION_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHAT TO MAKE A PROJECT'S AMAZON SES ROLE WITH (#7378), under the Role ARN
 * of a Custom SMTP Config's Amazon SES step.
 *
 * A config that signs in with an IAM role in the project's own AWS account
 * needs the role made first: trusting OneUptime's AWS account, with this
 * project's email external id, and allowed ses:SendEmail. The server says
 * what that is (GET /smtp-config/aws-role-setup): the external id and a
 * trust policy written for it, each with a copy button, folded under one
 * quiet line, as the rest of the form's extras are. Cloud Connect's IAM role
 * shows its external id the same way, in its setup command.
 *
 * A server with no AWS identity to sign in with says so instead, unfolded:
 * the role could not be signed in to, so an access key is the way. Nothing
 * here is a secret - the external id and OneUptime's account are what
 * every role trusting OneUptime names - and nothing here is a key.
 */

export const AMAZON_SES_ROLE_SETUP_TITLE: string = translationKey(
  "Set Up the Role in AWS",
);

export const AMAZON_SES_ROLE_SETUP_INTRO: string = translationKey(
  "Create the role with this trust policy, then allow it ses:SendEmail on your sender's identity.",
);

export const AMAZON_SES_ROLE_SETUP_UNREADABLE: string = translationKey(
  "OneUptime could not read the role's setup from the server. Open the form again to try again.",
);

export const AMAZON_SES_ROLE_SETUP_ITEMS: Array<FoldedSectionItem> = [
  { key: "externalId", title: translationKey("External ID"), isSet: false },
  { key: "trustPolicy", title: translationKey("Trust Policy"), isSet: false },
];

// Where the docs say how to make the role, in every language the docs have.
export const AMAZON_SES_ROLE_DOCS_PATH: string = "/emails/email-providers";

// The project's role setup, as the server answers it; throws what failed.
export async function getAmazonSesRoleSetup(): Promise<AmazonSesRoleSetup> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: URL.fromString(NOTIFICATION_URL.toString()).addRoute(
        AMAZON_SES_ROLE_SETUP_ROUTE,
      ),
      // The project to answer for: a custom route is sent no tenant otherwise.
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const setup: AmazonSesRoleSetup | null = readAmazonSesRoleSetup(
    response.data,
  );

  if (!setup) {
    throw new Error(AMAZON_SES_ROLE_SETUP_UNREADABLE);
  }

  return setup;
}

export interface ComponentProps {
  // Asks the server; a test hands in its own.
  loadSetup?: (() => Promise<AmazonSesRoleSetup>) | undefined;
}

const AmazonSesRoleSetupPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [setup, setSetup] = useState<AmazonSesRoleSetup | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;
    const load: () => Promise<AmazonSesRoleSetup> =
      props.loadSetup || getAmazonSesRoleSetup;

    load()
      .then((loaded: AmazonSesRoleSetup) => {
        if (isCurrent) {
          setSetup(loaded);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  if (error) {
    return (
      <div className="mt-2" data-testid="amazon-ses-role-setup-error">
        <Alert title={error} type={AlertType.DANGER} />
      </div>
    );
  }

  if (setup && !setup.isAvailable) {
    return (
      <div className="mt-2" data-testid="amazon-ses-role-setup-unavailable">
        <Alert title={AMAZON_SES_ROLE_NOT_AVAILABLE} type={AlertType.WARNING} />
      </div>
    );
  }

  return (
    <div className="mt-2" data-testid="amazon-ses-role-setup">
      <FoldedSection
        title={AMAZON_SES_ROLE_SETUP_TITLE}
        variant="line"
        items={AMAZON_SES_ROLE_SETUP_ITEMS}
        dataTestId="amazon-ses-role-setup-fold"
      >
        {setup ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              {translator.translateText(AMAZON_SES_ROLE_SETUP_INTRO)}
            </p>

            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-900">
                {translator.translateText("External ID")}
              </p>
              <div data-testid="amazon-ses-role-external-id">
                <CodeBlock
                  code={setup.externalId}
                  language="text"
                  wrapLongLines={true}
                />
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-900">
                {translator.translateText("Trust Policy")}
              </p>
              <div data-testid="amazon-ses-role-trust-policy">
                <CodeBlock
                  code={setup.trustPolicy || ""}
                  language="json"
                  wrapLongLines={true}
                />
              </div>
            </div>

            <a
              href={`${DOCS_URL.toString()}${AMAZON_SES_ROLE_DOCS_PATH}`}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="amazon-ses-role-guide-link"
              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              <Icon icon={IconProp.Book} className="h-4 w-4" />
              <span>{translator.translateText("Read the guide")}</span>
            </a>
          </div>
        ) : (
          <div data-testid="amazon-ses-role-setup-loading">
            <InlineValueSkeleton />
          </div>
        )}
      </FoldedSection>
    </div>
  );
};

export default AmazonSesRoleSetupPanel;

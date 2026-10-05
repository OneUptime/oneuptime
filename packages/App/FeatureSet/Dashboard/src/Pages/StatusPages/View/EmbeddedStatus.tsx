import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageDomain from "Common/Models/DatabaseModels/StatusPageDomain";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import ModelAPI, { type ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import { APP_API_URL, STATUS_PAGE_URL } from "Common/UI/Config";
import HiddenText from "Common/UI/Components/HiddenText/HiddenText";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import Query from "Common/Types/BaseDatabase/Query";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import URL from "Common/Types/API/URL";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";

// The data-testid of the Embedded Status Badge switch.
export const EMBEDDED_STATUS_BADGE_SWITCH_TEST_ID: string =
  "status-page-embedded-status-badge-switch";

const StatusPageEmbeddedStatus: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = useMemo(() => {
    return Navigation.getLastParamAsObjectID(1);
  }, []);
  const [showRegenerateTokenModal, setShowRegenerateTokenModal] =
    useState<boolean>(false);
  const [isRegenerating, setIsRegenerating] = useState<boolean>(false);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [isEmbeddedStatusEnabled, setIsEmbeddedStatusEnabled] =
    useState<boolean>(false);

  const fallbackStatusPageUrl: string = useMemo(() => {
    return URL.fromString(STATUS_PAGE_URL.toString())
      .addRoute(`/${modelId.toString()}`)
      .toString();
  }, [modelId]);

  const [statusPageUrl, setStatusPageUrl] = useState<string>(
    fallbackStatusPageUrl,
  );

  useEffect(() => {
    const fetchStatusPageUrl: () => Promise<void> = async (): Promise<void> => {
      try {
        const domains: ListResult<StatusPageDomain> =
          await ModelAPI.getList<StatusPageDomain>({
            modelType: StatusPageDomain,
            query: {
              statusPageId: modelId,
              isSslProvisioned: true,
            } as Query<StatusPageDomain>,
            select: {
              fullDomain: true,
            },
            sort: {
              createdAt: SortOrder.Descending,
            } as Sort<StatusPageDomain>,
            limit: 1,
            skip: 0,
          });

        const domain: StatusPageDomain | undefined = domains.data[0];

        if (domain?.fullDomain) {
          setStatusPageUrl(`https://${domain.fullDomain}`);
          return;
        }
      } catch {
        // Ignore error and fall back to default route.
      }

      setStatusPageUrl(fallbackStatusPageUrl);
    };

    void fetchStatusPageUrl();
  }, [fallbackStatusPageUrl, modelId]);

  const regenerateToken: () => Promise<void> = async (): Promise<void> => {
    setIsRegenerating(true);
    try {
      const newToken: string = ObjectID.generate().toString();

      await ModelAPI.updateById<StatusPage>({
        id: modelId,
        modelType: StatusPage,
        data: {
          embeddedOverallStatusToken: newToken,
        },
      });

      setToken(newToken);
      setShowRegenerateTokenModal(false);
    } catch {
      // Error will be handled by ModelAPI
    } finally {
      setIsRegenerating(false);
    }
  };

  const badgeUrlWithToken: string | null = token
    ? `${APP_API_URL}/status-page/badge/${modelId.toString()}?token=${token}`
    : null;
  const badgeUrlDocumentation: string =
    badgeUrlWithToken ||
    `${APP_API_URL}/status-page/badge/${modelId.toString()}?token={TOKEN_PLACEHOLDER}`;

  const introMessage: string =
    isEmbeddedStatusEnabled && token
      ? "Your embedded status badge is currently enabled and can be embedded using the snippets below."
      : "Enable the embedded status badge and generate a security token to activate the snippets below.";

  const documentationMarkdown: string = `
${introMessage}

#### Badge URL
\`${badgeUrlDocumentation}\`

#### HTML Embed
\`\`\`html
<img src="${badgeUrlDocumentation}" alt="Status Badge" />
\`\`\`

#### Markdown Embed
\`\`\`markdown
![Status](${badgeUrlDocumentation})
\`\`\`

#### Markdown with Link
\`\`\`markdown
[![Status](${badgeUrlDocumentation})](${statusPageUrl})
\`\`\`

#### Use Cases
- Add to your company website to show real-time status
- Include in project README.md files on GitHub
- Embed in documentation sites
- Display on internal dashboards
- Include in status emails or reports

#### Security
Regenerating the token invalidates all existing embeds. Rotate the token whenever you suspect the URL has been shared publicly.
`;

  return (
    <Fragment>
      <div>
        {/*
         * One switch that saves when it is flipped. The preview below
         * follows it as it moves; the token is read along with it.
         */}
        <ModelSwitchCard<StatusPage>
          modelType={StatusPage}
          modelId={modelId}
          column="enableEmbeddedOverallStatus"
          cardTitle={translationKey("Embedded Status Badge")}
          cardDescription={translationKey(
            "Enable a lightweight status badge that can be embedded on external websites. The badge displays the current overall status of your status page.",
          )}
          title="Enable Embedded Status Badge"
          getDescription={(): string => {
            return translationKey(
              "When enabled, you can embed a status badge on external websites using the badge URL with the security token.",
            );
          }}
          select={{
            embeddedOverallStatusToken: true,
          }}
          onLoaded={(item: StatusPage): void => {
            setToken(item.embeddedOverallStatusToken || undefined);
          }}
          onChange={(isOn: boolean): void => {
            setIsEmbeddedStatusEnabled(isOn);
          }}
          dataTestId={EMBEDDED_STATUS_BADGE_SWITCH_TEST_ID}
        />

        <Card
          bodyClassName="mt-6 space-y-4"
          title="Security Token"
          description="Review and copy the token required to access the embedded badge. Keep it confidential to prevent unauthorized access."
          buttons={[
            {
              title: "Regenerate Token",
              buttonStyle: ButtonStyleType.NORMAL,
              icon: IconProp.Refresh,
              onClick: () => {
                setShowRegenerateTokenModal(true);
              },
              isLoading: isRegenerating,
              disabled: isRegenerating,
            },
          ]}
        >
          <>
            {token ? (
              <HiddenText text={token} isCopyable={true} />
            ) : (
              <p className="text-sm text-gray-500">
                {translator.translateText(
                  "No token has been generated yet. Enable the embedded badge and use “Regenerate Token” to create one.",
                )}
              </p>
            )}
            <p className="text-sm text-gray-500">
              {translator.translateText(
                "Regenerating the token will invalidate any existing embedded badges.",
              )}
            </p>
          </>
        </Card>

        <Card
          bodyClassName="mt-6"
          title="Badge Preview"
          description="Preview the live badge rendering using the current security token."
        >
          <div className="flex min-h-[160px] items-center justify-center rounded-md border border-dashed border-gray-200 bg-gray-50">
            {isEmbeddedStatusEnabled ? (
              badgeUrlWithToken ? (
                <img
                  src={badgeUrlWithToken}
                  alt={translator.translateText("Status Badge")}
                  className="max-h-24 rounded"
                />
              ) : (
                <p className="text-sm text-gray-500 text-center">
                  {translator.translateText(
                    "Generate a security token to see the live preview.",
                  )}
                </p>
              )
            ) : (
              <p className="text-sm text-gray-500 text-center">
                {translator.translateText(
                  "Enable the embedded status badge to view the live preview.",
                )}
              </p>
            )}
          </div>
        </Card>

        <Card
          className="lg:col-span-2"
          bodyClassName="mt-6"
          title="Badge Documentation"
          description="Review the rendered documentation before sharing with your team."
        >
          <MarkdownViewer text={documentationMarkdown} />
        </Card>
      </div>

      {showRegenerateTokenModal && (
        <ConfirmModal
          title="Regenerate Security Token"
          description="Are you sure you want to regenerate the security token? This will invalidate the current token and any existing embedded badges will stop working until you update them with the new token."
          onClose={() => {
            setShowRegenerateTokenModal(false);
          }}
          submitButtonText="Regenerate Token"
          onSubmit={regenerateToken}
          isLoading={isRegenerating}
        />
      )}
    </Fragment>
  );
};

export default StatusPageEmbeddedStatus;

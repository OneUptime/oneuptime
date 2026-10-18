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
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import { APP_API_URL, STATUS_PAGE_URL } from "Common/UI/Config";
import HiddenText from "Common/UI/Components/HiddenText/HiddenText";
import Query from "Common/Types/BaseDatabase/Query";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import URL from "Common/Types/API/URL";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * Status Pages -> a page -> Advanced -> Embedded Status: a small image of
 * the page's overall status, for a website, a README or docs.
 *
 * It used to end in a "Badge Documentation" card ("Review the rendered
 * documentation before sharing with your team."): the snippets again, a
 * list of use cases and a security note, beside a "Badge Preview" card -
 * and a page with no token yet offered only "Regenerate Token" to make
 * one. Now the token card's button says Create Token until there is one,
 * and one card shows the badge and the code to embed it.
 */

// The data-testid of the Embedded Status Badge switch.
export const EMBEDDED_STATUS_BADGE_SWITCH_TEST_ID: string =
  "status-page-embedded-status-badge-switch";

// The data-testid of the card that shows the badge and its code.
export const EMBEDDED_STATUS_BADGE_EMBED_TEST_ID: string =
  "status-page-embedded-status-badge-embed";

// The Security Token card's button: Create Token until there is one.
export const getEmbeddedBadgeTokenButtonTitle: (hasToken: boolean) => string = (
  hasToken: boolean,
): string => {
  return hasToken
    ? translationKey("Regenerate Token")
    : translationKey("Create Token");
};

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

  /*
   * The badge and the code that shows it, once it is switched on and has a
   * token; until then, the one thing that is missing.
   */
  const getEmbedBody: () => ReactElement = (): ReactElement => {
    if (!isEmbeddedStatusEnabled || !badgeUrlWithToken) {
      return (
        <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed border-gray-200 bg-gray-50 px-4">
          <p className="text-center text-sm text-gray-500">
            {isEmbeddedStatusEnabled
              ? translator.translateText(
                  "Create a token to see the badge and the code to embed it.",
                )
              : translator.translateText(
                  "Turn on Enable Embedded Status Badge to see the badge and the code to embed it.",
                )}
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex min-h-[96px] items-center justify-center rounded-md border border-dashed border-gray-200 bg-gray-50">
          <img
            src={badgeUrlWithToken}
            alt={translator.translateText("Status Badge")}
            className="max-h-24 rounded"
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">
            {translator.translateText("HTML")}
          </p>
          <CodeBlock
            language="html"
            code={`<img src="${badgeUrlWithToken}" alt="Status Badge" />`}
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">
            {translator.translateText("Markdown, linked to the status page")}
          </p>
          <CodeBlock
            language="markdown"
            code={`[![Status](${badgeUrlWithToken})](${statusPageUrl})`}
          />
        </div>
      </div>
    );
  };

  return (
    <Fragment>
      <div>
        {/*
         * One switch that saves when it is flipped. The card below follows
         * it as it moves; the token is read along with it.
         */}
        <ModelSwitchCard<StatusPage>
          modelType={StatusPage}
          modelId={modelId}
          column="enableEmbeddedOverallStatus"
          cardTitle={translationKey("Embedded Status Badge")}
          cardDescription={translationKey(
            "A small image of this page's overall status, for your website, a README or your docs.",
          )}
          title="Enable Embedded Status Badge"
          getDescription={(): string => {
            return translationKey(
              "Serves the badge at a link that carries the token below.",
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
          description="The secret part of the badge's link. Anyone with the link can show the badge."
          buttons={[
            {
              title: getEmbeddedBadgeTokenButtonTitle(Boolean(token)),
              buttonStyle: ButtonStyleType.NORMAL,
              icon: token ? IconProp.Refresh : IconProp.Add,
              onClick: () => {
                if (token) {
                  setShowRegenerateTokenModal(true);
                  return;
                }

                // Nothing is embedded yet, so nothing breaks: no question.
                void regenerateToken();
              },
              isLoading: isRegenerating,
              disabled: isRegenerating,
            },
          ]}
        >
          {token ? (
            <HiddenText text={token} isCopyable={true} />
          ) : (
            <p className="text-sm text-gray-500">
              {translator.translateText("No token yet.")}
            </p>
          )}
        </Card>

        <Card
          bodyClassName="mt-6"
          title="Embed the Badge"
          description="Paste one of these where the badge should show."
        >
          <div data-testid={EMBEDDED_STATUS_BADGE_EMBED_TEST_ID}>
            {getEmbedBody()}
          </div>
        </Card>
      </div>

      {showRegenerateTokenModal && (
        <ConfirmModal
          title="Regenerate Security Token"
          description="The current token stops working, and embedded badges break until you update them with the new one."
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

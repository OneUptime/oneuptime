import PageComponentProps from "../../PageComponentProps";
import { getCustomDomainInstallation } from "../../../Components/CustomDomain/CustomDomainKinds";
import {
  getFirstLiveAddress,
  getPublicAddresses,
  PublicAddress,
} from "../../../Components/CustomDomain/PublicAddressCopy";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
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
  useRef,
  useState,
} from "react";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import ModelAPI, { type ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
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
 * one. Then it asked for two things before it showed a badge: turn the
 * switch on, and press Create Token on a card of its own.
 *
 * Now the switch is the one step: the first time it is turned on, the
 * badge gets its token, and a card appears under it with the badge and the
 * code to embed it. While the badge is off there is nothing to embed, so
 * the page is the switch. The token itself - read, copied, or regenerated
 * when its link was shared too widely - waits under More settings, as it
 * is needed only then. A page switched on before it had a token offers
 * Create Token where the badge would be.
 */

// The data-testid of the Embedded Status Badge switch.
export const EMBEDDED_STATUS_BADGE_SWITCH_TEST_ID: string =
  "status-page-embedded-status-badge-switch";

// The data-testid of the card that shows the badge and its code.
export const EMBEDDED_STATUS_BADGE_EMBED_TEST_ID: string =
  "status-page-embedded-status-badge-embed";

// The data-testid of More settings, which holds the token.
export const EMBEDDED_STATUS_BADGE_MORE_TEST_ID: string =
  "status-page-embedded-status-badge-more";

export const EmbeddedStatusCopy: {
  switchDescription: string;
  needsToken: string;
  creatingToken: string;
  tokenCardTitle: string;
  tokenCardDescription: string;
} = {
  switchDescription: translationKey(
    "Serves the badge at a link with a secret token, made the first time you turn it on.",
  ),
  needsToken: translationKey("The badge needs a token before it can be shown."),
  creatingToken: translationKey("Making the badge's token..."),
  tokenCardTitle: translationKey("Security Token"),
  tokenCardDescription: translationKey(
    "The secret part of the badge's link. Anyone with the link can show the badge.",
  ),
};

// The Security Token card's button: Create Token until there is one.
export const getEmbeddedBadgeTokenButtonTitle: (hasToken: boolean) => string = (
  hasToken: boolean,
): string => {
  return hasToken
    ? translationKey("Regenerate Token")
    : translationKey("Create Token");
};

/*
 * Whether turning the badge on should make its token: only when it has
 * none. A page that already has one keeps it - its badges may be embedded
 * somewhere already.
 */
export const shouldMakeBadgeTokenWhenTurnedOn: (data: {
  isOn: boolean;
  token: string | undefined;
}) => boolean = (data: {
  isOn: boolean;
  token: string | undefined;
}): boolean => {
  return data.isOn && !data.token;
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
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [token, setToken] = useState<string | undefined>(undefined);
  /*
   * The token as last set here, for the switch's save, which comes back
   * after this render: a token made a moment ago is not made again.
   */
  const tokenRef: React.MutableRefObject<string | undefined> = useRef<
    string | undefined
  >(undefined);
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

  /*
   * Where the badge's Markdown links to: the page's first live address, as
   * its Status Page Link card lists them (PublicAddressCopy) - a custom
   * domain visitors can open, alphabetically first, or else its address on
   * OneUptime. It used to take only a domain whose free certificate was in
   * place, so a domain on an uploaded certificate - and, on an installation
   * that issues no free certificates, every verified domain - was left out
   * for the OneUptime address. The domains' own rows decide, as the server
   * decides where its emails link (StatusPageService.getUsableCustomDomain).
   */
  useEffect(() => {
    const fetchStatusPageUrl: () => Promise<void> = async (): Promise<void> => {
      try {
        const domains: ListResult<StatusPageDomain> =
          await ModelAPI.getList<StatusPageDomain>({
            modelType: StatusPageDomain,
            query: {
              statusPageId: modelId,
            } as Query<StatusPageDomain>,
            select: {
              fullDomain: true,
              isCnameVerified: true,
              isCustomCertificate: true,
              isSslOrdered: true,
              isSslProvisioned: true,
            },
            sort: {
              createdAt: SortOrder.Descending,
            } as Sort<StatusPageDomain>,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
          });

        const firstLive: PublicAddress<StatusPageDomain> | undefined =
          getFirstLiveAddress<StatusPageDomain>(
            getPublicAddresses<StatusPageDomain>({
              domains: domains.data,
              oneUptimeUrl: fallbackStatusPageUrl,
              installation: getCustomDomainInstallation(),
            }),
          );

        setStatusPageUrl(firstLive ? firstLive.url : fallbackStatusPageUrl);
        return;
      } catch {
        // Ignore error and fall back to default route.
      }

      setStatusPageUrl(fallbackStatusPageUrl);
    };

    void fetchStatusPageUrl();
  }, [fallbackStatusPageUrl, modelId]);

  const keepToken: (value: string | undefined) => void = (
    value: string | undefined,
  ): void => {
    tokenRef.current = value;
    setToken(value);
  };

  // A new token, saved at once: Create Token, Regenerate Token, turning on.
  const regenerateToken: () => Promise<void> = async (): Promise<void> => {
    setIsRegenerating(true);
    setTokenError(null);
    try {
      const newToken: string = ObjectID.generate().toString();

      await ModelAPI.updateById<StatusPage>({
        id: modelId,
        modelType: StatusPage,
        data: {
          embeddedOverallStatusToken: newToken,
        },
      });

      keepToken(newToken);
      setShowRegenerateTokenModal(false);
    } catch (err) {
      setTokenError(API.getFriendlyMessage(err));
    } finally {
      setIsRegenerating(false);
    }
  };

  const badgeUrlWithToken: string | null = token
    ? `${APP_API_URL}/status-page/badge/${modelId.toString()}?token=${token}`
    : null;

  // A sentence in the dashed box the badge is shown in.
  const getEmbedPlaceholder: (children: ReactElement) => ReactElement = (
    children: ReactElement,
  ): ReactElement => {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-gray-200 bg-gray-50 px-4 py-4">
        {children}
      </div>
    );
  };

  /*
   * The badge and the code that shows it, once it has a token; until then,
   * the token that is missing. Drawn only while the badge is on.
   */
  const getEmbedBody: () => ReactElement = (): ReactElement => {
    if (!badgeUrlWithToken) {
      if (isRegenerating) {
        return getEmbedPlaceholder(
          <p className="text-center text-sm text-gray-500">
            {translator.translateText(EmbeddedStatusCopy.creatingToken)}
          </p>,
        );
      }

      return getEmbedPlaceholder(
        <Fragment>
          <p className="text-center text-sm text-gray-500">
            {translator.translateText(EmbeddedStatusCopy.needsToken)}
          </p>
          {tokenError ? (
            <p className="text-center text-sm text-red-600" role="alert">
              {tokenError}
            </p>
          ) : (
            <></>
          )}
          {/*
           * Button keeps a dialog footer's left margin (md:ml-3), which
           * would push it off the centre here, so its wrapper clears it.
           */}
          <div className="[&>button]:ml-0 [&>button]:md:ml-0">
            <Button
              title={getEmbeddedBadgeTokenButtonTitle(false)}
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={() => {
                void regenerateToken();
              }}
              dataTestId="embedded-status-badge-create-token"
            />
          </div>
        </Fragment>,
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
          {/*
           * One long line, read whole and copied: it wraps rather than
           * running under the copy button (CodeBlock wrapLongLines).
           */}
          <CodeBlock
            language="html"
            code={`<img src="${badgeUrlWithToken}" alt="Status Badge" />`}
            wrapLongLines={true}
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">
            {translator.translateText("Markdown, linked to the status page")}
          </p>
          <CodeBlock
            language="markdown"
            code={`[![Status](${badgeUrlWithToken})](${statusPageUrl})`}
            wrapLongLines={true}
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
         * it as it moves; the token is read along with it, and made the
         * first time the badge is turned on.
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
            return EmbeddedStatusCopy.switchDescription;
          }}
          select={{
            embeddedOverallStatusToken: true,
          }}
          onLoaded={(item: StatusPage): void => {
            /*
             * A read that was on its way while a token was made here does
             * not take that token away.
             */
            keepToken(item.embeddedOverallStatusToken || tokenRef.current);
          }}
          onChange={(isOn: boolean): void => {
            setIsEmbeddedStatusEnabled(isOn);
          }}
          onSaved={(isOn: boolean): void => {
            if (
              shouldMakeBadgeTokenWhenTurnedOn({
                isOn: isOn,
                token: tokenRef.current,
              })
            ) {
              // Nothing is embedded yet, so nothing breaks: no question.
              void regenerateToken();
            }
          }}
          dataTestId={EMBEDDED_STATUS_BADGE_SWITCH_TEST_ID}
        />

        {/*
         * Only while the badge is on: off, there is nothing to embed, and
         * the switch above says what turning it on does.
         */}
        {isEmbeddedStatusEnabled ? (
          <Card
            bodyClassName="mt-6"
            title="Embed the Badge"
            description="Paste one of these where the badge should show."
          >
            <div data-testid={EMBEDDED_STATUS_BADGE_EMBED_TEST_ID}>
              {getEmbedBody()}
            </div>
          </Card>
        ) : (
          <></>
        )}

        {/*
         * The token is in the code above already; it is needed on its own
         * only to read it, or to regenerate it when its link was shared too
         * widely. The one card in the fold says so itself.
         */}
        <AdvancedPageSection
          items={[
            {
              key: "security-token",
              title: EmbeddedStatusCopy.tokenCardTitle,
              isSet: false,
            },
          ]}
          dataTestId={EMBEDDED_STATUS_BADGE_MORE_TEST_ID}
        >
          <Card
            bodyClassName="mt-6 space-y-4"
            title={EmbeddedStatusCopy.tokenCardTitle}
            description={EmbeddedStatusCopy.tokenCardDescription}
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
        </AdvancedPageSection>
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
          error={tokenError || undefined}
        />
      )}
    </Fragment>
  );
};

export default StatusPageEmbeddedStatus;

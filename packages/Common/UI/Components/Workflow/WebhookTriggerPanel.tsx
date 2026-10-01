import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import CopyTextButton from "../CopyTextButton/CopyTextButton";
import Icon from "../Icon/Icon";
import ConfirmModal from "../Modal/ConfirmModal";
import BreakableCode from "./BreakableCode";
import ComponentSettingsSection from "./ComponentSettingsSection";
import API from "../../Utils/API/API";
import useTranslateValue from "../../Utils/Translation";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import IconProp from "../../../Types/Icon/IconProp";
import {
  WEBHOOK_TRIGGER_HTTP_METHODS,
  WEBHOOK_TRIGGER_SECRET_MASK,
  getWebhookTriggerCurlExample,
} from "../../../Types/Workflow/WebhookTrigger";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * Every sentence the panel shows, in English. Each is looked up whole in the
 * Dashboard's locale files (never assembled from translated words), and
 * WebhookTriggerPanelI18n.test.ts holds every locale to having all of them.
 * The buttons and the confirmation translate their own titles; they get the
 * English text.
 */
export const WebhookTriggerPanelCopy: {
  readonly title: string;
  readonly description: string;
  readonly copyUrl: string;
  readonly copyUrlTitle: string;
  readonly copied: string;
  readonly show: string;
  readonly hide: string;
  readonly showTitle: string;
  readonly hideTitle: string;
  readonly maskedForScreenReaders: string;
  readonly methods: string;
  readonly tryIt: string;
  readonly copyExample: string;
  readonly copyExampleTitle: string;
  readonly keepPrivate: string;
  readonly resetIfLeaked: string;
  readonly isWorkflowId: string;
  readonly resetToMakePrivate: string;
  readonly resetUrl: string;
  readonly resetConfirmTitle: string;
  readonly resetConfirmDescription: string;
  readonly resetDone: string;
  readonly missing: string;
  readonly createUrl: string;
  readonly hidden: string;
} = {
  title: "Webhook URL",
  description: "Send a request to this URL to start the workflow.",
  copyUrl: "Copy URL",
  copyUrlTitle: "Copy the webhook URL",
  copied: "Copied!",
  show: "Show",
  hide: "Hide",
  showTitle: "Show the full URL",
  hideTitle: "Hide the secret key",
  maskedForScreenReaders: "secret key hidden",
  // Built from the methods the server registers; see getMethodsSentence.
  methods: "Accepts GET or POST requests.",
  tryIt: "Try it",
  copyExample: "Copy",
  copyExampleTitle: "Copy the example request",
  keepPrivate:
    "Anyone with this URL can start the workflow, so keep it private.",
  resetIfLeaked: "If it leaks, reset it.",
  isWorkflowId:
    "This URL ends in the workflow's ID, which anyone who can open the workflow can see.",
  resetToMakePrivate: "Reset it to get a private URL.",
  resetUrl: "Reset URL",
  resetConfirmTitle: "Reset the webhook URL?",
  resetConfirmDescription:
    "The workflow gets a new URL, and the current one stops working at once. Anything that still calls it will fail until you give it the new URL.",
  resetDone:
    "URL reset. The old one no longer works, so copy this one into anything that should start the workflow.",
  missing: "This workflow does not have a webhook URL yet.",
  createUrl: "Create URL",
  hidden:
    "The webhook URL contains this workflow's secret key, so only people who can edit this workflow can see it. Ask one of them for it.",
};

/*
 * "Accepts GET or POST requests.", from the methods the trigger really
 * accepts. The sentence is translated whole; only the method names, which no
 * language translates, are picked back out of it to be drawn as badges.
 */
export const getMethodsSentence: () => string = (): string => {
  return `Accepts ${WEBHOOK_TRIGGER_HTTP_METHODS.join(" or ")} requests.`;
};

export interface ComponentProps {
  /*
   * The URL to call, secret key included. Null when there is none to show:
   * the workflow has no key yet, or this user may not see it (canSeeUrl).
   */
  webhookUrl: string | null;
  // Everything before the key, which is shown while the key is masked.
  webhookUrlPrefix: string;
  /*
   * False when this user may not read the key. Nothing of the URL is shown
   * then; the panel says who can see it.
   */
  canSeeUrl: boolean;
  /*
   * The key is the workflow's own ID, as it is for workflows created before
   * secret keys existed. The panel says the URL is not private.
   */
  isUrlBuiltFromWorkflowId?: boolean | undefined;
  /*
   * Gives the workflow a new key, and resolves once it is saved; the new URL
   * then arrives through webhookUrl. Rejects with the API's error. Absent where
   * the URL cannot be reset from here.
   */
  onResetUrl?: (() => Promise<void>) | undefined;
  /*
   * Set when this user may not reset the URL. The button stays on screen,
   * disabled, with this as its tooltip.
   */
  resetDisabledReason?: string | undefined;
}

/*
 * Someone who opens a Webhook trigger has come for its URL, to paste into the
 * app that will call it, so it is the first thing in the dialog: with a copy
 * button, the methods it accepts, and a request that can be pasted into a
 * terminal to try it.
 *
 * The URL is the credential - its last segment is the workflow's secret key -
 * so this is also where the key is managed. It used to be a card on the
 * workflow's Settings page, away from the trigger it belongs to. The key is
 * masked until the reader asks to see it, as it was there: the dialog is
 * often open on a shared screen, and Copy URL copies the real URL either way.
 * Reset URL replaces the key after a confirmation that says what breaks.
 */
const WebhookTriggerPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const translate: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const [isUrlShown, setIsUrlShown] = useState<boolean>(false);
  const [showResetConfirmation, setShowResetConfirmation] =
    useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [resetError, setResetError] = useState<string>("");
  const [hasJustReset, setHasJustReset] = useState<boolean>(false);

  const canReset: boolean = Boolean(
    props.onResetUrl && !props.resetDisabledReason,
  );

  type ChangeUrlFunction = () => Promise<boolean>;

  // Resolves whether the new key was saved; a failure is left in resetError.
  const changeUrl: ChangeUrlFunction = async (): Promise<boolean> => {
    if (!props.onResetUrl || !canReset || isResetting) {
      return false;
    }

    setIsResetting(true);
    setResetError("");

    try {
      await props.onResetUrl();
      setIsResetting(false);

      return true;
    } catch (err) {
      setResetError(API.getFriendlyMessage(err));
      setIsResetting(false);

      return false;
    }
  };

  const section: (children: ReactElement) => ReactElement = (
    children: ReactElement,
  ): ReactElement => {
    return (
      <ComponentSettingsSection
        id="webhook-url"
        icon={IconProp.Webhook}
        title={translate(WebhookTriggerPanelCopy.title)}
        description={
          props.canSeeUrl && props.webhookUrl
            ? translate(WebhookTriggerPanelCopy.description)
            : undefined
        }
        tone="primary"
      >
        {children}
      </ComponentSettingsSection>
    );
  };

  if (!props.canSeeUrl) {
    /*
     * The builder did not ask for the key, so there is nothing of it on the
     * page to give away; the reader only learns why and who to ask.
     */
    return section(
      <div
        className="flex items-start gap-2 text-sm text-gray-600"
        data-testid="webhook-trigger-url-hidden"
      >
        <Icon
          icon={IconProp.Lock}
          className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
        />
        <p>{translate(WebhookTriggerPanelCopy.hidden)}</p>
      </div>,
    );
  }

  if (!props.webhookUrl) {
    /*
     * Nothing to break yet, so creating the URL needs no confirmation. Every
     * workflow is given a key when it is created, so this is rare: a create
     * whose key could not be saved.
     */
    return section(
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p
          className="text-sm text-gray-600"
          data-testid="webhook-trigger-url-missing"
        >
          {translate(WebhookTriggerPanelCopy.missing)}
        </p>
        {props.onResetUrl ? (
          <Button
            title={WebhookTriggerPanelCopy.createUrl}
            icon={IconProp.Add}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            className="shrink-0 self-start sm:self-auto"
            dataTestId="webhook-trigger-create-url"
            isLoading={isResetting}
            disabled={!canReset}
            tooltip={props.resetDisabledReason}
            onClick={() => {
              changeUrl().catch(() => {
                // changeUrl keeps every failure in resetError.
              });
            }}
          />
        ) : (
          <></>
        )}
        {resetError ? (
          <p className="text-sm text-red-600" role="alert">
            {resetError}
          </p>
        ) : (
          <></>
        )}
      </div>,
    );
  }

  const shownUrl: string = isUrlShown
    ? props.webhookUrl
    : `${props.webhookUrlPrefix}${WEBHOOK_TRIGGER_SECRET_MASK}`;

  const curlExample: string = getWebhookTriggerCurlExample(props.webhookUrl);
  const shownCurlExample: string = getWebhookTriggerCurlExample(shownUrl);

  /*
   * The translated sentence, with each method name in it drawn as a badge.
   * Method names are the same in every language, so they are found by name;
   * everything else - spaces and punctuation included - is the sentence as
   * the language writes it ("GET- oder POST-Anfragen.").
   */
  const methodsSentence: string = translate(getMethodsSentence());
  const methodNames: RegExp = new RegExp(
    `\\b(${WEBHOOK_TRIGGER_HTTP_METHODS.join("|")})\\b`,
  );
  const methodsParts: Array<string> = methodsSentence
    .split(methodNames)
    .filter((part: string) => {
      return part.length > 0;
    });

  const footerNote: ReactElement = props.isUrlBuiltFromWorkflowId ? (
    <div
      className="flex min-w-0 items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
      data-testid="webhook-trigger-url-is-workflow-id"
    >
      <Icon
        icon={IconProp.Alert}
        className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500"
      />
      <p>
        {translate(WebhookTriggerPanelCopy.isWorkflowId)}
        {canReset
          ? ` ${translate(WebhookTriggerPanelCopy.resetToMakePrivate)}`
          : ""}
      </p>
    </div>
  ) : (
    <div
      className="flex min-w-0 items-start gap-1.5 text-xs text-gray-500"
      data-testid="webhook-trigger-url-private"
    >
      <Icon
        icon={IconProp.Lock}
        className="mt-px h-3.5 w-3.5 shrink-0 text-gray-400"
      />
      <p>
        {translate(WebhookTriggerPanelCopy.keepPrivate)}
        {canReset ? ` ${translate(WebhookTriggerPanelCopy.resetIfLeaked)}` : ""}
      </p>
    </div>
  );

  return section(
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div
          className="min-w-0 flex-1 overflow-x-auto rounded-md border border-gray-200 bg-white px-3 py-2 text-xs leading-5 text-gray-900 sm:text-sm"
          data-testid="webhook-trigger-url"
          data-url-shown={isUrlShown ? "true" : "false"}
        >
          {isUrlShown ? (
            <BreakableCode text={props.webhookUrl} breakAfter="/" />
          ) : (
            <>
              <BreakableCode text={props.webhookUrlPrefix} breakAfter="/" />
              <span
                aria-hidden="true"
                className="whitespace-nowrap font-mono text-gray-500"
              >
                {WEBHOOK_TRIGGER_SECRET_MASK}
              </span>
              <span className="sr-only">
                {` ${translate(WebhookTriggerPanelCopy.maskedForScreenReaders)}`}
              </span>
            </>
          )}
        </div>
        {/*
         * Copy URL first: it is what the dialog is opened for, and the dialog
         * puts the keyboard on the first control it finds.
         */}
        <div className="flex shrink-0 items-start gap-2">
          <CopyTextButton
            textToBeCopied={props.webhookUrl}
            label={translate(WebhookTriggerPanelCopy.copyUrl)}
            copiedLabel={translate(WebhookTriggerPanelCopy.copied)}
            size="md"
            variant="soft"
            title={translate(WebhookTriggerPanelCopy.copyUrlTitle)}
          />
          <button
            type="button"
            className="inline-flex cursor-pointer select-none items-center justify-center gap-1 rounded-md border border-gray-200 bg-gray-100 px-2.5 py-1.5 text-sm text-gray-600 transition-colors duration-150 hover:bg-gray-200"
            data-testid="webhook-trigger-url-visibility"
            title={translate(
              isUrlShown
                ? WebhookTriggerPanelCopy.hideTitle
                : WebhookTriggerPanelCopy.showTitle,
            )}
            aria-label={translate(
              isUrlShown
                ? WebhookTriggerPanelCopy.hideTitle
                : WebhookTriggerPanelCopy.showTitle,
            )}
            onClick={() => {
              setIsUrlShown(!isUrlShown);
            }}
          >
            <span aria-hidden="true" className="flex items-center">
              <Icon
                icon={isUrlShown ? IconProp.EyeSlash : IconProp.Eye}
                className="h-[1.125rem] w-[1.125rem]"
              />
            </span>
            <span>
              {translate(
                isUrlShown
                  ? WebhookTriggerPanelCopy.hide
                  : WebhookTriggerPanelCopy.show,
              )}
            </span>
          </button>
        </div>
      </div>

      {hasJustReset ? (
        <div
          className="mt-2 flex items-start gap-1.5 text-xs text-emerald-700"
          role="status"
          data-testid="webhook-trigger-url-reset-done"
        >
          <Icon
            icon={IconProp.CheckCircle}
            className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600"
          />
          <p>{translate(WebhookTriggerPanelCopy.resetDone)}</p>
        </div>
      ) : (
        <></>
      )}

      <p
        className="mt-3 text-xs leading-6 text-gray-600"
        data-testid="webhook-trigger-methods"
      >
        {methodsParts.map((part: string, index: number) => {
          if (WEBHOOK_TRIGGER_HTTP_METHODS.includes(part as HTTPMethod)) {
            return (
              <span
                key={index}
                className="mx-0.5 inline-block rounded border border-gray-200 bg-white px-1.5 font-mono text-[11px] font-semibold leading-5 text-gray-700"
              >
                {part}
              </span>
            );
          }

          return <React.Fragment key={index}>{part}</React.Fragment>;
        })}
      </p>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-700">
            {translate(WebhookTriggerPanelCopy.tryIt)}
          </p>
          <CopyTextButton
            textToBeCopied={curlExample}
            label={translate(WebhookTriggerPanelCopy.copyExample)}
            copiedLabel={translate(WebhookTriggerPanelCopy.copied)}
            size="sm"
            variant="soft"
            title={translate(WebhookTriggerPanelCopy.copyExampleTitle)}
          />
        </div>
        <pre
          className="mt-1.5 overflow-x-auto rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-xs leading-5 text-gray-800"
          data-testid="webhook-trigger-curl"
        >
          <code className="font-mono">{shownCurlExample}</code>
        </pre>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-indigo-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
        {footerNote}
        {props.onResetUrl ? (
          <Button
            title={WebhookTriggerPanelCopy.resetUrl}
            icon={IconProp.Refresh}
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            buttonSize={ButtonSize.Small}
            className="shrink-0 self-start sm:self-auto"
            dataTestId="webhook-trigger-reset-url"
            disabled={!canReset}
            tooltip={props.resetDisabledReason}
            onClick={() => {
              if (!canReset) {
                return;
              }

              setResetError("");
              setShowResetConfirmation(true);
            }}
          />
        ) : (
          <></>
        )}
      </div>

      {showResetConfirmation ? (
        <ConfirmModal
          title={WebhookTriggerPanelCopy.resetConfirmTitle}
          description={WebhookTriggerPanelCopy.resetConfirmDescription}
          submitButtonText={WebhookTriggerPanelCopy.resetUrl}
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isResetting}
          error={resetError || undefined}
          onClose={() => {
            if (isResetting) {
              return;
            }

            setResetError("");
            setShowResetConfirmation(false);
          }}
          onSubmit={() => {
            changeUrl()
              .then((saved: boolean) => {
                if (saved) {
                  setShowResetConfirmation(false);
                  setHasJustReset(true);
                }
              })
              .catch(() => {
                // changeUrl keeps every failure in resetError.
              });
          }}
        />
      ) : (
        <></>
      )}
    </>,
  );
};

export default WebhookTriggerPanel;

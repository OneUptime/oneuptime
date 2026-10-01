import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import CopyTextButton from "../CopyTextButton/CopyTextButton";
import Icon from "../Icon/Icon";
import ConfirmModal from "../Modal/ConfirmModal";
import BreakableCode from "./BreakableCode";
import ComponentSettingsSection from "./ComponentSettingsSection";
import API from "../../Utils/API/API";
import useTranslateValue from "../../Utils/Translation";
import IconProp from "../../../Types/Icon/IconProp";
import {
  INCOMING_EMAIL_TRIGGER_LOCAL_PART_PREFIX,
  INCOMING_EMAIL_TRIGGER_SECRET_MASK,
} from "../../../Types/Workflow/IncomingEmailTrigger";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Every sentence the panel shows, in English. Each is looked up whole in the
 * Dashboard's locale files (never assembled from translated words), and
 * IncomingEmailTriggerPanelI18n.test.ts holds every locale to having all of
 * them. The buttons and the confirmation translate their own titles; they get
 * the English text. Copied, Show, Hide and the masked-key words are the
 * Webhook trigger's own, so the two panels read the same.
 */
export const IncomingEmailTriggerPanelCopy: {
  readonly title: string;
  readonly description: string;
  readonly copyAddress: string;
  readonly copyAddressTitle: string;
  readonly copied: string;
  readonly show: string;
  readonly hide: string;
  readonly showTitle: string;
  readonly hideTitle: string;
  readonly maskedForScreenReaders: string;
  readonly keepPrivate: string;
  readonly resetIfLeaked: string;
  readonly resetAddress: string;
  readonly resetConfirmTitle: string;
  readonly resetConfirmDescription: string;
  readonly resetDone: string;
  readonly creating: string;
  readonly missing: string;
  readonly createAddress: string;
  readonly hidden: string;
  readonly notConfigured: string;
  readonly setupGuide: string;
} = {
  title: "Email address",
  description: "Send an email to this address to start the workflow.",
  copyAddress: "Copy address",
  copyAddressTitle: "Copy the email address",
  copied: "Copied!",
  show: "Show",
  hide: "Hide",
  showTitle: "Show the full address",
  hideTitle: "Hide the secret key",
  maskedForScreenReaders: "secret key hidden",
  keepPrivate:
    "Anyone with this address can start the workflow, so keep it private.",
  /*
   * Not the Webhook trigger's "If it leaks, reset it.": several languages
   * give "it" the gender of "URL", which is not the gender of "address".
   */
  resetIfLeaked: "If the address leaks, reset it.",
  resetAddress: "Reset address",
  resetConfirmTitle: "Reset the email address?",
  resetConfirmDescription:
    "The workflow gets a new address, and the current one stops working at once. Email sent to the current address will be ignored, so give the new one to everything that emails the workflow.",
  resetDone:
    "Address reset. The old one no longer works, so give this one to anything that should email the workflow.",
  creating: "Creating this workflow's email address...",
  missing: "This workflow does not have an email address yet.",
  createAddress: "Create address",
  hidden:
    "The email address contains this workflow's secret key, so only people who can edit this workflow can see it. Ask one of them for it.",
  notConfigured:
    "This OneUptime server is not set up to receive email, so this workflow has no address yet. Ask your OneUptime administrator to set up inbound email.",
  setupGuide: "How to set up inbound email",
};

export interface ComponentProps {
  /*
   * The server's inbound email domain (INBOUND_EMAIL_DOMAIN). Empty when the
   * server receives no email at all: there is then no address to show, for
   * anyone, and the panel says how to set inbound email up.
   */
  inboundDomain: string | null;
  /*
   * The address to send to, secret key included. Null when there is none to
   * show: the workflow has no key yet, or this user may not see it.
   */
  address: string | null;
  /*
   * False when this user may not read the key. Nothing of the address is
   * shown then; the panel says who can see it.
   */
  canSeeAddress: boolean;
  /*
   * Gives the workflow a new key, and resolves once it is saved; the new
   * address then arrives through `address`. Rejects with the API's error.
   * Also what creates the first address. Absent where it cannot be done here.
   */
  onResetAddress?: (() => Promise<void>) | undefined;
  /*
   * Set when this user may not reset the address. The button stays on
   * screen, disabled, with this as its tooltip.
   */
  resetDisabledReason?: string | undefined;
  // The page that explains how to set up inbound email on a server.
  setupGuideUrl: string;
}

/*
 * Someone who opens an Incoming Email trigger has come for its address, to
 * give to whatever should send the email, so it is the first thing in the
 * dialog, with a copy button. It mirrors the Webhook trigger's URL
 * (WebhookTriggerPanel): the address is the credential - the part before the
 * @ holds the workflow's secret key - so the key is masked until the reader
 * asks to see it, Copy address copies the real address either way, and Reset
 * address gives the workflow a new one after a confirmation that says what
 * breaks.
 *
 * A workflow gets its address the first time its graph is saved with this
 * trigger. When the dialog opens before that has happened - the step was only
 * just added - the panel creates the address itself rather than asking: there
 * is nothing to break yet, and the address is what the step is for.
 */
const IncomingEmailTriggerPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const translate: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const [isAddressShown, setIsAddressShown] = useState<boolean>(false);
  const [showResetConfirmation, setShowResetConfirmation] =
    useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  const [hasJustReset, setHasJustReset] = useState<boolean>(false);
  const hasTriedToCreate: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const inboundDomain: string = (props.inboundDomain || "").trim();

  const canReset: boolean = Boolean(
    props.onResetAddress && !props.resetDisabledReason,
  );

  /*
   * Button keeps an outline button's colours when it is disabled, so a reset
   * this user may not make would look like one they can. The tooltip says why.
   */
  const disabledLook: string = canReset ? "" : "opacity-50";

  type SaveNewAddressFunction = () => Promise<boolean>;

  // Resolves whether the new key was saved; a failure is left in saveError.
  const saveNewAddress: SaveNewAddressFunction = async (): Promise<boolean> => {
    if (!props.onResetAddress || !canReset || isSaving) {
      return false;
    }

    setIsSaving(true);
    setSaveError("");

    try {
      await props.onResetAddress();
      setIsSaving(false);

      return true;
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
      setIsSaving(false);

      return false;
    }
  };

  const shouldCreateAddress: boolean = Boolean(
    inboundDomain && props.canSeeAddress && !props.address && canReset,
  );

  useEffect(() => {
    // Once per dialog: a failure is shown, with Create address to try again.
    if (!shouldCreateAddress || hasTriedToCreate.current) {
      return;
    }

    hasTriedToCreate.current = true;

    saveNewAddress().catch(() => {
      // saveNewAddress keeps every failure in saveError.
    });
  }, [shouldCreateAddress]);

  const section: (children: ReactElement) => ReactElement = (
    children: ReactElement,
  ): ReactElement => {
    return (
      <ComponentSettingsSection
        id="email-address"
        icon={IconProp.InboxArrowDown}
        title={translate(IncomingEmailTriggerPanelCopy.title)}
        description={
          inboundDomain && props.canSeeAddress && props.address
            ? translate(IncomingEmailTriggerPanelCopy.description)
            : undefined
        }
        tone="primary"
      >
        {children}
      </ComponentSettingsSection>
    );
  };

  if (!inboundDomain) {
    /*
     * Nobody gets an address on a server that receives no email, whatever
     * their permissions, so this comes first. Usually a self-hosted server
     * whose administrator has not set up inbound email yet.
     */
    return section(
      <div
        className="flex items-start gap-2 text-sm text-gray-600"
        data-testid="incoming-email-trigger-not-configured"
      >
        <Icon
          icon={IconProp.Info}
          className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
        />
        <div className="min-w-0">
          <p>{translate(IncomingEmailTriggerPanelCopy.notConfigured)}</p>
          <a
            href={props.setupGuideUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
            data-testid="incoming-email-trigger-setup-guide"
          >
            {translate(IncomingEmailTriggerPanelCopy.setupGuide)}
            <Icon icon={IconProp.ExternalLink} className="h-3 w-3" />
          </a>
        </div>
      </div>,
    );
  }

  if (!props.canSeeAddress) {
    /*
     * The builder did not ask for the key, so there is nothing of it on the
     * page to give away; the reader only learns why and who to ask.
     */
    return section(
      <div
        className="flex items-start gap-2 text-sm text-gray-600"
        data-testid="incoming-email-trigger-address-hidden"
      >
        <Icon
          icon={IconProp.Lock}
          className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
        />
        <p>{translate(IncomingEmailTriggerPanelCopy.hidden)}</p>
      </div>,
    );
  }

  if (!props.address) {
    return section(
      <>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p
            className="text-sm text-gray-600"
            data-testid={
              isSaving
                ? "incoming-email-trigger-address-creating"
                : "incoming-email-trigger-address-missing"
            }
            role={isSaving ? "status" : undefined}
          >
            {translate(
              isSaving
                ? IncomingEmailTriggerPanelCopy.creating
                : IncomingEmailTriggerPanelCopy.missing,
            )}
          </p>
          {props.onResetAddress && !isSaving ? (
            <Button
              title={IncomingEmailTriggerPanelCopy.createAddress}
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              className={`shrink-0 self-start sm:self-auto ${disabledLook}`}
              dataTestId="incoming-email-trigger-create-address"
              disabled={!canReset}
              tooltip={props.resetDisabledReason}
              onClick={() => {
                saveNewAddress().catch(() => {
                  // saveNewAddress keeps every failure in saveError.
                });
              }}
            />
          ) : (
            <></>
          )}
        </div>
        {saveError ? (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {saveError}
          </p>
        ) : (
          <></>
        )}
      </>,
    );
  }

  const footerNote: ReactElement = (
    <div
      className="flex min-w-0 items-start gap-1.5 text-xs text-gray-500"
      data-testid="incoming-email-trigger-address-private"
    >
      <Icon
        icon={IconProp.Lock}
        className="mt-px h-3.5 w-3.5 shrink-0 text-gray-400"
      />
      <p>
        {translate(IncomingEmailTriggerPanelCopy.keepPrivate)}
        {canReset
          ? ` ${translate(IncomingEmailTriggerPanelCopy.resetIfLeaked)}`
          : ""}
      </p>
    </div>
  );

  return section(
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div
          className="min-w-0 flex-1 overflow-x-auto rounded-md border border-gray-200 bg-white px-3 py-2 text-xs leading-5 text-gray-900 sm:text-sm"
          data-testid="incoming-email-trigger-address"
          data-address-shown={isAddressShown ? "true" : "false"}
        >
          {isAddressShown ? (
            <BreakableCode text={props.address} breakAfter="@" />
          ) : (
            <code className="font-mono">
              <span className="whitespace-nowrap font-mono">
                {INCOMING_EMAIL_TRIGGER_LOCAL_PART_PREFIX}
              </span>
              <span
                aria-hidden="true"
                className="whitespace-nowrap font-mono text-gray-500"
              >
                {INCOMING_EMAIL_TRIGGER_SECRET_MASK}
              </span>
              <span className="sr-only">
                {` ${translate(IncomingEmailTriggerPanelCopy.maskedForScreenReaders)} `}
              </span>
              <span className="whitespace-nowrap font-mono">@</span>
              <wbr />
              <span className="whitespace-nowrap font-mono">
                {inboundDomain}
              </span>
            </code>
          )}
        </div>
        {/*
         * Copy address first: it is what the dialog is opened for, and the
         * dialog puts the keyboard on the first control it finds.
         */}
        <div className="flex shrink-0 items-start gap-2">
          <CopyTextButton
            textToBeCopied={props.address}
            label={translate(IncomingEmailTriggerPanelCopy.copyAddress)}
            copiedLabel={translate(IncomingEmailTriggerPanelCopy.copied)}
            size="md"
            variant="soft"
            title={translate(IncomingEmailTriggerPanelCopy.copyAddressTitle)}
          />
          <button
            type="button"
            className="inline-flex cursor-pointer select-none items-center justify-center gap-1 rounded-md border border-gray-200 bg-gray-100 px-2.5 py-1.5 text-sm text-gray-600 transition-colors duration-150 hover:bg-gray-200"
            data-testid="incoming-email-trigger-address-visibility"
            title={translate(
              isAddressShown
                ? IncomingEmailTriggerPanelCopy.hideTitle
                : IncomingEmailTriggerPanelCopy.showTitle,
            )}
            aria-label={translate(
              isAddressShown
                ? IncomingEmailTriggerPanelCopy.hideTitle
                : IncomingEmailTriggerPanelCopy.showTitle,
            )}
            onClick={() => {
              setIsAddressShown(!isAddressShown);
            }}
          >
            <span aria-hidden="true" className="flex items-center">
              <Icon
                icon={isAddressShown ? IconProp.EyeSlash : IconProp.Eye}
                className="h-[1.125rem] w-[1.125rem]"
              />
            </span>
            <span>
              {translate(
                isAddressShown
                  ? IncomingEmailTriggerPanelCopy.hide
                  : IncomingEmailTriggerPanelCopy.show,
              )}
            </span>
          </button>
        </div>
      </div>

      {hasJustReset ? (
        <div
          className="mt-2 flex items-start gap-1.5 text-xs text-emerald-700"
          role="status"
          data-testid="incoming-email-trigger-address-reset-done"
        >
          <Icon
            icon={IconProp.CheckCircle}
            className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600"
          />
          <p>{translate(IncomingEmailTriggerPanelCopy.resetDone)}</p>
        </div>
      ) : (
        <></>
      )}

      <div className="mt-4 flex flex-col gap-3 border-t border-indigo-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
        {footerNote}
        {props.onResetAddress ? (
          <Button
            title={IncomingEmailTriggerPanelCopy.resetAddress}
            icon={IconProp.Refresh}
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            buttonSize={ButtonSize.Small}
            className={`shrink-0 self-start sm:self-auto ${disabledLook}`}
            dataTestId="incoming-email-trigger-reset-address"
            disabled={!canReset}
            tooltip={props.resetDisabledReason}
            onClick={() => {
              if (!canReset) {
                return;
              }

              setSaveError("");
              setShowResetConfirmation(true);
            }}
          />
        ) : (
          <></>
        )}
      </div>

      {showResetConfirmation ? (
        <ConfirmModal
          title={IncomingEmailTriggerPanelCopy.resetConfirmTitle}
          description={IncomingEmailTriggerPanelCopy.resetConfirmDescription}
          submitButtonText={IncomingEmailTriggerPanelCopy.resetAddress}
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isSaving}
          error={saveError || undefined}
          onClose={() => {
            if (isSaving) {
              return;
            }

            setSaveError("");
            setShowResetConfirmation(false);
          }}
          onSubmit={() => {
            saveNewAddress()
              .then((saved: boolean) => {
                if (saved) {
                  setShowResetConfirmation(false);
                  setHasJustReset(true);
                }
              })
              .catch(() => {
                // saveNewAddress keeps every failure in saveError.
              });
          }}
        />
      ) : (
        <></>
      )}
    </>,
  );
};

export default IncomingEmailTriggerPanel;

import { PagingMethodChoice } from "./PagingLadderMethods";
import { PAGING_LADDER_COPY } from "./PagingLadderWords";
import OnCallSetupApi, {
  AddedNumber,
  ProjectPhoneFacts,
} from "../../GuidedSetup/OnCall/OnCallSetupApi";
import {
  ON_CALL_SETUP_COPY,
  parsePhoneNumber,
} from "../../GuidedSetup/OnCall/OnCallSetup";
import {
  BROWSER_PUSH_PROBLEM_MESSAGES,
  BrowserPushError,
  BrowserPushProblem,
  getThisBrowserDeviceId,
} from "../../NotificationMethods/BrowserPushRegistration";
import MobileAppCodes from "../../NotificationMethods/MobileAppCodes";
import {
  SERVER_CANNOT_SEND_FIX_WORDS,
  ServerCannotSendChannel,
  getServerCannotSendFixUrl,
} from "../../NotificationMethods/ServerCannotSendPanel";
import {
  ChannelGatedMethodList,
  getChannelGatedMethodList,
} from "../../NotificationMethods/ProjectNotificationChannelsCopy";
import { VerificationCodeChannel } from "../../NotificationMethods/VerificationCodeChannels";
import VerificationCodeModal from "../../NotificationMethods/VerificationCodeModal";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Input from "Common/UI/Components/Input/Input";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import Toast from "Common/UI/Utils/Toast";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * ADD A WAY TO REACH YOU, FROM THE LADDER ITSELF (#7451).
 *
 * How to Reach Me named what is waiting for its code (Verify) and linked to
 * Notification Methods for everything else, so somebody with only their
 * email had to leave the page to add a phone and come back. Now, under
 * their own ladder, they can:
 *
 *   - add their phone: one number, one code, for SMS and phone calls - the
 *     on-call guided setup's step (OnCallSetupApi.addSmsNumber, then
 *     addCallNumber, which a number proven by text needs no second code
 *     for). Not offered while SMS is off in the project, which is said, nor
 *     while this server can't send SMS right now (GET /project-can-send,
 *     #9446): no code could reach the number, and that is said, with who
 *     can fix it;
 *   - use this browser: registered the one way Notification Methods and the
 *     guided setup register one (RegisterThisBrowser), from the click, so
 *     the browser can ask its permission;
 *   - get the app: the App Store and Google Play codes (MobileAppCodes),
 *     with a Recheck for once it is signed in.
 *
 * Each is offered only while it would add something - no phone number yet,
 * this browser not registered here, no app - and none while the server has
 * push turned off for push. After each the ladder is read again: a new
 * method gets its rules in every card as it is verified, as it always has,
 * and the steps show it, ready to be moved to its wait.
 */

export const ADD_WAYS_COPY: {
  addYourPhoneTitle: string;
  phoneAdded: string;
  phoneAsked: string;
  recheck: string;
} = {
  // A button's words, never a number: the phone guard reads a name ending in Title as such.
  addYourPhoneTitle: translationKey("Add your phone"),
  phoneAdded: translationKey(
    "Phone added. It can text and call you now: put it in your ladder.",
  ),
  // The project asks everyone on call for a phone method (#7449).
  phoneAsked: translationKey(
    "This project asks everyone on call to have a phone method.",
  ),
  recheck: translationKey("Recheck"),
};

/*
 * Add your phone while this server can't send SMS (#9446): the code that
 * adds a number could not reach it. Said as Notification Methods says it
 * over a list of numbers, and who can fix it. Not the guided setup's "email
 * and the app still reach you": the server may not send email either, and
 * the ladder above says so.
 */
export const PHONE_CODE_NOT_SENT_COPY: { member: string; admin: string } = {
  member: translationKey(
    "This server can't send SMS right now, so it can't text you a code to add your number. Ask your server's admin to set up SMS and calls.",
  ),
  admin: translationKey(
    "This server can't send SMS right now, so it can't text you a code to add your number. Set up SMS and calls in the Admin Dashboard.",
  ),
};

export interface ComponentProps {
  // The person's own methods, verified or waiting for a code.
  methods: ReadonlyArray<PagingMethodChoice>;
  isPushTurnedOff: boolean;
  // The project asks everyone on call for a phone method.
  isPhoneMethodRequired: boolean;
  /*
   * Whether this server can send SMS right now (GET /project-can-send):
   * false, and the phone's code could not be sent, so Add your phone says
   * why and who can fix it instead of asking for a number (#9446). Not
   * known, and the server decides.
   */
  canSendSms?: boolean | null | undefined;
  // A way was added: read the ladder again, keeping what is on screen.
  onAdded: () => void;
}

const PHONE_COLUMNS: ReadonlyArray<string> = [
  "userSmsId",
  "userCallId",
  "userWhatsAppId",
];

// What the person has, and so what is worth offering.
export interface WaysToOffer {
  isPhoneOffered: boolean;
  isBrowserOffered: boolean;
  isAppOffered: boolean;
  // No phone method yet, while the project asks for one.
  isPhoneAsked: boolean;
}

export const getWaysToOffer: (data: {
  methods: ReadonlyArray<PagingMethodChoice>;
  isPushTurnedOff: boolean;
  isPhoneMethodRequired: boolean;
  browserPushProblem: BrowserPushProblem | null;
  thisBrowserDeviceId: string | null;
}) => WaysToOffer = (data: {
  methods: ReadonlyArray<PagingMethodChoice>;
  isPushTurnedOff: boolean;
  isPhoneMethodRequired: boolean;
  browserPushProblem: BrowserPushProblem | null;
  thisBrowserDeviceId: string | null;
}): WaysToOffer => {
  // A number at all - one waiting for its code is offered its Verify instead.
  const hasPhoneNumber: boolean = data.methods.some(
    (method: PagingMethodChoice): boolean => {
      return PHONE_COLUMNS.includes(method.methodColumn);
    },
  );

  const hasVerifiedPhone: boolean = data.methods.some(
    (method: PagingMethodChoice): boolean => {
      return PHONE_COLUMNS.includes(method.methodColumn) && method.isVerified;
    },
  );

  const pushDevices: Array<PagingMethodChoice> = data.methods.filter(
    (method: PagingMethodChoice): boolean => {
      return method.methodColumn === "userPushId";
    },
  );

  const isThisBrowserRegistered: boolean = Boolean(
    data.thisBrowserDeviceId &&
      pushDevices.some((method: PagingMethodChoice): boolean => {
        return method.methodId === data.thisBrowserDeviceId;
      }),
  );

  // A phone with the OneUptime app: the device a push can ring as a critical alert on.
  const hasApp: boolean = pushDevices.some(
    (method: PagingMethodChoice): boolean => {
      return method.hasPushLevel;
    },
  );

  return {
    isPhoneOffered: !hasPhoneNumber,
    isBrowserOffered:
      !data.isPushTurnedOff &&
      !data.browserPushProblem &&
      !isThisBrowserRegistered,
    isAppOffered: !data.isPushTurnedOff && !hasApp,
    isPhoneAsked: data.isPhoneMethodRequired && !hasVerifiedPhone,
  };
};

const AddWaysToReach: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // Phone: the form, what is typed, the number waiting for its code.
  const [isPhoneFormOpen, setIsPhoneFormOpen] = useState<boolean>(false);
  const [phoneFacts, setPhoneFacts] = useState<ProjectPhoneFacts | null>(null);
  const [phoneText, setPhoneText] = useState<string>("");
  const [phoneError, setPhoneError] = useState<string>("");
  const [isSendingCode, setIsSendingCode] = useState<boolean>(false);
  const [phoneServerError, setPhoneServerError] = useState<string>("");
  const [verifying, setVerifying] = useState<{
    id: string;
    phone: string;
  } | null>(null);

  // Push: this browser being registered, what stopped it, the app's codes.
  const [isRegisteringBrowser, setIsRegisteringBrowser] =
    useState<boolean>(false);
  const [browserError, setBrowserError] = useState<{
    problem: BrowserPushProblem | null;
    message: string;
  } | null>(null);
  const [isAppCodesOpen, setIsAppCodesOpen] = useState<boolean>(false);

  const ways: WaysToOffer = getWaysToOffer({
    methods: props.methods,
    isPushTurnedOff: props.isPushTurnedOff,
    isPhoneMethodRequired: props.isPhoneMethodRequired,
    browserPushProblem: OnCallSetupApi.getBrowserPushProblem(),
    thisBrowserDeviceId: getThisBrowserDeviceId(
      ProjectUtil.getCurrentProjectId()?.toString(),
    ),
  });

  if (
    !ways.isPhoneOffered &&
    !ways.isBrowserOffered &&
    !ways.isAppOffered &&
    !ways.isPhoneAsked
  ) {
    return <></>;
  }

  // The project's SMS and call switches, read once the form is opened.
  const openPhoneForm: () => void = (): void => {
    setIsPhoneFormOpen(true);
    setPhoneServerError("");

    if (!phoneFacts) {
      OnCallSetupApi.loadProjectPhoneFacts()
        .then((facts: ProjectPhoneFacts) => {
          setPhoneFacts(facts);
        })
        .catch(() => {
          // Not known: the server decides.
        });
    }
  };

  // A number proven by text: the same number for calls needs no second code.
  const onPhoneVerified: (phone: string) => Promise<void> = async (
    phone: string,
  ): Promise<void> => {
    setVerifying(null);

    if (phoneFacts?.isCallOn !== false) {
      await OnCallSetupApi.addCallNumber(phone).catch(() => {
        // Calls refused (switched off since, say): SMS still pages.
        return null;
      });
    }

    setPhoneText("");
    setIsPhoneFormOpen(false);
    Toast.success(
      translator.translateText(ADD_WAYS_COPY.phoneAdded) ||
        ADD_WAYS_COPY.phoneAdded,
    );
    props.onAdded();
  };

  const sendCode: () => Promise<void> = async (): Promise<void> => {
    const phone: string | null = parsePhoneNumber(phoneText);

    if (!phone) {
      setPhoneError(
        translator.translateText(ON_CALL_SETUP_COPY.phoneError) || "",
      );
      return;
    }

    setPhoneError("");
    setPhoneServerError("");
    setIsSendingCode(true);

    try {
      const added: AddedNumber = await OnCallSetupApi.addSmsNumber(phone);

      if (added.isVerified) {
        await onPhoneVerified(phone);
      } else {
        setVerifying({ id: added.id, phone: phone });
      }
    } catch (err) {
      setPhoneServerError(API.getFriendlyMessage(err));
    }

    setIsSendingCode(false);
  };

  /*
   * Registered straight from the click: the browser's permission prompt
   * only opens for a page the person just used.
   */
  const registerBrowser: () => Promise<void> = async (): Promise<void> => {
    setBrowserError(null);
    setIsRegisteringBrowser(true);

    try {
      await OnCallSetupApi.registerThisBrowser();
      Toast.success(
        translator.translateText(ON_CALL_SETUP_COPY.browserRegistered) ||
          ON_CALL_SETUP_COPY.browserRegistered,
      );
      props.onAdded();
    } catch (err) {
      setBrowserError(
        err instanceof BrowserPushError
          ? { problem: err.problem, message: "" }
          : { problem: null, message: API.getFriendlyMessage(err) },
      );
    }

    setIsRegisteringBrowser(false);
  };

  const isSmsOff: boolean = phoneFacts?.isSmsOn === false;
  // The project has SMS on, but the server can't send it right now (#9446).
  const isSmsNotSentNow: boolean = !isSmsOff && props.canSendSms === false;
  const isMasterAdmin: boolean = Boolean(UserUtil.isMasterAdmin());

  return (
    <div className="flex flex-col gap-2" data-testid="paging-ladder-add-ways">
      {ways.isPhoneAsked ? (
        <p
          className="text-sm text-amber-700"
          data-testid="paging-ladder-phone-asked"
        >
          {translator.translateText(ADD_WAYS_COPY.phoneAsked)}
        </p>
      ) : (
        <></>
      )}
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {translator.translateTemplate(PAGING_LADDER_COPY.ownAddPlaceholder)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {ways.isPhoneOffered && !isPhoneFormOpen ? (
          <Button
            title={ADD_WAYS_COPY.addYourPhoneTitle}
            icon={IconProp.Phone}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId="paging-ladder-add-phone"
            onClick={openPhoneForm}
          />
        ) : (
          <></>
        )}
        {ways.isBrowserOffered ? (
          <Button
            title={ON_CALL_SETUP_COPY.useThisBrowser}
            icon={IconProp.Bell}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            isLoading={isRegisteringBrowser}
            dataTestId="paging-ladder-use-this-browser"
            onClick={() => {
              void registerBrowser();
            }}
          />
        ) : (
          <></>
        )}
        {ways.isAppOffered ? (
          <Button
            title={ON_CALL_SETUP_COPY.getTheApp}
            icon={IconProp.DevicePhoneMobile}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            ariaExpanded={isAppCodesOpen}
            ariaControls="paging-ladder-app-codes"
            dataTestId="paging-ladder-get-the-app"
            onClick={() => {
              setIsAppCodesOpen(!isAppCodesOpen);
            }}
          />
        ) : (
          <></>
        )}
      </div>

      {ways.isPhoneOffered && isPhoneFormOpen ? (
        isSmsOff ? (
          <p
            className="max-w-3xl text-sm text-gray-700"
            data-testid="paging-ladder-sms-off"
          >
            {translator.translateText(
              getChannelGatedMethodList(ChannelGatedMethodList.SMS).offSentence,
            )}
          </p>
        ) : isSmsNotSentNow ? (
          // No code could reach the number: said, and who can fix it.
          <div
            className="flex max-w-3xl flex-col items-start gap-1"
            data-testid="paging-ladder-sms-not-sent"
          >
            <p className="text-sm text-amber-700">
              {translator.translateText(
                isMasterAdmin
                  ? PHONE_CODE_NOT_SENT_COPY.admin
                  : PHONE_CODE_NOT_SENT_COPY.member,
              )}
            </p>
            {isMasterAdmin ? (
              <a
                href={getServerCannotSendFixUrl(
                  ServerCannotSendChannel.SMS,
                ).toString()}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-indigo-600 underline-offset-2 hover:text-indigo-800 hover:underline"
                data-testid="paging-ladder-set-up-sms"
              >
                {translator.translateText(
                  SERVER_CANNOT_SEND_FIX_WORDS[ServerCannotSendChannel.SMS],
                )}
              </a>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <form
            className="flex max-w-xl flex-col gap-2"
            data-testid="paging-ladder-phone-form"
            onSubmit={(event: React.FormEvent) => {
              event.preventDefault();
              void sendCode();
            }}
          >
            <label
              htmlFor="paging-ladder-phone"
              className="block text-sm font-medium text-gray-700"
            >
              {translator.translateText(ON_CALL_SETUP_COPY.phoneLabel)}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <Input
                  id="paging-ladder-phone"
                  value={phoneText}
                  placeholder="+15551234567"
                  // A phone's dial pad, and left to right on every page (#7180).
                  inputMode="tel"
                  onChange={(value: string) => {
                    setPhoneText(value);
                    setPhoneError("");
                  }}
                  error={phoneError || undefined}
                  disableSpellCheck={true}
                  dataTestId="paging-ladder-phone"
                />
              </div>
              <div className="flex flex-none items-center gap-2">
                <Button
                  title={ON_CALL_SETUP_COPY.sendSmsCode}
                  type={ButtonType.Submit}
                  buttonStyle={ButtonStyleType.NORMAL}
                  isLoading={isSendingCode}
                  dataTestId="paging-ladder-send-code"
                />
              </div>
            </div>
            {phoneServerError ? (
              <p
                role="alert"
                className="text-sm text-red-600"
                data-testid="paging-ladder-phone-error"
              >
                <ErrorInSentence message={phoneServerError} />
              </p>
            ) : (
              <></>
            )}
          </form>
        )
      ) : (
        <></>
      )}

      {browserError ? (
        <p
          role="alert"
          className="max-w-3xl text-sm text-red-600"
          data-testid="paging-ladder-browser-error"
        >
          {browserError.problem ? (
            translator.translateText(
              BROWSER_PUSH_PROBLEM_MESSAGES[browserError.problem],
            )
          ) : (
            <ErrorInSentence
              message={browserError.message}
              showWhereToLook={true}
            />
          )}
        </p>
      ) : (
        <></>
      )}

      {ways.isAppOffered && isAppCodesOpen ? (
        <div id="paging-ladder-app-codes" className="flex flex-col gap-2">
          <MobileAppCodes
            dataTestId="paging-ladder-app-codes"
            serverUrlDataTestId="paging-ladder-app-server-url"
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-sm text-gray-500">
              {translator.translateText(ON_CALL_SETUP_COPY.appRecheckHint)}
            </p>
            <Button
              title={ADD_WAYS_COPY.recheck}
              buttonStyle={ButtonStyleType.LINK}
              buttonSize={ButtonSize.Small}
              dataTestId="paging-ladder-app-recheck"
              onClick={() => {
                props.onAdded();
              }}
            />
          </div>
        </div>
      ) : (
        <></>
      )}

      {verifying ? (
        <VerificationCodeModal
          channel={VerificationCodeChannel.SMS}
          itemId={verifying.id}
          destination={verifying.phone}
          onClose={() => {
            setVerifying(null);
          }}
          onVerified={() => {
            void onPhoneVerified(verifying.phone);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default AddWaysToReach;

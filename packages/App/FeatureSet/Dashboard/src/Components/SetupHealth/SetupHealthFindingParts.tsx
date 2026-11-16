import { getAdminServerSetupUrl } from "../../Utils/ServerEmail";
import SetupHealthApi from "./SetupHealthApi";
import {
  SERVER_FIX_WORDS,
  SETUP_HEALTH_WORDS_PAGE,
  SetupHealthFixLink,
  SetupHealthSentenceValues,
  getSetupHealthFixLink,
  getSetupHealthSentence,
  getSetupHealthSentenceValues,
} from "./SetupHealthWords";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SetupHealthFinding,
  SetupHealthFix,
} from "Common/Types/SetupHealth/SetupHealth";
import Icon from "Common/UI/Components/Icon/Icon";
import { IconColorClasses } from "Common/UI/Components/Navbar/NavBarMenuModal";
import Link from "Common/UI/Components/Link/Link";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useState,
} from "react";

/*
 * ONE FINDING, DRAWN THE SAME WHEREVER IT IS SAID (#6812, #8135, #7297): on
 * the Setup Health page and in the line at the top of the record it is
 * about. Its icon in its level's colours, its sentence with the project's
 * names in bold, the button that opens its fix, and the dialog that
 * dismisses it for everyone - one of each, so the page and the line can
 * never say a finding two ways.
 */

/*
 * A finding's fix: the one obvious next step, so it looks like a button,
 * tinted as the product's links are.
 */
export const FIX_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1 text-sm font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200 transition hover:bg-indigo-100 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export const DISMISS_CLASS_NAME: string =
  "rounded text-sm text-gray-500 hover:text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

// The box a finding's icon sits in, tinted by its level.
const ICON_BOX_CLASS_NAME: string =
  "flex h-8 w-8 flex-none items-center justify-center rounded-lg ring-1 ring-inset";

// The icon of a finding, in a box of its level's colours.
export const FindingIcon: FunctionComponent<{
  icon: IconProp;
  colors: IconColorClasses;
}> = (props: { icon: IconProp; colors: IconColorClasses }): ReactElement => {
  return (
    <span
      aria-hidden="true"
      className={`${ICON_BOX_CLASS_NAME} ${props.colors.bg} ${props.colors.ring}`}
    >
      <Icon icon={props.icon} className={`h-4 w-4 ${props.colors.text}`} />
    </span>
  );
};

/*
 * A finding's sentence in the reader's language, the project's names in
 * bold. Only the names the sentence holds are drawn apart: a name it does
 * not hold would leave the sentence unable to draw whole.
 */
export const FindingSentence: FunctionComponent<{
  finding: SetupHealthFinding;
}> = (props: { finding: SetupHealthFinding }): ReactElement => {
  const sentence: SetupHealthSentenceValues = getSetupHealthSentenceValues(
    props.finding,
  );
  const slots: Record<string, ReactNode> = {};
  const values: SetupHealthSentenceValues["values"] = { ...sentence.values };

  for (const [key, name] of Object.entries(sentence.names)) {
    if (props.finding.words.includes(`{{${key}}}`)) {
      slots[key] = (
        <span
          className="font-semibold text-gray-900"
          data-testid="setup-health-name"
        >
          {name}
        </span>
      );
    } else {
      values[key] = name;
    }
  }

  return (
    <TranslatedSentence
      template={props.finding.words}
      slots={slots}
      values={values}
    />
  );
};

// The fix of one finding: its page, or for the server, its admin.
export const FindingFix: FunctionComponent<{
  finding: SetupHealthFinding;
}> = (props: { finding: SetupHealthFinding }): ReactElement => {
  const translator: Translator = useTranslator();
  const finding: SetupHealthFinding = props.finding;

  const onOpen: () => void = (): void => {
    ProductEvents.send(ProductEventName.SetupHealthFixOpened, {
      check: finding.check,
      level: finding.level,
    });
  };

  if (finding.fix === SetupHealthFix.ServerSettings) {
    if (!User.isMasterAdmin()) {
      return (
        <span
          className="text-sm text-gray-600"
          data-testid="setup-health-ask-admin"
        >
          {translator.translateText(SETUP_HEALTH_WORDS_PAGE.askServerAdmin)}
        </span>
      );
    }

    return (
      <Link
        to={getAdminServerSetupUrl()}
        openInNewTab={true}
        onClick={onOpen}
        className={FIX_CLASS_NAME}
        dataTestId="setup-health-fix"
      >
        {translator.translateText(SERVER_FIX_WORDS)}
        <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5 flex-none" />
      </Link>
    );
  }

  const fix: SetupHealthFixLink | null = getSetupHealthFixLink({
    finding: finding,
    translator: translator,
  });

  if (!fix) {
    return <></>;
  }

  return (
    <Link
      to={fix.route}
      onClick={onOpen}
      className={FIX_CLASS_NAME}
      dataTestId="setup-health-fix"
    >
      {fix.text}
      <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5 flex-none" />
    </Link>
  );
};

/*
 * Dismissing a finding: why, then hidden for everyone in the project until
 * somebody restores it from the Setup Health page's Dismissed.
 */
export const SetupHealthDismissModal: FunctionComponent<{
  finding: SetupHealthFinding;
  onClose: () => void;
  onDismissed: () => void;
}> = (props: {
  finding: SetupHealthFinding;
  onClose: () => void;
  onDismissed: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [reason, setReason] = useState<string>("");
  const [isDismissing, setIsDismissing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const confirm: () => Promise<void> = async (): Promise<void> => {
    setIsDismissing(true);
    setError("");

    try {
      await SetupHealthApi.dismiss({ finding: props.finding, reason: reason });

      ProductEvents.send(ProductEventName.SetupHealthFindingDismissed, {
        check: props.finding.check,
        has_reason: reason.trim().length > 0,
      });

      setIsDismissing(false);
      props.onDismissed();
    } catch (err) {
      setError(API.getFriendlyMessage(err as Error));
      setIsDismissing(false);
    }
  };

  return (
    <ConfirmModal
      title={SETUP_HEALTH_WORDS_PAGE.dismissTitle}
      description={
        <div className="space-y-2">
          <p className="text-sm text-gray-900">
            {getSetupHealthSentence(props.finding, translator)}
          </p>
          <p className="text-sm text-gray-500">
            {translator.translateText(
              SETUP_HEALTH_WORDS_PAGE.dismissDescription,
            )}
          </p>
        </div>
      }
      submitButtonText={SETUP_HEALTH_WORDS_PAGE.dismiss}
      isLoading={isDismissing}
      error={error || undefined}
      onSubmit={() => {
        void confirm();
      }}
      onClose={() => {
        if (!isDismissing) {
          props.onClose();
        }
      }}
    >
      <div className="mt-3 space-y-1">
        <label
          id="setup-health-dismiss-reason-label"
          htmlFor="setup-health-dismiss-reason"
          className="block text-sm font-medium text-gray-700"
        >
          {translator.translateText(SETUP_HEALTH_WORDS_PAGE.dismissReasonLabel)}{" "}
          <span className="font-normal text-gray-500">
            {translator.translateText("(Optional)")}
          </span>
        </label>
        <TextArea
          id="setup-health-dismiss-reason"
          value={reason}
          placeholder={SETUP_HEALTH_WORDS_PAGE.dismissPlaceholder}
          ariaLabelledby="setup-health-dismiss-reason-label"
          dataTestId="setup-health-dismiss-reason"
          autoGrow={true}
          rows={2}
          onChange={(value: string) => {
            setReason(value);
          }}
        />
      </div>
    </ConfirmModal>
  );
};

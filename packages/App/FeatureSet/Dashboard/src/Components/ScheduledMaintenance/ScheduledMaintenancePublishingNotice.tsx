import { PublishingNoticeCopy } from "./ScheduledMaintenancePublishing";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { PUBLISH_ON_STATUS_PAGE_AT_COLUMN } from "Common/Types/ScheduledMaintenance/ScheduledMaintenancePublication";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { useWriteDatesInSentenceLanguage } from "Common/UI/Utils/SentenceLanguage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useRef,
  useState,
} from "react";

/*
 * The band at the foot of a scheduled maintenance event's header while it is
 * kept to the team until its publish time (#5249): "Not on status pages
 * yet - It shows on its status pages from <time>", with Publish Now, which
 * asks first: publishing tells customers, and its subscribers hear that it
 * is scheduled at once. Publish Now clears the publish time, so the event is
 * published from that moment; moving the time is the Maintenance Details
 * card's Edit.
 *
 * Words and decisions: ScheduledMaintenancePublishing.
 */

export const PUBLISHING_NOTICE_TEST_ID: string =
  "scheduled-maintenance-publishing-notice";

export const PUBLISH_NOW_BUTTON_TEST_ID: string =
  "scheduled-maintenance-publish-now";

export interface ComponentProps {
  scheduledMaintenanceId: ObjectID;
  publishAt: Date;
  // Whether its subscribers are told it is scheduled when it is published.
  areSubscribersTold: boolean;
  // Called once the event is published, to read it again.
  onPublished: () => void;
}

// The time in the sentence, written in the sentence's language.
const PublishTime: FunctionComponent<{ date: Date }> = (props: {
  date: Date;
}): ReactElement => {
  const writeDates: <T>(write: () => T) => T =
    useWriteDatesInSentenceLanguage();

  return (
    <time
      dateTime={props.date.toISOString()}
      className="font-medium text-gray-900"
      data-testid="scheduled-maintenance-publish-at"
    >
      {writeDates((): string => {
        return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          props.date,
        );
      })}
    </time>
  );
};

const ScheduledMaintenancePublishingNotice: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const translator: Translator = useTranslator();
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const isPublishingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  /*
   * Publishing writes the publish time: someone who may not sees the
   * button locked, saying why; while the permissions are not known yet, no
   * button at all (PermissionGate).
   */
  const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    new ScheduledMaintenance(),
    PUBLISH_ON_STATUS_PAGE_AT_COLUMN,
    { sentence: PublishingNoticeCopy.noPermission },
  );

  const isButtonShown: boolean = gate.isAllowed || Boolean(gate.disabledReason);

  const publishNow: () => Promise<void> = async (): Promise<void> => {
    if (isPublishingRef.current) {
      return;
    }

    isPublishingRef.current = true;
    setIsPublishing(true);
    setError("");

    try {
      await ModelAPI.updateById<ScheduledMaintenance>({
        modelType: ScheduledMaintenance,
        id: props.scheduledMaintenanceId,
        data: {
          [PUBLISH_ON_STATUS_PAGE_AT_COLUMN]: null,
        },
      });

      setIsConfirming(false);
      props.onPublished();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    isPublishingRef.current = false;
    setIsPublishing(false);
  };

  return (
    <div
      data-testid={PUBLISHING_NOTICE_TEST_ID}
      className="flex flex-wrap items-start gap-x-2.5 gap-y-3"
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-600"
      >
        <Icon icon={IconProp.Clock} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-semibold text-gray-900">
          {translator.translateText(PublishingNoticeCopy.title)}
        </p>
        <p className="mt-0.5 text-sm text-gray-700">
          <TranslatedSentence
            template={
              props.areSubscribersTold
                ? PublishingNoticeCopy.showsFromAndTold
                : PublishingNoticeCopy.showsFrom
            }
            slots={{
              time: <PublishTime date={props.publishAt} />,
            }}
          />
        </p>
      </div>
      {isButtonShown ? (
        <Button
          title={PublishingNoticeCopy.publishNow}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          icon={IconProp.Globe}
          dataTestId={PUBLISH_NOW_BUTTON_TEST_ID}
          disabled={!gate.isAllowed}
          tooltip={gate.disabledReason}
          onClick={() => {
            if (!gate.isAllowed) {
              return;
            }

            setError("");
            setIsConfirming(true);
          }}
        />
      ) : (
        <></>
      )}
      {isConfirming ? (
        <ConfirmModal
          title={PublishingNoticeCopy.confirmTitle}
          description={
            props.areSubscribersTold
              ? PublishingNoticeCopy.confirmDescriptionAndTold
              : PublishingNoticeCopy.confirmDescription
          }
          submitButtonText={PublishingNoticeCopy.publishNow}
          submitButtonType={ButtonStyleType.PRIMARY}
          isLoading={isPublishing}
          error={error || undefined}
          onClose={() => {
            if (isPublishingRef.current) {
              return;
            }

            setIsConfirming(false);
            setError("");
          }}
          onSubmit={() => {
            publishNow().catch((err: unknown) => {
              setError(API.getFriendlyMessage(err));
            });
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default ScheduledMaintenancePublishingNotice;

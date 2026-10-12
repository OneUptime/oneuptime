import ProjectUtil from "Common/UI/Utils/Project";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import User from "Common/UI/Utils/User";
import UserCall from "Common/Models/DatabaseModels/UserCall";
import React, { ReactElement, useEffect, useState } from "react";
import OneUptimeDate from "Common/Types/Date";
import {
  NotificationMethodDeleteGuard,
  useNotificationMethodDeleteGuard,
} from "./NotificationMethod";
import NotificationChannelOffPanel from "./NotificationChannelOffPanel";
import {
  isAddingOffered,
  ProjectChannelState,
  useProjectChannelState,
} from "./ProjectNotificationChannels";
import {
  ChannelGatedMethodList,
  getChannelGatedMethodList,
  ProjectNotificationChannel,
} from "./ProjectNotificationChannelsCopy";
import VerificationCodeModal from "./VerificationCodeModal";
import {
  CALL_NUMBERS_VERIFIED_BY_SMS_EVENT,
  CallNumberVerifiedBySmsCopy,
  VerificationCodeChannel,
} from "./VerificationCodeChannels";

const Call: () => JSX.Element = (): ReactElement => {
  const translator: Translator = useTranslator();

  // The number whose verify dialog is open.
  const [verifyItem, setVerifyItem] = useState<UserCall | null>(null);

  // A number just added that its SMS verification had already verified.
  const [verifiedBySmsItem, setVerifiedBySmsItem] = useState<UserCall | null>(
    null,
  );

  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  /*
   * Verifying a number for SMS verifies the call numbers added for it
   * (UserCallService.verifyNumbersProvenBySms). The SMS list says when that
   * happened, and this list shows them as verified without a reload.
   */
  useEffect(() => {
    const onVerifiedBySms: () => void = (): void => {
      setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
    };

    GlobalEvents.addEventListener(
      CALL_NUMBERS_VERIFIED_BY_SMS_EVENT,
      onVerifiedBySms,
    );

    return () => {
      GlobalEvents.removeEventListener(
        CALL_NUMBERS_VERIFIED_BY_SMS_EVENT,
        onVerifiedBySms,
      );
    };
  }, []);

  /*
   * Whether the project has calls on. While they are off the server refuses
   * a new number and a code sent again, so the list offers no Add button
   * and the verify dialog says why it cannot call: the panel at the list's
   * top says so too, with the switch itself for those who may turn it on.
   */
  const channelState: ProjectChannelState = useProjectChannelState(
    ProjectNotificationChannel.Call,
  );
  const isChannelOff: boolean = channelState === ProjectChannelState.Off;

  /*
   * Deleting a phone number cascades to every notification rule that calls it,
   * so the confirmation is the impact modal rather than ModelTable's generic
   * one, and the built-in delete is switched off so there is only one way in.
   */
  const deleteGuard: NotificationMethodDeleteGuard<UserCall> =
    useNotificationMethodDeleteGuard<UserCall>({
      modelType: UserCall,
      relationName: "userCall",
      singularName: "Phone Number",
      onDeleted: () => {
        setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
      },
    });

  return (
    <>
      <ModelTable<UserCall>
        modelType={UserCall}
        userPreferencesKey={"user-call-table"}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId().toString(),
        }}
        filters={[]}
        refreshToggle={refreshToggle}
        onBeforeCreate={(model: UserCall): Promise<UserCall> => {
          model.projectId = ProjectUtil.getCurrentProjectId()!;
          model.userId = User.getUserId();
          return Promise.resolve(model);
        }}
        /*
         * Adding a number calls it with its code, so the next step - typing
         * the code in - opens straight away. A number already verified for
         * SMS comes back verified, with no call made: the list says so
         * instead of asking for a code that was never sent.
         */
        onCreateSuccess={(item: UserCall): Promise<UserCall> => {
          if (item.isVerified) {
            setVerifiedBySmsItem(item);
          } else {
            setVerifyItem(item);
          }

          return Promise.resolve(item);
        }}
        createVerb={"Add"}
        actionButtons={[
          {
            title: "Verify",
            buttonStyleType: ButtonStyleType.SUCCESS_OUTLINE,
            icon: IconProp.Check,
            /*
             * Entering the code is what an unverified row is waiting for, so
             * Verify is the row's button, whatever else the row offers.
             */
            placement: ActionButtonPlacement.Primary,
            isVisible: (item: UserCall): boolean => {
              if (item["isVerified"]) {
                return false;
              }

              return true;
            },
            /*
             * The one way to verify, and to get a new code: calling with
             * another one is in the dialog, next to the field it is for.
             */
            onClick: async (
              item: UserCall,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setVerifyItem(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
          deleteGuard.deleteActionButton,
        ]}
        id="user-call"
        name="User Settings > Notification Methods > Call"
        isDeleteable={false}
        isEditable={false}
        isCreateable={isAddingOffered(channelState)}
        topContent={
          <NotificationChannelOffPanel
            list={ChannelGatedMethodList.Call}
            state={channelState}
          />
        }
        cardProps={{
          title: "Phone Numbers for Call Notifications",
          description:
            "Manage Phone Numbers that will receive call notifications for this project. A number you have verified for SMS is verified for calls too, with no new code.",
        }}
        noItemsMessage={
          isChannelOff
            ? getChannelGatedMethodList(ChannelGatedMethodList.Call)
                .noItemsWhileOff
            : "No phone numbers found. Please add one to receive notifications."
        }
        formFields={[
          {
            field: {
              phone: true,
            },
            title: "Phone Number",
            fieldType: FormFieldSchemaType.Phone,
            required: true,
            placeholder: "+11234567890",
            validation: {
              minLength: 2,
            },
            disableSpellCheck: true,
          },
        ]}
        showRefreshButton={true}
        columns={[
          {
            field: {
              phone: true,
            },
            title: "Phone Number",
            type: FieldType.Phone,
          },
          {
            field: {
              isVerified: true,
            },
            title: "Verified",
            type: FieldType.Boolean,
          },
        ]}
      />

      {deleteGuard.deletionModal}

      {verifyItem ? (
        <VerificationCodeModal
          channel={VerificationCodeChannel.Call}
          itemId={verifyItem.id?.toString() || verifyItem._id || ""}
          destination={verifyItem.phone?.toString() || ""}
          onClose={() => {
            setVerifyItem(null);
          }}
          onVerified={() => {
            setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
          }}
        />
      ) : (
        <></>
      )}

      {verifiedBySmsItem ? (
        <ConfirmModal
          title={CallNumberVerifiedBySmsCopy.title}
          description={translator.translateTemplate(
            CallNumberVerifiedBySmsCopy.description,
            { destination: verifiedBySmsItem.phone?.toString() || "" },
          )}
          submitButtonText={"Close"}
          onSubmit={() => {
            setVerifiedBySmsItem(null);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default Call;

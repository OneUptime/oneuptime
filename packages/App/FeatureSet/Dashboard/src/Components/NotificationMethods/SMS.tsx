import ProjectUtil from "Common/UI/Utils/Project";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import User from "Common/UI/Utils/User";
import UserSMS from "Common/Models/DatabaseModels/UserSMS";
import React, { ReactElement, useState } from "react";
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
  VerificationCodeChannel,
} from "./VerificationCodeChannels";

const SMS: () => JSX.Element = (): ReactElement => {
  // The number whose verify dialog is open.
  const [verifyItem, setVerifyItem] = useState<UserSMS | null>(null);
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  /*
   * Whether the project has SMS on. While it is off the server refuses a
   * new number and a code sent again, so the list offers no Add button and
   * the verify dialog says why it cannot send one: the panel at the list's
   * top says so too, with the switch itself for those who may turn it on.
   */
  const channelState: ProjectChannelState = useProjectChannelState(
    ProjectNotificationChannel.SMS,
  );
  const isChannelOff: boolean = channelState === ProjectChannelState.Off;

  /*
   * Deleting a phone number cascades to every notification rule that uses it,
   * so the confirmation is the impact modal rather than ModelTable's generic
   * one, and the built-in delete is switched off so there is only one way in.
   */
  const deleteGuard: NotificationMethodDeleteGuard<UserSMS> =
    useNotificationMethodDeleteGuard<UserSMS>({
      modelType: UserSMS,
      relationName: "userSms",
      singularName: "Phone Number",
      onDeleted: () => {
        setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
      },
    });

  return (
    <>
      <ModelTable<UserSMS>
        modelType={UserSMS}
        userPreferencesKey={"user-sms-table"}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId().toString(),
        }}
        refreshToggle={refreshToggle}
        onBeforeCreate={(model: UserSMS): Promise<UserSMS> => {
          model.projectId = ProjectUtil.getCurrentProjectId()!;
          model.userId = User.getUserId();
          return Promise.resolve(model);
        }}
        /*
         * Adding a number sends its code, so the next step - typing it in -
         * opens straight away instead of waiting to be found behind Verify.
         * A number whose code could not be sent is not added at all: the
         * add form shows why.
         */
        onCreateSuccess={(item: UserSMS): Promise<UserSMS> => {
          if (!item.isVerified) {
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
            isVisible: (item: UserSMS): boolean => {
              if (item["isVerified"]) {
                return false;
              }

              return true;
            },
            /*
             * The one way to verify, and to get a new code: sending another
             * one is in the dialog, next to the field it is for, so nobody
             * has to guess whether Verify sends a code or Resend must come
             * first.
             */
            onClick: async (
              item: UserSMS,
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
        id="user-sms"
        name="User Settings > Notification Methods > SMS"
        isDeleteable={false}
        isEditable={false}
        isCreateable={isAddingOffered(channelState)}
        topContent={
          <NotificationChannelOffPanel
            list={ChannelGatedMethodList.SMS}
            state={channelState}
          />
        }
        cardProps={{
          title: "Phone Numbers for SMS Notifications",
          description:
            "Manage Phone Numbers that will receive SMS notifications for this project.",
        }}
        noItemsMessage={
          isChannelOff
            ? getChannelGatedMethodList(ChannelGatedMethodList.SMS)
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
        filters={[]}
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
          channel={VerificationCodeChannel.SMS}
          itemId={verifyItem.id?.toString() || verifyItem._id || ""}
          destination={verifyItem.phone?.toString() || ""}
          onClose={() => {
            setVerifyItem(null);
          }}
          onVerified={(result: JSONObject) => {
            setRefreshToggle(OneUptimeDate.getCurrentDate().toString());

            // The call numbers verified with it show as verified at once.
            if (Number(result["alsoVerifiedForCalls"] || 0) > 0) {
              GlobalEvents.dispatchEvent(CALL_NUMBERS_VERIFIED_BY_SMS_EVENT);
            }
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default SMS;

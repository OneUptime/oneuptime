import ProjectUtil from "Common/UI/Utils/Project";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import User from "Common/UI/Utils/User";
import UserIncomingCallNumber from "Common/Models/DatabaseModels/UserIncomingCallNumber";
import React, { ReactElement, useState } from "react";
import OneUptimeDate from "Common/Types/Date";
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
import { VerificationCodeChannel } from "./VerificationCodeChannels";

const IncomingCallNumber: () => JSX.Element = (): ReactElement => {
  // The number whose verify dialog is open.
  const [verifyItem, setVerifyItem] = useState<UserIncomingCallNumber | null>(
    null,
  );
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  /*
   * Numbers here are verified by text message, so the server refuses a new
   * one (and a code sent again) while the project has SMS off. The list then
   * offers no Add button and the verify dialog says why it cannot send one:
   * the panel at the list's top says so too, with the SMS switch itself for
   * those who may turn it on.
   */
  const channelState: ProjectChannelState = useProjectChannelState(
    ProjectNotificationChannel.SMS,
  );
  const isChannelOff: boolean = channelState === ProjectChannelState.Off;

  return (
    <>
      <ModelTable<UserIncomingCallNumber>
        modelType={UserIncomingCallNumber}
        userPreferencesKey={"user-incoming-call-number-table"}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId().toString(),
        }}
        refreshToggle={refreshToggle}
        onBeforeCreate={(
          model: UserIncomingCallNumber,
        ): Promise<UserIncomingCallNumber> => {
          model.projectId = ProjectUtil.getCurrentProjectId()!;
          model.userId = User.getUserId();
          return Promise.resolve(model);
        }}
        /*
         * Adding a number texts its code, so the next step - typing it in -
         * opens straight away. A number whose code could not be sent is not
         * added at all: the add form shows why.
         */
        onCreateSuccess={(
          item: UserIncomingCallNumber,
        ): Promise<UserIncomingCallNumber> => {
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
            isVisible: (item: UserIncomingCallNumber): boolean => {
              if (item["isVerified"]) {
                return false;
              }

              return true;
            },
            /*
             * The one way to verify, and to get a new code: sending another
             * one is in the dialog, next to the field it is for.
             */
            onClick: async (
              item: UserIncomingCallNumber,
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
        ]}
        id="user-incoming-call-number"
        name="User Settings > Incoming Call Policy > Phone Numbers"
        isDeleteable={true}
        isEditable={false}
        isCreateable={isAddingOffered(channelState)}
        topContent={
          <NotificationChannelOffPanel
            list={ChannelGatedMethodList.IncomingCallNumber}
            state={channelState}
          />
        }
        cardProps={{
          title: "Phone Numbers for Incoming Call Routing",
          description:
            "Manage Phone Numbers that will receive routed incoming calls for this project. Only one verified phone number is allowed per project.",
        }}
        noItemsMessage={
          isChannelOff
            ? getChannelGatedMethodList(
                ChannelGatedMethodList.IncomingCallNumber,
              ).noItemsWhileOff
            : "No phone numbers found. Please add one to receive routed incoming calls."
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

      {verifyItem ? (
        <VerificationCodeModal
          channel={VerificationCodeChannel.IncomingCallNumber}
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
    </>
  );
};

export default IncomingCallNumber;

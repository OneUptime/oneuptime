import ProjectUtil from "Common/UI/Utils/Project";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import User from "Common/UI/Utils/User";
import UserWhatsApp from "Common/Models/DatabaseModels/UserWhatsApp";
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
import { VerificationCodeChannel } from "./VerificationCodeChannels";

const WhatsApp: () => JSX.Element = (): ReactElement => {
  // The number whose verify dialog is open.
  const [verifyItem, setVerifyItem] = useState<UserWhatsApp | null>(null);
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  /*
   * Whether the project has WhatsApp on. While it is off the server refuses
   * a new number, so the list offers no Add button: the panel at its top
   * says so, with the switch itself for those who may turn it on.
   */
  const channelState: ProjectChannelState = useProjectChannelState(
    ProjectNotificationChannel.WhatsApp,
  );
  const isChannelOff: boolean = channelState === ProjectChannelState.Off;

  /*
   * Deleting a WhatsApp number cascades to every notification rule that uses
   * it, so the confirmation is the impact modal rather than ModelTable's
   * generic one, and the built-in delete is switched off so there is only one
   * way in.
   */
  const deleteGuard: NotificationMethodDeleteGuard<UserWhatsApp> =
    useNotificationMethodDeleteGuard<UserWhatsApp>({
      modelType: UserWhatsApp,
      relationName: "userWhatsApp",
      singularName: "WhatsApp Number",
      onDeleted: () => {
        setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
      },
    });

  return (
    <>
      <ModelTable<UserWhatsApp>
        modelType={UserWhatsApp}
        userPreferencesKey={"user-whatsapp-table"}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId().toString(),
        }}
        refreshToggle={refreshToggle}
        onBeforeCreate={(model: UserWhatsApp): Promise<UserWhatsApp> => {
          model.projectId = ProjectUtil.getCurrentProjectId()!;
          model.userId = User.getUserId();
          return Promise.resolve(model);
        }}
        /*
         * Adding a number sends its code, so the next step - typing it in -
         * opens straight away. A number whose code could not be sent is not
         * added at all: the add form shows why.
         */
        onCreateSuccess={(item: UserWhatsApp): Promise<UserWhatsApp> => {
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
             * Verifying is what an unverified row is waiting on, so Verify
             * is the row's button, whatever else the row offers.
             */
            placement: ActionButtonPlacement.Primary,
            isVisible: (item: UserWhatsApp): boolean => {
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
              item: UserWhatsApp,
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
        id="user-whatsapp"
        name="User Settings > Notification Methods > WhatsApp"
        isDeleteable={false}
        isEditable={false}
        isCreateable={isAddingOffered(channelState)}
        topContent={
          <NotificationChannelOffPanel
            list={ChannelGatedMethodList.WhatsApp}
            state={channelState}
          />
        }
        cardProps={{
          title: "WhatsApp Numbers for Notifications",
          description:
            "Manage WhatsApp numbers that will receive notifications for this project.",
        }}
        noItemsMessage={
          isChannelOff
            ? getChannelGatedMethodList(ChannelGatedMethodList.WhatsApp)
                .noItemsWhileOff
            : "No WhatsApp numbers found. Please add one to receive notifications."
        }
        formFields={[
          {
            field: {
              phone: true,
            },
            title: "WhatsApp Number",
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
            title: "WhatsApp Number",
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
          channel={VerificationCodeChannel.WhatsApp}
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

export default WhatsApp;

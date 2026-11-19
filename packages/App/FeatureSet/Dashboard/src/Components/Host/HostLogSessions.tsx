import HostLogSessionText from "./HostLogSessionText";
import HostLogSession from "Common/Models/DatabaseModels/HostLogSession";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import HostLogSessionUtil, {
  HOST_LOG_SESSION_DEFAULT_DURATION_MINUTES,
  HostLogSessionLevel,
  HostLogSessionStatus,
} from "Common/Types/Host/HostLogSession";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  hostId: ObjectID;
  // The session whose lines the logs below show, if one.
  shownSessionId?: string | undefined;
  onShowLines: (session: HostLogSession) => void;
}

/*
 * HOSTS > AN ANDROID DEVICE > LOGS: LOG SESSIONS (#9806). Android 13 and
 * later show other apps' log lines to the agent only for a while, when the
 * person at the device allows it. So the lines of every app are asked for
 * here, for 15 minutes to 4 hours; the device shows the request, Android
 * asks the person there, and the lines arrive in the logs below, tagged
 * with the session. Who asked, and when, is in the host's audit log.
 *
 * The list follows the device as it moves a session on (the model's
 * realtime events), so a request reads "Waiting for Approval", then
 * "Collecting", without Refresh.
 */
const HostLogSessions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ModelTable<HostLogSession>
      modelType={HostLogSession}
      id={`host-log-sessions-${props.hostId.toString()}`}
      name="Host > Logs > Log Sessions"
      userPreferencesKey="host-log-sessions"
      singularName="Log Session"
      pluralName="Log Sessions"
      createVerb="Request"
      createFormTitle="Request Log Session"
      createFormSubmitButtonText="Request"
      isCreateable={true}
      isEditable={false}
      isDeleteable={false}
      isViewable={false}
      query={{
        hostId: props.hostId,
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      sortBy="createdAt"
      sortOrder={SortOrder.Descending}
      initialItemsOnPage={5}
      cardProps={{
        title: "Log Sessions",
        description:
          "Every app's logs from this device for a while, for troubleshooting. Someone at the device allows each session, and the lines arrive in the logs below.",
      }}
      emptyState={{
        title: "No log sessions yet",
        description:
          "Request one to see every app's logs from this device. The device shows the request, and Android asks the person there to allow it.",
        icon: IconProp.Logs,
      }}
      createInitialValues={{
        durationMinutes: HOST_LOG_SESSION_DEFAULT_DURATION_MINUTES,
        minimumLevel: HostLogSessionLevel.Info,
      }}
      onBeforeCreate={async (item: HostLogSession): Promise<HostLogSession> => {
        item.hostId = props.hostId;
        item.projectId = ProjectUtil.getCurrentProjectId()!;
        return item;
      }}
      formFields={[
        {
          field: { durationMinutes: true },
          title: "Duration",
          description:
            "How long the device sends every app's logs, once someone there allows it.",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: HostLogSessionText.getDurationOptions(translator),
          required: true,
        },
        {
          field: { minimumLevel: true },
          title: "Lowest Level",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: HostLogSessionText.getLevelOptions(translator),
          required: true,
        },
      ]}
      selectMoreFields={{
        statusMessage: true,
        expiresAt: true,
        startedAt: true,
        endsAt: true,
        durationMinutes: true,
        minimumLevel: true,
        createdByUser: { name: true, email: true },
      }}
      actionButtons={[
        {
          title: "Show Lines",
          icon: IconProp.Logs,
          buttonStyleType: ButtonStyleType.NORMAL,
          isVisible: (item: HostLogSession): boolean => {
            return (
              HostLogSessionText.hasLines(item) &&
              item._id?.toString() !== props.shownSessionId
            );
          },
          onClick: (
            item: HostLogSession,
            onCompleteAction: VoidFunction,
          ): void => {
            props.onShowLines(item);
            onCompleteAction();
          },
        },
        {
          title: "Cancel Session",
          icon: IconProp.Close,
          buttonStyleType: ButtonStyleType.OUTLINE,
          isVisible: (item: HostLogSession): boolean => {
            return HostLogSessionUtil.isActive(item.status);
          },
          onClick: (
            item: HostLogSession,
            onCompleteAction: VoidFunction,
            onError: ErrorFunction,
          ): void => {
            ModelAPI.updateById<HostLogSession>({
              modelType: HostLogSession,
              id: new ObjectID(item._id!.toString()),
              data: {
                status: HostLogSessionStatus.Cancelled,
              } as JSONObject,
            })
              .then(() => {
                onCompleteAction();
              })
              .catch((err: Error) => {
                onError(new Error(API.getFriendlyMessage(err)));
              });
          },
        },
      ]}
      columns={[
        {
          field: { status: true },
          title: "Status",
          type: FieldType.Element,
          disableSort: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-[28rem]",
          getExportValue: (item: HostLogSession): string => {
            return HostLogSessionText.getStatusLabel(translator, item.status);
          },
          getElement: (item: HostLogSession): ReactElement => {
            const detail: string | undefined =
              HostLogSessionText.getStatusDetail(translator, item);

            return (
              <div className="space-y-1">
                <Pill
                  text={HostLogSessionText.getStatusLabel(
                    translator,
                    item.status,
                  )}
                  isUserContent={true}
                  tone={HostLogSessionText.getStatusTone(item.status)}
                />
                {detail ? (
                  <p className="text-sm text-gray-600">{detail}</p>
                ) : null}
              </div>
            );
          },
        },
        {
          field: { createdByUser: { name: true } },
          title: "Requested By",
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (item: HostLogSession): ReactElement => {
            const name: string =
              item.createdByUser?.name?.toString() ||
              item.createdByUser?.email?.toString() ||
              "";

            return name ? <span>{name}</span> : <TableEmptyValue />;
          },
        },
        {
          field: { createdAt: true },
          title: "Requested",
          type: FieldType.DateTime,
        },
        {
          field: { durationMinutes: true },
          title: "Duration",
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (item: HostLogSession): ReactElement => {
            return (
              <div>
                <p>
                  {HostLogSessionText.getDurationLabel(
                    translator,
                    item.durationMinutes ||
                      HOST_LOG_SESSION_DEFAULT_DURATION_MINUTES,
                  )}
                </p>
                <p className="text-sm text-gray-600">
                  {HostLogSessionText.getLevelLabel(
                    translator,
                    item.minimumLevel,
                  )}
                </p>
              </div>
            );
          },
        },
      ]}
      filters={[]}
      showRefreshButton={false}
    />
  );
};

export default HostLogSessions;

import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Query from "Common/Types/BaseDatabase/Query";
import ProjectUtil from "Common/UI/Utils/Project";
import TelemetryServiceElement from "../TelemetryService/TelemetryServiceElement";
import TelemetryExceptionElement from "./ExceptionElement";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import PageMap from "../../Utils/PageMap";
import User from "Common/Models/DatabaseModels/User";
import {
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BadDataException from "Common/Types/Exception/BadDataException";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import UserUtil from "Common/UI/Utils/User";

export interface ComponentProps {
  telemetryServiceId?: ObjectID | undefined;
  query: Query<TelemetryException>;
  title: string;
  description: string;
}

const TelemetryExceptionTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let viewRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.EXCEPTIONS_VIEW]!,
  );

  if (props.telemetryServiceId) {
    viewRoute = RouteUtil.populateRouteParams(
      RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_EXCEPTIONS]!,
      {
        modelId: props.telemetryServiceId,
      },
    );
  }

  return (
    <Fragment>
      <ModelTable<TelemetryException>
        modelType={TelemetryException}
        id="TelemetryException-table"
        isDeleteable={false}
        userPreferencesKey="telemetry-exception-table"
        isEditable={false}
        isCreateable={false}
        singularName="Exception"
        pluralName="Exceptions"
        name="TelemetryException"
        isViewable={true}
        sortBy="lastSeenAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: props.title,
          description: props.description,
        }}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          telemetryServiceId: props.telemetryServiceId
            ? props.telemetryServiceId
            : undefined,
          ...props.query,
        }}
        bulkActions={{
          buttons: [
            {
              title: "Resolve",
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (
                props: BulkActionOnClickProps<TelemetryException>,
              ) => {
                const inProgressItems: Array<TelemetryException> = [
                  ...props.items,
                ]; // items to be disabled
                const totalItems: Array<TelemetryException> = [...props.items]; // total items
                const successItems: Array<TelemetryException> = []; // items that are disabled
                const failedItems: Array<BulkActionFailed<TelemetryException>> =
                  []; // items that failed to disable

                props.onBulkActionStart();

                for (const exception of totalItems) {
                  // remove this item from inProgressItems

                  inProgressItems.splice(inProgressItems.indexOf(exception), 1);

                  try {
                    if (!exception.id) {
                      throw new BadDataException(
                        "Telemetry Exception ID not found",
                      );
                    }

                    if (!exception.isResolved) {
                      await ModelAPI.updateById<TelemetryException>({
                        id: exception.id,
                        modelType: TelemetryException,
                        data: {
                          isResolved: true,
                          markedAsResolvedAt: OneUptimeDate.getCurrentDate(),
                          markedAsResolvedByUserId:
                            UserUtil.getUserId() || null,
                        },
                      });
                    }

                    successItems.push(exception);
                  } catch (err) {
                    failedItems.push({
                      item: exception,
                      failedMessage: API.getFriendlyMessage(err),
                    });
                  }

                  props.onProgressInfo({
                    totalItems: totalItems,
                    failed: failedItems,
                    successItems: successItems,
                    inProgressItems: inProgressItems,
                  });
                }

                props.onBulkActionEnd();
              },

              icon: IconProp.Check,
              confirmTitle: (items: Array<TelemetryException>) => {
                return `Resolve ${items.length} Monitor(s)`;
              },
              confirmMessage: (items: Array<TelemetryException>) => {
                return `Are you sure you want to resolve ${items.length} exception(s)?`;
              },
            },
            {
              title: "Unresolve",
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (
                props: BulkActionOnClickProps<TelemetryException>,
              ) => {
                const inProgressItems: Array<TelemetryException> = [
                  ...props.items,
                ]; // items to be disabled
                const totalItems: Array<TelemetryException> = [...props.items]; // total items
                const successItems: Array<TelemetryException> = []; // items that are disabled
                const failedItems: Array<BulkActionFailed<TelemetryException>> =
                  []; // items that failed to disable

                props.onBulkActionStart();

                for (const exception of totalItems) {
                  // remove this item from inProgressItems

                  inProgressItems.splice(inProgressItems.indexOf(exception), 1);

                  try {
                    if (!exception.id) {
                      throw new BadDataException(
                        "Telemetry Exception ID not found",
                      );
                    }

                    if (exception.isResolved) {
                      await ModelAPI.updateById<TelemetryException>({
                        id: exception.id,
                        modelType: TelemetryException,
                        data: {
                          isResolved: false,
                          markedAsResolvedAt: null,
                          markedAsResolvedByUserId: null,
                        },
                      });
                    }

                    successItems.push(exception);
                  } catch (err) {
                    failedItems.push({
                      item: exception,
                      failedMessage: API.getFriendlyMessage(err),
                    });
                  }

                  props.onProgressInfo({
                    totalItems: totalItems,
                    failed: failedItems,
                    successItems: successItems,
                    inProgressItems: inProgressItems,
                  });
                }

                props.onBulkActionEnd();
              },

              icon: IconProp.Close,
              confirmTitle: (items: Array<TelemetryException>) => {
                return `Unresolve ${items.length} Monitor(s)`;
              },
              confirmMessage: (items: Array<TelemetryException>) => {
                return `Are you sure you want to unresolve ${items.length} exception(s)?`;
              },
            },

            // Archive action
            {
              title: "Archive",
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (
                props: BulkActionOnClickProps<TelemetryException>,
              ) => {
                const inProgressItems: Array<TelemetryException> = [
                  ...props.items,
                ]; // items to be disabled
                const totalItems: Array<TelemetryException> = [...props.items]; // total items
                const successItems: Array<TelemetryException> = []; // items that are disabled
                const failedItems: Array<BulkActionFailed<TelemetryException>> =
                  []; // items that failed to disable

                props.onBulkActionStart();

                for (const exception of totalItems) {
                  // remove this item from inProgressItems

                  inProgressItems.splice(inProgressItems.indexOf(exception), 1);

                  try {
                    if (!exception.id) {
                      throw new BadDataException(
                        "Telemetry Exception ID not found",
                      );
                    }

                    if (!exception.isArchived) {
                      await ModelAPI.updateById<TelemetryException>({
                        id: exception.id,
                        modelType: TelemetryException,
                        data: {
                          isArchived: true,
                          markedAsArchivedAt: OneUptimeDate.getCurrentDate(),
                          markedAsArchivedByUserId:
                            UserUtil.getUserId() || null,
                        },
                      });
                    }

                    successItems.push(exception);
                  } catch (err) {
                    failedItems.push({
                      item: exception,
                      failedMessage: API.getFriendlyMessage(err),
                    });
                  }

                  props.onProgressInfo({
                    totalItems: totalItems,
                    failed: failedItems,
                    successItems: successItems,
                    inProgressItems: inProgressItems,
                  });
                }

                props.onBulkActionEnd();
              },

              icon: IconProp.Archive,
              confirmTitle: (items: Array<TelemetryException>) => {
                return `Archive ${items.length} Monitor(s)`;
              },
              confirmMessage: (items: Array<TelemetryException>) => {
                return `Are you sure you want to archive ${items.length} exception(s)?`;
              },
            },
            {
              title: "Unarchive",
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (
                props: BulkActionOnClickProps<TelemetryException>,
              ) => {
                const inProgressItems: Array<TelemetryException> = [
                  ...props.items,
                ]; // items to be disabled
                const totalItems: Array<TelemetryException> = [...props.items]; // total items
                const successItems: Array<TelemetryException> = []; // items that are disabled
                const failedItems: Array<BulkActionFailed<TelemetryException>> =
                  []; // items that failed to disable

                props.onBulkActionStart();

                for (const exception of totalItems) {
                  // remove this item from inProgressItems

                  inProgressItems.splice(inProgressItems.indexOf(exception), 1);

                  try {
                    if (!exception.id) {
                      throw new BadDataException(
                        "Telemetry Exception ID not found",
                      );
                    }

                    if (exception.isArchived) {
                      await ModelAPI.updateById<TelemetryException>({
                        id: exception.id,
                        modelType: TelemetryException,
                        data: {
                          isArchived: false,
                          markedAsArchivedAt: null,
                          markedAsArchivedByUserId: null,
                        },
                      });
                    }

                    successItems.push(exception);
                  } catch (err) {
                    failedItems.push({
                      item: exception,
                      failedMessage: API.getFriendlyMessage(err),
                    });
                  }

                  props.onProgressInfo({
                    totalItems: totalItems,
                    failed: failedItems,
                    successItems: successItems,
                    inProgressItems: inProgressItems,
                  });
                }

                props.onBulkActionEnd();
              },

              icon: IconProp.Unarchive,
              confirmTitle: (items: Array<TelemetryException>) => {
                return `Unarchive ${items.length} Monitor(s)`;
              },
              confirmMessage: (items: Array<TelemetryException>) => {
                return `Are you sure you want to unarchive ${items.length} exception(s)?`;
              },
            },

            ModalTableBulkDefaultActions.Delete,
          ],
        }}
        showViewIdButton={false}
        noItemsMessage={"No exceptions found."}
        showRefreshButton={true}
        viewPageRoute={viewRoute}
        filters={[
          {
            field: {
              message: true,
            },
            title: "Exception Message",
            type: FieldType.Text,
          },
          {
            field: {
              stackTrace: true,
            },
            title: "Stack Trace",
            type: FieldType.Text,
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen At",
            type: FieldType.DateTime,
          },
          {
            field: {
              firstSeenAt: true,
            },
            title: "First Seen At",
            type: FieldType.DateTime,
          },
          {
            field: {
              isResolved: true,
            },
            title: "Resolved",
            type: FieldType.Boolean,
          },
          {
            field: {
              markedAsResolvedAt: true,
            },
            title: "Marked As Resolved At",
            type: FieldType.Date,
          },
          {
            field: {
              markedAsResolvedByUser: true,
            },
            title: "Marked As Resolved At",
            type: FieldType.EntityArray,
            filterEntityType: User,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              isArchived: true,
            },
            title: "Archived",
            type: FieldType.Boolean,
          },
          {
            field: {
              markedAsArchivedAt: true,
            },
            title: "Marked As Archived At",
            type: FieldType.Date,
          },
          {
            field: {
              markedAsArchivedByUser: true,
            },
            title: "Marked As Archived At",
            type: FieldType.EntityArray,
            filterEntityType: User,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        selectMoreFields={{
          isResolved: true,
          isArchived: true,
          exceptionType: true,
        }}
        columns={[
          {
            field: {
              message: true,
            },
            title: "Exception Message",
            contentClassName: "max-w-3xl whitespace-normal break-words",
            type: FieldType.Element,
            getElement: (exception: TelemetryException) => {
              return (
                <TelemetryExceptionElement
                  message={exception.message || exception.exceptionType || ""}
                  isResolved={exception.isResolved || false}
                  isArchived={exception.isArchived || false}
                  className={"max-w-3xl"}
                />
              );
            },
          },
          {
            field: {
              telemetryService: {
                name: true,
                serviceColor: true,
              },
            },
            title: "Service",
            type: FieldType.Entity,
            getElement: (exception: TelemetryException) => {
              if (!exception.telemetryService) {
                // this should never happen.
                return <div>Unknown</div>;
              }

              return (
                <TelemetryServiceElement
                  telemetryService={exception.telemetryService!}
                />
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen At",
            type: FieldType.DateTime,
          },
          {
            field: {
              occuranceCount: true,
            },
            title: "Occurances",
            type: FieldType.Number,
          },
        ]}
      />
    </Fragment>
  );
};

export default TelemetryExceptionTable;

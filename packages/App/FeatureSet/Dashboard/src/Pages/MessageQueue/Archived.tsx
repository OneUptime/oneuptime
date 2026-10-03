import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import User from "Common/Models/DatabaseModels/User";
import UserElement from "../../Components/User/User";
import AppLink from "../../Components/AppLink/AppLink";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import {
  MessageQueueBrokerLabel,
  getMessageQueueBrokerLabel,
  getMessageQueueSystemLabel,
} from "./Utils/MessageQueuePresentation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * Archived queues. A discovered queue that is not seen for a while is
 * archived automatically (autoArchivedAt set, "Archived By" empty) and comes
 * back on its own the next time its spans or broker metrics name it; one
 * archived by a person stays here until someone unarchives it — whatever
 * names it keeps attaching to the archived row rather than creating a new
 * queue.
 */
const MessageQueueArchivedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { unarchiveBulkActions } = useBulkArchiveActions<MessageQueue>({
    modelType: MessageQueue,
  });

  return (
    <Fragment>
      <ModelTable<MessageQueue>
        modelType={MessageQueue}
        id="message-queues-archived-table"
        userPreferencesKey="message-queues-archived-table"
        query={{
          isArchived: true,
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        bulkActions={{
          buttons: [...unarchiveBulkActions],
        }}
        name="Archived Queues"
        singularName="Queue"
        cardProps={{
          title: "Archived Queues",
          description:
            "Queues you archived, and discovered queues archived automatically after they stopped being seen. They are hidden from the main list; an automatically archived queue returns on its own when it is seen again. Select queues to unarchive them.",
        }}
        // As on the main list: the id is on the Overview, not worth a column.
        viewButtonText="View"
        noItemsMessage={"No archived queues."}
        showRefreshButton={true}
        onViewPage={(item: MessageQueue): Promise<Route> => {
          /*
           * A queue's page lives at /queues/<id>; the default view route
           * (this list's URL + /<id>) would be /queues/archived/<id>, which
           * no route matches.
           */
          return Promise.resolve(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.MESSAGE_QUEUE_VIEW] as Route,
              {
                modelId: new ObjectID(item._id as string),
              },
            ),
          );
        }}
        searchableFields={["name", "description", "destinationName"]}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
              destinationName: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: MessageQueue): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.MESSAGE_QUEUE_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              const name: string = (item.name as string) || "";
              const destination: string =
                (item.destinationName as string) || "";
              return (
                <div className="min-w-0">
                  <AppLink
                    to={route}
                    className="text-sm font-medium text-gray-900 truncate hover:underline"
                  >
                    {name || destination || "—"}
                  </AppLink>
                  {destination && destination !== name && (
                    <div className="text-xs text-gray-500 font-mono truncate">
                      {destination}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              messagingSystem: true,
            },
            title: "System",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: MessageQueue): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {getMessageQueueSystemLabel(item.messagingSystem)}
                </span>
              );
            },
          },
          {
            field: {
              brokerScope: true,
              brokerAddress: true,
            },
            title: "Broker",
            type: FieldType.Element,
            hideOnMobile: true,
            disableSort: true,
            getElement: (item: MessageQueue): ReactElement => {
              const broker: MessageQueueBrokerLabel =
                getMessageQueueBrokerLabel(item);
              if (!broker.text) {
                return <span className="text-gray-400">—</span>;
              }
              return (
                <span
                  className="text-sm text-gray-700 font-mono"
                  title={broker.title}
                >
                  {broker.text}
                </span>
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.DateTime,
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (item: MessageQueue): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              archivedAt: true,
            },
            title: "Archived At",
            type: FieldType.DateTime,
          },
          {
            field: {
              archivedByUser: {
                name: true,
                email: true,
                profilePictureId: true,
              },
              autoArchivedAt: true,
            },
            title: "Archived By",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: MessageQueue): ReactElement => {
              if (item["archivedByUser"]) {
                return <UserElement user={item["archivedByUser"] as User} />;
              }
              if (item.autoArchivedAt) {
                return (
                  <span className="text-sm text-gray-500">
                    {translator.translateText("Automatically (not seen)")}
                  </span>
                );
              }
              return <span className="text-gray-400">—</span>;
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default MessageQueueArchivedPage;

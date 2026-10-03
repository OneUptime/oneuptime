import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import MessageQueueOwnerTeam from "Common/Models/DatabaseModels/MessageQueueOwnerTeam";
import MessageQueueOwnerUser from "Common/Models/DatabaseModels/MessageQueueOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners, {
  ResourceFacet,
  buildEnumFacetQuery,
} from "../../Components/ResourceOwners/useResourceOwners";
import { FilterOperator } from "../../Components/ResourceOwners/FilterChipDropdown";
import IconProp from "Common/Types/Icon/IconProp";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { FilterChipDropdownOption } from "../../Components/ResourceOwners/FilterChipDropdownTypes";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import MessageQueueDocumentationCard from "./Utils/MessageQueueDocumentationCard";
import {
  MESSAGE_QUEUE_DESTINATION_DESCRIPTION,
  MESSAGE_QUEUE_NAMESPACE_DESCRIPTION,
  MESSAGE_QUEUE_OTHER_SYSTEM_DESCRIPTION,
  MESSAGE_QUEUE_OTHER_SYSTEM_FIELD,
  MESSAGE_QUEUE_OTHER_SYSTEM_VALUE,
  MessageQueueBrokerLabel,
  MessageQueueOption,
  getMessageQueueBrokerLabel,
  getMessageQueueCreateSystemOptions,
  getMessageQueueDestinationHint,
  getMessageQueueDiscoveryLabel,
  getMessageQueueDiscoverySourceOptions,
  getMessageQueueFormSystem,
  getMessageQueueLastSeenText,
  getMessageQueueNamespaceHint,
  getMessageQueueOtherSystemHint,
  getMessageQueueSystemFacetOptions,
  getMessageQueueSystemLabel,
  getMessagingSystemOptions,
  isNamespaceScopedMessagingSystem,
  toMessageQueueManualInput,
  validateMessageQueueDestination,
  validateMessageQueueNamespace,
  validateMessageQueueOtherSystem,
} from "./Utils/MessageQueuePresentation";

/*
 * Width caps for the two cells whose text can be long: a queue name is a
 * destination (an SQS URL's queue, a Pulsar persistent://tenant/ns/topic)
 * and a broker address can be a long host name. Wrapped within a cap, not
 * stretched across the table.
 */
export const MESSAGE_QUEUE_NAME_COLUMN_MAX_WIDTH_CLASS: string =
  "max-w-[16rem]";
export const MESSAGE_QUEUE_BROKER_COLUMN_MAX_WIDTH_CLASS: string =
  "max-w-[12rem]";

// The create form's System dropdown: the catalog, then "Other".
const CREATE_SYSTEM_OPTIONS: Array<MessageQueueOption> =
  getMessageQueueCreateSystemOptions();
const DISCOVERY_SOURCE_OPTIONS: Array<MessageQueueOption> =
  getMessageQueueDiscoverySourceOptions();

/**
 * The System facet's options: the catalog's systems, then every system
 * outside it that one of the project's live queues has — a long-tail
 * broker's spans create queues under the value they report, and those
 * queues must be filterable too. Only the rows of such systems are read, and
 * only live ones, as the table it filters lists (isArchived false): a system
 * whose queues are all archived would filter the table down to nothing. On a
 * failed read the catalog alone, as before.
 */
export async function fetchMessageQueueSystemFacetOptions(): Promise<
  Array<FilterChipDropdownOption>
> {
  try {
    const result: ListResult<MessageQueue> =
      await ModelAPI.getList<MessageQueue>({
        modelType: MessageQueue,
        query: {
          isArchived: false,
          messagingSystem: new IncludesNone(
            getMessagingSystemOptions().map(
              (option: MessageQueueOption): string => {
                return option.value;
              },
            ),
          ),
        },
        select: { messagingSystem: true },
        sort: {},
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      });
    return getMessageQueueSystemFacetOptions(
      (result.data || []).map((item: MessageQueue): string => {
        return (item.messagingSystem as string) || "";
      }),
    );
  } catch {
    return getMessagingSystemOptions();
  }
}

/*
 * The create form's hints, rendered under their fields: how a pasted URL /
 * ARN / resource path or a namespace host will be stored.
 */
function renderHint(
  hint: string | null,
  testId: string,
): ReactElement | undefined {
  if (!hint) {
    return undefined;
  }
  return (
    <p className="mt-1 text-xs text-gray-500" data-testid={testId}>
      {hint}
    </p>
  );
}

const MessageQueues: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string>("");

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<MessageQueue>({ modelType: MessageQueue });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<MessageQueue>({
      ownerUserModelType: MessageQueueOwnerUser,
      ownerTeamModelType: MessageQueueOwnerTeam,
      resourceIdField: "messageQueueId",
    });

  const { archiveBulkActions } = useBulkArchiveActions<MessageQueue>({
    modelType: MessageQueue,
  });

  const messageQueueExtraFacets: Array<ResourceFacet> = [
    {
      key: "messagingSystem",
      label: "System",
      icon: IconProp.QueueList,
      isMultiSelect: true,
      fetchOptions: fetchMessageQueueSystemFacetOptions,
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEnumFacetQuery(values, operator, true);
      },
    },
    {
      key: "discoverySource",
      label: "Discovered from",
      icon: IconProp.Search,
      isMultiSelect: true,
      options: DISCOVERY_SOURCE_OPTIONS,
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEnumFacetQuery(values, operator, true);
      },
    },
  ];

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<MessageQueue>({
    persistKey: "message-queues-table",
    ownerUserModelType: MessageQueueOwnerUser,
    ownerTeamModelType: MessageQueueOwnerTeam,
    resourceIdField: "messageQueueId",
    showLabelsFacet: true,
    extraFacets: messageQueueExtraFacets,
  });

  useEffect(() => {
    /*
     * Count first: the setup guide below the table is shown only while the
     * project has no queue at all, archived ones included.
     */
    ModelAPI.count({
      modelType: MessageQueue,
      query: {},
    })
      .then(setCount)
      .catch((err: Error) => {
        setError(API.getFriendlyMessage(err));
      });
  }, []);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (count === null) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <Fragment>
      <ModelTable<MessageQueue>
        modelType={MessageQueue}
        id="message-queues-table"
        userPreferencesKey="message-queues-table"
        isCreateable={true}
        singularName="Queue"
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<MessageQueue>) => {
          onResourcesFetched(data);
        }}
        onBeforeCreate={(
          item: MessageQueue,
          _miscDataProps: JSONObject,
          formValues?: JSONObject,
        ): Promise<MessageQueue> => {
          /*
           * The server derives everything that makes the row findable — the
           * normalized system and destination, the Azure namespace, the
           * identifier, the "manual" source and a default name — from what
           * is typed here. Only put the typed system in for "Other
           * messaging system", trim, drop a namespace the chosen system
           * does not use (a Service Bus namespace left behind after
           * switching to Kafka), and leave an empty name out so the server
           * names the queue after its destination like a discovered one.
           */
          if (item.messagingSystem === MESSAGE_QUEUE_OTHER_SYSTEM_VALUE) {
            item.messagingSystem = getMessageQueueFormSystem({
              messagingSystem: MESSAGE_QUEUE_OTHER_SYSTEM_VALUE,
              [MESSAGE_QUEUE_OTHER_SYSTEM_FIELD]:
                formValues?.[MESSAGE_QUEUE_OTHER_SYSTEM_FIELD],
            });
          }
          item.destinationName = String(item.destinationName || "").trim();
          if (isNamespaceScopedMessagingSystem(item.messagingSystem)) {
            item.brokerScope = String(item.brokerScope || "").trim();
          } else {
            delete item.brokerScope;
          }
          const name: string = String(item.name || "").trim();
          if (name) {
            item.name = name;
          } else {
            delete item.name;
          }
          return Promise.resolve(item);
        }}
        onCreateSuccess={(item: MessageQueue): Promise<MessageQueue> => {
          setCount((currentCount: number | null): number => {
            return (currentCount || 0) + 1;
          });
          return Promise.resolve(item);
        }}
        isDeleteable={false}
        isEditable={false}
        isViewable={true}
        showRefreshButton={true}
        // The Name links to the queue already; its id is on the Overview.
        viewButtonText="View"
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
        }}
        name="Queues"
        searchableFields={["name", "description", "destinationName"]}
        cardProps={{
          title: "Queues",
          description:
            "Every message queue, topic and subscription your applications publish to and consume from — discovered from their OpenTelemetry messaging spans and from your brokers' metrics, for Kafka, RabbitMQ, ActiveMQ, Amazon SQS and SNS, Google Pub/Sub, Azure Service Bus and Event Hubs, Pulsar, RocketMQ, NATS, BullMQ and more — or added by hand.",
        }}
        formSteps={[
          { title: "Messaging System", id: "messaging-system" },
          { title: "Queue Info", id: "queue-info" },
        ]}
        formFields={[
          {
            field: {
              messagingSystem: true,
            },
            title: "Messaging System",
            stepId: "messaging-system",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: CREATE_SYSTEM_OPTIONS,
            required: true,
            placeholder: "Select a messaging system",
            description:
              "The broker this queue lives on. Your spans name it in messaging.system. Not in the list? Choose Other messaging system and type that value.",
          },
          {
            /*
             * Not a MessageQueue column: the messaging.system value of a
             * broker the list does not know, which onBeforeCreate puts in
             * messagingSystem. overrideField keeps it out of the payload,
             * and showEvenIfPermissionDoesNotExist is needed because there
             * is no column to derive the field's permissions from.
             */
            overrideField: {
              [MESSAGE_QUEUE_OTHER_SYSTEM_FIELD]: true,
            },
            overrideFieldKey: MESSAGE_QUEUE_OTHER_SYSTEM_FIELD,
            showEvenIfPermissionDoesNotExist: true,
            title: "messaging.system Value",
            stepId: "messaging-system",
            fieldType: FormFieldSchemaType.Text,
            showIf: (values: FormValues<MessageQueue>): boolean => {
              return (
                values.messagingSystem === MESSAGE_QUEUE_OTHER_SYSTEM_VALUE
              );
            },
            required: (values: FormValues<MessageQueue>): boolean => {
              return (
                values.messagingSystem === MESSAGE_QUEUE_OTHER_SYSTEM_VALUE
              );
            },
            placeholder: "mqtt",
            description: MESSAGE_QUEUE_OTHER_SYSTEM_DESCRIPTION,
            // The server's own check, so a refusal is explained before sending.
            customValidation: (
              values: FormValues<MessageQueue>,
            ): string | null => {
              return validateMessageQueueOtherSystem(
                values as Record<string, unknown>,
              );
            },
            getFooterElement: (
              values: FormValues<MessageQueue>,
            ): ReactElement | undefined => {
              return renderHint(
                getMessageQueueOtherSystemHint(
                  values as Record<string, unknown>,
                ),
                "message-queue-other-system-hint",
              );
            },
          },
          {
            field: {
              destinationName: true,
            },
            title: "Destination",
            stepId: "messaging-system",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "orders.created",
            description: MESSAGE_QUEUE_DESTINATION_DESCRIPTION,
            /*
             * Checked here with the same resolution discovery and the
             * server apply, so a reply queue or a generated name is
             * explained before the form is sent.
             */
            customValidation: (
              values: FormValues<MessageQueue>,
            ): string | null => {
              return validateMessageQueueDestination(
                toMessageQueueManualInput(values as Record<string, unknown>),
              );
            },
            getFooterElement: (
              values: FormValues<MessageQueue>,
            ): ReactElement | undefined => {
              return renderHint(
                getMessageQueueDestinationHint(
                  toMessageQueueManualInput(values as Record<string, unknown>),
                ),
                "message-queue-destination-hint",
              );
            },
          },
          {
            field: {
              brokerScope: true,
            },
            title: "Namespace",
            stepId: "messaging-system",
            fieldType: FormFieldSchemaType.Text,
            // Only Azure Service Bus and Event Hubs key a queue on its namespace.
            showIf: (values: FormValues<MessageQueue>): boolean => {
              return isNamespaceScopedMessagingSystem(
                getMessageQueueFormSystem(values as Record<string, unknown>),
              );
            },
            /*
             * Optional even for them: spans from the emulator or through a
             * custom domain name no namespace, discovery keys them on a
             * queue without one (`servicebus||orders`), and the server
             * accepts that queue from a person too.
             */
            required: false,
            placeholder: "orders-prod",
            description: MESSAGE_QUEUE_NAMESPACE_DESCRIPTION,
            customValidation: (
              values: FormValues<MessageQueue>,
            ): string | null => {
              return validateMessageQueueNamespace(
                toMessageQueueManualInput(values as Record<string, unknown>),
              );
            },
            getFooterElement: (
              values: FormValues<MessageQueue>,
            ): ReactElement | undefined => {
              return renderHint(
                getMessageQueueNamespaceHint(
                  toMessageQueueManualInput(values as Record<string, unknown>),
                ),
                "message-queue-namespace-hint",
              );
            },
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "queue-info",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Order events",
            description:
              "Leave empty to name it after its destination, like a discovered queue.",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "queue-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Order events from checkout to fulfilment",
          },
          getLabelsFormField<MessageQueue>({
            stepId: "queue-info",
          }),
        ]}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
              destinationName: true,
            },
            title: "Name",
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: MESSAGE_QUEUE_NAME_COLUMN_MAX_WIDTH_CLASS,
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
                    className="text-sm font-medium text-gray-900 break-words hover:underline"
                  >
                    {name || destination || "—"}
                  </AppLink>
                  {/*
                   * A renamed queue still shows the destination its
                   * telemetry names — the name people grep their spans for.
                   */}
                  {destination && destination !== name && (
                    <div
                      data-testid="message-queue-name-destination"
                      className="truncate text-xs text-gray-500 font-mono"
                      title={destination}
                    >
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
            getElement: (item: MessageQueue): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {getMessageQueueSystemLabel(item.messagingSystem)}
                </span>
              );
            },
            getExportValue: (item: MessageQueue): string => {
              return getMessageQueueSystemLabel(item.messagingSystem);
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
            wrapContent: true,
            wrapMaxWidthClassName: MESSAGE_QUEUE_BROKER_COLUMN_MAX_WIDTH_CLASS,
            getElement: (item: MessageQueue): ReactElement => {
              const broker: MessageQueueBrokerLabel =
                getMessageQueueBrokerLabel(item);
              if (!broker.text) {
                return <span className="text-gray-400">—</span>;
              }
              return (
                <span
                  className="block truncate text-sm text-gray-700 font-mono"
                  title={broker.title}
                  data-testid="message-queue-broker"
                >
                  {broker.text}
                </span>
              );
            },
            getExportValue: (item: MessageQueue): string => {
              return getMessageQueueBrokerLabel(item).text;
            },
          },
          {
            field: {
              discoverySource: true,
            },
            title: "Discovered from",
            type: FieldType.Element,
            hideOnMobile: true,
            // Also a filter above the table.
            isHiddenByDefault: true,
            getElement: (item: MessageQueue): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {getMessageQueueDiscoveryLabel(item.discoverySource)}
                </span>
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.Element,
            // "5 minutes ago", the full time on hover.
            getElement: (item: MessageQueue): ReactElement => {
              const lastSeen: { text: string; title: string } =
                getMessageQueueLastSeenText(item.lastSeenAt);
              return (
                <span
                  className="text-sm text-gray-700"
                  title={lastSeen.title || undefined}
                  data-testid="message-queue-last-seen"
                >
                  {lastSeen.text}
                </span>
              );
            },
            getExportValue: (item: MessageQueue): string => {
              return item.lastSeenAt
                ? OneUptimeDate.getDateAsLocalFormattedString(item.lastSeenAt)
                : "";
            },
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
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            isHiddenByDefault: true,
            getElement: (item: MessageQueue): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        onViewPage={(item: MessageQueue): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.MESSAGE_QUEUE_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {count === 0 && (
        <MessageQueueDocumentationCard
          title="Getting Started with Queues"
          description="No queues yet. Queues appear here on their own as soon as your instrumented applications publish or consume messages, or when your broker's metrics reach OneUptime. Add one by hand above, or pick your messaging system below for its setup."
        />
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default MessageQueues;

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * The Queues list and the Archived list, rendered with ModelTable captured
 * so the props they hand it — query, create form, columns, facets, the
 * View target — are asserted directly, and every cell is rendered for real
 * from the columns the pages declare.
 */

interface CapturedField {
  field?: Record<string, unknown>;
  // A form-only input (not a MessageQueue column).
  overrideField?: Record<string, unknown>;
  overrideFieldKey?: string;
  showEvenIfPermissionDoesNotExist?: boolean;
  title?: string;
  description?: string;
  required?: boolean | ((values: Record<string, unknown>) => boolean);
  dropdownOptions?: Array<{ label: string; value: string }>;
  showIf?: (values: Record<string, unknown>) => boolean;
  customValidation?: (values: Record<string, unknown>) => string | null;
  getFooterElement?: (
    values: Record<string, unknown>,
  ) => React.ReactElement | undefined;
  fieldType?: string;
}

interface CapturedColumn {
  field: Record<string, unknown>;
  title: string;
  type: string;
  getElement?: (item: unknown) => React.ReactElement;
  getExportValue?: (item: unknown) => string;
  isHiddenByDefault?: boolean;
  wrapContent?: boolean;
  wrapMaxWidthClassName?: string;
}

interface CapturedTableProps {
  modelType: unknown;
  id: string;
  userPreferencesKey: string;
  query: Record<string, unknown>;
  isCreateable: boolean;
  isDeleteable: boolean;
  isEditable: boolean;
  isViewable: boolean;
  singularName?: string;
  name: string;
  searchableFields?: Array<string>;
  formFields?: Array<CapturedField>;
  columns: Array<CapturedColumn>;
  bulkActions?: { buttons: Array<unknown> };
  cardProps: { title: string; description: string };
  noItemsMessage?: string;
  viewPageRoute?: unknown;
  onViewPage: (item: unknown) => Promise<{ toString: () => string }>;
  onBeforeCreate?: (
    item: unknown,
    misc: unknown,
    formValues?: unknown,
  ) => Promise<unknown>;
  onCreateSuccess?: (item: unknown) => Promise<unknown>;
  onFetchSuccess?: (data: Array<unknown>) => void;
}

let tableProps: CapturedTableProps | null = null;
const countMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const useResourceOwnersMock: MockFunction = getJestMockFunction();
const onResourcesFetchedMock: MockFunction = getJestMockFunction();
const ownerActionsMock: MockFunction = getJestMockFunction();
const labelActionsMock: MockFunction = getJestMockFunction();
const archiveActionsMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      tableProps = props;
      return <div data-testid="model-table" />;
    },
  };
});

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueueDocumentationCard",
  () => {
    return {
      __esModule: true,
      default: (props: {
        title: string;
        description: string;
        queue?: unknown;
      }) => {
        return (
          <div
            data-testid="queue-docs-card"
            data-queue={props.queue ? "set" : "none"}
          >
            {props.title} | {props.description}
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FacetColumnQuery",
    ) as Record<string, unknown>;
    return {
      __esModule: true,
      buildEnumFacetQuery: actual["buildEnumFacetQuery"],
      default: (options: unknown) => {
        useResourceOwnersMock(options);
        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: (...args: Array<unknown>) => {
            return onResourcesFetchedMock(...args);
          },
          filterBar: <div data-testid="filter-bar" />,
          mergeFiltersIntoQuery: (query: unknown) => {
            return { ...(query as Record<string, unknown>), merged: true };
          },
          facetSaveState: undefined,
          restoreFacetState: () => {},
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnersCell",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <span data-testid="owners-cell" />;
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: (options: unknown) => {
      labelActionsMock(options);
      return { bulkActions: ["label-action"], modals: <></> };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: (options: unknown) => {
      ownerActionsMock(options);
      return { bulkActions: ["owner-action"], modals: <></> };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkArchiveActions", () => {
  return {
    __esModule: true,
    default: (options: unknown) => {
      archiveActionsMock(options);
      return {
        archiveBulkActions: ["archive-action"],
        unarchiveBulkActions: ["unarchive-action"],
      };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/User/User",
  () => {
    return {
      __esModule: true,
      default: (props: { user: { name?: string } }) => {
        return <span data-testid="user">{String(props.user.name)}</span>;
      },
    };
  },
);

import MessageQueues, {
  MESSAGE_QUEUE_BROKER_COLUMN_MAX_WIDTH_CLASS,
  MESSAGE_QUEUE_NAME_COLUMN_MAX_WIDTH_CLASS,
  fetchMessageQueueSystemFacetOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/MessageQueues";
import MessageQueueArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Archived";
import {
  MESSAGE_QUEUE_NAMESPACE_DESCRIPTION,
  MESSAGE_QUEUE_OTHER_SYSTEM_FIELD,
  MESSAGE_QUEUE_OTHER_SYSTEM_LABEL,
  MESSAGE_QUEUE_OTHER_SYSTEM_VALUE,
  getMessageQueueCreateSystemOptions,
  getMessageQueueDiscoveryLabel,
  getMessagingSystemOptions,
  previewManualMessageQueue,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueuePresentation";
import { resolveManualMessageQueue } from "../../../Types/MessageQueue/MessageQueueManualIdentity";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import MessageQueueOwnerTeam from "../../../Models/DatabaseModels/MessageQueueOwnerTeam";
import MessageQueueOwnerUser from "../../../Models/DatabaseModels/MessageQueueOwnerUser";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import {
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import {
  ResolvedMessagingDestination,
  resolveMessagingSpan,
} from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import ObjectID from "../../../Types/ObjectID";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import Validation from "../../../UI/Components/Forms/Validation";

const QUEUE_ID: string = "68fc0503-1d2e-4f3a-9b4c-5d6e7f8a9b0c";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/queues`),
  currentProject: null,
  hasPaymentMethod: true,
};

function queue(values: Partial<MessageQueue>): MessageQueue {
  const item: MessageQueue = new MessageQueue();
  item._id = QUEUE_ID;
  Object.assign(item, values);
  return item;
}

function column(title: string): CapturedColumn {
  const found: CapturedColumn | undefined = (tableProps?.columns || []).find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === title;
    },
  );
  if (!found) {
    throw new Error(`No "${title}" column.`);
  }
  return found;
}

function field(title: string): CapturedField {
  const found: CapturedField | undefined = (tableProps?.formFields || []).find(
    (candidate: CapturedField): boolean => {
      return candidate.title === title;
    },
  );
  if (!found) {
    throw new Error(`No "${title}" form field.`);
  }
  return found;
}

function renderCell(title: string, item: unknown): HTMLElement {
  const { container } = render(
    <MemoryRouter>{column(title).getElement!(item)}</MemoryRouter>,
  );
  return container;
}

async function renderList(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <MessageQueues {...PAGE_PROPS} />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  tableProps = null;
  countMock.mockReset();
  getListMock.mockReset();
  useResourceOwnersMock.mockReset();
  onResourcesFetchedMock.mockReset();
  ownerActionsMock.mockReset();
  labelActionsMock.mockReset();
  archiveActionsMock.mockReset();
  goTo(`/dashboard/${PROJECT_ID}/queues`);
});

afterEach(() => {
  cleanup();
});

describe("the Queues list: loading, errors and the setup guide", () => {
  test("counts first, behind a loader, and mounts no table until the count lands", async () => {
    countMock.mockReturnValue(new Promise<number>(() => {}));

    await renderList();

    expect(screen.queryByTestId("model-table")).not.toBeInTheDocument();
    expect(countMock).toHaveBeenCalledWith({
      modelType: MessageQueue,
      query: {},
    });
  });

  test("a failed count says why, with no table", async () => {
    countMock.mockRejectedValue(new Error("The API is down."));

    await renderList();

    expect(screen.getByText("The API is down.")).toBeInTheDocument();
    expect(screen.queryByTestId("model-table")).not.toBeInTheDocument();
  });

  test("an empty project keeps the table and shows the setup guide below it", async () => {
    countMock.mockResolvedValue(0);

    await renderList();

    const table: HTMLElement = screen.getByTestId("model-table");
    const guide: HTMLElement = screen.getByTestId("queue-docs-card");
    expect(
      table.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(guide).toHaveTextContent("Getting Started with Queues");
    expect(guide).toHaveTextContent("Add one by hand above");
    // The product guide, with its messaging-system picker: no queue of its own.
    expect(guide).toHaveAttribute("data-queue", "none");
  });

  test("a project with queues shows no guide", async () => {
    countMock.mockResolvedValue(3);

    await renderList();

    expect(screen.getByTestId("model-table")).toBeInTheDocument();
    expect(screen.queryByTestId("queue-docs-card")).not.toBeInTheDocument();
  });

  test("the first queue created by hand hides the guide at once", async () => {
    countMock.mockResolvedValue(0);

    await renderList();
    expect(screen.getByTestId("queue-docs-card")).toBeInTheDocument();

    const created: MessageQueue = queue({ name: "orders" });
    let returned: unknown = null;
    await act(async () => {
      returned = await tableProps!.onCreateSuccess!(created);
    });

    expect(returned).toBe(created);
    expect(screen.queryByTestId("queue-docs-card")).not.toBeInTheDocument();
  });
});

describe("the Queues list table", () => {
  beforeEach(async () => {
    countMock.mockResolvedValue(2);
    await renderList();
  });

  test("lists live queues, through the facet bar's filters", () => {
    expect(tableProps!.modelType).toBe(MessageQueue);
    expect(tableProps!.query).toEqual({ isArchived: false, merged: true });
    expect(tableProps!.id).toBe("message-queues-table");
    expect(tableProps!.userPreferencesKey).toBe("message-queues-table");
    expect(tableProps!.name).toBe("Queues");
    expect(tableProps!.cardProps.title).toBe("Queues");
    expect(tableProps!.cardProps.description).toContain(
      "discovered from their OpenTelemetry messaging spans",
    );
    expect(screen.getByTestId("model-table")).toBeInTheDocument();
  });

  test("creates queues by hand ('Create Queue') and views them, but never edits or deletes rows in place", () => {
    expect(tableProps!.isCreateable).toBe(true);
    expect(tableProps!.singularName).toBe("Queue");
    expect(tableProps!.isViewable).toBe(true);
    expect(tableProps!.isEditable).toBe(false);
    expect(tableProps!.isDeleteable).toBe(false);
  });

  test("searches name, description and destination", () => {
    expect(tableProps!.searchableFields).toEqual([
      "name",
      "description",
      "destinationName",
    ]);
  });

  test("offers label, owner and archive bulk actions on the queue owner models", () => {
    expect(tableProps!.bulkActions!.buttons).toEqual([
      "label-action",
      "owner-action",
      "archive-action",
    ]);
    expect(labelActionsMock).toHaveBeenCalledWith({ modelType: MessageQueue });
    expect(ownerActionsMock).toHaveBeenCalledWith({
      ownerUserModelType: MessageQueueOwnerUser,
      ownerTeamModelType: MessageQueueOwnerTeam,
      resourceIdField: "messageQueueId",
    });
    expect(archiveActionsMock).toHaveBeenCalledWith({
      modelType: MessageQueue,
    });
  });

  test("facets by owner, label, system and discovery source", () => {
    const options: Record<string, any> = useResourceOwnersMock.mock
      .calls[0]![0] as Record<string, any>;

    expect(options["persistKey"]).toBe("message-queues-table");
    expect(options["ownerUserModelType"]).toBe(MessageQueueOwnerUser);
    expect(options["ownerTeamModelType"]).toBe(MessageQueueOwnerTeam);
    expect(options["resourceIdField"]).toBe("messageQueueId");
    expect(options["showLabelsFacet"]).toBe(true);

    const facets: Array<Record<string, any>> = options["extraFacets"];
    expect(
      facets.map((facet: Record<string, any>): string => {
        return facet["key"];
      }),
    ).toEqual(["messagingSystem", "discoverySource"]);

    const system: Record<string, any> = facets[0]!;
    expect(system["label"]).toBe("System");
    expect(system["isMultiSelect"]).toBe(true);
    // Fetched: the catalog plus the project's systems outside it.
    expect(system["options"]).toBeUndefined();
    expect(system["fetchOptions"]).toBe(fetchMessageQueueSystemFacetOptions);
    const query: unknown = system["toQueryValue"](["kafka", "rabbitmq"], "is");
    expect(query).toBeInstanceOf(Includes);
    expect((query as Includes).values).toEqual(["kafka", "rabbitmq"]);

    const source: Record<string, any> = facets[1]!;
    expect(
      source["options"].map((option: { value: string }): string => {
        return option.value;
      }),
    ).toEqual(["traces", "broker-metrics", "manual"]);
  });

  test("the System facet offers the catalog, then every system outside it the project's queues have", async () => {
    getListMock.mockResolvedValue({
      data: [
        queue({ messagingSystem: "mqtt" }),
        queue({ messagingSystem: "ibmmq" }),
        queue({ messagingSystem: "mqtt" }),
        queue({ messagingSystem: "" }),
      ],
      count: 4,
    });

    const options: Array<{ label: string; value: string }> =
      await fetchMessageQueueSystemFacetOptions();

    expect(options).toEqual([
      ...getMessagingSystemOptions(),
      { label: "ibmmq", value: "ibmmq" },
      { label: "mqtt", value: "mqtt" },
    ]);
    // Only the rows of systems outside the catalog are read.
    const request: Record<string, any> = getListMock.mock
      .calls[0]![0] as Record<string, any>;
    expect(request["modelType"]).toBe(MessageQueue);
    expect(request["select"]).toEqual({ messagingSystem: true });
    expect(request["query"]["messagingSystem"]).toBeInstanceOf(IncludesNone);
    expect(
      [...(request["query"]["messagingSystem"] as IncludesNone).values].sort(),
    ).toEqual(
      getMessagingSystemOptions()
        .map((option: { value: string }): string => {
          return option.value;
        })
        .sort(),
    );
    // Picking one filters on the value its queues store.
    const facet: Record<string, any> = (
      useResourceOwnersMock.mock.calls[0]![0] as Record<string, any>
    )["extraFacets"][0]!;
    expect((facet["toQueryValue"](["mqtt"], "is") as Includes).values).toEqual([
      "mqtt",
    ]);

    // A failed read leaves the catalog, as before.
    getListMock.mockRejectedValue(new Error("boom"));
    expect(await fetchMessageQueueSystemFacetOptions()).toEqual(
      getMessagingSystemOptions(),
    );
  });

  /*
   * The facet filters a table of live queues (isArchived false): a system
   * whose queues are all archived would filter it down to nothing, and the
   * Archived list has no System facet to use it on.
   */
  test("the System facet leaves out a system whose queues are all archived, reading only what the table lists", async () => {
    const rows: Array<MessageQueue> = [
      queue({ messagingSystem: "mqtt", isArchived: false }),
      queue({ messagingSystem: "solace", isArchived: true }),
      queue({ messagingSystem: "ibmmq", isArchived: true }),
      queue({ messagingSystem: "ibmmq", isArchived: false }),
    ];
    // The API answers with the rows the query's isArchived matches.
    getListMock.mockImplementation((...args: Array<unknown>) => {
      const query: Record<string, unknown> = (
        args[0] as { query: Record<string, unknown> }
      ).query;
      const data: Array<MessageQueue> = rows.filter(
        (row: MessageQueue): boolean => {
          return (
            !Object.prototype.hasOwnProperty.call(query, "isArchived") ||
            row.isArchived === query["isArchived"]
          );
        },
      );
      return Promise.resolve({ data: data, count: data.length });
    });

    expect(await fetchMessageQueueSystemFacetOptions()).toEqual([
      ...getMessagingSystemOptions(),
      { label: "ibmmq", value: "ibmmq" },
      { label: "mqtt", value: "mqtt" },
    ]);

    // The rows the table itself lists.
    const request: Record<string, any> = getListMock.mock
      .calls[0]![0] as Record<string, any>;
    expect(request["query"]["isArchived"]).toBe(false);
    expect(tableProps!.query).toEqual({ isArchived: false, merged: true });
  });

  test("hands fetched rows to the owners lookup", () => {
    const rows: Array<MessageQueue> = [queue({ name: "orders" })];
    tableProps!.onFetchSuccess!(rows);
    expect(onResourcesFetchedMock).toHaveBeenCalledWith(rows);
  });

  test("View opens the queue's own page", async () => {
    const route: { toString: () => string } = await tableProps!.onViewPage(
      queue({}),
    );
    expect(route.toString()).toBe(
      `/dashboard/${PROJECT_ID}/queues/${QUEUE_ID}`,
    );
  });
});

describe("the Queues list columns", () => {
  beforeEach(async () => {
    countMock.mockResolvedValue(2);
    await renderList();
  });

  test("are Name, System, Broker, Discovered from, Last Seen, Labels and Owners", () => {
    expect(
      tableProps!.columns.map((candidate: CapturedColumn): string => {
        return candidate.title;
      }),
    ).toEqual([
      "Name",
      "System",
      "Broker",
      "Discovered from",
      "Last Seen",
      "Labels",
      "Owners",
    ]);
    expect(column("Discovered from").isHiddenByDefault).toBe(true);
    expect(column("Owners").isHiddenByDefault).toBe(true);
    expect(column("Labels").field).toEqual({
      labels: { name: true, color: true },
    });
  });

  test("the long cells wrap within a cap", () => {
    expect(column("Name").wrapContent).toBe(true);
    expect(column("Name").wrapMaxWidthClassName).toBe(
      MESSAGE_QUEUE_NAME_COLUMN_MAX_WIDTH_CLASS,
    );
    expect(column("Broker").wrapContent).toBe(true);
    expect(column("Broker").wrapMaxWidthClassName).toBe(
      MESSAGE_QUEUE_BROKER_COLUMN_MAX_WIDTH_CLASS,
    );
  });

  test("Name links to the queue and shows the destination a rename hid", () => {
    const container: HTMLElement = renderCell(
      "Name",
      queue({ name: "Order events", destinationName: "orders.created" }),
    );
    const link: HTMLElement = screen.getByRole("link", {
      name: "Order events",
    });
    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/queues/${QUEUE_ID}`,
    );
    expect(
      container.querySelector('[data-testid="message-queue-name-destination"]'),
    ).toHaveTextContent("orders.created");
  });

  test("Name shows no subtitle when the name is the destination", () => {
    const container: HTMLElement = renderCell(
      "Name",
      queue({ name: "orders", destinationName: "orders" }),
    );
    expect(
      container.querySelector('[data-testid="message-queue-name-destination"]'),
    ).toBeNull();
  });

  test("System reads the catalog's display name", () => {
    expect(
      renderCell("System", queue({ messagingSystem: "servicebus" })),
    ).toHaveTextContent("Azure Service Bus");
    cleanup();
    expect(
      renderCell("System", queue({ messagingSystem: "ibmmq" })),
    ).toHaveTextContent("ibmmq");
    expect(
      column("System").getExportValue!(queue({ messagingSystem: "aws_sqs" })),
    ).toBe("Amazon SQS");
  });

  test("Broker shows the namespace first, then the address, then a dash", () => {
    const namespaced: HTMLElement = renderCell(
      "Broker",
      queue({
        brokerScope: "shop-prod",
        brokerAddress: "shop-prod.servicebus.windows.net",
      }),
    );
    const cell: HTMLElement | null = namespaced.querySelector(
      '[data-testid="message-queue-broker"]',
    );
    expect(cell).toHaveTextContent("shop-prod");
    expect(cell).toHaveAttribute("title", "Azure namespace shop-prod");
    cleanup();

    expect(
      renderCell("Broker", queue({ brokerAddress: "kafka-1:9092" })),
    ).toHaveTextContent("kafka-1:9092");
    cleanup();

    expect(renderCell("Broker", queue({}))).toHaveTextContent("—");
    expect(
      column("Broker").getExportValue!(
        queue({ brokerAddress: "kafka-1:9092" }),
      ),
    ).toBe("kafka-1:9092");
  });

  test("Discovered from reads the model's labels", () => {
    expect(
      renderCell(
        "Discovered from",
        queue({ discoverySource: "broker-metrics" }),
      ),
    ).toHaveTextContent("Broker metrics");
  });

  test("Discovered from names a row without a source as the Overview does", () => {
    // The Overview's chip and detail row read the same helper.
    expect(
      renderCell("Discovered from", queue({ discoverySource: "" })),
    ).toHaveTextContent(getMessageQueueDiscoveryLabel(""));
    expect(getMessageQueueDiscoveryLabel("")).toBe("Unknown");
  });

  test("Last Seen is relative, and never for a queue nothing has seen", () => {
    const seen: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -3,
    );
    const container: HTMLElement = renderCell(
      "Last Seen",
      queue({ lastSeenAt: seen }),
    );
    const cell: HTMLElement | null = container.querySelector(
      '[data-testid="message-queue-last-seen"]',
    );
    expect(cell).toHaveTextContent(OneUptimeDate.fromNow(seen));
    expect(cell).toHaveAttribute(
      "title",
      OneUptimeDate.getDateAsLocalFormattedString(seen),
    );
    cleanup();

    expect(renderCell("Last Seen", queue({}))).toHaveTextContent("Never");
    expect(column("Last Seen").getExportValue!(queue({}))).toBe("");
  });

  test("Owners renders the owners cell", () => {
    expect(
      renderCell("Owners", queue({})).querySelector(
        '[data-testid="owners-cell"]',
      ),
    ).not.toBeNull();
  });
});

/*
 * The create form's fields named after their model field (or, for a
 * form-only input, its override key), the way BasicForm validates them.
 */
function namedFormFields(): Array<Field<MessageQueue>> {
  return (tableProps!.formFields || []).map(
    (formField: CapturedField): Field<MessageQueue> => {
      return {
        name: Object.keys(formField.field || formField.overrideField || {})[0]!,
        ...formField,
      } as unknown as Field<MessageQueue>;
    },
  );
}

describe("the create form", () => {
  beforeEach(async () => {
    countMock.mockResolvedValue(2);
    await renderList();
  });

  /*
   * A broker the catalog does not know (MQTT, IBM MQ, Sidekiq...) still
   * creates queues from its spans, under the messaging.system value they
   * report — and one whose spans are too few for discovery to create it
   * must be addable by hand, under that same value.
   */
  test("'Other messaging system' asks for the messaging.system value, and checks it as the server does", () => {
    const other: CapturedField = field("messaging.system Value");
    expect(other.overrideField).toEqual({
      [MESSAGE_QUEUE_OTHER_SYSTEM_FIELD]: true,
    });
    expect(other.overrideFieldKey).toBe(MESSAGE_QUEUE_OTHER_SYSTEM_FIELD);
    expect(other.showEvenIfPermissionDoesNotExist).toBe(true);

    const chosen: Record<string, unknown> = {
      messagingSystem: MESSAGE_QUEUE_OTHER_SYSTEM_VALUE,
    };
    expect(other.showIf!(chosen)).toBe(true);
    expect(other.showIf!({ messagingSystem: "kafka" })).toBe(false);
    const required: CapturedField["required"] = other.required;
    expect(typeof required === "function" && required(chosen)).toBe(true);
    expect(
      typeof required === "function" && required({ messagingSystem: "kafka" }),
    ).toBe(false);

    // The server's own refusal, word for word.
    const refusal: string | null = other.customValidation!({
      ...chosen,
      [MESSAGE_QUEUE_OTHER_SYSTEM_FIELD]: "Not A System",
    });
    expect(refusal).toContain('"Not A System" is not a messaging system.');
    expect(() => {
      resolveManualMessageQueue({
        messagingSystem: "Not A System",
        destinationName: "orders",
      });
    }).toThrow(refusal!);
    expect(
      other.customValidation!({
        ...chosen,
        [MESSAGE_QUEUE_OTHER_SYSTEM_FIELD]: "spring_integration",
      }),
    ).toContain("does not name a message broker");
    expect(
      other.customValidation!({
        ...chosen,
        [MESSAGE_QUEUE_OTHER_SYSTEM_FIELD]: "mqtt",
      }),
    ).toBeNull();

    // How a typed value is stored, when not as typed.
    const hint: React.ReactElement | undefined = other.getFooterElement!({
      ...chosen,
      [MESSAGE_QUEUE_OTHER_SYSTEM_FIELD]: "AmazonSQS",
    });
    render(<>{hint}</>);
    expect(
      screen.getByTestId("message-queue-other-system-hint"),
    ).toHaveTextContent('Saved as "aws_sqs", Amazon SQS.');
    expect(
      other.getFooterElement!({
        ...chosen,
        [MESSAGE_QUEUE_OTHER_SYSTEM_FIELD]: "mqtt",
      }),
    ).toBeUndefined();
  });

  test("an 'Other' queue validates end to end and is sent under the typed system, the queue its spans key on", async () => {
    const values: Record<string, unknown> = {
      messagingSystem: MESSAGE_QUEUE_OTHER_SYSTEM_VALUE,
      [MESSAGE_QUEUE_OTHER_SYSTEM_FIELD]: " mqtt ",
      destinationName: "sensors/temperature",
    };
    expect(
      Validation.validate<MessageQueue>({
        formFields: namedFormFields(),
        values: values as FormValues<MessageQueue>,
        onValidate: undefined,
      }),
    ).toEqual({});

    const sent: MessageQueue = (await tableProps!.onBeforeCreate!(
      queue({
        messagingSystem: MESSAGE_QUEUE_OTHER_SYSTEM_VALUE,
        destinationName: "sensors/temperature",
      }),
      {},
      values,
    )) as MessageQueue;
    expect(sent.messagingSystem).toBe("mqtt");

    const attributes: Map<string, string> = new Map<string, string>([
      ["messaging.system", "mqtt"],
      ["messaging.destination.name", "sensors/temperature"],
    ]);
    const span: ResolvedMessagingDestination | null = resolveMessagingSpan({
      getAttribute: (key: string): unknown => {
        return attributes.get(key);
      },
      kind: "SPAN_KIND_PRODUCER",
    });
    expect(
      resolveManualMessageQueue({
        messagingSystem: sent.messagingSystem,
        destinationName: sent.destinationName,
      }).queueIdentifier,
    ).toBe(
      buildMessageQueueIdentifier(
        toMessageQueueIdentity({
          system: span!.system,
          brokerScope: span!.brokerScope,
          destination: span!.destination,
        })!,
      ),
    );
  });

  test("the destination and namespace are judged under the typed system", () => {
    const other: Record<string, unknown> = {
      messagingSystem: MESSAGE_QUEUE_OTHER_SYSTEM_VALUE,
    };
    // A system typed by its alias is still namespace-scoped.
    expect(
      field("Namespace").showIf!({
        ...other,
        [MESSAGE_QUEUE_OTHER_SYSTEM_FIELD]: "azure_servicebus",
      }),
    ).toBe(true);
    expect(
      field("Namespace").showIf!({
        ...other,
        [MESSAGE_QUEUE_OTHER_SYSTEM_FIELD]: "mqtt",
      }),
    ).toBe(false);
    expect(
      field("Destination").customValidation!({
        ...other,
        [MESSAGE_QUEUE_OTHER_SYSTEM_FIELD]: "rabbitmq",
        destinationName: "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
      }),
    ).toContain("cannot be a queue");
  });

  test("asks for the system, destination, namespace, name, description and labels", () => {
    expect(
      (tableProps!.formFields || []).map((candidate: CapturedField): string => {
        return candidate.title || "";
      }),
    ).toEqual([
      "Messaging System",
      "messaging.system Value",
      "Destination",
      "Namespace",
      "Name",
      "Description",
      "Labels",
    ]);
    expect(field("Messaging System").field).toEqual({ messagingSystem: true });
    expect(field("Destination").field).toEqual({ destinationName: true });
    expect(field("Namespace").field).toEqual({ brokerScope: true });
  });

  test("the system dropdown is the catalog's systems, then Other, and required", () => {
    expect(field("Messaging System").dropdownOptions).toEqual(
      getMessageQueueCreateSystemOptions(),
    );
    expect(field("Messaging System").dropdownOptions).toEqual([
      ...getMessagingSystemOptions(),
      {
        label: MESSAGE_QUEUE_OTHER_SYSTEM_LABEL,
        value: MESSAGE_QUEUE_OTHER_SYSTEM_VALUE,
      },
    ]);
    expect(field("Messaging System").required).toBe(true);
    expect(field("Destination").required).toBe(true);
    expect(field("Name").required).toBe(false);
  });

  test.each([
    ["servicebus", true],
    ["eventhubs", true],
    ["azure_servicebus", true],
    ["kafka", false],
    ["eventgrid", false],
    ["", false],
  ])(
    "the namespace is asked for %p: %p, and never required",
    (system: string, asked: boolean) => {
      const namespace: CapturedField = field("Namespace");
      expect(namespace.showIf!({ messagingSystem: system })).toBe(asked);
      const required: CapturedField["required"] = namespace.required;
      expect(
        typeof required === "function"
          ? required({ messagingSystem: system })
          : Boolean(required),
      ).toBe(false);
    },
  );

  /*
   * Spans from the Service Bus emulator or through a custom domain name no
   * namespace host, so discovery keys them on `servicebus||orders`; the
   * server accepts that queue from a person too (the shared manual check,
   * MessageQueueManualIdentity.test). The form must let it through.
   */
  test("a Service Bus queue without a namespace can be added: the queue the emulator's spans key on", async () => {
    const values: FormValues<MessageQueue> = {
      messagingSystem: "servicebus",
      destinationName: "orders",
      brokerScope: "",
    };
    const formFields: Array<Field<MessageQueue>> = namedFormFields();
    expect(
      Validation.validate<MessageQueue>({
        formFields,
        values,
        onValidate: undefined,
      }),
    ).toEqual({});

    const sent: MessageQueue = (await tableProps!.onBeforeCreate!(
      queue({ ...values, name: "" } as Partial<MessageQueue>),
      {},
    )) as MessageQueue;
    expect(sent.brokerScope).toBe("");

    const attributes: Map<string, string> = new Map<string, string>([
      ["messaging.system", "servicebus"],
      ["messaging.destination.name", "orders"],
      ["server.address", "localhost"],
    ]);
    const emulatorSpan: ResolvedMessagingDestination | null =
      resolveMessagingSpan({
        getAttribute: (key: string): unknown => {
          return attributes.get(key);
        },
        kind: "SPAN_KIND_PRODUCER",
      });
    expect(emulatorSpan).not.toBeNull();
    const spanIdentity: MessageQueueIdentity | null = toMessageQueueIdentity({
      system: emulatorSpan!.system,
      brokerScope: emulatorSpan!.brokerScope,
      destination: emulatorSpan!.destination,
    });
    expect(buildMessageQueueIdentifier(spanIdentity!)).toBe(
      "servicebus||orders",
    );
    expect(
      previewManualMessageQueue({
        messagingSystem: sent.messagingSystem,
        destinationName: sent.destinationName,
        brokerScope: sent.brokerScope,
      })?.queueIdentifier,
    ).toBe("servicebus||orders");

    // The field says when to leave it empty, and what that costs.
    expect(field("Namespace").description).toBe(
      MESSAGE_QUEUE_NAMESPACE_DESCRIPTION,
    );
    expect(MESSAGE_QUEUE_NAMESPACE_DESCRIPTION).toContain(
      "Leave it empty only for a queue your applications reach through the emulator or a custom domain",
    );
    expect(MESSAGE_QUEUE_NAMESPACE_DESCRIPTION).toContain(
      "Azure Monitor's metrics never reach such a queue",
    );
  });

  test("the destination is checked the way the server checks it", () => {
    const destination: CapturedField = field("Destination");
    expect(
      destination.customValidation!({
        messagingSystem: "kafka",
        destinationName: "orders",
      }),
    ).toBeNull();
    expect(
      destination.customValidation!({
        messagingSystem: "rabbitmq",
        destinationName: "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
      }),
    ).toContain("cannot be a queue");
  });

  test("the namespace is checked the way the server checks it", () => {
    const namespace: CapturedField = field("Namespace");
    expect(
      namespace.customValidation!({
        messagingSystem: "servicebus",
        brokerScope: "my namespace",
      }),
    ).toContain("is not an Azure namespace name");
    expect(
      namespace.customValidation!({
        messagingSystem: "servicebus",
        brokerScope: "shop-prod",
      }),
    ).toBeNull();
  });

  test("the hints show how a pasted value will be stored", () => {
    const destinationHint: React.ReactElement | undefined = field("Destination")
      .getFooterElement!({
      messagingSystem: "aws_sqs",
      destinationName:
        "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
    });
    render(<>{destinationHint}</>);
    expect(
      screen.getByTestId("message-queue-destination-hint"),
    ).toHaveTextContent('Saved as "orders"');

    const namespaceHint: React.ReactElement | undefined = field("Namespace")
      .getFooterElement!({
      messagingSystem: "servicebus",
      brokerScope: "shop-prod.servicebus.windows.net",
    });
    render(<>{namespaceHint}</>);
    expect(
      screen.getByTestId("message-queue-namespace-hint"),
    ).toHaveTextContent('Saved as "shop-prod".');

    expect(
      field("Destination").getFooterElement!({
        messagingSystem: "kafka",
        destinationName: "orders",
      }),
    ).toBeUndefined();
  });

  test("before sending, it trims, drops an unused namespace and leaves an empty name to the server", async () => {
    const kafka: MessageQueue = queue({
      messagingSystem: "kafka",
      destinationName: "  orders  ",
      brokerScope: "left-over-namespace",
      name: "   ",
    });
    const sent: MessageQueue = (await tableProps!.onBeforeCreate!(
      kafka,
      {},
    )) as MessageQueue;

    expect(sent.destinationName).toBe("orders");
    expect(sent.brokerScope).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(sent, "brokerScope")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(sent, "name")).toBe(false);
  });

  test("before sending, it keeps a trimmed namespace and name for Service Bus", async () => {
    const serviceBus: MessageQueue = queue({
      messagingSystem: "servicebus",
      destinationName: "orders",
      brokerScope: " shop-prod ",
      name: " Order events ",
    });
    const sent: MessageQueue = (await tableProps!.onBeforeCreate!(
      serviceBus,
      {},
    )) as MessageQueue;

    expect(sent.brokerScope).toBe("shop-prod");
    expect(sent.name).toBe("Order events");
  });
});

describe("the Archived list", () => {
  async function renderArchived(): Promise<void> {
    goTo(`/dashboard/${PROJECT_ID}/queues/archived`);
    await act(async () => {
      render(
        <MemoryRouter>
          <MessageQueueArchived {...PAGE_PROPS} />
        </MemoryRouter>,
      );
    });
  }

  test("lists archived queues only, read-only, with unarchive as its bulk action", async () => {
    await renderArchived();

    expect(tableProps!.modelType).toBe(MessageQueue);
    expect(tableProps!.query).toEqual({ isArchived: true });
    expect(tableProps!.isCreateable).toBe(false);
    expect(tableProps!.isEditable).toBe(false);
    expect(tableProps!.isDeleteable).toBe(false);
    expect(tableProps!.isViewable).toBe(true);
    expect(tableProps!.bulkActions!.buttons).toEqual(["unarchive-action"]);
    expect(tableProps!.userPreferencesKey).toBe(
      "message-queues-archived-table",
    );
    expect(tableProps!.noItemsMessage).toBe("No archived queues.");
  });

  test("View opens the queue's own page, not a path under /archived", async () => {
    await renderArchived();

    const route: { toString: () => string } = await tableProps!.onViewPage(
      queue({}),
    );
    expect(route.toString()).toBe(
      `/dashboard/${PROJECT_ID}/queues/${QUEUE_ID}`,
    );
    expect(route.toString()).not.toContain("archived");
    expect(tableProps!.viewPageRoute).toBeUndefined();
  });

  test("says who archived a queue, or that it was archived automatically", async () => {
    await renderArchived();

    const byPerson: HTMLElement = renderCell(
      "Archived By",
      queue({ archivedByUser: { name: "Ada" } as never }),
    );
    expect(byPerson.querySelector('[data-testid="user"]')).toHaveTextContent(
      "Ada",
    );
    cleanup();

    expect(
      renderCell(
        "Archived By",
        queue({ autoArchivedAt: OneUptimeDate.getCurrentDate() }),
      ),
    ).toHaveTextContent("Automatically (not seen)");
    cleanup();

    expect(renderCell("Archived By", queue({}))).toHaveTextContent("—");
  });

  test("shows the system and broker like the main list", async () => {
    await renderArchived();

    expect(
      renderCell("System", queue({ messagingSystem: "gcp_pubsub" })),
    ).toHaveTextContent("Google Cloud Pub/Sub");
    cleanup();
    expect(
      renderCell("Broker", queue({ brokerScope: "shop-prod" })),
    ).toHaveTextContent("shop-prod");
    cleanup();
    const name: HTMLElement = renderCell(
      "Name",
      queue({ name: "renamed", destinationName: "orders" }),
    );
    expect(screen.getByRole("link", { name: "renamed" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/queues/${new ObjectID(QUEUE_ID).toString()}`,
    );
    expect(name).toHaveTextContent("orders");
  });
});

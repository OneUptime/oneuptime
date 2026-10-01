import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * One queue's own pages, outside the telemetry tabs: the view layout (its
 * not-found guard and header refresh), Settings, Owners, Delete and the
 * Documentation tab. Rendered on their real routes; the shared cards they
 * mount are captured so their props — the model, the id read off the URL,
 * the list they return to — are asserted directly.
 */

const QUEUE_ID: string = "3a84ec60-1111-4aaa-8bbb-000000000001";

const getItemMock: MockFunction = getJestMockFunction();
const modelPageMock: MockFunction = getJestMockFunction();
const cardModelDetailMock: MockFunction = getJestMockFunction();
const archiveCardMock: MockFunction = getJestMockFunction();
const ownersCardMock: MockFunction = getJestMockFunction();
const modelDeleteMock: MockFunction = getJestMockFunction();
const documentationCardMock: MockFunction = getJestMockFunction();

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

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: {
      refreshToken?: number;
      title?: string;
      modelNameField?: string;
      children?: React.ReactNode;
    }) => {
      modelPageMock(props);
      return (
        <div data-testid="model-page" data-refresh={props.refreshToken ?? ""}>
          {props.children}
        </div>
      );
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs", () => {
  return {
    __esModule: true,
    getMessageQueueBreadcrumbs: () => {
      return undefined;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <nav data-testid="side-menu" />;
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: { onSaveSuccess?: (item: unknown) => void }) => {
      cardModelDetailMock(props);
      return (
        <button
          onClick={() => {
            props.onSaveSuccess?.({});
          }}
        >
          Save settings
        </button>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        archiveCardMock(props);
        return <div data-testid="archive-card" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Owners/OwnersCard",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        ownersCardMock(props);
        return <div data-testid="owners-card" />;
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (props: { onDeleteSuccess: () => void }) => {
      modelDeleteMock(props);
      return (
        <button
          onClick={() => {
            props.onDeleteSuccess();
          }}
        >
          Delete
        </button>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueueDocumentationCard",
  () => {
    return {
      __esModule: true,
      default: (props: { title: string; description: string }) => {
        documentationCardMock(props);
        return (
          <div data-testid="documentation-card">
            {props.title} | {props.description}
          </div>
        );
      },
    };
  },
);

import MessageQueueViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Layout";
import MessageQueueSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Settings";
import MessageQueueOwners from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Owners";
import MessageQueueDelete from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Delete";
import MessageQueueDocumentation from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Documentation";
import {
  MessageQueueDocumentationTarget,
  getMessageQueueSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/DocumentationMarkdown";
import { getSetupGuideMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import { MESSAGE_QUEUE_DELETE_WARNING } from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueuePresentation";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import MessageQueueOwnerTeam from "../../../Models/DatabaseModels/MessageQueueOwnerTeam";
import MessageQueueOwnerUser from "../../../Models/DatabaseModels/MessageQueueOwnerUser";
import Route from "../../../Types/API/Route";
import Dictionary from "../../../Types/Dictionary";
import { buildMessageQueueDisplayName } from "../../../Types/MessageQueue/MessageQueueIdentity";
import ObjectID from "../../../Types/ObjectID";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import Validation from "../../../UI/Components/Forms/Validation";
import Navigation from "../../../UI/Utils/Navigation";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/queues/${QUEUE_ID}`),
  currentProject: null,
  hasPaymentMethod: true,
};

/*
 * The guide the card renders for the queue it was handed: the queue's own
 * system, prefilled for the queue (what MessageQueueDocumentationCard asks
 * getMessageQueueSetupGuide for on a queue's tab).
 */
function guideForCard(card: Record<string, any>): string {
  const queue: MessageQueueDocumentationTarget = card[
    "queue"
  ] as MessageQueueDocumentationTarget;
  return getSetupGuideMarkdown(
    getMessageQueueSetupGuide({
      oneuptimeUrl: VARS.oneuptimeUrl,
      apiKey: VARS.apiKey,
      system: queue.system,
      queue: queue,
    }),
  );
}

const VARS: { oneuptimeUrl: string; apiKey: string } = {
  oneuptimeUrl: "https://oneuptime.example.com",
  apiKey: "ingest-key-123",
};

function queueRow(values: Partial<MessageQueue>): MessageQueue {
  const row: MessageQueue = new MessageQueue();
  row.id = new ObjectID(QUEUE_ID);
  Object.assign(row, values);
  return row;
}

async function renderTab(
  tab: string,
  element: React.ReactElement,
  withLayout: boolean = true,
): Promise<void> {
  const url: string = `/dashboard/${PROJECT_ID}/queues/${QUEUE_ID}${tab ? `/${tab}` : ""}`;
  goTo(url);
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          {withLayout ? (
            <RouterRoute
              path="/dashboard/:projectId/queues/:id"
              element={<MessageQueueViewLayout {...PAGE_PROPS} />}
            >
              <RouterRoute path={tab || "*"} element={element} />
            </RouterRoute>
          ) : (
            <RouterRoute
              path={`/dashboard/:projectId/queues/:id${tab ? `/${tab}` : ""}`}
              element={element}
            />
          )}
        </Routes>
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  for (const mock of [
    getItemMock,
    modelPageMock,
    cardModelDetailMock,
    archiveCardMock,
    ownersCardMock,
    modelDeleteMock,
    documentationCardMock,
  ]) {
    mock.mockReset();
  }
  jest.spyOn(Navigation, "getRoutePath").mockReturnValue("");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the queue view layout", () => {
  test("a deleted queue (the API's `{}`) is 'Queue not found.' on every tab", async () => {
    getItemMock.mockResolvedValue(new MessageQueue());

    await renderTab("settings", <MessageQueueSettings {...PAGE_PROPS} />);

    expect(await screen.findByText("Queue not found.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save settings" }),
    ).not.toBeInTheDocument();
  });

  test("the guard is the queue's identifier, which every row has", async () => {
    // A row the API returned with an id but no identifier is no queue.
    getItemMock.mockResolvedValue(queueRow({}));

    await renderTab("settings", <MessageQueueSettings {...PAGE_PROPS} />);

    expect(await screen.findByText("Queue not found.")).toBeInTheDocument();
    expect(getItemMock).toHaveBeenCalledWith({
      modelType: MessageQueue,
      id: new ObjectID(QUEUE_ID),
      select: { _id: true, queueIdentifier: true },
    });
  });

  test("a found queue renders its tab under the queue header", async () => {
    getItemMock.mockResolvedValue(
      queueRow({ queueIdentifier: "kafka||orders" }),
    );

    await renderTab("settings", <MessageQueueSettings {...PAGE_PROPS} />);

    expect(
      screen.getByRole("button", { name: "Save settings" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Queue not found.")).not.toBeInTheDocument();
    expect(modelPageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Queue",
        modelType: MessageQueue,
        modelNameField: "name",
      }),
    );
  });

  test("a rename in Settings reads the page header again", async () => {
    getItemMock.mockResolvedValue(
      queueRow({ queueIdentifier: "kafka||orders" }),
    );

    await renderTab("settings", <MessageQueueSettings {...PAGE_PROPS} />);

    expect(screen.getByTestId("model-page")).toHaveAttribute(
      "data-refresh",
      "0",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    });

    expect(screen.getByTestId("model-page")).toHaveAttribute(
      "data-refresh",
      "1",
    );
  });

  test("a failed lookup is not 'not found': the tab stays and reports its own errors", async () => {
    getItemMock.mockRejectedValue(new Error("network"));

    await renderTab("settings", <MessageQueueSettings {...PAGE_PROPS} />);

    expect(
      screen.getByRole("button", { name: "Save settings" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Queue not found.")).not.toBeInTheDocument();
  });
});

describe("the Settings tab", () => {
  test.each([
    ["the canonical URL", "settings"],
    ["a trailing slash", "settings/"],
  ])(
    "edits this queue's name, description and labels, and archives it, on %s",
    async (_name: string, tab: string) => {
      await renderTab(tab, <MessageQueueSettings {...PAGE_PROPS} />, false);

      const detail: Record<string, any> = cardModelDetailMock.mock
        .calls[0]![0] as Record<string, any>;
      expect(detail["name"]).toBe("Queue Settings");
      expect(detail["editButtonText"]).toBe("Edit Queue");
      expect(detail["isEditable"]).toBe(true);
      expect(
        detail["formFields"].map((formField: Record<string, any>): string => {
          return Object.keys(formField["field"])[0]!;
        }),
      ).toEqual(["name", "description", "labels"]);
      expect(detail["formFields"][0]["required"]).toBe(true);
      expect(detail["formFields"][0]["description"]).toContain(
        "Renaming is safe",
      );
      expect(detail["modelDetailProps"]["modelType"]).toBe(MessageQueue);
      expect(detail["modelDetailProps"]["modelId"]).toEqual(
        new ObjectID(QUEUE_ID),
      );
      expect(detail["modelDetailProps"]["id"]).toBe(
        "model-detail-message-queue",
      );

      const archive: Record<string, any> = archiveCardMock.mock
        .calls[0]![0] as Record<string, any>;
      expect(archive["modelType"]).toBe(MessageQueue);
      expect(archive["modelId"]).toEqual(new ObjectID(QUEUE_ID));
      expect(archive["singularName"]).toBe("queue");
      expect(String(archive["listRoute"])).toBe(
        `/dashboard/${PROJECT_ID}/queues`,
      );
    },
  );

  test("a queue named after a one-character destination can still be edited", async () => {
    await renderTab(
      "settings",
      <MessageQueueSettings {...PAGE_PROPS} />,
      false,
    );

    const detail: Record<string, any> = cardModelDetailMock.mock
      .calls[0]![0] as Record<string, any>;
    // Named after their model field, the way BasicForm validates them.
    const formFields: Array<Field<MessageQueue>> = detail["formFields"].map(
      (formField: Record<string, any>): Field<MessageQueue> => {
        return {
          name: Object.keys(formField["field"])[0]!,
          ...formField,
        } as Field<MessageQueue>;
      },
    );
    function errorsFor(values: FormValues<MessageQueue>): Dictionary<string> {
      return Validation.validate<MessageQueue>({
        formFields,
        values,
        onValidate: undefined,
        currentFormStepId: "queue-info",
      });
    }

    /*
     * Discovery names a RabbitMQ queue "q" after its destination; the form
     * re-checks that prefilled name on every save, so a length rule would
     * refuse a new description until the queue was renamed.
     */
    const discoveredName: string = buildMessageQueueDisplayName({
      destination: "q",
    });
    expect(discoveredName).toBe("q");
    expect(
      errorsFor({ name: discoveredName, description: "Order events" }),
    ).toEqual({});

    // A name is still required.
    expect(errorsFor({ name: "", description: "Order events" })).toEqual({
      name: "Name is required.",
    });
  });

  test("renders outside the layout too (the rename refresh is a no-op there)", async () => {
    await renderTab(
      "settings",
      <MessageQueueSettings {...PAGE_PROPS} />,
      false,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    });

    expect(screen.getByTestId("archive-card")).toBeInTheDocument();
  });
});

describe("the Owners tab", () => {
  test("lists this queue's owner users and teams", async () => {
    await renderTab("owners", <MessageQueueOwners {...PAGE_PROPS} />, false);

    expect(ownersCardMock).toHaveBeenCalledWith({
      resourceId: new ObjectID(QUEUE_ID),
      resourceIdField: "messageQueueId",
      resourceDisplayName: "queue",
      ownerUserModelType: MessageQueueOwnerUser,
      ownerTeamModelType: MessageQueueOwnerTeam,
    });
  });
});

describe("the Delete tab", () => {
  test("warns that discovered queues come back, then returns to the list", async () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    await renderTab("delete", <MessageQueueDelete {...PAGE_PROPS} />, false);

    expect(screen.getByText(MESSAGE_QUEUE_DELETE_WARNING)).toBeInTheDocument();
    expect(
      screen.getByText("Discovered queues come back."),
    ).toBeInTheDocument();

    const deleteProps: Record<string, any> = modelDeleteMock.mock
      .calls[0]![0] as Record<string, any>;
    expect(deleteProps["modelType"]).toBe(MessageQueue);
    expect(deleteProps["modelId"]).toEqual(new ObjectID(QUEUE_ID));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/queues`,
    );
  });
});

describe("the Documentation tab", () => {
  test("reads the queue's system, destination, namespace and broker address", async () => {
    getItemMock.mockResolvedValue(
      queueRow({
        queueIdentifier: "servicebus|shop-prod|orders",
        messagingSystem: "servicebus",
        destinationName: "orders",
        brokerScope: "shop-prod",
        brokerAddress: "shop-prod.servicebus.windows.net",
        name: "Order events",
      }),
    );

    await renderTab(
      "documentation",
      <MessageQueueDocumentation {...PAGE_PROPS} />,
      false,
    );

    expect(getItemMock).toHaveBeenCalledWith({
      modelType: MessageQueue,
      id: new ObjectID(QUEUE_ID),
      select: {
        name: true,
        queueIdentifier: true,
        messagingSystem: true,
        destinationName: true,
        brokerScope: true,
        brokerAddress: true,
      },
    });

    const card: Record<string, any> = documentationCardMock.mock
      .calls[0]![0] as Record<string, any>;
    expect(card["title"]).toBe(
      "Send Azure Service Bus telemetry for this queue",
    );
    // Its guide has a broker step, so the heading promises the broker's metrics.
    expect(card["description"]).toBe(
      "Instrument the applications that publish to and consume from this queue, and send its broker's metrics to OneUptime.",
    );

    // The guide is the queue's own: prefilled from the row, with no picker.
    expect(card["queue"]).toEqual({
      system: "servicebus",
      destination: "orders",
      brokerScope: "shop-prod",
      brokerAddress: "shop-prod.servicebus.windows.net",
    });
    const markdown: string = guideForCard(card);
    expect(markdown).toContain(
      "This is the Azure Service Bus queue `orders` in the `shop-prod` namespace.",
    );
    expect(markdown).toContain('x-oneuptime-token: "ingest-key-123"');
  });

  /*
   * The heading says what the guide's own steps do: a JMS queue's guide has
   * no broker step, and BullMQ's reports the depth from the application.
   */
  test.each([
    [
      "jms",
      "Send JMS telemetry for this queue",
      "Instrument the applications that publish to and consume from this queue, and send their spans to OneUptime.",
    ],
    [
      "bullmq",
      "Send BullMQ telemetry for this queue",
      "Tag the BullMQ telemetry of the applications that use this queue in the collector they send to, and report the queue's depth from the application.",
    ],
  ])(
    "a %s queue's heading follows its guide's steps",
    async (system: string, title: string, description: string) => {
      getItemMock.mockResolvedValue(
        queueRow({
          queueIdentifier: `${system}||orders`,
          messagingSystem: system,
          destinationName: "orders",
        }),
      );

      await renderTab(
        "documentation",
        <MessageQueueDocumentation {...PAGE_PROPS} />,
        false,
      );

      const card: Record<string, any> = documentationCardMock.mock
        .calls[0]![0] as Record<string, any>;
      expect(card["title"]).toBe(title);
      expect(card["description"]).toBe(description);
      expect(card["description"]).not.toContain("prefilled");
    },
  );

  test("an ActiveMQ queue gets ActiveMQ's guide, not its JMS family's", async () => {
    getItemMock.mockResolvedValue(
      queueRow({
        queueIdentifier: "jms||orders",
        messagingSystem: "activemq",
        destinationName: "orders",
      }),
    );

    await renderTab(
      "documentation",
      <MessageQueueDocumentation {...PAGE_PROPS} />,
      false,
    );

    const card: Record<string, any> = documentationCardMock.mock
      .calls[0]![0] as Record<string, any>;
    expect(card["title"]).toBe("Send Apache ActiveMQ telemetry for this queue");
    expect(card["queue"]["system"]).toBe("activemq");
    expect(guideForCard(card)).toContain(
      "export OTEL_JMX_TARGET_SYSTEM=activemq",
    );
  });

  test("a queue whose destination is missing is named by its name", async () => {
    getItemMock.mockResolvedValue(
      queueRow({
        queueIdentifier: "kafka||orders",
        messagingSystem: "kafka",
        name: "orders",
      }),
    );

    await renderTab(
      "documentation",
      <MessageQueueDocumentation {...PAGE_PROPS} />,
      false,
    );

    const card: Record<string, any> = documentationCardMock.mock
      .calls[0]![0] as Record<string, any>;
    expect(card["queue"]["destination"]).toBe("orders");
    expect(guideForCard(card)).toContain(
      "This is the Apache Kafka queue `orders`.",
    );
  });

  test("a deleted queue says so instead of a guide", async () => {
    getItemMock.mockResolvedValue(new MessageQueue());

    await renderTab(
      "documentation",
      <MessageQueueDocumentation {...PAGE_PROPS} />,
      false,
    );

    expect(await screen.findByText("Queue not found.")).toBeInTheDocument();
    expect(documentationCardMock).not.toHaveBeenCalled();
  });

  test("a failed lookup says why", async () => {
    getItemMock.mockRejectedValue(new Error("Permission denied."));

    await renderTab(
      "documentation",
      <MessageQueueDocumentation {...PAGE_PROPS} />,
      false,
    );

    expect(await screen.findByText("Permission denied.")).toBeInTheDocument();
    expect(documentationCardMock).not.toHaveBeenCalled();
  });
});

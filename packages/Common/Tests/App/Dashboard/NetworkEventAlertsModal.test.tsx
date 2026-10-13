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
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import NetworkEventAlertsModal, {
  NetworkEventAlertCard,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventAlertsModal";
import { NETWORK_EVENT_ALERT_TEMPLATE_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventAlertTemplateCopy";
import NetworkEventAlertTemplates, {
  NetworkEventAlertTemplate,
  NetworkEventAlertTemplateId,
} from "../../../Types/NetworkEvent/NetworkEventAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * Being told when something happens on the network: the alerts most
 * networks want, one card each. A card opens Create Monitor filled in -
 * what the monitor then is, is pinned in NetworkEventMonitorPrefill.test.ts.
 * These draw the dialog: every featured alert, its words, where each card
 * leads, and what someone who may not create monitors is shown instead.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const DEVICE_ID: string = "84858d6c-0000-4000-8000-000000000001";

function renderModal(
  props: Partial<React.ComponentProps<typeof NetworkEventAlertsModal>> = {},
): { onClose: MockFunction } {
  const onClose: MockFunction = getJestMockFunction();

  render(
    <MemoryRouter>
      <NetworkEventAlertsModal canCreate={true} onClose={onClose} {...props} />
    </MemoryRouter>,
  );

  return { onClose: onClose };
}

function cards(): Array<HTMLElement> {
  return screen.getAllByTestId("network-event-alert-template");
}

function cardFor(id: NetworkEventAlertTemplateId): HTMLElement {
  const card: HTMLElement | undefined = cards().find(
    (candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-template-id") === id;
    },
  );

  if (!card) {
    throw new Error(`No card for ${id}`);
  }

  return card;
}

function linkOf(card: HTMLElement): URL {
  return new URL(
    within(card)
      .getByRole("link", { name: "Create alert" })
      .getAttribute("href") || "",
    "https://oneuptime.example",
  );
}

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the alerts dialog", () => {
  test("one card per featured alert, in the templates' own order", () => {
    renderModal();

    expect(
      cards().map((card: HTMLElement): string => {
        return card.getAttribute("data-template-id") || "";
      }),
    ).toEqual(
      NetworkEventAlertTemplates.getFeatured().map(
        (template: NetworkEventAlertTemplate): string => {
          return template.id;
        },
      ),
    );
    expect(cards()).toHaveLength(8);
  });

  test.each(
    NetworkEventAlertTemplates.getFeatured().map(
      (
        template: NetworkEventAlertTemplate,
      ): [string, NetworkEventAlertTemplate] => {
        return [template.id, template];
      },
    ),
  )(
    "%s: its card says what goes wrong and when the alert closes, and leads to Create Monitor on it",
    (_id: string, template: NetworkEventAlertTemplate) => {
      renderModal();

      const id: NetworkEventAlertTemplateId =
        template.id as NetworkEventAlertTemplateId;
      const card: HTMLElement = cardFor(id);

      expect(card).toHaveTextContent(
        NETWORK_EVENT_ALERT_TEMPLATE_COPY[id].title,
      );
      expect(card).toHaveTextContent(
        NETWORK_EVENT_ALERT_TEMPLATE_COPY[id].description,
      );

      const url: URL = linkOf(card);

      expect(url.pathname).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
      expect(Array.from(url.searchParams.keys())).toEqual([
        "networkEventAlert",
      ]);
      expect(url.searchParams.get("networkEventAlert")).toBe(template.id);
    },
  );

  test("says what the alerts watch: every device that reports to a probe", () => {
    renderModal();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Get told when something happens on your network",
    );
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Pick an alert to start from. It watches every device that sends its syslog or traps to a probe, and you can change anything before you save it.",
    );
  });

  test("Start from scratch opens Create Monitor on a Logs monitor with nothing else filled in", () => {
    renderModal();

    const url: URL = new URL(
      screen
        .getByRole("link", { name: "Start from scratch" })
        .getAttribute("href") || "",
      "https://oneuptime.example",
    );

    expect(url.pathname).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
    expect(Array.from(url.searchParams.entries())).toEqual([
      ["monitorType", "Logs"],
    ]);
  });

  test("has one way out, which says Close: there is nothing here to save", () => {
    const { onClose } = renderModal();
    const footer: HTMLElement = screen.getByTestId("modal-footer");

    expect(
      within(footer)
        .getAllByRole("button")
        .map((button: HTMLElement): string => {
          return button.textContent || "";
        }),
    ).toEqual(["Close"]);

    fireEvent.click(within(footer).getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("from one device's page", () => {
  test("names the device, says the alerts are for it alone, and every card carries it", () => {
    renderModal({ device: { id: DEVICE_ID, name: "Core Switch" } });

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Get told when something happens on Core Switch",
    );
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Pick an alert to start from. It watches this device only, and you can change anything before you save it.",
    );

    for (const card of cards()) {
      const url: URL = linkOf(card);

      expect(url.searchParams.get("networkEventAlert")).toBe(
        card.getAttribute("data-template-id"),
      );
      expect(url.searchParams.get("networkEventDeviceId")).toBe(DEVICE_ID);
    }
  });

  test.each([[""], ["   "]])(
    "a device whose name is %j is this device, never your network",
    (name: string) => {
      renderModal({ device: { id: DEVICE_ID, name: name } });

      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Get told when something happens on this device",
      );
      expect(screen.getByTestId("modal-description")).toHaveTextContent(
        "It watches this device only",
      );
      expect(linkOf(cards()[0]!).searchParams.get("networkEventDeviceId")).toBe(
        DEVICE_ID,
      );
    },
  );

  test("a name is shown as written, not as markup", () => {
    renderModal({
      device: { id: DEVICE_ID, name: "<b>core</b> & {{device}}" },
    });

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Get told when something happens on <b>core</b> & {{device}}",
    );
    expect(screen.getByTestId("modal-title").querySelector("b")).toBeNull();
  });

  test("Start from scratch is not narrowed to the device: scratch is scratch", () => {
    renderModal({ device: { id: DEVICE_ID, name: "Core Switch" } });

    expect(
      new URL(
        screen
          .getByRole("link", { name: "Start from scratch" })
          .getAttribute("href") || "",
        "https://oneuptime.example",
      ).searchParams.get("networkEventDeviceId"),
    ).toBeNull();
  });
});

describe("someone who may not create monitors", () => {
  test("is told so on every card, and handed no link to a form they cannot save", () => {
    renderModal({ canCreate: false });

    expect(cards()).toHaveLength(8);

    for (const card of cards()) {
      expect(card).toHaveTextContent(
        "You need permission to create monitors to set this up.",
      );
      expect(within(card).queryByRole("link")).not.toBeInTheDocument();
    }

    expect(
      screen.queryByRole("link", { name: "Start from scratch" }),
    ).not.toBeInTheDocument();
    // What each alert is stays readable.
    expect(
      cardFor(NetworkEventAlertTemplateId.VpnTunnelDown),
    ).toHaveTextContent("A VPN tunnel goes down");
  });
});

describe("a card on its own", () => {
  test("draws its icon as decoration, not as something to read out", () => {
    render(
      <MemoryRouter>
        <NetworkEventAlertCard
          template={
            NetworkEventAlertTemplates.get(
              NetworkEventAlertTemplateId.InterfaceDown,
            )!
          }
          canCreate={true}
        />
      </MemoryRouter>,
    );

    const card: HTMLElement = screen.getByTestId(
      "network-event-alert-template",
    );

    expect(card).toHaveTextContent("An interface goes down");
    expect(card.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(within(card).getAllByRole("link")).toHaveLength(1);
  });
});

import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";

/*
 * A status page's subscriber lists name each subscriber by what the list
 * shows first - the address, the phone number, the Slack or Microsoft Teams
 * workspace, the webhook URL - in Unsubscribe's question, in Delete's, and
 * in a bulk result. Only addresses and phone numbers are names a record is
 * otherwise known by, so the Slack, Teams and webhook lists asked "Are you
 * sure you want to unsubscribe 3 subscribers?" without saying which.
 */

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["ProjectOwner"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
        language: "en",
      };
    },
  };
});

import useSubscriberBulkActions, {
  getSubscriberName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/useSubscriberBulkActions";
import BulkUpdateForm, {
  BulkActionButtonSchema,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import Email from "../../../Types/Email";
import Phone from "../../../Types/Phone";
import URL from "../../../Types/API/URL";

const IDS: Array<string> = [
  "5a3e0d1c-2b4f-4c6d-8e7f-000000000001",
  "5a3e0d1c-2b4f-4c6d-8e7f-000000000002",
  "5a3e0d1c-2b4f-4c6d-8e7f-000000000003",
];

const subscriber: (
  index: number,
  fields: Partial<StatusPageSubscriber>,
) => StatusPageSubscriber = (
  index: number,
  fields: Partial<StatusPageSubscriber>,
): StatusPageSubscriber => {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = IDS[index]!;
  Object.assign(row, fields);
  return row;
};

afterEach(() => {
  cleanup();
});

describe("getSubscriberName", () => {
  test("names each kind of subscriber by what its list shows first", () => {
    expect(
      getSubscriberName(
        subscriber(0, { subscriberEmail: new Email("ops@example.com") }),
      ),
    ).toBe("ops@example.com");
    expect(
      getSubscriberName(
        subscriber(0, { subscriberPhone: new Phone("+15555550123") }),
      ),
    ).toBe("+15555550123");
    expect(
      getSubscriberName(subscriber(0, { slackWorkspaceName: "Acme Ops" })),
    ).toBe("Acme Ops");
    expect(
      getSubscriberName(
        subscriber(0, { microsoftTeamsWorkspaceName: "Acme Support" }),
      ),
    ).toBe("Acme Support");
    expect(
      getSubscriberName(
        subscriber(0, {
          subscriberWebhook: URL.fromString("https://hooks.example.com/status"),
        }),
      ),
    ).toBe("https://hooks.example.com/status");
  });

  test("a subscriber with none of them has no name, and a blank one does not count", () => {
    expect(getSubscriberName(subscriber(0, {}))).toBe("");
    expect(
      getSubscriberName(
        subscriber(0, {
          slackWorkspaceName: "   ",
          microsoftTeamsWorkspaceName: "Acme Support",
        }),
      ),
    ).toBe("Acme Support");
  });
});

function Harness(props: { items: Array<StatusPageSubscriber> }): ReactElement {
  const actions: Array<BulkActionButtonSchema<StatusPageSubscriber>> =
    useSubscriberBulkActions();

  return (
    <BulkUpdateForm<StatusPageSubscriber>
      selectedItems={props.items}
      isAllItemsSelected={false}
      onSelectAllClick={() => {}}
      onClearSelectionClick={() => {}}
      singularLabel="Subscriber"
      pluralLabel="Subscribers"
      buttons={actions}
    />
  );
}

describe("Unsubscribe on the Slack list", () => {
  test("names the workspaces it unsubscribes, and says how many are unsubscribed already", () => {
    render(
      <Harness
        items={[
          subscriber(0, {
            slackWorkspaceName: "Acme Ops",
            isUnsubscribed: false,
          }),
          subscriber(1, {
            slackWorkspaceName: "Acme Support",
            isUnsubscribed: false,
          }),
          subscriber(2, {
            slackWorkspaceName: "Old Partner",
            isUnsubscribed: true,
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByText("Bulk Actions"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unsubscribe" }));

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(within(dialog).getByText("Unsubscribe 2 Subscribers")).toBeVisible();
    expect(
      within(dialog)
        .getAllByTestId("delete-confirmation-item")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(["Acme Ops", "Acme Support"]);
    expect(within(dialog).getByTestId("bulk-switch-already")).toHaveTextContent(
      "1 selected subscriber is already unsubscribed.",
    );
  });
});

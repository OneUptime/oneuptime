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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import DataSecurityApi, {
  DataSecurityApiError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import IssueResponseAction, {
  ISSUE_RESPONSE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueResponseAction";
import {
  DataSecurityResponseAvailability,
  DataSecurityResponseUnavailableReason,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataSecurityResponseAction } from "../../../Types/DataSecurity/DataSecurityResponseAction";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { PROJECT_ID } from "./SideMenuHarness";
import type { Mock, SpyInstance } from "jest-mock";

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

/*
 * FIX IT FROM HERE, on an issue's page (Components/DataSecurity/
 * IssueResponseAction): an open issue that a response action fixes offers
 * it above the console steps - Block Public Access on a public bucket,
 * Revoke Sharing on a shared snapshot - once the server says the store can
 * take it now. Where it cannot, the panel says why and what to turn on;
 * an issue no action fixes draws nothing. Pressing the button asks first,
 * saying what changes and what stops working, then runs it, tells the
 * issue's timeline, and says what happened.
 */

configure({ asyncUtilTimeout: 15000 });

const STORE_ID: string = "6a6a6a6a-0000-4000-8000-000000000006";
const ISSUE_ID: ObjectID = new ObjectID("7b7b7b7b-0000-4000-8000-000000000007");

const OWNER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.ProjectOwner,
];

const VIEWER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.SecurityViewer,
];

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

let availability: DataSecurityResponseAvailability;
let availabilitySpy: SpyInstance<typeof DataSecurityApi.getResponseActions>;
let respondSpy: SpyInstance<typeof DataSecurityApi.respond>;
let onChanged: Mock<() => void>;

function available(action: DataSecurityResponseAction): void {
  availability = { actions: [{ action, isAvailable: true }] };
}

function unavailable(
  action: DataSecurityResponseAction,
  reason: DataSecurityResponseUnavailableReason,
): void {
  availability = {
    actions: [{ action, isAvailable: false, unavailableReason: reason }],
  };
}

function renderPanel(props: {
  checkId: string;
  kind: DataStoreKind;
  storeName?: string;
}): void {
  render(
    <MemoryRouter>
      <IssueResponseAction
        issueId={ISSUE_ID}
        checkId={props.checkId}
        dataStoreId={STORE_ID}
        storeKind={props.kind}
        storeName={props.storeName || "customer-exports"}
        onChanged={onChanged}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  grant(OWNER);
  available(DataSecurityResponseAction.BlockPublicAccess);
  onChanged = jest.fn<() => void>();

  availabilitySpy = jest
    .spyOn(DataSecurityApi, "getResponseActions")
    .mockImplementation(async () => {
      return availability;
    });
  respondSpy = jest.spyOn(DataSecurityApi, "respond").mockResolvedValue({
    changed: true,
    summary: "Turned on all four Block Public Access settings.",
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("which issues offer it", () => {
  test("a public bucket offers Block Public Access, once the server says the store can take it", async () => {
    renderPanel({ checkId: "public-read", kind: DataStoreKind.AwsS3Bucket });

    const panel: HTMLElement = await screen.findByTestId(
      ISSUE_RESPONSE_TEST_ID,
    );
    const button: HTMLElement = within(panel).getByTestId(
      `${ISSUE_RESPONSE_TEST_ID}-button`,
    );

    expect(within(panel).getByText("Fix it from here")).toBeInTheDocument();
    expect(button).toHaveTextContent("Block Public Access");
    expect(button).toBeEnabled();
    expect(availabilitySpy).toHaveBeenCalledWith(new ObjectID(STORE_ID));
  });

  test("a snapshot shared outside offers Revoke Sharing", async () => {
    available(DataSecurityResponseAction.RevokeSharing);
    renderPanel({
      checkId: "snapshot-shared-externally",
      kind: DataStoreKind.AwsRdsSnapshot,
      storeName: "orders-2026-10-01",
    });

    expect(
      await screen.findByTestId(`${ISSUE_RESPONSE_TEST_ID}-button`),
    ).toHaveTextContent("Revoke Sharing");
  });

  test.each([
    ["not-encrypted-at-rest", DataStoreKind.AwsS3Bucket],
    ["no-owner", DataStoreKind.AwsS3Bucket],
    ["public-read", DataStoreKind.PostgreSql],
  ])(
    "an issue of %s on a %s offers nothing, and asks the server nothing",
    async (checkId: string, kind: DataStoreKind) => {
      renderPanel({ checkId, kind });

      await waitFor(() => {
        expect(
          screen.queryByTestId(ISSUE_RESPONSE_TEST_ID),
        ).not.toBeInTheDocument();
      });
      expect(availabilitySpy).not.toHaveBeenCalled();
    },
  );

  test("a read that fails draws nothing: the console steps below still fix it", async () => {
    availabilitySpy.mockRejectedValue(
      new DataSecurityApiError("Something went wrong.", 500),
    );
    renderPanel({ checkId: "public-read", kind: DataStoreKind.AwsS3Bucket });

    await waitFor(() => {
      expect(availabilitySpy).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId(ISSUE_RESPONSE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a store whose kind the server says takes nothing draws nothing", async () => {
    availability = { actions: [] };
    renderPanel({ checkId: "public-read", kind: DataStoreKind.AwsS3Bucket });

    await waitFor(() => {
      expect(availabilitySpy).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId(ISSUE_RESPONSE_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("when it cannot run from here", () => {
  test("with the connection's response off, it says what to turn on and where", async () => {
    unavailable(
      DataSecurityResponseAction.BlockPublicAccess,
      DataSecurityResponseUnavailableReason.ResponseOff,
    );
    renderPanel({ checkId: "public-read", kind: DataStoreKind.AwsS3Bucket });

    const reason: HTMLElement = await screen.findByTestId(
      `${ISSUE_RESPONSE_TEST_ID}-unavailable`,
    );

    expect(reason).toHaveTextContent(
      "To do this from here, turn on Data security response on this store's cloud connection and run its updated setup command.",
    );
    expect(
      within(reason).getByTestId(`${ISSUE_RESPONSE_TEST_ID}-connections`),
    ).toHaveTextContent("Open cloud connections");
    expect(
      screen.getByTestId(`${ISSUE_RESPONSE_TEST_ID}-button`),
    ).toBeDisabled();
  });

  test.each([
    [
      DataSecurityResponseUnavailableReason.PublicByDesign,
      "This store is marked public by design",
    ],
    [
      DataSecurityResponseUnavailableReason.ConnectionGone,
      "This store's cloud connection is gone or turned off",
    ],
    [
      DataSecurityResponseUnavailableReason.NotThroughACloud,
      "This store was not found through a cloud connection",
    ],
  ])(
    "%s: it says why, with no link, and the button stays off",
    async (reason: DataSecurityResponseUnavailableReason, words: string) => {
      unavailable(DataSecurityResponseAction.BlockPublicAccess, reason);
      renderPanel({ checkId: "public-read", kind: DataStoreKind.AwsS3Bucket });

      const line: HTMLElement = await screen.findByTestId(
        `${ISSUE_RESPONSE_TEST_ID}-unavailable`,
      );

      expect(line).toHaveTextContent(words);
      expect(
        within(line).queryByTestId(`${ISSUE_RESPONSE_TEST_ID}-connections`),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId(`${ISSUE_RESPONSE_TEST_ID}-button`),
      ).toBeDisabled();
    },
  );

  test("someone who may not change the store sees it locked, never runs it", async () => {
    grant(VIEWER);
    renderPanel({ checkId: "public-read", kind: DataStoreKind.AwsS3Bucket });

    const button: HTMLElement = await screen.findByTestId(
      `${ISSUE_RESPONSE_TEST_ID}-button`,
    );

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(respondSpy).not.toHaveBeenCalled();
  });
});

describe("running it", () => {
  test("asks first, saying what changes and what stops working, then runs it for this issue", async () => {
    renderPanel({ checkId: "public-read", kind: DataStoreKind.AwsS3Bucket });

    fireEvent.click(
      await screen.findByTestId(`${ISSUE_RESPONSE_TEST_ID}-button`),
    );

    const dialog: HTMLElement = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText("Block public access to customer-exports?"),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Anything that reads it publicly - a website, a download link - stops working. No object is changed.",
    );
    expect(dialog).toHaveTextContent(
      "the issue resolves on its own once its check passes.",
    );
    expect(respondSpy).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Block Public Access" }),
    );

    await waitFor(() => {
      expect(respondSpy).toHaveBeenCalledWith({
        dataStoreId: new ObjectID(STORE_ID),
        action: DataSecurityResponseAction.BlockPublicAccess,
        dataSecurityIssueId: ISSUE_ID,
      });
    });

    const result: HTMLElement = await screen.findByTestId(
      `${ISSUE_RESPONSE_TEST_ID}-result`,
    );

    expect(result).toHaveTextContent(
      "Public access is blocked. The store is being checked again, and the issue resolves once its check passes.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test("nothing to change says so", async () => {
    respondSpy.mockResolvedValue({
      changed: false,
      summary: "Block Public Access was already on.",
    });
    renderPanel({ checkId: "public-read", kind: DataStoreKind.AwsS3Bucket });

    fireEvent.click(
      await screen.findByTestId(`${ISSUE_RESPONSE_TEST_ID}-button`),
    );
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Block Public Access",
      }),
    );

    expect(
      await screen.findByTestId(`${ISSUE_RESPONSE_TEST_ID}-result`),
    ).toHaveTextContent(
      "Nothing to change: public access was already blocked.",
    );
  });

  test("a refusal stays in the dialog, in the server's words, and nothing else changes", async () => {
    respondSpy.mockRejectedValue(
      new DataSecurityApiError(
        "The store's cloud connection is gone or turned off.",
        400,
      ),
    );
    renderPanel({ checkId: "public-read", kind: DataStoreKind.AwsS3Bucket });

    fireEvent.click(
      await screen.findByTestId(`${ISSUE_RESPONSE_TEST_ID}-button`),
    );

    const dialog: HTMLElement = await screen.findByRole("dialog");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Block Public Access" }),
    );

    await waitFor(() => {
      expect(dialog).toHaveTextContent(
        "The store's cloud connection is gone or turned off.",
      );
    });
    expect(
      screen.queryByTestId(`${ISSUE_RESPONSE_TEST_ID}-result`),
    ).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  test("Cancel closes it, and nothing runs", async () => {
    renderPanel({ checkId: "public-read", kind: DataStoreKind.AwsS3Bucket });

    fireEvent.click(
      await screen.findByTestId(`${ISSUE_RESPONSE_TEST_ID}-button`),
    );
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(respondSpy).not.toHaveBeenCalled();
  });
});

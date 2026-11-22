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
  waitFor,
} from "@testing-library/react";
import * as React from "react";

/*
 * BLOCK ADDRESSES AT CLOUDFLARE (#10343), drawn: the dialog of a Cloudflare
 * connection - off, the opt-in with its write permissions, its zones and a
 * new token, Check Permissions and Turn On Blocking, which turns blocking on
 * only when every check passes; on, how it stands, Put It Back on a zone
 * whose rule changed at Cloudflare, the skip-rule addresses to protect, and
 * Turn Off Blocking with its question - the connection's row, the delete
 * dialog of a connection that blocks, and a block's Cloudflare chip on the
 * Blocklist. The blocking route and the connection's read are faked at the
 * dialog's API module; everything drawn is the Dashboard's own.
 */

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

let dropdownProps: Record<string, unknown> = {};

jest.mock("../../../UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      dropdownProps = props;
      return <div data-testid="zones-dropdown" />;
    },
  };
});

type TableProps = Record<string, unknown>;
let capturedTable: TableProps = {};

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: TableProps) => {
      capturedTable = props;
      return <div data-testid="model-table" />;
    },
  };
});

type MockedFn = ReturnType<typeof jest.fn>;

const api: {
  readBlockingConnection: MockedFn;
  readBlockingZoneChoices: MockedFn;
  checkBlocking: MockedFn;
  turnBlockingOn: MockedFn;
  turnBlockingOff: MockedFn;
  putBlockingBack: MockedFn;
} = {
  readBlockingConnection: jest.fn(),
  readBlockingZoneChoices: jest.fn(),
  checkBlocking: jest.fn(),
  turnBlockingOn: jest.fn(),
  turnBlockingOff: jest.fn(),
  putBlockingBack: jest.fn(),
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CloudflareBlocking/CloudflareBlockingApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CloudflareBlocking/CloudflareBlockingApi",
    ) as Record<string, unknown>;

    return {
      __esModule: true,
      ...actual,
      readBlockingConnection: (...args: Array<unknown>) => {
        return api.readBlockingConnection(...args);
      },
      readBlockingZoneChoices: (...args: Array<unknown>) => {
        return api.readBlockingZoneChoices(...args);
      },
      checkBlocking: (...args: Array<unknown>) => {
        return api.checkBlocking(...args);
      },
      turnBlockingOn: (...args: Array<unknown>) => {
        return api.turnBlockingOn(...args);
      },
      turnBlockingOff: (...args: Array<unknown>) => {
        return api.turnBlockingOff(...args);
      },
      putBlockingBack: (...args: Array<unknown>) => {
        return api.putBlockingBack(...args);
      },
    };
  },
);

import CloudflareBlockingModal from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CloudflareBlocking/CloudflareBlockingModal";
import {
  ADDRESSES_PROTECTED_TOAST,
  CLOUDFLARE_BLOCKING_TEST_IDS,
  NOT_TURNED_ON,
  TURNED_OFF_REMOVING_TOAST,
  TURNED_OFF_TOAST,
  TURNED_ON_TOAST,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CloudflareBlocking/CloudflareBlockingCopy";
import {
  getBlockingBody,
  getBlockingRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CloudflareBlocking/CloudflareBlockingApi";
import SecurityEventConnectionsTable, {
  getConnectionBlockingDetail,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionsTable";
import {
  BlockEnforcedAtCell,
  writeEnforcementTooltip,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistCells";
import { BLOCKLIST_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistCopy";
import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../Models/DatabaseModels/SecurityBlockEnforcement";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityProtectedEntity from "../../../Models/DatabaseModels/SecurityProtectedEntity";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  CloudflareAccessRulesReason,
  CloudflareBlockingMechanism,
  CloudflareBlockingStatus,
  CloudflarePlan,
  CloudflareRuleState,
} from "../../../Types/SecurityBlocklist/CloudflareBlocking";
import {
  SecurityBlockAction,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockEnforcementState } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { DeleteConfirmation } from "../../../UI/Components/ModelTable/BaseModelTable";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Toast from "../../../UI/Utils/Toast";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";

const CONNECTION_ID: ObjectID = new ObjectID(
  "10343000-0000-4000-8000-0000000000cc",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "10343000-0000-4000-8000-0000000000aa",
);
const ACCOUNT_ID: string = "9a7806061c88ada191ed06f989cc3dac";
const ZONE_A: string = "023e105f4ecef8ad9ca31a8372d0c353";
const ZONE_B: string = "353c0d2738a13ac9da8fece4f501e320";

function connection(data: {
  blockingSettings?: JSONObject | null;
  blockingStatus?: JSONObject | null;
}): SecurityEventConnection {
  const model: SecurityEventConnection = new SecurityEventConnection();
  model.id = CONNECTION_ID;
  model.projectId = PROJECT_ID;
  model.name = "Production Cloudflare";
  model.provider = SecurityEventConnectorProvider.Cloudflare;
  model.config = { accountId: ACCOUNT_ID };
  if (data.blockingSettings) {
    model.blockingSettings = data.blockingSettings;
  }

  if (data.blockingStatus) {
    model.blockingStatus = data.blockingStatus;
  }

  return model;
}

function onStatus(
  overrides: Partial<CloudflareBlockingStatus> = {},
): JSONObject {
  const status: CloudflareBlockingStatus = {
    checkedAt: new Date().toISOString(),
    accountId: ACCOUNT_ID,
    plan: CloudflarePlan.Free,
    setupDoneFor: "2026-11-21T10:00:00.000Z",
    actions: [
      {
        action: SecurityBlockAction.Block,
        choice: { mechanism: CloudflareBlockingMechanism.List },
        listId: "list-1",
        isInPlace: true,
      },
      {
        action: SecurityBlockAction.Challenge,
        choice: {
          mechanism: CloudflareBlockingMechanism.AccessRules,
          reason: CloudflareAccessRulesReason.NoListLeft,
          plan: CloudflarePlan.Free,
          lists: 1,
        },
        isInPlace: true,
      },
    ],
    zones: [
      {
        id: ZONE_A,
        name: "example.com",
        plan: CloudflarePlan.Free,
        rulesUsed: 2,
        rulesLimit: 5,
        rules: [
          {
            action: SecurityBlockAction.Block,
            state: CloudflareRuleState.TurnedOff,
            ruleId: "rule-1",
          },
        ],
        skipAddresses: ["203.0.113.7", "198.51.100.0/24"],
      },
    ],
    usage: { items: 1204, limit: 10000 },
    ...overrides,
  };

  return status as unknown as JSONObject;
}

const ON_SETTINGS: JSONObject = {
  isEnabled: true,
  zoneIds: [],
  turnedOnAt: "2026-11-21T10:00:00.000Z",
  setupRequestedAt: "2026-11-21T10:00:00.000Z",
};

async function openDialog(
  read: SecurityEventConnection,
  isTurningOff: boolean = false,
): Promise<{ onClose: MockedFn; onChanged: MockedFn }> {
  api.readBlockingConnection.mockResolvedValue(read as never);
  const onClose: MockedFn = jest.fn();
  const onChanged: MockedFn = jest.fn();

  await act(async () => {
    render(
      <CloudflareBlockingModal
        connectionId={CONNECTION_ID}
        onClose={onClose as unknown as () => void}
        onChanged={onChanged as unknown as () => void}
        isTurningOff={isTurningOff}
      />,
    );
  });

  return { onClose, onChanged };
}

function button(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

beforeEach(() => {
  dropdownProps = {};
  capturedTable = {};
  for (const mock of Object.values(api)) {
    mock.mockReset();
  }
  api.readBlockingZoneChoices.mockResolvedValue([
    { value: ZONE_A, label: "example.com", description: "Free" },
    { value: ZONE_B, label: "shop.example.com", description: "Pro" },
  ] as never);
  jest.spyOn(Toast, "success").mockImplementation((): string => {
    return "";
  });
  jest.spyOn(Toast, "info").mockImplementation((): string => {
    return "";
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the dialog, while blocking is off: the opt-in", () => {
  test("names the write permissions blocking needs, and the zones to choose from", async () => {
    await openDialog(connection({}));

    const permissions: HTMLElement = screen.getByTestId(
      CLOUDFLARE_BLOCKING_TEST_IDS.permissions,
    );
    expect(permissions).toHaveTextContent(
      "Account > Account Filter Lists > Edit",
    );
    expect(permissions).toHaveTextContent("Zone > Zone WAF > Edit");
    expect(permissions).toHaveTextContent(
      "Account > Account Firewall Access Rules > Edit",
    );
    expect(permissions).toHaveTextContent(
      "Only on a plan without a list or a custom rule to spare.",
    );

    await waitFor(() => {
      expect(dropdownProps["options"]).toEqual([
        { value: ZONE_A, label: "example.com · Free" },
        { value: ZONE_B, label: "shop.example.com · Pro" },
      ]);
    });
    // None chosen: every zone the connection reads.
    expect(dropdownProps["value"]).toEqual([]);
    expect(dropdownProps["placeholder"]).toBe("All zones");
    expect(button("Turn On Blocking")).toBeInTheDocument();
  });

  test("Check Permissions asks without turning anything on, and shows each check", async () => {
    api.checkBlocking.mockResolvedValue({
      isReady: false,
      checks: [
        {
          key: "blocking-lists",
          name: "Edit the lists",
          status: "fail",
          durationMs: 3,
          message: "The API token lacks Account > Account Filter Lists > Edit.",
        },
      ],
    } as never);
    await openDialog(connection({}));

    await act(async () => {
      fireEvent.click(button("Check Permissions"));
    });

    expect(api.checkBlocking).toHaveBeenCalledWith(CONNECTION_ID, {
      zoneIds: [],
    });
    expect(api.turnBlockingOn).not.toHaveBeenCalled();
    expect(
      screen.getByTestId(CLOUDFLARE_BLOCKING_TEST_IDS.checks),
    ).toHaveTextContent(
      "The API token lacks Account > Account Filter Lists > Edit.",
    );
  });

  test("Turn On Blocking sends the zones chosen and a pasted token, says it is on, and reads the connection again", async () => {
    api.turnBlockingOn.mockResolvedValue({
      isReady: true,
      checks: [],
    } as never);
    const { onChanged } = await openDialog(connection({}));

    await act(async () => {
      (dropdownProps["onChange"] as (value: Array<string>) => void)([ZONE_B]);
    });
    fireEvent.change(document.getElementById("cloudflare-blocking-token")!, {
      target: { value: "  New7Lq2Vx9Tb4Zw6Hy1Jm8Pd3Sg5Ua_-Kk0Oo  " },
    });

    await act(async () => {
      fireEvent.click(button("Turn On Blocking"));
    });

    expect(api.turnBlockingOn).toHaveBeenCalledWith(CONNECTION_ID, {
      zoneIds: [ZONE_B],
      secrets: { apiToken: "New7Lq2Vx9Tb4Zw6Hy1Jm8Pd3Sg5Ua_-Kk0Oo" },
    });
    expect(Toast.success).toHaveBeenCalledWith(TURNED_ON_TOAST);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(api.readBlockingConnection).toHaveBeenCalledTimes(2);
  });

  test("a check that fails keeps blocking off, and says so above what failed", async () => {
    api.turnBlockingOn.mockResolvedValue({
      isReady: false,
      checks: [
        {
          key: "blocking-rules",
          name: "Edit custom rules in each zone",
          status: "fail",
          durationMs: 3,
          message:
            "The API token cannot change the custom rules of example.com: it lacks Zone > Zone WAF > Edit there.",
        },
      ],
    } as never);
    const { onChanged } = await openDialog(connection({}));

    await act(async () => {
      fireEvent.click(button("Turn On Blocking"));
    });

    expect(screen.getByText(NOT_TURNED_ON)).toBeInTheDocument();
    expect(
      screen.getByTestId(CLOUDFLARE_BLOCKING_TEST_IDS.checks),
    ).toHaveTextContent("it lacks Zone > Zone WAF > Edit there.");
    expect(onChanged).not.toHaveBeenCalled();
    expect(Toast.success).not.toHaveBeenCalled();
  });
});

describe("the dialog, while blocking is on: how it stands", () => {
  test("says each action's mechanism and why, how many addresses Cloudflare holds of how many, and what the Free plan's rules take", async () => {
    await openDialog(
      connection({ blockingSettings: ON_SETTINGS, blockingStatus: onStatus() }),
    );

    const status: HTMLElement = screen.getByTestId(
      CLOUDFLARE_BLOCKING_TEST_IDS.status,
    );
    expect(status).toHaveTextContent(
      "List oneuptime_block, with a custom rule in each zone",
    );
    expect(status).toHaveTextContent(
      "IP Access Rules: your Cloudflare plan has no list to spare",
    );
    expect(status).toHaveTextContent("Addresses held: 1,204 of 10,000");
    expect(status).toHaveTextContent(
      "OneUptime's rule takes 1 of the 5 custom rules of example.com.",
    );
    // Its button saves zones, and only once they change.
    expect(button("Save Zones")).toBeDisabled();
    expect(button("Turn Off Blocking")).toBeInTheDocument();
  });

  test("a rule turned off at Cloudflare is said in the connection's words, with Put It Back for its zone", async () => {
    api.putBlockingBack.mockResolvedValue(undefined as never);
    await openDialog(
      connection({ blockingSettings: ON_SETTINGS, blockingStatus: onStatus() }),
    );

    expect(
      screen.getByTestId(CLOUDFLARE_BLOCKING_TEST_IDS.zoneProblem),
    ).toHaveTextContent(
      "Your rule in example.com was turned off: blocks there are not enforced",
    );

    await act(async () => {
      fireEvent.click(button("Put It Back"));
    });

    expect(api.putBlockingBack).toHaveBeenCalledWith(CONNECTION_ID, [ZONE_A]);
  });

  test("offers to protect the addresses the zones' skip rules let through, and protects them", async () => {
    const created: Array<SecurityProtectedEntity> = [];
    jest.spyOn(ModelAPI, "create").mockImplementation((async (data: {
      model: SecurityProtectedEntity;
    }) => {
      created.push(data.model);
      return { data: data.model } as never;
    }) as never);
    await openDialog(
      connection({ blockingSettings: ON_SETTINGS, blockingStatus: onStatus() }),
    );

    expect(
      screen.getByTestId(CLOUDFLARE_BLOCKING_TEST_IDS.skipAddresses),
    ).toHaveTextContent(
      "Your skip rules let 203.0.113.7, 198.51.100.0/24 through.",
    );

    await act(async () => {
      fireEvent.click(button("Protect These Addresses"));
    });

    expect(
      created.map((entity: SecurityProtectedEntity): string => {
        return `${entity.entityType} ${entity.value} ${entity.projectId?.toString()}`;
      }),
    ).toEqual([
      `${SecurityEntityType.IpAddress} 203.0.113.7 ${PROJECT_ID.toString()}`,
      `${SecurityEntityType.IpAddress} 198.51.100.0/24 ${PROJECT_ID.toString()}`,
    ]);
    expect(Toast.success).toHaveBeenCalledWith(
      getGlobalTranslator().translatePlural(ADDRESSES_PROTECTED_TOAST, 2),
    );
    expect(
      screen.queryByTestId(CLOUDFLARE_BLOCKING_TEST_IDS.skipAddresses),
    ).not.toBeInTheDocument();
  });

  test("while OneUptime sets Cloudflare up, it says so; what failed last is shown as the server said it", async () => {
    await openDialog(
      connection({
        blockingSettings: {
          ...ON_SETTINGS,
          setupRequestedAt: "2026-11-21T11:00:00.000Z",
        },
        blockingStatus: onStatus({
          error:
            "The API token cannot read the account's lists: give it Account > Account Filter Lists > Edit.",
          errorAt: "2026-11-21T11:00:05.000Z",
        }),
      }),
    );

    expect(
      screen.getByText(
        "OneUptime is setting up Cloudflare. This takes a minute.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The API token cannot read the account's lists: give it Account > Account Filter Lists > Edit.",
      ),
    ).toBeInTheDocument();
  });

  test("Turn Off Blocking asks whether to remove OneUptime's lists and rules, removing them unless told to keep them", async () => {
    api.turnBlockingOff.mockResolvedValue(undefined as never);
    await openDialog(
      connection({ blockingSettings: ON_SETTINGS, blockingStatus: onStatus() }),
    );

    await act(async () => {
      fireEvent.click(button("Turn Off Blocking"));
    });

    const remove: HTMLInputElement = screen.getByTestId(
      CLOUDFLARE_BLOCKING_TEST_IDS.removeCheckbox,
    ) as HTMLInputElement;
    expect(remove.checked).toBe(true);

    await act(async () => {
      fireEvent.click(button("Turn Off Blocking"));
    });

    expect(api.turnBlockingOff).toHaveBeenCalledWith(CONNECTION_ID, true);
    expect(Toast.success).toHaveBeenCalledWith(TURNED_OFF_REMOVING_TOAST);
  });

  test("kept, nothing is asked of Cloudflare", async () => {
    api.turnBlockingOff.mockResolvedValue(undefined as never);
    await openDialog(
      connection({ blockingSettings: ON_SETTINGS, blockingStatus: onStatus() }),
      true,
    );

    fireEvent.click(
      screen.getByTestId(CLOUDFLARE_BLOCKING_TEST_IDS.removeCheckbox),
    );

    await act(async () => {
      fireEvent.click(button("Turn Off Blocking"));
    });

    expect(api.turnBlockingOff).toHaveBeenCalledWith(CONNECTION_ID, false);
    expect(Toast.success).toHaveBeenCalledWith(TURNED_OFF_TOAST);
  });
});

describe("the API module", () => {
  test("names each action's route, and sends a token only when one is pasted", () => {
    expect(getBlockingRoute(CONNECTION_ID, "turn-on")).toBe(
      `/security-event-connection/${CONNECTION_ID.toString()}/blocking/turn-on`,
    );
    expect(getBlockingBody({ zoneIds: [ZONE_A], apiToken: "  " })).toEqual({
      zoneIds: [ZONE_A],
    });
  });

  test("the zones offered are the connection's account's, narrowed to the zones it reads", async () => {
    const read: SecurityEventConnection = connection({});
    read.config = { accountId: ACCOUNT_ID, zoneIds: ZONE_B };

    // The module's own, not the dialog's stand-in.
    type ZoneChoicesModule = {
      readBlockingZoneChoices: (
        connection: SecurityEventConnection,
        fetcher: () => Promise<unknown>,
      ) => Promise<Array<{ value: string }>>;
    };
    const actual: ZoneChoicesModule = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CloudflareBlocking/CloudflareBlockingApi",
    ) as ZoneChoicesModule;
    const zones: Array<{ value: string }> =
      await actual.readBlockingZoneChoices(read, async () => {
        return {
          provider: SecurityEventConnectorProvider.Cloudflare,
          choices: {
            accountId: [],
            zoneIds: [
              { value: ZONE_A, label: "example.com", parentValue: ACCOUNT_ID },
              {
                value: ZONE_B,
                label: "shop.example.com",
                parentValue: ACCOUNT_ID,
              },
              {
                value: "cccccccccccccccccccccccccccccccc",
                label: "other.example",
                parentValue: "1b2c3d4e5f60718293a4b5c6d7e8f901",
              },
            ],
          },
        };
      });

    expect(
      zones.map((zone: { value: string }): string => {
        return zone.value;
      }),
    ).toEqual([ZONE_B]);
  });
});

describe("the connection's row", () => {
  test("says a connection blocks addresses, and when that needs a look", () => {
    expect(getConnectionBlockingDetail(connection({}))).toBeNull();
    expect(
      getConnectionBlockingDetail(
        connection({
          blockingSettings: ON_SETTINGS,
          blockingStatus: onStatus({
            zones: [],
          }),
        }),
      ),
    ).toBe("Blocks addresses");
    expect(
      getConnectionBlockingDetail(
        connection({
          blockingSettings: ON_SETTINGS,
          blockingStatus: onStatus(),
        }),
      ),
    ).toBe("Blocking needs attention");
  });

  test("Block Addresses is a Cloudflare connection's alone, and a delete of one that blocks offers to turn blocking off", async () => {
    render(<SecurityEventConnectionsTable />);

    const action: {
      title: string;
      isVisible: (item: SecurityEventConnection) => boolean;
    } = (
      capturedTable["actionButtons"] as Array<{
        title: string;
        isVisible: (item: SecurityEventConnection) => boolean;
      }>
    ).find((candidate: { title: string }): boolean => {
      return candidate.title === "Block Addresses";
    })!;

    const okta: SecurityEventConnection = new SecurityEventConnection();
    okta.provider = SecurityEventConnectorProvider.OktaSystemLog;
    expect(action.isVisible(connection({}))).toBe(true);
    expect(action.isVisible(okta)).toBe(false);

    const getDeleteConfirmation: (
      item: SecurityEventConnection,
    ) => Promise<DeleteConfirmation> = capturedTable[
      "getDeleteConfirmation"
    ] as (item: SecurityEventConnection) => Promise<DeleteConfirmation>;

    expect(await getDeleteConfirmation(connection({}))).toEqual({});

    const blocking: DeleteConfirmation = await getDeleteConfirmation(
      connection({ blockingSettings: ON_SETTINGS }),
    );
    expect(blocking.isDeleteBlocked).toBe(true);
    expect(blocking.description).toBe(
      "Production Cloudflare blocks addresses at Cloudflare. Turn blocking off first: OneUptime then asks whether to remove its lists and rules from Cloudflare.",
    );
    expect(blocking.alternative?.title).toBe("Turn Off Blocking");
  });
});

describe("a block's Cloudflare chip on the Blocklist", () => {
  const now: Date = new Date();

  function activeBlock(): SecurityBlock {
    const block: SecurityBlock = new SecurityBlock();
    block.value = "35.205.11.131";
    block.state = SecurityBlockState.Active;
    block.action = SecurityBlockAction.Block;
    return block;
  }

  function cloudflare(
    data: Partial<SecurityBlockEnforcement>,
  ): SecurityBlockEnforcement {
    const row: SecurityBlockEnforcement = new SecurityBlockEnforcement();
    row.destinationKey = `Cloudflare:${CONNECTION_ID.toString()}`;
    row.destinationName = "Cloudflare";
    Object.assign(row, data);
    return row;
  }

  test("held and read back lately: Enforced at Cloudflare, and never Not enforced", () => {
    const row: SecurityBlockEnforcement = cloudflare({
      state: SecurityBlockEnforcementState.Applied,
      lastConfirmedAt: now,
    });

    render(
      <BlockEnforcedAtCell
        block={activeBlock()}
        enforcements={[row]}
        now={now}
      />,
    );

    expect(screen.getByText("Cloudflare")).toBeInTheDocument();
    expect(
      screen.queryByTestId(BLOCKLIST_TEST_IDS.notEnforced),
    ).not.toBeInTheDocument();
  });

  test("a rule turned off at Cloudflare: Not enforced, and the chip says why on hover", () => {
    const row: SecurityBlockEnforcement = cloudflare({
      state: SecurityBlockEnforcementState.Failed,
      error:
        "Your rule in example.com was turned off: blocks there are not enforced",
    });

    render(
      <BlockEnforcedAtCell
        block={activeBlock()}
        enforcements={[row]}
        now={now}
      />,
    );

    expect(
      screen.getByTestId(BLOCKLIST_TEST_IDS.notEnforced),
    ).toBeInTheDocument();
    expect(writeEnforcementTooltip(getGlobalTranslator(), row, now)).toBe(
      "Cloudflare does not hold this block. Your rule in example.com was turned off: blocks there are not enforced",
    );
  });
});

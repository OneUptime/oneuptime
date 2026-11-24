import AuditLogService from "../../../Server/Services/AuditLogService";
import SecurityBlockService, {
  SecurityBlockOutcome,
  SecurityBlockOutcomeStatus,
} from "../../../Server/Services/SecurityBlockService";
import SecurityBlockCloudWafService from "../../../Server/Services/SecurityBlockCloudWafService";
import SecurityBlocklistFeedService from "../../../Server/Services/SecurityBlocklistFeedService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityEventConnectionService from "../../../Server/Services/SecurityEventConnectionService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import logger from "../../../Server/Utils/Logger";
import SecurityBlockDestination from "../../../Server/Utils/SecurityBlocklist/SecurityBlockDestination";
import SecurityBlockDestinations from "../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import SecurityBlocklistJobs from "../../../Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import SecurityProtectedAddresses from "../../../Server/Utils/SecurityBlocklist/SecurityProtectedAddresses";
import TestSecurityBlockDestination from "../../../Server/Utils/SecurityBlocklist/TestSecurityBlockDestination";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SECURITY_BLOCK_MESSAGES,
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockReach,
  SecurityBlockSource,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A WHOLE NETWORK BY ITS ASN ON THE BLOCKLIST (#10354), through the
 * Blocklist's one way in and its whole create, with the table in memory:
 *
 *   - only a person who may block past the largest range blocks one - a
 *     Security Admin, a Project Admin or Owner - and never OneUptime's own
 *     writes;
 *   - OneUptime cannot tell whether a network holds the project's own
 *     servers or its users, so it is blocked only when the person said they
 *     know (acknowledgesUncheckedNetwork) - a create through the API is
 *     refused, failing toward a person;
 *   - it is held at the edge alone, and refused when nothing connected
 *     holds one;
 *   - a second challenge of the same network is already blocked.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

const SECURITY_ADMIN: Array<Permission> = [Permission.SecurityAdmin];
const SECURITY_MEMBER: Array<Permission> = [Permission.SecurityMember];

function useDestinations(destinations: Array<SecurityBlockDestination>): void {
  SecurityBlockDestinations.setSourcesForTests([
    {
      provider: SecurityBlockDestinationProvider.Test,
      findForProject: async (): Promise<Array<SecurityBlockDestination>> => {
        return destinations;
      },
    },
  ]);
}

// An edge that holds addresses and ranges, never a network by its ASN: a firewall's feed, say.
class AddressOnlyDestination extends TestSecurityBlockDestination {
  public override supports(entry: {
    indicatorType: SecurityBlockIndicatorType;
    action: SecurityBlockAction;
    value: string;
  }): ReturnType<SecurityBlockDestination["supports"]> {
    if (entry.indicatorType === SecurityBlockIndicatorType.Asn) {
      return {
        isSupported: false,
        reason: "the feed serves addresses only",
      };
    }

    return super.supports(entry);
  }
}

describe("SecurityBlockService: a network by its ASN", () => {
  const service: DatabaseService<BaseModel> =
    SecurityBlockService as unknown as DatabaseService<BaseModel>;
  let table: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    stubProjectDirectory({ projectId: PROJECT_ID });
    jest.spyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(SecurityBlocklistJobs, "queueReconcile")
      .mockResolvedValue(undefined);
    jest
      .spyOn(SecurityProtectedAddresses, "findProtection")
      .mockResolvedValue({ protection: null, unreadSources: [] });
    jest
      .spyOn(SecurityBlocklistFeedService, "findForProject")
      .mockResolvedValue([]);
    jest.spyOn(AuditLogService, "recordCreate").mockResolvedValue(undefined);
    jest
      .spyOn(SecurityBlockCloudWafService, "findForProject")
      .mockResolvedValue([]);

    table = useInMemoryTable(service, []);

    // Cloudflare with blocking on, which holds a network by its ASN.
    useDestinations([new TestSecurityBlockDestination({ name: "Cloudflare" })]);
  });

  afterEach(() => {
    SecurityBlockDestinations.resetSourcesForTests();
    jest.restoreAllMocks();
  });

  test("a Security Admin who knows it is unchecked challenges a network by its ASN, at the edge, for the length asked", async () => {
    const props: DatabaseCommonInteractionProps = member(SECURITY_ADMIN);

    const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
      projectId: PROJECT_ID,
      value: "as14061",
      action: SecurityBlockAction.Challenge,
      reach: SecurityBlockReach.Everywhere,
      duration: SecurityBlockDuration.OneDay,
      acknowledgesUncheckedNetwork: true,
      props,
    });

    expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Blocked);
    expect(table.rows).toHaveLength(1);

    const stored: StoredRow = table.rows[0]!;
    expect(stored["value"]).toBe("AS14061");
    expect(stored["indicatorType"]).toBe(SecurityBlockIndicatorType.Asn);
    expect(stored["action"]).toBe(SecurityBlockAction.Challenge);
    // Only an edge knows a request's ASN: never on every machine.
    expect(stored["reach"]).toBe(SecurityBlockReach.Edge);
    expect(stored["state"]).toBe(SecurityBlockState.Active);
    expect(stored["source"]).toBe(SecurityBlockSource.Person);
    expect(stored["expiresAt"]).not.toBeNull();
  });

  test("without saying they know OneUptime cannot check it, even a Security Admin is refused", async () => {
    const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
      projectId: PROJECT_ID,
      value: "AS14061",
      action: SecurityBlockAction.Challenge,
      props: member(SECURITY_ADMIN),
    });

    expect(outcome).toEqual({
      status: SecurityBlockOutcomeStatus.Refused,
      message: SECURITY_BLOCK_MESSAGES.asnUnchecked({ value: "AS14061" }),
    });
    expect(table.rows).toHaveLength(0);
  });

  test("a Security Member is refused, saying it takes a Security Admin, whatever they say they know", async () => {
    const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
      projectId: PROJECT_ID,
      value: "AS14061",
      action: SecurityBlockAction.Challenge,
      acknowledgesUncheckedNetwork: true,
      props: member(SECURITY_MEMBER),
    });

    expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Refused);
    expect(
      (outcome as { message: string }).message.includes("Security Admin"),
    ).toBe(true);
    expect(table.rows).toHaveLength(0);
  });

  test("OneUptime's own writes never block one", async () => {
    const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
      projectId: PROJECT_ID,
      value: "AS14061",
      action: SecurityBlockAction.Challenge,
      source: SecurityBlockSource.AutomaticResponse,
      acknowledgesUncheckedNetwork: true,
      props: { isRoot: true },
    });

    expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Refused);
    expect(table.rows).toHaveLength(0);
  });

  test("a create through the API is refused, failing toward a person", async () => {
    const block: SecurityBlock = new SecurityBlock();
    block.projectId = PROJECT_ID;
    block.value = "AS14061";
    block.action = SecurityBlockAction.Challenge;

    await expect(
      SecurityBlockService.create({
        data: block,
        props: member(SECURITY_ADMIN),
      }),
    ).rejects.toThrow("cannot tell whether AS14061 holds your own servers");
    expect(table.rows).toHaveLength(0);
  });

  test("with nothing connected that holds one, it is refused, saying what to turn on", async () => {
    useDestinations([new AddressOnlyDestination({ name: "Firewall feed" })]);

    const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
      projectId: PROJECT_ID,
      value: "AS14061",
      action: SecurityBlockAction.Challenge,
      acknowledgesUncheckedNetwork: true,
      props: member(SECURITY_ADMIN),
    });

    expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Refused);
    expect((outcome as { message: string }).message).toContain("Cloudflare");
    expect(table.rows).toHaveLength(0);
  });

  test("a network challenged already is already blocked, naming the challenge", async () => {
    const props: DatabaseCommonInteractionProps = member(SECURITY_ADMIN);

    await SecurityBlockService.block({
      projectId: PROJECT_ID,
      value: "AS14061",
      action: SecurityBlockAction.Challenge,
      acknowledgesUncheckedNetwork: true,
      props,
    });

    const again: SecurityBlockOutcome = await SecurityBlockService.block({
      projectId: PROJECT_ID,
      value: "as 14061",
      action: SecurityBlockAction.Block,
      acknowledgesUncheckedNetwork: true,
      props,
    });

    expect(again.status).toBe(SecurityBlockOutcomeStatus.AlreadyBlocked);
    expect(table.rows).toHaveLength(1);
  });

  test("an address and a range are blocked as before, with no acknowledgement asked", async () => {
    const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
      projectId: PROJECT_ID,
      value: "203.0.113.0/24",
      action: SecurityBlockAction.Challenge,
      props: member(SECURITY_MEMBER),
    });

    expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Blocked);
    expect(table.rows[0]!["indicatorType"]).toBe(
      SecurityBlockIndicatorType.IpRange,
    );
  });
});

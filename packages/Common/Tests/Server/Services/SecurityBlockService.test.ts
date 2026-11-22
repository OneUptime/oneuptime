import AuditLogService from "../../../Server/Services/AuditLogService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityBlockService, {
  SecurityBlockLiftStatus,
  SecurityBlockOutcome,
  SecurityBlockOutcomeStatus,
} from "../../../Server/Services/SecurityBlockService";
import SecurityBlocklistFeedService from "../../../Server/Services/SecurityBlocklistFeedService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityEventConnectionService from "../../../Server/Services/SecurityEventConnectionService";
import SecurityBlockCloudWafService from "../../../Server/Services/SecurityBlockCloudWafService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import logger from "../../../Server/Utils/Logger";
import SecurityBlocklistJobs from "../../../Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import SecurityBlockDestinations from "../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import SecurityProtectedAddresses, {
  SecurityProtectionCheck,
} from "../../../Server/Utils/SecurityBlocklist/SecurityProtectedAddresses";
import TestSecurityBlockDestination from "../../../Server/Utils/SecurityBlocklist/TestSecurityBlockDestination";
import SecurityProtectedIndicators from "../../../Server/Utils/SecurityBlocklist/SecurityProtectedIndicators";
import SecurityCaseStepChecks from "../../../Server/Utils/SecurityCase/StepChecks/SecurityCaseStepChecks";
import SecurityBlockDestination from "../../../Server/Utils/SecurityBlocklist/SecurityBlockDestination";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockReach,
  SecurityBlockSource,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SecurityProtectedAddressSource } from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
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
import type { SpyInstance } from "jest-mock";

/*
 * THE BLOCKLIST'S ONE WAY IN (#10338), through the whole create and update:
 * the hooks, the permission checks and the success hooks, with the table in
 * memory.
 *
 *   - adding a block: its value written one way, 24 hours unless asked, its
 *     kind and who made it recorded by OneUptime, its case's timeline told
 *     and the blocklist reconciled;
 *   - refusing one: protected (and what protects it), already blocked (and
 *     by which range), a range too wide, a block kept until lifted by
 *     someone who may not, and when what would protect it cannot be read;
 *   - renewing, making permanent and lifting one, each said on the case's
 *     timeline, with who lifted it and when written by OneUptime;
 *   - what never changes: a block's value and action, an ended block, and
 *     that no block is deleted;
 *   - the audit log: each block made, renewed and lifted is in it, as the
 *     person's who did it (the expiry's own is SecurityBlockExpiry's).
 *
 * Who may do each is the model's lists, held by the real permission layer:
 * this suite runs each as the people the lists name.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const BLOCK_ID: string = "33333333-3333-4333-8333-333333333333";
const RANGE_ID: string = "44444444-4444-4444-8444-444444444444";

const HOUR_IN_MS: number = 60 * 60 * 1000;

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

// Who may block and lift: the model's create and update lists.
const BLOCKERS: Array<[string, Array<Permission>]> = [
  ["a Project Owner", [Permission.ProjectOwner]],
  ["a Project Admin", [Permission.ProjectAdmin]],
  ["a Security Admin", [Permission.SecurityAdmin]],
  ["a Security Member", [Permission.SecurityMember]],
];

const SECURITY_MEMBER: Array<Permission> = [Permission.SecurityMember];
const SECURITY_ADMIN: Array<Permission> = [Permission.SecurityAdmin];

// A Security Member who is a Project Member too, and so reads the project's hosts and named addresses.
const MEMBER_WHO_READS_RECORDS: Array<Permission> = [
  Permission.SecurityMember,
  Permission.ProjectMember,
];

async function refusalOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected a refusal, but it went through.");
}

describe("SecurityBlockService", () => {
  const service: DatabaseService<BaseModel> =
    SecurityBlockService as unknown as DatabaseService<BaseModel>;
  let table: InMemoryTable;
  let feedSpy: SpyInstance<
    typeof SecurityCaseFeedService.createSecurityCaseFeedItem
  >;
  let reconcileSpy: SpyInstance<typeof SecurityBlocklistJobs.queueReconcile>;
  let protectionSpy: SpyInstance<
    typeof SecurityProtectedAddresses.findProtection
  >;
  let auditCreateSpy: SpyInstance<typeof AuditLogService.recordCreate>;
  let auditUpdateSpy: SpyInstance<typeof AuditLogService.recordUpdate>;
  let stepCheckSpy: SpyInstance<typeof SecurityCaseStepChecks.requestCheck>;

  // What the audit log was handed of each change: the columns and who made it.
  function auditedCreates(): Array<{ value: unknown; userId: unknown }> {
    return auditCreateSpy.mock.calls.map((call: Array<unknown>) => {
      const data: {
        createdItem: BaseModel;
        props: DatabaseCommonInteractionProps;
      } = call[0] as never;
      return {
        value: data.createdItem.getValue("value"),
        userId: data.props.userId?.toString(),
      };
    });
  }

  function auditedUpdates(): Array<{
    fields: Record<string, unknown>;
    userId: unknown;
  }> {
    return auditUpdateSpy.mock.calls.map((call: Array<unknown>) => {
      const data: {
        updatedFields: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      } = call[0] as never;
      return {
        fields: data.updatedFields,
        userId: data.props.userId?.toString(),
      };
    });
  }

  function rows(): Array<StoredRow> {
    return table.rows;
  }

  function activeBlock(data: {
    id: string;
    value: string;
    indicatorType?: SecurityBlockIndicatorType | undefined;
    expiresAt?: Date | null | undefined;
    state?: SecurityBlockState | undefined;
    securityCaseId?: ObjectID | undefined;
  }): StoredRow {
    return {
      _id: data.id,
      projectId: PROJECT_ID.toString(),
      value: data.value,
      indicatorType: data.indicatorType || SecurityBlockIndicatorType.IpAddress,
      action: SecurityBlockAction.Block,
      state: data.state || SecurityBlockState.Active,
      expiresAt:
        data.expiresAt === undefined
          ? new Date(Date.now() + 24 * HOUR_IN_MS)
          : data.expiresAt,
      source: SecurityBlockSource.Person,
      createdAt: new Date(Date.now() - HOUR_IN_MS),
      ...(data.securityCaseId
        ? { securityCaseId: data.securityCaseId.toString() }
        : {}),
      version: 1,
    };
  }

  function feedLines(): Array<string> {
    return feedSpy.mock.calls.map((call: Array<unknown>): string => {
      return String(
        (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown,
      );
    });
  }

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    // The case a block names is the project's.
    stubProjectDirectory({ projectId: PROJECT_ID });

    /*
     * The project has no Cloudflare connection, the one kind of destination
     * that ships (#10343): nothing enforces its blocklist until a test says.
     */
    jest.spyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([]);

    feedSpy = jest
      .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
      .mockResolvedValue(undefined as never);
    reconcileSpy = jest
      .spyOn(SecurityBlocklistJobs, "queueReconcile")
      .mockResolvedValue(undefined);
    protectionSpy = jest
      .spyOn(SecurityProtectedAddresses, "findProtection")
      .mockResolvedValue({ protection: null, unreadSources: [] });
    // The project has made no blocklist feed (#10345): nothing enforces its blocks.
    jest
      .spyOn(SecurityBlocklistFeedService, "findForProject")
      .mockResolvedValue([]);
    auditCreateSpy = jest
      .spyOn(AuditLogService, "recordCreate")
      .mockResolvedValue(undefined);
    auditUpdateSpy = jest
      .spyOn(AuditLogService, "recordUpdate")
      .mockResolvedValue(undefined);

    table = useInMemoryTable(service, []);

    /*
     * Nothing enforces the blocklist unless a test says (#10346 registers the
     * Microsoft Defender and CrowdStrike kinds, which read connections), and
     * a case's steps are checked again at each of its block's lines.
     */
    SecurityBlockDestinations.setSourcesForTests([]);
    stepCheckSpy = jest
      .spyOn(SecurityCaseStepChecks, "requestCheck")
      .mockResolvedValue(undefined);

    /*
     * The case a block is made for: read as the caller reads it, so it may be
     * named (the create's read of the records it names, from their table).
     */
    useInMemoryTable(
      SecurityCaseService as unknown as DatabaseService<BaseModel>,
      [
        {
          _id: CASE_ID.toString(),
          projectId: PROJECT_ID.toString(),
          title: "Brute force against /login",
          version: 1,
        },
      ],
    );
    getJestSpyOn(DatabaseService, "getParentReader").mockImplementation(
      ((modelType: { new (): BaseModel }) => {
        expect(new modelType().tableName).toBe("SecurityCase");
        return SecurityCaseService;
      }) as never,
    );

    // The project has picked no cloud WAF (#10344): its production source lists none.
    jest
      .spyOn(SecurityBlockCloudWafService, "findForProject")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    SecurityBlockDestinations.resetSourcesForTests();
    jest.restoreAllMocks();
  });

  describe("adding a block", () => {
    test.each(BLOCKERS)(
      "%s blocks an address for 24 hours, written one way, with its kind and who made it recorded",
      async (_who: string, permissions: Array<Permission>) => {
        const props: DatabaseCommonInteractionProps = member(permissions);
        const before: number = Date.now();

        const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
          projectId: PROJECT_ID,
          value: "  2001:0DB8:0000:0000:0000:0000:0000:0007  ",
          reason: "  Scanning /wp-admin  ",
          props,
        });

        expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Blocked);
        expect(rows()).toHaveLength(1);

        const stored: StoredRow = rows()[0]!;
        expect(stored["value"]).toBe("2001:db8::7");
        expect(stored["indicatorType"]).toBe(
          SecurityBlockIndicatorType.IpAddress,
        );
        expect(stored["action"]).toBe(SecurityBlockAction.Block);
        expect(stored["state"]).toBe(SecurityBlockState.Active);
        expect(stored["source"]).toBe(SecurityBlockSource.Person);
        expect(stored["reason"]).toBe("Scanning /wp-admin");
        expect(String(stored["createdByUserId"])).toBe(
          props.userId!.toString(),
        );

        // Every block expires: a day from now unless asked otherwise.
        const expiresAt: number = new Date(
          stored["expiresAt"] as Date,
        ).getTime();
        expect(expiresAt).toBeGreaterThanOrEqual(before + 24 * HOUR_IN_MS);
        expect(expiresAt).toBeLessThanOrEqual(Date.now() + 24 * HOUR_IN_MS);

        expect(reconcileSpy).toHaveBeenCalledWith(PROJECT_ID);

        // In the audit log, as the person's.
        expect(auditedCreates()).toEqual([
          { value: "2001:db8::7", userId: props.userId!.toString() },
        ]);
      },
    );

    test("a range is kept as its first address and its length, and a /32 as the address", async () => {
      await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "35.205.11.77/24",
        props: member(SECURITY_MEMBER),
      });
      await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "198.51.100.9/32",
        props: member(SECURITY_MEMBER),
      });

      expect(
        rows().map((row: StoredRow): [unknown, unknown] => {
          return [row["value"], row["indicatorType"]];
        }),
      ).toEqual([
        ["35.205.11.0/24", SecurityBlockIndicatorType.IpRange],
        ["198.51.100.9", SecurityBlockIndicatorType.IpAddress],
      ]);
    });

    test("a block for a case goes on its timeline, says nothing enforces it yet, and names the person", async () => {
      const props: DatabaseCommonInteractionProps = member(SECURITY_MEMBER);

      await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "35.205.11.131",
        duration: SecurityBlockDuration.SevenDays,
        reason: "Brute force against /login",
        securityCaseId: CASE_ID,
        props,
      });

      expect(feedSpy).toHaveBeenCalledTimes(1);
      expect(feedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT_ID,
          securityCaseId: CASE_ID,
          userId: props.userId,
        }),
      );
      // The reason last: someone's words, which need not end a sentence.
      expect(feedLines()).toEqual([
        "🚫 Blocked `35.205.11.131` for 7 days. Nothing enforces the blocklist yet, so it is not blocked anywhere: connect Cloudflare, AWS WAF, Azure WAF, Cloud Armor or a firewall that reads a list. Reason: Brute force against /login",
      ]);
    });

    test("with a destination, the timeline line does not say nothing enforces it", async () => {
      SecurityBlockDestinations.setSourcesForTests([
        {
          provider: SecurityBlockDestinationProvider.Test,
          findForProject: async () => {
            return [new TestSecurityBlockDestination()];
          },
        },
      ]);

      await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "35.205.11.131",
        securityCaseId: CASE_ID,
        props: member(SECURITY_MEMBER),
      });

      expect(feedLines()[0]).toContain("Blocked `35.205.11.131` for 24 hours.");
      expect(feedLines()[0]).not.toContain("Nothing enforces");
    });

    test("a block without a case writes no timeline", async () => {
      await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "35.205.11.131",
        props: member(SECURITY_MEMBER),
      });

      expect(feedSpy).not.toHaveBeenCalled();
    });

    test("OneUptime's own block says what made it, and keeps its playbook run", async () => {
      const runId: ObjectID = ObjectID.generate();

      const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "35.205.11.131",
        action: SecurityBlockAction.Challenge,
        source: SecurityBlockSource.Playbook,
        securityPlaybookRunId: runId,
        securityCaseId: CASE_ID,
        props: ROOT,
      });

      expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Blocked);
      expect(rows()[0]!["source"]).toBe(SecurityBlockSource.Playbook);
      expect(String(rows()[0]!["securityPlaybookRunId"])).toBe(
        runId.toString(),
      );
      expect(rows()[0]!["createdByUserId"]).toBeFalsy();
      expect(feedLines()[0]).toContain(
        "A playbook challenged `35.205.11.131` for 24 hours.",
      );
    });

    test("an API key's block is the API's, with no person on it", async () => {
      const props: DatabaseCommonInteractionProps = {
        ...customDomainCaller({
          permissions: SECURITY_MEMBER,
          projectId: PROJECT_ID,
          isApiKey: true,
        }),
        ...ON_HIGHEST_PLAN,
      };

      await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "35.205.11.131",
        props,
      });

      expect(rows()[0]!["source"]).toBe(SecurityBlockSource.Api);
      expect(rows()[0]!["createdByUserId"]).toBeFalsy();
    });

    test("a block made through the API's create is checked as block() checks it", async () => {
      protectionSpy.mockResolvedValue({
        protection: {
          source: SecurityProtectedAddressSource.Host,
          protectedValue: "203.0.113.10",
          name: "web-3",
        },
        unreadSources: [],
      });

      const model: SecurityBlock = new SecurityBlock();
      model.projectId = PROJECT_ID;
      model.value = "203.0.113.10";

      const error: Error = await refusalOf(
        service.create({
          data: model as unknown as BaseModel,
          props: member(MEMBER_WHO_READS_RECORDS),
        }),
      );

      expect(error.message).toBe("203.0.113.10 is the address of host web-3.");
      expect(rows()).toHaveLength(0);
    });

    test("what only OneUptime writes is not the caller's to give: a create naming its source and state is made Active, by a person", async () => {
      const model: SecurityBlock = new SecurityBlock();
      model.projectId = PROJECT_ID;
      model.value = "35.205.11.131";
      model.source = SecurityBlockSource.OneUptimeAi;

      await service.create({
        data: model as unknown as BaseModel,
        props: member(SECURITY_MEMBER),
      });

      expect(rows()[0]!["source"]).toBe(SecurityBlockSource.Person);
      expect(rows()[0]!["state"]).toBe(SecurityBlockState.Active);
    });

    test("a Security Viewer may not block, and is told nothing of the address", async () => {
      const error: Error = await refusalOf(
        SecurityBlockService.block({
          projectId: PROJECT_ID,
          value: "203.0.113.10",
          props: member([Permission.SecurityViewer]),
        }),
      );

      expect(error.message).not.toContain("web-3");
      expect(protectionSpy).not.toHaveBeenCalled();
      expect(rows()).toHaveLength(0);
    });
  });

  describe("refusing a block", () => {
    test("a protected address is refused, saying what protects it", async () => {
      protectionSpy.mockResolvedValue({
        protection: {
          source: SecurityProtectedAddressSource.CloudResource,
          protectedValue: "203.0.113.10",
          name: "prod-alb",
          kind: "Application Load Balancer",
          where: "Production",
        },
        unreadSources: [],
      });

      const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "203.0.113.10",
        props: ROOT,
        source: SecurityBlockSource.Playbook,
      });

      expect(outcome).toEqual(
        expect.objectContaining({
          status: SecurityBlockOutcomeStatus.Protected,
          message:
            "203.0.113.10 is the address of Application Load Balancer prod-alb in Production.",
        }),
      );
      expect(rows()).toHaveLength(0);
    });

    test("a range that holds a protected address says which, and what it is", async () => {
      protectionSpy.mockResolvedValue({
        protection: {
          source: SecurityProtectedAddressSource.Host,
          protectedValue: "35.205.11.131",
          name: "web-3",
        },
        unreadSources: [],
      });

      const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "35.205.11.0/24",
        props: member(MEMBER_WHO_READS_RECORDS),
      });

      expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Protected);
      expect((outcome as { message: string }).message).toBe(
        "35.205.11.0/24 holds 35.205.11.131. 35.205.11.131 is the address of host web-3.",
      );
    });

    test("an address the project's own range holds says it is inside it", async () => {
      protectionSpy.mockResolvedValue({
        protection: {
          source: SecurityProtectedAddressSource.AddressName,
          protectedValue: "2001:db8::/32",
          name: "Office",
        },
        unreadSources: [],
      });

      const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "2001:db8:5::1",
        props: member(MEMBER_WHO_READS_RECORDS),
      });

      expect((outcome as { message: string }).message).toBe(
        "2001:db8:5::1 is inside 2001:db8::/32. 2001:db8::/32 is named Office in your Address Names.",
      );
    });

    test("a reader who may not read the record is told only that the address is the project's own", async () => {
      protectionSpy.mockResolvedValue({
        protection: {
          source: SecurityProtectedAddressSource.Host,
          protectedValue: "203.0.113.10",
          name: "web-3",
          recordId: ObjectID.generate().toString(),
        },
        unreadSources: [],
      });

      const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "203.0.113.10",
        props: member(SECURITY_MEMBER),
      });

      expect((outcome as { message: string }).message).toBe(
        "203.0.113.10 is one of your project's own addresses.",
      );
    });

    test("when what would protect it cannot be read, the block is not made", async () => {
      protectionSpy.mockResolvedValue({
        protection: null,
        unreadSources: [SecurityProtectedAddressSource.Host],
      } as SecurityProtectionCheck);

      const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "35.205.11.131",
        props: member(SECURITY_MEMBER),
      });

      expect(outcome).toEqual({
        status: SecurityBlockOutcomeStatus.Refused,
        message:
          "OneUptime could not check whether 35.205.11.131 is one of your own addresses, so it did not block it. Try again in a minute.",
      });
      expect(rows()).toHaveLength(0);
    });

    test("a value already blocked is already blocked, and a range that covers it is named", async () => {
      table = useInMemoryTable(service, [
        activeBlock({ id: BLOCK_ID, value: "35.205.11.131" }),
        activeBlock({
          id: RANGE_ID,
          value: "198.51.100.0/24",
          indicatorType: SecurityBlockIndicatorType.IpRange,
        }),
      ]);

      const same: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "35.205.11.131",
        props: member(SECURITY_MEMBER),
      });
      const covered: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "198.51.100.7",
        props: member(SECURITY_MEMBER),
      });

      expect(same).toEqual(
        expect.objectContaining({
          status: SecurityBlockOutcomeStatus.AlreadyBlocked,
          message: "35.205.11.131 is already blocked.",
        }),
      );
      expect(covered).toEqual(
        expect.objectContaining({
          status: SecurityBlockOutcomeStatus.AlreadyBlocked,
          message:
            "198.51.100.7 is already blocked: 198.51.100.0/24 covers it.",
        }),
      );
      expect((covered as { block: SecurityBlock }).block.id?.toString()).toBe(
        RANGE_ID,
      );
      expect(rows()).toHaveLength(2);
    });

    test("an ended block, or one past its expiry, does not cover the value", async () => {
      table = useInMemoryTable(service, [
        activeBlock({
          id: BLOCK_ID,
          value: "35.205.11.131",
          state: SecurityBlockState.Lifted,
        }),
        activeBlock({
          id: RANGE_ID,
          value: "198.51.100.0/24",
          indicatorType: SecurityBlockIndicatorType.IpRange,
          expiresAt: new Date(Date.now() - HOUR_IN_MS),
        }),
      ]);

      expect(
        (
          await SecurityBlockService.block({
            projectId: PROJECT_ID,
            value: "35.205.11.131",
            props: member(SECURITY_MEMBER),
          })
        ).status,
      ).toBe(SecurityBlockOutcomeStatus.Blocked);
      expect(
        (
          await SecurityBlockService.block({
            projectId: PROJECT_ID,
            value: "198.51.100.7",
            props: member(SECURITY_MEMBER),
          })
        ).status,
      ).toBe(SecurityBlockOutcomeStatus.Blocked);
    });

    test("a range wider than a /24 or a /48 takes a Security Admin; nobody goes past a /8 or a /16", async () => {
      const memberOutcome: SecurityBlockOutcome =
        await SecurityBlockService.block({
          projectId: PROJECT_ID,
          value: "35.205.0.0/16",
          props: member(SECURITY_MEMBER),
        });
      const v6MemberOutcome: SecurityBlockOutcome =
        await SecurityBlockService.block({
          projectId: PROJECT_ID,
          value: "2001:db8::/32",
          props: member(SECURITY_MEMBER),
        });

      expect(memberOutcome).toEqual({
        status: SecurityBlockOutcomeStatus.Refused,
        message:
          "35.205.0.0/16 is wider than a /24, which would block whole networks. Block single addresses or a narrower range, or ask a Security Admin to block it.",
      });
      expect(v6MemberOutcome.status).toBe(SecurityBlockOutcomeStatus.Refused);

      // A Security Admin may, on purpose.
      expect(
        (
          await SecurityBlockService.block({
            projectId: PROJECT_ID,
            value: "35.205.0.0/16",
            props: member(SECURITY_ADMIN),
          })
        ).status,
      ).toBe(SecurityBlockOutcomeStatus.Blocked);

      // Never past the widest, and never OneUptime's own block.
      expect(
        (
          await SecurityBlockService.block({
            projectId: PROJECT_ID,
            value: "35.0.0.0/7",
            props: member(SECURITY_ADMIN),
          })
        ).status,
      ).toBe(SecurityBlockOutcomeStatus.Refused);
      expect(
        (
          await SecurityBlockService.block({
            projectId: PROJECT_ID,
            value: "36.205.0.0/16",
            source: SecurityBlockSource.OneUptimeAi,
            props: ROOT,
          })
        ).status,
      ).toBe(SecurityBlockOutcomeStatus.Refused);
    });

    test("a block kept until someone lifts it takes a Security Admin", async () => {
      const refused: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "35.205.11.131",
        duration: SecurityBlockDuration.UntilLifted,
        props: member(SECURITY_MEMBER),
      });

      expect(refused).toEqual({
        status: SecurityBlockOutcomeStatus.Refused,
        message:
          "Only a Security Admin, a Project Admin or a Project Owner can keep a block until someone lifts it. Choose how long it lasts instead.",
      });

      expect(
        (
          await SecurityBlockService.block({
            projectId: PROJECT_ID,
            value: "35.205.11.131",
            duration: SecurityBlockDuration.UntilLifted,
            props: member(SECURITY_ADMIN),
          })
        ).status,
      ).toBe(SecurityBlockOutcomeStatus.Blocked);
      expect(rows()[0]!["expiresAt"]).toBeNull();
    });

    test("an end in the past, a year away, a reason too long and no address are refused", async () => {
      const props: DatabaseCommonInteractionProps = member(SECURITY_MEMBER);

      for (const outcome of [
        await SecurityBlockService.block({
          projectId: PROJECT_ID,
          value: "35.205.11.131",
          expiresAt: new Date(Date.now() - HOUR_IN_MS),
          props,
        }),
        await SecurityBlockService.block({
          projectId: PROJECT_ID,
          value: "35.205.11.131",
          expiresAt: new Date(Date.now() + 400 * 24 * HOUR_IN_MS),
          props,
        }),
        await SecurityBlockService.block({
          projectId: PROJECT_ID,
          value: "35.205.11.131",
          reason: "r".repeat(501),
          props,
        }),
        await SecurityBlockService.block({
          projectId: PROJECT_ID,
          value: "not an address",
          props,
        }),
      ]) {
        expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Refused);
      }

      expect(rows()).toHaveLength(0);
    });
  });

  describe("renewing, lifting and what never changes", () => {
    beforeEach(() => {
      table = useInMemoryTable(service, [
        activeBlock({
          id: BLOCK_ID,
          value: "35.205.11.131",
          securityCaseId: CASE_ID,
        }),
      ]);
    });

    test.each(BLOCKERS)(
      "%s lifts a block: who and when are OneUptime's to write, and the case hears it",
      async (_who: string, permissions: Array<Permission>) => {
        const props: DatabaseCommonInteractionProps = member(permissions);

        const outcome: { status: SecurityBlockLiftStatus } =
          await SecurityBlockService.lift({
            projectId: PROJECT_ID,
            securityBlockId: new ObjectID(BLOCK_ID),
            reason: "  A partner's office, not an attacker  ",
            props,
          });

        expect(outcome.status).toBe(SecurityBlockLiftStatus.Lifted);

        const stored: StoredRow = table.get(BLOCK_ID)!;
        expect(stored["state"]).toBe(SecurityBlockState.Lifted);
        expect(stored["liftReason"]).toBe(
          "A partner's office, not an attacker",
        );
        expect(String(stored["liftedByUserId"])).toBe(props.userId!.toString());
        expect(stored["liftedAt"]).toBeInstanceOf(Date);

        expect(feedLines()).toEqual([
          "✅ Lifted the block on `35.205.11.131`: A partner's office, not an attacker.",
        ]);
        expect(reconcileSpy).toHaveBeenCalledWith(PROJECT_ID);

        // In the audit log, as the person's: the state, why, who and when.
        const audited: Array<{
          fields: Record<string, unknown>;
          userId: unknown;
        }> = auditedUpdates();
        expect(audited).toHaveLength(1);
        expect(audited[0]!.userId).toBe(props.userId!.toString());
        expect(audited[0]!.fields).toEqual(
          expect.objectContaining({
            state: SecurityBlockState.Lifted,
            liftReason: "A partner's office, not an attacker",
          }),
        );
        expect(Object.keys(audited[0]!.fields)).toEqual(
          expect.arrayContaining(["liftedAt", "liftedByUserId"]),
        );
      },
    );

    test("a lift through the API that names who lifted it is recorded as the person who did", async () => {
      const props: DatabaseCommonInteractionProps = member(SECURITY_MEMBER);

      await service.updateOneById({
        id: new ObjectID(BLOCK_ID),
        data: {
          state: SecurityBlockState.Lifted,
          liftedByUserId: ObjectID.generate(),
        } as never,
        props,
      });

      expect(String(table.get(BLOCK_ID)!["liftedByUserId"])).toBe(
        props.userId!.toString(),
      );
    });

    test("a reason that ends its own sentence takes no second full stop", async () => {
      await SecurityBlockService.lift({
        projectId: PROJECT_ID,
        securityBlockId: new ObjectID(BLOCK_ID),
        reason: "It was our own VPN!",
        props: member(SECURITY_MEMBER),
      });

      expect(feedLines()).toEqual([
        "✅ Lifted the block on `35.205.11.131`: It was our own VPN!",
      ]);
    });

    test("OneUptime's own lift names nobody", async () => {
      await SecurityBlockService.lift({
        projectId: PROJECT_ID,
        securityBlockId: new ObjectID(BLOCK_ID),
        props: ROOT,
      });

      expect(table.get(BLOCK_ID)!["state"]).toBe(SecurityBlockState.Lifted);
      expect(table.get(BLOCK_ID)!["liftedByUserId"]).toBeNull();
      expect(feedLines()).toEqual([
        "✅ The block on `35.205.11.131` was lifted.",
      ]);
    });

    test("lifting an ended block says it ended already, and changes nothing", async () => {
      table = useInMemoryTable(service, [
        activeBlock({
          id: BLOCK_ID,
          value: "35.205.11.131",
          state: SecurityBlockState.Expired,
        }),
      ]);

      expect(
        (
          await SecurityBlockService.lift({
            projectId: PROJECT_ID,
            securityBlockId: new ObjectID(BLOCK_ID),
            props: member(SECURITY_MEMBER),
          })
        ).status,
      ).toBe(SecurityBlockLiftStatus.AlreadyEnded);

      const error: Error = await refusalOf(
        service.updateOneById({
          id: new ObjectID(BLOCK_ID),
          data: { state: SecurityBlockState.Lifted } as never,
          props: member(SECURITY_MEMBER),
        }),
      );

      expect(error.message).toContain("has expired, so it cannot be changed");
      expect(table.get(BLOCK_ID)!["state"]).toBe(SecurityBlockState.Expired);
    });

    test("a block of another project is not found", async () => {
      expect(
        (
          await SecurityBlockService.lift({
            projectId: ObjectID.generate(),
            securityBlockId: new ObjectID(BLOCK_ID),
            props: ROOT,
          })
        ).status,
      ).toBe(SecurityBlockLiftStatus.NotFound);
    });

    test("a Security Member renews a block, and the case hears when it ends now", async () => {
      const until: Date = new Date(Date.now() + 7 * 24 * HOUR_IN_MS);

      await SecurityBlockService.extend({
        projectId: PROJECT_ID,
        securityBlockId: new ObjectID(BLOCK_ID),
        expiresAt: until,
        props: member(SECURITY_MEMBER),
      });

      expect(
        new Date(table.get(BLOCK_ID)!["expiresAt"] as Date).getTime(),
      ).toBe(until.getTime());
      expect(feedLines()[0]).toMatch(
        /^🚫 The block on `35\.205\.11\.131` now ends in (6|7) days\.$/,
      );

      // In the audit log: its new end.
      expect(auditedUpdates()).toHaveLength(1);
      expect(Object.keys(auditedUpdates()[0]!.fields)).toEqual(["expiresAt"]);
    });

    test("making a block permanent takes a Security Admin", async () => {
      const error: Error = await refusalOf(
        SecurityBlockService.extend({
          projectId: PROJECT_ID,
          securityBlockId: new ObjectID(BLOCK_ID),
          expiresAt: null,
          props: member(SECURITY_MEMBER),
        }),
      );

      expect(error.message).toContain("Only a Security Admin");
      expect(table.get(BLOCK_ID)!["expiresAt"]).not.toBeNull();

      await SecurityBlockService.extend({
        projectId: PROJECT_ID,
        securityBlockId: new ObjectID(BLOCK_ID),
        expiresAt: null,
        props: member(SECURITY_ADMIN),
      });

      expect(table.get(BLOCK_ID)!["expiresAt"]).toBeNull();
      expect(feedLines()).toEqual([
        "🚫 The block on `35.205.11.131` now stays until someone lifts it.",
      ]);
    });

    test("a Security Viewer may neither lift nor renew", async () => {
      const viewer: DatabaseCommonInteractionProps = member([
        Permission.SecurityViewer,
      ]);

      await refusalOf(
        service.updateOneById({
          id: new ObjectID(BLOCK_ID),
          data: { state: SecurityBlockState.Lifted } as never,
          props: viewer,
        }),
      );
      await refusalOf(
        SecurityBlockService.extend({
          projectId: PROJECT_ID,
          securityBlockId: new ObjectID(BLOCK_ID),
          expiresAt: new Date(Date.now() + 2 * HOUR_IN_MS),
          props: viewer,
        }),
      );

      expect(table.get(BLOCK_ID)!["state"]).toBe(SecurityBlockState.Active);
      expect(feedSpy).not.toHaveBeenCalled();
    });

    test("a block's state only ever becomes Lifted, and its value and action never change", async () => {
      for (const data of [
        { state: SecurityBlockState.Expired },
        { state: SecurityBlockState.Active },
        { value: "35.205.11.132" },
        { action: SecurityBlockAction.Challenge },
      ]) {
        await refusalOf(
          service.updateOneById({
            id: new ObjectID(BLOCK_ID),
            data: data as never,
            props: ROOT,
          }),
        );
      }

      expect(table.get(BLOCK_ID)!["state"]).toBe(SecurityBlockState.Active);
      expect(table.get(BLOCK_ID)!["value"]).toBe("35.205.11.131");
      expect(table.get(BLOCK_ID)!["action"]).toBe(SecurityBlockAction.Block);
    });

    test("no block is deleted, by anyone but OneUptime itself", async () => {
      for (const permissions of [
        [Permission.ProjectOwner],
        [Permission.SecurityAdmin],
      ]) {
        await refusalOf(
          service.deleteOneById({
            id: new ObjectID(BLOCK_ID),
            props: member(permissions),
          }),
        );
      }

      expect(table.get(BLOCK_ID)).toBeTruthy();
    });
  });

  describe("findActiveBlocks", () => {
    test("reads the blocks in force, leaving out ended ones and ones past their expiry", async () => {
      table = useInMemoryTable(service, [
        activeBlock({ id: BLOCK_ID, value: "35.205.11.131" }),
        activeBlock({
          id: RANGE_ID,
          value: "198.51.100.0/24",
          expiresAt: new Date(Date.now() - HOUR_IN_MS),
        }),
        activeBlock({
          id: ObjectID.generate().toString(),
          value: "203.0.113.9",
          state: SecurityBlockState.Lifted,
        }),
        activeBlock({
          id: ObjectID.generate().toString(),
          value: "203.0.113.10",
          expiresAt: null,
        }),
      ]);

      const blocks: Array<SecurityBlock> =
        await SecurityBlockService.findActiveBlocks({ projectId: PROJECT_ID });

      expect(
        blocks
          .map((block: SecurityBlock): string => {
            return block.value || "";
          })
          .sort(),
      ).toEqual(["203.0.113.10", "35.205.11.131"]);
    });
  });

  /*
   * Domains, URLs and files, and an address blocked everywhere (#10346):
   * written one way, held to their own protections, enforced everywhere,
   * and refused - saying what to turn on - when nothing connected could
   * hold them.
   */
  describe("domains, URLs, files and where a block is enforced (#10346)", () => {
    let indicatorProtectionSpy: SpyInstance<
      typeof SecurityProtectedIndicators.findProtection
    >;

    // A destination on every machine: what Microsoft Defender holds.
    function enforceOnEveryMachine(
      configure?: (destination: TestSecurityBlockDestination) => void,
    ): TestSecurityBlockDestination {
      const destination: TestSecurityBlockDestination =
        new TestSecurityBlockDestination();
      Object.assign(destination, { enforcesOnEveryMachine: true });

      if (configure) {
        configure(destination);
      }

      SecurityBlockDestinations.setSourcesForTests([
        {
          provider: SecurityBlockDestinationProvider.Test,
          findForProject: async (): Promise<
            Array<SecurityBlockDestination>
          > => {
            return [destination];
          },
        },
      ]);

      return destination;
    }

    beforeEach(() => {
      indicatorProtectionSpy = jest
        .spyOn(SecurityProtectedIndicators, "findProtection")
        .mockResolvedValue({ protection: null, unreadSources: [] });
    });

    test("a domain is blocked written one way, everywhere, and its kind recorded", async () => {
      enforceOnEveryMachine();

      const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "  Evil.Example.  ",
        props: member(SECURITY_MEMBER),
      });

      expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Blocked);
      expect(rows()[0]).toEqual(
        expect.objectContaining({
          value: "evil.example",
          indicatorType: SecurityBlockIndicatorType.Domain,
          reach: SecurityBlockReach.Everywhere,
          action: SecurityBlockAction.Block,
        }),
      );
      // Held to a domain's protections, never an address's.
      expect(indicatorProtectionSpy).toHaveBeenCalledTimes(1);
      expect(protectionSpy).not.toHaveBeenCalled();
    });

    test("a URL and a file, each written one way; a file blocked and quarantined", async () => {
      enforceOnEveryMachine();

      await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "HTTPS://Evil.Example/Login#top",
        props: ROOT,
      });
      await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "44D88612FEA8A8F36DE82E1278ABB02F",
        action: SecurityBlockAction.BlockAndQuarantine,
        props: ROOT,
      });

      expect(
        rows().map((row: StoredRow) => {
          return [
            row["value"],
            row["indicatorType"],
            row["action"],
            row["reach"],
          ];
        }),
      ).toEqual([
        [
          "https://evil.example/Login",
          SecurityBlockIndicatorType.Url,
          SecurityBlockAction.Block,
          SecurityBlockReach.Everywhere,
        ],
        [
          "44d88612fea8a8f36de82e1278abb02f",
          SecurityBlockIndicatorType.FileMd5,
          SecurityBlockAction.BlockAndQuarantine,
          SecurityBlockReach.Everywhere,
        ],
      ]);
    });

    test("a domain nothing connected could hold is refused, saying what to turn on", async () => {
      const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "evil.example",
        props: member(SECURITY_MEMBER),
      });

      expect(outcome).toEqual({
        status: SecurityBlockOutcomeStatus.Refused,
        message:
          "Nothing you have connected blocks domains. Turn on Block domains, addresses and files with Defender on your Microsoft Defender XDR connection.",
      });
      expect(rows()).toEqual([]);
    });

    test("a file only an edge destination is connected for is refused too: it holds addresses alone", async () => {
      // An edge destination, as Cloudflare's IP list is: addresses and nothing else.
      const edge: TestSecurityBlockDestination =
        new TestSecurityBlockDestination();
      const supportsAddresses: TestSecurityBlockDestination["supports"] =
        edge.supports.bind(edge);
      edge.supports = (entry: {
        indicatorType: SecurityBlockIndicatorType;
        action: SecurityBlockAction;
        value: string;
      }) => {
        return entry.indicatorType === SecurityBlockIndicatorType.IpAddress ||
          entry.indicatorType === SecurityBlockIndicatorType.IpRange
          ? supportsAddresses(entry)
          : { isSupported: false, reason: "it blocks addresses only" };
      };

      SecurityBlockDestinations.setSourcesForTests([
        {
          provider: SecurityBlockDestinationProvider.Test,
          findForProject: async () => {
            return [edge];
          },
        },
      ]);

      const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "44d88612fea8a8f36de82e1278abb02f",
        props: ROOT,
      });

      expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Refused);
    });

    test("while a kind of destination cannot be listed, nobody can tell: the block is made", async () => {
      SecurityBlockDestinations.setSourcesForTests([
        {
          provider: SecurityBlockDestinationProvider.Test,
          findForProject: async () => {
            throw new Error("Connections could not be read.");
          },
        },
      ]);

      const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "evil.example",
        props: ROOT,
      });

      expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Blocked);
    });

    test("an address at the edge is kept whatever is connected, and one everywhere needs a destination on every machine", async () => {
      const atEdge: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "198.51.100.7",
        props: ROOT,
      });

      expect(atEdge.status).toBe(SecurityBlockOutcomeStatus.Blocked);

      const everywhere: SecurityBlockOutcome = await SecurityBlockService.block(
        {
          projectId: PROJECT_ID,
          value: "198.51.100.8",
          reach: SecurityBlockReach.Everywhere,
          props: ROOT,
        },
      );

      expect(everywhere).toEqual({
        status: SecurityBlockOutcomeStatus.Refused,
        message:
          "Nothing you have connected blocks an address on every machine. Turn on Block domains, addresses and files with Defender on your Microsoft Defender XDR connection, or block the address at the edge.",
      });
    });

    test("an address can be blocked at the edge and, on its own, everywhere: two blocks", async () => {
      enforceOnEveryMachine();

      await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "198.51.100.7",
        props: ROOT,
      });
      const everywhere: SecurityBlockOutcome = await SecurityBlockService.block(
        {
          projectId: PROJECT_ID,
          value: "198.51.100.7",
          reach: SecurityBlockReach.Everywhere,
          props: ROOT,
        },
      );

      expect(everywhere.status).toBe(SecurityBlockOutcomeStatus.Blocked);
      expect(
        rows().map((row: StoredRow) => {
          return row["reach"];
        }),
      ).toEqual([SecurityBlockReach.Edge, SecurityBlockReach.Everywhere]);

      // A block everywhere is a block at the edge too: the edge's is already made.
      const again: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "198.51.100.7",
        props: ROOT,
      });

      expect(again.status).toBe(SecurityBlockOutcomeStatus.AlreadyBlocked);
    });

    test("an address blocked everywhere covers the edge, and a block at the edge never covers everywhere", async () => {
      enforceOnEveryMachine();

      await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "198.51.100.0/24",
        props: member(SECURITY_ADMIN),
      });

      const everywhere: SecurityBlockOutcome = await SecurityBlockService.block(
        {
          projectId: PROJECT_ID,
          value: "198.51.100.7",
          reach: SecurityBlockReach.Everywhere,
          props: ROOT,
        },
      );

      expect(everywhere.status).toBe(SecurityBlockOutcomeStatus.Blocked);
    });

    test("a challenge of a domain, a challenge everywhere and a quarantine of an address are refused", async () => {
      enforceOnEveryMachine();

      for (const request of [
        {
          value: "evil.example",
          action: SecurityBlockAction.Challenge,
          reach: undefined,
        },
        {
          value: "198.51.100.7",
          action: SecurityBlockAction.Challenge,
          reach: SecurityBlockReach.Everywhere,
        },
        {
          value: "198.51.100.8",
          action: SecurityBlockAction.BlockAndQuarantine,
          reach: undefined,
        },
      ]) {
        const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
          projectId: PROJECT_ID,
          value: request.value,
          action: request.action,
          reach: request.reach,
          props: ROOT,
        });

        expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Refused);
      }

      expect(rows()).toEqual([]);
    });

    test("a protected domain is refused with what protects it, and one OneUptime could not check is refused too", async () => {
      enforceOnEveryMachine();
      indicatorProtectionSpy.mockResolvedValueOnce({
        protection: {
          source: SecurityProtectedAddressSource.StatusPage,
          protectedValue: "status.acme.com",
          name: "Acme Status",
        },
        unreadSources: [],
      });

      const parent: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "acme.com",
        props: ROOT,
      });

      expect(parent).toEqual(
        expect.objectContaining({
          status: SecurityBlockOutcomeStatus.Protected,
          message:
            "Blocking acme.com would also block status.acme.com. status.acme.com is the domain of your status page Acme Status.",
        }),
      );

      indicatorProtectionSpy.mockResolvedValueOnce({
        protection: null,
        unreadSources: [SecurityProtectedAddressSource.Monitor],
      });

      const unread: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "evil.example",
        props: ROOT,
      });

      expect(unread).toEqual({
        status: SecurityBlockOutcomeStatus.Refused,
        message:
          "OneUptime could not check whether evil.example is protected, so it did not block it. Try again in a minute.",
      });
      expect(rows()).toEqual([]);
    });

    test("a domain already blocked is already blocked; a name under it is blocked on its own", async () => {
      enforceOnEveryMachine();

      await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "evil.example",
        props: ROOT,
      });

      const same: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "EVIL.example.",
        props: ROOT,
      });
      const under: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "www.evil.example",
        props: ROOT,
      });

      expect(same.status).toBe(SecurityBlockOutcomeStatus.AlreadyBlocked);
      expect(under.status).toBe(SecurityBlockOutcomeStatus.Blocked);
    });

    test("where a block is enforced never changes", async () => {
      enforceOnEveryMachine();
      table = useInMemoryTable(service, [
        activeBlock({ id: BLOCK_ID, value: "198.51.100.7" }),
      ]);

      const error: Error = await refusalOf(
        SecurityBlockService.updateOneById({
          id: new ObjectID(BLOCK_ID),
          data: { reach: SecurityBlockReach.Everywhere } as never,
          props: member(SECURITY_ADMIN),
        }),
      );

      expect(error.message).toBe(
        "Where a block is enforced never changes. Block the address again everywhere: the block at the edge stays until it ends.",
      );
    });

    test("a domain's timeline line says it is blocked, and a case's steps are checked at once", async () => {
      enforceOnEveryMachine();

      await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "evil.example",
        duration: SecurityBlockDuration.SevenDays,
        securityCaseId: CASE_ID,
        props: member(SECURITY_MEMBER),
      });

      expect(feedLines()).toEqual(["🚫 Blocked `evil.example` for 7 days."]);
      expect(stepCheckSpy).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      });
    });

    test("an address blocked everywhere says so on the timeline, and a file blocked and quarantined says that", async () => {
      enforceOnEveryMachine();

      await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "198.51.100.7",
        reach: SecurityBlockReach.Everywhere,
        duration: SecurityBlockDuration.SevenDays,
        securityCaseId: CASE_ID,
        props: ROOT,
        source: SecurityBlockSource.Playbook,
      });
      await SecurityBlockService.block({
        projectId: PROJECT_ID,
        value: "44d88612fea8a8f36de82e1278abb02f",
        action: SecurityBlockAction.BlockAndQuarantine,
        duration: SecurityBlockDuration.ThirtyDays,
        securityCaseId: CASE_ID,
        props: member(SECURITY_MEMBER),
      });

      expect(feedLines()).toEqual([
        "🚫 A playbook blocked `198.51.100.7` on every machine for 7 days.",
        "🚫 Blocked and quarantined `44d88612fea8a8f36de82e1278abb02f` for 30 days.",
      ]);
    });

    test("check() reads a domain as kept, with what would cover it and what protects it", async () => {
      enforceOnEveryMachine();
      table = useInMemoryTable(service, [
        {
          ...activeBlock({ id: BLOCK_ID, value: "evil.example" }),
          indicatorType: SecurityBlockIndicatorType.Domain,
          reach: SecurityBlockReach.Everywhere,
        },
      ]);

      const check: Awaited<ReturnType<typeof SecurityBlockService.check>> =
        await SecurityBlockService.check({
          projectId: PROJECT_ID,
          value: "Evil.Example.",
          props: member(SECURITY_MEMBER),
        });

      expect(check.value?.value).toBe("evil.example");
      expect(check.problem).toBeNull();
      expect(check.coveredBy?.value).toBe("evil.example");
      expect(check.protection).toEqual({ protection: null, unreadSources: [] });
    });
  });
});

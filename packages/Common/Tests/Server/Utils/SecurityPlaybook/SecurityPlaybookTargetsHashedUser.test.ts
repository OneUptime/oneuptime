import SecurityUserErasureRequestService from "../../../../Server/Services/SecurityUserErasureRequestService";
import SecurityUserVaultService from "../../../../Server/Services/SecurityUserVaultService";
import SecurityPlaybookTargets from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookTargets";
import SecurityUserErasedTokens from "../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasedTokens";
import SecurityUserVaultLookup from "../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserVaultLookup";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityEntity,
  SecurityEntityType,
  mergeSecurityEntities,
} from "../../../../Types/SecurityCase/SecurityEntity";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import {
  SecurityTelemetrySignal,
  SecurityTelemetrySourceKind,
} from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import { ProtectedEntityRule } from "../../../../Types/SecurityPlaybook/SecurityProtectedEntity";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetState,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { buildTelemetrySecurityEvent } from "../../../../Utils/SecurityEvent/TelemetryScan/TelemetrySecurityEvent";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/*
 * A PLAYBOOK ACTS ON A HASHED USER ONLY ONCE SECURITY EVENTS NAMES THEM,
 * AND WITH THE SAME PROTECTIONS AS ANY OTHER USER (#10632).
 *
 * The scans name the user behind a Hash rule's token from the user vault
 * before the event is stored, so the case a rule opens holds the account -
 * a User a playbook's Okta or Entra ID step can suspend, if nothing
 * protects it. A token the vault does not know stays the event's user:
 * the entity rule holds it as Other, and no step is ever offered it.
 * Here, from the event the scan stores to the targets a step is offered.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10632000-0000-4000-8000-0000000000f1",
);

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
}

const PROTECTED: Array<ProtectedEntityRule> = [
  { type: SecurityEntityType.User, value: "break-glass-*" },
];

let vault: Record<string, string> = {};

beforeEach(() => {
  vault = {};

  // Nobody erased from the vault on request (#10908).
  SecurityUserErasedTokens.clearCache();
  jest
    .spyOn(SecurityUserErasureRequestService, "getErasedTokensOfProject")
    .mockResolvedValue(new Set<string>());

  jest
    .spyOn(SecurityUserVaultService, "findUsersOfTokens")
    .mockImplementation(
      async (data: {
        tokens: ReadonlyArray<string>;
      }): Promise<Map<string, string>> => {
        const found: Map<string, string> = new Map<string, string>();

        for (const token of data.tokens) {
          if (vault[token]) {
            found.set(token, vault[token]!);
          }
        }

        return found;
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The failed sign-in the scan stores, its user as the vault leaves it.
async function storedSignIn(user: string): Promise<NormalizedSecurityEvent> {
  const event: NormalizedSecurityEvent = buildTelemetrySecurityEvent({
    kind: SecurityTelemetrySourceKind.Traces,
    signal: SecurityTelemetrySignal.WebAttack,
    time: new Date("2026-11-24T10:00:00.000Z"),
    eventUid: `trace:${user}`,
    classUid: 3002,
    activityName: "Logon",
    statusName: "Failure",
    severity: OcsfSeverity.Medium,
    message: `Failed sign-in for ${user}`,
    principalUser: user,
    attributes: {},
  });

  await SecurityUserVaultLookup.nameHashedUsers({
    projectId: PROJECT_ID,
    events: [event],
  });

  return event;
}

// The user targets a step is offered for a case grouped on the event's user.
function userTargets(
  event: NormalizedSecurityEvent,
): Array<SecurityPlaybookTarget> {
  const entities: Array<SecurityEntity> = mergeSecurityEntities([
    { type: SecurityEntityType.User, value: event.principalUser || "" },
  ]);

  return SecurityPlaybookTargets.chooseTargets({
    entityType: SecurityEntityType.User,
    groupedOn: entities,
    caseEntities: entities,
    threatIntelValues: new Set<string>(),
    protectedRules: PROTECTED,
  });
}

function stateOf(
  targets: Array<SecurityPlaybookTarget>,
): Array<[string, SecurityPlaybookTargetState]> {
  return targets.map(
    (target: SecurityPlaybookTarget): [string, SecurityPlaybookTargetState] => {
      return [target.value, target.state];
    },
  );
}

describe("a playbook's user step, for a case about a hashed user", () => {
  test("named by the vault, the user is offered as any other user", async () => {
    vault = { [tokenOf("mallory@acme.com")]: "mallory@acme.com" };

    const event: NormalizedSecurityEvent = await storedSignIn(
      tokenOf("mallory@acme.com"),
    );

    expect(stateOf(userTargets(event))).toEqual([
      ["mallory@acme.com", SecurityPlaybookTargetState.Proposed],
    ]);
  });

  test("named by the vault, a protected user is protected, as by name", async () => {
    vault = { [tokenOf("break-glass-admin")]: "break-glass-admin" };

    const event: NormalizedSecurityEvent = await storedSignIn(
      tokenOf("break-glass-admin"),
    );

    expect(stateOf(userTargets(event))).toEqual([
      ["break-glass-admin", SecurityPlaybookTargetState.Protected],
    ]);
  });

  test("a token the vault does not know is never offered, protected or not", async () => {
    vault = { [tokenOf("mallory@acme.com")]: "mallory@acme.com" };

    const event: NormalizedSecurityEvent = await storedSignIn(
      tokenOf("eve@acme.com"),
    );

    expect(event.principalUser).toBe(tokenOf("eve@acme.com"));
    expect(userTargets(event)).toEqual([]);
  });

  test("a step that waited for approval since the token is never handed the token", () => {
    const token: string = tokenOf("mallory@acme.com");

    expect(
      SecurityPlaybookTargets.chooseTargets({
        entityType: SecurityEntityType.User,
        // A case stored before the vault named the user, typed as a user by hand.
        groupedOn: [{ type: SecurityEntityType.User, value: token }],
        caseEntities: [{ type: SecurityEntityType.User, value: token }],
        threatIntelValues: new Set<string>([token.toLowerCase()]),
        protectedRules: [],
      }),
    ).toEqual([]);
  });
});

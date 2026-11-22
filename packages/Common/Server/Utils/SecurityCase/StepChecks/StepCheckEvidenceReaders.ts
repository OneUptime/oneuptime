import ObjectID from "../../../../Types/ObjectID";
import { RouteAttackScope } from "../../../../Utils/SecurityCase/RouteAttackScope";
import AccountFixState, { AccountFixReading } from "./Evidence/AccountFixState";
import AddressBlocks, { AddressBlockEvidence } from "./Evidence/AddressBlocks";
import AddressFacts, { AddressFactsReading } from "./Evidence/AddressFacts";
import AddressRequests, {
  AddressCoverageReading,
  AddressRequestsReading,
} from "./Evidence/AddressRequests";
import ContainmentState, {
  ContainmentStateReading,
} from "./Evidence/ContainmentState";
import FixChanges, { FixChangesReading } from "./Evidence/FixChanges";
import MonitorsDown, {
  MonitorsDownReading,
  getRequestServiceIds,
} from "./Evidence/MonitorsDown";
import RouteAttacks, { RouteAttacksReading } from "./Evidence/RouteAttacks";
import { BLOCK_QUIET_MINUTES } from "./AddressStepChecks";
import { StepCheckCase, StepCheckEvidence } from "./StepCheck";

/*
 * The evidence the step checks read, from the project's own data and the
 * products it is connected to, for one run over one case. Each answer is
 * kept for the run: the address step and the requests step read the same
 * address's requests once. A read that fails is not kept, and throws to the
 * check that asked, which says it cannot tell.
 */
export function createStepCheckEvidence(data: {
  securityCase: StepCheckCase;
  now: Date;
}): StepCheckEvidence {
  const projectId: ObjectID = data.securityCase.projectId;
  const cache: Map<string, Promise<unknown>> = new Map();

  const once: <T>(key: string, read: () => Promise<T>) => Promise<T> = <T>(
    key: string,
    read: () => Promise<T>,
  ): Promise<T> => {
    const kept: Promise<unknown> | undefined = cache.get(key);

    if (kept) {
      return kept as Promise<T>;
    }

    const reading: Promise<T> = read().catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });

    cache.set(key, reading);

    return reading;
  };

  const recentSince: Date = new Date(
    data.now.getTime() - BLOCK_QUIET_MINUTES * 60 * 1000,
  );

  return {
    readAddressRequests: (input: {
      address: string;
      start: Date;
      end: Date;
      since: Date | null;
    }): Promise<AddressRequestsReading> => {
      return once(
        `requests:${input.address}:${input.start.toISOString()}:${input.end.toISOString()}:${input.since?.toISOString() || ""}`,
        () => {
          return AddressRequests.read({ projectId, ...input, recentSince });
        },
      );
    },
    countAddressRequests: (input: {
      address: string;
      start: Date;
      end: Date;
    }): Promise<number> => {
      return once(
        `count:${input.address}:${input.start.toISOString()}:${input.end.toISOString()}`,
        () => {
          return AddressRequests.countInWindow({ projectId, ...input });
        },
      );
    },
    readAddressCoverage: (): Promise<AddressCoverageReading> => {
      return once("coverage", () => {
        return AddressRequests.readCoverage({ projectId, now: data.now });
      });
    },
    readAddressBlocks: (
      address: string,
    ): Promise<Array<AddressBlockEvidence>> => {
      return once(`blocks:${address}`, () => {
        return AddressBlocks.read({ projectId, address, now: data.now });
      });
    },
    readUserState: (user: string): Promise<ContainmentStateReading> => {
      return once(`user:${user.toLowerCase()}`, () => {
        return ContainmentState.readUser({ projectId, value: user });
      });
    },
    readHostState: (host: string): Promise<ContainmentStateReading> => {
      return once(`host:${host.toLowerCase()}`, () => {
        return ContainmentState.readHost({ projectId, value: host });
      });
    },
    readMonitorsDown: (): Promise<MonitorsDownReading> => {
      return once("monitors", () => {
        return MonitorsDown.read({
          projectId,
          serviceIds: getRequestServiceIds(data.securityCase.matches),
          openedAt: data.securityCase.createdAt,
          now: data.now,
        });
      });
    },
    readAddressFacts: (address: string): Promise<AddressFactsReading> => {
      return once(`facts:${address}`, () => {
        return AddressFacts.read({ projectId, address, now: data.now });
      });
    },
    readRouteAttacks: (input: {
      scope: RouteAttackScope;
      start: Date;
      end: Date;
      splitAt: Date | null;
      settledAt: Date | null;
    }): Promise<RouteAttacksReading> => {
      return once(
        `attacks:${input.scope.route}:${input.start.toISOString()}:${input.end.toISOString()}:${input.splitAt?.toISOString() || ""}:${input.settledAt?.toISOString() || ""}`,
        () => {
          return RouteAttacks.read({ projectId, ...input });
        },
      );
    },
    readFixChanges: (input: {
      serviceIds: Array<string>;
      since: Date;
    }): Promise<FixChangesReading> => {
      return once(
        `changes:${input.serviceIds.join(",")}:${input.since.toISOString()}`,
        () => {
          return FixChanges.read({
            projectId,
            securityCaseId: data.securityCase.securityCaseId,
            serviceIds: input.serviceIds,
            since: input.since,
            now: data.now,
          });
        },
      );
    },
    readAccountCredentials: (input: {
      user: string;
      since: Date;
    }): Promise<AccountFixReading> => {
      return once(
        `credentials:${input.user.toLowerCase()}:${input.since.toISOString()}`,
        () => {
          return AccountFixState.readCredentials({
            projectId,
            value: input.user,
            since: input.since,
            now: data.now,
          });
        },
      );
    },
    readAccountMfa: (user: string): Promise<AccountFixReading> => {
      return once(`mfa:${user.toLowerCase()}`, () => {
        return AccountFixState.readMfa({ projectId, value: user });
      });
    },
  };
}

import ObjectID from "../../../../Types/ObjectID";
import AddressBlocks, { AddressBlockEvidence } from "./Evidence/AddressBlocks";
import AddressFacts, { AddressFactsReading } from "./Evidence/AddressFacts";
import AddressRequests, {
  AddressCoverageReading,
  AddressRequestsReading,
} from "./Evidence/AddressRequests";
import ContainmentState, {
  ContainmentStateReading,
} from "./Evidence/ContainmentState";
import IndicatorBlocks, {
  IndicatorBlockReading,
} from "./Evidence/IndicatorBlocks";
import MonitorsDown, {
  MonitorsDownReading,
  getRequestServiceIds,
} from "./Evidence/MonitorsDown";
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
    readIndicatorBlocks: (value: string): Promise<IndicatorBlockReading> => {
      return once(`indicator-blocks:${value.toLowerCase()}`, () => {
        return IndicatorBlocks.read({ projectId, value, now: data.now });
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
  };
}

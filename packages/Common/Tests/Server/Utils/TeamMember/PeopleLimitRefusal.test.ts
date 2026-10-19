import TeamMemberService, {
  ProjectPeopleLimits,
} from "../../../../Server/Services/TeamMemberService";
import Errors from "../../../../Server/Utils/Errors";
import PeopleLimitRefusal from "../../../../Server/Utils/TeamMember/PeopleLimitRefusal";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { describe, expect, test } from "@jest/globals";

/*
 * A PROJECT REFUSING ONE MORE PERSON, AS ITS CALLERS RECOGNISE IT.
 *
 * TeamMemberService refuses a membership that would add someone new past a
 * project's limits on people with one of two sentences. A sign-in through
 * single sign-on that adds people asks PeopleLimitRefusal.isRefusal to tell
 * that refusal from any other failure: the project's own provider tells the
 * person the project has no room, an instance-wide one leaves the project
 * out. These pin that every sentence the service can refuse with is
 * recognised, and nothing else is.
 */

describe("PeopleLimitRefusal", () => {
  test("recognises both of the service's refusals", () => {
    expect(PeopleLimitRefusal.REFUSALS).toEqual([
      Errors.TeamMemberService.LIMIT_REACHED,
      Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
    ]);

    for (const refusal of PeopleLimitRefusal.REFUSALS) {
      expect(PeopleLimitRefusal.isRefusal(new BadDataException(refusal))).toBe(
        true,
      );
    }
  });

  test("recognises every refusal the people limits can give, and only those", () => {
    const given: Set<string> = new Set<string>();

    for (const seatLimit of [null, 1, 2, 5]) {
      for (const isFreePlan of [false, true]) {
        const limits: ProjectPeopleLimits = {
          seatLimit: seatLimit,
          isFreePlan: isFreePlan,
        };

        for (let people: number = 0; people <= 6; people++) {
          const refusal: string | null =
            TeamMemberService.getPeopleLimitRefusal({
              limits: limits,
              people: people,
            });

          if (refusal) {
            given.add(refusal);
            expect(
              PeopleLimitRefusal.isRefusal(new BadDataException(refusal)),
            ).toBe(true);
          }
        }
      }
    }

    // Both sentences are reachable, so neither entry above is dead.
    expect(Array.from(given).sort()).toEqual(
      [...PeopleLimitRefusal.REFUSALS].sort(),
    );
  });

  test("is not any other refusal of a membership", () => {
    for (const message of [
      Errors.TeamMemberService.ALREADY_INVITED,
      Errors.TeamMemberService.ONE_MEMBER_REQUIRED,
      "Invalid Team ID",
      "",
    ]) {
      expect(PeopleLimitRefusal.isRefusal(new BadDataException(message))).toBe(
        false,
      );
    }
  });

  test("is the service's own kind of refusal, not the same words in another error", () => {
    for (const refusal of PeopleLimitRefusal.REFUSALS) {
      expect(PeopleLimitRefusal.isRefusal(new Error(refusal))).toBe(false);
      expect(
        PeopleLimitRefusal.isRefusal(new NotAuthorizedException(refusal)),
      ).toBe(false);
      expect(PeopleLimitRefusal.isRefusal(refusal)).toBe(false);
      expect(PeopleLimitRefusal.isRefusal({ message: refusal })).toBe(false);
    }

    expect(PeopleLimitRefusal.isRefusal(undefined)).toBe(false);
    expect(PeopleLimitRefusal.isRefusal(null)).toBe(false);
  });
});

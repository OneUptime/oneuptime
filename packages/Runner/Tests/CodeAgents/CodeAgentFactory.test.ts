/*
 * ---------------------------------------------------------------------------
 * The factory that decides WHICH code agent runs a customer's fix.
 *
 * There is exactly one agent today, which is precisely why this is worth
 * pinning: every branch here exists to make the single-agent case behave
 * correctly, and each one is a place a second agent could later be introduced
 * incorrectly.
 *
 * Three behaviours matter:
 *
 *   - CODE_AGENT_TYPE is read ONCE, at class-initialisation time, into a
 *     mutable static. A test (or a caller) that changes the default and does
 *     not put it back leaks into everything that runs after it, and the leak
 *     is silent: the next run simply uses a different agent.
 *
 *   - An unrecognised CODE_AGENT_TYPE must FALL BACK, not throw. The
 *     deprecated OpenCode value is still sitting in deployed environments
 *     after its grace release, and a Runner that refuses to start because of
 *     a stale env var stops every code fix in that installation.
 *
 *   - createAgentWithFallback must never hand back an agent that is not
 *     available, and must raise a legible error rather than null when nothing
 *     is - a null returned into the task handler would surface as a type
 *     error somewhere far away from the cause.
 * ---------------------------------------------------------------------------
 */

import CodeAgentFactory from "../../CodeAgents/CodeAgentFactory";
import {
  CodeAgent,
  CodeAgentType,
  getCodeAgentDisplayName,
  isValidCodeAgentType,
} from "../../CodeAgents/CodeAgentInterface";
import InHouseCodeAgent from "../../CodeAgents/InHouseCodeAgent";

describe("CodeAgentFactory", () => {
  const originalDefault: CodeAgentType = CodeAgentFactory.getDefaultAgentType();

  afterEach(() => {
    CodeAgentFactory.setDefaultAgentType(originalDefault);
    jest.restoreAllMocks();
  });

  describe("the agent catalogue", () => {
    test("lists every declared agent type", () => {
      expect(CodeAgentFactory.getAvailableAgentTypes()).toEqual(
        Object.values(CodeAgentType),
      );
    });

    test("defaults to the in-house agent when nothing selects otherwise", () => {
      expect(CodeAgentFactory.getDefaultAgentType()).toBe(
        CodeAgentType.InHouse,
      );
    });

    test("every listed type is one the factory can actually build", () => {
      for (const type of CodeAgentFactory.getAvailableAgentTypes()) {
        expect(CodeAgentFactory.createAgent(type)).toBeDefined();
      }
    });

    test("every listed type is accepted by the env-var validator", () => {
      for (const type of CodeAgentFactory.getAvailableAgentTypes()) {
        expect(isValidCodeAgentType(type)).toBe(true);
      }
    });

    test("the removed OpenCode value is no longer a valid type", () => {
      expect(isValidCodeAgentType("OpenCode")).toBe(false);
    });

    test("an unknown string is not a valid type", () => {
      expect(isValidCodeAgentType("")).toBe(false);
      expect(isValidCodeAgentType("inhouse")).toBe(false);
    });

    test("the in-house type carries a display name meant for a human", () => {
      expect(getCodeAgentDisplayName(CodeAgentType.InHouse)).toBe(
        "OneUptime Code Agent",
      );
    });

    test("an unrecognised type displays as itself rather than as undefined", () => {
      expect(getCodeAgentDisplayName("Something" as CodeAgentType)).toBe(
        "Something",
      );
    });
  });

  describe("createAgent", () => {
    test("builds the in-house agent for the in-house type", () => {
      expect(
        CodeAgentFactory.createAgent(CodeAgentType.InHouse),
      ).toBeInstanceOf(InHouseCodeAgent);
    });

    test("builds a fresh agent each time rather than sharing one", () => {
      expect(CodeAgentFactory.createAgent(CodeAgentType.InHouse)).not.toBe(
        CodeAgentFactory.createAgent(CodeAgentType.InHouse),
      );
    });

    test("refuses an agent type it does not know", () => {
      expect(() => {
        return CodeAgentFactory.createAgent("OpenCode" as CodeAgentType);
      }).toThrow("Unknown code agent type: OpenCode");
    });

    test("the agent it builds names itself", () => {
      expect(
        CodeAgentFactory.createAgent(CodeAgentType.InHouse).name,
      ).toBeTruthy();
    });
  });

  describe("createDefaultAgent", () => {
    test("builds whatever the default type currently is", () => {
      expect(CodeAgentFactory.createDefaultAgent()).toBeInstanceOf(
        InHouseCodeAgent,
      );
    });

    test("follows the default after it is changed", () => {
      CodeAgentFactory.setDefaultAgentType(CodeAgentType.InHouse);

      expect(CodeAgentFactory.getDefaultAgentType()).toBe(
        CodeAgentType.InHouse,
      );
      expect(CodeAgentFactory.createDefaultAgent()).toBeInstanceOf(
        InHouseCodeAgent,
      );
    });

    test("throws through createAgent if the default was set to nonsense", () => {
      CodeAgentFactory.setDefaultAgentType("Nonsense" as CodeAgentType);

      expect(() => {
        return CodeAgentFactory.createDefaultAgent();
      }).toThrow("Unknown code agent type: Nonsense");
    });
  });

  describe("isAgentAvailable", () => {
    test("reports what the agent itself reports", async () => {
      jest
        .spyOn(InHouseCodeAgent.prototype, "isAvailable")
        .mockResolvedValue(true);

      await expect(
        CodeAgentFactory.isAgentAvailable(CodeAgentType.InHouse),
      ).resolves.toBe(true);
    });

    test("reports false when the agent says it is not available", async () => {
      jest
        .spyOn(InHouseCodeAgent.prototype, "isAvailable")
        .mockResolvedValue(false);

      await expect(
        CodeAgentFactory.isAgentAvailable(CodeAgentType.InHouse),
      ).resolves.toBe(false);
    });

    /*
     * An availability probe that throws is a broken probe, not an available
     * agent. Swallowing it into `false` is what lets createAgentWithFallback
     * keep looking instead of taking the whole task down.
     */
    test("reports false rather than propagating when the probe throws", async () => {
      jest
        .spyOn(InHouseCodeAgent.prototype, "isAvailable")
        .mockRejectedValue(new Error("probe blew up"));

      await expect(
        CodeAgentFactory.isAgentAvailable(CodeAgentType.InHouse),
      ).resolves.toBe(false);
    });

    test("reports false for a type that cannot even be constructed", async () => {
      await expect(
        CodeAgentFactory.isAgentAvailable("OpenCode" as CodeAgentType),
      ).resolves.toBe(false);
    });
  });

  describe("getFirstAvailableAgent", () => {
    test("returns an agent when one is available", async () => {
      jest
        .spyOn(InHouseCodeAgent.prototype, "isAvailable")
        .mockResolvedValue(true);

      await expect(
        CodeAgentFactory.getFirstAvailableAgent(),
      ).resolves.toBeInstanceOf(InHouseCodeAgent);
    });

    test("returns null when nothing is available", async () => {
      jest
        .spyOn(InHouseCodeAgent.prototype, "isAvailable")
        .mockResolvedValue(false);

      await expect(
        CodeAgentFactory.getFirstAvailableAgent(),
      ).resolves.toBeNull();
    });
  });

  describe("createAgentWithFallback", () => {
    test("honours an available preferred type", async () => {
      jest
        .spyOn(InHouseCodeAgent.prototype, "isAvailable")
        .mockResolvedValue(true);

      await expect(
        CodeAgentFactory.createAgentWithFallback(CodeAgentType.InHouse),
      ).resolves.toBeInstanceOf(InHouseCodeAgent);
    });

    test("falls through to the default when no preference is given", async () => {
      jest
        .spyOn(InHouseCodeAgent.prototype, "isAvailable")
        .mockResolvedValue(true);

      await expect(
        CodeAgentFactory.createAgentWithFallback(),
      ).resolves.toBeInstanceOf(InHouseCodeAgent);
    });

    /*
     * A preferred type that cannot be constructed at all must not take the
     * task down - the caller asked for a preference, not a guarantee.
     */
    test("falls back past an unbuildable preferred type", async () => {
      jest
        .spyOn(InHouseCodeAgent.prototype, "isAvailable")
        .mockResolvedValue(true);

      await expect(
        CodeAgentFactory.createAgentWithFallback("OpenCode" as CodeAgentType),
      ).resolves.toBeInstanceOf(InHouseCodeAgent);
    });

    test("raises a legible error when nothing at all is available", async () => {
      jest
        .spyOn(InHouseCodeAgent.prototype, "isAvailable")
        .mockResolvedValue(false);

      await expect(CodeAgentFactory.createAgentWithFallback()).rejects.toThrow(
        "No code agents are available on this system",
      );
    });

    test("never hands back an agent that reported itself unavailable", async () => {
      jest
        .spyOn(InHouseCodeAgent.prototype, "isAvailable")
        .mockResolvedValue(false);

      await expect(
        CodeAgentFactory.createAgentWithFallback(CodeAgentType.InHouse),
      ).rejects.toThrow("No code agents are available on this system");
    });

    test("the agent it returns satisfies the CodeAgent contract", async () => {
      jest
        .spyOn(InHouseCodeAgent.prototype, "isAvailable")
        .mockResolvedValue(true);

      const agent: CodeAgent = await CodeAgentFactory.createAgentWithFallback();

      expect(typeof agent.initialize).toBe("function");
      expect(typeof agent.executeTask).toBe("function");
      expect(typeof agent.onProgress).toBe("function");
      expect(typeof agent.isAvailable).toBe("function");
      expect(typeof agent.abort).toBe("function");
    });
  });

  describe("the default agent type is a mutable static", () => {
    test("setDefaultAgentType is observable through getDefaultAgentType", () => {
      CodeAgentFactory.setDefaultAgentType("Nonsense" as CodeAgentType);

      expect(CodeAgentFactory.getDefaultAgentType()).toBe("Nonsense");
    });

    test("and is restored between tests, so this one still sees the real default", () => {
      expect(CodeAgentFactory.getDefaultAgentType()).toBe(
        CodeAgentType.InHouse,
      );
    });
  });
});

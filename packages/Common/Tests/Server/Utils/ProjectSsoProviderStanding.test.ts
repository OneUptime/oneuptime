import ProjectSsoProviderStanding, {
  PROJECT_SSO_PROVIDER_STANDING_CACHE_TTL_MS,
  PROVIDER_NOT_FOUND,
  ProjectSsoProviderStandingValue,
  ProjectSsoProviderType,
  isProjectSsoProviderType,
} from "../../../Server/Utils/ProjectSsoProviderStanding";
import ObjectID from "../../../Types/ObjectID";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * Whether a project's own SAML or OIDC provider still vouches for the
 * sign-ins it gave: the per-server answer cache, and the rule that reads it
 * (Server/Utils/ProjectSsoProviderStanding). The services' database reads
 * (ProjectSsoService/ProjectOidcService.getSignInStanding) are the `load`
 * functions below.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROVIDER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_PROVIDER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const ON: ProjectSsoProviderStandingValue = {
  isOn: true,
  signInsEndedAtMs: null,
};

const OFF: ProjectSsoProviderStandingValue = {
  isOn: false,
  signInsEndedAtMs: 1_700_000_000_000,
};

type Load = Mock<() => Promise<ProjectSsoProviderStandingValue>>;

const loadAnswering: (value: ProjectSsoProviderStandingValue) => Load = (
  value: ProjectSsoProviderStandingValue,
): Load => {
  return jest.fn(async (): Promise<ProjectSsoProviderStandingValue> => {
    return value;
  });
};

const ask: (data: {
  load: Load;
  projectId?: ObjectID;
  providerId?: ObjectID;
  providerType?: ProjectSsoProviderType;
}) => Promise<ProjectSsoProviderStandingValue> = (data: {
  load: Load;
  projectId?: ObjectID;
  providerId?: ObjectID;
  providerType?: ProjectSsoProviderType;
}): Promise<ProjectSsoProviderStandingValue> => {
  return ProjectSsoProviderStanding.get({
    projectId: data.projectId || PROJECT_ID,
    providerId: data.providerId || PROVIDER_ID,
    providerType: data.providerType || SsoProviderType.ProjectSSO,
    load: data.load,
  });
};

// A load that answers only when the test says so.
interface HeldLoad {
  load: Load;
  answer: (value: ProjectSsoProviderStandingValue) => void;
  fail: (error: Error) => void;
}

const heldLoad: () => HeldLoad = (): HeldLoad => {
  let answer: (value: ProjectSsoProviderStandingValue) => void = () => {
    return undefined;
  };
  let fail: (error: Error) => void = () => {
    return undefined;
  };

  const load: Load = jest.fn((): Promise<ProjectSsoProviderStandingValue> => {
    return new Promise<ProjectSsoProviderStandingValue>(
      (
        resolve: (value: ProjectSsoProviderStandingValue) => void,
        reject: (error: Error) => void,
      ) => {
        answer = resolve;
        fail = reject;
      },
    );
  });

  return {
    load,
    answer: (value: ProjectSsoProviderStandingValue): void => {
      answer(value);
    },
    fail: (error: Error): void => {
      fail(error);
    },
  };
};

const settle: () => Promise<void> = async (): Promise<void> => {
  for (let i: number = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

describe("ProjectSsoProviderStanding", () => {
  beforeEach(() => {
    ProjectSsoProviderStanding.forget();
  });

  afterEach(() => {
    ProjectSsoProviderStanding.forget();
    jest.restoreAllMocks();
  });

  describe("doesVouchFor", () => {
    const ENDED_AT: number = 1_700_000_000_000;

    test("a provider that is on and was never turned off vouches for every sign-in it gave", () => {
      expect(ProjectSsoProviderStanding.doesVouchFor(ON, ENDED_AT)).toBe(true);
      expect(ProjectSsoProviderStanding.doesVouchFor(ON, 0)).toBe(true);
      // One that does not say when it was given too: nothing ended before it.
      expect(ProjectSsoProviderStanding.doesVouchFor(ON, null)).toBe(true);
    });

    test("a provider that is off, or not there, vouches for nobody", () => {
      expect(
        ProjectSsoProviderStanding.doesVouchFor(
          { isOn: false, signInsEndedAtMs: null },
          ENDED_AT,
        ),
      ).toBe(false);
      expect(
        ProjectSsoProviderStanding.doesVouchFor(OFF, ENDED_AT + 60_000),
      ).toBe(false);
      expect(
        ProjectSsoProviderStanding.doesVouchFor(PROVIDER_NOT_FOUND, Date.now()),
      ).toBe(false);
    });

    test("turned off and on again: only a sign-in given after it was turned off counts", () => {
      const turnedOnAgain: ProjectSsoProviderStandingValue = {
        isOn: true,
        signInsEndedAtMs: ENDED_AT,
      };

      expect(
        ProjectSsoProviderStanding.doesVouchFor(turnedOnAgain, ENDED_AT + 1000),
      ).toBe(true);
      expect(
        ProjectSsoProviderStanding.doesVouchFor(turnedOnAgain, ENDED_AT - 1000),
      ).toBe(false);
      // Issue times are whole seconds: the second it was turned off is before.
      expect(
        ProjectSsoProviderStanding.doesVouchFor(turnedOnAgain, ENDED_AT),
      ).toBe(false);
      // A sign-in that does not say when it was given cannot be placed after.
      expect(ProjectSsoProviderStanding.doesVouchFor(turnedOnAgain, null)).toBe(
        false,
      );
    });
  });

  test("only a project's SAML and OIDC kinds are project provider kinds", () => {
    expect(isProjectSsoProviderType(SsoProviderType.ProjectSSO)).toBe(true);
    expect(isProjectSsoProviderType(SsoProviderType.ProjectOIDC)).toBe(true);
    expect(isProjectSsoProviderType(SsoProviderType.GlobalSSO)).toBe(false);
    expect(isProjectSsoProviderType(SsoProviderType.GlobalOIDC)).toBe(false);
    expect(isProjectSsoProviderType(undefined)).toBe(false);
    expect(isProjectSsoProviderType(null)).toBe(false);
    expect(isProjectSsoProviderType("projectsso")).toBe(false);
  });

  describe("get", () => {
    test("answers from the database once, then from this server for a minute", async () => {
      const load: Load = loadAnswering(ON);

      await expect(ask({ load })).resolves.toEqual(ON);
      await expect(ask({ load })).resolves.toEqual(ON);

      expect(load).toHaveBeenCalledTimes(1);
      expect(ProjectSsoProviderStanding.size()).toBe(1);
    });

    test("an answer older than a minute is read again", async () => {
      const startedAt: number = Date.now();
      const now: SpyInstance<() => number> = jest
        .spyOn(Date, "now")
        .mockReturnValue(startedAt);

      const load: Load = loadAnswering(ON);

      await ask({ load });

      now.mockReturnValue(
        startedAt + PROJECT_SSO_PROVIDER_STANDING_CACHE_TTL_MS - 1,
      );
      await ask({ load });
      expect(load).toHaveBeenCalledTimes(1);

      now.mockReturnValue(
        startedAt + PROJECT_SSO_PROVIDER_STANDING_CACHE_TTL_MS + 1,
      );
      await ask({ load });
      expect(load).toHaveBeenCalledTimes(2);
    });

    test("requests that ask while the database is read share the one read", async () => {
      const held: HeldLoad = heldLoad();

      const first: Promise<ProjectSsoProviderStandingValue> = ask({
        load: held.load,
      });
      const second: Promise<ProjectSsoProviderStandingValue> = ask({
        load: held.load,
      });

      await settle();
      held.answer(ON);

      await expect(first).resolves.toEqual(ON);
      await expect(second).resolves.toEqual(ON);
      expect(held.load).toHaveBeenCalledTimes(1);
    });

    test("a read that fails is an error for every request that shared it, and is not kept", async () => {
      const held: HeldLoad = heldLoad();

      const first: Promise<ProjectSsoProviderStandingValue> = ask({
        load: held.load,
      });
      const second: Promise<ProjectSsoProviderStandingValue> = ask({
        load: held.load,
      });

      await settle();
      held.fail(new Error("database unavailable"));

      await expect(first).rejects.toThrow("database unavailable");
      await expect(second).rejects.toThrow("database unavailable");
      expect(ProjectSsoProviderStanding.size()).toBe(0);

      // The next request reads again.
      const load: Load = loadAnswering(ON);
      await expect(ask({ load })).resolves.toEqual(ON);
      expect(load).toHaveBeenCalledTimes(1);
    });

    test("a load that throws before it returns a promise is an error too", async () => {
      const load: Load = jest.fn(
        (): Promise<ProjectSsoProviderStandingValue> => {
          throw new Error("could not ask");
        },
      );

      await expect(ask({ load })).rejects.toThrow("could not ask");
      expect(ProjectSsoProviderStanding.size()).toBe(0);
    });

    test("a SAML and an OIDC provider never answer for each other, nor two projects, nor two providers", async () => {
      const samlLoad: Load = loadAnswering(ON);
      const oidcLoad: Load = loadAnswering(PROVIDER_NOT_FOUND);
      const otherProjectLoad: Load = loadAnswering(PROVIDER_NOT_FOUND);
      const otherProviderLoad: Load = loadAnswering(OFF);

      await expect(
        ask({ load: samlLoad, providerType: SsoProviderType.ProjectSSO }),
      ).resolves.toEqual(ON);
      await expect(
        ask({ load: oidcLoad, providerType: SsoProviderType.ProjectOIDC }),
      ).resolves.toEqual(PROVIDER_NOT_FOUND);
      await expect(
        ask({ load: otherProjectLoad, projectId: OTHER_PROJECT_ID }),
      ).resolves.toEqual(PROVIDER_NOT_FOUND);
      await expect(
        ask({ load: otherProviderLoad, providerId: OTHER_PROVIDER_ID }),
      ).resolves.toEqual(OFF);

      for (const load of [
        samlLoad,
        oidcLoad,
        otherProjectLoad,
        otherProviderLoad,
      ]) {
        expect(load).toHaveBeenCalledTimes(1);
      }

      expect(ProjectSsoProviderStanding.size()).toBe(4);
    });

    test("ids are matched however they are written", async () => {
      const load: Load = loadAnswering(ON);

      await ask({
        load,
        projectId: new ObjectID(PROJECT_ID.toString().toUpperCase()),
        providerId: new ObjectID(PROVIDER_ID.toString().toUpperCase()),
      });
      await ask({ load });

      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  describe("forget", () => {
    test("a project's answers are forgotten, and only that project's", async () => {
      const load: Load = loadAnswering(ON);
      const oidcLoad: Load = loadAnswering(ON);
      const otherProjectLoad: Load = loadAnswering(ON);

      await ask({ load });
      await ask({ load: oidcLoad, providerType: SsoProviderType.ProjectOIDC });
      await ask({ load: otherProjectLoad, projectId: OTHER_PROJECT_ID });

      ProjectSsoProviderStanding.forget(PROJECT_ID);

      expect(ProjectSsoProviderStanding.size()).toBe(1);

      await ask({ load });
      await ask({ load: oidcLoad, providerType: SsoProviderType.ProjectOIDC });
      await ask({ load: otherProjectLoad, projectId: OTHER_PROJECT_ID });

      expect(load).toHaveBeenCalledTimes(2);
      expect(oidcLoad).toHaveBeenCalledTimes(2);
      expect(otherProjectLoad).toHaveBeenCalledTimes(1);
    });

    test("a project named as text, in any case, is forgotten too", async () => {
      const load: Load = loadAnswering(ON);

      await ask({ load });
      ProjectSsoProviderStanding.forget(PROJECT_ID.toString().toUpperCase());

      expect(ProjectSsoProviderStanding.size()).toBe(0);
    });

    test("with no project, every answer is forgotten", async () => {
      await ask({ load: loadAnswering(ON) });
      await ask({ load: loadAnswering(ON), projectId: OTHER_PROJECT_ID });

      ProjectSsoProviderStanding.forget();

      expect(ProjectSsoProviderStanding.size()).toBe(0);
    });

    test("a read under way when the project's answers are forgotten answers its own request but is not kept, and the next request reads again", async () => {
      const stale: HeldLoad = heldLoad();

      const underWay: Promise<ProjectSsoProviderStandingValue> = ask({
        load: stale.load,
      });
      await settle();

      // The provider is turned off here, and its project's answers forgotten.
      ProjectSsoProviderStanding.forget(PROJECT_ID);

      // A request after the forget does not wait for the read from before it.
      const fresh: Load = loadAnswering(OFF);
      await expect(ask({ load: fresh })).resolves.toEqual(OFF);
      expect(fresh).toHaveBeenCalledTimes(1);

      // The read from before answers with what it found, for its request only.
      stale.answer(ON);
      await expect(underWay).resolves.toEqual(ON);

      // What is kept is the fresh answer.
      const after: Load = loadAnswering(ON);
      await expect(ask({ load: after })).resolves.toEqual(OFF);
      expect(after).not.toHaveBeenCalled();
    });

    test("a read under way when every answer is forgotten is not kept either", async () => {
      const stale: HeldLoad = heldLoad();

      const underWay: Promise<ProjectSsoProviderStandingValue> = ask({
        load: stale.load,
      });
      await settle();

      ProjectSsoProviderStanding.forget();

      stale.answer(ON);
      await expect(underWay).resolves.toEqual(ON);

      expect(ProjectSsoProviderStanding.size()).toBe(0);
    });

    test("another project's read under way is not kept either: forgetting is never undone by a read from before it", async () => {
      const stale: HeldLoad = heldLoad();

      const underWay: Promise<ProjectSsoProviderStandingValue> = ask({
        load: stale.load,
        projectId: OTHER_PROJECT_ID,
      });
      await settle();

      ProjectSsoProviderStanding.forget(PROJECT_ID);

      stale.answer(ON);
      await expect(underWay).resolves.toEqual(ON);

      // Read again next time: a little more work, never a stale answer kept.
      expect(ProjectSsoProviderStanding.size()).toBe(0);
    });
  });
});

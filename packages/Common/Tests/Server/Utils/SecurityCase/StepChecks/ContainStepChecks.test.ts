import {
  ContainHostStepCheck,
  ContainUserStepCheck,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/ContainStepChecks";
import { ContainmentStateReading } from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/ContainmentState";
import { settleStepCheck } from "../../../../../Server/Utils/SecurityCase/StepChecks/SecurityCaseStepCheckRunner";
import {
  STEP_CHECK_DOCS_PATH,
  StepCheck,
  StepCheckResult,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/StepCheck";
import {
  ProductContainment,
  ProductContainmentHow,
} from "../../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookContainment";
import { ResponseLinkKind } from "../../../../../Types/SecurityCase/SecurityCaseResponseLink";
import SecurityCaseStepCheckState from "../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  CHECK_COULD_NOT_CHECK,
  CHECK_FACT_NO_ACCOUNT,
  CHECK_HOST_CONTAINED,
  CHECK_HOST_ISOLATED,
  CHECK_HOST_NO_CONNECTION,
  CHECK_HOST_PENDING,
  CHECK_HOST_RELEASED_AGAIN,
  CHECK_PRODUCT_READ_FAILED,
  CHECK_PRODUCT_SAID,
  CHECK_USER_ACTIVE,
  CHECK_USER_ACTIVE_AGAIN,
  CHECK_USER_DISABLED_NOT_SIGNED_OUT,
  CHECK_USER_DISABLED_SIGNED_OUT,
  CHECK_USER_NOT_FOUND,
  CHECK_USER_SUSPENDED,
  CHECK_USER_SUSPENDED_SINCE,
} from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  at,
  context,
  fakeEvidence,
  planStep,
  previousCheck,
  stepTarget,
  tick,
} from "../../../../Helpers/SecurityCaseStepChecks";
import { describe, expect, test } from "@jest/globals";

/*
 * "Suspend alice@acme.com's account and end its sessions" and "Take
 * web-01 off the network" (#10340), read back from the products the
 * project is connected to - Okta, Microsoft Entra ID, Google Workspace;
 * CrowdStrike Falcon, Microsoft Defender - whoever did it: a playbook, or
 * an admin by hand in the product's own console. What the product says is
 * the evidence; a product that cannot be read is never "not contained".
 */

const USER: string = "alice@acme.com";
const HOST: string = "web-01";
const USER_KEY: string = `contain:user:${USER}`;
const HOST_KEY: string = `contain:host:${HOST}`;
const OKTA_URL: string =
  "https://acme-admin.okta.com/admin/user/profile/view/00u1";

async function checkUser(data: {
  userState?: ContainmentStateReading;
  minute: number;
  previous?: ReturnType<typeof previousCheck> | null;
  failing?: boolean;
  task?: ReturnType<typeof tick> | null;
}): Promise<StepCheckResult> {
  return await run(ContainUserStepCheck, USER_KEY, USER, data, data.userState);
}

async function checkHost(data: {
  hostState?: ContainmentStateReading;
  minute: number;
  previous?: ReturnType<typeof previousCheck> | null;
}): Promise<StepCheckResult> {
  return await run(
    ContainHostStepCheck,
    HOST_KEY,
    HOST,
    data,
    undefined,
    data.hostState,
  );
}

async function run(
  stepCheck: StepCheck,
  key: string,
  value: string,
  data: {
    minute: number;
    previous?: ReturnType<typeof previousCheck> | null;
    failing?: boolean;
    task?: ReturnType<typeof tick> | null;
  },
  userState?: ContainmentStateReading,
  hostState?: ContainmentStateReading,
): Promise<StepCheckResult> {
  const result: StepCheckResult | null = await stepCheck.check(
    context({
      target: stepTarget({
        step: planStep(key, value),
        previous: data.previous || null,
        task: data.task || null,
      }),
      evidence: fakeEvidence({
        ...(userState ? { userState } : {}),
        ...(hostState ? { hostState } : {}),
        ...(data.failing
          ? { failing: ["readUserState", "readHostState"] }
          : {}),
      }).evidence,
      minute: data.minute,
    }),
  );

  expect(result).not.toBeNull();

  return result!;
}

function okta(
  containment: ProductContainment,
  extras: Partial<{ since: Date | null; how: ProductContainmentHow }> = {},
): ContainmentStateReading {
  return {
    answers: [
      {
        provider: "Okta",
        reading: {
          provider: "Okta",
          containment,
          since: extras.since ?? null,
          ...(extras.how ? { how: extras.how } : {}),
          url: OKTA_URL,
        },
      },
    ],
  };
}

describe("an account suspended by hand in Okta, outside OneUptime", () => {
  test("is verified from what Okta says, since when it says, with the account one click away", async () => {
    const result: StepCheckResult = await checkUser({
      userState: okta(ProductContainment.Contained, {
        how: ProductContainmentHow.Suspended,
        since: at(12),
      }),
      minute: 20,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_USER_SUSPENDED_SINCE,
      values: { user: USER, provider: "Okta" },
      times: { since: at(12).toISOString() },
    });
    expect(result.evidence.links).toEqual([
      { kind: ResponseLinkKind.OpenProvider, provider: "Okta", url: OKTA_URL },
    ]);
    expect(result.evidence.data["doneSince"]).toBe(at(12).toISOString());
  });

  test("a product that does not say since when is verified all the same", async () => {
    const result: StepCheckResult = await checkUser({
      userState: okta(ProductContainment.Contained, {
        how: ProductContainmentHow.Suspended,
      }),
      minute: 20,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result.evidence.sentence.template).toBe(CHECK_USER_SUSPENDED);
  });

  test("an account still active is not done, though somebody ticked the step: a tick is a promise", async () => {
    const result: StepCheckResult = await checkUser({
      userState: okta(ProductContainment.NotContained),
      minute: 20,
      task: tick(USER_KEY, 15),
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_USER_ACTIVE,
      values: { user: USER, provider: "Okta" },
    });
  });

  test("active again after it was suspended has stopped holding, and stays the same regression", async () => {
    const held: StepCheckResult = await checkUser({
      userState: okta(ProductContainment.Contained, {
        how: ProductContainmentHow.Suspended,
        since: at(12),
      }),
      minute: 20,
    });
    const previous: ReturnType<typeof previousCheck> = previousCheck({
      stepKey: USER_KEY,
      state: held.state,
      evidence: held.evidence,
      stateSince: at(20),
    });
    const regressed: StepCheckResult = await checkUser({
      userState: okta(ProductContainment.NotContained),
      minute: 35,
      previous,
    });

    expect(regressed.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(regressed.evidence.sentence).toEqual({
      template: CHECK_USER_ACTIVE_AGAIN,
      values: { user: USER, provider: "Okta" },
    });
    expect(regressed.evidence.data["regressedAt"]).toBe(at(35).toISOString());
    expect(
      settleStepCheck({
        previous,
        result: regressed,
        now: at(35),
        intervalInMinutes: ContainUserStepCheck.intervalInMinutes,
      }).isNewRegression,
    ).toBe(true);

    const again: StepCheckResult = await checkUser({
      userState: okta(ProductContainment.NotContained),
      minute: 50,
      previous: previousCheck({
        stepKey: USER_KEY,
        state: regressed.state,
        evidence: regressed.evidence,
        stateSince: at(35),
      }),
    });

    expect(again.evidence.data["regressedAt"]).toBe(at(35).toISOString());
  });
});

describe("a Microsoft Entra ID account, which is disabled rather than suspended", () => {
  function entra(sessionsEndedAt: Date | null): ContainmentStateReading {
    return {
      answers: [
        {
          provider: "Microsoft Entra ID",
          reading: {
            provider: "Microsoft Entra ID",
            containment: ProductContainment.Contained,
            how: ProductContainmentHow.Disabled,
            since: null,
            sessionsEndedAt,
          },
        },
      ],
    };
  }

  test("holds once its sessions were ended after the case opened", async () => {
    const result: StepCheckResult = await checkUser({
      userState: entra(at(10)),
      minute: 20,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_USER_DISABLED_SIGNED_OUT,
      values: { user: USER, provider: "Microsoft Entra ID" },
      times: { since: at(10).toISOString() },
    });
  });

  test("disabled with sessions last ended before the case opened is not done: a stolen session still works", async () => {
    const result: StepCheckResult = await checkUser({
      userState: entra(at(-120)),
      minute: 20,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence.template).toBe(
      CHECK_USER_DISABLED_NOT_SIGNED_OUT,
    );
  });
});

describe("a host, in CrowdStrike Falcon and Microsoft Defender", () => {
  function host(
    provider: string,
    containment: ProductContainment,
    how?: ProductContainmentHow,
  ): ContainmentStateReading {
    return {
      answers: [
        {
          provider,
          reading: {
            provider,
            containment,
            since: null,
            ...(how ? { how } : {}),
          },
        },
      ],
    };
  }

  test("network-contained in Falcon is verified", async () => {
    const result: StepCheckResult = await checkHost({
      hostState: host(
        "CrowdStrike Falcon",
        ProductContainment.Contained,
        ProductContainmentHow.NetworkContained,
      ),
      minute: 20,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_HOST_CONTAINED,
      values: { host: HOST, provider: "CrowdStrike Falcon" },
    });
  });

  test("isolated in Defender is verified, in Defender's own word", async () => {
    const result: StepCheckResult = await checkHost({
      hostState: host(
        "Microsoft Defender",
        ProductContainment.Contained,
        ProductContainmentHow.Isolated,
      ),
      minute: 20,
    });

    expect(result.evidence.sentence.template).toBe(CHECK_HOST_ISOLATED);
  });

  test("on its way to being contained is not done yet", async () => {
    const result: StepCheckResult = await checkHost({
      hostState: host("CrowdStrike Falcon", ProductContainment.Pending),
      minute: 20,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence.template).toBe(CHECK_HOST_PENDING);
  });

  test("released after it was contained has stopped holding", async () => {
    const held: StepCheckResult = await checkHost({
      hostState: host(
        "CrowdStrike Falcon",
        ProductContainment.Contained,
        ProductContainmentHow.NetworkContained,
      ),
      minute: 20,
    });
    const result: StepCheckResult = await checkHost({
      hostState: host("CrowdStrike Falcon", ProductContainment.NotContained),
      minute: 40,
      previous: previousCheck({
        stepKey: HOST_KEY,
        state: held.state,
        evidence: held.evidence,
        stateSince: at(20),
      }),
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(result.evidence.sentence.template).toBe(CHECK_HOST_RELEASED_AGAIN);
  });

  test("held back in two products: verified, the second said as a fact", async () => {
    const result: StepCheckResult = await checkHost({
      hostState: {
        answers: [
          ...host(
            "CrowdStrike Falcon",
            ProductContainment.Contained,
            ProductContainmentHow.NetworkContained,
          ).answers,
          ...host(
            "Microsoft Defender",
            ProductContainment.Contained,
            ProductContainmentHow.Isolated,
          ).answers,
        ],
      },
      minute: 20,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result.evidence.facts).toEqual([
      {
        template: CHECK_HOST_ISOLATED,
        values: { host: HOST, provider: "Microsoft Defender" },
      },
    ]);
  });
});

describe("what OneUptime cannot tell, and why", () => {
  test("no connection to a product that holds accounts: it says which it would need, with the docs", async () => {
    const result: StepCheckResult = await checkHost({
      hostState: { answers: [] },
      minute: 20,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_HOST_NO_CONNECTION,
      values: { host: HOST },
    });
    expect(result.evidence.docsPath).toBe(STEP_CHECK_DOCS_PATH);
  });

  test("a product that cannot be read is never taken as not contained: it says what the product said, and tries again soon", async () => {
    const result: StepCheckResult = await checkUser({
      userState: {
        answers: [{ provider: "Okta", error: "Okta answered 403: no access" }],
      },
      minute: 20,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_PRODUCT_READ_FAILED,
      values: { value: USER, provider: "Okta" },
    });
    expect(result.evidence.facts).toEqual([
      {
        template: CHECK_PRODUCT_SAID,
        values: { provider: "Okta", error: "Okta answered 403: no access" },
      },
    ]);
    expect(result.recheckInMinutes).toBe(5);
  });

  test("one product that lets the account in is enough to say not done, though another could not be read", async () => {
    const result: StepCheckResult = await checkUser({
      userState: {
        answers: [
          { provider: "Microsoft Entra ID", error: "timeout" },
          ...okta(ProductContainment.NotContained).answers,
        ],
      },
      minute: 20,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
  });

  test("no product the project is connected to has the account", async () => {
    const result: StepCheckResult = await checkUser({
      userState: okta(ProductContainment.NotFound),
      minute: 20,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_USER_NOT_FOUND,
      values: { user: USER },
    });
    expect(result.evidence.facts).toEqual([
      {
        template: CHECK_FACT_NO_ACCOUNT,
        values: { provider: "Okta", value: USER },
      },
    ]);
  });

  test("the connections that cannot be read at all: it could not check, and tries again soon", async () => {
    const result: StepCheckResult = await checkUser({
      minute: 20,
      failing: true,
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence.template).toBe(CHECK_COULD_NOT_CHECK);
    expect(result.evidence.data["readFailed"]).toBe(true);
  });
});

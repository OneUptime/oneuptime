import {
  ResponseLink,
  ResponseLinkKind,
} from "../../../../Types/SecurityCase/SecurityCaseResponseLink";
import {
  SecurityCaseStepCheckSentence,
  readStepCheckDataTime,
} from "../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState, {
  isStepCheckHolding,
} from "../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { RESPONSE_STEP_KINDS } from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import {
  CHECK_COULD_NOT_CHECK,
  CHECK_FACT_NO_ACCOUNT,
  CHECK_FACT_NO_DEVICE,
  CHECK_HOST_CONTAINED,
  CHECK_HOST_ISOLATED,
  CHECK_HOST_NOT_CONTAINED,
  CHECK_HOST_NOT_FOUND,
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
  CHECK_USER_NO_CONNECTION,
  CHECK_USER_SUSPENDED,
  CHECK_USER_SUSPENDED_SINCE,
} from "../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  ProductContainment,
  ProductContainmentHow,
  ProductContainmentReading,
} from "../../SecurityPlaybook/SecurityPlaybookContainment";
import {
  ContainmentProductAnswer,
  ContainmentStateReading,
} from "./Evidence/ContainmentState";
import {
  STEP_CHECK_DOCS_PATH,
  StepCheck,
  StepCheckContext,
  StepCheckResult,
  StepCheckTarget,
  evidenceOf,
  isStillRegressed,
  sentence,
} from "./StepCheck";

/*
 * "SUSPEND THE ACCOUNT AND END ITS SESSIONS" AND "CUT THE HOST OFF THE
 * NETWORK" (#10340), read back from the products the project is connected
 * to - Okta, Microsoft Entra ID, Google Workspace; CrowdStrike Falcon,
 * Microsoft Defender - whoever did it: a playbook, a person in the product,
 * anyone.
 *
 *   Verified    every product that has the account or the host holds it
 *               back: suspended, or disabled with its sessions ended after
 *               the case opened; network-contained, or isolated;
 *   Not Done    one of them does not, or is still on its way to;
 *   Regressed   it was held back, and is not any more;
 *   Cannot Tell no product it is connected to has the account or the host,
 *               the project has no such connection, or one could not be
 *               read - which is never read as "not contained".
 */

export enum ContainTarget {
  User = "User",
  Host = "Host",
}

export interface ContainInput {
  kind: ContainTarget;
  value: string;
  now: Date;
  // When the case opened: an account's sessions ended before it say nothing.
  caseOpenedAt: Date;
  target: StepCheckTarget;
  reading: ContainmentStateReading;
}

function providerLink(reading: ProductContainmentReading): ResponseLink | null {
  return reading.url
    ? {
        kind: ResponseLinkKind.OpenProvider,
        provider: reading.provider,
        url: reading.url,
      }
    : null;
}

// Whether a product's answer holds the account or the host back, as the step asks.
export function isHeldBack(data: {
  reading: ProductContainmentReading;
  caseOpenedAt: Date;
}): boolean {
  if (data.reading.containment !== ProductContainment.Contained) {
    return false;
  }

  // A disabled Entra ID account holds only once its sessions were ended after the case opened.
  if (data.reading.how === ProductContainmentHow.Disabled) {
    return Boolean(
      data.reading.sessionsEndedAt &&
        data.reading.sessionsEndedAt.getTime() >= data.caseOpenedAt.getTime(),
    );
  }

  return true;
}

// What the step says of a product that holds it back.
function heldSentence(data: {
  kind: ContainTarget;
  value: string;
  reading: ProductContainmentReading;
}): SecurityCaseStepCheckSentence {
  const { reading } = data;
  const provider: string = reading.provider;

  if (data.kind === ContainTarget.Host) {
    return sentence(
      reading.how === ProductContainmentHow.Isolated
        ? CHECK_HOST_ISOLATED
        : CHECK_HOST_CONTAINED,
      { host: data.value, provider },
    );
  }

  if (reading.how === ProductContainmentHow.Disabled) {
    return sentence(
      CHECK_USER_DISABLED_SIGNED_OUT,
      { user: data.value, provider },
      { times: { since: reading.sessionsEndedAt } },
    );
  }

  return reading.since
    ? sentence(
        CHECK_USER_SUSPENDED_SINCE,
        { user: data.value, provider },
        { times: { since: reading.since } },
      )
    : sentence(CHECK_USER_SUSPENDED, { user: data.value, provider });
}

export function decideContain(input: ContainInput): StepCheckResult {
  const isUser: boolean = input.kind === ContainTarget.User;
  const valueKey: string = isUser ? "user" : "host";
  const answers: Array<ContainmentProductAnswer> = input.reading.answers;

  if (answers.length === 0) {
    return {
      state: SecurityCaseStepCheckState.CannotTell,
      evidence: evidenceOf({
        sentence: sentence(
          isUser ? CHECK_USER_NO_CONNECTION : CHECK_HOST_NO_CONNECTION,
          { [valueKey]: input.value },
        ),
        docsPath: STEP_CHECK_DOCS_PATH,
        data: { reason: "NoConnection" },
      }),
    };
  }

  const failed: Array<ContainmentProductAnswer> = answers.filter(
    (answer: ContainmentProductAnswer): boolean => {
      return !answer.reading;
    },
  );
  const found: Array<ProductContainmentReading> = answers
    .map(
      (answer: ContainmentProductAnswer): ProductContainmentReading | null => {
        return answer.reading || null;
      },
    )
    .filter(
      (
        reading: ProductContainmentReading | null,
      ): reading is ProductContainmentReading => {
        return (
          reading !== null &&
          reading.containment !== ProductContainment.NotFound
        );
      },
    );
  const notHeld: Array<ProductContainmentReading> = found.filter(
    (reading: ProductContainmentReading): boolean => {
      return !isHeldBack({ reading, caseOpenedAt: input.caseOpenedAt });
    },
  );
  const links: Array<ResponseLink | null> = found.map(providerLink);

  // A product that still lets it in: what is known is enough to say not done.
  if (notHeld.length > 0) {
    const first: ProductContainmentReading = notHeld[0]!;
    const wasHeld: boolean =
      Boolean(
        input.target.previous &&
          isStepCheckHolding(input.target.previous.state),
      ) || isStillRegressed(input.target);

    if (wasHeld) {
      const regressedAt: Date =
        (isStillRegressed(input.target)
          ? readStepCheckDataTime(
              input.target.previous?.evidence.data,
              "regressedAt",
            )
          : null) || input.now;

      return {
        state: SecurityCaseStepCheckState.Regressed,
        evidence: evidenceOf({
          sentence: sentence(
            isUser ? CHECK_USER_ACTIVE_AGAIN : CHECK_HOST_RELEASED_AGAIN,
            { [valueKey]: input.value, provider: first.provider },
          ),
          links,
          data: { regressedAt, provider: first.provider },
        }),
      };
    }

    let line: SecurityCaseStepCheckSentence;

    if (first.containment === ProductContainment.Pending) {
      line = sentence(CHECK_HOST_PENDING, {
        host: input.value,
        provider: first.provider,
      });
    } else if (first.how === ProductContainmentHow.Disabled) {
      line = sentence(CHECK_USER_DISABLED_NOT_SIGNED_OUT, {
        user: input.value,
        provider: first.provider,
      });
    } else {
      line = sentence(isUser ? CHECK_USER_ACTIVE : CHECK_HOST_NOT_CONTAINED, {
        [valueKey]: input.value,
        provider: first.provider,
      });
    }

    return {
      state: SecurityCaseStepCheckState.NotDone,
      evidence: evidenceOf({
        sentence: line,
        links,
        data: { provider: first.provider },
      }),
    };
  }

  // A product that could not be read may be the one that lets it in.
  if (failed.length > 0) {
    const answer: ContainmentProductAnswer = failed[0]!;

    return {
      state: SecurityCaseStepCheckState.CannotTell,
      evidence: evidenceOf({
        sentence: sentence(CHECK_PRODUCT_READ_FAILED, {
          value: input.value,
          provider: answer.provider,
        }),
        facts: failed.map(
          (
            failure: ContainmentProductAnswer,
          ): SecurityCaseStepCheckSentence => {
            return sentence(CHECK_PRODUCT_SAID, {
              provider: failure.provider,
              error: failure.error || "",
            });
          },
        ),
        data: { readFailed: true, provider: answer.provider },
      }),
      recheckInMinutes: 5,
    };
  }

  if (found.length === 0) {
    return {
      state: SecurityCaseStepCheckState.CannotTell,
      evidence: evidenceOf({
        sentence: sentence(
          isUser ? CHECK_USER_NOT_FOUND : CHECK_HOST_NOT_FOUND,
          { [valueKey]: input.value },
        ),
        facts: answers.map(
          (answer: ContainmentProductAnswer): SecurityCaseStepCheckSentence => {
            return sentence(
              isUser ? CHECK_FACT_NO_ACCOUNT : CHECK_FACT_NO_DEVICE,
              {
                provider: answer.provider,
                value: input.value,
              },
            );
          },
        ),
        data: { reason: "NotFound" },
      }),
    };
  }

  const first: ProductContainmentReading = found[0]!;

  return {
    state: SecurityCaseStepCheckState.Verified,
    evidence: evidenceOf({
      sentence: heldSentence({
        kind: input.kind,
        value: input.value,
        reading: first,
      }),
      facts: found
        .slice(1)
        .map(
          (
            reading: ProductContainmentReading,
          ): SecurityCaseStepCheckSentence => {
            return heldSentence({
              kind: input.kind,
              value: input.value,
              reading,
            });
          },
        ),
      links,
      data: {
        doneSince:
          (input.target.previous &&
          isStepCheckHolding(input.target.previous.state)
            ? readStepCheckDataTime(
                input.target.previous.evidence.data,
                "doneSince",
              )
            : null) ||
          first.since ||
          first.sessionsEndedAt ||
          input.now,
        provider: first.provider,
      },
    }),
  };
}

function containCheck(kind: ContainTarget): StepCheck {
  return {
    kind:
      kind === ContainTarget.User
        ? RESPONSE_STEP_KINDS.user
        : RESPONSE_STEP_KINDS.host,
    // A product's API, not the app's own data: asked less often.
    intervalInMinutes: 15,
    check: async (
      context: StepCheckContext,
    ): Promise<StepCheckResult | null> => {
      const value: string = context.target.value;

      if (!value) {
        return null;
      }

      let reading: ContainmentStateReading;

      try {
        reading =
          kind === ContainTarget.User
            ? await context.evidence.readUserState(value)
            : await context.evidence.readHostState(value);
      } catch {
        return {
          state: SecurityCaseStepCheckState.CannotTell,
          evidence: evidenceOf({
            sentence: sentence(CHECK_COULD_NOT_CHECK),
            data: { readFailed: true },
          }),
          recheckInMinutes: 5,
        };
      }

      return decideContain({
        kind,
        value,
        now: context.now,
        caseOpenedAt: context.securityCase.createdAt,
        target: context.target,
        reading,
      });
    },
  };
}

export const ContainUserStepCheck: StepCheck = containCheck(ContainTarget.User);
export const ContainHostStepCheck: StepCheck = containCheck(ContainTarget.Host);

/*
 * The verdict the command policies (CommandPolicy, KubectlPolicy) give one
 * AI-composed command, and the longest command either accepts.
 *
 * A leaf module with no imports on purpose: it is part of the pure policy
 * closure that agents/KubernetesAIAgent carries a byte-identical copy of
 * (see Tests/Utils/AiRemediation/KubernetesAiAgentPolicyCopyParity.test.ts),
 * so it must never import anything outside that closure.
 * AiRemediationCommandPlan re-exports both names.
 */

export enum AiRemediationCommandPolicyVerdict {
  /*
   * Matched the rule's operator-authored allowlist and passed the
   * structural chain guard — eligible for FullAuto inline execution.
   */
  AutoApproved = "AutoApproved",
  // Not denylisted, but a human must approve before it runs.
  RequiresApproval = "RequiresApproval",
  /*
   * Matched the hard denylist. Denied commands are never stored in a plan —
   * the verdict exists so policy evaluation has a complete result type.
   */
  Denied = "Denied",
}

// Hard cap — enforced at plan acceptance, not just in the prompt.
export const MAX_COMMAND_LENGTH_CHARS: number = 2000;

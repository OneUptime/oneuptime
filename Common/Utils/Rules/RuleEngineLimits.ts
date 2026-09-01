import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";

/*
 * How many of a project's automation rules one engine run reads.
 *
 * Every rule engine — label, owner, on-call, privacy, auto-remediation,
 * runbook — answers the same question when a resource is created: "which of
 * this project's enabled rules match it?". That read used to be written as
 * `limit: 100, skip: 0`, which is not a page of a paged walk but the whole
 * evaluation: rule 101 and beyond were fetched by nobody and therefore
 * matched nothing, forever.
 *
 * Nothing surfaced it. The engines have no queue, no cursor and no counter;
 * they run inline in the resource's onCreateSuccess and log only what they
 * attached. A project with 1,243 monitor label rules imported 1,000+ monitors
 * and watched ~50-100 of them get labelled while the rest stayed bare, which
 * reads exactly like a backlog draining slowly and is in fact 92% of the
 * rules never being consulted at all (OneUptime/oneuptime#3506).
 *
 * The default sort on these reads is createdAt DESC, so the 100 that DID run
 * were the newest — which is why a rule written early, against a naming
 * convention the estate was later built on, is precisely the kind of rule
 * that went quiet.
 *
 * LIMIT_PER_PROJECT is the codebase's existing bound for "every row of this
 * kind in one project". Rules are hand-authored configuration, so this is a
 * ceiling rather than a page size: a project would need 10,000 enabled rules
 * of a single kind to reach it.
 */
export const MAX_RULES_EVALUATED_PER_PROJECT: number = LIMIT_PER_PROJECT;

export default MAX_RULES_EVALUATED_PER_PROJECT;

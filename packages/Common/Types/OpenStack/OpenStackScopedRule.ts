/*
 * A RULE ON ONE PROJECT OR DOMAIN OF A CLOUD.
 *
 * "A project maps to a team, so its incidents reach the people who run it." An OpenStack
 * cloud's owner and label rules can name one project, one domain, or one project in one
 * domain, by Keystone's ID, because either can be renamed. A rule that does is about what
 * opens there and not about the cloud: it adds nothing to the cloud, and what it adds goes
 * on each alert and incident that reaches what it names (OpenStackScopedRules). A rule that
 * names neither owns whole clouds, as it always did.
 *
 * Pure, so a page, a test and the server can all read it.
 */

export interface OpenStackRuleScopeColumns {
  openStackProjectId?: string | null | undefined;
  openStackDomainId?: string | null | undefined;
}

// A project something reaches, with its domain when the inventory says which that is.
export interface OpenStackReachedProject {
  projectId: string;
  domainId?: string | null | undefined;
  // What people call it, and what it holds on the part, for telling each owner their own.
  name?: string | null | undefined;
  holdings?: string | undefined;
}

export function isOpenStackRuleScoped(
  rule: OpenStackRuleScopeColumns,
): boolean {
  return Boolean(
    rule.openStackProjectId?.trim() || rule.openStackDomainId?.trim(),
  );
}

// A rule naming both reaches that project only while it is in that domain.
export function doesOpenStackRuleReach(
  rule: OpenStackRuleScopeColumns,
  reached: ReadonlyArray<OpenStackReachedProject>,
): boolean {
  const projectId: string | undefined = rule.openStackProjectId?.trim();
  const domainId: string | undefined = rule.openStackDomainId?.trim();

  if (!projectId && !domainId) {
    return false;
  }

  return reached.some((project: OpenStackReachedProject): boolean => {
    return (
      (!projectId || project.projectId === projectId) &&
      (!domainId || project.domainId === domainId)
    );
  });
}

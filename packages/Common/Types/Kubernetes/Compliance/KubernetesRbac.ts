import {
  KubernetesPolicyRule,
  KubernetesRoleBindingSpec,
  KubernetesRoleSpec,
  KubernetesSubject,
} from "../KubernetesPolicyObjects";

/*
 * WHAT A CLUSTER'S RBAC GRANTS, AS THE CIS KUBERNETES BENCHMARK ASKS (#9627).
 *
 * A rule grants a request the way the API server's authorizer decides it
 * (k8s.io/kubernetes pkg/apis/rbac/v1 ResourceMatches and VerbMatches): a
 * "*" matches every group, resource or verb; a subresource is matched by
 * "resource/subresource" or "*\/subresource" - never by "resource/*". A rule
 * limited to some resourceNames grants access to those objects only, which
 * the "minimize access" controls do not count against a cluster.
 *
 * The roles and bindings Kubernetes and the managed platforms create and
 * keep up themselves are not the cluster owner's to change, so the
 * controls read the others: a built-in one carries the bootstrapping label,
 * or a name in the system: namespace of names, or EKS's and GKE's own
 * prefixes.
 */

export interface KubernetesRbacRequest {
  // The API group: "" for the core group.
  group: string;
  resource: string;
  subresource?: string | undefined;
  verb: string;
}

export interface KubernetesRbacObjectMeta {
  name: string;
  labels?: Record<string, string> | null | undefined;
}

export interface KubernetesComplianceRole extends KubernetesRbacObjectMeta {
  kind: "Role" | "ClusterRole";
  // "" for a ClusterRole.
  namespace: string;
  spec: KubernetesRoleSpec;
}

export interface KubernetesComplianceBinding extends KubernetesRbacObjectMeta {
  kind: "RoleBinding" | "ClusterRoleBinding";
  // "" for a ClusterRoleBinding.
  namespace: string;
  spec: KubernetesRoleBindingSpec;
}

const WILDCARD: string = "*";

export const BOOTSTRAPPING_LABEL: string = "kubernetes.io/bootstrapping";
export const BOOTSTRAPPING_VALUE: string = "rbac-defaults";

// Names Kubernetes and the managed platforms give the RBAC objects they keep up.
export const BUILT_IN_RBAC_NAME_PREFIXES: ReadonlyArray<string> = [
  "system:",
  "eks:",
  "gce:",
];

export function isBuiltInRbacObject(object: KubernetesRbacObjectMeta): boolean {
  return (
    (object.labels || {})[BOOTSTRAPPING_LABEL] === BOOTSTRAPPING_VALUE ||
    BUILT_IN_RBAC_NAME_PREFIXES.some((prefix: string): boolean => {
      return object.name.startsWith(prefix);
    })
  );
}

function matchesGroup(rule: KubernetesPolicyRule, group: string): boolean {
  return rule.apiGroups.some((ruleGroup: string): boolean => {
    return ruleGroup === WILDCARD || ruleGroup === group;
  });
}

function matchesResource(
  rule: KubernetesPolicyRule,
  resource: string,
  subresource: string | undefined,
): boolean {
  const combined: string = subresource
    ? `${resource}/${subresource}`
    : resource;

  return rule.resources.some((ruleResource: string): boolean => {
    if (ruleResource === WILDCARD || ruleResource === combined) {
      return true;
    }

    return Boolean(subresource) && ruleResource === `*/${subresource}`;
  });
}

function matchesVerb(rule: KubernetesPolicyRule, verb: string): boolean {
  return rule.verbs.some((ruleVerb: string): boolean => {
    return ruleVerb === WILDCARD || ruleVerb === verb;
  });
}

/*
 * Whether a rule grants the request to every object of its kind: a rule
 * limited to named objects does not.
 */
export function ruleGrants(
  rule: KubernetesPolicyRule,
  request: KubernetesRbacRequest,
): boolean {
  return (
    (rule.resourceNames || []).length === 0 &&
    matchesGroup(rule, request.group) &&
    matchesResource(rule, request.resource, request.subresource) &&
    matchesVerb(rule, request.verb)
  );
}

// The requests of the list the role grants, in the list's order.
export function getGrantedRequests(
  role: KubernetesRoleSpec,
  requests: ReadonlyArray<KubernetesRbacRequest>,
): Array<KubernetesRbacRequest> {
  return requests.filter((request: KubernetesRbacRequest): boolean => {
    return role.rules.some((rule: KubernetesPolicyRule): boolean => {
      return ruleGrants(rule, request);
    });
  });
}

// The role a binding grants: a ClusterRole, or a Role of the binding's namespace.
export function findBoundRole(
  binding: KubernetesComplianceBinding,
  roles: ReadonlyArray<KubernetesComplianceRole>,
): KubernetesComplianceRole | null {
  const ref: { kind: string; name: string } = binding.spec.roleRef;

  return (
    roles.find((role: KubernetesComplianceRole): boolean => {
      if (role.name !== ref.name || role.kind !== ref.kind) {
        return false;
      }

      return (
        role.kind === "ClusterRole" || role.namespace === binding.namespace
      );
    }) || null
  );
}

// "ServiceAccount ci/deployer", "User jane@example.com", "Group devs".
export function describeSubject(subject: KubernetesSubject): string {
  const name: string =
    subject.kind === "ServiceAccount" && subject.namespace
      ? `${subject.namespace}/${subject.name}`
      : subject.name;

  return `${subject.kind} ${name}`;
}

// "ClusterRole cluster-admin".
export function describeRoleRef(binding: KubernetesComplianceBinding): string {
  return `${binding.spec.roleRef.kind} ${binding.spec.roleRef.name}`;
}

// Where a rule uses a wildcard, as "rules[<n>].<field>".
export function getWildcardFields(role: KubernetesRoleSpec): Array<string> {
  const fields: Array<string> = [];

  role.rules.forEach((rule: KubernetesPolicyRule, index: number): void => {
    for (const field of ["apiGroups", "resources", "verbs"] as const) {
      if (rule[field].includes(WILDCARD)) {
        fields.push(`rules[${index}].${field}`);
      }
    }
  });

  return fields;
}

// Whether a binding names a service account of this namespace and name.
export function bindsServiceAccount(
  binding: KubernetesComplianceBinding,
  namespace: string,
  name: string,
): boolean {
  return binding.spec.subjects.some((subject: KubernetesSubject): boolean => {
    return (
      subject.kind === "ServiceAccount" &&
      subject.name === name &&
      // A RoleBinding's subject with no namespace is of the binding's own.
      (subject.namespace || binding.namespace) === namespace
    );
  });
}

// Package features names the provider's feature flags.
package features

import (
	xpfeature "github.com/crossplane/crossplane-runtime/v2/pkg/feature"
)

// EnableBetaManagementPolicies lets a managed resource say what Crossplane
// may do to it: observe only, to bring a resource OneUptime already has
// under Kubernetes, or leave it in place when the managed resource is
// deleted. On by default (--enable-management-policies).
const EnableBetaManagementPolicies xpfeature.Flag = xpfeature.EnableBetaManagementPolicies

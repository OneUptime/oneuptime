package provider

// Old resource and data source names that keep working.
//
// Type names used to be built by splitting on every change of case, which
// cut mixed-case words apart: "IoT Fleet" became oneuptime_io_t_fleet and
// "vCenter" became oneuptime_v_center. They keep such words whole now
// (oneuptime_iot_fleet, oneuptime_vcenter), and each renamed type is still
// registered under its old name as a deprecated alias, so no configuration
// breaks. A moved block brings a resource's state over to the new name:
//
//	moved {
//	  from = oneuptime_io_t_fleet.example
//	  to   = oneuptime_iot_fleet.example
//	}

import (
	"context"
	"fmt"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
)

// legacyResourceAlias pairs a renamed resource with the deprecated alias
// registered under its old name.
type legacyResourceAlias struct {
	Name       string
	LegacyName string
	New        func() resource.Resource
	NewLegacy  func() resource.Resource
}

// legacyDataSourceAlias is legacyResourceAlias for data sources.
type legacyDataSourceAlias struct {
	Name       string
	LegacyName string
	New        func() datasource.DataSource
	NewLegacy  func() datasource.DataSource
}

// legacyNameStateMover moves the state of a resource from its old type name
// to its current one. Both names share one schema, so the state moves as it
// is; attributes the schema has since dropped are ignored on the way.
func legacyNameStateMover(legacyTypeName string, target schema.Schema) resource.StateMover {
	return resource.StateMover{
		SourceSchema: &target,
		StateMover: func(ctx context.Context, req resource.MoveStateRequest, resp *resource.MoveStateResponse) {
			if req.SourceTypeName != legacyTypeName || !isOneUptimeProviderAddress(req.SourceProviderAddress) {
				return
			}

			if req.SourceState == nil {
				resp.Diagnostics.AddError(
					"Unable to Move Resource State",
					fmt.Sprintf("The state of %s could not be read with this provider's schema. Run terraform apply with the old resource name once to refresh it, then move it again.", legacyTypeName),
				)
				return
			}

			resp.TargetState.Raw = req.SourceState.Raw
		},
	}
}

// isOneUptimeProviderAddress reports whether a provider address
// (HOSTNAME/NAMESPACE/TYPE) is this provider's, from either registry.
func isOneUptimeProviderAddress(address string) bool {
	address = strings.ToLower(address)

	return address == "oneuptime/oneuptime" || strings.HasSuffix(address, "/oneuptime/oneuptime")
}

package provider

// THE ID OF ANOTHER RECORD, AT PLAN TIME.
//
// Every attribute that holds the ID of another record - team_id,
// monitor_id, on_call_duty_policy_escalation_rule_id, the labels of a
// monitor - takes that record's ID, a UUID, as OneUptime writes its IDs. A
// name or a slug there (team_id = "sre") planned cleanly and failed the
// apply with the API's "Invalid ID format". It is refused at plan time now,
// saying what to write instead: a reference to the resource, the ID a data
// source reads, or - for a person - their email address.
//
// A value known only at apply - a reference to a resource not created yet -
// is left to the apply, as Terraform leaves every unknown value.

import (
	"context"
	"fmt"
	"regexp"

	"github.com/hashicorp/terraform-plugin-framework-validators/listvalidator"
	"github.com/hashicorp/terraform-plugin-framework-validators/setvalidator"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
)

// recordIDPattern is OneUptime's ID: a UUID, in either case
// (Common/Types/ObjectID.ts, UUID_REGEX).
var recordIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// The type a person's ID is of: their user ID.
const personResourceType = "oneuptime_user"

// recordIDValidator refuses a value that cannot be the ID of a record of
// resourceType (oneuptime_team), the type the attribute's description names.
type recordIDValidator struct {
	resourceType string
	// A person's ID: the attribute that names them by address instead.
	emailAttribute string
	// A record OneUptime makes itself - an AI run, a scan, a log entry -
	// has a data source and no resource: its ID is read with the data
	// source, never referred to as a resource's.
	dataSourceOnly bool
}

func (v recordIDValidator) Description(ctx context.Context) string {
	return v.MarkdownDescription(ctx)
}

func (v recordIDValidator) MarkdownDescription(_ context.Context) string {
	return "must be the ID of a " + v.resourceType + ", a UUID"
}

func (v recordIDValidator) ValidateString(_ context.Context, req validator.StringRequest, resp *validator.StringResponse) {
	if req.ConfigValue.IsNull() || req.ConfigValue.IsUnknown() {
		return
	}

	value := req.ConfigValue.ValueString()
	if isRecordID(value) {
		return
	}

	resp.Diagnostics.AddAttributeError(req.Path, "Not an ID", v.detail(value))
}

// isRecordID says whether a value can be a OneUptime ID.
func isRecordID(value string) bool {
	return recordIDPattern.MatchString(value)
}

// detail says what an ID looks like, and where to get one.
func (v recordIDValidator) detail(value string) string {
	const looksLike = "OneUptime IDs are UUIDs, such as 550e8400-e29b-41d4-a716-446655440000."

	if v.resourceType == personResourceType {
		if v.emailAttribute != "" {
			return fmt.Sprintf("%q is not a user ID: %s Name the person by their email address, in %s, instead.", value, looksLike, v.emailAttribute)
		}
		return fmt.Sprintf("%q is not a user ID: %s Read someone's ID with data.oneuptime_user.", value, looksLike)
	}

	if v.dataSourceOnly {
		return fmt.Sprintf(
			"%q is not the ID of a %s: %s Read the ID with the %s data source.",
			value, v.resourceType, looksLike, v.resourceType,
		)
	}

	return fmt.Sprintf(
		"%q is not the ID of a %s: %s Refer to the resource instead (%s.<name>.id), or read the ID with the %s data source.",
		value, v.resourceType, looksLike, v.resourceType, v.resourceType,
	)
}

// recordIDValidators: the ID of one record of resourceType.
func recordIDValidators(resourceType string) []validator.String {
	return []validator.String{recordIDValidator{resourceType: resourceType}}
}

// recordIDSetValidators: the IDs of records of resourceType, as a set.
func recordIDSetValidators(resourceType string) []validator.Set {
	return []validator.Set{setvalidator.ValueStringsAre(recordIDValidator{resourceType: resourceType})}
}

// recordIDListValidators: the IDs of records of resourceType, in order.
func recordIDListValidators(resourceType string) []validator.List {
	return []validator.List{listvalidator.ValueStringsAre(recordIDValidator{resourceType: resourceType})}
}

// dataSourceRecordIDValidators: the ID of one record of resourceType, a
// type with a data source and no resource.
func dataSourceRecordIDValidators(resourceType string) []validator.String {
	return []validator.String{recordIDValidator{resourceType: resourceType, dataSourceOnly: true}}
}

// dataSourceRecordIDSetValidators: the IDs of records of resourceType, a
// type with a data source and no resource, as a set.
func dataSourceRecordIDSetValidators(resourceType string) []validator.Set {
	return []validator.Set{setvalidator.ValueStringsAre(recordIDValidator{resourceType: resourceType, dataSourceOnly: true})}
}

// dataSourceRecordIDListValidators: the IDs of records of resourceType, a
// type with a data source and no resource, in order.
func dataSourceRecordIDListValidators(resourceType string) []validator.List {
	return []validator.List{listvalidator.ValueStringsAre(recordIDValidator{resourceType: resourceType, dataSourceOnly: true})}
}

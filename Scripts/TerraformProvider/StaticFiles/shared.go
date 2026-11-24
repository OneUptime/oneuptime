package provider

// WHAT PEOPLE AND ONEUPTIME BOTH CHANGE.
//
// Some of a record's values are a person's to set and OneUptime's to change
// too, on its own (TableColumnMetadata.serverOwned "shared" in OneUptime's
// models, the spec's x-oneuptime-server-owned, #10052): the labels a label
// rule adds to a monitor, an exception OneUptime resolves, the site
// discovery finds a device at, the postmortem an AI writes. A configuration
// may set them, and a create and an update send them. What OneUptime changes
// is never mistaken for a change to undo:
//
//   - Left out of the configuration, the plan keeps the record's value,
//     OneUptime's, even where the attribute has a default. A default means
//     "this unless you say otherwise" when the record is created; after
//     that, a plan that put the default back would undo the rule, the
//     resolution or the discovery each time.
//
//   - Under Crossplane, a manifest's spec.forProvider value is sent to
//     create the record, and again whenever the manifest's value changes -
//     never because OneUptime moved the record's. A list of IDs (labels) is
//     held to the entries the manifest declares: an entry OneUptime added
//     stays, an entry the manifest declares is put back if it goes, and an
//     entry taken out of the manifest is taken off the record. The
//     Crossplane provider keeps what it last applied of the manifest in an
//     annotation of the managed resource, and hands it to the provider it
//     makes for each reconcile (LastApplied, NewUnderCrossplane).
//
// PlanShared does both, in each such resource's ModifyPlan.
//
//   - Under Terraform, a value in the configuration is held to as Terraform
//     holds any attribute: the plan shows OneUptime's change and puts it
//     back. A plan has to say what the apply does, and a Terraform plan of a
//     configured attribute is the configuration's value or the state's -
//     "the configured labels, and the ones a rule added besides" is neither,
//     so it could only be shown as removing the rule's labels while keeping
//     them. `lifecycle { ignore_changes = [...] }` gives such a value at
//     creation alone.

import (
	"context"
	"math/big"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// SharedAttribute is an attribute people and OneUptime both change.
type SharedAttribute struct {
	// Its Terraform name.
	Name string
	// A list or a set of IDs, held entry by entry: under Crossplane, the
	// Entries a manifest declares, beside the ones OneUptime added.
	Entries bool
}

// LastApplied is what a Crossplane manifest said of the attributes people
// and OneUptime both change when the Crossplane provider last applied it,
// by Terraform name: a list's entries ([]any of IDs), or a value (a string,
// a bool, a float64). Recorded is false while the provider has applied
// nothing of the manifest yet: a resource being created, or one it adopts.
type LastApplied struct {
	Recorded bool
	Fields   map[string]any
}

// PlanShared is part of the ModifyPlan of every resource with attributes
// people and OneUptime both change, after KeepLeftOutUnderCrossplane and
// before KeepStateWhenNothingChanges.
func PlanShared(ctx context.Context, req resource.ModifyPlanRequest, resp *resource.ModifyPlanResponse, client *Client, attributes []SharedAttribute) {
	if req.State.Raw.IsNull() || resp.Plan.Raw.IsNull() || len(attributes) == 0 {
		// A create sends what the configuration gives; a destroy plans nothing.
		return
	}

	configured := map[string]tftypes.Value{}
	prior := map[string]tftypes.Value{}
	planned := map[string]tftypes.Value{}
	if req.Config.Raw.As(&configured) != nil || req.State.Raw.As(&prior) != nil || resp.Plan.Raw.As(&planned) != nil {
		return
	}

	var lastApplied *LastApplied
	if underCrossplane.Load() && client != nil {
		lastApplied = client.lastApplied
	}

	kept := map[string]bool{}
	next := make(map[string]tftypes.Value, len(planned))
	for name, value := range planned {
		next[name] = value
	}

	for _, attribute := range attributes {
		config, ok := configured[attribute.Name]
		if !ok {
			continue
		}
		before, ok := prior[attribute.Name]
		if !ok {
			continue
		}
		value, changed := planSharedAttribute(attribute, config, before, planned[attribute.Name], lastApplied)
		if !changed {
			continue
		}
		next[attribute.Name] = value
		kept[attribute.Name] = value.Equal(before)
	}

	if len(kept) == 0 {
		return
	}
	resp.Plan.Raw = tftypes.NewValue(resp.Plan.Raw.Type(), next)

	// A value kept as it is replaces nothing.
	replaces := path.Paths{}
	for _, replaced := range resp.RequiresReplace {
		if steps := replaced.Steps(); len(steps) > 0 {
			if name, ok := steps[0].(path.PathStepAttributeName); ok && kept[string(name)] {
				continue
			}
		}
		replaces = append(replaces, replaced)
	}
	resp.RequiresReplace = replaces
	_ = ctx
}

// planSharedAttribute is the plan of one attribute people and OneUptime both
// change, of a record that exists, and whether it differs from the plan the
// attribute's own modifiers made.
func planSharedAttribute(attribute SharedAttribute, config, prior, planned tftypes.Value, lastApplied *LastApplied) (tftypes.Value, bool) {
	if !config.IsKnown() {
		// Known only at apply: Terraform plans it as written.
		return planned, false
	}

	// Left out: OneUptime's, whatever the attribute's default.
	if config.IsNull() {
		/*
		 * Under Crossplane, a list the manifest declared entries of when it
		 * was last applied, and leaves out now, had them all taken out: a
		 * manifest cannot hold an empty list (Kubernetes drops it), so this
		 * is how the last entry goes. What OneUptime added stays. A list the
		 * manifest moved to spec.initProvider is not in what it last applied
		 * (the Crossplane provider's LastAppliedOf), and keeps its entries.
		 */
		if attribute.Entries && lastApplied != nil && lastApplied.Recorded && prior.IsKnown() && !prior.IsNull() {
			if last, ok := lastApplied.Fields[attribute.Name]; ok && last != nil {
				none := tftypes.NewValue(prior.Type(), []tftypes.Value{})
				if value, ok := heldToDeclaredEntries(none, prior, last, true); ok && !value.Equal(prior) {
					return value, true
				}
			}
		}
		if planned.Equal(prior) {
			return planned, false
		}
		return prior, true
	}

	if lastApplied == nil || !prior.IsKnown() {
		// Terraform: the configuration's value, as written.
		return planned, false
	}

	last, declaredBefore := lastApplied.Fields[attribute.Name]
	if !lastApplied.Recorded {
		declaredBefore = false
	}

	if attribute.Entries {
		value, ok := heldToDeclaredEntries(config, prior, last, declaredBefore)
		if !ok || value.Equal(planned) {
			return planned, false
		}
		return value, true
	}

	// A value: sent when the manifest's changed since it was last applied.
	if lastApplied.Recorded && declaredBefore && sameAsApplied(config, last) {
		if planned.Equal(prior) {
			return planned, false
		}
		return prior, true
	}
	return planned, false
}

// heldToDeclaredEntries is the record's list held to the entries a manifest
// declares: what the record has, without the entries the manifest declared
// when it was last applied and no longer does, with every entry it
// declares. An entry OneUptime added, which the manifest never declared,
// stays. With nothing recorded of the manifest - a resource an earlier
// version left, or one adopted by its ID - no entry is taken off: one the
// manifest leaves out may be OneUptime's.
func heldToDeclaredEntries(config, prior tftypes.Value, last any, declaredBefore bool) (tftypes.Value, bool) {
	declared, ok := entriesOf(config)
	if !ok {
		return tftypes.Value{}, false
	}
	has, ok := entriesOf(prior)
	if !ok {
		return tftypes.Value{}, false
	}

	takenOut := map[string]bool{}
	if declaredBefore {
		inManifest := map[string]bool{}
		for _, entry := range declared {
			inManifest[entryKey(entry)] = true
		}
		for _, entry := range idsOf(last) {
			if !inManifest[entryKey(entry)] {
				takenOut[entryKey(entry)] = true
			}
		}
	}

	seen := map[string]bool{}
	var entries []string
	for _, entry := range has {
		key := entryKey(entry)
		if takenOut[key] || seen[key] {
			continue
		}
		seen[key] = true
		entries = append(entries, entry)
	}
	for _, entry := range declared {
		key := entryKey(entry)
		if seen[key] {
			continue
		}
		seen[key] = true
		entries = append(entries, entry)
	}

	elementType := elementTypeOf(prior.Type())
	if elementType == nil {
		return tftypes.Value{}, false
	}
	values := make([]tftypes.Value, 0, len(entries))
	for _, entry := range entries {
		values = append(values, tftypes.NewValue(elementType, entry))
	}
	return tftypes.NewValue(prior.Type(), values), true
}

// entriesOf is a list or a set of strings as its strings, in order.
func entriesOf(value tftypes.Value) ([]string, bool) {
	if value.IsNull() {
		return nil, true
	}
	if !value.IsKnown() {
		return nil, false
	}
	var elements []tftypes.Value
	if err := value.As(&elements); err != nil {
		return nil, false
	}
	entries := make([]string, 0, len(elements))
	for _, element := range elements {
		if !element.IsKnown() {
			return nil, false
		}
		if element.IsNull() {
			continue
		}
		var entry string
		if err := element.As(&entry); err != nil {
			return nil, false
		}
		entries = append(entries, entry)
	}
	return entries, true
}

// elementTypeOf is the type of a list's or a set's elements.
func elementTypeOf(t tftypes.Type) tftypes.Type {
	switch typed := t.(type) {
	case tftypes.Set:
		return typed.ElementType
	case tftypes.List:
		return typed.ElementType
	}
	return nil
}

// entryKey is how two entries are the same: an ID, whatever its case.
func entryKey(entry string) string {
	return strings.ToLower(strings.TrimSpace(entry))
}

// idsOf is a list a manifest gave, as JSON read it: its strings.
func idsOf(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	ids := make([]string, 0, len(items))
	for _, item := range items {
		if id, ok := item.(string); ok {
			ids = append(ids, id)
		}
	}
	return ids
}

// sameAsApplied says whether a configured value is the one the manifest gave
// when it was last applied, as JSON read it: a string, a bool or a number.
func sameAsApplied(config tftypes.Value, last any) bool {
	switch {
	case config.Type().Is(tftypes.String):
		var value string
		if config.As(&value) != nil {
			return false
		}
		text, ok := last.(string)
		return ok && text == value
	case config.Type().Is(tftypes.Bool):
		var value bool
		if config.As(&value) != nil {
			return false
		}
		flag, ok := last.(bool)
		return ok && flag == value
	case config.Type().Is(tftypes.Number):
		var value big.Float
		if config.As(&value) != nil {
			return false
		}
		var number *big.Float
		switch typed := last.(type) {
		case float64:
			number = big.NewFloat(typed)
		case int64:
			number = new(big.Float).SetInt64(typed)
		case int:
			number = new(big.Float).SetInt64(int64(typed))
		default:
			return false
		}
		return number.Cmp(&value) == 0
	}
	return false
}

package provider

// LISTS ONEUPTIME ADDS TO AS WELL, HELD BY THE ENTRIES A CONFIGURATION
// DECLARES (#10134, #10135).
//
// OneUptime adds to some of a record's lists on its own: a label rule adds
// its labels to a monitor, an on-call rule its policies to an incident, an
// SLO's monitor rules attach monitors (the spec's x-oneuptime-server-owned
// "shared", on a list of IDs). Earlier versions held such a list to the
// configuration, as Terraform holds any attribute: a configuration that set
// `labels` took off a rule's label at every apply, and the rule put it
// back. Now a configuration manages the entries it declares, as the
// Crossplane provider manages a manifest's (shared.go):
//
//   - an entry the configuration lists is added, and put back if someone
//     takes it off;
//   - an entry taken out of the configuration is taken off, the last one
//     included (`labels = []` takes off every one it declared);
//   - every other entry - one OneUptime or a person added - stays, and is
//     never shown as a change;
//   - left out of the configuration, the list is OneUptime's, as since
//     #10052: nothing is added or taken off.
//
// Terraform holds the plan of a configured attribute to the configuration,
// so the state holds what the configuration declares, not the record's
// whole list: a read keeps the declared entries the record still has, and
// drops one someone took off, which the next plan adds back. Which lists
// hold a configuration's entries is kept in the resource's private state
// (declaredEntriesKey): a list a configuration never declared holds none,
// and its state is null.
//
//   - A create declares what its configuration lists, and sends the list
//     with the record.
//   - An update adds and takes off single entries (the API's addToList and
//     removeFromList, #10135): what the plan adds to the state's entries,
//     and takes off them. An entry OneUptime adds while the update runs
//     stays, and so does every entry the configuration never declared.
//   - An import adopts the record's entries: its first read takes the
//     record's whole list into the state, so a configuration written from
//     the record - the Dashboard's Terraform page writes one - plans no
//     change, and an entry it leaves out is shown being taken off.
//   - A state an earlier version wrote declares nothing: a configuration
//     that lists entries plans them being added once, which adds none the
//     record has and takes none off.
//
// The provider's exclusive_lists = true holds every such list as earlier
// versions did: the configuration's list is the record's whole list, the
// state is the record's, and an update sends the whole list. Under
// Crossplane the state is the record's too, and an update sends the
// entries planShared works out from what the manifest last applied.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

// The private state key: the attributes whose state holds the entries a
// configuration declares - a JSON array of their Terraform names.
const declaredEntriesKey = "declared_entries"

// The request body's keys of an update's single entries (#10135).
const (
	addToListKey      = "addToList"
	removeFromListKey = "removeFromList"
)

// What a create's answer names the fields it left out with (#10136).
const fieldsLeftOutHeader = "X-OneUptime-Fields-Left-Out"

// holdsDeclaredEntries says whether a list's state holds only the entries
// the configuration declares: under Terraform, unless exclusive_lists.
func (c *Client) holdsDeclaredEntries() bool {
	return c != nil && !c.exclusiveLists && !underCrossplane.Load()
}

// changesEntriesOneByOne says whether an update sends a list's changes
// entry by entry rather than the whole list: always, but under Terraform
// with exclusive_lists.
func (c *Client) changesEntriesOneByOne() bool {
	return underCrossplane.Load() || c == nil || !c.exclusiveLists
}

// declaredEntries is which attributes hold a configuration's entries.
type declaredEntries map[string]bool

// readDeclaredEntries is what the private state says, or nothing.
func readDeclaredEntries(ctx context.Context, private privateState) declaredEntries {
	declared := declaredEntries{}
	if noPrivateState(private) {
		return declared
	}
	value, diags := private.GetKey(ctx, declaredEntriesKey)
	if diags.HasError() || len(value) == 0 {
		return declared
	}
	var names []string
	if json.Unmarshal(value, &names) != nil {
		return declared
	}
	for _, name := range names {
		declared[name] = true
	}
	return declared
}

// write keeps them in the private state; none clears the key.
func (d declaredEntries) write(ctx context.Context, private privateState) diag.Diagnostics {
	if noPrivateState(private) {
		return nil
	}
	names := []string{}
	for name, isDeclared := range d {
		if isDeclared {
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		return private.SetKey(ctx, declaredEntriesKey, nil)
	}
	sort.Strings(names)
	value, err := json.Marshal(names)
	if err != nil {
		return nil
	}
	return private.SetKey(ctx, declaredEntriesKey, value)
}

// elementsOf is a set's or a list's elements, or none when null or unknown.
func elementsOf(value attr.Value) []attr.Value {
	if value == nil || value.IsNull() || value.IsUnknown() {
		return nil
	}
	if elements, ok := value.(interface{ Elements() []attr.Value }); ok {
		return elements.Elements()
	}
	return nil
}

// entriesIn is a list's or a set's IDs, in order, each once.
func entriesIn(value attr.Value) []string {
	seen := map[string]bool{}
	entries := []string{}
	for _, element := range elementsOf(value) {
		text, ok := element.(types.String)
		if !ok || text.IsNull() || text.IsUnknown() {
			continue
		}
		key := entryKey(text.ValueString())
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		entries = append(entries, text.ValueString())
	}
	return entries
}

func hasEntry(entries []string, entry string) bool {
	key := entryKey(entry)
	for _, each := range entries {
		if entryKey(each) == key {
			return true
		}
	}
	return false
}

// keptEntries is `declared` without the entries the record no longer has.
func keptEntries(declared, record []string) []string {
	kept := []string{}
	for _, entry := range declared {
		if hasEntry(record, entry) {
			kept = append(kept, entry)
		}
	}
	return kept
}

func stringSetOf(entries []string) types.Set {
	values := make([]attr.Value, 0, len(entries))
	for _, entry := range entries {
		values = append(values, types.StringValue(entry))
	}
	return types.SetValueMust(types.StringType, values)
}

func stringListOf(entries []string) types.List {
	values := make([]attr.Value, 0, len(entries))
	for _, entry := range entries {
		values = append(values, types.StringValue(entry))
	}
	return types.ListValueMust(types.StringType, values)
}

// heldEntriesAfterRead is which entries a list's state holds after a read,
// given the state before it and the record's list: the record's under
// Crossplane or exclusive_lists; else what the configuration declared that
// the record still has, the record's whole list on the read after an import
// (which adopts them), or none (null) for a list no configuration declared.
// adopted says the list was taken whole: its state holds declared entries.
func heldEntriesAfterRead(client *Client, declared declaredEntries, name string, prior, record attr.Value) (entries []string, isNull bool, adopted bool) {
	if !client.holdsDeclaredEntries() {
		return entriesIn(record), record.IsNull(), false
	}
	if !declared[name] {
		return nil, true, false
	}
	if prior == nil || prior.IsNull() || prior.IsUnknown() {
		return entriesIn(record), false, true
	}
	return keptEntries(entriesIn(prior), entriesIn(record)), false, false
}

// setEntriesAfterRead is heldEntriesAfterRead for a set attribute.
func setEntriesAfterRead(client *Client, declared declaredEntries, name string, prior, record types.Set) types.Set {
	entries, isNull, _ := heldEntriesAfterRead(client, declared, name, prior, record)
	if isNull {
		return types.SetNull(types.StringType)
	}
	if !client.holdsDeclaredEntries() {
		return record
	}
	return stringSetOf(entries)
}

// listEntriesAfterRead is heldEntriesAfterRead for a list attribute.
func listEntriesAfterRead(client *Client, declared declaredEntries, name string, prior, record types.List) types.List {
	entries, isNull, _ := heldEntriesAfterRead(client, declared, name, prior, record)
	if isNull {
		return types.ListNull(types.StringType)
	}
	if !client.holdsDeclaredEntries() {
		return record
	}
	return stringListOf(entries)
}

// heldEntriesAfterWrite is what a list's state is after a create or an
// update, and whether the configuration declares its entries from then on:
//
//   - under Crossplane, the planned list - the manifest's entries beside
//     the record's - or the record's when nothing was planned: an entry
//     added meanwhile shows at the next observe, as Terraform requires the
//     state after an apply to be what was planned;
//   - left out of the configuration: on a create, none (null), or the
//     record's under exclusive_lists; on an update, the planned value,
//     which keepPlannedValues kept, declared as it was;
//   - in the configuration: the planned list, declared - the record holds
//     it now, beside what OneUptime added - and under exclusive_lists the
//     planned list too: one OneUptime added since shows at the next read.
func heldEntriesAfterWrite(client *Client, isCreate, wasDeclared bool, config, plan, record attr.Value) (value attr.Value, declared bool) {
	if underCrossplane.Load() {
		if plan == nil || plan.IsNull() || plan.IsUnknown() {
			return record, false
		}
		return plan, false
	}
	if config == nil || config.IsNull() {
		if isCreate {
			if !client.holdsDeclaredEntries() {
				return record, false
			}
			return nil, false
		}
		if plan == nil || plan.IsUnknown() {
			return record, wasDeclared && client.holdsDeclaredEntries()
		}
		return plan, wasDeclared && client.holdsDeclaredEntries()
	}
	if plan == nil || plan.IsUnknown() {
		return record, client.holdsDeclaredEntries()
	}
	return plan, client.holdsDeclaredEntries()
}

// setEntriesAfterWrite is heldEntriesAfterWrite for a set attribute.
func setEntriesAfterWrite(client *Client, isCreate, wasDeclared bool, config, plan, record types.Set) (types.Set, bool) {
	value, declared := heldEntriesAfterWrite(client, isCreate, wasDeclared, config, plan, record)
	if value == nil {
		return types.SetNull(types.StringType), declared
	}
	return value.(types.Set), declared
}

// listEntriesAfterWrite is heldEntriesAfterWrite for a list attribute.
func listEntriesAfterWrite(client *Client, isCreate, wasDeclared bool, config, plan, record types.List) (types.List, bool) {
	value, declared := heldEntriesAfterWrite(client, isCreate, wasDeclared, config, plan, record)
	if value == nil {
		return types.ListNull(types.StringType), declared
	}
	return value.(types.List), declared
}

// entryChanges is what an update adds to each list and takes off it, by
// the API's name of the list (#10135).
type entryChanges struct {
	add    map[string][]string
	remove map[string][]string
	// The Terraform names of the lists, by their API names: for refusals.
	names map[string]string
}

func newEntryChanges() *entryChanges {
	return &entryChanges{add: map[string][]string{}, remove: map[string][]string{}, names: map[string]string{}}
}

// diff records what makes `prior` into `planned`: each entry planned that
// prior does not have is added, each one prior has that planned does not
// is taken off. Entries compare as IDs do, whatever their case.
func (e *entryChanges) diff(name, apiName string, planned, prior attr.Value) {
	plannedEntries := entriesIn(planned)
	priorEntries := entriesIn(prior)
	e.names[apiName] = name
	for _, entry := range plannedEntries {
		if !hasEntry(priorEntries, entry) {
			e.add[apiName] = append(e.add[apiName], entry)
		}
	}
	for _, entry := range priorEntries {
		if !hasEntry(plannedEntries, entry) {
			e.remove[apiName] = append(e.remove[apiName], entry)
		}
	}
}

// any says whether there is an entry to add or take off.
func (e *entryChanges) any() bool {
	for _, entries := range e.add {
		if len(entries) > 0 {
			return true
		}
	}
	for _, entries := range e.remove {
		if len(entries) > 0 {
			return true
		}
	}
	return false
}

// addTo puts the entries in an update's request body, beside its data.
func (e *entryChanges) addTo(request map[string]interface{}) {
	for key, byList := range map[string]map[string][]string{addToListKey: e.add, removeFromListKey: e.remove} {
		lists := map[string]interface{}{}
		for apiName, entries := range byList {
			if len(entries) == 0 {
				continue
			}
			ids := make([]interface{}, 0, len(entries))
			for _, entry := range entries {
				ids = append(ids, entry)
			}
			lists[apiName] = ids
		}
		if len(lists) > 0 {
			request[key] = lists
		}
	}
}

// check says whether the record, read back after the update, holds what it
// added to a list and none of what it took off: a OneUptime older than
// this provider reads only an update's data, and changes no entry.
func (e *entryChanges) check(apiName string, record attr.Value) diag.Diagnostics {
	var diags diag.Diagnostics
	entries := entriesIn(record)
	missing := []string{}
	for _, entry := range e.add[apiName] {
		if !hasEntry(entries, entry) {
			missing = append(missing, entry)
		}
	}
	stayed := []string{}
	for _, entry := range e.remove[apiName] {
		if hasEntry(entries, entry) {
			stayed = append(stayed, entry)
		}
	}
	if len(missing) == 0 && len(stayed) == 0 {
		return diags
	}
	name := e.names[apiName]
	if name == "" {
		name = apiName
	}
	problems := []string{}
	if len(missing) > 0 {
		problems = append(problems, fmt.Sprintf("it did not add %s", strings.Join(missing, ", ")))
	}
	if len(stayed) > 0 {
		problems = append(problems, fmt.Sprintf("it did not take off %s", strings.Join(stayed, ", ")))
	}
	diags.AddError(
		fmt.Sprintf("OneUptime did not change %s", name),
		fmt.Sprintf("The update added entries to %s and took entries off it, one at a time, and %s. A OneUptime older than this provider changes no single entry: upgrade OneUptime to the provider's version, or set exclusive_lists = true in the provider block, which sends the whole list.", name, strings.Join(problems, ", and ")),
	)
	return diags
}

// fieldsLeftOutWarning is what a create's answer says it left out because
// only OneUptime writes it (#10136), as a warning, or none: a provider
// older than OneUptime may still send such a field.
func fieldsLeftOutWarning(resp *http.Response, resourceName string) diag.Diagnostics {
	var diags diag.Diagnostics
	if resp == nil {
		return diags
	}
	fields := []string{}
	for _, value := range resp.Header.Values(fieldsLeftOutHeader) {
		for _, field := range strings.Split(value, ",") {
			field = strings.TrimSpace(field)
			if field != "" && !hasEntry(fields, field) {
				fields = append(fields, field)
			}
		}
	}
	if len(fields) == 0 {
		return diags
	}
	diags.AddWarning(
		fmt.Sprintf("OneUptime created the %s without %s", resourceName, strings.Join(fields, ", ")),
		fmt.Sprintf("Only OneUptime writes %s, so the new %s has OneUptime's value. A provider older than this OneUptime still sends it: upgrade the provider to the version that matches your OneUptime.", strings.Join(fields, ", "), resourceName),
	)
	return diags
}

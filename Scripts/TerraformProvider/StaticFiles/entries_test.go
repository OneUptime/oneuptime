package provider

/*
 * The helpers that hold a list OneUptime adds to as well to the entries a
 * configuration declares, and update it entry by entry (entries.go,
 * #10134, #10135), on their own. entries_plan_test.go drives them through
 * the provider's protocol server against a fake API.
 */

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

const (
	entryA = "aaaaaaaa-0000-4000-8000-000000000001"
	entryB = "bbbbbbbb-0000-4000-8000-000000000002"
	entryC = "cccccccc-0000-4000-8000-000000000003"
)

// memoryPrivate is a resource's private state, as the framework keeps it.
type memoryPrivate map[string][]byte

func (m memoryPrivate) GetKey(_ context.Context, key string) ([]byte, diag.Diagnostics) {
	return m[key], nil
}

func (m memoryPrivate) SetKey(_ context.Context, key string, value []byte) diag.Diagnostics {
	if value == nil {
		delete(m, key)
		return nil
	}
	m[key] = value
	return nil
}

func terraformClient() *Client {
	underCrossplane.Store(false)
	return &Client{}
}

func exclusiveClient() *Client {
	underCrossplane.Store(false)
	return &Client{exclusiveLists: true}
}

func entriesOfSet(set types.Set) string {
	return strings.Join(sortedIDs(entriesIn(set)...), ",")
}

func TestEntriesAreHeldUnderTerraformButNotWithExclusiveListsOrUnderCrossplane(t *testing.T) {
	defer underCrossplane.Store(false)

	if !terraformClient().HoldsDeclaredEntries() || !terraformClient().ChangesEntriesOneByOne() {
		t.Fatalf("under Terraform a list holds the configuration's entries, and changes entry by entry")
	}
	if exclusiveClient().HoldsDeclaredEntries() || exclusiveClient().ChangesEntriesOneByOne() {
		t.Fatalf("with exclusive_lists the list is the configuration's whole list, sent whole")
	}
	underCrossplane.Store(true)
	client := &Client{}
	if client.HoldsDeclaredEntries() || !client.ChangesEntriesOneByOne() {
		t.Fatalf("under Crossplane the state is the record's, and an update changes entry by entry")
	}
}

func TestDeclaredEntriesAreKeptInThePrivateState(t *testing.T) {
	ctx := context.Background()
	private := memoryPrivate{}

	if got := ReadDeclaredEntries(ctx, private); len(got) != 0 {
		t.Fatalf("a state an earlier version wrote declares %v, want nothing", got)
	}
	if diags := (DeclaredEntries{"labels": true, "depends_on_monitors": false}).Write(ctx, private); diags.HasError() {
		t.Fatalf("writing: %v", diags)
	}
	if got := string(private[declaredEntriesKey]); got != `["labels"]` {
		t.Fatalf("the private state holds %s", got)
	}
	got := ReadDeclaredEntries(ctx, private)
	if !got["labels"] || got["depends_on_monitors"] {
		t.Fatalf("read back %v", got)
	}
	// None declared clears the key.
	if diags := (DeclaredEntries{"labels": false}).Write(ctx, private); diags.HasError() {
		t.Fatalf("writing: %v", diags)
	}
	if _, ok := private[declaredEntriesKey]; ok {
		t.Fatalf("the key stays: %v", private)
	}
	// No private state: nothing to read, nothing written, no error.
	if got := ReadDeclaredEntries(ctx, nil); len(got) != 0 {
		t.Fatalf("nothing to read, got %v", got)
	}
	if diags := (DeclaredEntries{"labels": true}).Write(ctx, nil); diags.HasError() {
		t.Fatalf("writing to no private state: %v", diags)
	}
}

func TestAReadKeepsTheDeclaredEntriesTheRecordStillHas(t *testing.T) {
	client := terraformClient()
	declared := DeclaredEntries{"labels": true}

	// A rule added C; someone took B off.
	got := SetEntriesAfterRead(client, declared, "labels", stringSetOf([]string{entryA, entryB}), stringSetOf([]string{entryA, entryC}))
	if entriesOfSet(got) != entryA {
		t.Fatalf("the state holds %s, want only the declared entry the record still has", entriesOfSet(got))
	}

	// IDs compare whatever their case.
	got = SetEntriesAfterRead(client, declared, "labels", stringSetOf([]string{strings.ToUpper(entryA)}), stringSetOf([]string{entryA}))
	if len(got.Elements()) != 1 {
		t.Fatalf("an entry in another case is the same entry: %v", got)
	}
}

func TestAReadOfAListNoConfigurationDeclaredHoldsNone(t *testing.T) {
	got := SetEntriesAfterRead(terraformClient(), DeclaredEntries{}, "labels", stringSetOf([]string{entryA}), stringSetOf([]string{entryA, entryB}))
	if !got.IsNull() {
		t.Fatalf("the state holds %v, want null: the list is OneUptime's", got)
	}
}

func TestTheReadAfterAnImportAdoptsTheRecordsEntries(t *testing.T) {
	got := SetEntriesAfterRead(terraformClient(), DeclaredEntries{"labels": true}, "labels", types.SetNull(types.StringType), stringSetOf([]string{entryA, entryB}))
	if entriesOfSet(got) != joinedIDs(entryA, entryB) {
		t.Fatalf("the state holds %s, want every entry the record has", entriesOfSet(got))
	}
}

func TestAReadWithExclusiveListsOrUnderCrossplaneIsTheRecordsWholeList(t *testing.T) {
	defer underCrossplane.Store(false)
	record := stringSetOf([]string{entryA, entryC})

	got := SetEntriesAfterRead(exclusiveClient(), DeclaredEntries{"labels": true}, "labels", stringSetOf([]string{entryA}), record)
	if entriesOfSet(got) != joinedIDs(entryA, entryC) {
		t.Fatalf("exclusive_lists: the state holds %s, want the record's", entriesOfSet(got))
	}

	underCrossplane.Store(true)
	got = SetEntriesAfterRead(&Client{}, DeclaredEntries{}, "labels", stringSetOf([]string{entryA}), record)
	if entriesOfSet(got) != joinedIDs(entryA, entryC) {
		t.Fatalf("Crossplane: the state holds %s, want the record's", entriesOfSet(got))
	}

	list := ListEntriesAfterRead(&Client{}, DeclaredEntries{}, "monitors", types.ListNull(types.StringType), stringListOf([]string{entryB}))
	if len(list.Elements()) != 1 {
		t.Fatalf("Crossplane: a list holds %v, want the record's", list)
	}
}

func TestAfterACreateTheStateIsTheConfigurationsOrNone(t *testing.T) {
	client := terraformClient()
	record := stringSetOf([]string{entryA, entryC})

	// Configured: the plan, declared - a rule's C is beside it on the record.
	got, declared := SetEntriesAfterWrite(client, true, false, stringSetOf([]string{entryA}), stringSetOf([]string{entryA}), record)
	if entriesOfSet(got) != entryA || !declared {
		t.Fatalf("got %s declared %v, want the configuration's, declared", entriesOfSet(got), declared)
	}

	// Left out: none, and nothing declared.
	got, declared = SetEntriesAfterWrite(client, true, false, types.SetNull(types.StringType), types.SetUnknown(types.StringType), record)
	if !got.IsNull() || declared {
		t.Fatalf("got %v declared %v, want null and nothing declared", got, declared)
	}

	// exclusive_lists, left out: the record's, as before.
	got, declared = SetEntriesAfterWrite(exclusiveClient(), true, false, types.SetNull(types.StringType), types.SetUnknown(types.StringType), record)
	if entriesOfSet(got) != joinedIDs(entryA, entryC) || declared {
		t.Fatalf("exclusive_lists: got %s declared %v", entriesOfSet(got), declared)
	}
}

func TestAfterAnUpdateALeftOutListKeepsItsPlanAndWhetherItWasDeclared(t *testing.T) {
	client := terraformClient()
	plan := stringSetOf([]string{entryA})

	got, declared := SetEntriesAfterWrite(client, false, true, types.SetNull(types.StringType), plan, stringSetOf([]string{entryA, entryB}))
	if entriesOfSet(got) != entryA || !declared {
		t.Fatalf("got %s declared %v, want the plan, still declared", entriesOfSet(got), declared)
	}
	got, declared = SetEntriesAfterWrite(client, false, false, types.SetNull(types.StringType), types.SetNull(types.StringType), stringSetOf([]string{entryB}))
	if !got.IsNull() || declared {
		t.Fatalf("got %v declared %v, want null, undeclared", got, declared)
	}
}

func TestAnUpdateSendsTheEntriesItAddsAndTakesOff(t *testing.T) {
	changes := NewEntryChanges()
	changes.Diff("labels", "labels", stringSetOf([]string{entryA, entryC}), stringSetOf([]string{entryA, entryB}))
	changes.Diff("depends_on_monitors", "dependsOnMonitors", stringSetOf([]string{entryA}), stringSetOf([]string{entryA}))

	if !changes.Any() {
		t.Fatalf("no change found")
	}
	request := map[string]interface{}{"data": map[string]interface{}{}}
	changes.AddTo(request)

	adds := request["addToList"].(map[string]interface{})
	removes := request["removeFromList"].(map[string]interface{})
	if len(adds) != 1 || adds["labels"].([]interface{})[0] != entryC {
		t.Fatalf("addToList is %v", adds)
	}
	if len(removes) != 1 || removes["labels"].([]interface{})[0] != entryB {
		t.Fatalf("removeFromList is %v", removes)
	}
	if _, sent := request["data"].(map[string]interface{})["labels"]; sent {
		t.Fatalf("the whole list was sent too: %v", request)
	}
}

func TestAnUpdateWithNoEntryToChangeSendsNone(t *testing.T) {
	changes := NewEntryChanges()
	// From nothing declared to the record's own entries: each is added, once.
	changes.Diff("labels", "labels", stringSetOf([]string{entryA, strings.ToUpper(entryA)}), types.SetNull(types.StringType))
	request := map[string]interface{}{}
	changes.AddTo(request)
	if got := request["addToList"].(map[string]interface{})["labels"].([]interface{}); len(got) != 1 {
		t.Fatalf("an entry in two cases is added twice: %v", got)
	}

	none := NewEntryChanges()
	none.Diff("labels", "labels", stringSetOf([]string{entryA}), stringSetOf([]string{entryA}))
	empty := map[string]interface{}{}
	none.AddTo(empty)
	if none.Any() || len(empty) != 0 {
		t.Fatalf("nothing changed, but %v", empty)
	}
}

func TestAnUpdateAnOlderOneUptimeDidNotApplyIsAnError(t *testing.T) {
	changes := NewEntryChanges()
	changes.Diff("labels", "labels", stringSetOf([]string{entryA, entryC}), stringSetOf([]string{entryA, entryB}))

	if diags := changes.Check("labels", stringSetOf([]string{entryA, entryC})); diags.HasError() {
		t.Fatalf("the record holds what the update made: %v", diags)
	}
	// A label someone else added meanwhile changes nothing of it.
	if diags := changes.Check("labels", stringSetOf([]string{entryA, entryC, entryA + "x"})); diags.HasError() {
		t.Fatalf("another entry beside them is no error: %v", diags)
	}

	diags := changes.Check("labels", stringSetOf([]string{entryA, entryB}))
	if !diags.HasError() {
		t.Fatalf("an update OneUptime did not apply is no error")
	}
	detail := diags[0].Detail()
	for _, words := range []string{"did not add " + entryC, "did not take off " + entryB, "upgrade OneUptime", "exclusive_lists = true"} {
		if !strings.Contains(detail, words) {
			t.Errorf("the error does not say %q: %s", words, detail)
		}
	}
	if diags[0].Summary() != "OneUptime did not change labels" {
		t.Errorf("the summary is %q", diags[0].Summary())
	}
}

func TestACreateThatLeftOutAFieldWarns(t *testing.T) {
	resp := &http.Response{Header: http.Header{}}
	if diags := FieldsLeftOutWarning(resp, "monitor"); len(diags) != 0 {
		t.Fatalf("a create that left nothing out warns: %v", diags)
	}

	resp.Header.Set(fieldsLeftOutHeader, "createdByUserId, lastRollupAt")
	diags := FieldsLeftOutWarning(resp, "network site")
	if len(diags) != 1 || diags.HasError() {
		t.Fatalf("want one warning, got %v", diags)
	}
	if got := diags[0].Summary(); got != "OneUptime created the network site without createdByUserId, lastRollupAt" {
		t.Errorf("the warning says %q", got)
	}
	if !strings.Contains(diags[0].Detail(), "upgrade the provider") {
		t.Errorf("the warning does not say what to do: %s", diags[0].Detail())
	}
	if diags := FieldsLeftOutWarning(nil, "monitor"); len(diags) != 0 {
		t.Fatalf("no answer warns: %v", diags)
	}
}

func TestAWriteThatTakesWhatOthersReadWarns(t *testing.T) {
	resp := &http.Response{Header: http.Header{}}
	if diags := WriteWarnings(resp, "log drop filter"); len(diags) != 0 {
		t.Fatalf("a write with nothing to say warns: %v", diags)
	}

	resp.Header.Add(writeWarningHeader, "Security Events read 12 of the 40 logs this filter matched in the last day, and 2 monitors read logs this filter drops.")
	resp.Header.Add(writeWarningHeader, "  ")
	diags := WriteWarnings(resp, "log drop filter")
	if len(diags) != 1 || diags.HasError() {
		t.Fatalf("want one warning, got %v", diags)
	}
	if got := diags[0].Summary(); got != "OneUptime saved the log drop filter: read what it takes" {
		t.Errorf("the warning says %q", got)
	}
	if !strings.Contains(diags[0].Detail(), "2 monitors read logs this filter drops") {
		t.Errorf("the warning does not say what the filter takes: %s", diags[0].Detail())
	}
	if diags := WriteWarnings(nil, "log drop filter"); len(diags) != 0 {
		t.Fatalf("no answer warns: %v", diags)
	}
}

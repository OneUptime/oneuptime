package provider

/*
 * oneuptime_on_call_schedule_layers through the provider's real protocol
 * server, the way terraform plan, apply, refresh, import and destroy drive
 * it, against a fake OneUptime that keeps a schedule's layers the way the
 * server does (Common/Server/Utils/OnCall/ScheduleLayersSave): rows of people
 * in layers, a version of them all, and a save refused with 409 when it is
 * made to a version the layers are no longer at.
 *
 * After every apply the tests check what Terraform checks - the result is
 * what the plan said - and that the next plan changes nothing.
 */

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

const (
	layersType       = "oneuptime_on_call_schedule_layers"
	layersScheduleID = "5a0e0000-0000-4000-8000-0000000000e1"
	layerPrimary     = "5a0e0000-0000-4000-8000-0000000000e2"
	layerSecondary   = "5a0e0000-0000-4000-8000-0000000000e3"
	layerFallback    = "5a0e0000-0000-4000-8000-0000000000e4"
	layerElsewhere   = "5a0e0000-0000-4000-8000-0000000000e5"

	layersAlice = "5a0e0000-0000-4000-8000-0000000000f1"
	layersBob   = "5a0e0000-0000-4000-8000-0000000000f2"
	layersCarol = "5a0e0000-0000-4000-8000-0000000000f3"
	layersDave  = "5a0e0000-0000-4000-8000-0000000000f4"
)

// A person in a layer: the row they are in it by.
type layersFakeRow struct {
	id      string
	layerID string
	userID  string
}

// layersAPI is the fake OneUptime of these tests: one schedule's layers.
type layersAPI struct {
	t      *testing.T
	server *httptest.Server

	mu sync.Mutex
	// The schedule's layers, the highest priority first.
	layers []string
	// People in layers, in turn order within each layer.
	rows     []layersFakeRow
	revision int
	nextID   int
	// The schedule is gone.
	gone bool
	// A OneUptime from before GET .../layers.
	noReadRoute bool
	// How many saves to come someone else's change gets in before.
	changesMeanwhile int
	// The save-layers bodies, and the reads of the layers.
	saves []map[string]interface{}
	reads int
}

func newLayersAPI(t *testing.T, layers ...string) *layersAPI {
	t.Helper()
	api := &layersAPI{t: t, layers: layers}
	api.server = httptest.NewServer(http.HandlerFunc(api.handle))
	t.Cleanup(api.server.Close)
	return api
}

// put adds someone to a layer, after its people.
func (a *layersAPI) put(layerID string, userID string) string {
	a.nextID++
	id := fmt.Sprintf("5a0e3000-0000-4000-8000-%012d", a.nextID)
	a.rows = append(a.rows, layersFakeRow{id: id, layerID: layerID, userID: userID})
	a.revision++
	return id
}

// version is the layers' version: any change moves it.
func (a *layersAPI) version() string {
	return fmt.Sprintf("1-%d-%d-%d", len(a.layers), len(a.rows), a.revision)
}

// people of a layer, in turn order, by user ID.
func (a *layersAPI) people(layerID string) []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	people := []string{}
	for _, row := range a.rows {
		if row.layerID == layerID {
			people = append(people, row.userID)
		}
	}
	return people
}

func (a *layersAPI) rowOf(layerID string, userID string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, row := range a.rows {
		if row.layerID == layerID && row.userID == userID {
			return row.id
		}
	}
	return ""
}

func (a *layersAPI) order() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string{}, a.layers...)
}

func (a *layersAPI) answer() map[string]interface{} {
	layers := []interface{}{}
	for _, layerID := range a.layers {
		users := []interface{}{}
		for _, row := range a.rows {
			if row.layerID == layerID {
				users = append(users, map[string]interface{}{"layerUserId": row.id, "userId": row.userID})
			}
		}
		layers = append(layers, map[string]interface{}{"layerId": layerID, "users": users})
	}
	return map[string]interface{}{
		"basedOnVersion":  a.version(),
		"layers":          layers,
		"deletedLayerIds": []interface{}{},
	}
}

func (a *layersAPI) handle(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	path := strings.TrimPrefix(r.URL.Path, "/api")
	if r.Header.Get("APIKey") != peopleAPIKey {
		a.reply(w, http.StatusUnauthorized, map[string]interface{}{"message": "Invalid API Key"})
		return
	}

	schedule := "/on-call-duty-policy-schedule/" + layersScheduleID
	switch {
	case r.Method == http.MethodGet && path == schedule+"/layers":
		a.reads++
		if a.noReadRoute {
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Cannot GET " + r.URL.Path})
			return
		}
		if a.gone {
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "This on-call schedule was not found."})
			return
		}
		a.reply(w, http.StatusOK, a.answer())
	case r.Method == http.MethodPost && path == schedule+"/get-item":
		if a.gone {
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
			return
		}
		a.reply(w, http.StatusOK, map[string]interface{}{"data": map[string]interface{}{"_id": layersScheduleID}})
	case r.Method == http.MethodPost && path == schedule+"/save-layers":
		var body map[string]interface{}
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &body); err != nil {
			a.t.Errorf("save-layers sent a body that is not JSON: %s", err)
		}
		a.saves = append(a.saves, body)
		a.save(w, body)
	default:
		a.t.Errorf("unexpected request: %s %s", r.Method, path)
		a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
	}
}

// save does what ScheduleLayersSave.save does: refuses a save made to
// another version, or one that is no save of these layers, and writes it all.
func (a *layersAPI) save(w http.ResponseWriter, body map[string]interface{}) {
	if a.gone {
		a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "This on-call schedule was not found."})
		return
	}

	if a.changesMeanwhile > 0 {
		a.changesMeanwhile--
		// Someone else adds a person on the dashboard first.
		a.nextID++
		a.rows = append(a.rows, layersFakeRow{id: fmt.Sprintf("5a0e4000-0000-4000-8000-%012d", a.nextID), layerID: a.layers[len(a.layers)-1], userID: layersDave})
		a.revision++
	}

	if body["basedOnVersion"] != a.version() {
		a.reply(w, http.StatusConflict, map[string]interface{}{"message": "Someone else changed the layers of this schedule after you opened it, so your changes were not saved."})
		return
	}

	deleted, _ := body["deletedLayerIds"].([]interface{})
	if len(deleted) > 0 {
		a.t.Errorf("the save deleted layers: %v", deleted)
	}

	named := map[string]bool{}
	newOrder := []string{}
	newRows := []layersFakeRow{}
	layers, _ := body["layers"].([]interface{})
	for _, raw := range layers {
		layer, _ := raw.(map[string]interface{})
		layerID := fmt.Sprint(layer["layerId"])
		known := false
		for _, id := range a.layers {
			known = known || id == layerID
		}
		if !known {
			a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": layerID + " is not a layer of this schedule. Read its layers again and save your changes to them."})
			return
		}
		if named[layerID] {
			a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": "Name each layer once"})
			return
		}
		named[layerID] = true
		newOrder = append(newOrder, layerID)

		users, _ := layer["users"].([]interface{})
		for _, rawUser := range users {
			user, _ := rawUser.(map[string]interface{})
			userID := fmt.Sprint(user["userId"])
			if rowID, ok := user["layerUserId"].(string); ok {
				found := false
				for _, row := range a.rows {
					if row.id == rowID {
						if row.layerID != layerID || row.userID != userID {
							a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": "That row is someone else's, or another layer's."})
							return
						}
						found = true
					}
				}
				if !found {
					a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": rowID + " is not a row of this layer."})
					return
				}
				newRows = append(newRows, layersFakeRow{id: rowID, layerID: layerID, userID: userID})
				continue
			}
			a.nextID++
			newRows = append(newRows, layersFakeRow{id: fmt.Sprintf("5a0e5000-0000-4000-8000-%012d", a.nextID), layerID: layerID, userID: userID})
		}
	}

	for _, id := range a.layers {
		if !named[id] {
			a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": "Name every layer of the schedule, in layers or in deletedLayerIds: layer " + id + " is not named."})
			return
		}
	}

	before := fmt.Sprint(a.layers, a.rows)
	a.layers = newOrder
	a.rows = newRows
	if fmt.Sprint(a.layers, a.rows) != before {
		a.revision++
	}

	a.reply(w, http.StatusOK, map[string]interface{}{"version": a.version()})
}

func (a *layersAPI) reply(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		a.t.Errorf("writing the response: %s", err)
	}
}

// newLayersTerraform drives the provider against the fake: peopleTerraform's
// driver, pointed at it.
func newLayersTerraform(t *testing.T, api *layersAPI) *peopleTerraform {
	t.Helper()
	tf := &peopleTerraform{t: t, ctx: context.Background(), api: &peopleAPI{t: t, server: api.server}}
	tf.restart()
	return tf
}

// layersOf is a configuration of the resource: each layer its ID, then its people.
func layersOf(tf *peopleTerraform, layers ...[]string) tftypes.Value {
	tf.t.Helper()
	listType := tf.objectType(layersType).AttributeTypes["layers"].(tftypes.List)
	layerType := listType.ElementType.(tftypes.Object)

	values := []tftypes.Value{}
	for _, layer := range layers {
		people := []tftypes.Value{}
		for _, userID := range layer[1:] {
			people = append(people, str(userID))
		}
		values = append(values, tftypes.NewValue(layerType, map[string]tftypes.Value{
			"layer_id": str(layer[0]),
			"user_ids": tftypes.NewValue(tftypes.List{ElementType: tftypes.String}, people),
		}))
	}

	return tf.config(layersType, map[string]tftypes.Value{
		"on_call_duty_policy_schedule_id": str(layersScheduleID),
		"layers":                          tftypes.NewValue(listType, values),
	})
}

// layersInStateOf is what a state holds: each layer its ID, then its people.
func layersInStateOf(t *testing.T, state tftypes.Value) [][]string {
	t.Helper()
	var layers []tftypes.Value
	if err := attributesOf(t, state)["layers"].As(&layers); err != nil {
		t.Fatalf("reading layers: %s", err)
	}
	read := [][]string{}
	for _, layer := range layers {
		attributes := attributesOf(t, layer)
		var layerID string
		if err := attributes["layer_id"].As(&layerID); err != nil {
			t.Fatalf("reading layer_id: %s", err)
		}
		var people []tftypes.Value
		if err := attributes["user_ids"].As(&people); err != nil {
			t.Fatalf("reading user_ids: %s", err)
		}
		entry := []string{layerID}
		for _, person := range people {
			var userID string
			if err := person.As(&userID); err != nil {
				t.Fatalf("reading a user ID: %s", err)
			}
			entry = append(entry, userID)
		}
		read = append(read, entry)
	}
	return read
}

func requireLayers(t *testing.T, got [][]string, want ...[]string) {
	t.Helper()
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("the layers are %v, want %v", got, want)
	}
}

func requireStrings(t *testing.T, what string, got []string, want ...string) {
	t.Helper()
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("%s: %v, want %v", what, got, want)
	}
}

func layersNothing(tf *peopleTerraform) tftypes.Value {
	return tftypes.NewValue(tf.objectType(layersType), nil)
}

// A new turn order, and people moved between layers, in one save that keeps
// the row of everyone who stays - and a plan after it that changes nothing.
func TestOnCallScheduleLayersAppliesANewTurnOrderInOneSave(t *testing.T) {
	api := newLayersAPI(t, layerPrimary, layerSecondary)
	bobsRow := api.put(layerPrimary, layersBob)
	tf := newLayersTerraform(t, api)

	first := layersOf(tf, []string{layerPrimary, layersAlice, layersBob}, []string{layerSecondary, layersCarol})
	state := tf.apply(layersType, layersNothing(tf), first)

	if len(api.saves) != 1 {
		t.Fatalf("the create made %d saves, want 1", len(api.saves))
	}
	requireStrings(t, "primary", api.people(layerPrimary), layersAlice, layersBob)
	requireStrings(t, "secondary", api.people(layerSecondary), layersCarol)
	if api.rowOf(layerPrimary, layersBob) != bobsRow {
		t.Fatalf("Bob was taken out and put back: his row is %s, was %s", api.rowOf(layerPrimary, layersBob), bobsRow)
	}
	if stringOf(t, state, "id") != layersScheduleID {
		t.Fatalf("id is %q, want the schedule's", stringOf(t, state, "id"))
	}
	requireLayers(t, layersInStateOf(t, tf.refresh(layersType, state)), []string{layerPrimary, layersAlice, layersBob}, []string{layerSecondary, layersCarol})
	tf.requireNoChanges(layersType, tf.refresh(layersType, state), first)

	// The secondary layer goes on top, Bob takes the first turn, Carol moves up.
	second := layersOf(tf, []string{layerSecondary, layersCarol, layersAlice}, []string{layerPrimary, layersBob})
	changed, replaced := tf.changes(layersType, state, second)
	requireStrings(t, "changed", changed, "layers")
	requireStrings(t, "replaced for", replaced)

	state = tf.apply(layersType, state, second)
	if len(api.saves) != 2 {
		t.Fatalf("the update made %d saves in all, want 2", len(api.saves))
	}
	requireStrings(t, "order", api.order(), layerSecondary, layerPrimary)
	requireStrings(t, "secondary", api.people(layerSecondary), layersCarol, layersAlice)
	requireStrings(t, "primary", api.people(layerPrimary), layersBob)
	if api.rowOf(layerPrimary, layersBob) != bobsRow {
		t.Fatalf("Bob's row changed: %s, was %s", api.rowOf(layerPrimary, layersBob), bobsRow)
	}
	tf.requireNoChanges(layersType, tf.refresh(layersType, state), second)
}

// A layer the configuration does not list keeps its people and its place:
// the layers listed take the places they had, in the order listed.
func TestOnCallScheduleLayersLeavesALayerItDoesNotListAlone(t *testing.T) {
	api := newLayersAPI(t, layerPrimary, layerFallback, layerSecondary)
	davesRow := api.put(layerFallback, layersDave)
	tf := newLayersTerraform(t, api)

	config := layersOf(tf, []string{layerSecondary, layersAlice}, []string{layerPrimary, layersBob})
	state := tf.apply(layersType, layersNothing(tf), config)

	requireStrings(t, "order", api.order(), layerSecondary, layerFallback, layerPrimary)
	requireStrings(t, "fallback", api.people(layerFallback), layersDave)
	if api.rowOf(layerFallback, layersDave) != davesRow {
		t.Fatalf("Dave's row changed")
	}

	// The state lists the layers it manages only, in the schedule's order.
	refreshed := tf.refresh(layersType, state)
	requireLayers(t, layersInStateOf(t, refreshed), []string{layerSecondary, layersAlice}, []string{layerPrimary, layersBob})
	tf.requireNoChanges(layersType, refreshed, config)

	// Destroyed: the layers it listed are emptied, the other one is not.
	tf.destroy(layersType, refreshed)
	requireStrings(t, "secondary", api.people(layerSecondary))
	requireStrings(t, "primary", api.people(layerPrimary))
	requireStrings(t, "fallback", api.people(layerFallback), layersDave)
}

// Someone else's change between the read and the save: OneUptime refuses
// the save (409), and the provider reads the layers again and saves again.
func TestOnCallScheduleLayersSavesAgainWhenTheLayersChangeMeanwhile(t *testing.T) {
	api := newLayersAPI(t, layerPrimary, layerSecondary)
	api.changesMeanwhile = 1
	tf := newLayersTerraform(t, api)

	config := layersOf(tf, []string{layerPrimary, layersAlice, layersBob}, []string{layerSecondary, layersCarol})
	tf.apply(layersType, layersNothing(tf), config)

	if len(api.saves) != 2 {
		t.Fatalf("made %d saves, want 2: one refused, one made to the layers read again", len(api.saves))
	}
	if api.saves[0]["basedOnVersion"] == api.saves[1]["basedOnVersion"] {
		t.Fatalf("the second save was made to the same version as the refused one")
	}
	// The listed layers are as configured; Dave, added meanwhile to the
	// secondary layer, is taken out by the configuration that lists it.
	requireStrings(t, "primary", api.people(layerPrimary), layersAlice, layersBob)
	requireStrings(t, "secondary", api.people(layerSecondary), layersCarol)
}

// Someone else changing the layers on every attempt fails the apply, saying so.
func TestOnCallScheduleLayersGivesUpWhenTheLayersKeepChanging(t *testing.T) {
	api := newLayersAPI(t, layerPrimary)
	api.changesMeanwhile = scheduleLayersSaveAttempts
	tf := newLayersTerraform(t, api)

	_, applied := tf.applyResponse(layersType, layersNothing(tf), layersOf(tf, []string{layerPrimary, layersAlice}))
	requireDiagnostic(t, applied.Diagnostics, tfprotov6.DiagnosticSeverityError, "were changed by someone else each of the 3 times")
	if len(api.saves) != scheduleLayersSaveAttempts {
		t.Fatalf("made %d saves, want %d", len(api.saves), scheduleLayersSaveAttempts)
	}
}

// A layer of another schedule, or one that is gone, is refused, and nothing
// is saved.
func TestOnCallScheduleLayersRefusesALayerTheScheduleDoesNotHave(t *testing.T) {
	api := newLayersAPI(t, layerPrimary)
	tf := newLayersTerraform(t, api)

	_, applied := tf.applyResponse(layersType, layersNothing(tf), layersOf(tf, []string{layerPrimary, layersAlice}, []string{layerElsewhere, layersBob}))
	requireDiagnostic(t, applied.Diagnostics, tfprotov6.DiagnosticSeverityError, layerElsewhere+" is not a layer of this schedule")
	if len(api.saves) != 0 {
		t.Fatalf("made %d saves, want none", len(api.saves))
	}
}

// A layer listed twice is refused at plan time.
func TestOnCallScheduleLayersRefusesALayerListedTwice(t *testing.T) {
	api := newLayersAPI(t, layerPrimary)
	tf := newLayersTerraform(t, api)

	diagnostics := tf.validate(layersType, layersOf(tf, []string{layerPrimary, layersAlice}, []string{strings.ToUpper(layerPrimary), layersBob}))
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "is listed at layers[0] and layers[1]")

	// Nobody in a layer is a layer with nobody on call, not an error.
	failOnErrors(t, "validating", tf.validate(layersType, layersOf(tf, []string{layerPrimary})))
}

// An import takes every layer of the schedule, in its order, and a
// configuration that says the same changes nothing.
func TestOnCallScheduleLayersImportsEveryLayer(t *testing.T) {
	api := newLayersAPI(t, layerPrimary, layerSecondary)
	api.put(layerPrimary, layersAlice)
	api.put(layerPrimary, layersBob)
	api.put(layerSecondary, layersCarol)
	tf := newLayersTerraform(t, api)

	imported, diagnostics := tf.importState(layersType, layersScheduleID)
	failOnErrors(t, "importing", diagnostics)
	state := tf.refresh(layersType, imported)

	requireLayers(t, layersInStateOf(t, state), []string{layerPrimary, layersAlice, layersBob}, []string{layerSecondary, layersCarol})
	requireStrings(t, "on_call_duty_policy_schedule_id", []string{stringOf(t, state, "on_call_duty_policy_schedule_id")}, layersScheduleID)
	tf.requireNoChanges(layersType, state, layersOf(tf, []string{layerPrimary, layersAlice, layersBob}, []string{layerSecondary, layersCarol}))

	_, diagnostics = tf.importState(layersType, "primary on-call")
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "by its schedule's ID")
}

// A change made on the dashboard shows in the next plan, which puts it back.
func TestOnCallScheduleLayersRefreshSeesAChangeMadeElsewhere(t *testing.T) {
	api := newLayersAPI(t, layerPrimary)
	tf := newLayersTerraform(t, api)

	config := layersOf(tf, []string{layerPrimary, layersAlice, layersBob})
	state := tf.apply(layersType, layersNothing(tf), config)

	api.mu.Lock()
	api.rows = []layersFakeRow{api.rows[1], api.rows[0]}
	api.revision++
	api.mu.Unlock()

	refreshed := tf.refresh(layersType, state)
	requireLayers(t, layersInStateOf(t, refreshed), []string{layerPrimary, layersBob, layersAlice})
	changed, _ := tf.changes(layersType, refreshed, config)
	requireStrings(t, "changed", changed, "layers")

	tf.apply(layersType, refreshed, config)
	requireStrings(t, "primary", api.people(layerPrimary), layersAlice, layersBob)
}

// IDs written in capitals stay as written, though OneUptime writes them in
// lower case: no change in the next plan.
func TestOnCallScheduleLayersKeepsTheSpellingOfIDs(t *testing.T) {
	api := newLayersAPI(t, layerPrimary)
	tf := newLayersTerraform(t, api)

	config := layersOf(tf, []string{strings.ToUpper(layerPrimary), strings.ToUpper(layersAlice)})
	state := tf.apply(layersType, layersNothing(tf), config)

	requireStrings(t, "primary", api.people(layerPrimary), strings.ToUpper(layersAlice))
	tf.requireNoChanges(layersType, tf.refresh(layersType, state), config)
}

// A schedule that is gone leaves the state; a OneUptime without the read
// route says so, rather than taking the schedule for gone.
func TestOnCallScheduleLayersWhenTheScheduleOrTheRouteIsMissing(t *testing.T) {
	api := newLayersAPI(t, layerPrimary)
	tf := newLayersTerraform(t, api)
	state := tf.apply(layersType, layersNothing(tf), layersOf(tf, []string{layerPrimary, layersAlice}))

	api.mu.Lock()
	api.noReadRoute = true
	api.mu.Unlock()
	read, err := tf.server.ReadResource(tf.ctx, &tfprotov6.ReadResourceRequest{
		TypeName:     layersType,
		CurrentState: tf.encode(tf.objectType(layersType), state),
	})
	if err != nil {
		t.Fatalf("ReadResource: %s", err)
	}
	requireDiagnostic(t, read.Diagnostics, tfprotov6.DiagnosticSeverityError, "cannot read a schedule's layers in one call")

	api.mu.Lock()
	api.noReadRoute = false
	api.gone = true
	api.mu.Unlock()
	if refreshed := tf.refresh(layersType, state); !refreshed.IsNull() {
		t.Fatalf("a schedule that is gone stays in state: %s", refreshed)
	}

	// Destroying it then is nothing to do.
	tf.destroy(layersType, state)
}

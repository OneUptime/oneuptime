package config

// A fake OneUptime API and the managed resource reconciler's side of a
// reconcile, for tests that drive a managed resource the way the provider
// does: through Upjet's external client for Terraform Plugin Framework
// resources, the Terraform provider in process, and HTTP to OneUptime.
//
// The fake keeps each record as a JSON object, by its API path ("monitor",
// "incident"): a create stores what the provider sent and what OneUptime
// fills in itself (fakeAPI.onCreate), a read answers the record, an update
// merges what it was sent. A test moves a record the way OneUptime does on
// its own (fakeAPI.set) and reads back every write the provider made
// (fakeAPI.writes).

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/crossplane/crossplane-runtime/v2/pkg/logging"
	"github.com/crossplane/crossplane-runtime/v2/pkg/meta"
	"github.com/crossplane/crossplane-runtime/v2/pkg/reconciler/managed"
	xpresource "github.com/crossplane/crossplane-runtime/v2/pkg/resource"
	tjcontroller "github.com/crossplane/upjet/v2/pkg/controller"
	"github.com/crossplane/upjet/v2/pkg/terraform"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/oneuptime/terraform-provider-oneuptime/xpprovider"
)

const fakeAPIKey = "test-api-key"

// fakeWrite is a create or an update the provider sent.
type fakeWrite struct {
	Method string
	Path   string
	ID     string
	Data   map[string]any
}

type fakeAPI struct {
	t      *testing.T
	server *httptest.Server

	mu      sync.Mutex
	records map[string]map[string]map[string]any
	// What OneUptime fills in itself when it creates a record, by API path.
	onCreate map[string]func(record map[string]any)
	writes   []fakeWrite
	nextID   int
}

func newFakeAPI(t *testing.T) *fakeAPI {
	t.Helper()
	api := &fakeAPI{
		t:        t,
		records:  map[string]map[string]map[string]any{},
		onCreate: map[string]func(map[string]any){},
	}
	api.server = httptest.NewServer(http.HandlerFunc(api.handle))
	t.Cleanup(api.server.Close)
	return api
}

func (a *fakeAPI) handle(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("APIKey") != fakeAPIKey {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"message": "no API key"})
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/"), "/"), "/")
	body := map[string]any{}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	data, _ := body["data"].(map[string]any)

	a.mu.Lock()
	defer a.mu.Unlock()

	switch {
	case r.Method == http.MethodPost && len(parts) == 1:
		a.nextID++
		id := fmt.Sprintf("00000000-0000-4000-8000-%012d", a.nextID)
		record := map[string]any{}
		for k, v := range data {
			record[k] = v
		}
		if fill := a.onCreate[parts[0]]; fill != nil {
			fill(record)
		}
		record["_id"] = id
		if a.records[parts[0]] == nil {
			a.records[parts[0]] = map[string]map[string]any{}
		}
		a.records[parts[0]][id] = record
		a.writes = append(a.writes, fakeWrite{Method: "create", Path: parts[0], ID: id, Data: data})
		writeJSON(w, http.StatusOK, record)
	case r.Method == http.MethodPost && len(parts) == 3 && parts[2] == "get-item":
		record, ok := a.records[parts[0]][parts[1]]
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]any{"message": "not found"})
			return
		}
		writeJSON(w, http.StatusOK, record)
	case r.Method == http.MethodPut && len(parts) == 2:
		record, ok := a.records[parts[0]][parts[1]]
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]any{"message": "not found"})
			return
		}
		for k, v := range data {
			record[k] = v
		}
		a.writes = append(a.writes, fakeWrite{Method: "update", Path: parts[0], ID: parts[1], Data: data})
		writeJSON(w, http.StatusOK, map[string]any{})
	case r.Method == http.MethodDelete && len(parts) == 2:
		delete(a.records[parts[0]], parts[1])
		writeJSON(w, http.StatusOK, map[string]any{})
	default:
		writeJSON(w, http.StatusNotFound, map[string]any{"message": "no such endpoint: " + r.Method + " " + r.URL.Path})
	}
}

// serve has the API keep records of a resource at its path: a create fills
// in what OneUptime does (fill), and every flag the resource has that the
// create left out is false, as OneUptime answers it - never missing.
func (a *fakeAPI) serve(path, terraformName string, fill func(record map[string]any)) {
	a.t.Helper()
	cfg := provider.Resources[terraformName]
	if cfg == nil {
		a.t.Fatalf("no managed resource for %s", terraformName)
	}
	var flags []string
	for name, s := range cfg.TerraformResource.Schema {
		if s.Type == schema.TypeBool {
			flags = append(flags, apiFieldName(name))
		}
	}
	a.onCreate[path] = func(record map[string]any) {
		for _, flag := range flags {
			if _, ok := record[flag]; !ok {
				record[flag] = false
			}
		}
		if fill != nil {
			fill(record)
		}
	}
}

// apiFieldName is the API's name of an attribute: is_archived is isArchived.
func apiFieldName(terraformName string) string {
	words := strings.Split(terraformName, "_")
	for i := 1; i < len(words); i++ {
		if words[i] != "" {
			words[i] = strings.ToUpper(words[i][:1]) + words[i][1:]
		}
	}
	return strings.Join(words, "")
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// set changes a record the way OneUptime does on its own: a check moves a
// monitor's status, an evaluation its timestamps, ingest its counts.
func (a *fakeAPI) set(path, id string, values map[string]any) {
	a.t.Helper()
	a.mu.Lock()
	defer a.mu.Unlock()
	record, ok := a.records[path][id]
	if !ok {
		a.t.Fatalf("no %s %s to change", path, id)
	}
	for k, v := range values {
		record[k] = v
	}
}

func (a *fakeAPI) record(path, id string) map[string]any {
	a.mu.Lock()
	defer a.mu.Unlock()
	copied := map[string]any{}
	for k, v := range a.records[path][id] {
		copied[k] = v
	}
	return copied
}

// updates is every update the provider sent for a record.
func (a *fakeAPI) updates(path, id string) []fakeWrite {
	a.mu.Lock()
	defer a.mu.Unlock()
	var updates []fakeWrite
	for _, w := range a.writes {
		if w.Method == "update" && w.Path == path && w.ID == id {
			updates = append(updates, w)
		}
	}
	return updates
}

// creates is every create the provider sent to a path.
func (a *fakeAPI) creates(path string) []fakeWrite {
	a.mu.Lock()
	defer a.mu.Unlock()
	var creates []fakeWrite
	for _, w := range a.writes {
		if w.Method == "create" && w.Path == path {
			creates = append(creates, w)
		}
	}
	return creates
}

// reconciler is the managed reconciler's side of a reconcile: it connects to
// OneUptime through Upjet's external client for the resource, the one every
// generated controller is built on, observes the record, and creates or
// updates it.
type reconciler struct {
	t     *testing.T
	api   *fakeAPI
	store *tjcontroller.OperationTrackerStore
}

func newReconciler(t *testing.T, api *fakeAPI) *reconciler {
	t.Helper()
	return &reconciler{t: t, api: api, store: tjcontroller.NewOperationStore(logging.NewNopLogger())}
}

func (r *reconciler) setup(_ context.Context, _ client.Client, _ xpresource.Managed) (terraform.Setup, error) {
	return terraform.Setup{
		FrameworkProvider: xpprovider.FrameworkProvider("test"),
		Configuration: map[string]any{
			"oneuptime_url": r.api.server.URL,
			"api_key":       fakeAPIKey,
		},
	}, nil
}

// connect is the start of a reconcile: the external client for one managed
// resource, built from its spec as it is now.
func (r *reconciler) connect(terraformName string, mg xpresource.Managed) managed.ExternalClient {
	r.t.Helper()
	cfg := provider.Resources[terraformName]
	if cfg == nil {
		r.t.Fatalf("no managed resource for %s", terraformName)
	}
	connector := tjcontroller.NewTerraformPluginFrameworkConnector(nil, r.setup, cfg, r.store,
		tjcontroller.WithTerraformPluginFrameworkLogger(logging.NewNopLogger()),
		tjcontroller.WithTerraformPluginFrameworkManagementPolicies(true))
	ext, err := connector.Connect(context.Background(), mg)
	if err != nil {
		r.t.Fatalf("connect: %v", err)
	}
	return ext
}

// observe is a reconcile's observation of the record.
func (r *reconciler) observe(terraformName string, mg xpresource.Managed) (managed.ExternalObservation, error) {
	r.t.Helper()
	return r.connect(terraformName, mg).Observe(context.Background(), mg)
}

// create observes a resource that has no record yet and creates it, as the
// first reconcile does: the record's ID becomes the external name.
func (r *reconciler) create(terraformName string, mg xpresource.Managed) {
	r.t.Helper()
	ext := r.connect(terraformName, mg)
	obs, err := ext.Observe(context.Background(), mg)
	if err != nil {
		r.t.Fatalf("observe before create: %v", err)
	}
	if obs.ResourceExists {
		r.t.Fatalf("the record exists before it was created")
	}
	if _, err := ext.Create(context.Background(), mg); err != nil {
		r.t.Fatalf("create: %v", err)
	}
	if meta.GetExternalName(mg) == "" {
		r.t.Fatalf("create gave the resource no external name")
	}
}

// reconcile observes the record, and updates it when the observation says it
// is not up to date, as the managed reconciler does under the default
// management policy. It returns the observation and the update's error.
func (r *reconciler) reconcile(terraformName string, mg xpresource.Managed) (managed.ExternalObservation, error) {
	r.t.Helper()
	ext := r.connect(terraformName, mg)
	obs, err := ext.Observe(context.Background(), mg)
	if err != nil {
		return obs, err
	}
	if !obs.ResourceExists {
		r.t.Fatalf("the record is gone")
	}
	if obs.ResourceUpToDate {
		return obs, nil
	}
	_, err = ext.Update(context.Background(), mg)
	return obs, err
}

// jsonFields is an object as its JSON names it: the fields of a managed
// resource's spec.forProvider that are set.
func jsonFields(t *testing.T, value any) map[string]any {
	t.Helper()
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	fields := map[string]any{}
	if err := json.Unmarshal(b, &fields); err != nil {
		t.Fatal(err)
	}
	return fields
}

func sortedFieldNames(fields map[string]any) []string {
	names := make([]string, 0, len(fields))
	for k := range fields {
		names = append(names, k)
	}
	sort.Strings(names)
	return names
}

package provider

/*
 * client.go asks a create or an update again while the server refuses it
 * because a record in service has the name it asks for
 * (OneUptime/oneuptime#9855, #10065), exercised against a real HTTP server.
 *
 * WHAT THIS FILE PINS
 *
 * Every kind with a name of its own in a project - teams, labels, on-call
 * policies and schedules, and since #10065 severities, states, monitor
 * statuses, status pages, workflows and the rest - refuses a write onto a
 * name another record of its kind has. Terraform makes the independent
 * changes of one apply side by side, so in a chain of renames - A becomes B
 * while B becomes C - A's rename is refused whenever it runs before B's has
 * given the name up, and a create onto the name of a resource the apply
 * deletes is refused whenever it runs before the delete. Nothing is written
 * by a refused write, so the client asks again, with backoff, for a bounded
 * time:
 *
 *   - a chain converges in one apply, whichever rename runs first, and so
 *     does a create of a name another resource is giving up, by a rename or
 *     by a delete, whatever the kind's own words for the refusal;
 *   - a swap, or any cycle, can never go first, and neither can a name a
 *     record outside the configuration has: either gives up once the window
 *     has passed, and the error says what to do in both cases;
 *   - only the server's code marks the refusal (refusalCode "name_taken",
 *     Common/Types/Exception/NameTakenException.ts): no other 400 is asked
 *     again - not the refusal's own English without its code, as a server
 *     from before the code answers, nor any other code - and neither is a
 *     read or a delete;
 *   - a name only an archived record has ("name_taken_by_archived") is
 *     handed back at once, with the server's own sentence and nothing
 *     added: nothing an apply does to the records in service gives it up;
 *   - the response handed back can still be read, and Terraform's
 *     cancellation ends the waiting.
 *
 * The fake API below holds named records and refuses a name the way the
 * server does (Common/Server/Utils/Database/UniqueNameInProject.ts,
 * DatabaseService.checkUniqueColumnBy, ArchivableValueGuard): another
 * record's name, whatever its case, on a create or on a rename, with the
 * archived code when only an archived record has it. What the server really
 * answers - the status, the sentence and the code beside it, through the
 * express error handler a route's next(err) reaches - is pinned on the
 * server's side by Common/Tests/Server/Utils/NameTakenRefusalAnswer.test.ts.
 */

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// Quick enough for a test, and the same shape as the provider's own.
var quickNameTakenRetry = nameTakenRetry{
	window:    2 * time.Second,
	firstWait: 10 * time.Millisecond,
	maxWait:   40 * time.Millisecond,
}

// The refusal's sentence, as the server words it for a team.
func teamNameTakenSentence(name string) string {
	return fmt.Sprintf("There is already a team called %s in this project. Pick another name.", name)
}

/*
 * The server's generic words for a kind whose model holds its name unique
 * (DatabaseService.checkUniqueColumnBy): no name in them, and since #10065
 * the code beside them.
 */
const severityNameTakenSentence = "Incident Severity with the same name already exists."

// A new value named as an archived one, as ArchivableValueGuard words it.
func archivedSeverityNameTakenSentence(name string) string {
	return fmt.Sprintf("An archived incident severity is already called %q. Unarchive it in Incidents > Settings > Incident Severity, or choose another name.", name)
}

// The same, for an archived on-call policy (UniqueNameInProject).
func archivedPolicyNameTakenSentence(name string) string {
	return fmt.Sprintf("There is already an archived on-call policy called %s in this project. Unarchive it from On-Call > Advanced > Archived Policies, or pick another name.", name)
}

// A refusal body as the server answers it: the sentence, and the code beside it.
func refusalBody(t *testing.T, envelope string, sentence string, code string) string {
	t.Helper()
	encoded, err := json.Marshal(map[string]string{
		envelope:         sentence,
		refusalCodeField: code,
	})
	if err != nil {
		t.Fatalf("marshalling the refusal: %s", err)
	}
	return string(encoded)
}

// A refusal of a name a record in service has.
func nameTakenBody(t *testing.T, envelope string, sentence string) string {
	t.Helper()
	return refusalBody(t, envelope, sentence, nameTakenRefusalCode)
}

// A refusal of a name only an archived record has.
func nameTakenByArchivedBody(t *testing.T, envelope string, sentence string) string {
	t.Helper()
	return refusalBody(t, envelope, sentence, nameTakenByArchivedRefusalCode)
}

// The words the client adds once nothing gave the name up, without the wait.
const nothingGaveTheNameUpAdvice = "If a record outside this configuration has it, such as one OneUptime made with the project, give this resource another name, or import that record. If resources in this configuration swap names, or rename each other in a cycle, none of them can go first: give one of them a temporary name, apply, then apply the names you want."

// Words that only a refusal asked again for the whole window may carry.
var adviceWords = []string{
	"asking again",
	"outside this configuration",
	"temporary name",
}

// namedRecordsAPI holds records by id with a name each, as a project's teams
// or its incident severities.
type namedRecordsAPI struct {
	t *testing.T
	// The records' collection under /api: "team", "incident-severity".
	collection string
	// How the server words a refusal of a name the given record has.
	sentence func(name string, archived bool) string
	mu       sync.Mutex
	names    map[string]string
	// The records that are archived: each keeps its name, and a write onto
	// it is refused with the archived code.
	archived map[string]bool
	nextID   int
	// Every request, in the order it arrived: "PUT /team/a Beta".
	requests []string
	server   *httptest.Server
}

// A project's teams, each with a name of its own (UniqueNameInProject).
func newNamedRecordsAPI(t *testing.T, names map[string]string) (*namedRecordsAPI, *Client) {
	t.Helper()

	return newNamedRecordsAPIOf(t, "team", func(name string, _ bool) string {
		return teamNameTakenSentence(name)
	}, names)
}

/*
 * A project's incident severities: a kind whose model holds its name unique
 * (@UniqueColumnBy), refused in the server's generic words, and an archived
 * value's name in ArchivableValueGuard's (#10065).
 */
func newIncidentSeveritiesAPI(t *testing.T, names map[string]string) (*namedRecordsAPI, *Client) {
	t.Helper()

	return newNamedRecordsAPIOf(t, "incident-severity", func(name string, archived bool) string {
		if archived {
			return archivedSeverityNameTakenSentence(name)
		}
		return severityNameTakenSentence
	}, names)
}

func newNamedRecordsAPIOf(t *testing.T, collection string, sentence func(name string, archived bool) string, names map[string]string) (*namedRecordsAPI, *Client) {
	t.Helper()

	api := &namedRecordsAPI{
		t:          t,
		collection: collection,
		sentence:   sentence,
		names:      names,
		archived:   map[string]bool{},
	}
	api.server = httptest.NewServer(http.HandlerFunc(api.handle))
	t.Cleanup(api.server.Close)

	client, err := NewClient(api.server.URL, "api-key", "test")
	if err != nil {
		t.Fatalf("NewClient: %s", err)
	}
	client.nameTakenRetry = quickNameTakenRetry

	return api, client
}

// archive marks a record archived: it keeps its name, as the server's do.
func (api *namedRecordsAPI) archive(id string) {
	api.mu.Lock()
	defer api.mu.Unlock()
	api.archived[id] = true
}

func (api *namedRecordsAPI) handle(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		api.t.Errorf("reading request body: %s", err)
		return
	}

	// A delete sends no body; a create and a rename send the record.
	name := ""
	if r.Method != http.MethodDelete {
		var request struct {
			Data struct {
				Name string `json:"name"`
			} `json:"data"`
		}
		if err := json.Unmarshal(raw, &request); err != nil {
			api.t.Errorf("request body was not JSON (%s): %s", err, raw)
			return
		}
		name = request.Data.Name
	}

	api.mu.Lock()
	defer api.mu.Unlock()

	api.requests = append(api.requests, fmt.Sprintf("%s %s %s", r.Method, strings.TrimPrefix(r.URL.Path, "/api"), name))

	collection := "/api/" + api.collection
	id := ""
	switch {
	case r.Method == http.MethodPost && r.URL.Path == collection:
	case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, collection+"/"):
		id = strings.TrimPrefix(r.URL.Path, collection+"/")
	case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, collection+"/"):
		// A deleted record gives its name up.
		id = strings.TrimPrefix(r.URL.Path, collection+"/")
		delete(api.names, id)
		delete(api.archived, id)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{}`)
		return
	default:
		w.WriteHeader(http.StatusNotFound)
		return
	}

	/*
	 * Another record's name, whatever its case: refused, and nothing
	 * written. A record in service is named before an archived one, as the
	 * server names it, and only a name no record in service has carries the
	 * archived code.
	 */
	taken, takenByArchived := false, false
	for otherID, otherName := range api.names {
		if otherID == id || !strings.EqualFold(otherName, name) {
			continue
		}
		if api.archived[otherID] {
			takenByArchived = true
		} else {
			taken = true
		}
	}
	if taken || takenByArchived {
		code := nameTakenRefusalCode
		if !taken {
			code = nameTakenByArchivedRefusalCode
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, refusalBody(api.t, "error", api.sentence(name, !taken), code))
		return
	}

	if id == "" {
		api.nextID++
		id = fmt.Sprintf("new-%d", api.nextID)
	}
	api.names[id] = name

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprintf(w, `{"data":{"_id":%q,"name":%q}}`, id, name)
}

func (api *namedRecordsAPI) nameOf(id string) string {
	api.mu.Lock()
	defer api.mu.Unlock()
	return api.names[id]
}

func (api *namedRecordsAPI) requestsFor(prefix string) int {
	api.mu.Lock()
	defer api.mu.Unlock()

	count := 0
	for _, request := range api.requests {
		if strings.HasPrefix(request, prefix) {
			count++
		}
	}
	return count
}

func renameBody(name string) map[string]interface{} {
	return map[string]interface{}{"data": map[string]interface{}{"name": name}}
}

// rename sends a rename as a resource's Update does, and reads the answer as it does.
func rename(ctx context.Context, client *Client, id string, name string) error {
	resp, err := client.Put(ctx, "/team/"+id, renameBody(name))
	if err != nil {
		return err
	}
	return client.ParseResponse(resp, nil)
}

// remove deletes a record as a resource's Delete does, and reads the answer as it does.
func remove(ctx context.Context, client *Client, collection string, id string) error {
	resp, err := client.Delete(ctx, "/"+collection+"/"+id)
	if err != nil {
		return err
	}
	return client.ParseResponse(resp, nil)
}

// saysNoAdvice fails the test for any word of the client's own advice in err.
func saysNoAdvice(t *testing.T, what string, err error) {
	t.Helper()
	for _, words := range adviceWords {
		if strings.Contains(err.Error(), words) {
			t.Errorf("%s: only a name a record in service has gets the client's advice (%q): %s", what, words, err)
		}
	}
}

// The issue's own case: refused twice while another resource still has the name, then saved.
func TestDoRequest_AsksAgainUntilTheNameIsGivenUp(t *testing.T) {
	var bodies []string
	answers := []int{http.StatusBadRequest, http.StatusBadRequest, http.StatusOK}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(raw))

		w.Header().Set("Content-Type", "application/json")
		status := answers[len(bodies)-1]
		w.WriteHeader(status)
		if status == http.StatusBadRequest {
			_, _ = io.WriteString(w, nameTakenBody(t, "error", teamNameTakenSentence("Beta")))
			return
		}
		_, _ = io.WriteString(w, `{"data":{"_id":"a","name":"Beta"}}`)
	}))
	t.Cleanup(server.Close)

	client, err := NewClient(server.URL, "api-key", "test")
	if err != nil {
		t.Fatalf("NewClient: %s", err)
	}
	client.nameTakenRetry = quickNameTakenRetry

	resp, err := client.Put(context.Background(), "/team/a", renameBody("Beta"))
	if err != nil {
		t.Fatalf("Put: %s", err)
	}

	if len(bodies) != 3 {
		t.Fatalf("expected the rename to be asked three times, got %d", len(bodies))
	}
	for index, body := range bodies {
		if body != bodies[0] {
			t.Errorf("request %d sent %s, the first sent %s: the same write must be asked again", index, body, bodies[0])
		}
	}

	var parsed map[string]interface{}
	if err := client.ParseResponse(resp, &parsed); err != nil {
		t.Fatalf("the saved rename should parse, got %s", err)
	}
	if data, _ := parsed["data"].(map[string]interface{}); data["name"] != "Beta" {
		t.Errorf("the saved answer did not reach the caller: %v", parsed)
	}
}

/*
 * A becomes B while B becomes C, in one apply. A's rename runs first and is
 * refused while B still has the name; it goes through once B's rename,
 * which Terraform starts a little later, has given the name up.
 */
func TestDoRequest_AChainOfRenamesConvergesInOneApply(t *testing.T) {
	api, client := newNamedRecordsAPI(t, map[string]string{"a": "Alpha", "b": "Beta"})

	var wait sync.WaitGroup
	errs := make([]error, 2)

	wait.Add(2)
	go func() {
		defer wait.Done()
		errs[0] = rename(context.Background(), client, "a", "Beta")
	}()
	go func() {
		defer wait.Done()
		time.Sleep(150 * time.Millisecond)
		errs[1] = rename(context.Background(), client, "b", "Gamma")
	}()
	wait.Wait()

	for index, err := range errs {
		if err != nil {
			t.Fatalf("rename %d failed: %s", index, err)
		}
	}
	if api.nameOf("a") != "Beta" || api.nameOf("b") != "Gamma" {
		t.Fatalf("expected a=Beta and b=Gamma, got a=%s and b=%s", api.nameOf("a"), api.nameOf("b"))
	}
	if asked := api.requestsFor("PUT /team/a"); asked < 2 {
		t.Errorf("a's rename should have been refused first and asked again, it was sent %d time(s)", asked)
	}
	if asked := api.requestsFor("PUT /team/b"); asked != 1 {
		t.Errorf("b's rename was never refused, so it is sent once; it was sent %d times", asked)
	}
}

/*
 * A longer chain, started in the worst order: each rename waits on the one
 * after it, and the last one, which takes a name nobody has, starts last.
 */
func TestDoRequest_ALongChainConvergesWhicheverRenameRunsFirst(t *testing.T) {
	api, client := newNamedRecordsAPI(t, map[string]string{
		"a": "One",
		"b": "Two",
		"c": "Three",
		"d": "Four",
	})

	renames := []struct{ id, name string }{
		{"a", "Two"},
		{"b", "Three"},
		{"c", "Four"},
		{"d", "Five"},
	}

	var wait sync.WaitGroup
	errs := make([]error, len(renames))

	for index, change := range renames {
		wait.Add(1)
		go func(index int, id string, name string) {
			defer wait.Done()
			time.Sleep(time.Duration(index) * 60 * time.Millisecond)
			errs[index] = rename(context.Background(), client, id, name)
		}(index, change.id, change.name)
	}
	wait.Wait()

	for index, err := range errs {
		if err != nil {
			t.Fatalf("rename %d failed: %s", index, err)
		}
	}
	for _, change := range renames {
		if got := api.nameOf(change.id); got != change.name {
			t.Errorf("%s should be called %s, it is called %s", change.id, change.name, got)
		}
	}
}

// A new record whose name another resource of the apply gives up is created once it has.
func TestDoRequest_ACreateWaitsForTheNameToBeGivenUp(t *testing.T) {
	api, client := newNamedRecordsAPI(t, map[string]string{"a": "Alpha"})

	go func() {
		time.Sleep(100 * time.Millisecond)
		_ = rename(context.Background(), client, "a", "Alpha (old)")
	}()

	resp, err := client.Post(context.Background(), "/team", renameBody("alpha"))
	if err != nil {
		t.Fatalf("Post: %s", err)
	}

	var parsed map[string]interface{}
	if err := client.ParseResponse(resp, &parsed); err != nil {
		t.Fatalf("the create should go through once the name is free, got %s", err)
	}
	if asked := api.requestsFor("POST /team alpha"); asked < 2 {
		t.Errorf("the create should have been refused first and asked again, it was sent %d time(s)", asked)
	}
	if api.nameOf("new-1") != "alpha" {
		t.Errorf("the new team should be called alpha, got %q", api.nameOf("new-1"))
	}
}

/*
 * #10065's own case: one apply deletes a severity and creates another with
 * its name, side by side. The create runs first and is refused, in the
 * server's generic words for a kind whose model holds its name unique; it
 * goes through once the delete, which Terraform starts a little later, has
 * given the name up - a few requests, well inside the window.
 */
func TestDoRequest_ACreateWaitsForADeleteToGiveTheNameUp(t *testing.T) {
	api, client := newIncidentSeveritiesAPI(t, map[string]string{"old": "Sev1"})

	deleted := make(chan error, 1)
	go func() {
		time.Sleep(150 * time.Millisecond)
		deleted <- remove(context.Background(), client, "incident-severity", "old")
	}()

	started := time.Now()
	resp, err := client.Post(context.Background(), "/incident-severity", renameBody("sev1"))
	if err != nil {
		t.Fatalf("Post: %s", err)
	}

	var parsed map[string]interface{}
	if err := client.ParseResponse(resp, &parsed); err != nil {
		t.Fatalf("the create should go through once the delete gave the name up, got %s", err)
	}
	elapsed := time.Since(started)

	if err := <-deleted; err != nil {
		t.Fatalf("the delete failed: %s", err)
	}
	if api.nameOf("new-1") != "sev1" {
		t.Errorf("the new severity should be called sev1, got %q", api.nameOf("new-1"))
	}
	if asked := api.requestsFor("DELETE /incident-severity/old"); asked != 1 {
		t.Errorf("the delete is sent once, it was sent %d times", asked)
	}

	// Bounded: refused while the old one had the name, then saved, inside the window.
	if asked := api.requestsFor("POST /incident-severity sev1"); asked < 2 || asked > 12 {
		t.Errorf("the create was sent %d times; it should be refused first, asked again a few times, then saved", asked)
	}
	if elapsed >= quickNameTakenRetry.window {
		t.Errorf("the create took %s, the whole %s window, though the name was given up after 150ms", elapsed, quickNameTakenRetry.window)
	}
}

/*
 * A swap can never go first: each rename waits on the other. Both give up
 * once the window has passed, with the server's own refusal and what to do:
 * go by way of a temporary name. Nothing was renamed.
 */
func TestDoRequest_ASwapGivesUpWithAClearMessage(t *testing.T) {
	api, client := newNamedRecordsAPI(t, map[string]string{"a": "Alpha", "b": "Beta"})
	client.nameTakenRetry = nameTakenRetry{
		window:    300 * time.Millisecond,
		firstWait: 10 * time.Millisecond,
		maxWait:   40 * time.Millisecond,
	}

	var wait sync.WaitGroup
	errs := make([]error, 2)
	started := time.Now()

	wait.Add(2)
	go func() {
		defer wait.Done()
		errs[0] = rename(context.Background(), client, "a", "Beta")
	}()
	go func() {
		defer wait.Done()
		errs[1] = rename(context.Background(), client, "b", "Alpha")
	}()
	wait.Wait()

	elapsed := time.Since(started)

	for index, name := range []string{"Beta", "Alpha"} {
		err := errs[index]
		if err == nil {
			t.Fatalf("rename %d of a swap went through", index)
		}
		for _, words := range []string{
			"returned status 400",
			teamNameTakenSentence(name),
			"The name was still taken after asking again for 300ms.",
			"If a record outside this configuration has it, such as one OneUptime made with the project, give this resource another name, or import that record.",
			"swap names, or rename each other in a cycle",
			"give one of them a temporary name, apply, then apply the names you want.",
		} {
			if !strings.Contains(err.Error(), words) {
				t.Errorf("rename %d's error should say %q; it said: %s", index, words, err)
			}
		}
	}

	if api.nameOf("a") != "Alpha" || api.nameOf("b") != "Beta" {
		t.Errorf("a refused swap renames nothing, got a=%s and b=%s", api.nameOf("a"), api.nameOf("b"))
	}

	// Bounded: it waited out the window, and asked a handful of times, not in a loop.
	if elapsed < 300*time.Millisecond {
		t.Errorf("gave up after %s, before the 300ms window had passed", elapsed)
	}
	if elapsed > 3*time.Second {
		t.Errorf("took %s to give up on a 300ms window", elapsed)
	}
	for _, id := range []string{"a", "b"} {
		asked := api.requestsFor("PUT /team/" + id)
		if asked < 3 || asked > 20 {
			t.Errorf("%s's rename was sent %d times in a 300ms window that waits 10ms, then 20ms, then 40ms", id, asked)
		}
	}
}

/*
 * A name a record outside the configuration has - one OneUptime made with
 * the project, such as the severity "Critical Incident" - is given up by no
 * resource of the apply. The create gives up once the window has passed,
 * with the server's own words and what to do: give the resource another
 * name, or import that record. Nothing is created.
 */
func TestDoRequest_ANameNothingGivesUpEndsWithWhatToDo(t *testing.T) {
	api, client := newIncidentSeveritiesAPI(t, map[string]string{"seeded": "Critical Incident"})
	client.nameTakenRetry = nameTakenRetry{
		window:    300 * time.Millisecond,
		firstWait: 10 * time.Millisecond,
		maxWait:   40 * time.Millisecond,
	}

	started := time.Now()
	resp, err := client.Post(context.Background(), "/incident-severity", renameBody("Critical Incident"))
	if err != nil {
		t.Fatalf("Post: %s", err)
	}
	err = client.ParseResponse(resp, nil)
	elapsed := time.Since(started)

	if err == nil {
		t.Fatalf("a create onto a name nothing gives up went through")
	}
	for _, words := range []string{
		"returned status 400",
		severityNameTakenSentence,
		"The name was still taken after asking again for 300ms. " + nothingGaveTheNameUpAdvice,
	} {
		if !strings.Contains(err.Error(), words) {
			t.Errorf("the error should say %q; it said: %s", words, err)
		}
	}

	if api.nameOf("new-1") != "" {
		t.Errorf("a refused create creates nothing, got %q", api.nameOf("new-1"))
	}
	if elapsed < 300*time.Millisecond || elapsed > 3*time.Second {
		t.Errorf("gave up after %s on a 300ms window", elapsed)
	}
	if asked := api.requestsFor("POST /incident-severity Critical Incident"); asked < 3 || asked > 20 {
		t.Errorf("the create was sent %d times in a 300ms window that waits 10ms, then 20ms, then 40ms", asked)
	}
}

// What is asked again: only a 400 that carries the code.
func TestDoRequest_NeverAsksAgainForAnyOtherRefusal(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
	}{
		{
			// A server from before the code, or a reworded sentence: the words are not the mark.
			name:   "the refusal's sentence without its code",
			status: http.StatusBadRequest,
			body:   jsonBody(t, envelopeError, teamNameTakenSentence("Beta")),
		},
		{
			name:   "one update that would give several records one name",
			status: http.StatusBadRequest,
			body:   jsonBody(t, envelopeError, "Several teams cannot be given one name. Rename one team at a time."),
		},
		{
			// Nothing an apply does to the records in service gives it up (#10065).
			name:   "a name only an archived record has",
			status: http.StatusBadRequest,
			body:   nameTakenByArchivedBody(t, "error", archivedSeverityNameTakenSentence("Sev1")),
		},
		{
			name:   "another refusal's code",
			status: http.StatusBadRequest,
			body:   `{"message":"OneUptime AI is switched off for this project.","refusalCode":"ai_off"}`,
		},
		{
			name:   "a code that is not text",
			status: http.StatusBadRequest,
			body:   `{"error":"There is already a team called Beta in this project. Pick another name.","refusalCode":1}`,
		},
		{
			name:   "a body that is not JSON",
			status: http.StatusBadRequest,
			body:   "name_taken",
		},
		{
			name:   "the code on another status",
			status: http.StatusUnprocessableEntity,
			body:   nameTakenBody(t, "error", teamNameTakenSentence("Beta")),
		},
		{
			name:   "the code on a conflict",
			status: http.StatusConflict,
			body:   nameTakenBody(t, "error", teamNameTakenSentence("Beta")),
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(testCase.status)
				_, _ = io.WriteString(w, testCase.body)
			}))
			t.Cleanup(server.Close)

			client, err := NewClient(server.URL, "api-key", "test")
			if err != nil {
				t.Fatalf("NewClient: %s", err)
			}
			client.nameTakenRetry = quickNameTakenRetry

			for _, method := range []string{"POST", "PUT", "PATCH"} {
				requests = 0

				resp, err := client.DoRequest(context.Background(), method, "/team/a", renameBody("Beta"))
				if err != nil {
					t.Fatalf("%s: %s", method, err)
				}
				if requests != 1 {
					t.Errorf("%s was asked %d times; only a name-taken refusal is asked again", method, requests)
				}

				// Handed back as it came: its status, and its body still to read.
				if resp.StatusCode != testCase.status {
					t.Errorf("%s: expected the server's %d back, got %d", method, testCase.status, resp.StatusCode)
				}
				err = client.ParseResponse(resp, nil)
				if err == nil {
					t.Fatalf("%s: expected the refusal to reach the caller as an error", method)
				}
				saysNoAdvice(t, method, err)
			}
		})
	}
}

/*
 * A name only an archived record has (#10065): somebody retired that
 * record, and nothing an apply does to the records in service gives its
 * name up. On a create and an update alike, in either envelope, the refusal
 * is handed back at once - even with a long window to wait in - as it came,
 * with the server's own sentence, which says to unarchive it, and nothing
 * the client would add.
 */
func TestDoRequest_NeverAsksAgainForANameOnlyAnArchivedRecordHas(t *testing.T) {
	sentences := map[string]string{
		envelopeError:   archivedSeverityNameTakenSentence("Sev1"),
		envelopeMessage: archivedPolicyNameTakenSentence("Primary"),
	}

	for envelope, sentence := range sentences {
		t.Run(envelope, func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				_, _ = io.WriteString(w, nameTakenByArchivedBody(t, envelope, sentence))
			}))
			t.Cleanup(server.Close)

			client, err := NewClient(server.URL, "api-key", "test")
			if err != nil {
				t.Fatalf("NewClient: %s", err)
			}
			// Asked again at all, a request would wait two seconds first.
			client.nameTakenRetry = nameTakenRetry{
				window:    time.Minute,
				firstWait: 2 * time.Second,
				maxWait:   2 * time.Second,
			}

			for _, method := range []string{"POST", "PUT", "PATCH"} {
				requests = 0
				started := time.Now()

				resp, err := client.DoRequest(context.Background(), method, "/incident-severity/a", renameBody("Sev1"))
				if err != nil {
					t.Fatalf("%s: %s", method, err)
				}
				if requests != 1 {
					t.Errorf("%s was asked %d times; a name an archived record has is asked once", method, requests)
				}
				if elapsed := time.Since(started); elapsed > time.Second {
					t.Errorf("%s waited %s before handing the refusal back", method, elapsed)
				}

				// Handed back as it came: its status, and its body as the server wrote it.
				if resp.StatusCode != http.StatusBadRequest {
					t.Fatalf("%s: expected the server's 400 back, got %d", method, resp.StatusCode)
				}
				raw, err := io.ReadAll(resp.Body)
				if err != nil {
					t.Fatalf("%s: reading the refusal: %s", method, err)
				}
				var parsed map[string]interface{}
				if err := json.Unmarshal(raw, &parsed); err != nil {
					t.Fatalf("%s: the refusal handed back is not JSON (%s): %s", method, err, raw)
				}
				if parsed[envelope] != sentence || parsed[refusalCodeField] != nameTakenByArchivedRefusalCode {
					t.Errorf("%s: the refusal's body was changed on the way out: %s", method, raw)
				}
				if isNameTakenRefusal(raw) {
					t.Errorf("%s: a name an archived record has is no refusal to ask again", method)
				}

				// Read as a resource reads it: the server's sentence, and nothing added.
				resp.Body = io.NopCloser(bytes.NewReader(raw))
				err = client.ParseResponse(resp, nil)
				if err == nil {
					t.Fatalf("%s: expected the refusal to reach the caller as an error", method)
				}
				want := fmt.Sprintf("the OneUptime API returned status 400: %s", sentence)
				if err.Error() != want {
					t.Errorf("%s: expected exactly %q, got %q", method, want, err)
				}
				saysNoAdvice(t, method, err)
			}
		})
	}
}

/*
 * The same against the fake API: a create named as an archived severity
 * fails the apply at once, with ArchivableValueGuard's words, and creates
 * nothing - even while another severity in service could not be the one in
 * the way.
 */
func TestDoRequest_ANameAnArchivedRecordHasFailsTheApplyAtOnce(t *testing.T) {
	api, client := newIncidentSeveritiesAPI(t, map[string]string{"retired": "Sev1", "live": "Sev2"})
	api.archive("retired")
	client.nameTakenRetry = nameTakenRetry{
		window:    time.Minute,
		firstWait: 2 * time.Second,
		maxWait:   2 * time.Second,
	}

	started := time.Now()
	resp, err := client.Post(context.Background(), "/incident-severity", renameBody("sev1"))
	if err != nil {
		t.Fatalf("Post: %s", err)
	}
	err = client.ParseResponse(resp, nil)
	elapsed := time.Since(started)

	if err == nil {
		t.Fatalf("a create onto an archived severity's name went through")
	}
	if !strings.Contains(err.Error(), archivedSeverityNameTakenSentence("sev1")) {
		t.Errorf("the error should be the server's own sentence; it said: %s", err)
	}
	saysNoAdvice(t, "the create", err)

	if asked := api.requestsFor("POST /incident-severity sev1"); asked != 1 {
		t.Errorf("the create was sent %d times; a name an archived record has is asked once", asked)
	}
	if elapsed > time.Second {
		t.Errorf("waited %s before failing on an archived severity's name", elapsed)
	}
	if api.nameOf("new-1") != "" {
		t.Errorf("a refused create creates nothing, got %q", api.nameOf("new-1"))
	}
}

// A read or a delete is never refused for a name: a 400 that says one is handed back at once.
func TestDoRequest_NeverAsksAgainForAReadOrADelete(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, nameTakenBody(t, "error", teamNameTakenSentence("Beta")))
	}))
	t.Cleanup(server.Close)

	client, err := NewClient(server.URL, "api-key", "test")
	if err != nil {
		t.Fatalf("NewClient: %s", err)
	}
	client.nameTakenRetry = quickNameTakenRetry

	for _, method := range []string{"GET", "DELETE"} {
		requests = 0

		if _, err := client.DoRequest(context.Background(), method, "/team/a", nil); err != nil {
			t.Fatalf("%s: %s", method, err)
		}
		if requests != 1 {
			t.Errorf("%s was asked %d times", method, requests)
		}
	}
}

// The refusal the client gives up on can still be read, in either envelope the server answers with.
func TestDoRequest_TheRefusalHandedBackCanStillBeRead(t *testing.T) {
	for _, envelope := range []string{envelopeError, envelopeMessage} {
		t.Run(envelope, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				_, _ = io.WriteString(w, nameTakenBody(t, envelope, teamNameTakenSentence("Beta")))
			}))
			t.Cleanup(server.Close)

			client, err := NewClient(server.URL, "api-key", "test")
			if err != nil {
				t.Fatalf("NewClient: %s", err)
			}
			client.nameTakenRetry = nameTakenRetry{
				window:    50 * time.Millisecond,
				firstWait: 10 * time.Millisecond,
				maxWait:   10 * time.Millisecond,
			}

			resp, err := client.Put(context.Background(), "/team/a", renameBody("Beta"))
			if err != nil {
				t.Fatalf("Put: %s", err)
			}
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("expected the refusal back, got %d", resp.StatusCode)
			}

			raw, err := io.ReadAll(resp.Body)
			if err != nil {
				t.Fatalf("reading the refusal: %s", err)
			}
			if !isNameTakenRefusal(raw) || !strings.Contains(string(raw), "There is already a team called Beta") {
				t.Errorf("the refusal's body was lost on the way out: %s", raw)
			}
		})
	}
}

// Terraform's cancellation ends the waiting at once, and nothing more is sent.
func TestDoRequest_StopsAskingWhenTerraformCancels(t *testing.T) {
	var mu sync.Mutex
	requests := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requests++
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, nameTakenBody(t, "error", teamNameTakenSentence("Beta")))
	}))
	t.Cleanup(server.Close)

	client, err := NewClient(server.URL, "api-key", "test")
	if err != nil {
		t.Fatalf("NewClient: %s", err)
	}
	client.nameTakenRetry = nameTakenRetry{
		window:    time.Minute,
		firstWait: 2 * time.Second,
		maxWait:   2 * time.Second,
	}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	started := time.Now()
	_, err = client.Put(ctx, "/team/a", renameBody("Beta"))

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected Terraform's cancellation back, got %v", err)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Errorf("kept waiting %s after Terraform cancelled", elapsed)
	}

	mu.Lock()
	defer mu.Unlock()
	if requests != 1 {
		t.Errorf("expected nothing more sent after the cancellation, got %d requests", requests)
	}
}

// Each wait is longer than the one before, up to maxWait.
func TestDoRequest_WaitsLongerEachTime(t *testing.T) {
	var mu sync.Mutex
	var times []time.Time

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		times = append(times, time.Now())
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, nameTakenBody(t, "error", teamNameTakenSentence("Beta")))
	}))
	t.Cleanup(server.Close)

	client, err := NewClient(server.URL, "api-key", "test")
	if err != nil {
		t.Fatalf("NewClient: %s", err)
	}
	client.nameTakenRetry = nameTakenRetry{
		window:    600 * time.Millisecond,
		firstWait: 25 * time.Millisecond,
		maxWait:   100 * time.Millisecond,
	}

	if _, err := client.Put(context.Background(), "/team/a", renameBody("Beta")); err != nil {
		t.Fatalf("Put: %s", err)
	}

	mu.Lock()
	defer mu.Unlock()

	if len(times) < 5 {
		t.Fatalf("expected at least 5 requests in a 600ms window, got %d", len(times))
	}

	// A timer never fires early, so each wait is at least what was asked for.
	least := []time.Duration{25, 50, 100, 100}
	for index, wanted := range least {
		gap := times[index+1].Sub(times[index])
		if gap < wanted*time.Millisecond {
			t.Errorf("wait %d was %s, expected at least %dms", index+1, gap, wanted)
		}
	}
}

// A client made without the provider's settings never asks again, and its advice says nothing of waiting.
func TestDoRequest_AClientWithoutAWindowAsksOnce(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, nameTakenBody(t, "error", teamNameTakenSentence("Beta")))
	}))
	t.Cleanup(server.Close)

	client := &Client{BaseURL: server.URL + "/api", HTTPClient: server.Client()}

	resp, err := client.Put(context.Background(), "/team/a", renameBody("Beta"))
	if err != nil {
		t.Fatalf("Put: %s", err)
	}
	if requests != 1 {
		t.Errorf("expected one request, got %d", requests)
	}

	err = client.ParseResponse(resp, nil)
	if err == nil || strings.Contains(err.Error(), "asking again") || !strings.Contains(err.Error(), "temporary name") {
		t.Errorf("expected the swap advice without a wait in it, got %v", err)
	}
	if advice := client.nameTakenAdvice(takenName{}); advice != nothingGaveTheNameUpAdvice {
		t.Errorf("without a window the advice is its two sentences alone, got %q", advice)
	}
	if want := teamNameTakenSentence("Beta") + " " + nothingGaveTheNameUpAdvice; !strings.HasSuffix(err.Error(), want) {
		t.Errorf("expected the server's sentence, then the advice, got %v", err)
	}
}

// The provider asks again for about 30 seconds, waiting half a second, then longer, up to 5.
func TestNewClient_AsksAgainForThirtySeconds(t *testing.T) {
	client, err := NewClient("https://oneuptime.example", "api-key", "test")
	if err != nil {
		t.Fatalf("NewClient: %s", err)
	}

	want := nameTakenRetry{
		window:    30 * time.Second,
		firstWait: 500 * time.Millisecond,
		maxWait:   5 * time.Second,
	}
	if client.nameTakenRetry != want {
		t.Errorf("expected %+v, got %+v", want, client.nameTakenRetry)
	}
	if advice := client.nameTakenAdvice(takenName{}); !strings.HasPrefix(advice, "The name was still taken after asking again for 30 seconds.") {
		t.Errorf("the advice should say how long it asked: %s", advice)
	}
	wantAdvice := "The name was still taken after asking again for 30 seconds. If a record outside this configuration has it, such as one OneUptime made with the project, give this resource another name, or import that record. If resources in this configuration swap names, or rename each other in a cycle, none of them can go first: give one of them a temporary name, apply, then apply the names you want."
	if advice := client.nameTakenAdvice(takenName{}); advice != wantAdvice {
		t.Errorf("expected the advice\n%s\ngot\n%s", wantAdvice, advice)
	}
}

func TestIsNameTakenRefusal(t *testing.T) {
	cases := []struct {
		name string
		body string
		want bool
	}{
		{"the code beside an error", nameTakenBody(t, "error", teamNameTakenSentence("Beta")), true},
		{"the code beside a message", nameTakenBody(t, "message", teamNameTakenSentence("Beta")), true},
		{"a kind's generic words, with the code", nameTakenBody(t, "message", severityNameTakenSentence), true},
		// Only an archived record has it: nothing an apply does gives it up (#10065).
		{
			"an archived on-call policy's name",
			nameTakenByArchivedBody(t, "error", archivedPolicyNameTakenSentence("Primary")),
			false,
		},
		{
			"an archived severity's name",
			nameTakenByArchivedBody(t, "message", archivedSeverityNameTakenSentence("Sev1")),
			false,
		},
		{"the sentence alone", jsonBody(t, envelopeError, teamNameTakenSentence("Beta")), false},
		{"another code", `{"error":"x","refusalCode":"ai_off"}`, false},
		{"the code in another case", `{"error":"x","refusalCode":"NAME_TAKEN"}`, false},
		{"the code under another field", `{"error":"x","code":"name_taken"}`, false},
		{"an empty body", ``, false},
		{"not JSON", `refusalCode: name_taken`, false},
		{"a JSON array", `["name_taken"]`, false},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := isNameTakenRefusal([]byte(testCase.body)); got != testCase.want {
				t.Errorf("got %v, wanted %v for %s", got, testCase.want, testCase.body)
			}
		})
	}
}

// The code is read from the field the server puts it in, as it was written.
func TestRefusalCodeOf(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"a name a record in service has", nameTakenBody(t, "error", teamNameTakenSentence("Beta")), nameTakenRefusalCode},
		{"a name only an archived record has", nameTakenByArchivedBody(t, "message", archivedSeverityNameTakenSentence("Sev1")), nameTakenByArchivedRefusalCode},
		{"another refusal's code", `{"message":"x","refusalCode":"ai_off"}`, "ai_off"},
		{"no code", jsonBody(t, envelopeError, teamNameTakenSentence("Beta")), ""},
		{"a code that is not text", `{"error":"x","refusalCode":1}`, ""},
		{"not JSON", `name_taken_by_archived`, ""},
		{"an empty body", ``, ""},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := refusalCodeOf([]byte(testCase.body)); got != testCase.want {
				t.Errorf("got %q, wanted %q for %s", got, testCase.want, testCase.body)
			}
		})
	}

	// The two codes are Common's, and never one another.
	if nameTakenRefusalCode != "name_taken" || nameTakenByArchivedRefusalCode != "name_taken_by_archived" {
		t.Errorf("the codes drifted from the server's: %q and %q", nameTakenRefusalCode, nameTakenByArchivedRefusalCode)
	}
}

func TestDescribeWait(t *testing.T) {
	cases := map[time.Duration]string{
		30 * time.Second:        "30 seconds",
		time.Second:             "1 second",
		2 * time.Minute:         "120 seconds",
		300 * time.Millisecond:  "300ms",
		1500 * time.Millisecond: "1.5s",
	}

	for wait, want := range cases {
		if got := describeWait(wait); got != want {
			t.Errorf("describeWait(%s) = %q, wanted %q", wait, got, want)
		}
	}
}

/*
 * WHICH RECORD HAS THE NAME (OneUptime/oneuptime#11019).
 *
 * A project that requires unique names refuses a monitor's, a template's or
 * an API key's taken name with the ID of the record that has it beside the
 * code (takenById), when the caller's key may read that record. Once the
 * client has asked again for the whole window, its advice then names that
 * record and gives the exact line that brings it under the configuration:
 *
 *   - a create imports it into this resource, which may be the record the
 *     resource means: terraform import oneuptime_monitor.<name> <id>, on a
 *     line of its own, with the resource's type its request said
 *     (ForResource);
 *   - a rename imports it into a resource of its own, since this resource
 *     is a record already, and renames it there;
 *   - under Crossplane, the external-name annotation adopts it instead;
 *   - without the field - an older server, a record the key may not read,
 *     a kind that sends none - or with anything in it that is not an ID,
 *     the advice is word for word what it always was, and no ID is named;
 *   - a name only an archived record has, and a value another record holds,
 *     keep their own words: nothing is added for the ID.
 */

// A monitor's refusal while the project requires unique names (RequiredUniqueNames).
const monitorNameTakenSentence = "Another monitor in this project is already called API Health Check, and the project requires unique names. Pick another name."

// The record that has the name, as OneUptime writes an ID.
const holderID = "7f0b1d7e-0000-4000-8000-000000011019"

// A window short enough for a test, and said as describeWait says it.
var shortNameTakenRetry = nameTakenRetry{
	window:    30 * time.Millisecond,
	firstWait: 10 * time.Millisecond,
	maxWait:   10 * time.Millisecond,
}

// A refusal as a server that requires unique names answers it: the sentence,
// the code, and the given value under takenById (left out when nil).
func nameTakenByBody(t *testing.T, envelope string, sentence string, code string, takenByID interface{}) string {
	t.Helper()
	body := map[string]interface{}{
		envelope:         sentence,
		refusalCodeField: code,
	}
	if takenByID != nil {
		body[takenByIDField] = takenByID
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshalling the refusal: %s", err)
	}
	return string(encoded)
}

// refusingServer answers every request with the given 400 body.
func refusingServer(t *testing.T, body string) *Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(server.Close)

	client, err := NewClient(server.URL, "api-key", "test")
	if err != nil {
		t.Fatalf("NewClient: %s", err)
	}
	client.nameTakenRetry = shortNameTakenRetry
	return client
}

// writeAs sends a write as a resource of the given type sends it ("" for a
// request that says no type), and reads the answer as the resource does.
func writeAs(t *testing.T, client *Client, method string, resourceType string) error {
	t.Helper()
	ctx := context.Background()
	if resourceType != "" {
		ctx = ForResource(ctx, resourceType)
	}
	resp, err := client.DoRequest(ctx, method, "/monitor", renameBody("API Health Check"))
	if err != nil {
		t.Fatalf("%s: %s", method, err)
	}
	return client.ParseResponse(resp, nil)
}

// The error a resource sees for a name nothing gave up, without the record's ID.
func adviceWithoutTheRecord(sentence string) string {
	return "the OneUptime API returned status 400: " + sentence + " The name was still taken after asking again for 30ms. " + nothingGaveTheNameUpAdvice
}

// The words the client keeps for a swap, whatever else it says.
const swapAdvice = "If resources in this configuration swap names, or rename each other in a cycle, none of them can go first: give one of them a temporary name, apply, then apply the names you want."

// A create: the record that has the name, and the line that imports it into this resource.
func TestParseResponse_ACreateNamesTheRecordAndTheLineThatImportsItIntoThisResource(t *testing.T) {
	client := refusingServer(t, nameTakenByBody(t, envelopeError, monitorNameTakenSentence, nameTakenRefusalCode, holderID))

	err := writeAs(t, client, http.MethodPost, "oneuptime_monitor")
	if err == nil {
		t.Fatalf("a refused create went through")
	}

	want := "the OneUptime API returned status 400: " + monitorNameTakenSentence +
		" The name was still taken after asking again for 30ms." +
		" The record that has it is " + holderID + "." +
		" If it is outside this configuration, such as one OneUptime made with the project, give this resource another name, or import that record into this resource, at the address Terraform shows with this error:" +
		"\n\n  terraform import oneuptime_monitor.<name> " + holderID +
		"\n\n" + swapAdvice
	if err.Error() != want {
		t.Errorf("expected\n%s\ngot\n%s", want, err)
	}

	// The command is a line of its own, to copy.
	found := false
	for _, line := range strings.Split(err.Error(), "\n") {
		if line == "  terraform import oneuptime_monitor.<name> "+holderID {
			found = true
		}
	}
	if !found {
		t.Errorf("the import command should be a line of its own: %q", err)
	}

	// Named, the record is no longer "that record" of the advice without it.
	if strings.Contains(err.Error(), nameTakenOutsideAdvice) {
		t.Errorf("an error that names the record should not also speak of one it does not know: %s", err)
	}
}

// A rename: this resource is a record already, so the other is imported into a resource of its own.
func TestParseResponse_ARenameNamesTheRecordAndImportsItIntoAResourceOfItsOwn(t *testing.T) {
	client := refusingServer(t, nameTakenByBody(t, envelopeMessage, monitorNameTakenSentence, nameTakenRefusalCode, holderID))

	for _, method := range []string{http.MethodPut, http.MethodPatch} {
		err := writeAs(t, client, method, "oneuptime_monitor")
		if err == nil {
			t.Fatalf("%s: a refused rename went through", method)
		}

		want := "the OneUptime API returned status 400: " + monitorNameTakenSentence +
			" The name was still taken after asking again for 30ms." +
			" The record that has it is " + holderID + "." +
			" If it is outside this configuration, such as one OneUptime made with the project, give this resource another name, or import that record into a resource of its own and rename it there:" +
			"\n\n  terraform import oneuptime_monitor.<name> " + holderID +
			"\n\n" + swapAdvice
		if err.Error() != want {
			t.Errorf("%s: expected\n%s\ngot\n%s", method, want, err)
		}
		if strings.Contains(err.Error(), "into this resource") {
			t.Errorf("%s: a rename must not say to import another record into this resource, which is one already: %s", method, err)
		}
	}
}

// A request that does not say its resource's type leaves the address to fill in.
func TestParseResponse_WithoutTheResourcesTypeTheLineLeavesTheAddressToFillIn(t *testing.T) {
	client := refusingServer(t, nameTakenByBody(t, envelopeError, monitorNameTakenSentence, nameTakenRefusalCode, holderID))

	err := writeAs(t, client, http.MethodPost, "")
	if err == nil {
		t.Fatalf("a refused create went through")
	}
	if !strings.Contains(err.Error(), "\n\n  terraform import <address> "+holderID+"\n\n") {
		t.Errorf("expected the line with the address to fill in: %s", err)
	}
	if !strings.Contains(err.Error(), "The record that has it is "+holderID+".") {
		t.Errorf("the record should still be named: %s", err)
	}
}

/*
 * Without the record's ID - a server from before #11019, a record the key
 * may not read, a kind whose refusal does not carry it - the advice is word
 * for word what it was. So is it with anything in the field that is not an
 * ID: the client names no record the server did not name, and puts nothing
 * else of the field into the error.
 */
func TestParseResponse_WithoutAnIDTheAdviceIsWhatItWas(t *testing.T) {
	cases := []struct {
		name      string
		takenByID interface{}
	}{
		{"no field: an older server, or a record the key may not read", nil},
		{"an empty field", ""},
		{"a number", 11019},
		{"an object", map[string]string{"id": holderID}},
		{"a list", []string{holderID}},
		{"a true", true},
		{"a name, not an ID", "Billing API"},
		{"a path", "../../etc/passwd"},
		{"markup", "<script>alert(1)</script>"},
		{"an ID with a line after it", holderID + "\nterraform destroy"},
		{"an ID with a space before it", " " + holderID},
		{"an ID one character short", holderID[:len(holderID)-1]},
		{"an ID with letters that are not hex", "zf0b1d7e-0000-4000-8000-000000011019"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			client := refusingServer(t, nameTakenByBody(t, envelopeError, monitorNameTakenSentence, nameTakenRefusalCode, testCase.takenByID))

			for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch} {
				err := writeAs(t, client, method, "oneuptime_monitor")
				if err == nil {
					t.Fatalf("%s: a refused write went through", method)
				}
				if err.Error() != adviceWithoutTheRecord(monitorNameTakenSentence) {
					t.Errorf("%s: expected the advice as it was\n%s\ngot\n%s", method, adviceWithoutTheRecord(monitorNameTakenSentence), err)
				}
				for _, words := range []string{"terraform import", "The record that has it", "external-name"} {
					if strings.Contains(err.Error(), words) {
						t.Errorf("%s: without an ID the error says nothing of %q: %s", method, words, err)
					}
				}
				if text, isText := testCase.takenByID.(string); isText && text != "" && strings.Contains(err.Error(), text) {
					t.Errorf("%s: what the field held must not reach the error: %s", method, err)
				}
			}
		})
	}
}

// An ID the server put in its words only, and not in the field, names no record.
func TestParseResponse_AnIDInTheSentenceAloneNamesNoRecord(t *testing.T) {
	sentence := "Another monitor in this project is already called " + holderID + ", and the project requires unique names. Pick another name."
	client := refusingServer(t, nameTakenByBody(t, envelopeError, sentence, nameTakenRefusalCode, nil))

	err := writeAs(t, client, http.MethodPost, "oneuptime_monitor")
	if err == nil {
		t.Fatalf("a refused create went through")
	}
	if err.Error() != adviceWithoutTheRecord(sentence) {
		t.Errorf("expected the server's sentence and the advice as it was, got\n%s", err)
	}
	if strings.Contains(err.Error(), "terraform import") {
		t.Errorf("no record was named by the field: %s", err)
	}
}

// Under Crossplane a record is adopted by its ID in a managed resource's annotation, not imported.
func TestParseResponse_UnderCrossplaneTheRecordIsAdoptedByItsExternalName(t *testing.T) {
	client := refusingServer(t, nameTakenByBody(t, envelopeError, monitorNameTakenSentence, nameTakenRefusalCode, holderID))
	client.lastApplied = &LastApplied{Recorded: true, Fields: map[string]any{}}

	create := writeAs(t, client, http.MethodPost, "oneuptime_monitor")
	if create == nil {
		t.Fatalf("a refused create went through")
	}
	wantCreate := "the OneUptime API returned status 400: " + monitorNameTakenSentence +
		" The name was still taken after asking again for 30ms." +
		" The record that has it is " + holderID + "." +
		" If it is outside this configuration, such as one OneUptime made with the project, give this resource another name, or adopt that record with this managed resource: set its crossplane.io/external-name annotation to \"" + holderID + "\"." +
		"\n\n" + swapAdvice
	if create.Error() != wantCreate {
		t.Errorf("expected\n%s\ngot\n%s", wantCreate, create)
	}

	rename := writeAs(t, client, http.MethodPut, "oneuptime_monitor")
	if rename == nil {
		t.Fatalf("a refused rename went through")
	}
	if !strings.Contains(rename.Error(), "adopt that record with a managed resource of its own, annotated crossplane.io/external-name: \""+holderID+"\", and rename it there.") {
		t.Errorf("a rename under Crossplane adopts the record with a managed resource of its own: %s", rename)
	}

	for _, err := range []error{create, rename} {
		if strings.Contains(err.Error(), "terraform import") {
			t.Errorf("under Crossplane nothing is imported with terraform: %s", err)
		}
	}

	// Without the ID, Crossplane's advice is what it always was too.
	unnamed := refusingServer(t, nameTakenByBody(t, envelopeError, monitorNameTakenSentence, nameTakenRefusalCode, nil))
	unnamed.lastApplied = &LastApplied{}
	if err := writeAs(t, unnamed, http.MethodPost, "oneuptime_monitor"); err == nil || err.Error() != adviceWithoutTheRecord(monitorNameTakenSentence) {
		t.Errorf("expected the advice as it was, got %v", err)
	}
}

/*
 * A name only an archived record has fails at once with the server's own
 * sentence, which says to unarchive it; a value another record holds keeps
 * a value's advice. Neither gains the ID, even should the field come with
 * them.
 */
func TestParseResponse_AnArchivedHolderOrAValueNamesNoRecord(t *testing.T) {
	archived := "An archived monitor in this project is already called API Health Check, and the project requires unique names. Unarchive it, or pick another name."
	archivedClient := refusingServer(t, nameTakenByBody(t, envelopeError, archived, nameTakenByArchivedRefusalCode, holderID))

	err := writeAs(t, archivedClient, http.MethodPost, "oneuptime_monitor")
	if err == nil || err.Error() != "the OneUptime API returned status 400: "+archived {
		t.Errorf("an archived holder's refusal is the server's sentence alone, got %v", err)
	}

	valueClient := refusingServer(t, nameTakenByBody(t, envelopeError, statusPageDomainTakenSentence, valueTakenRefusalCode, holderID))
	err = writeAs(t, valueClient, http.MethodPost, "oneuptime_status_page_domain")
	if err == nil {
		t.Fatalf("a refused value went through")
	}
	if strings.Contains(err.Error(), holderID) || strings.Contains(err.Error(), "terraform import") {
		t.Errorf("a value's refusal keeps a value's advice: %s", err)
	}
	if !strings.Contains(err.Error(), nothingGaveTheValueUpAdvice) {
		t.Errorf("a value's refusal should end with a value's advice: %s", err)
	}
}

/*
 * The client's own advice, from what it knows: the swap's words always end
 * it, after the line to copy, and a client that never asks again says
 * nothing of waiting.
 */
func TestNameTakenAdvice_FromWhatTheRefusalSays(t *testing.T) {
	client := &Client{}

	if advice := client.nameTakenAdvice(takenName{}); advice != nothingGaveTheNameUpAdvice {
		t.Errorf("nothing known: the advice as it was, got %q", advice)
	}

	create := client.nameTakenAdvice(takenName{takenByID: holderID, resourceType: "oneuptime_incident_template"})
	if !strings.HasPrefix(create, "The record that has it is "+holderID+". ") {
		t.Errorf("without a window the advice opens with the record: %q", create)
	}
	if !strings.Contains(create, "\n\n  terraform import oneuptime_incident_template.<name> "+holderID+"\n\n") {
		t.Errorf("the line names the resource's type: %q", create)
	}
	if !strings.HasSuffix(create, swapAdvice) {
		t.Errorf("the swap's words end the advice: %q", create)
	}
	if strings.Contains(create, "asking again") {
		t.Errorf("a client that never asks again says nothing of it: %q", create)
	}

	rename := client.nameTakenAdvice(takenName{takenByID: holderID, resourceType: "oneuptime_incident_template", isRename: true})
	if !strings.Contains(rename, "into a resource of its own and rename it there") || strings.Contains(rename, "into this resource") {
		t.Errorf("a rename imports the other record into a resource of its own: %q", rename)
	}
}

func TestTakenByIDOf(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"the field beside the code", nameTakenByBody(t, envelopeError, monitorNameTakenSentence, nameTakenRefusalCode, holderID), holderID},
		{"beside a message", nameTakenByBody(t, envelopeMessage, monitorNameTakenSentence, nameTakenRefusalCode, holderID), holderID},
		{"an ID in capitals", nameTakenByBody(t, envelopeError, monitorNameTakenSentence, nameTakenRefusalCode, strings.ToUpper(holderID)), strings.ToUpper(holderID)},
		{"no field", nameTakenByBody(t, envelopeError, monitorNameTakenSentence, nameTakenRefusalCode, nil), ""},
		{"not an ID", nameTakenByBody(t, envelopeError, monitorNameTakenSentence, nameTakenRefusalCode, "monitor-1"), ""},
		{"not text", `{"error":"x","refusalCode":"name_taken","takenById":7}`, ""},
		{"under another field", `{"error":"x","refusalCode":"name_taken","takenByID":"` + holderID + `"}`, ""},
		{"not JSON", holderID, ""},
		{"an empty body", ``, ""},
		{"a JSON array", `["` + holderID + `"]`, ""},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := takenByIDOf([]byte(testCase.body)); got != testCase.want {
				t.Errorf("got %q, wanted %q for %s", got, testCase.want, testCase.body)
			}
		})
	}

	// The field is Common's.
	if takenByIDField != "takenById" {
		t.Errorf("the field drifted from the server's: %q", takenByIDField)
	}
}

// What a refusal says of the write it refused: its method, and its resource's type.
func TestTakenNameOf(t *testing.T) {
	body := []byte(nameTakenByBody(t, envelopeError, monitorNameTakenSentence, nameTakenRefusalCode, holderID))

	cases := []struct {
		method   string
		isRename bool
	}{
		{http.MethodPost, false},
		{http.MethodPut, true},
		{http.MethodPatch, true},
	}

	for _, testCase := range cases {
		request, err := http.NewRequestWithContext(ForResource(context.Background(), "oneuptime_probe"), testCase.method, "https://oneuptime.example/api/probe", nil)
		if err != nil {
			t.Fatalf("NewRequest: %s", err)
		}

		got := takenNameOf(&http.Response{StatusCode: http.StatusBadRequest, Request: request}, body)
		want := takenName{takenByID: holderID, resourceType: "oneuptime_probe", isRename: testCase.isRename}
		if got != want {
			t.Errorf("%s: got %+v, wanted %+v", testCase.method, got, want)
		}
	}

	// A response without its request - built by hand - is a create of no known type.
	if got := takenNameOf(&http.Response{StatusCode: http.StatusBadRequest}, body); got != (takenName{takenByID: holderID}) {
		t.Errorf("got %+v", got)
	}
	if got := takenNameOf(nil, nil); got != (takenName{}) {
		t.Errorf("nothing known of nothing, got %+v", got)
	}
}

/*
 * The type a resource's request says reaches the error read off the
 * response the client hands back, after it has asked again too: the
 * response it gives up on is the last one's, made with the same context.
 */
func TestForResource_ReachesTheResponseAfterAskingAgain(t *testing.T) {
	var mu sync.Mutex
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requests++
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, nameTakenByBody(t, envelopeError, monitorNameTakenSentence, nameTakenRefusalCode, holderID))
	}))
	t.Cleanup(server.Close)

	client, err := NewClient(server.URL, "api-key", "test")
	if err != nil {
		t.Fatalf("NewClient: %s", err)
	}
	client.nameTakenRetry = shortNameTakenRetry

	resp, err := client.Post(ForResource(context.Background(), "oneuptime_monitor"), "/monitor", renameBody("API Health Check"))
	if err != nil {
		t.Fatalf("Post: %s", err)
	}
	mu.Lock()
	sent := requests
	mu.Unlock()
	if sent < 2 {
		t.Fatalf("expected the create to be asked again, it was sent %d time(s)", sent)
	}
	if got := resourceTypeOf(resp); got != "oneuptime_monitor" {
		t.Errorf("the response handed back lost its resource's type: %q", got)
	}
	if got := resourceTypeOf(nil); got != "" {
		t.Errorf("no response, no type: %q", got)
	}

	plain, err := client.Get(context.Background(), "/monitor/x")
	if err != nil {
		t.Fatalf("Get: %s", err)
	}
	if got := resourceTypeOf(plain); got != "" {
		t.Errorf("a request that said no type has none: %q", got)
	}
}

/*
 * The server's side of it, faked: a project's monitors, each with an ID as
 * OneUptime writes one. The refusal names the record that has the name only
 * when the key may read it, as RequiredUniqueNames does - so an apply onto a
 * name a record the key may not read has fails with the advice as it was,
 * and that record's ID appears nowhere in the error.
 */
func TestDoRequest_TheErrorNamesOnlyARecordTheKeyMayRead(t *testing.T) {
	readable := "3c1a9e2b-0000-4000-8000-000000011019"
	hidden := "9d4e6f70-0000-4000-8000-000000011019"
	holders := map[string]string{
		"API Health Check": readable,
		"Billing API":      hidden,
	}
	mayRead := map[string]bool{readable: true}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Data struct {
				Name string `json:"name"`
			} `json:"data"`
		}
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &request); err != nil {
			t.Errorf("request body was not JSON: %s", raw)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		holder, taken := holders[request.Data.Name]
		if !taken {
			w.WriteHeader(http.StatusOK)
			_, _ = io.WriteString(w, `{"data":{"_id":"`+readable+`"}}`)
			return
		}

		var takenByID interface{}
		if mayRead[holder] {
			takenByID = holder
		}
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, nameTakenByBody(t, envelopeError, "Another monitor in this project is already called "+request.Data.Name+", and the project requires unique names. Pick another name.", nameTakenRefusalCode, takenByID))
	}))
	t.Cleanup(server.Close)

	client, err := NewClient(server.URL, "api-key", "test")
	if err != nil {
		t.Fatalf("NewClient: %s", err)
	}
	client.nameTakenRetry = shortNameTakenRetry

	create := func(name string) error {
		resp, err := client.Post(ForResource(context.Background(), "oneuptime_monitor"), "/monitor", renameBody(name))
		if err != nil {
			t.Fatalf("Post: %s", err)
		}
		return client.ParseResponse(resp, nil)
	}

	named := create("API Health Check")
	if named == nil || !strings.Contains(named.Error(), "\n\n  terraform import oneuptime_monitor.<name> "+readable+"\n\n") {
		t.Errorf("a record the key may read is named, with its import line: %v", named)
	}

	unnamed := create("Billing API")
	if unnamed == nil {
		t.Fatalf("a create onto a name a hidden record has went through")
	}
	if strings.Contains(unnamed.Error(), hidden) || strings.Contains(unnamed.Error(), "terraform import") {
		t.Errorf("a record the key may not read is never named: %s", unnamed)
	}
	if !strings.HasSuffix(unnamed.Error(), "The name was still taken after asking again for 30ms. "+nothingGaveTheNameUpAdvice) {
		t.Errorf("expected the advice as it was: %s", unnamed)
	}

	if err := create("Checkout API"); err != nil {
		t.Errorf("a free name is created: %s", err)
	}
}

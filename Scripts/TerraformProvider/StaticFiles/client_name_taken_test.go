package provider

/*
 * client.go asks a create or an update again while the server refuses it
 * because another record has the name it asks for (OneUptime/oneuptime#9855),
 * exercised against a real HTTP server.
 *
 * WHAT THIS FILE PINS
 *
 * Teams, labels, on-call policies and on-call schedules each have a name of
 * their own in a project. Terraform makes the independent changes of one
 * apply side by side, so in a chain of renames - A becomes B while B becomes
 * C - A's rename is refused whenever it runs before B's has given the name
 * up. Nothing is written by a refused write, so the client asks again, with
 * backoff, for a bounded time:
 *
 *   - a chain converges in one apply, whichever rename runs first, and so
 *     does a create of a name another resource is giving up;
 *   - a swap, or any cycle, can never go first: it gives up once the window
 *     has passed, and the error says to go by way of a temporary name;
 *   - only the server's code marks the refusal (refusalCode "name_taken",
 *     Common/Types/Exception/NameTakenException.ts): no other 400 is asked
 *     again - not the refusal's own English without its code, as a server
 *     from before the code answers, nor any other code - and neither is a
 *     read or a delete;
 *   - the response handed back can still be read, and Terraform's
 *     cancellation ends the waiting.
 *
 * The fake API below holds named records and refuses a name the way the
 * server does (Common/Server/Utils/Database/UniqueNameInProject.ts): another
 * record's name, whatever its case, on a create or on a rename. What the
 * server really answers - the status, the sentence and the code beside it,
 * through the express error handler a route's next(err) reaches - is pinned
 * on the server's side by
 * Common/Tests/Server/Utils/NameTakenRefusalAnswer.test.ts.
 */

import (
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

// A refusal body as the server answers it: the sentence, and the code beside it.
func nameTakenBody(t *testing.T, envelope string, sentence string) string {
	t.Helper()
	encoded, err := json.Marshal(map[string]string{
		envelope:         sentence,
		refusalCodeField: nameTakenRefusalCode,
	})
	if err != nil {
		t.Fatalf("marshalling the refusal: %s", err)
	}
	return string(encoded)
}

// namedRecordsAPI holds records by id with a name each, as a project's teams.
type namedRecordsAPI struct {
	t      *testing.T
	mu     sync.Mutex
	names  map[string]string
	nextID int
	// Every request, in the order it arrived: "PUT /team/a Beta".
	requests []string
	server   *httptest.Server
}

func newNamedRecordsAPI(t *testing.T, names map[string]string) (*namedRecordsAPI, *Client) {
	t.Helper()

	api := &namedRecordsAPI{t: t, names: names}
	api.server = httptest.NewServer(http.HandlerFunc(api.handle))
	t.Cleanup(api.server.Close)

	client, err := NewClient(api.server.URL, "api-key", "test")
	if err != nil {
		t.Fatalf("NewClient: %s", err)
	}
	client.nameTakenRetry = quickNameTakenRetry

	return api, client
}

func (api *namedRecordsAPI) handle(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		api.t.Errorf("reading request body: %s", err)
		return
	}

	var request struct {
		Data struct {
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &request); err != nil {
		api.t.Errorf("request body was not JSON (%s): %s", err, raw)
		return
	}
	name := request.Data.Name

	api.mu.Lock()
	defer api.mu.Unlock()

	api.requests = append(api.requests, fmt.Sprintf("%s %s %s", r.Method, strings.TrimPrefix(r.URL.Path, "/api"), name))

	id := ""
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/api/team":
	case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/team/"):
		id = strings.TrimPrefix(r.URL.Path, "/api/team/")
	default:
		w.WriteHeader(http.StatusNotFound)
		return
	}

	// Another record's name, whatever its case: refused, and nothing written.
	for otherID, otherName := range api.names {
		if otherID != id && strings.EqualFold(otherName, name) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, nameTakenBody(api.t, "error", teamNameTakenSentence(name)))
			return
		}
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
				if strings.Contains(err.Error(), "temporary name") {
					t.Errorf("%s: only a name-taken refusal says to use a temporary name: %s", method, err)
				}
			}
		})
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
	if advice := client.nameTakenAdvice(); !strings.HasPrefix(advice, "The name was still taken after asking again for 30 seconds.") {
		t.Errorf("the advice should say how long it asked: %s", advice)
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
		{
			"an archived on-call policy's name",
			nameTakenBody(t, "error", "There is already an archived on-call policy called Primary in this project. Unarchive it from On-Call > Advanced > Archived Policies, or pick another name."),
			true,
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

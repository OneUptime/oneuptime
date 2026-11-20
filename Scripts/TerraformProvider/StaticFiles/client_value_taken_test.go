package provider

/*
 * client.go asks a create or an update again while the server refuses it
 * because a record in service holds a value that is not a name, but that a
 * record holds alone (OneUptime/oneuptime#10319), exercised against a real
 * HTTP server, as client_name_taken_test.go does for names.
 *
 * WHAT THIS FILE PINS
 *
 * A status page's, a dashboard's or a form's domain, a project domain, a
 * host's or a Kubernetes cluster's identifier, an SSO provider's sign-on
 * URL, an API key's permission: the server refuses a create or a change
 * onto one another record has with refusalCode "value_taken", and the field
 * whose value is taken (Common/Types/Exception/ValueTakenException.ts).
 * Terraform makes the independent changes of one apply side by side, so a
 * status page domain moved from one resource to another - one deleted, one
 * created - is refused whenever the create runs before the delete. Nothing
 * was written, so the client asks again, for the window it asks a name
 * again in:
 *
 *   - the move converges in one apply, whichever runs first;
 *   - a swap of two hosts' identifiers, and a value a record outside the
 *     configuration has, give up once the window has passed, and the error
 *     says what to do - for a value, in a value's words, never a name's;
 *   - a value only an archived record has ("value_taken_by_archived") is
 *     handed back at once, with the server's own sentence and nothing
 *     added, on POST, PUT and PATCH, in both envelopes;
 *   - only the code marks the refusal: the server's sentence without it, a
 *     value's code on any status but 400, a read and a delete are never
 *     asked again;
 *   - the refusal handed back can still be read, the field included.
 *
 * What the server really answers is pinned on the server's side by
 * Common/Tests/Server/Utils/NameTakenRefusalAnswer.test.ts and
 * Common/Tests/Server/Services/UniqueNameRefusalCodes.test.ts.
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
	"time"
)

// The server's words for a domain another status page domain of the project has.
const statusPageDomainTakenSentence = "Status Page Domain with the same fullDomain already exists."

// The server's words for a host name another host has (DiscoveredResourceUpdate).
func hostIdentifierTakenSentence(identifier string) string {
	return fmt.Sprintf("A host with the host name %q already exists.", identifier)
}

// The same, when the host that has it is archived.
func archivedHostIdentifierTakenSentence(identifier string) string {
	return hostIdentifierTakenSentence(identifier) + " It is archived: unarchive it instead of adding it again."
}

// A refusal body of a taken value, as the server answers it: the sentence,
// the code and the field beside it.
func valueTakenBody(t *testing.T, envelope string, sentence string, code string, field string) string {
	t.Helper()
	encoded, err := json.Marshal(map[string]string{
		envelope:         sentence,
		refusalCodeField: code,
		"field":          field,
	})
	if err != nil {
		t.Fatalf("marshalling the refusal: %s", err)
	}
	return string(encoded)
}

// The words the client adds once nothing gave the value up, without the wait.
const nothingGaveTheValueUpAdvice = "If a record outside this configuration has it, give this resource another value, or import that record. If resources in this configuration swap values, none of them can go first: give one of them a temporary value, apply, then apply the values you want."

// Words only a refusal of a value asked again for the whole window may carry.
var valueAdviceWords = []string{
	"asking again",
	"another value",
	"temporary value",
}

/*
 * takenValuesAPI holds records by id with one value each that a record of
 * the collection holds alone - a project's status page domains and their
 * full domain, its hosts and their host name - and refuses a create or a
 * change onto another record's value the way the server does: whatever its
 * case, with the archived code when only an archived record has it, and
 * the field beside the code.
 */
type takenValuesAPI struct {
	t *testing.T
	// The records' collection under /api: "status-page-domain", "host".
	collection string
	// The field each record holds alone: "fullDomain", "hostIdentifier".
	field string
	// How the server words a refusal of a value the given record has.
	sentence func(value string, archived bool) string
	mu       sync.Mutex
	values   map[string]string
	archived map[string]bool
	nextID   int
	// Every request, in the order it arrived: "POST /status-page-domain status.example.com".
	requests []string
	server   *httptest.Server
}

// A project's status page domains, each with a full domain of its own.
func newStatusPageDomainsAPI(t *testing.T, values map[string]string) (*takenValuesAPI, *Client) {
	t.Helper()

	return newTakenValuesAPI(t, "status-page-domain", "fullDomain", func(_ string, _ bool) string {
		return statusPageDomainTakenSentence
	}, values)
}

// A project's hosts, each with a host name of its own.
func newHostsAPI(t *testing.T, values map[string]string) (*takenValuesAPI, *Client) {
	t.Helper()

	return newTakenValuesAPI(t, "host", "hostIdentifier", func(value string, archived bool) string {
		if archived {
			return archivedHostIdentifierTakenSentence(value)
		}
		return hostIdentifierTakenSentence(value)
	}, values)
}

func newTakenValuesAPI(t *testing.T, collection string, field string, sentence func(value string, archived bool) string, values map[string]string) (*takenValuesAPI, *Client) {
	t.Helper()

	api := &takenValuesAPI{
		t:          t,
		collection: collection,
		field:      field,
		sentence:   sentence,
		values:     values,
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

// archive marks a record archived: it keeps its value, as the server's do.
func (api *takenValuesAPI) archive(id string) {
	api.mu.Lock()
	defer api.mu.Unlock()
	api.archived[id] = true
}

func (api *takenValuesAPI) handle(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		api.t.Errorf("reading request body: %s", err)
		return
	}

	// A delete sends no body; a create and a change send the record.
	value := ""
	if r.Method != http.MethodDelete {
		var request struct {
			Data map[string]interface{} `json:"data"`
		}
		if err := json.Unmarshal(raw, &request); err != nil {
			api.t.Errorf("request body was not JSON (%s): %s", err, raw)
			return
		}
		value, _ = request.Data[api.field].(string)
	}

	api.mu.Lock()
	defer api.mu.Unlock()

	api.requests = append(api.requests, fmt.Sprintf("%s %s %s", r.Method, strings.TrimPrefix(r.URL.Path, "/api"), value))

	collection := "/api/" + api.collection
	id := ""
	switch {
	case r.Method == http.MethodPost && r.URL.Path == collection:
	case (r.Method == http.MethodPut || r.Method == http.MethodPatch) && strings.HasPrefix(r.URL.Path, collection+"/"):
		id = strings.TrimPrefix(r.URL.Path, collection+"/")
	case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, collection+"/"):
		// A deleted record gives its value up.
		id = strings.TrimPrefix(r.URL.Path, collection+"/")
		delete(api.values, id)
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
	 * Another record's value, whatever its case: refused, and nothing
	 * written. Only a value no record in service has carries the archived
	 * code.
	 */
	taken, takenByArchived := false, false
	for otherID, otherValue := range api.values {
		if otherID == id || !strings.EqualFold(otherValue, value) {
			continue
		}
		if api.archived[otherID] {
			takenByArchived = true
		} else {
			taken = true
		}
	}
	if taken || takenByArchived {
		code := valueTakenRefusalCode
		if !taken {
			code = valueTakenByArchivedRefusalCode
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, valueTakenBody(api.t, "error", api.sentence(value, !taken), code, api.field))
		return
	}

	if id == "" {
		api.nextID++
		id = fmt.Sprintf("new-%d", api.nextID)
	}
	api.values[id] = value

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprintf(w, `{"data":{"_id":%q,%q:%q}}`, id, api.field, value)
}

func (api *takenValuesAPI) valueOf(id string) (string, bool) {
	api.mu.Lock()
	defer api.mu.Unlock()
	value, ok := api.values[id]
	return value, ok
}

func (api *takenValuesAPI) requestsFor(prefix string) int {
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

func valueBody(field string, value string) map[string]interface{} {
	return map[string]interface{}{"data": map[string]interface{}{field: value}}
}

// createValue sends a create as a resource's Create does, and reads the answer as it does.
func createValue(ctx context.Context, client *Client, api *takenValuesAPI, value string) error {
	resp, err := client.Post(ctx, "/"+api.collection, valueBody(api.field, value))
	if err != nil {
		return err
	}
	return client.ParseResponse(resp, nil)
}

// changeValue sends a change as a resource's Update does, and reads the answer as it does.
func changeValue(ctx context.Context, client *Client, api *takenValuesAPI, id string, value string) error {
	resp, err := client.Put(ctx, "/"+api.collection+"/"+id, valueBody(api.field, value))
	if err != nil {
		return err
	}
	return client.ParseResponse(resp, nil)
}

/*
 * The issue's own case: a status page domain moved from one
 * oneuptime_status_page_domain resource to another in one apply. The new
 * resource's create runs first and is refused while the old one still
 * holds the domain; it goes through once the old resource's delete, which
 * Terraform starts a little later, has given the domain up.
 */
func TestDoRequest_ADomainMovedToAnotherResourceConvergesInOneApply(t *testing.T) {
	api, client := newStatusPageDomainsAPI(t, map[string]string{"old": "status.example.com"})

	var wait sync.WaitGroup
	errs := make([]error, 2)

	wait.Add(2)
	go func() {
		defer wait.Done()
		errs[0] = createValue(context.Background(), client, api, "STATUS.example.com")
	}()
	go func() {
		defer wait.Done()
		time.Sleep(150 * time.Millisecond)
		resp, err := client.Delete(context.Background(), "/status-page-domain/old")
		if err != nil {
			errs[1] = err
			return
		}
		errs[1] = client.ParseResponse(resp, nil)
	}()
	wait.Wait()

	for index, err := range errs {
		if err != nil {
			t.Fatalf("change %d of the move failed: %s", index, err)
		}
	}
	if _, stillThere := api.valueOf("old"); stillThere {
		t.Errorf("the old resource's domain should be gone")
	}
	if value, ok := api.valueOf("new-1"); !ok || value != "STATUS.example.com" {
		t.Errorf("the new resource should hold the domain, got %q (%t)", value, ok)
	}
	if asked := api.requestsFor("POST /status-page-domain"); asked < 2 {
		t.Errorf("the create should have been refused first and asked again, it was sent %d time(s)", asked)
	}
}

// Whichever runs first: a delete before the create leaves nothing to wait for.
func TestDoRequest_ADomainMovedAfterTheDeleteGoesThroughAtOnce(t *testing.T) {
	api, client := newStatusPageDomainsAPI(t, map[string]string{"old": "status.example.com"})

	resp, err := client.Delete(context.Background(), "/status-page-domain/old")
	if err != nil {
		t.Fatalf("Delete: %s", err)
	}
	if err := client.ParseResponse(resp, nil); err != nil {
		t.Fatalf("the delete should parse: %s", err)
	}

	if err := createValue(context.Background(), client, api, "status.example.com"); err != nil {
		t.Fatalf("the create should go through: %s", err)
	}
	if asked := api.requestsFor("POST /status-page-domain"); asked != 1 {
		t.Errorf("a free domain is asked for once, it was sent %d time(s)", asked)
	}
}

/*
 * Two hosts swap their host names in one apply: neither change can go
 * first. Both give up once the window has passed, and say what to do in a
 * value's words.
 */
func TestDoRequest_AnIdentifierSwapGivesUpWithAClearMessage(t *testing.T) {
	api, client := newHostsAPI(t, map[string]string{"a": "web-01", "b": "web-02"})
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
		errs[0] = changeValue(context.Background(), client, api, "a", "web-02")
	}()
	go func() {
		defer wait.Done()
		errs[1] = changeValue(context.Background(), client, api, "b", "web-01")
	}()
	wait.Wait()

	elapsed := time.Since(started)

	for index, value := range []string{"web-02", "web-01"} {
		err := errs[index]
		if err == nil {
			t.Fatalf("change %d of a swap went through", index)
		}
		for _, words := range []string{
			"returned status 400",
			hostIdentifierTakenSentence(value),
			"The value was still taken after asking again for 300ms.",
			nothingGaveTheValueUpAdvice,
		} {
			if !strings.Contains(err.Error(), words) {
				t.Errorf("change %d's error should say %q; it said: %s", index, words, err)
			}
		}
		// A value's words, never a name's.
		for _, words := range []string{"The name was still taken", "temporary name"} {
			if strings.Contains(err.Error(), words) {
				t.Errorf("change %d's error speaks of a name (%q): %s", index, words, err)
			}
		}
	}

	if a, _ := api.valueOf("a"); a != "web-01" {
		t.Errorf("a refused swap changes nothing, got a=%s", a)
	}
	if b, _ := api.valueOf("b"); b != "web-02" {
		t.Errorf("a refused swap changes nothing, got b=%s", b)
	}

	// Bounded: it waited out the window, and asked a handful of times, not in a loop.
	if elapsed < 300*time.Millisecond {
		t.Errorf("gave up after %s, before the 300ms window had passed", elapsed)
	}
	if elapsed > 3*time.Second {
		t.Errorf("took %s to give up on a 300ms window", elapsed)
	}
	for _, id := range []string{"a", "b"} {
		asked := api.requestsFor("PUT /host/" + id)
		if asked < 3 || asked > 20 {
			t.Errorf("%s's change was sent %d times in a 300ms window that waits 10ms, then 20ms, then 40ms", id, asked)
		}
	}
}

// A domain a record outside the configuration holds: nothing gives it up.
func TestDoRequest_AValueNothingGivesUpEndsWithWhatToDo(t *testing.T) {
	api, client := newStatusPageDomainsAPI(t, map[string]string{"elsewhere": "status.example.com"})
	client.nameTakenRetry = nameTakenRetry{
		window:    200 * time.Millisecond,
		firstWait: 10 * time.Millisecond,
		maxWait:   40 * time.Millisecond,
	}

	err := createValue(context.Background(), client, api, "status.example.com")
	if err == nil {
		t.Fatalf("a domain another record holds must not be created")
	}

	for _, words := range []string{
		"returned status 400",
		statusPageDomainTakenSentence,
		"The value was still taken after asking again for 200ms.",
		nothingGaveTheValueUpAdvice,
	} {
		if !strings.Contains(err.Error(), words) {
			t.Errorf("the error should say %q; it said: %s", words, err)
		}
	}
	if _, created := api.valueOf("new-1"); created {
		t.Errorf("a refused create writes nothing")
	}
}

/*
 * A value only an archived record has: nothing an apply does to the
 * records in service gives it up, so it is handed back at once, with the
 * server's own sentence and nothing added, on every write, in both
 * envelopes.
 */
func TestDoRequest_NeverAsksAgainForAValueOnlyAnArchivedRecordHas(t *testing.T) {
	for _, method := range []string{"POST", "PUT", "PATCH"} {
		for _, envelope := range []string{"error", "message"} {
			t.Run(method+" "+envelope, func(t *testing.T) {
				asked := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					asked++
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusBadRequest)
					_, _ = io.WriteString(w, valueTakenBody(t, envelope, archivedHostIdentifierTakenSentence("web-01"), valueTakenByArchivedRefusalCode, "hostIdentifier"))
				}))
				t.Cleanup(server.Close)

				client, err := NewClient(server.URL, "api-key", "test")
				if err != nil {
					t.Fatalf("NewClient: %s", err)
				}
				client.nameTakenRetry = quickNameTakenRetry

				started := time.Now()
				resp, err := client.DoRequest(context.Background(), method, "/host/a", valueBody("hostIdentifier", "web-01"))
				if err != nil {
					t.Fatalf("DoRequest: %s", err)
				}
				if asked != 1 {
					t.Errorf("a value only an archived record has was asked %d times; it must be asked once", asked)
				}
				if time.Since(started) > quickNameTakenRetry.window/2 {
					t.Errorf("answered after %s: it must be answered at once", time.Since(started))
				}

				parseErr := client.ParseResponse(resp, nil)
				if parseErr == nil {
					t.Fatalf("the refusal must reach the caller")
				}
				if !strings.Contains(parseErr.Error(), archivedHostIdentifierTakenSentence("web-01")) {
					t.Errorf("the server's sentence should reach the caller: %s", parseErr)
				}
				for _, words := range valueAdviceWords {
					if strings.Contains(parseErr.Error(), words) {
						t.Errorf("an archived holder's refusal gets none of the client's advice (%q): %s", words, parseErr)
					}
				}
			})
		}
	}
}

// The same through a whole apply: an archived host keeps its host name.
func TestDoRequest_AValueAnArchivedRecordHasFailsTheApplyAtOnce(t *testing.T) {
	api, client := newHostsAPI(t, map[string]string{"retired": "web-01"})
	api.archive("retired")

	err := createValue(context.Background(), client, api, "web-01")
	if err == nil {
		t.Fatalf("a host name an archived host keeps must not be given to another")
	}
	if !strings.Contains(err.Error(), archivedHostIdentifierTakenSentence("web-01")) {
		t.Errorf("the error should say the host that has it is archived: %s", err)
	}
	if asked := api.requestsFor("POST /host"); asked != 1 {
		t.Errorf("asked %d times; an archived holder's refusal is answered at once", asked)
	}
}

/*
 * Only the code marks the refusal: the server's sentence without it, as a
 * server from before #10319 answers, and a value's code on any status but
 * 400, are handed back at once.
 */
func TestDoRequest_NeverAsksAgainForAValueWithoutItsCodeOrOnAnotherStatus(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
	}{
		{"the sentence without its code", http.StatusBadRequest, `{"error":"Status Page Domain with the same fullDomain already exists."}`},
		{"the code on a 409", http.StatusConflict, `{"error":"Taken.","refusalCode":"value_taken","field":"fullDomain"}`},
		{"the code on a 422", http.StatusUnprocessableEntity, `{"error":"Taken.","refusalCode":"value_taken","field":"fullDomain"}`},
		{"another code", http.StatusBadRequest, `{"error":"Taken.","refusalCode":"value_taken_somewhere_else"}`},
	}

	for _, each := range cases {
		t.Run(each.name, func(t *testing.T) {
			asked := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				asked++
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(each.status)
				_, _ = io.WriteString(w, each.body)
			}))
			t.Cleanup(server.Close)

			client, err := NewClient(server.URL, "api-key", "test")
			if err != nil {
				t.Fatalf("NewClient: %s", err)
			}
			client.nameTakenRetry = quickNameTakenRetry

			resp, err := client.Post(context.Background(), "/status-page-domain", valueBody("fullDomain", "status.example.com"))
			if err != nil {
				t.Fatalf("Post: %s", err)
			}
			if asked != 1 {
				t.Errorf("asked %d times; only a 400 with the code is asked again", asked)
			}
			if parseErr := client.ParseResponse(resp, nil); parseErr != nil {
				for _, words := range valueAdviceWords {
					if strings.Contains(parseErr.Error(), words) {
						t.Errorf("only a value a record in service has gets the client's advice (%q): %s", words, parseErr)
					}
				}
			}
		})
	}
}

// A read and a delete are never asked again, whatever they are answered.
func TestDoRequest_NeverAsksAgainForAValueOnAReadOrADelete(t *testing.T) {
	for _, method := range []string{"GET", "DELETE"} {
		t.Run(method, func(t *testing.T) {
			asked := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				asked++
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				_, _ = io.WriteString(w, valueTakenBody(t, "error", statusPageDomainTakenSentence, valueTakenRefusalCode, "fullDomain"))
			}))
			t.Cleanup(server.Close)

			client, err := NewClient(server.URL, "api-key", "test")
			if err != nil {
				t.Fatalf("NewClient: %s", err)
			}
			client.nameTakenRetry = quickNameTakenRetry

			if _, err := client.DoRequest(context.Background(), method, "/status-page-domain/a", nil); err != nil {
				t.Fatalf("DoRequest: %s", err)
			}
			if asked != 1 {
				t.Errorf("a %s was asked %d times; it is never asked again", method, asked)
			}
		})
	}
}

// Once given up, the refusal handed back is whole: its sentence, its code and its field.
func TestDoRequest_AValueRefusalHandedBackCanStillBeRead(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, valueTakenBody(t, "message", statusPageDomainTakenSentence, valueTakenRefusalCode, "fullDomain"))
	}))
	t.Cleanup(server.Close)

	client, err := NewClient(server.URL, "api-key", "test")
	if err != nil {
		t.Fatalf("NewClient: %s", err)
	}
	client.nameTakenRetry = nameTakenRetry{
		window:    50 * time.Millisecond,
		firstWait: 10 * time.Millisecond,
		maxWait:   20 * time.Millisecond,
	}

	resp, err := client.Post(context.Background(), "/status-page-domain", valueBody("fullDomain", "status.example.com"))
	if err != nil {
		t.Fatalf("Post: %s", err)
	}

	raw, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		t.Fatalf("reading the refusal: %s", err)
	}

	var parsed map[string]string
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("the refusal handed back should be JSON: %s (%s)", err, raw)
	}
	if parsed["message"] != statusPageDomainTakenSentence || parsed[refusalCodeField] != valueTakenRefusalCode || parsed["field"] != "fullDomain" {
		t.Errorf("the refusal handed back is not the server's: %v", parsed)
	}
}

// A name's refusal gets a name's advice, and a value's a value's: never each other's.
func TestParseResponse_SaysWhatToDoInTheWordsOfWhatIsTaken(t *testing.T) {
	client, err := NewClient("https://oneuptime.example.com", "api-key", "test")
	if err != nil {
		t.Fatalf("NewClient: %s", err)
	}

	answer := func(body string) error {
		return client.ParseResponse(&http.Response{
			StatusCode: http.StatusBadRequest,
			Body:       io.NopCloser(strings.NewReader(body)),
		}, nil)
	}

	valueErr := answer(valueTakenBody(t, "error", statusPageDomainTakenSentence, valueTakenRefusalCode, "fullDomain"))
	if !strings.Contains(valueErr.Error(), "The value was still taken after asking again for 30 seconds. "+nothingGaveTheValueUpAdvice) {
		t.Errorf("a value's refusal should end with a value's advice: %s", valueErr)
	}
	if strings.Contains(valueErr.Error(), nothingGaveTheNameUpAdvice) {
		t.Errorf("a value's refusal must not carry a name's advice: %s", valueErr)
	}

	nameErr := answer(nameTakenBody(t, "error", severityNameTakenSentence))
	if !strings.Contains(nameErr.Error(), nothingGaveTheNameUpAdvice) {
		t.Errorf("a name's refusal should end with a name's advice: %s", nameErr)
	}
	if strings.Contains(nameErr.Error(), nothingGaveTheValueUpAdvice) {
		t.Errorf("a name's refusal must not carry a value's advice: %s", nameErr)
	}

	archivedErr := answer(valueTakenBody(t, "error", archivedHostIdentifierTakenSentence("web-01"), valueTakenByArchivedRefusalCode, "hostIdentifier"))
	if archivedErr.Error() != "the OneUptime API returned status 400: "+archivedHostIdentifierTakenSentence("web-01") {
		t.Errorf("an archived holder's refusal is the server's sentence alone: %s", archivedErr)
	}
}

func TestIsValueTakenRefusal(t *testing.T) {
	cases := []struct {
		body string
		want bool
	}{
		{`{"error":"Taken.","refusalCode":"value_taken","field":"fullDomain"}`, true},
		{`{"message":"Taken.","refusalCode":"value_taken"}`, true},
		// What an archived record has is no refusal another resource ends.
		{`{"error":"Taken.","refusalCode":"value_taken_by_archived","field":"hostIdentifier"}`, false},
		// A name is not a value, and the words alone are nothing.
		{`{"error":"Taken.","refusalCode":"name_taken"}`, false},
		{`{"error":"Status Page Domain with the same fullDomain already exists."}`, false},
		{`not json`, false},
	}

	for _, each := range cases {
		if got := isValueTakenRefusal([]byte(each.body)); got != each.want {
			t.Errorf("isValueTakenRefusal(%s) = %t, want %t", each.body, got, each.want)
		}
	}
}

func TestTakenRefusalCodes(t *testing.T) {
	// The codes are the server's, emitted from Common's constants.
	if valueTakenRefusalCode != "value_taken" || valueTakenByArchivedRefusalCode != "value_taken_by_archived" {
		t.Fatalf("the value codes are not the server's: %q, %q", valueTakenRefusalCode, valueTakenByArchivedRefusalCode)
	}

	for _, code := range []string{nameTakenRefusalCode, valueTakenRefusalCode} {
		if !isTakenRefusalCode(code) {
			t.Errorf("%q is asked again: a resource of the apply may give it up", code)
		}
		if isTakenByArchivedRefusalCode(code) {
			t.Errorf("%q is not an archived holder's", code)
		}
	}

	for _, code := range []string{nameTakenByArchivedRefusalCode, valueTakenByArchivedRefusalCode} {
		if isTakenRefusalCode(code) {
			t.Errorf("%q is never asked again", code)
		}
		if !isTakenByArchivedRefusalCode(code) {
			t.Errorf("%q is an archived holder's", code)
		}
	}

	for _, code := range []string{"", "reauthentication_required", "value_taken_somewhere_else"} {
		if isTakenRefusalCode(code) || isTakenByArchivedRefusalCode(code) {
			t.Errorf("%q is no taken name or value", code)
		}
	}
}

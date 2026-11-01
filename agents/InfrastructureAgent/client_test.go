package main

import (
	"context"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Every request the agent sends to OneUptime has a deadline, requestTimeout
// (client.go). A server or proxy that takes the request and never answers
// fails it then, as one that refuses the connection would, instead of holding
// it - and, at startup, the whole agent - forever. These tests send the
// agent's requests over real HTTP to local servers that never answer, without
// a proxy and through one.

// testProxiedOneUptimeURL is the OneUptime URL of an agent whose requests go
// through a proxy. The .invalid domain resolves nowhere, so a request can get
// anywhere only through the proxy.
const testProxiedOneUptimeURL = "http://oneuptime.invalid"

// testStallTimeout is the requestTimeout the tests below run with: far longer
// than a local server takes to answer, were it answering, and short enough to
// wait out.
const testStallTimeout = 300 * time.Millisecond

// testGiveUpWithin bounds how long a test waits for the agent to do what it
// is waiting for: give up on a server that never answers, or send its first
// report. It is slack for a slow machine on top of the seconds
// collectMetricsJob spends collecting metrics before it sends anything.
const testGiveUpWithin = 30 * time.Second

// testAbandonedWithin bounds how long a server waits to see a client go away
// from a request the client has given up on, which takes milliseconds.
const testAbandonedWithin = 5 * time.Second

// withRequestTimeout sets requestTimeout for the rest of the test. Callers
// must not use t.Parallel: requestTimeout is package state.
func withRequestTimeout(t *testing.T, timeout time.Duration) {
	t.Helper()

	previous := requestTimeout
	requestTimeout = timeout
	t.Cleanup(func() {
		requestTimeout = previous
	})
}

// heldRequest is a request a holdingServer holds.
type heldRequest struct {
	method string
	// target is the request's target as the agent sent it: an absolute URL
	// when it went to a proxy, a path when it went to the server itself.
	target string
}

// holdingServer is a local server that takes requests and never finishes
// answering them.
type holdingServer struct {
	*httptest.Server

	// held gets each request as the server starts holding it, and abandoned
	// gets it again once its client has gone away.
	held      chan heldRequest
	abandoned chan heldRequest
}

// newHoldingServer starts a holdingServer. A request whose path starts with
// one of answered it answers with 200 at once. Any other it holds: it sends
// what begin writes - nothing at all when begin is nil - and then nothing
// more, until the client goes away.
func newHoldingServer(t *testing.T, begin func(w http.ResponseWriter), answered ...string) *holdingServer {
	t.Helper()

	srv := &holdingServer{
		held:      make(chan heldRequest, 16),
		abandoned: make(chan heldRequest, 16),
	}
	testOver := make(chan struct{})

	srv.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The server notices a client going away only once it has read the
		// whole request.
		_, _ = io.Copy(io.Discard, r.Body)

		for _, path := range answered {
			if strings.HasPrefix(r.URL.Path, path) {
				w.WriteHeader(http.StatusOK)
				return
			}
		}

		if begin != nil {
			begin(w)
			w.(http.Flusher).Flush()
		}

		request := heldRequest{method: r.Method, target: r.RequestURI}
		srv.held <- request

		select {
		case <-r.Context().Done():
			srv.abandoned <- request
		case <-testOver:
			// The test is over and the client is still waiting. Drop the
			// connection rather than answer, so that nothing the client does
			// next can look like success.
			if hijacker, ok := w.(http.Hijacker); ok {
				if conn, _, err := hijacker.Hijack(); err == nil {
					_ = conn.Close()
				}
			}
		}
	}))
	t.Cleanup(func() {
		close(testOver)
		srv.Close()
	})

	return srv
}

// nextHeldRequest returns the next request on requests, failing the test with
// what when none comes within limit.
func nextHeldRequest(t *testing.T, requests <-chan heldRequest, limit time.Duration, what string) heldRequest {
	t.Helper()

	select {
	case request := <-requests:
		return request
	case <-time.After(limit):
		t.Fatalf("%s within %v", what, limit)
		return heldRequest{}
	}
}

// assertHeldThenAbandoned checks that srv held one request, want, and that
// its client went away from it.
func assertHeldThenAbandoned(t *testing.T, srv *holdingServer, want heldRequest) {
	t.Helper()

	if got := nextHeldRequest(t, srv.held, time.Second, "the server held no request"); got != want {
		t.Fatalf("the server held %+v, want %+v", got, want)
	}
	select {
	case extra := <-srv.held:
		t.Errorf("the server held another request: %+v", extra)
	default:
	}

	if got := nextHeldRequest(t, srv.abandoned, testAbandonedWithin, "the client never went away from the request the server held"); got != want {
		t.Errorf("the client went away from %+v, want %+v", got, want)
	}
}

// returnsWithin runs f, failing the test with what when f has not returned
// within limit, and says how long f took.
func returnsWithin(t *testing.T, limit time.Duration, what string, f func()) time.Duration {
	t.Helper()

	started := time.Now()
	returned := make(chan struct{})
	go func() {
		defer close(returned)
		f()
	}()

	select {
	case <-returned:
		return time.Since(started)
	case <-time.After(limit):
		t.Fatalf("%s did not return within %v", what, limit)
		return 0
	}
}

// The ways the agent can reach a server: as OneUptime itself, or as the proxy
// it sends its requests to OneUptime through.
var testRoutes = []struct {
	name    string
	proxied bool
}{
	{name: "without a proxy", proxied: false},
	{name: "through a proxy", proxied: true},
}

// agentURLsFor returns the OneUptime URL and the proxy URL that send the
// agent's requests to srv.
func agentURLsFor(srv *holdingServer, proxied bool) (oneuptimeURL string, proxyURL string) {
	if proxied {
		return testProxiedOneUptimeURL, srv.URL
	}
	return srv.URL, ""
}

// heldTarget is the target a request for path reaches the server with.
func heldTarget(path string, proxied bool) string {
	if proxied {
		return testProxiedOneUptimeURL + path
	}
	return path
}

// agent.go schedules a report every 30 seconds. A request that could take
// longer would still be waiting when the next report is sent.
func TestRequestTimeoutFitsInsideTheReportInterval(t *testing.T) {
	if requestTimeout <= 0 || requestTimeout >= 30*time.Second {
		t.Fatalf("requestTimeout = %v, want a positive duration below the 30s report interval", requestTimeout)
	}
}

func TestNewHTTPClientHasTheDeadline(t *testing.T) {
	t.Run("without a proxy", func(t *testing.T) {
		client := newHTTPClient("")
		if client.Timeout != requestTimeout {
			t.Errorf("Timeout = %v, want requestTimeout (%v)", client.Timeout, requestTimeout)
		}
		// Go's default transport, which also follows HTTP_PROXY and HTTPS_PROXY.
		if client.Transport != nil {
			t.Errorf("Transport = %T, want nil, http.DefaultTransport", client.Transport)
		}
	})

	t.Run("through a proxy", func(t *testing.T) {
		const proxy = "http://proxy.invalid:3128"
		client := newHTTPClient(proxy)
		if client.Timeout != requestTimeout {
			t.Errorf("Timeout = %v, want requestTimeout (%v)", client.Timeout, requestTimeout)
		}

		transport, ok := client.Transport.(*http.Transport)
		if !ok {
			t.Fatalf("Transport = %T, want an *http.Transport", client.Transport)
		}
		request, err := http.NewRequest(http.MethodGet, testProxiedOneUptimeURL+testVerifyPath, nil)
		if err != nil {
			t.Fatalf("could not make a request: %v", err)
		}
		if proxied, err := transport.Proxy(request); err != nil || proxied == nil || proxied.String() != proxy {
			t.Errorf("Proxy() = %v, %v, want %s", proxied, err, proxy)
		}
	})

	// The tests below shorten requestTimeout, which they can because a client
	// takes it as it is when the client is made.
	t.Run("as requestTimeout is when the client is made", func(t *testing.T) {
		withRequestTimeout(t, testStallTimeout)
		if got := newHTTPClient("").Timeout; got != testStallTimeout {
			t.Errorf("Timeout = %v after requestTimeout was set to %v", got, testStallTimeout)
		}
	})
}

// requestsWithoutTheDeadline returns where file makes an http.Client without
// Timeout: requestTimeout, or sends with Go's default client - http.Get,
// http.Head, http.Post, http.PostForm or http.DefaultClient - which has no
// deadline at all. It also says how many http.Client literals file has.
func requestsWithoutTheDeadline(fset *token.FileSet, file *ast.File) (violations []string, clients int) {
	defaultClient := map[string]bool{"Get": true, "Head": true, "Post": true, "PostForm": true, "DefaultClient": true}

	ast.Inspect(file, func(node ast.Node) bool {
		switch node := node.(type) {
		case *ast.CompositeLit:
			if !isHTTPClientType(node.Type) {
				return true
			}
			clients++
			if !hasIdentField(node, "Timeout", "requestTimeout") {
				violations = append(violations, fset.Position(node.Pos()).String()+": an http.Client made without Timeout: requestTimeout")
			}
		case *ast.SelectorExpr:
			pkg, ok := node.X.(*ast.Ident)
			if ok && pkg.Name == "http" && defaultClient[node.Sel.Name] {
				violations = append(violations, fset.Position(node.Pos()).String()+": http."+node.Sel.Name+" sends with Go's default client, which has no deadline")
			}
		}
		return true
	})

	return violations, clients
}

// hasIdentField says whether a composite literal sets key to the identifier
// value.
func hasIdentField(literal *ast.CompositeLit, key string, value string) bool {
	for _, element := range literal.Elts {
		field, ok := element.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		fieldKey, keyOk := field.Key.(*ast.Ident)
		fieldValue, valueOk := field.Value.(*ast.Ident)
		if keyOk && valueOk && fieldKey.Name == key && fieldValue.Name == value {
			return true
		}
	}
	return false
}

// Every request the agent sends has the deadline. Read from the package's
// source, so a request sent without it fails here.
func TestEveryAgentRequestHasTheDeadline(t *testing.T) {
	dir := guardPackageDir(t)
	files := guardSourceFiles(t, []string{dir, filepath.Join(dir, "utils"), filepath.Join(dir, "model")})

	clients := 0
	fset := token.NewFileSet()

	for _, path := range files {
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			t.Fatalf("could not parse %s: %v", path, err)
		}

		violations, found := requestsWithoutTheDeadline(fset, file)
		for _, violation := range violations {
			t.Error(violation)
		}
		clients += found
	}

	// The agent's requests all get their client from newHTTPClient.
	if clients < 1 {
		t.Errorf("found %d http.Client literal(s), want at least 1; the scan has stopped finding them", clients)
	}
}

// The scan above finds nothing in the agent's source, which it would also do
// if it were broken. Here it reads source that has every kind of request
// without the deadline, and one with it.
func TestRequestsWithoutTheDeadlineFindsEveryKind(t *testing.T) {
	const source = `package main

func send(address string) {
	_, _ = http.Get(address)
	_, _ = http.Head(address)
	_, _ = http.Post(address, "application/json", nil)
	_, _ = http.PostForm(address, nil)
	_, _ = http.DefaultClient.Do(nil)
	unbounded := &http.Client{CheckRedirect: sameServerRedirectsOnly}
	bounded := &http.Client{Timeout: requestTimeout, CheckRedirect: sameServerRedirectsOnly}
	request, _ := http.NewRequest(http.MethodGet, address, nil)
	_, _ = bounded.Do(request)
	_ = unbounded
}
`

	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "requests.go", source, 0)
	if err != nil {
		t.Fatalf("could not parse the source: %v", err)
	}

	violations, clients := requestsWithoutTheDeadline(fset, file)

	want := []string{
		"requests.go:4:9: http.Get",
		"requests.go:5:9: http.Head",
		"requests.go:6:9: http.Post",
		"requests.go:7:9: http.PostForm",
		"requests.go:8:9: http.DefaultClient",
		"requests.go:9:16: an http.Client made without Timeout",
	}
	if len(violations) != len(want) {
		t.Fatalf("found %d violation(s), want %d:\n%s", len(violations), len(want), strings.Join(violations, "\n"))
	}
	for index, prefix := range want {
		if !strings.HasPrefix(violations[index], prefix) {
			t.Errorf("violation %d = %q, want it to start with %q", index, violations[index], prefix)
		}
	}
	if clients != 2 {
		t.Errorf("counted %d http.Client literal(s), want 2", clients)
	}
}

// The secret key's verification is what the agent waits on before it
// schedules a single report. A server or proxy that takes it and never
// answers fails it after requestTimeout, so the agent says that the key could
// not be verified instead of waiting forever.
func TestCheckIfSecretKeyIsValidGivesUpOnAServerThatNeverAnswers(t *testing.T) {
	for _, route := range testRoutes {
		// No t.Parallel: captureAgentLogs and withRequestTimeout change package state.
		t.Run(route.name, func(t *testing.T) {
			buf := captureAgentLogs(t)
			withRequestTimeout(t, testStallTimeout)
			srv := newHoldingServer(t, nil)
			oneuptimeURL, proxyURL := agentURLsFor(srv, route.proxied)

			var verification keyVerification
			took := returnsWithin(t, testGiveUpWithin, "verifySecretKey", func() {
				verification = verifySecretKey(context.Background(), testSecretKey, oneuptimeURL, proxyURL)
			})

			if verification != keyNotVerified {
				t.Errorf("verifySecretKey() = %v for a verification that was never answered, want keyNotVerified (%v): it is neither accepted nor refused", verification, keyNotVerified)
			}
			if took < testStallTimeout {
				t.Errorf("the verification gave up after %v, before requestTimeout (%v): something other than the deadline ended it", took, testStallTimeout)
			}
			assertHeldThenAbandoned(t, srv, heldRequest{method: http.MethodGet, target: heldTarget(testVerifyPath+testSecretKey, route.proxied)})

			logs := buf.String()
			if lines := agentLogLinesContaining(logs, "Client.Timeout exceeded"); len(lines) != 1 || !strings.Contains(lines[0], "level=ERROR") {
				t.Errorf("expected the deadline to be logged once, as the verification's error, got:\n%s", logs)
			}
			assertNoSecretInLogs(t, buf, testSecretKey)
		})
	}
}

// withKeyVerificationRetries makes the agent wait first, doubled up to
// longest, before asking about its key again, for the rest of the test.
// Callers must not use t.Parallel: the waits are package state.
func withKeyVerificationRetries(t *testing.T, first time.Duration, longest time.Duration) {
	t.Helper()

	previousFirst, previousLongest := keyVerificationFirstRetry, keyVerificationLongestRetry
	keyVerificationFirstRetry, keyVerificationLongestRetry = first, longest
	t.Cleanup(func() {
		keyVerificationFirstRetry, keyVerificationLongestRetry = previousFirst, previousLongest
	})
}

// newVerifyingServer starts a local OneUptime that fails the first failures
// verifications of the key with fail, and answers every other request with
// 200. It counts the verifications.
func newVerifyingServer(t *testing.T, failures int32, fail func(w http.ResponseWriter, r *http.Request)) (*httptest.Server, *atomic.Int32) {
	t.Helper()

	verifications := &atomic.Int32{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, testVerifyPath) && verifications.Add(1) <= failures {
			fail(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	return srv, verifications
}

// Without the deadline, a server that took the key's verification and never
// answered held NewAgent forever. With it, the agent exited - so that the
// service manager could start it again, which on Windows nothing did: an
// agent that started before the network, or while OneUptime restarted, stayed
// stopped. A verification that gets no answer, or OneUptime's own error, says
// nothing about the key: the agent asks again, waiting longer each time, and
// starts once OneUptime answers.
func TestNewAgentAsksAgainUntilTheKeyCanBeVerified(t *testing.T) {
	cases := []struct {
		name string
		fail func(w http.ResponseWriter, r *http.Request)
	}{
		{name: "OneUptime does not answer", fail: func(_ http.ResponseWriter, r *http.Request) {
			// Held until the agent gives up on it, after requestTimeout.
			<-r.Context().Done()
		}},
		{name: "OneUptime is restarting", fail: func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		}},
	}

	for _, c := range cases {
		// No t.Parallel: captureAgentLogs, withRequestTimeout and the retries change package state.
		t.Run(c.name, func(t *testing.T) {
			buf := captureAgentLogs(t)
			withRequestTimeout(t, testStallTimeout)
			withKeyVerificationRetries(t, 10*time.Millisecond, 20*time.Millisecond)
			srv, verifications := newVerifyingServer(t, 3, c.fail)

			var ag *Agent
			returnsWithin(t, testGiveUpWithin, "NewAgent", func() {
				ag = NewAgent(context.Background(), testSecretKey, srv.URL, "")
			})
			if ag == nil {
				t.Fatalf("NewAgent returned nil although OneUptime accepted the key in the end:\n%s", buf.String())
			}
			t.Cleanup(ag.Close)

			if got := verifications.Load(); got != 4 {
				t.Errorf("the key was verified %d times, want 3 failures and the answer", got)
			}
			logs := buf.String()
			if got := len(agentLogLinesContaining(logs, "could not be verified with OneUptime yet")); got != 3 {
				t.Errorf("logged %d retries, want 3:\n%s", got, logs)
			}
			for _, wait := range []string{"asking again in 10ms", "asking again in 20ms"} {
				if !strings.Contains(logs, wait) {
					t.Errorf("expected %q in the log:\n%s", wait, logs)
				}
			}
			if strings.Contains(logs, "Secret key is invalid") {
				t.Errorf("a key that could not be verified yet was called invalid:\n%s", logs)
			}
			assertNoSecretInLogs(t, buf, testSecretKey)
		})
	}
}

// The waits between asking about the key: 5 seconds, then twice as long each
// time, to 5 minutes at most.
func TestNextKeyVerificationRetry(t *testing.T) {
	var waits []string
	var wait time.Duration
	for i := 0; i < 9; i++ {
		wait = nextKeyVerificationRetry(wait)
		waits = append(waits, wait.String())
	}

	if got, want := strings.Join(waits, " "), "5s 10s 20s 40s 1m20s 2m40s 5m0s 5m0s 5m0s"; got != want {
		t.Errorf("waits = %s, want %s", got, want)
	}
}

// A redirect the agent does not follow would stop the next verification too,
// so it ends the asking; any other failure to get an answer does not.
func TestKeyVerificationOfError(t *testing.T) {
	refused := &url.Error{Op: "Get", URL: "http://oneuptime.example/x", Err: &redirectRefused{reason: "redirected to another server"}}
	if got := keyVerificationOfError(refused); got != keyRefused {
		t.Errorf("a refused redirect: %v, want keyRefused", got)
	}

	for _, err := range []error{
		&url.Error{Op: "Get", URL: "http://oneuptime.example/x", Err: errors.New("dial tcp: connection refused")},
		&url.Error{Op: "Get", URL: "http://oneuptime.example/x", Err: context.DeadlineExceeded},
		errors.New("x509: certificate signed by unknown authority"),
	} {
		if got := keyVerificationOfError(err); got != keyNotVerified {
			t.Errorf("%v: %v, want keyNotVerified", err, got)
		}
	}
}

// Stopped while it waits to ask about its key again, the agent stops at once.
func TestNewAgentStopsWhileWaitingToAskAgain(t *testing.T) {
	buf := captureAgentLogs(t)
	withKeyVerificationRetries(t, time.Hour, time.Hour)
	srv, verifications := newVerifyingServer(t, 1000, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	})
	ctx, stop := context.WithCancel(context.Background())

	var ag *Agent
	took := returnsWithin(t, testGiveUpWithin, "NewAgent", func() {
		go func() {
			for verifications.Load() == 0 {
				time.Sleep(time.Millisecond)
			}
			stop()
		}()
		ag = NewAgent(ctx, testSecretKey, srv.URL, "")
	})

	if ag != nil {
		ag.Close()
		t.Fatal("NewAgent returned an agent although it was stopped before the key was verified")
	}
	if took > 10*time.Second {
		t.Errorf("NewAgent took %v to see that it was stopped", took)
	}
	if logs := buf.String(); !strings.Contains(logs, "The agent stopped before its secret key was verified") {
		t.Errorf("expected the stop to be logged, got:\n%s", logs)
	}
	assertStoppedQuietly(t, buf.String())
}

// OneUptime's refusal of the key is final: asking again gets the same answer,
// so the agent says the key is invalid and exits.
func TestNewAgentExitsWhenOneUptimeRefusesTheKey(t *testing.T) {
	srv, recorder := newRecordingAgentServer(t, http.StatusBadRequest, `{"error":"Monitor not found"}`)

	cmd := exec.Command(os.Args[0], "-test.run=^TestNewAgentExitHelperProcess$", "-test.v")
	cmd.Env = append(os.Environ(),
		newAgentExitGuardEnv+"=1",
		newAgentExitSecretEnv+"="+testSecretKey,
		newAgentExitURLEnv+"="+srv.URL,
		// Keep the child away from /var/log if anything reaches for the log file.
		"ONEUPTIME_AGENT_LOG_PATH="+filepath.Join(t.TempDir(), "agent.log"),
	)

	var output []byte
	var err error
	returnsWithin(t, testGiveUpWithin, "the agent", func() {
		output, err = cmd.CombinedOutput()
	})

	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("expected the agent to exit non-zero, got err=%v and output:\n%s", err, output)
	}
	if code := exitErr.ExitCode(); code != 1 {
		t.Errorf("exit code = %d, want 1\noutput:\n%s", code, output)
	}

	for _, want := range []string{"Secret key verification failed with status code 400", "Secret key is invalid"} {
		if !strings.Contains(string(output), want) {
			t.Errorf("expected the agent to log %q before exiting, got:\n%s", want, output)
		}
	}
	if strings.Contains(string(output), testSecretKey) {
		t.Errorf("secret key leaked to the agent's output:\n%s", output)
	}
	if got := len(recorder.all()); got != 1 {
		t.Errorf("the key was verified %d times, want once: a refusal is not asked about again", got)
	}
}

// A report to a server or proxy that never answers gives up after
// requestTimeout too. Without the deadline it would wait forever, and every
// 30 seconds another report would join it.
func TestCollectMetricsJobGivesUpOnAServerThatNeverAnswers(t *testing.T) {
	for _, route := range testRoutes {
		// No t.Parallel: captureAgentLogs and withRequestTimeout change package state.
		t.Run(route.name, func(t *testing.T) {
			buf := captureAgentLogs(t)
			withRequestTimeout(t, testStallTimeout)
			srv := newHoldingServer(t, nil)
			oneuptimeURL, proxyURL := agentURLsFor(srv, route.proxied)

			returnsWithin(t, testGiveUpWithin, "collectMetricsJob", func() {
				collectMetricsJob(context.Background(), testSecretKey, oneuptimeURL, proxyURL)
			})

			assertHeldThenAbandoned(t, srv, heldRequest{method: http.MethodPost, target: heldTarget(testIngestPath+testSecretKey, route.proxied)})

			logs := buf.String()
			lines := agentLogLinesContaining(logs, "Failed to send request to server")
			if len(lines) != 1 || !strings.Contains(lines[0], "Client.Timeout exceeded") {
				t.Errorf("expected the deadline to be logged once, as the report's error, got:\n%s", logs)
			}
			if strings.Contains(logs, "Metrics successfully pushed to OneUptime server") {
				t.Errorf("a report that was never answered was logged as pushed:\n%s", logs)
			}
			assertNoSecretInLogs(t, buf, testSecretKey)
		})
	}
}

// A server that refuses the report and never finishes saying why holds it as
// long as one that never answers: its answer is read under the same deadline.
func TestCollectMetricsJobGivesUpOnARefusalThatNeverEnds(t *testing.T) {
	buf := captureAgentLogs(t)
	withRequestTimeout(t, testStallTimeout)
	srv := newHoldingServer(t, func(w http.ResponseWriter) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = io.WriteString(w, "the start of an error message")
	})

	returnsWithin(t, testGiveUpWithin, "collectMetricsJob", func() {
		collectMetricsJob(context.Background(), testSecretKey, srv.URL, "")
	})

	assertHeldThenAbandoned(t, srv, heldRequest{method: http.MethodPost, target: testIngestPath + testSecretKey})

	logs := buf.String()
	if status := agentLogAttrValue(t, logs, "status_code"); status != strconv.Itoa(http.StatusServiceUnavailable) {
		t.Errorf("logged status_code = %q, want %d", status, http.StatusServiceUnavailable)
	}
	lines := agentLogLinesContaining(logs, "Failed to read error response body")
	if len(lines) != 1 || !strings.Contains(lines[0], "Client.Timeout") {
		t.Errorf("expected the deadline to be logged once, as the error reading the refusal, got:\n%s", logs)
	}
	assertNoSecretInLogs(t, buf, testSecretKey)
}

// The refusal's body goes into the log, so only its start is read: a server
// that answers with a body of any length cannot fill the agent's memory, or
// its log, with it.
func TestCollectMetricsJobLogsOnlyTheStartOfALongRefusal(t *testing.T) {
	buf := captureAgentLogs(t)
	const start = "the start of a long error message "
	srv, _ := newRecordingAgentServer(t, http.StatusBadGateway, start+strings.Repeat("x", 1<<20)+" and its end")

	collectMetricsJob(context.Background(), testSecretKey, srv.URL, "")

	logs := buf.String()
	body := agentLogAttrValue(t, logs, "body")
	if len(body) != maxLoggedResponseBody {
		t.Errorf("logged %d bytes of the refusal, want its first %d", len(body), maxLoggedResponseBody)
	}
	if !strings.HasPrefix(body, start) {
		t.Errorf("logged refusal %.80q..., want it to start with %q", body, start)
	}
	if strings.Contains(logs, "and its end") {
		t.Error("the end of a refusal longer than maxLoggedResponseBody was logged")
	}
}

// The verification's answer is closed once its status is read. A server that
// sends 200 and then keeps the rest of the answer coming would otherwise keep
// the connection open until requestTimeout - here, a minute.
func TestCheckIfSecretKeyIsValidClosesTheAnswer(t *testing.T) {
	captureAgentLogs(t)
	withRequestTimeout(t, time.Minute)
	srv := newHoldingServer(t, func(w http.ResponseWriter) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"status":`)
	})

	if !checkIfSecretKeyIsValid(context.Background(), testSecretKey, srv.URL, "") {
		t.Fatal("a verification answered with 200 must accept the key")
	}

	assertHeldThenAbandoned(t, srv, heldRequest{method: http.MethodGet, target: testVerifyPath + testSecretKey})
}

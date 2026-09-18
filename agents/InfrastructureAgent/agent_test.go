package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"oneuptime-infrastructure-agent/model"
	"oneuptime-infrastructure-agent/utils"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// The agent writes its logs to a world-readable file (see utils.GetLogPath and
// the 0666 mode in utils.SetDefaultLogger), so the monitor secret key must
// never reach the log sink - while still going out on the wire unchanged.
// These tests drive the real code paths against httptest servers and assert
// both halves of that: request unchanged, log redacted.

// testSecretKey is deliberately distinctive: it cannot collide with a hostname,
// a URL, a metric value or any other text the agent logs, so a plain substring
// match over the captured log is a reliable leak detector.
const testSecretKey = "s3cr3t-key-abcdef0123456789"

// The URL paths agent.go builds. They are unexported literals over there, so
// they are restated here on purpose: if a refactor changes either path, these
// tests fail and the change has to be a deliberate one.
const (
	testIngestPath = "/server-monitor/response/ingest/"
	testVerifyPath = "/server-monitor/secret-key/verify/"
)

// agentLogWriter serializes writes into buf. Code under test may log from a
// goroutine other than the test's (an http handler, the gocron scheduler) and
// bytes.Buffer is not safe for concurrent use.
type agentLogWriter struct {
	mu  sync.Mutex
	buf *bytes.Buffer
}

func (w *agentLogWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buf.Write(p)
}

// captureAgentLogs points the process-wide default slog logger at a buffer for
// the duration of the test and returns that buffer. It uses the same handler
// the agent uses in production (a TextHandler) so the captured bytes are
// exactly what would be appended to the log file.
//
// The previous default logger is restored via t.Cleanup. Callers must NOT use
// t.Parallel: slog's default logger is global process state. Callers must read
// the buffer only after the code under test has returned.
func captureAgentLogs(t *testing.T) *bytes.Buffer {
	t.Helper()

	buf := &bytes.Buffer{}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&agentLogWriter{buf: buf}, nil)))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})

	return buf
}

// assertNoSecretInLogs fails the test if secret appears anywhere in the
// captured log bytes, printing the offending lines and the whole log so a
// failure is actionable.
func assertNoSecretInLogs(t *testing.T, buf *bytes.Buffer, secret string) {
	t.Helper()

	if secret == "" {
		// An empty needle matches every log line, which would make this
		// assertion meaningless rather than strict.
		t.Fatal("assertNoSecretInLogs called with an empty secret")
	}

	logs := buf.String()
	if leaking := agentLogLinesContaining(logs, secret); len(leaking) > 0 {
		t.Fatalf("secret key %q leaked into %d log line(s):\n%s\nfull captured log:\n%s",
			secret, len(leaking), strings.Join(leaking, "\n"), logs)
	}
}

// agentLogLinesContaining returns every captured log line that contains needle.
func agentLogLinesContaining(logs string, needle string) []string {
	var matches []string
	for _, line := range strings.Split(logs, "\n") {
		if strings.Contains(line, needle) {
			matches = append(matches, line)
		}
	}
	return matches
}

// agentLogAttrValue returns the value of the first `key=` attribute in the
// captured TextHandler output, undoing slog's quoting when it applied any.
func agentLogAttrValue(t *testing.T, logs string, key string) string {
	t.Helper()

	for _, line := range strings.Split(logs, "\n") {
		index := strings.Index(line, " "+key+"=")
		if index < 0 {
			continue
		}

		rest := line[index+len(key)+2:]
		if strings.HasPrefix(rest, `"`) {
			quoted, err := strconv.QuotedPrefix(rest)
			if err != nil {
				t.Fatalf("attribute %q has an unterminated quoted value in log line: %s", key, line)
			}
			value, err := strconv.Unquote(quoted)
			if err != nil {
				t.Fatalf("could not unquote attribute %q in log line %s: %v", key, line, err)
			}
			return value
		}
		if space := strings.IndexByte(rest, ' '); space >= 0 {
			return rest[:space]
		}
		return rest
	}

	t.Fatalf("no %q attribute found in captured log:\n%s", key, logs)
	return ""
}

// agentSplitFinalSegment splits a URL into everything up to and including the
// last "/" and the final path segment after it.
func agentSplitFinalSegment(t *testing.T, rawURL string) (prefix string, final string) {
	t.Helper()

	slash := strings.LastIndex(rawURL, "/")
	if slash < 0 {
		t.Fatalf("expected %q to contain a path separator", rawURL)
	}
	return rawURL[:slash+1], rawURL[slash+1:]
}

type agentRecordedRequest struct {
	method  string
	path    string
	body    []byte
	readErr error
}

// agentRequestRecorder captures what the agent actually put on the wire.
type agentRequestRecorder struct {
	mu       sync.Mutex
	requests []agentRecordedRequest
}

func (r *agentRequestRecorder) add(req agentRecordedRequest) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.requests = append(r.requests, req)
}

func (r *agentRequestRecorder) all() []agentRecordedRequest {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]agentRecordedRequest(nil), r.requests...)
}

// only asserts that exactly one request reached the server and returns it.
func (r *agentRequestRecorder) only(t *testing.T) agentRecordedRequest {
	t.Helper()

	got := r.all()
	if len(got) != 1 {
		t.Fatalf("expected exactly 1 request to reach the test server, got %d: %+v", len(got), got)
	}
	if got[0].readErr != nil {
		t.Fatalf("test server could not read the request body: %v", got[0].readErr)
	}
	return got[0]
}

// newRecordingAgentServer starts a local server that records every request it
// receives and answers with the given status and body.
func newRecordingAgentServer(t *testing.T, status int, responseBody string) (*httptest.Server, *agentRequestRecorder) {
	t.Helper()

	recorder := &agentRequestRecorder{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The handler runs on its own goroutine, so it records failures
		// instead of calling t.Fatalf.
		body, err := io.ReadAll(r.Body)
		recorder.add(agentRecordedRequest{
			method:  r.Method,
			path:    r.URL.Path,
			body:    body,
			readErr: err,
		})
		w.WriteHeader(status)
		_, _ = io.WriteString(w, responseBody)
	}))
	t.Cleanup(srv.Close)

	return srv, recorder
}

// newDroppingAgentServer starts a local server that records the request it
// receives, then hijacks the connection and closes it without writing any
// response. client.Get / client.Post therefore fail with a *url.Error every
// time, deterministically.
//
// The obvious alternative - start a server, remember its URL, close it and
// count on the port being refused - is not deterministic. collectMetricsJob
// spends seconds inside utils.GetCpuMetrics (cpu.Percent samples for a full
// second) before it reaches client.Post, and for that whole window the freed
// ephemeral port belongs to nobody: any other process on the machine, or
// another package's httptest server under `go test ./...`, may bind it and
// answer the request. Hijacking keeps the port owned by this test from start
// to finish, so the transport error cannot be raced away.
func newDroppingAgentServer(t *testing.T) (*httptest.Server, *agentRequestRecorder) {
	t.Helper()

	recorder := &agentRequestRecorder{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The handler runs on its own goroutine, so it records failures
		// instead of calling t.Fatalf.
		body, err := io.ReadAll(r.Body)
		recorder.add(agentRecordedRequest{
			method:  r.Method,
			path:    r.URL.Path,
			body:    body,
			readErr: err,
		})

		hijacker, ok := w.(http.Hijacker)
		if !ok {
			// net/http's own ResponseWriter implements Hijacker. If that ever
			// stops being true this test must fail loudly rather than quietly
			// degrade into "the server answered 200", which would make the
			// no-leak assertion pass for the wrong reason.
			recorder.add(agentRecordedRequest{readErr: errors.New("ResponseWriter does not implement http.Hijacker, so the connection cannot be dropped")})
			return
		}
		conn, _, err := hijacker.Hijack()
		if err != nil {
			recorder.add(agentRecordedRequest{readErr: errors.New("could not hijack the connection: " + err.Error())})
			return
		}
		// Closing without a response byte is what turns the client's call into
		// a transport error.
		_ = conn.Close()
	}))
	t.Cleanup(srv.Close)

	return srv, recorder
}

// collectMetricsJob collects real CPU/disk/process metrics through syscalls,
// which costs several seconds per call - hence one call feeding three subtests
// rather than three top level tests.
func TestCollectMetricsJobSuccessPath(t *testing.T) {
	buf := captureAgentLogs(t)
	srv, recorder := newRecordingAgentServer(t, http.StatusOK, "")

	collectMetricsJob(testSecretKey, srv.URL, "")

	request := recorder.only(t)
	logs := buf.String()

	// (a) Behaviour must be unchanged by the redaction fix: the real secret is
	// still the final path segment of the ingest URL, and it is still the
	// secretKey of the JSON payload. Redacting the log must not redact the
	// request.
	t.Run("real secret still goes on the wire", func(t *testing.T) {
		if request.method != http.MethodPost {
			t.Errorf("expected a POST to the ingest endpoint, got %s", request.method)
		}
		if want := testIngestPath + testSecretKey; request.path != want {
			t.Fatalf("ingest path = %q, want %q (the real secret must still go on the wire)", request.path, want)
		}

		var payload struct {
			ServerMonitorResponse *model.ServerMonitorReport `json:"serverMonitorResponse"`
		}
		if err := json.Unmarshal(request.body, &payload); err != nil {
			t.Fatalf("request body is not valid JSON: %v\nbody: %s", err, request.body)
		}
		if payload.ServerMonitorResponse == nil {
			t.Fatalf("request body has no serverMonitorResponse object: %s", request.body)
		}
		if payload.ServerMonitorResponse.SecretKey != testSecretKey {
			t.Fatalf("serverMonitorResponse.secretKey = %q, want the real secret %q",
				payload.ServerMonitorResponse.SecretKey, testSecretKey)
		}
		// The metrics envelope is always constructed, even when individual
		// collectors return nil on a constrained CI box.
		if payload.ServerMonitorResponse.BasicInfrastructureMetrics == nil {
			t.Errorf("request body has no basicInfrastructureMetrics object: %s", request.body)
		}
	})

	// (b) The log must describe the same endpoint with the secret replaced.
	t.Run("logged endpoint is redacted", func(t *testing.T) {
		if !strings.Contains(logs, "Metrics successfully pushed to OneUptime server") {
			t.Fatalf("expected the 200 branch to be logged, got:\n%s", logs)
		}
		endpoint := agentLogAttrValue(t, logs, "endpoint")
		if !strings.Contains(endpoint, testIngestPath) {
			t.Errorf("logged endpoint %q does not contain the ingest path %q; the log must stay useful for debugging", endpoint, testIngestPath)
		}
		if !strings.Contains(endpoint, utils.RedactedPlaceholder) {
			t.Errorf("logged endpoint %q does not contain %q", endpoint, utils.RedactedPlaceholder)
		}
		if want := srv.URL + testIngestPath + utils.RedactedPlaceholder; endpoint != want {
			t.Errorf("logged endpoint = %q, want %q", endpoint, want)
		}

		assertNoSecretInLogs(t, buf, testSecretKey)
	})

	// The logged endpoint has to stay a faithful description of the requested
	// one, otherwise the redaction quietly turns the log into a lie. Requested
	// and logged URLs must be identical except for the final path segment.
	t.Run("logged endpoint differs from the requested URL only in the final segment", func(t *testing.T) {
		requestedPrefix, requestedFinal := agentSplitFinalSegment(t, srv.URL+request.path)
		loggedPrefix, loggedFinal := agentSplitFinalSegment(t, agentLogAttrValue(t, logs, "endpoint"))

		if requestedPrefix != loggedPrefix {
			t.Fatalf("logged endpoint diverges from the requested URL before the secret segment:\n requested %q\n logged    %q",
				requestedPrefix, loggedPrefix)
		}
		// Pin the ingest path itself, so a refactor that changes where metrics
		// are posted has to update this test too.
		if want := srv.URL + testIngestPath; requestedPrefix != want {
			t.Errorf("ingest prefix = %q, want %q", requestedPrefix, want)
		}
		if requestedFinal != testSecretKey {
			t.Errorf("final segment of the requested URL = %q, want the real secret %q", requestedFinal, testSecretKey)
		}
		if loggedFinal != utils.RedactedPlaceholder {
			t.Errorf("final segment of the logged endpoint = %q, want %q", loggedFinal, utils.RedactedPlaceholder)
		}
	})
}

func TestCollectMetricsJobServerErrorLogsNoSecret(t *testing.T) {
	buf := captureAgentLogs(t)
	// The error body is echoed into the log by the failure branch, so it is
	// chosen to carry no secret of its own.
	srv, recorder := newRecordingAgentServer(t, http.StatusInternalServerError, "monitor ingest failed")

	collectMetricsJob(testSecretKey, srv.URL, "")

	request := recorder.only(t)
	if want := testIngestPath + testSecretKey; request.path != want {
		t.Fatalf("ingest path = %q, want %q", request.path, want)
	}

	logs := buf.String()
	if !strings.Contains(logs, "Failed to ingest metrics") {
		t.Fatalf("expected the non-200 branch to be logged, got:\n%s", logs)
	}
	if status := agentLogAttrValue(t, logs, "status_code"); status != "500" {
		t.Errorf("logged status_code = %q, want %q", status, "500")
	}
	if !strings.Contains(logs, "monitor ingest failed") {
		t.Errorf("expected the server's error body to be logged, got:\n%s", logs)
	}

	assertNoSecretInLogs(t, buf, testSecretKey)
}

// A transport failure is a real leak channel: client.Post returns a *url.Error
// whose Error() string embeds the full request URL, secret path segment and
// all, so logging that error verbatim would write the monitor secret into the
// 0666 log file.
//
// It is also the leak likeliest to fire in practice, because it happens exactly
// when the agent cannot reach OneUptime - the failure an operator opens the log
// file to diagnose - and it repeats on every 30s scheduler tick. So
// collectMetricsJob redacts the error before logging it:
//
//	slog.Error("Failed to send request to server", "error",
//	    utils.RedactSecret(err.Error(), secretKey))
//
// The AST guard in logging_guard_test.go is blind to this call: the logging
// call names only `err`, with no secret-named identifier anywhere in it. This
// behavioural test is what holds the redaction in place, so its assertion has
// to stay executable. An earlier version called t.Skip when the secret turned
// up, which made the package report "ok" on a live disclosure and hid the SKIP
// line from CI (the workflow does not pass -v). A skipped security assertion is
// indistinguishable from no assertion at all: do not re-introduce the skip.
func TestCollectMetricsJobTransportErrorLogsNoSecret(t *testing.T) {
	buf := captureAgentLogs(t)
	srv, recorder := newDroppingAgentServer(t)

	collectMetricsJob(testSecretKey, srv.URL, "")

	// Redaction is a logging concern: the request must still be attempted with
	// the real secret on the error path too.
	request := recorder.only(t)
	if request.method != http.MethodPost {
		t.Errorf("expected a POST to the ingest endpoint, got %s", request.method)
	}
	if want := testIngestPath + testSecretKey; request.path != want {
		t.Fatalf("ingest path = %q, want %q (the real secret must still go on the wire)", request.path, want)
	}

	logs := buf.String()
	if !strings.Contains(logs, "Failed to send request to server") {
		t.Fatalf("expected the transport failure to be logged, got:\n%s", logs)
	}
	// The success branch must not have run: if the dropped connection were
	// somehow answered, the assertion below would be checking the wrong path.
	if strings.Contains(logs, "Metrics successfully pushed to OneUptime server") {
		t.Fatalf("the dropped connection was answered, so the transport-error path was never exercised:\n%s", logs)
	}

	assertNoSecretInLogs(t, buf, testSecretKey)
}

// The mirror image of the test above, for the other function that builds a
// secret-bearing URL. checkIfSecretKeyIsValid's client.Get failure carries the
// verify URL in its error text for the same reason, and agent.go redacts it the
// same way:
//
//	slog.Error(utils.RedactSecret(err.Error(), secretKey))
func TestCheckIfSecretKeyIsValidTransportErrorLogsNoSecret(t *testing.T) {
	buf := captureAgentLogs(t)
	srv, recorder := newDroppingAgentServer(t)

	if checkIfSecretKeyIsValid(testSecretKey, srv.URL, "") {
		t.Error("a key whose verification request never completed must not be treated as valid")
	}

	request := recorder.only(t)
	if request.method != http.MethodGet {
		t.Errorf("expected a GET to the verify endpoint, got %s", request.method)
	}
	if want := testVerifyPath + testSecretKey; request.path != want {
		t.Fatalf("verify path = %q, want %q (the real secret must still go on the wire)", request.path, want)
	}

	// The failure has no fixed message of its own (the error string *is* the
	// message today), so the presence of an error record is what proves the
	// transport-error branch ran rather than some earlier return.
	logs := buf.String()
	if !strings.Contains(logs, "level=ERROR") {
		t.Fatalf("expected the transport failure to be logged at ERROR, got:\n%s", logs)
	}

	assertNoSecretInLogs(t, buf, testSecretKey)
}

// checkIfSecretKeyIsValid builds a verify URL that contains the secret. On the
// HTTP-status paths exercised here that URL is not logged, and this table is
// what keeps it that way. It deliberately does NOT cover the transport-error
// path: every case below reaches a live server, so client.Get never returns an
// error and agent.go's redacted error log is never executed. That path is
// covered by TestCheckIfSecretKeyIsValidTransportErrorLogsNoSecret.
func TestCheckIfSecretKeyIsValid(t *testing.T) {
	cases := []struct {
		name   string
		status int
		want   bool
	}{
		{name: "200 accepts the key", status: http.StatusOK, want: true},
		{name: "401 rejects the key", status: http.StatusUnauthorized, want: false},
		{name: "500 rejects the key", status: http.StatusInternalServerError, want: false},
	}

	for _, tc := range cases {
		// No t.Parallel: captureAgentLogs swaps the global default logger.
		t.Run(tc.name, func(t *testing.T) {
			buf := captureAgentLogs(t)
			srv, recorder := newRecordingAgentServer(t, tc.status, "")

			if got := checkIfSecretKeyIsValid(testSecretKey, srv.URL, ""); got != tc.want {
				t.Errorf("checkIfSecretKeyIsValid() = %v for status %d, want %v", got, tc.status, tc.want)
			}

			request := recorder.only(t)
			if request.method != http.MethodGet {
				t.Errorf("expected a GET to the verify endpoint, got %s", request.method)
			}
			if want := testVerifyPath + testSecretKey; request.path != want {
				t.Errorf("verify path = %q, want %q (the real secret must still go on the wire)", request.path, want)
			}

			assertNoSecretInLogs(t, buf, testSecretKey)
		})
	}
}

func TestCheckIfSecretKeyIsValidEmptySecretShortCircuits(t *testing.T) {
	buf := captureAgentLogs(t)
	srv, recorder := newRecordingAgentServer(t, http.StatusOK, "")

	if checkIfSecretKeyIsValid("", srv.URL, "") {
		t.Error("an empty secret key must never be treated as valid")
	}
	// An empty key must be rejected locally: sending it would make the server
	// log a request for a bogus key.
	if got := len(recorder.all()); got != 0 {
		t.Errorf("expected no verify request for an empty secret, got %d", got)
	}
	if logs := buf.String(); !strings.Contains(logs, "Secret key is empty") {
		t.Errorf("expected the empty-secret rejection to be logged, got:\n%s", logs)
	}
	// Asserting the absence of testSecretKey here would be trivially true - it
	// is never passed in - so the checks above are the real assertions.
}

func TestNewAgentKeepsRealSecretAndLogsMaskedSecret(t *testing.T) {
	buf := captureAgentLogs(t)
	srv, recorder := newRecordingAgentServer(t, http.StatusOK, "")

	ag := NewAgent(testSecretKey, srv.URL, "")
	if ag == nil {
		t.Fatal("NewAgent returned nil for a valid configuration")
	}
	// Registered after captureAgentLogs, so cleanup order (LIFO) shuts the
	// scheduler down while the capturing logger is still installed.
	t.Cleanup(ag.Close)

	// The masking must not corrupt the configuration the agent runs with.
	if ag.SecretKey != testSecretKey {
		t.Errorf("agent.SecretKey = %q, want the real secret %q", ag.SecretKey, testSecretKey)
	}
	if ag.OneUptimeURL != srv.URL {
		t.Errorf("agent.OneUptimeURL = %q, want %q", ag.OneUptimeURL, srv.URL)
	}

	// NewAgent verifies the key, so the real secret must have gone on the wire.
	if want := testVerifyPath + testSecretKey; recorder.only(t).path != want {
		t.Errorf("verify path = %q, want %q", recorder.only(t).path, want)
	}

	logs := buf.String()
	want := "Secret key: " + utils.RedactedPlaceholder + " (" + strconv.Itoa(len(testSecretKey)) + " characters)"
	if !strings.Contains(logs, want) {
		t.Errorf("expected the startup banner to log %q, got:\n%s", want, logs)
	}

	assertNoSecretInLogs(t, buf, testSecretKey)
}

// newAgentExitGuardEnv marks the re-executed child process below. NewAgent
// calls os.Exit on its rejection paths, which would kill the test binary, so
// those paths are exercised in a subprocess.
const (
	newAgentExitGuardEnv  = "ONEUPTIME_AGENT_TEST_NEWAGENT_EXIT"
	newAgentExitSecretEnv = "ONEUPTIME_AGENT_TEST_NEWAGENT_SECRET"
)

// TestNewAgentExitHelperProcess is not a standalone test: it is the child
// process entry point for TestNewAgentMissingURLExitsWithoutLeakingSecret.
func TestNewAgentExitHelperProcess(t *testing.T) {
	if os.Getenv(newAgentExitGuardEnv) != "1" {
		t.Skip("helper process, only runs when re-executed by the parent test")
	}

	// A set secret with a missing URL: NewAgent logs the startup banner and
	// then calls os.Exit(1), so the line below is unreachable in the child.
	NewAgent(os.Getenv(newAgentExitSecretEnv), "", "")
	t.Fatal("NewAgent returned instead of exiting on an incomplete configuration")
}

func TestNewAgentMissingURLExitsWithoutLeakingSecret(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=^TestNewAgentExitHelperProcess$", "-test.v")
	cmd.Env = append(os.Environ(),
		newAgentExitGuardEnv+"=1",
		newAgentExitSecretEnv+"="+testSecretKey,
		// Keep the child away from /var/log if anything reaches for the log file.
		"ONEUPTIME_AGENT_LOG_PATH="+filepath.Join(t.TempDir(), "agent.log"),
	)

	output, err := cmd.CombinedOutput()

	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("expected the child to exit non-zero, got err=%v and output:\n%s", err, output)
	}
	if code := exitErr.ExitCode(); code != 1 {
		t.Errorf("child exit code = %d, want 1\noutput:\n%s", code, output)
	}

	banner := utils.RedactedPlaceholder + " (" + strconv.Itoa(len(testSecretKey)) + " characters)"
	if !strings.Contains(string(output), banner) {
		t.Errorf("expected the child to log %q before exiting, got:\n%s", banner, output)
	}
	// The rejection path logs the banner before it decides to exit, so it is
	// just as much a leak channel as the happy path.
	if strings.Contains(string(output), testSecretKey) {
		t.Errorf("secret key leaked to the child's output before os.Exit:\n%s", output)
	}
}

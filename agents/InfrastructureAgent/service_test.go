package main

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/kardianos/service"
)

// kardianos/service starts the agent with agentService.Start and stops it
// with agentService.Stop (main.go): when the service manager stops the
// service, and on Ctrl+C - or, outside Windows, SIGTERM - when the agent runs
// in a terminal. The process exits as soon as Stop returns, so Stop returns
// only once the agent has shut down: its scheduler stopped, and anything it
// was sending abandoned. Stop used to close a channel the agent ranged over,
// which ends the range without running its body, and return at once: under a
// service manager the agent was never shut down. These tests start the
// service against a local OneUptime, as kardianos/service does, and stop it.

// testStopWithin bounds how long a test waits for Stop. Stop waits for the
// metrics collector running, if one is - seconds at most - and is otherwise
// immediate; the rest is slack for a slow machine.
const testStopWithin = 15 * time.Second

// String returns what has been written so far.
func (w *agentLogWriter) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buf.String()
}

// startAgentService starts the agent against oneuptimeURL as kardianos/service
// does, and stops it when the test ends if the test has not.
func startAgentService(t *testing.T, oneuptimeURL string) *agentService {
	t.Helper()

	svc := &agentService{config: &ConfigFile{SecretKey: testSecretKey, OneUptimeURL: oneuptimeURL}}
	if err := svc.Start(nil); err != nil {
		t.Fatalf("Start returned an error: %v", err)
	}
	// Stopping the agent again once it has stopped returns at once.
	t.Cleanup(func() {
		stopAgentService(t, svc)
	})

	return svc
}

// stopAgentService calls Stop as kardianos/service does, failing the test
// when Stop does not return within testStopWithin.
func stopAgentService(t *testing.T, svc *agentService) {
	t.Helper()

	returnsWithin(t, testStopWithin, "Stop", func() {
		if err := svc.Stop(nil); err != nil {
			t.Errorf("Stop returned an error: %v", err)
		}
	})
}

// assertLoggedInOrder checks that logs has each of lines, each after the one
// before it.
func assertLoggedInOrder(t *testing.T, logs string, lines ...string) {
	t.Helper()

	rest := logs
	for _, line := range lines {
		index := strings.Index(rest, line)
		if index < 0 {
			t.Fatalf("expected the log to have %q in that order, but %q is missing or out of place:\n%s", lines, line, logs)
		}
		rest = rest[index+len(line):]
	}
}

// assertStoppedQuietly checks that stopping the agent logged nothing that
// says something failed: not the request it abandoned, not a key it took for
// refused, and not a scheduler that would not stop.
func assertStoppedQuietly(t *testing.T, logs string) {
	t.Helper()

	for _, failure := range []string{"Failed to send request to server", "Secret key is invalid", "gocron:"} {
		if strings.Contains(logs, failure) {
			t.Errorf("stopping the agent logged %q, as if something had failed:\n%s", failure, logs)
		}
	}
}

// Stopped while it sends its first report - which the server holds - the
// agent abandons the report, waits for it and for its scheduler to stop, and
// only then does Stop return.
func TestStopShutsTheAgentDownBeforeItReturns(t *testing.T) {
	buf := captureAgentLogs(t)
	srv := newHoldingServer(t, nil, testVerifyPath)
	svc := startAgentService(t, srv.URL)

	// The agent reports as soon as it starts, after collecting metrics.
	report := nextHeldRequest(t, srv.held, testGiveUpWithin, "the agent sent no report")
	if want := (heldRequest{method: http.MethodPost, target: testIngestPath + testSecretKey}); report != want {
		t.Fatalf("the server held %+v, want %+v", report, want)
	}

	stopAgentService(t, svc)

	// Read as Stop returns: everything it waited for has been logged.
	logs := buf.String()
	assertLoggedInOrder(t, logs,
		"Service Exiting...",
		"The agent stopped before the metrics were sent",
		"Agent stopped",
	)
	assertStoppedQuietly(t, logs)

	if got := nextHeldRequest(t, srv.abandoned, testAbandonedWithin, "the agent never let go of the report it was sending"); got != report {
		t.Errorf("the agent let go of %+v, want %+v", got, report)
	}
	assertNoSecretInLogs(t, buf, testSecretKey)
}

// Stopped while the server holds its key's verification, the agent abandons
// the verification and Stop returns, without the agent starting to report -
// and without it taking the stop for a key the server refused, which would
// exit the process.
func TestStopAbandonsTheKeysVerification(t *testing.T) {
	buf := captureAgentLogs(t)
	srv := newHoldingServer(t, nil)
	svc := startAgentService(t, srv.URL)

	verification := nextHeldRequest(t, srv.held, testGiveUpWithin, "the agent never asked to verify its key")
	if want := (heldRequest{method: http.MethodGet, target: testVerifyPath + testSecretKey}); verification != want {
		t.Fatalf("the server held %+v, want %+v", verification, want)
	}

	stopAgentService(t, svc)

	logs := buf.String()
	if !strings.Contains(logs, "The agent stopped before its secret key was verified") {
		t.Errorf("expected the stop to be logged, got:\n%s", logs)
	}
	assertStoppedQuietly(t, logs)

	if got := nextHeldRequest(t, srv.abandoned, testAbandonedWithin, "the agent never let go of the verification"); got != verification {
		t.Errorf("the agent let go of %+v, want %+v", got, verification)
	}
	select {
	case request := <-srv.held:
		t.Errorf("the agent sent %+v after it was stopped", request)
	default:
	}
	assertNoSecretInLogs(t, buf, testSecretKey)
}

// Stop can come at any moment of the agent's start: before its key's
// verification is sent, while it is, or once the scheduler has started and
// the first report is being collected. Whenever it comes, Stop returns, the
// process is not exited, no report is sent, and a second Stop returns too.
func TestStopAtAnyMomentOfTheStart(t *testing.T) {
	for _, delay := range []time.Duration{0, time.Millisecond, 10 * time.Millisecond, 300 * time.Millisecond} {
		// No t.Parallel: captureAgentLogs changes package state.
		t.Run("after "+delay.String(), func(t *testing.T) {
			buf := captureAgentLogs(t)
			srv, recorder := newRecordingAgentServer(t, http.StatusOK, "")
			svc := startAgentService(t, srv.URL)

			time.Sleep(delay)
			stopAgentService(t, svc)
			stopAgentService(t, svc)

			for _, request := range recorder.all() {
				if strings.HasPrefix(request.path, testIngestPath) {
					t.Errorf("the agent sent a report although it was stopped before the report was collected: %+v", request)
				}
			}
			assertStoppedQuietly(t, buf.String())
		})
	}
}

// A report the agent has stopped is collected no further and not sent, and
// the log says so without calling it an error.
func TestCollectMetricsJobSendsNothingOnceTheAgentHasStopped(t *testing.T) {
	buf := captureAgentLogs(t)
	srv, recorder := newRecordingAgentServer(t, http.StatusOK, "")
	stopped, stop := context.WithCancel(context.Background())
	stop()

	took := returnsWithin(t, testStopWithin, "collectMetricsJob", func() {
		collectMetricsJob(stopped, testSecretKey, srv.URL, "")
	})

	// The CPU collector alone samples for a second, so a job that took that
	// long went on collecting after the agent had stopped.
	if took >= time.Second {
		t.Errorf("collectMetricsJob took %v once the agent had stopped, want it to stop collecting", took)
	}
	if got := recorder.all(); len(got) != 0 {
		t.Errorf("the stopped agent sent %d request(s): %+v", len(got), got)
	}
	logs := buf.String()
	if lines := agentLogLinesContaining(logs, "The agent stopped before the metrics were sent"); len(lines) != 1 || !strings.Contains(lines[0], "level=INFO") {
		t.Errorf("expected the stop to be logged once, at INFO, got:\n%s", logs)
	}
	assertStoppedQuietly(t, logs)
}

// Stopped before its key is verified, NewAgent sends nothing and returns nil:
// it neither makes an agent nor exits the process, as it would for a key the
// server refused.
func TestNewAgentReturnsNilOnceTheAgentHasStopped(t *testing.T) {
	buf := captureAgentLogs(t)
	srv, recorder := newRecordingAgentServer(t, http.StatusOK, "")
	stopped, stop := context.WithCancel(context.Background())
	stop()

	if ag := NewAgent(stopped, testSecretKey, srv.URL, ""); ag != nil {
		ag.Close()
		t.Fatal("NewAgent made an agent although it had been stopped")
	}

	if got := recorder.all(); len(got) != 0 {
		t.Errorf("the stopped agent sent %d request(s): %+v", len(got), got)
	}
	logs := buf.String()
	if lines := agentLogLinesContaining(logs, "The agent stopped before its secret key was verified"); len(lines) != 1 || !strings.Contains(lines[0], "level=INFO") {
		t.Errorf("expected the stop to be logged once, at INFO, got:\n%s", logs)
	}
	if strings.Contains(logs, "level=ERROR") {
		t.Errorf("stopping the agent before its key was verified logged an error:\n%s", logs)
	}
	assertNoSecretInLogs(t, buf, testSecretKey)
}

// agentServiceRunEnv marks the re-executed child process below, and
// agentServiceRunURLEnv is the OneUptime URL it runs the agent against.
const (
	agentServiceRunEnv    = "ONEUPTIME_AGENT_TEST_SERVICE_RUN"
	agentServiceRunURLEnv = "ONEUPTIME_AGENT_TEST_SERVICE_RUN_URL"
)

// TestAgentServiceRunHelperProcess is not a standalone test: it is the child
// process of TestASignalStopsTheAgentOnceItHasShutDown. It runs the agent
// under kardianos/service, as the agent's "run" command does.
func TestAgentServiceRunHelperProcess(t *testing.T) {
	if os.Getenv(agentServiceRunEnv) != "1" {
		t.Skip("helper process, only runs when re-executed by the parent test")
	}

	svc := &agentService{config: &ConfigFile{SecretKey: testSecretKey, OneUptimeURL: os.Getenv(agentServiceRunURLEnv)}}
	s, err := service.New(svc, &service.Config{Name: "oneuptime-infrastructure-agent-test"})
	if err != nil {
		t.Fatalf("could not make the service: %v", err)
	}
	// Run starts the agent, waits for SIGINT or SIGTERM, calls Stop and
	// returns.
	if err := s.Run(); err != nil {
		t.Fatalf("Run returned an error: %v", err)
	}
	slog.Info("Run returned")
}

// Ctrl+C stops the agent in a terminal, and systemd and launchd stop the
// service with SIGTERM. kardianos/service's Run calls Stop for either and
// returns, and the process exits: the agent must have shut down by then. The
// agent used to catch these signals in a terminal with a handler of its own,
// which raced the process's exit, and under a service manager not at all.
func TestASignalStopsTheAgentOnceItHasShutDown(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("a signal cannot be sent to a process on Windows; the Service Control Manager stops the agent there, through the same Stop")
	}

	for _, sig := range []os.Signal{os.Interrupt, syscall.SIGTERM} {
		t.Run(sig.String(), func(t *testing.T) {
			srv := newHoldingServer(t, nil, testVerifyPath)

			output := &agentLogWriter{buf: &bytes.Buffer{}}
			cmd := exec.Command(os.Args[0], "-test.run=^TestAgentServiceRunHelperProcess$", "-test.v")
			cmd.Env = append(os.Environ(),
				agentServiceRunEnv+"=1",
				agentServiceRunURLEnv+"="+srv.URL,
				// Keep the child away from /var/log if anything reaches for the log file.
				"ONEUPTIME_AGENT_LOG_PATH="+filepath.Join(t.TempDir(), "agent.log"),
			)
			cmd.Stdout = output
			cmd.Stderr = output
			if err := cmd.Start(); err != nil {
				t.Fatalf("could not start the agent: %v", err)
			}

			var exitErr error
			exited := make(chan struct{})
			go func() {
				exitErr = cmd.Wait()
				close(exited)
			}()
			t.Cleanup(func() {
				_ = cmd.Process.Kill()
				<-exited
			})

			// The agent reports as soon as it starts, and by then Run is
			// waiting for the signal.
			report := nextHeldRequest(t, srv.held, testGiveUpWithin, "the agent sent no report")

			if err := cmd.Process.Signal(sig); err != nil {
				t.Fatalf("could not send %v to the agent: %v", sig, err)
			}

			select {
			case <-exited:
			case <-time.After(testStopWithin):
				t.Fatalf("the agent had not exited %v after %v:\n%s", testStopWithin, sig, output.String())
			}

			logs := output.String()
			if exitErr != nil {
				t.Fatalf("the agent exited with %v after %v:\n%s", exitErr, sig, logs)
			}
			assertLoggedInOrder(t, logs,
				"Service Exiting...",
				"The agent stopped before the metrics were sent",
				"Agent stopped",
				"Run returned",
			)
			assertStoppedQuietly(t, logs)
			if strings.Contains(logs, testSecretKey) {
				t.Errorf("secret key leaked to the agent's output:\n%s", logs)
			}

			if got := nextHeldRequest(t, srv.abandoned, testAbandonedWithin, "the agent never let go of the report it was sending"); got != report {
				t.Errorf("the agent let go of %+v, want %+v", got, report)
			}
		})
	}
}

package main

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The commands people run - configure, start, status and the others - say
// what happened on the terminal. Their messages used to go only to the log
// file, so `status` printed nothing and a `configure` or `start` that failed
// failed silently.

// mainHelperArgsEnv marks the re-executed child process below and holds the
// command line it runs main with, one argument per line.
const mainHelperArgsEnv = "ONEUPTIME_AGENT_TEST_MAIN_ARGS"

// TestMainHelperProcess is not a standalone test: it is the child process
// runCommand starts, which runs the agent's main with the command line it is
// given.
func TestMainHelperProcess(t *testing.T) {
	args := os.Getenv(mainHelperArgsEnv)
	if args == "" {
		t.Skip("helper process, only runs when re-executed by the parent test")
	}

	os.Args = append([]string{"oneuptime-infrastructure-agent"}, strings.Split(args, "\n")...)
	main()
	os.Exit(0)
}

// commandRun is what a command printed, where it logged, and how it exited.
type commandRun struct {
	stdout   string
	stderr   string
	log      string
	exitCode int
}

// runCommand runs the agent with args in a child process whose configuration
// and log files are in a fresh directory, where no configuration has been
// saved.
func runCommand(t *testing.T, args ...string) commandRun {
	t.Helper()

	dir := t.TempDir()
	logPath := filepath.Join(dir, "agent.log")

	cmd := exec.Command(os.Args[0], "-test.run=^TestMainHelperProcess$")
	cmd.Env = append(os.Environ(),
		mainHelperArgsEnv+"="+strings.Join(args, "\n"),
		"ONEUPTIME_AGENT_CONFIG_PATH="+filepath.Join(dir, "config.json"),
		"ONEUPTIME_AGENT_LOG_PATH="+logPath,
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	var err error
	returnsWithin(t, testGiveUpWithin, "the command", func() {
		err = cmd.Run()
	})

	run := commandRun{stdout: stdout.String(), stderr: stderr.String()}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		run.exitCode = exitErr.ExitCode()
	} else if err != nil {
		t.Fatalf("could not run the command: %v", err)
	}
	if log, readErr := os.ReadFile(logPath); readErr == nil {
		run.log = string(log)
	}
	return run
}

func TestCommandsPrintWhyTheyFailed(t *testing.T) {
	cases := []struct {
		name    string
		args    []string
		message string
	}{
		{
			name:    "configure without its flags",
			args:    []string{"configure"},
			message: "The --secret-key and --oneuptime-url flags are required for the 'configure' command",
		},
		{
			name:    "start before configure",
			args:    []string{"start"},
			message: "Service configuration not found. Please run 'oneuptime-infrastructure-agent configure' to configure the service.",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			run := runCommand(t, c.args...)

			if run.exitCode != 2 {
				t.Errorf("exit code = %d, want 2\nstdout:\n%s\nstderr:\n%s", run.exitCode, run.stdout, run.stderr)
			}
			if !strings.Contains(run.stderr, "Error: "+c.message+"\n") {
				t.Errorf("the terminal was not told why the command failed. stderr:\n%s\nstdout:\n%s", run.stderr, run.stdout)
			}
			if !strings.Contains(run.log, c.message) {
				t.Errorf("the log file does not have the failure either:\n%s", run.log)
			}
			if strings.Contains(run.stdout+run.stderr, "level=") {
				t.Errorf("the terminal got the log file's lines rather than plain ones:\n%s%s", run.stdout, run.stderr)
			}
		})
	}
}

// The service itself writes to its log file only, unless it runs in a
// terminal; every command echoes its lines to the terminal.
func TestEchoesToTerminal(t *testing.T) {
	cases := []struct {
		args        []string
		interactive bool
		want        bool
	}{
		{args: []string{"agent"}, interactive: true, want: false},
		{args: []string{"agent", "status"}, interactive: false, want: true},
		{args: []string{"agent", "configure", "--secret-key=x"}, interactive: true, want: true},
		{args: []string{"agent", "start"}, interactive: true, want: true},
		{args: []string{"agent", "run"}, interactive: false, want: false},
		{args: []string{"agent", "run"}, interactive: true, want: true},
	}

	for _, c := range cases {
		if got := echoesToTerminal(c.args, c.interactive); got != c.want {
			t.Errorf("echoesToTerminal(%q, interactive=%v) = %v, want %v", c.args, c.interactive, got, c.want)
		}
	}
}

// Windows starts a service that fails again only when it is told to. The
// agent's service had no recovery action, so one that stopped on a failure
// stayed stopped; it now restarts after a failure, as systemd restarts it on
// Linux (RestartSec=120).
func TestTheServiceRestartsAfterAFailure(t *testing.T) {
	config := newServiceConfig()

	if got := config.Option["OnFailure"]; got != "restart" {
		t.Errorf("OnFailure = %v, want restart", got)
	}
	delay, ok := config.Option["OnFailureDelayDuration"].(string)
	if !ok {
		t.Fatalf("OnFailureDelayDuration = %v, want a duration", config.Option["OnFailureDelayDuration"])
	}
	if parsed, err := time.ParseDuration(delay); err != nil || parsed != 2*time.Minute {
		t.Errorf("OnFailureDelayDuration = %q (%v), want 2m", delay, err)
	}
	if config.Name != "oneuptime-infrastructure-agent" || strings.Join(config.Arguments, " ") != "run" {
		t.Errorf("the service is %q running %q, want oneuptime-infrastructure-agent running run", config.Name, config.Arguments)
	}
}

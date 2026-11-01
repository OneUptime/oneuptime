package utils

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

// A command's log lines reach the terminal as well as the log file, so the
// person who ran it sees its result: `status` printed nothing, because the log
// went only to the file.
//
// No t.Parallel: slog's default logger is process-wide.
func TestEchoToTerminalPrintsWhatACommandLogs(t *testing.T) {
	previous := slog.Default()
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})

	var file, stdout, stderr bytes.Buffer
	slog.SetDefault(slog.New(slog.NewTextHandler(&file, nil)))

	EchoToTerminal(&stdout, &stderr)

	slog.Info("Service is running")
	slog.Warn("Some disk partitions could not be read", "drives", []string{"E:"})
	slog.Error("Failed to configure service", "error", "Access is denied.")
	slog.Debug("not for the terminal")
	slog.Default().With("source", "usage").WithGroup("disk").Info("Disk collection problem resolved", "path", "/data")

	if got, want := stdout.String(), "Service is running\nDisk collection problem resolved source=usage disk.path=/data\n"; got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
	if got, want := stderr.String(), "Warning: Some disk partitions could not be read drives=[E:]\nError: Failed to configure service error=Access is denied.\n"; got != want {
		t.Errorf("stderr = %q, want %q", got, want)
	}

	// The log file still gets every line, as it did.
	for _, line := range []string{
		`level=INFO msg="Service is running"`,
		`level=WARN msg="Some disk partitions could not be read"`,
		`level=ERROR msg="Failed to configure service" error="Access is denied."`,
		`level=INFO msg="Disk collection problem resolved" source=usage disk.path=/data`,
	} {
		if !strings.Contains(file.String(), line) {
			t.Errorf("the log file does not have %q:\n%s", line, file.String())
		}
	}
}

// When the log file could not be opened, the log is on the terminal already,
// and is not printed twice.
func TestEchoToTerminalLeavesALogOnTheTerminalAlone(t *testing.T) {
	previous := slog.Default()
	t.Cleanup(func() {
		slog.SetDefault(previous)
		logsToStdout = false
	})

	var terminal, stdout, stderr bytes.Buffer
	slog.SetDefault(slog.New(slog.NewTextHandler(&terminal, nil)))
	logsToStdout = true

	EchoToTerminal(&stdout, &stderr)
	slog.Info("Service is running")

	if stdout.Len() != 0 || stderr.Len() != 0 {
		t.Errorf("printed %q and %q besides the log", stdout.String(), stderr.String())
	}
	if !strings.Contains(terminal.String(), "Service is running") {
		t.Errorf("the log lost the line: %q", terminal.String())
	}
}

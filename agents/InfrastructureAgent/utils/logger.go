package utils

import (
	"context"
	"fmt"
	"io"
	slog "log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// logsToStdout is set when the log file could not be opened and the log is
// written to the terminal instead.
var logsToStdout bool

func SetDefaultLogger() {
	logPath := GetLogPath()
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)

	if err != nil {
		slog.Default().Error("Failed to open log file", "error", err)
		// If we can't open the log file, we'll log to the console instead
		logFile = os.Stdout
		logsToStdout = true
	}

	//defer logFile.Close()

	logger := slog.New(slog.NewTextHandler(logFile, nil))
	slog.SetDefault(logger)
}

// EchoToTerminal writes what the agent logs to the terminal as well as to its
// log file, as plain lines - the message, then its attributes - so the result
// of a command reaches whoever ran it: `status` says whether the service is
// running, and a `configure` or `start` that fails says why. They used to say
// nothing, because the log went only to the file. Errors and warnings go to
// stderr, the rest to stdout.
func EchoToTerminal(stdout io.Writer, stderr io.Writer) {
	if logsToStdout {
		// The whole log is on the terminal already.
		return
	}

	slog.SetDefault(slog.New(&teeHandler{handlers: []slog.Handler{
		slog.Default().Handler(),
		&terminalHandler{mu: &sync.Mutex{}, stdout: stdout, stderr: stderr},
	}}))
}

// teeHandler hands every record to each of its handlers.
type teeHandler struct {
	handlers []slog.Handler
}

func (h *teeHandler) Enabled(ctx context.Context, level slog.Level) bool {
	for _, handler := range h.handlers {
		if handler.Enabled(ctx, level) {
			return true
		}
	}
	return false
}

func (h *teeHandler) Handle(ctx context.Context, record slog.Record) error {
	var firstErr error
	for _, handler := range h.handlers {
		if !handler.Enabled(ctx, record.Level) {
			continue
		}
		if err := handler.Handle(ctx, record.Clone()); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (h *teeHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	handlers := make([]slog.Handler, 0, len(h.handlers))
	for _, handler := range h.handlers {
		handlers = append(handlers, handler.WithAttrs(attrs))
	}
	return &teeHandler{handlers: handlers}
}

func (h *teeHandler) WithGroup(name string) slog.Handler {
	handlers := make([]slog.Handler, 0, len(h.handlers))
	for _, handler := range h.handlers {
		handlers = append(handlers, handler.WithGroup(name))
	}
	return &teeHandler{handlers: handlers}
}

// terminalHandler writes each record of Info and above as one line for a
// person to read: "Service is running", "Error: <message> error=<error>".
type terminalHandler struct {
	mu     *sync.Mutex
	stdout io.Writer
	stderr io.Writer
	attrs  []slog.Attr
	group  string
}

func (h *terminalHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= slog.LevelInfo
}

func (h *terminalHandler) Handle(_ context.Context, record slog.Record) error {
	var line strings.Builder
	out := h.stdout

	switch {
	case record.Level >= slog.LevelError:
		line.WriteString("Error: ")
		out = h.stderr
	case record.Level >= slog.LevelWarn:
		line.WriteString("Warning: ")
		out = h.stderr
	}
	line.WriteString(record.Message)

	for _, attr := range h.attrs {
		writeTerminalAttr(&line, "", attr)
	}
	record.Attrs(func(attr slog.Attr) bool {
		writeTerminalAttr(&line, h.group, attr)
		return true
	})
	line.WriteString("\n")

	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := io.WriteString(out, line.String())
	return err
}

// writeTerminalAttr adds " key=value" to line, the key under its group.
func writeTerminalAttr(line *strings.Builder, group string, attr slog.Attr) {
	attr.Value = attr.Value.Resolve()
	if attr.Equal(slog.Attr{}) {
		return
	}

	key := attr.Key
	if group != "" {
		key = group + "." + key
	}

	if attr.Value.Kind() == slog.KindGroup {
		for _, member := range attr.Value.Group() {
			writeTerminalAttr(line, key, member)
		}
		return
	}

	line.WriteString(" " + key + "=" + attr.Value.String())
}

func (h *terminalHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	grouped := make([]slog.Attr, 0, len(h.attrs)+len(attrs))
	grouped = append(grouped, h.attrs...)
	for _, attr := range attrs {
		if h.group != "" {
			attr.Key = h.group + "." + attr.Key
		}
		grouped = append(grouped, attr)
	}
	return &terminalHandler{mu: h.mu, stdout: h.stdout, stderr: h.stderr, attrs: grouped, group: h.group}
}

func (h *terminalHandler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	group := name
	if h.group != "" {
		group = h.group + "." + name
	}
	return &terminalHandler{mu: h.mu, stdout: h.stdout, stderr: h.stderr, attrs: h.attrs, group: group}
}

// GetLogPath returns the full path to the log file.
//
// Supports an override via ONEUPTIME_AGENT_LOG_PATH. When unset, uses the
// system log dir and falls back to $HOME/.oneuptime-infrastructure-agent
// when that dir is not writable (unprivileged local testing).
func GetLogPath() string {
	if override := os.Getenv("ONEUPTIME_AGENT_LOG_PATH"); override != "" {
		return override
	}

	var basePath string
	if runtime.GOOS == "windows" {
		basePath = os.Getenv("PROGRAMDATA")
		if basePath == "" {
			basePath = fmt.Sprintf("C:%sProgramData", string(filepath.Separator))
		}
	} else {
		basePath = "/var/log"
	}

	logDirectory := filepath.Join(basePath, "oneuptime-infrastructure-agent")

	// If the system dir isn't writable by us (missing or root-owned), fall
	// back to $HOME so the agent can log while running unprivileged.
	if err := ensureDir(logDirectory); err != nil || !isDirWritable(logDirectory) {
		if home, herr := os.UserHomeDir(); herr == nil {
			logDirectory = filepath.Join(home, ".oneuptime-infrastructure-agent")
			if ferr := ensureDir(logDirectory); ferr != nil {
				slog.Default().Error("Failed to create log directory, falling back to current directory", "error", ferr)
				return "oneuptime-infrastructure-agent.log"
			}
		} else {
			slog.Default().Error("Failed to create log directory, falling back to current directory", "error", err)
			return "oneuptime-infrastructure-agent.log"
		}
	}

	return filepath.Join(logDirectory, "oneuptime-infrastructure-agent.log")
}

// isDirWritable probes whether the current process can create files in dir.
func isDirWritable(dir string) bool {
	probe, err := os.CreateTemp(dir, ".oneuptime-agent-write-check-")
	if err != nil {
		return false
	}
	probePath := probe.Name()
	_ = probe.Close()
	_ = os.Remove(probePath)
	return true
}

// ensureDir checks if a directory exists and makes it if it does not
func ensureDir(dirName string) error {
	info, err := os.Stat(dirName)
	if os.IsNotExist(err) {
		// Directory does not exist, create it
		return os.MkdirAll(dirName, 0755)
	}
	if err != nil {
		return err
	}
	if !info.IsDir() {
		// Exists but is not a directory
		return os.ErrExist
	}
	return nil
}

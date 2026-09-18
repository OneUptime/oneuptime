package utils

import (
	"fmt"
	slog "log/slog"
	"os"
	"path/filepath"
	"runtime"
)

func SetDefaultLogger() {
	logPath := GetLogPath()
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)

	if err != nil {
		slog.Default().Error("Failed to open log file", "error", err)
		// If we can't open the log file, we'll log to the console instead
		logFile = os.Stdout
	}

	//defer logFile.Close()

	logger := slog.New(slog.NewTextHandler(logFile, nil))
	slog.SetDefault(logger)
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

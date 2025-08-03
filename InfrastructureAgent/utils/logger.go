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

// GetLogPath returns the full path to the log file
func GetLogPath() string {
	var basePath string
	if runtime.GOOS == "windows" {
		basePath = os.Getenv("PROGRAMDATA")
		if basePath == "" {
			basePath = fmt.Sprintf("C:%sProgramData", string(filepath.Separator))
		}
	} else {
		basePath = "/var/log"
	}

	// Define the directory path where the log file will be stored
	logDirectory := filepath.Join(basePath, "oneuptime-infrastructure-agent")

	// Ensure the directory exists
	err := ensureDir(logDirectory)
	if err != nil {
		slog.Default().Error("Failed to create log directory, falling back to current directory", "error", err)
		return "oneuptime-infrastructure-agent.log"
	}

	// Return the full path to the log file
	return filepath.Join(logDirectory, "oneuptime-infrastructure-agent.log")
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

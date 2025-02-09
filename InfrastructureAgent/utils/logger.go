package utils

import (
	slog "log/slog"
	"os"
)

func SetDefaultLogger() {
	logFile, err := os.OpenFile("output.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)

	if err != nil {
		slog.Default().Error("Failed to open log file", "error", err)
		// If we can't open the log file, we'll log to the console instead
		logFile = os.Stdout
	}

	//defer logFile.Close()

	logger := slog.New(slog.NewTextHandler(logFile, nil))
	slog.SetDefault(logger)
}

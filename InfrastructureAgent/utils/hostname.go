package utils

import (
	"log/slog"
	"os"
)

func GetHostname() string {
	hostname, err := os.Hostname()
	if err != nil {
		slog.Error("Failed to fetch hostname", err)
		return ""
	}

	return hostname
}

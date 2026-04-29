package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"

	"github.com/gookit/config/v2"
)

type ConfigFile struct {
	SecretKey     string `json:"secret_key"`
	OneUptimeURL  string `json:"oneuptime_url"`
	ProxyURL      string `json:"proxy_url"`
	ProxyPort     string `json:"proxy_port"`
	ProxyUsername string `json:"proxy_username"`
	ProxyPassword string `json:"proxy_password"`
}

func newConfigFile() *ConfigFile {
	return &ConfigFile{
		SecretKey:    "",
		OneUptimeURL: "",
	}
}

func (c *ConfigFile) loadConfig() error {
	cfg := &ConfigFile{}
	err := config.LoadFiles(c.configPath())
	if err != nil {
		return err
	}
	err = config.BindStruct("", cfg)
	if err != nil {
		return err
	}
	c.SecretKey = cfg.SecretKey
	c.OneUptimeURL = cfg.OneUptimeURL
	c.ProxyURL = cfg.ProxyURL
	return nil
}

func (c *ConfigFile) save(secretKey string, oneuptimeUrl string, proxyUrl string) error {
	err := c.loadConfig()
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	err = config.Set("secret_key", secretKey)
	if err != nil {
		return err
	}
	err = config.Set("oneuptime_url", oneuptimeUrl)
	if err != nil {
		return err
	}

	err = config.Set("proxy_url", proxyUrl)
	if err != nil {
		return err
	}

	// Open the file with os.Create, which truncates the file if it already exists,
	// and creates it if it doesn't.
	slog.Info("Saving configuration to file to path: " + c.configPath())
	file, err := os.Create(c.configPath())
	if err != nil {
		return err
	}
	defer file.Close()
	// Create a JSON encoder that writes to the file, and use Encode method
	// which will write the map to the file in JSON format.
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "    ") // Optional: makes the output more readable
	slog.Info("Configuration File Saved")
	return encoder.Encode(config.Data())
}

// removeConfigFile deletes the configuration file.
func (c *ConfigFile) removeConfigFile() error {

	// Check if the file exists before attempting to remove it.
	if _, err := os.Stat(c.configPath()); os.IsNotExist(err) {
		// File does not exist, return an error or handle it accordingly.
		return os.ErrNotExist
	}

	// Remove the file.
	err := os.Remove(c.configPath())
	if err != nil {
		// Handle potential errors in deleting the file.
		return err
	}

	return nil
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

// ensureDir checks if a directory exists and makes it if it does not.
func (c *ConfigFile) ensureDir(dirName string) error {
	// Check if the directory exists
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

// configPath returns the full path to the configuration file,
// ensuring the directory exists or creating it if it does not.
//
// An explicit path can be supplied via the ONEUPTIME_AGENT_CONFIG_PATH
// env var. When unset, the agent uses the system-wide default
// (/etc/... on Unix, %PROGRAMDATA%\... on Windows) and falls back to
// $HOME/.oneuptime-infrastructure-agent/ when the system path is not
// writable (e.g. unprivileged local testing).
func (c *ConfigFile) configPath() string {
	if override := os.Getenv("ONEUPTIME_AGENT_CONFIG_PATH"); override != "" {
		return override
	}

	var basePath string
	if runtime.GOOS == "windows" {
		basePath = os.Getenv("PROGRAMDATA")
		if basePath == "" {
			basePath = fmt.Sprintf("C:%sProgramData", string(filepath.Separator))
		}
	} else {
		basePath = fmt.Sprintf("%setc", string(filepath.Separator))
	}

	configDirectory := filepath.Join(basePath, "oneuptime-infrastructure-agent")

	// If the system dir isn't usable (missing or not writable by us, e.g. the
	// directory was created by a prior root install), fall back to $HOME so
	// an unprivileged user can still run the agent locally.
	if err := c.ensureDir(configDirectory); err != nil || !isDirWritable(configDirectory) {
		if home, herr := os.UserHomeDir(); herr == nil {
			configDirectory = filepath.Join(home, ".oneuptime-infrastructure-agent")
			if ferr := c.ensureDir(configDirectory); ferr != nil {
				slog.Error("Failed to create config directory", "error", ferr)
			}
		} else {
			slog.Error("Failed to create config directory", "error", err)
		}
	}

	return filepath.Join(configDirectory, "config.json")
}

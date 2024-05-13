package main

import (
	"encoding/json"
	"fmt"
	"github.com/gookit/config/v2"
	
	"os"
	"path/filepath"
	"runtime"
)

type configFile struct {
	SecretKey    string `json:"secret_key"`
	OneUptimeURL string `json:"oneuptime_url"`
}

func newConfigFile() *configFile {
	return &configFile{
		SecretKey:    "",
		OneUptimeURL: "",
	}
}

func (c *configFile) loadConfig() error {
	cfg := &configFile{}
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
	return nil
}

func (c *configFile) save(secretKey string, url string) error {
	err := c.loadConfig()
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	err = config.Set("secret_key", secretKey)
	if err != nil {
		return err
	}
	err = config.Set("oneuptime_url", url)
	if err != nil {
		return err
	}
	// Open the file with os.Create, which truncates the file if it already exists,
	// and creates it if it doesn't.
	file, err := os.Create(c.configPath())
	if err != nil {
		return err
	}
	defer file.Close()
	// Create a JSON encoder that writes to the file, and use Encode method
	// which will write the map to the file in JSON format.
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "    ") // Optional: makes the output more readable
	return encoder.Encode(config.Data())
}

// removeConfigFile deletes the configuration file.
func (c *configFile) removeConfigFile() error {

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

// ensureDir checks if a directory exists and makes it if it does not.
func (c *configFile) ensureDir(dirName string) error {
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
func (c *configFile) configPath() string {
	var basePath string
	if runtime.GOOS == "windows" {
		basePath = os.Getenv("PROGRAMDATA")
		if basePath == "" {
			basePath = fmt.Sprintf("C:%sProgramData", string(filepath.Separator))
		}
	} else {
		basePath = fmt.Sprintf("%setc", string(filepath.Separator))
	}

	// Define the directory path where the configuration file will be stored.
	configDirectory := filepath.Join(basePath, "oneuptime_infrastructure_agent")

	// Ensure the directory exists.
	err := c.ensureDir(configDirectory)
	if err != nil {
		slog.Fatalf("Failed to create config directory: %v", err)
	}

	// Return the full path to the configuration file.
	return filepath.Join(configDirectory, "config.json")
}

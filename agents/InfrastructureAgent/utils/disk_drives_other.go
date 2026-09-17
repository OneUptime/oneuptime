//go:build !windows

package utils

// probedDriveLetters is Windows-only: other platforms have no drive letters.
func probedDriveLetters() []string {
	return nil
}

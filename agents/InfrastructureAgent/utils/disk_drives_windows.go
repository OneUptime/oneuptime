//go:build windows

package utils

import (
	"strings"

	"golang.org/x/sys/windows"
)

// probedDriveLetters lists the drive letters ("C:", "Z:") gopsutil reports a
// warning for when it cannot read them: local fixed disks, network drives, and
// letters whose drive type Windows cannot determine. Removable and optical
// drives are left out because gopsutil skips those silently when they have no
// media.
func probedDriveLetters() []string {
	buf := make([]uint16, 254)
	n, err := windows.GetLogicalDriveStrings(uint32(len(buf)), &buf[0])
	if err != nil || n == 0 || int(n) > len(buf) {
		return nil
	}

	// The buffer holds NUL-separated roots: "C:\", "D:\", ...
	var letters []string
	start := 0
	for i := 0; i < int(n); i++ {
		if buf[i] != 0 {
			continue
		}
		if i > start {
			root := windows.UTF16ToString(buf[start:i])
			rootPtr, err := windows.UTF16PtrFromString(root)
			if err == nil {
				switch windows.GetDriveType(rootPtr) {
				case windows.DRIVE_UNKNOWN, windows.DRIVE_FIXED, windows.DRIVE_REMOTE:
					letters = append(letters, strings.TrimRight(root, `\`))
				}
			}
		}
		start = i + 1
	}
	return letters
}

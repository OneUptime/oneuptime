//go:build windows

package utils

import (
	"oneuptime-infrastructure-agent/model"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shirou/gopsutil/v3/disk"
)

// disk_test.go stubs gopsutil so Windows' behaviour can be reproduced on Linux
// CI. These tests run the real thing on a Windows host (the windows job in
// .github/workflows/test.infrastructure-agent.yaml), so the stubs' idea of
// what Windows returns is checked against Windows itself.

// windowsSystemDrive is the drive Windows is installed on, e.g. "C:".
func windowsSystemDrive(t *testing.T) string {
	t.Helper()
	drive := strings.ToUpper(strings.TrimRight(os.Getenv("SystemDrive"), `\`))
	if drive == "" {
		t.Skip("SystemDrive is not set")
	}
	return drive
}

// The lookup this change replaced ran devices through filepath.Base. Pin the
// Windows behaviour that made it match nothing, so the reason for
// lookupIOCounters stays visible.
func TestWindowsDiskFilepathBaseDropsTheDriveLetter(t *testing.T) {
	if got := filepath.Base("C:"); got != `\` {
		t.Fatalf(`filepath.Base("C:") = %q on Windows, want "\"`, got)
	}
}

// The system drive is a fixed drive, so it must be among the letters used to
// name drives gopsutil could not read - in the same "C:" form gopsutil uses
// for partition mountpoints.
func TestWindowsDiskProbedDriveLettersIncludeTheSystemDrive(t *testing.T) {
	system := windowsSystemDrive(t)

	letters := probedDriveLetters()
	for _, letter := range letters {
		if len(letter) != 2 || letter[1] != ':' {
			t.Errorf("drive letter %q is not in the \"X:\" form gopsutil uses for mountpoints", letter)
		}
	}
	for _, letter := range letters {
		if strings.EqualFold(letter, system) {
			return
		}
	}
	t.Fatalf("probedDriveLetters() = %v, want it to include the system drive %s", letters, system)
}

// End to end against the real gopsutil: the system drive is reported, with the
// partition's own values, and when Windows returns I/O counters for it they are
// attached - which the old filepath.Base lookup never managed on Windows.
func TestWindowsDiskListDiskMetricsReportsTheSystemDrive(t *testing.T) {
	system := windowsSystemDrive(t)
	logs := diskCaptureLogs(t)
	previousProblems := diskProblems
	diskProblems = newDiskProblemLog(diskProblemRepeatInterval)
	t.Cleanup(func() { diskProblems = previousProblems })

	metrics := ListDiskMetrics()
	if metrics == nil {
		t.Fatalf("ListDiskMetrics() = nil on Windows. Log:\n%s", logs)
	}

	var systemMetric *model.BasicDiskMetrics
	for _, metric := range metrics {
		if strings.EqualFold(metric.DiskPath, system) {
			systemMetric = metric
		}
	}
	if systemMetric == nil {
		t.Fatalf("the system drive %s was not reported; got %v. Log:\n%s", system, diskPaths(metrics), logs)
	}
	if systemMetric.Total == 0 || systemMetric.Fstype == "" || !strings.EqualFold(systemMetric.Device, system) {
		t.Errorf("system drive metrics = %+v, want a non-zero total, a filesystem type and device %s", *systemMetric, system)
	}

	counters, err := disk.IOCounters()
	if err != nil {
		t.Logf("Windows returned no I/O counters on this host (%v); not checking I/O fields", err)
		return
	}
	if io, ok := counters[system]; ok && io.ReadBytes+io.WriteBytes > 0 && systemMetric.ReadBytes+systemMetric.WriteBytes == 0 {
		t.Errorf("Windows has I/O counters for %s (read %d, write %d) but none were attached to the reported disk",
			system, io.ReadBytes, io.WriteBytes)
	}
}

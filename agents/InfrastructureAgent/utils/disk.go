package utils

import (
	"context"
	"errors"
	"log/slog"
	"oneuptime-infrastructure-agent/model"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/disk"
)

// The gopsutil calls disk collection is built on. They are variables so tests
// can reproduce what each OS returns - above all Windows' partial partition
// list - on whatever platform the tests run on.
var (
	diskPartitions = disk.PartitionsWithContext
	diskUsage      = disk.Usage
	diskIOCounters = disk.IOCounters
	// diskExpectedDrives lists the drives that should have come back from
	// diskPartitions, so a partial result can name the ones that did not.
	diskExpectedDrives = probedDriveLetters
)

// diskPartitionTimeout bounds partition listing. On Windows gopsutil calls
// GetVolumeInformationW on every drive letter with no timeout of its own, so an
// unresponsive network drive would otherwise hold the whole collection job -
// and the report it sends - indefinitely. It stays below the 30s job interval.
var diskPartitionTimeout = 20 * time.Second

// diskProblemRepeatInterval is how often a disk collection problem that
// persists is logged again. Every 30s run also logs a line of its own, so this
// keeps the problem inside the `logs -n 50` tail the docs point users at
// (about 25 minutes) without repeating it on every run.
const diskProblemRepeatInterval = 10 * time.Minute

// diskProblems keeps disk collection problems from repeating in the log on
// every 30s run while they persist.
var diskProblems = newDiskProblemLog(diskProblemRepeatInterval)

// ioCountersNotImplemented is the text of gopsutil's ErrNotImplementedError,
// which lives in an internal package and so cannot be matched with errors.Is.
// The released macOS agent returns it: it is built without cgo, and gopsutil
// has no cgo-free way to read I/O counters there.
const ioCountersNotImplemented = "not implemented yet"

// GetDiskMetrics retrieves disk metrics for a given path
func GetDiskMetrics(path string) (*model.BasicDiskMetrics, error) {
	usageStat, err := diskUsage(path)
	if err != nil {
		return nil, err
	}
	if usageStat == nil {
		return nil, errors.New("no usage statistics returned")
	}
	var percentUsed, percentFree float64
	if usageStat.Total != 0 {
		percentUsed = float64(usageStat.Used) / float64(usageStat.Total) * 100
		percentFree = float64(usageStat.Free) / float64(usageStat.Total) * 100
	}

	metrics := &model.BasicDiskMetrics{
		Total:       usageStat.Total,
		Free:        usageStat.Free,
		Used:        usageStat.Used,
		DiskPath:    path,
		PercentUsed: percentUsed,
		PercentFree: percentFree,
	}

	return metrics, nil
}

// ListDiskMetrics lists disk metrics for all partitions, enriched with I/O counters.
//
// It returns nil only when no partition could be listed at all. When partitions
// were listed but none could be measured it returns an empty, non-nil slice.
func ListDiskMetrics() []*model.BasicDiskMetrics {
	ctx, cancel := context.WithTimeout(context.Background(), diskPartitionTimeout)
	defer cancel()

	// gopsutil reports partial success: on Windows a single drive letter that
	// cannot be read (a BitLocker-locked volume, a RAW partition, an unreachable
	// network drive) comes back as a *disk.Warnings error ALONGSIDE every
	// partition that was read fine, and a timeout comes back with the partitions
	// listed before it. Only an error with nothing listed is a failure;
	// otherwise one bad drive would hide every disk on the server.
	partitions, err := diskPartitions(ctx, false)
	if err != nil && len(partitions) == 0 {
		errs := describeDiskError(err)
		diskProblems.report(slog.LevelError, "partitions", errs,
			"Failed to list disk partitions; no disk metrics will be reported",
			"errors", errs)
		return nil
	}
	if err != nil {
		errs := describeDiskError(err)
		args := []any{"readablePartitions", len(partitions), "errors", errs}
		// Windows' error text does not name the drive, so name it here - and make
		// it part of what identifies the problem, so a different drive failing
		// with the same error is logged straight away.
		signature := errs
		if missing := missingDrives(diskExpectedDrives(), partitions); len(missing) > 0 {
			// gopsutil probes drive letters one at a time. When it returns
			// warnings it has probed them all, so the missing drives are the ones
			// that failed. After a timeout only the first missing drive is known to
			// have been probed (and is the likely culprit); the rest were never
			// reached.
			attr := "unreadableDrives"
			if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
				attr = "drivesNotListedBeforeTimeout"
			}
			args = append(args, attr, missing)
			signature = append(append([]string(nil), errs...), attr+"="+strings.Join(missing, ","))
		}
		diskProblems.report(slog.LevelWarn, "partitions", signature,
			"Some disk partitions could not be read; reporting the readable ones", args...)
	} else {
		diskProblems.resolve("partitions")
	}

	// Gather I/O counters once, keyed by device name ("sda1" on Linux, "C:" on
	// Windows). Like partitions, a failure can still return the counters that
	// were read before it, so the map is used whatever the error.
	ioCounters, ioErr := diskIOCounters()
	switch {
	case ioErr == nil:
		diskProblems.resolve("ioCounters")
	case len(ioCounters) == 0 && ioErr.Error() == ioCountersNotImplemented:
		// Expected on this platform and it will not change while the agent
		// runs, so it is not a problem to keep warning about.
		diskProblems.note(slog.LevelInfo, "ioCounters", []string{ioErr.Error()},
			"Disk I/O counters are not supported on this platform; disk I/O fields will be omitted")
	default:
		errs := describeDiskError(ioErr)
		diskProblems.report(slog.LevelWarn, "ioCounters", errs,
			"Failed to fetch some disk I/O counters; I/O fields may be missing",
			"countersReturned", len(ioCounters), "errors", errs)
	}

	metricsList := make([]*model.BasicDiskMetrics, 0, len(partitions))
	var usageFailures []string
	for _, partition := range partitions {
		if partition.Mountpoint == "" {
			continue
		}

		metrics, usageErr := GetDiskMetrics(partition.Mountpoint)
		if usageErr != nil {
			for _, message := range describeDiskError(usageErr) {
				usageFailures = append(usageFailures, partition.Mountpoint+" - "+message)
			}
			continue // Skip this partition on error
		}

		metrics.Device = partition.Device
		metrics.Fstype = partition.Fstype

		if io, ok := lookupIOCounters(ioCounters, partition.Device); ok {
			metrics.ReadBytes = io.ReadBytes
			metrics.WriteBytes = io.WriteBytes
			metrics.ReadCount = io.ReadCount
			metrics.WriteCount = io.WriteCount
			metrics.IoTimeMs = io.IoTime
		}

		metricsList = append(metricsList, metrics)
	}

	if len(usageFailures) > 0 {
		diskProblems.report(slog.LevelWarn, "usage", usageFailures,
			"Failed to read disk usage for some partitions; skipping them",
			"failures", usageFailures)
	} else {
		diskProblems.resolve("usage")
	}

	if len(metricsList) == 0 {
		diskProblems.report(slog.LevelWarn, "empty", []string{strconv.Itoa(len(partitions))},
			"No disk could be measured; disk metrics will be empty",
			"partitionsListed", len(partitions))
	} else {
		diskProblems.resolve("empty")
	}

	return metricsList
}

// describeDiskError turns a gopsutil error into one message per underlying
// problem, unwrapping *disk.Warnings into its individual drive errors.
//
// It never calls (*disk.Warnings).Error(): gopsutil can add a nil entry (when
// GetDriveTypeW fails without setting a last error) and Error() dereferences
// every entry, so formatting the warnings that way would panic and take the
// whole agent down.
func describeDiskError(err error) []string {
	if err == nil {
		return nil
	}

	var warnings *disk.Warnings
	if errors.As(err, &warnings) && warnings != nil {
		messages := make([]string, 0, len(warnings.List))
		for _, warning := range warnings.List {
			if warning == nil {
				messages = append(messages, "unknown drive error (Windows returned no error code)")
				continue
			}
			messages = append(messages, warning.Error())
		}
		return messages
	}

	return []string{err.Error()}
}

// missingDrives returns the drives in expected ("C:", "D:") that are not among
// the listed partitions.
func missingDrives(expected []string, partitions []disk.PartitionStat) []string {
	listed := make(map[string]bool, len(partitions))
	for _, partition := range partitions {
		listed[normalizeDriveName(partition.Mountpoint)] = true
	}

	var missing []string
	for _, drive := range expected {
		if drive == "" || listed[normalizeDriveName(drive)] {
			continue
		}
		missing = append(missing, drive)
	}
	return missing
}

func normalizeDriveName(drive string) string {
	return strings.ToUpper(strings.TrimRight(drive, `/\`))
}

// lookupIOCounters finds the I/O counters gopsutil collected for a partition's
// device. Windows keys counters by the drive itself ("C:"), which is also the
// partition's device, so the exact device is tried first. Linux keys them by
// the device's last path element ("sda1" for "/dev/sda1").
//
// This deliberately avoids filepath.Base: on Windows it strips the volume name,
// turning "C:" into `\`, which matches nothing.
func lookupIOCounters(counters map[string]disk.IOCountersStat, device string) (disk.IOCountersStat, bool) {
	for _, key := range ioCountersKeyCandidates(device) {
		if io, ok := counters[key]; ok {
			return io, true
		}
	}
	return disk.IOCountersStat{}, false
}

// ioCountersKeyCandidates returns the keys a device's I/O counters may be
// stored under, most specific first. It treats both / and \ as separators so
// the result is the same whatever OS the agent (or its tests) runs on.
func ioCountersKeyCandidates(device string) []string {
	if device == "" {
		return nil
	}

	candidates := []string{device}
	add := func(key string) {
		key = strings.TrimSpace(key)
		if key == "" {
			return
		}
		for _, candidate := range candidates {
			if candidate == key {
				return
			}
		}
		candidates = append(candidates, key)
	}

	trimmed := strings.TrimRight(device, `/\`)
	add(trimmed)
	if i := strings.LastIndexAny(trimmed, `/\`); i >= 0 {
		add(trimmed[i+1:])
	}
	return candidates
}

// diskProblemLog logs a disk collection problem when it first appears, again
// if its errors change or it is still there after interval, and once more at
// Info level when it clears. Disk collection runs every 30s, so without this a
// single unreadable drive would add a warning to the log twice a minute
// forever.
//
// It is safe for concurrent use: the scheduler does not stop a slow run from
// overlapping the next one.
type diskProblemLog struct {
	mu       sync.Mutex
	interval time.Duration
	now      func() time.Time
	active   map[string]diskProblem
}

type diskProblem struct {
	signature string
	loggedAt  time.Time
}

func newDiskProblemLog(interval time.Duration) *diskProblemLog {
	return &diskProblemLog{
		interval: interval,
		now:      time.Now,
		active:   map[string]diskProblem{},
	}
}

// report records that source currently has the given errors and logs msg with
// args if it is due. Errors are compared regardless of order.
func (l *diskProblemLog) report(level slog.Level, source string, errs []string, msg string, args ...any) {
	l.record(level, source, errs, true, msg, args...)
}

// note is report for a condition that is expected and will not clear while the
// agent runs: it is logged when it first appears or changes, but not repeated.
func (l *diskProblemLog) note(level slog.Level, source string, errs []string, msg string, args ...any) {
	l.record(level, source, errs, false, msg, args...)
}

func (l *diskProblemLog) record(level slog.Level, source string, errs []string, repeat bool, msg string, args ...any) {
	sorted := append([]string(nil), errs...)
	sort.Strings(sorted)
	signature := level.String() + "|" + strings.Join(sorted, "|")

	l.mu.Lock()
	now := l.now()
	previous, seen := l.active[source]
	due := !seen || previous.signature != signature || (repeat && now.Sub(previous.loggedAt) >= l.interval)
	if due {
		l.active[source] = diskProblem{signature: signature, loggedAt: now}
	}
	l.mu.Unlock()

	if due {
		slog.Log(context.Background(), level, msg, append(args, "source", source)...)
	}
}

// resolve records that source has no problem now, logging that once if it had
// one.
func (l *diskProblemLog) resolve(source string) {
	l.mu.Lock()
	_, seen := l.active[source]
	delete(l.active, source)
	l.mu.Unlock()

	if seen {
		slog.Info("Disk collection problem resolved", "source", source)
	}
}

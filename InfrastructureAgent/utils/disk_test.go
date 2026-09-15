package utils

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"oneuptime-infrastructure-agent/model"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shirou/gopsutil/v3/disk"
)

// Disk collection is only as good as its handling of what gopsutil returns, and
// the interesting returns are OS-specific: Windows hands back a partition list
// together with a *disk.Warnings error when a single drive letter cannot be
// read. These tests swap the gopsutil calls for stubs so each of those shapes
// can be reproduced on the Linux/macOS machines the suite runs on.
//
// None of them use t.Parallel: the stubs, the problem log and slog's default
// logger are all package-level state.

// bitLockerError is the text Windows returns from GetVolumeInformationW for a
// locked BitLocker data volume - one of the ways a Windows Server ends up with
// a fixed drive letter that cannot be read.
var bitLockerError = errors.New("This drive is locked by BitLocker Drive Encryption. You must unlock this drive from Control Panel.")

// diskLogWriter serializes writes into buf. TestDiskProblemLogIsSafeForConcurrentRuns
// logs from several goroutines and bytes.Buffer is not safe for concurrent use.
type diskLogWriter struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (w *diskLogWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buf.Write(p)
}

// records decodes every log record written so far.
func (w *diskLogWriter) records(t *testing.T) []map[string]any {
	t.Helper()
	w.mu.Lock()
	defer w.mu.Unlock()

	var records []map[string]any
	scanner := bufio.NewScanner(bytes.NewReader(w.buf.Bytes()))
	for scanner.Scan() {
		var record map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			t.Fatalf("log line is not a JSON record: %v\n%s", err, scanner.Text())
		}
		records = append(records, record)
	}
	return records
}

// withMessage returns the records whose msg is exactly msg.
func (w *diskLogWriter) withMessage(t *testing.T, msg string) []map[string]any {
	t.Helper()
	var matching []map[string]any
	for _, record := range w.records(t) {
		if record["msg"] == msg {
			matching = append(matching, record)
		}
	}
	return matching
}

func (w *diskLogWriter) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buf.String()
}

// diskCaptureLogs points the default slog logger at a buffer for the duration
// of the test. It uses a JSON handler, rather than the TextHandler the agent
// writes its log file with, so attributes can be asserted on exactly instead of
// by substring. Debug is enabled so nothing the code logs is filtered out.
func diskCaptureLogs(t *testing.T) *diskLogWriter {
	t.Helper()

	writer := &diskLogWriter{}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(writer, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})
	return writer
}

// diskStubs replaces the gopsutil calls ListDiskMetrics makes. A nil field gets
// a well-behaved default: no partitions, every usage call succeeding, no I/O
// counters and no expected drive letters.
type diskStubs struct {
	partitions     func(ctx context.Context, all bool) ([]disk.PartitionStat, error)
	usage          func(path string) (*disk.UsageStat, error)
	ioCounters     func(names ...string) (map[string]disk.IOCountersStat, error)
	expectedDrives func() []string
}

// diskInstallStubs installs stubs and a fresh problem log, restoring the real
// collectors, timeout and problem log when the test ends.
func diskInstallStubs(t *testing.T, stubs diskStubs) {
	t.Helper()

	previousPartitions := diskPartitions
	previousUsage := diskUsage
	previousIOCounters := diskIOCounters
	previousExpectedDrives := diskExpectedDrives
	previousTimeout := diskPartitionTimeout
	previousProblems := diskProblems
	t.Cleanup(func() {
		diskPartitions = previousPartitions
		diskUsage = previousUsage
		diskIOCounters = previousIOCounters
		diskExpectedDrives = previousExpectedDrives
		diskPartitionTimeout = previousTimeout
		diskProblems = previousProblems
	})

	if stubs.partitions == nil {
		stubs.partitions = func(context.Context, bool) ([]disk.PartitionStat, error) { return nil, nil }
	}
	if stubs.usage == nil {
		stubs.usage = diskUsageOf(100, 40)
	}
	if stubs.ioCounters == nil {
		stubs.ioCounters = func(...string) (map[string]disk.IOCountersStat, error) {
			return map[string]disk.IOCountersStat{}, nil
		}
	}
	if stubs.expectedDrives == nil {
		stubs.expectedDrives = func() []string { return nil }
	}

	diskPartitions = stubs.partitions
	diskUsage = stubs.usage
	diskIOCounters = stubs.ioCounters
	diskExpectedDrives = stubs.expectedDrives
	diskProblems = newDiskProblemLog(diskProblemRepeatInterval)
}

// diskPartitionsReturning is a partitions stub with a fixed result.
func diskPartitionsReturning(partitions []disk.PartitionStat, err error) func(context.Context, bool) ([]disk.PartitionStat, error) {
	return func(context.Context, bool) ([]disk.PartitionStat, error) {
		return partitions, err
	}
}

// diskUsageOf is a usage stub reporting the same total and free bytes for every
// path.
func diskUsageOf(total, free uint64) func(string) (*disk.UsageStat, error) {
	return func(path string) (*disk.UsageStat, error) {
		return &disk.UsageStat{Path: path, Total: total, Free: free, Used: total - free}, nil
	}
}

// windowsDrive is the partition gopsutil builds for a Windows drive letter: the
// letter is both mountpoint and device.
func windowsDrive(letter string) disk.PartitionStat {
	return disk.PartitionStat{Mountpoint: letter, Device: letter, Fstype: "NTFS", Opts: []string{"rw"}}
}

func diskPaths(metrics []*model.BasicDiskMetrics) []string {
	paths := make([]string, 0, len(metrics))
	for _, metric := range metrics {
		paths = append(paths, metric.DiskPath)
	}
	return paths
}

// diskAttrStrings reads a []string attribute back out of a JSON log record.
func diskAttrStrings(t *testing.T, record map[string]any, key string) []string {
	t.Helper()
	raw, ok := record[key].([]any)
	if !ok {
		t.Fatalf("log record has no list attribute %q: %v", key, record)
	}
	values := make([]string, 0, len(raw))
	for _, value := range raw {
		values = append(values, fmt.Sprint(value))
	}
	return values
}

// The customer-reported bug: a Windows Server with one unreadable drive letter
// showed no disks at all while every other metric kept arriving. gopsutil had
// listed C: and D: fine and returned them together with a warning for the bad
// drive, but the agent treated any error as total failure and sent
// "diskMetrics": null. The readable drives must be reported, and the log must
// say which drive could not be read and why - once, as a warning.
func TestListDiskMetricsKeepsReadablePartitionsWhenWindowsReportsWarnings(t *testing.T) {
	logs := diskCaptureLogs(t)
	diskInstallStubs(t, diskStubs{
		partitions: diskPartitionsReturning(
			[]disk.PartitionStat{windowsDrive("C:"), windowsDrive("D:")},
			&disk.Warnings{Verbose: true, List: []error{bitLockerError}},
		),
		expectedDrives: func() []string { return []string{"C:", "D:", "E:"} },
	})

	metrics := ListDiskMetrics()

	if got, want := diskPaths(metrics), []string{"C:", "D:"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("reported disks = %v, want %v; one unreadable drive must not hide the readable ones", got, want)
	}
	for _, metric := range metrics {
		if metric.Device != metric.DiskPath || metric.Fstype != "NTFS" {
			t.Errorf("disk %s: device=%q fstype=%q, want device %q and fstype NTFS", metric.DiskPath, metric.Device, metric.Fstype, metric.DiskPath)
		}
		if metric.Total != 100 || metric.Free != 40 || metric.Used != 60 || metric.PercentUsed != 60 || metric.PercentFree != 40 {
			t.Errorf("disk %s: usage = %+v, want total 100, free 40, used 60 (60%%/40%%)", metric.DiskPath, *metric)
		}
	}

	warnings := logs.withMessage(t, "Some disk partitions could not be read; reporting the readable ones")
	if len(warnings) != 1 {
		t.Fatalf("got %d partial-partition warnings, want exactly 1. Log:\n%s", len(warnings), logs)
	}
	warning := warnings[0]
	if warning["level"] != "WARN" {
		t.Errorf("partial partition list logged at %v, want WARN", warning["level"])
	}
	if warning["readablePartitions"] != float64(2) {
		t.Errorf("readablePartitions = %v, want 2", warning["readablePartitions"])
	}
	if got, want := diskAttrStrings(t, warning, "errors"), []string{bitLockerError.Error()}; !reflect.DeepEqual(got, want) {
		t.Errorf("errors = %v, want %v", got, want)
	}
	if got, want := diskAttrStrings(t, warning, "unreadableDrives"), []string{"E:"}; !reflect.DeepEqual(got, want) {
		t.Errorf("unreadableDrives = %v, want %v", got, want)
	}

	for _, record := range logs.records(t) {
		if record["level"] == "ERROR" {
			t.Errorf("a partial partition list is not an error, but logged: %v", record)
		}
		// The old code logged Warnings.Error() verbatim - a bare "\tError 0: ..."
		// with nothing saying what it was about.
		if msg, _ := record["msg"].(string); strings.Contains(msg, "Error 0:") {
			t.Errorf("gopsutil's raw warnings text leaked into the log as a message: %q", msg)
		}
	}
}

// The payload the server stores is what the dashboard renders, so pin the JSON
// the fixed partial-result case produces rather than only the Go values.
func TestListDiskMetricsPartialWindowsResultSerializesReadableDisks(t *testing.T) {
	diskCaptureLogs(t)
	diskInstallStubs(t, diskStubs{
		partitions: diskPartitionsReturning(
			[]disk.PartitionStat{windowsDrive("C:")},
			&disk.Warnings{Verbose: true, List: []error{bitLockerError}},
		),
	})

	body, err := json.Marshal(model.BasicInfrastructureMetrics{DiskMetrics: ListDiskMetrics()})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var payload struct {
		DiskMetrics []map[string]any `json:"diskMetrics"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal %s: %v", body, err)
	}
	if len(payload.DiskMetrics) != 1 || payload.DiskMetrics[0]["diskPath"] != "C:" {
		t.Fatalf("diskMetrics = %s, want exactly the C: disk", body)
	}
}

// errors.As must see through wrapping, so the individual drive errors are
// still logged if a caller or a future gopsutil wraps the warnings.
func TestListDiskMetricsUnwrapsWrappedWarnings(t *testing.T) {
	logs := diskCaptureLogs(t)
	diskInstallStubs(t, diskStubs{
		partitions: diskPartitionsReturning(
			[]disk.PartitionStat{windowsDrive("C:")},
			fmt.Errorf("listing partitions: %w", &disk.Warnings{List: []error{bitLockerError, errors.New("Access is denied.")}}),
		),
	})

	if got, want := diskPaths(ListDiskMetrics()), []string{"C:"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("reported disks = %v, want %v", got, want)
	}

	warnings := logs.withMessage(t, "Some disk partitions could not be read; reporting the readable ones")
	if len(warnings) != 1 {
		t.Fatalf("got %d partial-partition warnings, want 1. Log:\n%s", len(warnings), logs)
	}
	if got, want := diskAttrStrings(t, warnings[0], "errors"), []string{bitLockerError.Error(), "Access is denied."}; !reflect.DeepEqual(got, want) {
		t.Errorf("errors = %v, want each wrapped drive error in order: %v", got, want)
	}
	if _, ok := warnings[0]["unreadableDrives"]; ok {
		t.Errorf("unreadableDrives logged although no drive letters were expected: %v", warnings[0])
	}
}

// A timeout comes back from gopsutil with the partitions listed before it.
// Those are real disks and must be reported like any other partial result.
//
// gopsutil probes drive letters one at a time, so after a timeout the drives
// that did not come back were mostly never probed. Calling them unreadable
// would send whoever reads the log after healthy volumes.
func TestListDiskMetricsKeepsPartitionsListedBeforeADeadline(t *testing.T) {
	logs := diskCaptureLogs(t)
	diskInstallStubs(t, diskStubs{
		partitions:     diskPartitionsReturning([]disk.PartitionStat{windowsDrive("C:")}, context.DeadlineExceeded),
		expectedDrives: func() []string { return []string{"C:", "H:", "S:"} },
	})

	if got, want := diskPaths(ListDiskMetrics()), []string{"C:"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("reported disks = %v, want %v", got, want)
	}

	warnings := logs.withMessage(t, "Some disk partitions could not be read; reporting the readable ones")
	if len(warnings) != 1 {
		t.Fatalf("got %d partial-partition warnings, want 1. Log:\n%s", len(warnings), logs)
	}
	if got, want := diskAttrStrings(t, warnings[0], "errors"), []string{context.DeadlineExceeded.Error()}; !reflect.DeepEqual(got, want) {
		t.Errorf("errors = %v, want %v", got, want)
	}
	if _, ok := warnings[0]["unreadableDrives"]; ok {
		t.Errorf("drives not reached before the timeout were logged as unreadable: %v", warnings[0])
	}
	if got, want := diskAttrStrings(t, warnings[0], "drivesNotListedBeforeTimeout"), []string{"H:", "S:"}; !reflect.DeepEqual(got, want) {
		t.Errorf("drivesNotListedBeforeTimeout = %v, want %v", got, want)
	}
}

// gopsutil calls GetVolumeInformationW on every drive letter with no timeout of
// its own, and an unresponsive network drive can block that call. Listing must
// be bounded by a deadline so the collection job - and the report carrying the
// other metrics - still completes, with whatever was listed in time.
func TestListDiskMetricsBoundsPartitionListingWithATimeout(t *testing.T) {
	diskCaptureLogs(t)
	diskInstallStubs(t, diskStubs{
		partitions: func(ctx context.Context, _ bool) ([]disk.PartitionStat, error) {
			if _, ok := ctx.Deadline(); !ok {
				t.Errorf("partition listing was given a context without a deadline")
				return nil, errors.New("no deadline")
			}
			<-ctx.Done()
			return []disk.PartitionStat{windowsDrive("C:")}, ctx.Err()
		},
	})
	diskPartitionTimeout = 50 * time.Millisecond

	done := make(chan []*model.BasicDiskMetrics, 1)
	go func() { done <- ListDiskMetrics() }()

	select {
	case metrics := <-done:
		if got, want := diskPaths(metrics), []string{"C:"}; !reflect.DeepEqual(got, want) {
			t.Fatalf("reported disks = %v, want %v", got, want)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ListDiskMetrics did not return; partition listing is not bounded by diskPartitionTimeout")
	}
}

// The production timeout must leave room inside the 30s collection interval
// (agent.go schedules the job every 30 seconds), or a hung listing would still
// run into the next collection.
func TestDiskPartitionTimeoutFitsInsideTheCollectionInterval(t *testing.T) {
	if diskPartitionTimeout <= 0 || diskPartitionTimeout >= 30*time.Second {
		t.Fatalf("diskPartitionTimeout = %v, want a positive duration below the 30s collection interval", diskPartitionTimeout)
	}
}

// When nothing at all could be listed there is no disk to report, so nil -
// "diskMetrics": null - is still the right answer, logged as an error. The
// usage and I/O counter calls must not run.
func TestListDiskMetricsReturnsNilWhenNoPartitionCanBeListed(t *testing.T) {
	cases := []struct {
		name       string
		partitions []disk.PartitionStat
		err        error
		wantErrors []string
	}{
		{
			name:       "plain error",
			err:        errors.New("The system cannot find the path specified."),
			wantErrors: []string{"The system cannot find the path specified."},
		},
		{
			name:       "warnings with no partitions",
			err:        &disk.Warnings{List: []error{bitLockerError}},
			wantErrors: []string{bitLockerError.Error()},
		},
		{
			name:       "empty non-nil partition slice",
			partitions: []disk.PartitionStat{},
			err:        errors.New("boom"),
			wantErrors: []string{"boom"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logs := diskCaptureLogs(t)
			usageCalls, ioCalls := 0, 0
			diskInstallStubs(t, diskStubs{
				partitions: diskPartitionsReturning(tc.partitions, tc.err),
				usage: func(path string) (*disk.UsageStat, error) {
					usageCalls++
					return diskUsageOf(1, 1)(path)
				},
				ioCounters: func(...string) (map[string]disk.IOCountersStat, error) {
					ioCalls++
					return nil, nil
				},
			})

			if metrics := ListDiskMetrics(); metrics != nil {
				t.Fatalf("ListDiskMetrics() = %v, want nil when no partition could be listed", metrics)
			}
			if usageCalls != 0 || ioCalls != 0 {
				t.Errorf("usage called %d times and I/O counters %d times, want neither called", usageCalls, ioCalls)
			}

			failures := logs.withMessage(t, "Failed to list disk partitions; no disk metrics will be reported")
			if len(failures) != 1 {
				t.Fatalf("got %d listing failures logged, want 1. Log:\n%s", len(failures), logs)
			}
			if failures[0]["level"] != "ERROR" {
				t.Errorf("listing failure logged at %v, want ERROR", failures[0]["level"])
			}
			if got := diskAttrStrings(t, failures[0], "errors"); !reflect.DeepEqual(got, tc.wantErrors) {
				t.Errorf("errors = %v, want %v", got, tc.wantErrors)
			}
		})
	}
}

// gopsutil adds windows.GetLastError() to its warnings when GetDriveTypeW
// fails, and that is nil when Windows set no error code. Warnings.Error()
// dereferences every entry, so formatting such an error the old way panicked -
// and a panic in the collection job takes the whole agent down, because the
// scheduler does not recover it.
func TestListDiskMetricsDoesNotPanicOnANilWarningEntry(t *testing.T) {
	cases := []struct {
		name       string
		partitions []disk.PartitionStat
		warnings   []error
		wantPaths  []string
		wantMsg    string
	}{
		{
			name:       "alongside readable partitions",
			partitions: []disk.PartitionStat{windowsDrive("C:")},
			warnings:   []error{nil},
			wantPaths:  []string{"C:"},
			wantMsg:    "Some disk partitions could not be read; reporting the readable ones",
		},
		{
			name:     "with nothing listed",
			warnings: []error{nil, errors.New("The device is not ready.")},
			wantMsg:  "Failed to list disk partitions; no disk metrics will be reported",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logs := diskCaptureLogs(t)
			diskInstallStubs(t, diskStubs{
				partitions: diskPartitionsReturning(tc.partitions, &disk.Warnings{Verbose: true, List: tc.warnings}),
			})

			var metrics []*model.BasicDiskMetrics
			func() {
				defer func() {
					if recovered := recover(); recovered != nil {
						t.Fatalf("ListDiskMetrics panicked on a nil warning entry: %v", recovered)
					}
				}()
				metrics = ListDiskMetrics()
			}()

			if tc.wantPaths == nil {
				if metrics != nil {
					t.Errorf("ListDiskMetrics() = %v, want nil", diskPaths(metrics))
				}
			} else if got := diskPaths(metrics); !reflect.DeepEqual(got, tc.wantPaths) {
				t.Errorf("reported disks = %v, want %v", got, tc.wantPaths)
			}

			records := logs.withMessage(t, tc.wantMsg)
			if len(records) != 1 {
				t.Fatalf("got %d %q records, want 1. Log:\n%s", len(records), tc.wantMsg, logs)
			}
			if errs := diskAttrStrings(t, records[0], "errors"); len(errs) == 0 || !strings.Contains(errs[0], "unknown drive error") {
				t.Errorf("errors = %v, want the nil entry described as an unknown drive error", errs)
			}
		})
	}
}

// A partition whose usage cannot be read is skipped, and only that partition:
// the others are reported in their original order. The failures are logged
// once, naming the mountpoint, since a bare Windows error message does not say
// which drive it came from.
func TestListDiskMetricsSkipsOnlyPartitionsWhoseUsageFails(t *testing.T) {
	logs := diskCaptureLogs(t)
	diskInstallStubs(t, diskStubs{
		partitions: diskPartitionsReturning(
			[]disk.PartitionStat{windowsDrive("C:"), windowsDrive("D:"), windowsDrive("E:")}, nil),
		usage: func(path string) (*disk.UsageStat, error) {
			if path == "D:" {
				return nil, errors.New("The device is not ready.")
			}
			return diskUsageOf(100, 40)(path)
		},
	})

	if got, want := diskPaths(ListDiskMetrics()), []string{"C:", "E:"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("reported disks = %v, want %v", got, want)
	}

	failures := logs.withMessage(t, "Failed to read disk usage for some partitions; skipping them")
	if len(failures) != 1 {
		t.Fatalf("got %d usage failure records, want 1. Log:\n%s", len(failures), logs)
	}
	if got, want := diskAttrStrings(t, failures[0], "failures"), []string{"D: - The device is not ready."}; !reflect.DeepEqual(got, want) {
		t.Errorf("failures = %v, want %v", got, want)
	}
	if empty := logs.withMessage(t, "No disk could be measured; disk metrics will be empty"); len(empty) != 0 {
		t.Errorf("logged that no disk could be measured although two were: %v", empty)
	}
}

// A usage stub - or a future gopsutil - returning neither stats nor an error
// must not crash collection with a nil dereference.
func TestListDiskMetricsSkipsUsageWithoutStatistics(t *testing.T) {
	logs := diskCaptureLogs(t)
	diskInstallStubs(t, diskStubs{
		partitions: diskPartitionsReturning([]disk.PartitionStat{windowsDrive("C:"), windowsDrive("D:")}, nil),
		usage: func(path string) (*disk.UsageStat, error) {
			if path == "C:" {
				return nil, nil
			}
			return diskUsageOf(100, 40)(path)
		},
	})

	if got, want := diskPaths(ListDiskMetrics()), []string{"D:"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("reported disks = %v, want %v", got, want)
	}
	failures := logs.withMessage(t, "Failed to read disk usage for some partitions; skipping them")
	if len(failures) != 1 || !reflect.DeepEqual(diskAttrStrings(t, failures[0], "failures"), []string{"C: - no usage statistics returned"}) {
		t.Errorf("want one usage failure naming C:, got %v. Log:\n%s", failures, logs)
	}
}

// A successful listing is never reported as null, even when it yields no
// measurable disk: nil is reserved for "could not list at all", which
// agent.go warns about. Both cases still log that no disk was measured.
func TestListDiskMetricsReturnsEmptyNotNilWhenNothingIsMeasurable(t *testing.T) {
	cases := []struct {
		name       string
		partitions []disk.PartitionStat
		usage      func(string) (*disk.UsageStat, error)
		wantListed float64
	}{
		{
			name:       "every usage call fails",
			partitions: []disk.PartitionStat{windowsDrive("C:")},
			usage: func(string) (*disk.UsageStat, error) {
				return nil, errors.New("Access is denied.")
			},
			wantListed: 1,
		},
		{
			name:       "no partitions and no error",
			wantListed: 0,
		},
		{
			name:       "only partitions without a mountpoint",
			partitions: []disk.PartitionStat{{}},
			wantListed: 1,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logs := diskCaptureLogs(t)
			diskInstallStubs(t, diskStubs{
				partitions: diskPartitionsReturning(tc.partitions, nil),
				usage:      tc.usage,
			})

			metrics := ListDiskMetrics()
			if metrics == nil || len(metrics) != 0 {
				t.Fatalf("ListDiskMetrics() = %#v, want an empty, non-nil slice", metrics)
			}

			body, err := json.Marshal(model.BasicInfrastructureMetrics{DiskMetrics: metrics})
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if !strings.Contains(string(body), `"diskMetrics":[]`) {
				t.Errorf("payload = %s, want \"diskMetrics\":[]", body)
			}

			empty := logs.withMessage(t, "No disk could be measured; disk metrics will be empty")
			if len(empty) != 1 {
				t.Fatalf("got %d 'no disk measured' records, want 1. Log:\n%s", len(empty), logs)
			}
			if empty[0]["partitionsListed"] != tc.wantListed {
				t.Errorf("partitionsListed = %v, want %v", empty[0]["partitionsListed"], tc.wantListed)
			}
		})
	}
}

// Newer gopsutil versions can append an empty PartitionStat on Windows. Usage
// must never be asked about "", which on Windows resolves to the agent's
// working directory and would report that drive under an empty name.
func TestListDiskMetricsSkipsPartitionsWithoutAMountpoint(t *testing.T) {
	diskCaptureLogs(t)
	var usagePaths []string
	diskInstallStubs(t, diskStubs{
		partitions: diskPartitionsReturning([]disk.PartitionStat{{}, windowsDrive("C:")}, nil),
		usage: func(path string) (*disk.UsageStat, error) {
			usagePaths = append(usagePaths, path)
			return diskUsageOf(100, 40)(path)
		},
	})

	if got, want := diskPaths(ListDiskMetrics()), []string{"C:"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("reported disks = %v, want %v", got, want)
	}
	if want := []string{"C:"}; !reflect.DeepEqual(usagePaths, want) {
		t.Errorf("usage called for %q, want only %q", usagePaths, want)
	}
}

// Windows keys I/O counters by drive letter ("C:"), and the old lookup ran the
// device through filepath.Base, which on Windows turns "C:" into `\`. Windows
// disks never got read/write counters.
//
// filepath.Base only does that on a Windows host, and these tests run on Linux
// in CI (disk_windows_test.go covers the real thing on Windows). So the plain
// "C:" case would pass against the old lookup here; the backslash cases are the
// ones that fail if the lookup ever goes back to OS-dependent path handling.
func TestListDiskMetricsAttachesIOCountersOnWindowsAndLinux(t *testing.T) {
	counters := func(key string) map[string]disk.IOCountersStat {
		return map[string]disk.IOCountersStat{key: {Name: key, ReadBytes: 10, WriteBytes: 20, ReadCount: 1, WriteCount: 2, IoTime: 7}}
	}

	cases := []struct {
		name      string
		partition disk.PartitionStat
		counters  map[string]disk.IOCountersStat
	}{
		{
			name:      "windows drive letter",
			partition: windowsDrive("C:"),
			counters:  counters("C:"),
		},
		{
			name:      "windows drive root with a backslash",
			partition: disk.PartitionStat{Mountpoint: "C:", Device: `C:\`, Fstype: "NTFS"},
			counters:  counters("C:"),
		},
		{
			name:      "windows device namespace path",
			partition: disk.PartitionStat{Mountpoint: "C:", Device: `\\.\PhysicalDrive0`, Fstype: "NTFS"},
			counters:  counters("PhysicalDrive0"),
		},
		{
			name:      "linux block device",
			partition: disk.PartitionStat{Mountpoint: "/", Device: "/dev/sda1", Fstype: "ext4"},
			counters:  counters("sda1"),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			diskCaptureLogs(t)
			diskInstallStubs(t, diskStubs{
				partitions: diskPartitionsReturning([]disk.PartitionStat{tc.partition}, nil),
				ioCounters: func(...string) (map[string]disk.IOCountersStat, error) { return tc.counters, nil },
			})

			metrics := ListDiskMetrics()
			if len(metrics) != 1 {
				t.Fatalf("reported %d disks, want 1", len(metrics))
			}
			got := metrics[0]
			if got.ReadBytes != 10 || got.WriteBytes != 20 || got.ReadCount != 1 || got.WriteCount != 2 || got.IoTimeMs != 7 {
				t.Errorf("I/O fields = read %d/%d write %d/%d ioTime %d, want read 10/1 write 20/2 ioTime 7",
					got.ReadBytes, got.ReadCount, got.WriteBytes, got.WriteCount, got.IoTimeMs)
			}
		})
	}
}

// On Windows gopsutil stops collecting I/O counters at the first fixed drive
// whose performance ioctl fails, returning the counters gathered so far with
// the error. Those counters are still good; losing them - or worse, the disks
// - over one drive would be wrong.
func TestListDiskMetricsUsesIOCountersReturnedWithAnError(t *testing.T) {
	logs := diskCaptureLogs(t)
	diskInstallStubs(t, diskStubs{
		partitions: diskPartitionsReturning([]disk.PartitionStat{windowsDrive("C:"), windowsDrive("D:")}, nil),
		ioCounters: func(...string) (map[string]disk.IOCountersStat, error) {
			return map[string]disk.IOCountersStat{"C:": {ReadBytes: 10, WriteBytes: 20, ReadCount: 1, WriteCount: 2}},
				errors.New("Incorrect function.")
		},
	})

	metrics := ListDiskMetrics()
	if got, want := diskPaths(metrics), []string{"C:", "D:"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("reported disks = %v, want %v", got, want)
	}
	if metrics[0].ReadBytes != 10 || metrics[0].WriteBytes != 20 {
		t.Errorf("C: I/O = read %d write %d, want the counters returned with the error (10/20)", metrics[0].ReadBytes, metrics[0].WriteBytes)
	}
	if metrics[1].ReadBytes != 0 || metrics[1].WriteBytes != 0 {
		t.Errorf("D: I/O = read %d write %d, want none", metrics[1].ReadBytes, metrics[1].WriteBytes)
	}

	warnings := logs.withMessage(t, "Failed to fetch some disk I/O counters; I/O fields may be missing")
	if len(warnings) != 1 {
		t.Fatalf("got %d I/O counter warnings, want 1. Log:\n%s", len(warnings), logs)
	}
	if warnings[0]["countersReturned"] != float64(1) {
		t.Errorf("countersReturned = %v, want 1", warnings[0]["countersReturned"])
	}
}

// I/O counters are optional enrichment. When they are unavailable altogether,
// disks are still reported, just without I/O fields, and nothing panics on the
// nil map.
func TestListDiskMetricsReportsDisksWhenIOCountersAreUnavailable(t *testing.T) {
	logs := diskCaptureLogs(t)
	diskInstallStubs(t, diskStubs{
		partitions: diskPartitionsReturning([]disk.PartitionStat{{Mountpoint: "/", Device: "/dev/disk3s1s1", Fstype: "apfs"}}, nil),
		ioCounters: func(...string) (map[string]disk.IOCountersStat, error) {
			return nil, errors.New("Access is denied.")
		},
	})

	metrics := ListDiskMetrics()
	if got, want := diskPaths(metrics), []string{"/"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("reported disks = %v, want %v", got, want)
	}

	body, err := json.Marshal(metrics[0])
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, field := range []string{"readBytes", "writeBytes", "readCount", "writeCount", "ioTimeMs"} {
		if strings.Contains(string(body), `"`+field+`"`) {
			t.Errorf("payload %s has %q although no I/O counters were collected", body, field)
		}
	}
	if warnings := logs.withMessage(t, "Failed to fetch some disk I/O counters; I/O fields may be missing"); len(warnings) != 1 {
		t.Errorf("got %d I/O counter warnings, want 1. Log:\n%s", len(warnings), logs)
	}
}

// The released macOS agent is built without cgo, where gopsutil cannot read I/O
// counters at all and says "not implemented yet" on every run. That is how the
// platform is, not a problem that can clear, so it must not be a warning
// repeating in every macOS agent's log forever: it is said once, at Info.
func TestListDiskMetricsNotesUnsupportedIOCountersOnce(t *testing.T) {
	logs := diskCaptureLogs(t)
	diskInstallStubs(t, diskStubs{
		partitions: diskPartitionsReturning([]disk.PartitionStat{{Mountpoint: "/", Device: "/dev/disk3s1s1", Fstype: "apfs"}}, nil),
		ioCounters: func(...string) (map[string]disk.IOCountersStat, error) {
			return nil, errors.New(ioCountersNotImplemented)
		},
	})
	clock := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	diskProblems.now = func() time.Time { return clock }

	// A day of 30s runs.
	for i := 0; i < 2880; i++ {
		if got, want := diskPaths(ListDiskMetrics()), []string{"/"}; !reflect.DeepEqual(got, want) {
			t.Fatalf("run %d reported disks = %v, want %v", i, got, want)
		}
		clock = clock.Add(30 * time.Second)
	}

	if warnings := logs.withMessage(t, "Failed to fetch some disk I/O counters; I/O fields may be missing"); len(warnings) != 0 {
		t.Errorf("unsupported I/O counters logged as a warning %d times, want never", len(warnings))
	}
	notes := logs.withMessage(t, "Disk I/O counters are not supported on this platform; disk I/O fields will be omitted")
	if len(notes) != 1 {
		t.Fatalf("got %d unsupported notes over a day, want exactly 1", len(notes))
	}
	if notes[0]["level"] != "INFO" || notes[0]["source"] != "ioCounters" {
		t.Errorf("note = %v, want level INFO and source ioCounters", notes[0])
	}

	// The same text with counters returned is a partial failure somewhere else,
	// not an unsupported platform.
	diskIOCounters = func(...string) (map[string]disk.IOCountersStat, error) {
		return map[string]disk.IOCountersStat{"disk0": {}}, errors.New(ioCountersNotImplemented)
	}
	ListDiskMetrics()
	if warnings := logs.withMessage(t, "Failed to fetch some disk I/O counters; I/O fields may be missing"); len(warnings) != 1 {
		t.Errorf("got %d warnings for a not-implemented error that still returned counters, want 1", len(warnings))
	}
}

// Pin the JSON a Windows disk produces end to end - the field names are the
// contract with the server (Common/Types/Infrastructure/BasicMetrics.ts) and the
// diskPath is what dashboards and monitor criteria match on.
func TestListDiskMetricsWindowsDiskJSONShape(t *testing.T) {
	diskCaptureLogs(t)
	diskInstallStubs(t, diskStubs{
		partitions: diskPartitionsReturning([]disk.PartitionStat{windowsDrive("C:")}, nil),
		ioCounters: func(...string) (map[string]disk.IOCountersStat, error) {
			return map[string]disk.IOCountersStat{"C:": {ReadBytes: 1024, WriteBytes: 2048, ReadCount: 3, WriteCount: 4}}, nil
		},
	})

	body, err := json.Marshal(model.BasicInfrastructureMetrics{DiskMetrics: ListDiskMetrics()})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var payload struct {
		DiskMetrics []map[string]any `json:"diskMetrics"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal %s: %v", body, err)
	}
	if len(payload.DiskMetrics) != 1 {
		t.Fatalf("payload has %d disks, want 1: %s", len(payload.DiskMetrics), body)
	}

	want := map[string]any{
		"diskPath":    "C:",
		"device":      "C:",
		"fstype":      "NTFS",
		"total":       float64(100),
		"free":        float64(40),
		"used":        float64(60),
		"percentUsed": float64(60),
		"percentFree": float64(40),
		"readBytes":   float64(1024),
		"writeBytes":  float64(2048),
		"readCount":   float64(3),
		"writeCount":  float64(4),
		// gopsutil does not measure I/O time on Windows, and a zero is omitted.
	}
	if !reflect.DeepEqual(payload.DiskMetrics[0], want) {
		t.Errorf("disk JSON = %v\nwant       %v", payload.DiskMetrics[0], want)
	}
}

// A failure to list anything still serializes as null: that is the contract the
// server and dashboard already handle, and what agent.go warns about.
func TestListDiskMetricsTotalFailureSerializesAsNull(t *testing.T) {
	diskCaptureLogs(t)
	diskInstallStubs(t, diskStubs{
		partitions: diskPartitionsReturning(nil, errors.New("boom")),
	})

	body, err := json.Marshal(model.BasicInfrastructureMetrics{DiskMetrics: ListDiskMetrics()})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(body), `"diskMetrics":null`) {
		t.Errorf("payload = %s, want \"diskMetrics\":null", body)
	}
}

func TestLookupIOCounters(t *testing.T) {
	counters := map[string]disk.IOCountersStat{
		"C:":             {Name: "C:", ReadBytes: 1},
		"sda1":           {Name: "sda1", ReadBytes: 2},
		"nvme0n1p1":      {Name: "nvme0n1p1", ReadBytes: 3},
		"PhysicalDrive0": {Name: "PhysicalDrive0", ReadBytes: 4},
		"/dev/sdb1":      {Name: "exact", ReadBytes: 5},
		"sdb1":           {Name: "base", ReadBytes: 6},
	}

	tests := []struct {
		name     string
		device   string
		wantOK   bool
		wantName string
	}{
		{name: "windows drive letter matches exactly", device: "C:", wantOK: true, wantName: "C:"},
		{name: "linux device matches its base name", device: "/dev/sda1", wantOK: true, wantName: "sda1"},
		{name: "nvme partition", device: "/dev/nvme0n1p1", wantOK: true, wantName: "nvme0n1p1"},
		{name: "windows device namespace path", device: `\\.\PhysicalDrive0`, wantOK: true, wantName: "PhysicalDrive0"},
		{name: "exact key preferred over base name", device: "/dev/sdb1", wantOK: true, wantName: "exact"},
		{name: "trailing separator", device: "/dev/sda1/", wantOK: true, wantName: "sda1"},
		{name: "drive without counters", device: "D:", wantOK: false},
		{name: "device mapper name has no counters under its path", device: "/dev/mapper/vg-root", wantOK: false},
		{name: "empty device", device: "", wantOK: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := lookupIOCounters(counters, tt.device)
			if ok != tt.wantOK {
				t.Fatalf("lookupIOCounters(%q) ok = %v, want %v", tt.device, ok, tt.wantOK)
			}
			if ok && got.Name != tt.wantName {
				t.Errorf("lookupIOCounters(%q) matched %q, want %q", tt.device, got.Name, tt.wantName)
			}
		})
	}

	if _, ok := lookupIOCounters(nil, "C:"); ok {
		t.Errorf("lookupIOCounters on a nil map matched something")
	}
}

// The candidates must not depend on the OS the agent runs on: CI runs this on
// Linux, but it has to describe Windows devices correctly.
func TestIOCountersKeyCandidates(t *testing.T) {
	tests := []struct {
		device string
		want   []string
	}{
		{device: "C:", want: []string{"C:"}},
		{device: `C:\`, want: []string{`C:\`, "C:"}},
		{device: "/dev/sda1", want: []string{"/dev/sda1", "sda1"}},
		{device: "/dev/sda1/", want: []string{"/dev/sda1/", "/dev/sda1", "sda1"}},
		{device: " sda1 ", want: []string{" sda1 ", "sda1"}},
		{device: `\\.\PhysicalDrive0`, want: []string{`\\.\PhysicalDrive0`, "PhysicalDrive0"}},
		{device: "sda1", want: []string{"sda1"}},
		{device: "/", want: []string{"/"}},
		{device: "", want: nil},
	}

	for _, tt := range tests {
		if got := ioCountersKeyCandidates(tt.device); !reflect.DeepEqual(got, tt.want) {
			t.Errorf("ioCountersKeyCandidates(%q) = %q, want %q", tt.device, got, tt.want)
		}
	}
}

func TestDescribeDiskError(t *testing.T) {
	denied := errors.New("Access is denied.")

	tests := []struct {
		name string
		err  error
		want []string
	}{
		{name: "nil", err: nil, want: nil},
		{name: "plain error", err: denied, want: []string{"Access is denied."}},
		{name: "warnings in order", err: &disk.Warnings{List: []error{bitLockerError, denied}}, want: []string{bitLockerError.Error(), "Access is denied."}},
		{name: "nil warning entry", err: &disk.Warnings{List: []error{nil}}, want: []string{"unknown drive error (Windows returned no error code)"}},
		{name: "wrapped warnings", err: fmt.Errorf("wrapped: %w", &disk.Warnings{List: []error{denied}}), want: []string{"Access is denied."}},
		{name: "empty warnings", err: &disk.Warnings{}, want: []string{}},
		{name: "deadline", err: context.DeadlineExceeded, want: []string{"context deadline exceeded"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := describeDiskError(tt.err); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("describeDiskError() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestMissingDrives(t *testing.T) {
	tests := []struct {
		name       string
		expected   []string
		partitions []disk.PartitionStat
		want       []string
	}{
		{name: "some missing", expected: []string{"C:", "D:", "Z:"}, partitions: []disk.PartitionStat{windowsDrive("C:")}, want: []string{"D:", "Z:"}},
		{name: "none missing", expected: []string{"C:", "D:"}, partitions: []disk.PartitionStat{windowsDrive("D:"), windowsDrive("C:")}, want: nil},
		{name: "case and trailing separator insensitive", expected: []string{`c:\`, "D:"}, partitions: []disk.PartitionStat{windowsDrive("C:"), {Mountpoint: `d:/`}}, want: nil},
		{name: "nothing expected", expected: nil, partitions: []disk.PartitionStat{windowsDrive("C:")}, want: nil},
		{name: "nothing listed", expected: []string{"C:"}, partitions: nil, want: []string{"C:"}},
		{name: "empty expected entry ignored", expected: []string{""}, partitions: nil, want: nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := missingDrives(tt.expected, tt.partitions); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("missingDrives() = %q, want %q", got, tt.want)
			}
		})
	}
}

// The production repeat interval is only a limit if it is far longer than the
// 30s collection interval, and only useful if a persisting problem still shows
// up in the last 50 log lines the docs tell users to read - about 25 minutes of
// 30s runs, each logging a line of its own.
func TestDiskProblemRepeatIntervalFitsTheCollectionCadence(t *testing.T) {
	if diskProblemRepeatInterval < 5*time.Minute || diskProblemRepeatInterval > 20*time.Minute {
		t.Fatalf("diskProblemRepeatInterval = %v, want between 5m and 20m", diskProblemRepeatInterval)
	}
	if diskProblems.interval != diskProblemRepeatInterval {
		t.Fatalf("diskProblems.interval = %v, want diskProblemRepeatInterval (%v)", diskProblems.interval, diskProblemRepeatInterval)
	}
}

// Collection runs every 30 seconds. A drive that stays unreadable must not add
// a warning to the log twice a minute forever: it is logged when it appears,
// again when the errors change or the repeat interval has passed, and once
// more when it clears.
func TestDiskProblemLogLimitsRepeatedWarnings(t *testing.T) {
	logs := diskCaptureLogs(t)

	warning := error(&disk.Warnings{List: []error{bitLockerError}})
	partitions := []disk.PartitionStat{windowsDrive("C:")}
	diskInstallStubs(t, diskStubs{
		partitions: func(context.Context, bool) ([]disk.PartitionStat, error) {
			return partitions, warning
		},
	})
	clock := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	diskProblems.now = func() time.Time { return clock }

	const partialMsg = "Some disk partitions could not be read; reporting the readable ones"
	const listingMsg = "Failed to list disk partitions; no disk metrics will be reported"
	const resolvedMsg = "Disk collection problem resolved"
	count := func(msg string) int { return len(logs.withMessage(t, msg)) }

	// Every 30s run up to, but not including, the repeat interval.
	runs := int(diskProblemRepeatInterval / (30 * time.Second))
	for i := 0; i < runs; i++ {
		ListDiskMetrics()
		clock = clock.Add(30 * time.Second)
	}
	if got := count(partialMsg); got != 1 {
		t.Fatalf("after %d runs 30s apart with the same warning: %d warnings logged, want 1. Log:\n%s", runs, got, logs)
	}

	// Exactly one repeat interval after the first warning.
	ListDiskMetrics()
	if got := count(partialMsg); got != 2 {
		t.Fatalf("after the repeat interval: %d warnings logged, want 2 (a persisting problem is repeated)", got)
	}
	clock = clock.Add(30 * time.Second)
	ListDiskMetrics()
	if got := count(partialMsg); got != 2 {
		t.Fatalf("30s after the repeat: %d warnings logged, want still 2", got)
	}

	warning = &disk.Warnings{List: []error{errors.New("The volume does not contain a recognized file system.")}}
	ListDiskMetrics()
	if got := count(partialMsg); got != 3 {
		t.Fatalf("after the errors changed: %d warnings logged, want 3 (a different problem is logged at once)", got)
	}

	// Losing every partition turns the warning into an error, which is a new
	// problem and must be logged straight away.
	partitions = nil
	ListDiskMetrics()
	if got := count(listingMsg); got != 1 {
		t.Fatalf("after listing failed entirely: %d listing errors logged, want 1", got)
	}

	partitions, warning = []disk.PartitionStat{windowsDrive("C:")}, nil
	ListDiskMetrics()
	ListDiskMetrics()
	resolved := logs.withMessage(t, resolvedMsg)
	if len(resolved) != 1 {
		t.Fatalf("after the problem cleared: %d resolved records, want exactly 1. Log:\n%s", len(resolved), logs)
	}
	if resolved[0]["level"] != "INFO" || resolved[0]["source"] != "partitions" {
		t.Errorf("resolved record = %v, want level INFO and source partitions", resolved[0])
	}

	// A problem that comes back after clearing is new again.
	warning = &disk.Warnings{List: []error{bitLockerError}}
	ListDiskMetrics()
	if got := count(partialMsg); got != 4 {
		t.Errorf("after the problem returned: %d warnings logged, want 4", got)
	}
}

// Windows' error text does not say which drive it is about, so when one locked
// drive is unlocked and another locked in its place the errors are identical.
// The drive list has to count as part of the problem, or the log would keep
// pointing at the old drive until the repeat interval passed.
func TestDiskProblemLogReportsADifferentUnreadableDriveAtOnce(t *testing.T) {
	logs := diskCaptureLogs(t)
	missing := "E:"
	diskInstallStubs(t, diskStubs{
		partitions: diskPartitionsReturning(
			[]disk.PartitionStat{windowsDrive("C:")},
			&disk.Warnings{List: []error{bitLockerError}},
		),
		expectedDrives: func() []string { return []string{"C:", missing} },
	})
	clock := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	diskProblems.now = func() time.Time { return clock }

	ListDiskMetrics()
	clock = clock.Add(30 * time.Second)
	ListDiskMetrics()

	missing = "F:"
	clock = clock.Add(30 * time.Second)
	ListDiskMetrics()

	warnings := logs.withMessage(t, "Some disk partitions could not be read; reporting the readable ones")
	if len(warnings) != 2 {
		t.Fatalf("got %d warnings, want 2: one for E:, then one for F: as soon as it changed. Log:\n%s", len(warnings), logs)
	}
	for i, want := range []string{"E:", "F:"} {
		if got := diskAttrStrings(t, warnings[i], "unreadableDrives"); !reflect.DeepEqual(got, []string{want}) {
			t.Errorf("warning %d unreadableDrives = %v, want [%s]", i, got, want)
		}
	}
}

// Each problem source - usage, I/O counters, nothing measured - must be logged
// at WARN, must log that it resolved once it clears, and must be logged again
// straight away if it then comes back. Without the resolve, a problem that
// clears and returns with the same errors inside the repeat interval would go
// unlogged the second time.
func TestDiskProblemSourcesWarnResolveAndRecur(t *testing.T) {
	cases := []struct {
		name   string
		source string
		msg    string
		stubs  func(bad *bool) diskStubs
	}{
		{
			name:   "usage",
			source: "usage",
			msg:    "Failed to read disk usage for some partitions; skipping them",
			stubs: func(bad *bool) diskStubs {
				return diskStubs{
					partitions: diskPartitionsReturning([]disk.PartitionStat{windowsDrive("C:"), windowsDrive("D:")}, nil),
					usage: func(path string) (*disk.UsageStat, error) {
						if *bad && path == "D:" {
							return nil, errors.New("The device is not ready.")
						}
						return diskUsageOf(100, 40)(path)
					},
				}
			},
		},
		{
			name:   "io counters",
			source: "ioCounters",
			msg:    "Failed to fetch some disk I/O counters; I/O fields may be missing",
			stubs: func(bad *bool) diskStubs {
				return diskStubs{
					partitions: diskPartitionsReturning([]disk.PartitionStat{windowsDrive("C:")}, nil),
					ioCounters: func(...string) (map[string]disk.IOCountersStat, error) {
						if *bad {
							return nil, errors.New("Incorrect function.")
						}
						return map[string]disk.IOCountersStat{}, nil
					},
				}
			},
		},
		{
			name:   "nothing measured",
			source: "empty",
			msg:    "No disk could be measured; disk metrics will be empty",
			stubs: func(bad *bool) diskStubs {
				return diskStubs{
					partitions: func(context.Context, bool) ([]disk.PartitionStat, error) {
						if *bad {
							return []disk.PartitionStat{}, nil
						}
						return []disk.PartitionStat{windowsDrive("C:")}, nil
					},
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logs := diskCaptureLogs(t)
			bad := false
			diskInstallStubs(t, tc.stubs(&bad))
			clock := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
			diskProblems.now = func() time.Time { return clock }

			for _, state := range []bool{true, false, false, true} {
				bad = state
				ListDiskMetrics()
				clock = clock.Add(30 * time.Second)
			}

			problems := logs.withMessage(t, tc.msg)
			if len(problems) != 2 {
				t.Fatalf("got %d %q records, want 2 (logged, resolved, logged again on return). Log:\n%s", len(problems), tc.msg, logs)
			}
			for _, record := range problems {
				if record["level"] != "WARN" || record["source"] != tc.source {
					t.Errorf("record = %v, want level WARN and source %s", record, tc.source)
				}
			}

			resolved := logs.withMessage(t, "Disk collection problem resolved")
			if len(resolved) != 1 {
				t.Fatalf("got %d resolved records, want exactly 1. Log:\n%s", len(resolved), logs)
			}
			if resolved[0]["level"] != "INFO" || resolved[0]["source"] != tc.source {
				t.Errorf("resolved record = %v, want level INFO and source %s", resolved[0], tc.source)
			}
		})
	}
}

// Every problem source is limited independently, and the errors are compared
// regardless of order, since gopsutil walks drives in a fixed order but usage
// failures are collected per run.
func TestDiskProblemLogTracksSourcesIndependently(t *testing.T) {
	logs := diskCaptureLogs(t)
	problems := newDiskProblemLog(diskProblemRepeatInterval)
	clock := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	problems.now = func() time.Time { return clock }

	problems.report(slog.LevelWarn, "a", []string{"x", "y"}, "problem a")
	problems.report(slog.LevelWarn, "b", []string{"x", "y"}, "problem b")
	problems.report(slog.LevelWarn, "a", []string{"y", "x"}, "problem a")
	problems.resolve("b")
	problems.resolve("b")
	problems.resolve("never-reported")

	// A note is never repeated just because time passed, unlike a report.
	problems.note(slog.LevelInfo, "c", []string{"x"}, "note c")
	clock = clock.Add(24 * time.Hour)
	problems.note(slog.LevelInfo, "c", []string{"x"}, "note c")
	if got := len(logs.withMessage(t, "note c")); got != 1 {
		t.Errorf("note c logged %d times over a day, want 1", got)
	}
	problems.note(slog.LevelInfo, "c", []string{"z"}, "note c")
	if got := len(logs.withMessage(t, "note c")); got != 2 {
		t.Errorf("note c logged %d times after its errors changed, want 2", got)
	}

	if got := len(logs.withMessage(t, "problem a")); got != 1 {
		t.Errorf("problem a logged %d times, want 1 (same errors in a different order are the same problem)", got)
	}
	if got := len(logs.withMessage(t, "problem b")); got != 1 {
		t.Errorf("problem b logged %d times, want 1", got)
	}
	resolved := logs.withMessage(t, "Disk collection problem resolved")
	if len(resolved) != 1 || resolved[0]["source"] != "b" {
		t.Errorf("resolved records = %v, want exactly one, for source b", resolved)
	}
	for _, record := range logs.withMessage(t, "problem a") {
		if record["source"] != "a" || record["level"] != "WARN" {
			t.Errorf("record = %v, want source a at WARN", record)
		}
	}
}

// The scheduler does not stop a slow collection from overlapping the next one,
// so the problem log is shared between concurrent runs. Run under -race (as CI
// does) this also proves the shared state is synchronized.
func TestDiskProblemLogIsSafeForConcurrentRuns(t *testing.T) {
	logs := diskCaptureLogs(t)
	diskInstallStubs(t, diskStubs{
		partitions: diskPartitionsReturning(
			[]disk.PartitionStat{windowsDrive("C:")},
			&disk.Warnings{List: []error{bitLockerError}},
		),
	})

	const runs = 8
	var wg sync.WaitGroup
	results := make([][]*model.BasicDiskMetrics, runs)
	for i := 0; i < runs; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i] = ListDiskMetrics()
		}(i)
	}
	wg.Wait()

	for i, metrics := range results {
		if got, want := diskPaths(metrics), []string{"C:"}; !reflect.DeepEqual(got, want) {
			t.Errorf("run %d reported %v, want %v", i, got, want)
		}
	}
	if got := len(logs.withMessage(t, "Some disk partitions could not be read; reporting the readable ones")); got != 1 {
		t.Errorf("%d concurrent runs logged the same warning %d times, want 1", runs, got)
	}
}

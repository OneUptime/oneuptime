package utils

import (
	"bufio"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"testing"
	"time"

	"oneuptime-infrastructure-agent/model"

	"github.com/shirou/gopsutil/v4/process"
)

// A process's CPU% is the CPU it used since the previous collection, as a
// percent of one core - not gopsutil's Process.CPUPercent, which divides all
// the CPU a process has used since it started by its age: a lifetime average
// that barely moves and does not follow the load.
//
// None of these use t.Parallel: the previous collection's readings are
// package-level state.

func TestCpuPercentSince(t *testing.T) {
	start := time.Date(2026, 10, 19, 11, 30, 0, 0, time.UTC)
	at := func(seconds float64) time.Time {
		return start.Add(time.Duration(seconds * float64(time.Second)))
	}
	reading := func(createTimeMs int64, cpuSeconds float64, seconds float64) processCPUReading {
		return processCPUReading{createTimeMs: createTimeMs, cpuSeconds: cpuSeconds, at: at(seconds)}
	}

	cases := []struct {
		name        string
		previous    processCPUReading
		hasPrevious bool
		current     processCPUReading
		percent     float64
		ok          bool
	}{
		{"a quarter of a core over the agent's 30 seconds", reading(1, 50, 0), true, reading(1, 57.5, 30), 25, true},
		{"one and a half cores", reading(1, 10, 0), true, reading(1, 55, 30), 150, true},
		{"idle", reading(1, 10, 0), true, reading(1, 10, 30), 0, true},
		{"10 ms of CPU per second is 1%", reading(1, 3, 0), true, reading(1, 3.3, 30), 1, true},
		{"any interval", reading(1, 3, 0), true, reading(1, 3.47, 47), 1, true},
		{"the process's first collection", processCPUReading{}, false, reading(1, 10, 30), 0, false},
		{"its PID now belongs to another process", reading(1, 900, 0), true, reading(2, 1, 30), 0, false},
		{"no time has passed", reading(1, 10, 30), true, reading(1, 11, 30), 0, false},
		{"the clock went back", reading(1, 10, 30), true, reading(1, 11, 0), 0, false},
		{"the counter went backwards", reading(1, 10, 0), true, reading(1, 9, 30), 0, false},
	}

	for _, c := range cases {
		percent, ok := cpuPercentSince(c.previous, c.hasPrevious, c.current)
		if ok != c.ok || math.Abs(percent-c.percent) > 1e-9 {
			t.Errorf("%s: got (%v, %v), want (%v, %v)", c.name, percent, ok, c.percent, c.ok)
		}
	}
}

// ownProcess is this test binary's entry in a collection.
// listedProcess returns the process with pid from a collection.
func listedProcess(t *testing.T, processes []*model.ServerProcess, pid int32) *model.ServerProcess {
	t.Helper()
	for _, p := range processes {
		if p.Pid == pid {
			return p
		}
	}
	t.Fatalf("the collection does not list process %d", pid)
	return nil
}

func ownProcess(t *testing.T, processes []*model.ServerProcess) *model.ServerProcess {
	t.Helper()
	return listedProcess(t, processes, int32(os.Getpid()))
}

// spinThenIdleEnv marks the re-executed child process below, and
// spinThenIdleSpun is the line it prints once its core is idle again.
const (
	spinThenIdleEnv  = "ONEUPTIME_AGENT_TEST_SPIN_THEN_IDLE"
	spinThenIdleSpun = "spun, now idle"
)

// TestSpinThenIdleHelperProcess is not a standalone test: it is the child
// process that startSpinThenIdle starts. It keeps a core busy, says so, and
// then idles until its standard input is closed.
func TestSpinThenIdleHelperProcess(t *testing.T) {
	if os.Getenv(spinThenIdleEnv) != "1" {
		t.Skip("helper process, only runs when re-executed by the parent test")
	}

	spin(800 * time.Millisecond)
	fmt.Println(spinThenIdleSpun)
	_, _ = io.Copy(io.Discard, os.Stdin)
}

// startSpinThenIdle starts TestSpinThenIdleHelperProcess, waits until it has
// kept its core busy and is idle, and returns its PID. The process is killed
// when the test ends.
func startSpinThenIdle(t *testing.T) int32 {
	t.Helper()

	cmd := exec.Command(os.Args[0], "-test.run=^TestSpinThenIdleHelperProcess$")
	cmd.Env = append(os.Environ(), spinThenIdleEnv+"=1")
	// The helper idles reading its standard input, which closes if this
	// process dies first.
	if _, err := cmd.StdinPipe(); err != nil {
		t.Fatalf("could not make the helper process's standard input: %v", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("could not read the helper process's output: %v", err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("could not start the helper process: %v", err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	})

	spun := make(chan bool, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if scanner.Text() == spinThenIdleSpun {
				spun <- true
				return
			}
		}
		spun <- false
	}()

	select {
	case ok := <-spun:
		if !ok {
			t.Fatal("the helper process exited before it had kept a core busy")
		}
	case <-time.After(30 * time.Second):
		t.Fatal("the helper process had not kept a core busy within 30s")
	}

	return int32(cmd.Process.Pid)
}

// spin keeps one core busy for d.
func spin(d time.Duration) {
	deadline := time.Now().Add(d)
	x := 0
	for time.Now().Before(deadline) {
		x++
	}
	_ = x
}

func resetProcessCPUReadings() {
	processCPUReadingsMu.Lock()
	processCPUReadings = map[int32]processCPUReading{}
	processCPUReadingsMu.Unlock()
}

func TestGetServerProcessesReportsCPUOnlyFromTheSecondCollection(t *testing.T) {
	resetProcessCPUReadings()

	first := ownProcess(t, GetServerProcesses())
	if first.CPUPercent != 0 {
		t.Fatalf("first collection: CPU%% %v, want none (nothing to compare with)", first.CPUPercent)
	}

	spin(400 * time.Millisecond)

	second := ownProcess(t, GetServerProcesses())
	if second.CPUPercent < 20 {
		t.Fatalf("second collection after keeping a core busy: CPU%% %v, want at least 20", second.CPUPercent)
	}
}

// The regression: busy first, then idle between two collections. The lifetime
// average (gopsutil's CPUPercent) still remembers the busy part; the CPU% the
// agent reports is what the process used between the collections - next to
// nothing.
//
// The process that is busy and then idle is a helper process, not this one.
// The collections run in this process, and where there are many processes to
// list a collection keeps it busy for seconds - on a Mac listing 500, a
// quarter of a core for six seconds - so this process is never idle between
// two of them.
func TestGetServerProcessesFollowsTheLoadRatherThanTheLifetimeAverage(t *testing.T) {
	resetProcessCPUReadings()
	pid := startSpinThenIdle(t)

	listedProcess(t, GetServerProcesses(), pid)
	time.Sleep(800 * time.Millisecond)
	idle := listedProcess(t, GetServerProcesses(), pid)

	helper, err := process.NewProcess(pid)
	if err != nil {
		t.Fatalf("reading the helper process: %v", err)
	}
	lifetime, err := helper.CPUPercent()
	if err != nil {
		t.Fatalf("reading the helper process's lifetime CPU percent: %v", err)
	}

	if lifetime <= 0 {
		t.Fatalf("lifetime CPU%% %v: the spin did not register", lifetime)
	}
	if idle.CPUPercent >= lifetime/2 {
		t.Fatalf("idle interval: CPU%% %v, want well under the lifetime average %v", idle.CPUPercent, lifetime)
	}
}

func TestGetServerProcessesForgetsExitedProcesses(t *testing.T) {
	resetProcessCPUReadings()
	processCPUReadingsMu.Lock()
	// A PID no process has: math.MaxInt32 is above every OS's PID limit.
	processCPUReadings[math.MaxInt32] = processCPUReading{createTimeMs: 1, cpuSeconds: 1, at: time.Now()}
	processCPUReadingsMu.Unlock()

	GetServerProcesses()

	processCPUReadingsMu.Lock()
	defer processCPUReadingsMu.Unlock()
	if _, kept := processCPUReadings[math.MaxInt32]; kept {
		t.Fatalf("the reading of a process that is gone was kept")
	}
	if _, kept := processCPUReadings[int32(os.Getpid())]; !kept {
		t.Fatalf("this process's reading was not kept for the next collection")
	}
}

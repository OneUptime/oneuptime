package main

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// This file is the regression net for the go/clear-text-logging fix. The
// behavioural tests in agent_test.go can only cover the call sites that exist
// today, and main.go's "configure" branch is inline in main() so it cannot be
// exercised in-process at all. This guard instead reads the package's own
// source and fails if ANY logging call anywhere passes a secret-naming
// expression to a logger without wrapping it in an approved redactor - which
// catches a brand new direct reference at a brand new call site.
//
// SCOPE - read this before reading a green run as "no secret can reach a log".
// This is a NAME-BASED SYNTACTIC check with no type information and no taint
// tracking. It sees an expression handed to a logger and asks whether that
// expression names a secret (secretKey, cfg.SecretKey, ProxyPassword, ...).
// It therefore does NOT catch:
//
//   - a secret laundered through an intermediate variable, e.g.
//     `msg := "Secret key: " + secretKey; slog.Info(msg)` - the logging call
//     mentions only `msg`;
//   - a secret held in a field or local with an unlisted name (Token, ApiKey,
//     Credential, ...): guardSecretIdentifiers is a fixed list;
//   - a value DERIVED from a secret, above all an error. net/http returns a
//     *url.Error whose text embeds the requested URL, so logging that error
//     discloses the secret path segment with no secret-named identifier
//     anywhere in the logging call. agent.go does exactly this on both of its
//     transport-error paths and this guard is blind to both of them; they are
//     covered instead by the behavioural tests
//     TestCollectMetricsJobTransportErrorLogsNoSecret and
//     TestCheckIfSecretKeyIsValidTransportErrorLogsNoSecret in agent_test.go.
//
// Closing those gaps properly needs types and dataflow
// (golang.org/x/tools/go/analysis), which the module cannot take on as a
// dependency. The cheap syntactic approximations - "flag any err logged inside
// a function with a secret-named parameter" - fire on error values that
// provably cannot carry the secret (json.Marshal failures, response-body read
// failures), and a guard people learn to excuse is worse than one with a
// documented boundary.
//
// A static guard's other failure mode is passing vacuously: if the matcher stops
// matching (a rename, an import alias, a refactor) it reports zero violations
// and looks green forever. Three things defend against that:
//   - the walker's own counters are asserted (it must see >20 slog call sites
//     and must have excused the 2 known utils.MaskSecret sites),
//   - the analyser is self-tested against in-memory source with known
//     violations, so "no violations" is distinguishable from "analyser broken",
//   - a second, deliberately dumb textual scan runs the same check by substring.

// guardSecretIdentifiers holds the canonical (lower-cased, underscore-stripped)
// names that must never reach a logger unredacted. Canonicalising means one
// entry covers secretKey / SecretKey / secret_key / SECRET_KEY alike.
//
// The proxy credential fields exist on ConfigFile (config.go) and are just as
// sensitive as the monitor key, so they are guarded here too even though
// nothing logs them today - that is exactly the leak this test exists to catch.
var guardSecretIdentifiers = map[string]bool{
	"secretkey":     true,
	"proxypassword": true,
	"proxyusername": true,
}

// guardApprovedRedactors are the only functions that may be handed a secret
// inside a logging call. Both the qualified and the unqualified spelling are
// listed because utils' own files would call these without a package qualifier.
//
// This has to stay a whitelist of things that provably drop the secret, not a
// list of "functions that look like they clean something up": wrapping a secret
// in strings.ToUpper or fmt.Sprintf still logs it. RedactSecret is here because
// it is the sanctioned way to log a value that CARRIES a secret without naming
// one - an error whose text embeds a secret-bearing URL - and a guard that
// rejected its own recommended fix would just get switched off.
var guardApprovedRedactors = map[string]bool{
	"utils.MaskSecret":   true,
	"MaskSecret":         true,
	"utils.RedactSecret": true,
	"RedactSecret":       true,
}

// guardLoggerMethods are the slog logging verbs. They are matched by method
// name on any receiver, not just on the slog package, so that *slog.Logger
// values (slog.Default().Error(...), logger.Info(...)) are covered without
// needing full type resolution.
var guardLoggerMethods = map[string]bool{
	"Debug":        true,
	"Info":         true,
	"Warn":         true,
	"Error":        true,
	"DebugContext": true,
	"InfoContext":  true,
	"WarnContext":  true,
	"ErrorContext": true,
	"Log":          true,
	"LogAttrs":     true,
	// With attaches attributes that every later record carries, so it is a log
	// sink for the purposes of this guard.
	"With": true,
}

// guardPackageSinks are the non-slog sinks that also end up in front of a user
// or in a redirected log file.
var guardPackageSinks = map[string]bool{
	"fmt.Print":    true,
	"fmt.Printf":   true,
	"fmt.Println":  true,
	"fmt.Fprint":   true,
	"fmt.Fprintf":  true,
	"fmt.Fprintln": true,
	"log.Print":    true,
	"log.Printf":   true,
	"log.Println":  true,
	"log.Fatal":    true,
	"log.Fatalf":   true,
	"log.Fatalln":  true,
	"log.Panic":    true,
	"log.Panicf":   true,
	"log.Panicln":  true,
}

// guardBuiltinSinks covers the predeclared print builtins.
var guardBuiltinSinks = map[string]bool{
	"print":   true,
	"println": true,
}

const (
	// guardMinSlogCallSites is the anti-vacuity floor. The walker sees 81
	// slog.<verb>(...) call sites across the 23 scanned files today, so the
	// floor is set just under 80% of that: close enough that a matcher which
	// quietly stops recognising a callee shape, an import alias or a whole file
	// is caught, far enough that ordinary churn does not trip it. A floor of 20
	// (the original value) would have let the walker lose three quarters of its
	// reach and still report a clean, meaningless zero.
	//
	// If a refactor legitimately removes this much logging, raise or lower this
	// number deliberately and say why - do not treat it as noise.
	guardMinSlogCallSites = 65

	// guardMinExcusedSites is the number of utils.MaskSecret-wrapped secret
	// references the walker must find: agent.go's startup banner and main.go's
	// "configure" banner. If these drop to zero the excuse path is dead code and
	// the walker is no longer looking at the code it is supposed to guard.
	guardMinExcusedSites = 2
)

// guardCallKind classifies a call expression as a logging sink (or not).
type guardCallKind int

const (
	guardNotASink guardCallKind = iota
	guardSlogPackageCall
	guardLoggerMethodCall
	guardPrintSink
)

// guardFinding is one reference to a secret-naming expression inside a logging
// call, with enough context to fix it without re-running the analyser.
type guardFinding struct {
	pos  token.Position
	expr string // the offending expression, rendered back to source
	call string // the enclosing logging call, rendered back to source
}

func (f guardFinding) String() string {
	return fmt.Sprintf("%s:%d:%d: %s\n        in: %s", f.pos.Filename, f.pos.Line, f.pos.Column, f.expr, f.call)
}

// guardScanner walks Go source looking for secrets handed to loggers.
type guardScanner struct {
	fset *token.FileSet

	files     []string
	sinkCalls int // every logging sink seen, slog or otherwise
	slogCalls int // sinks whose callee is literally slog.<verb>

	violations []guardFinding
	excused    []guardFinding

	// seen de-duplicates findings, because a violation nested inside two sinks
	// (fmt.Println(logger.Info(...)) and friends) would otherwise be reported
	// once per enclosing sink.
	seen map[string]bool
}

func guardNewScanner() *guardScanner {
	return &guardScanner{fset: token.NewFileSet(), seen: map[string]bool{}}
}

// guardParseAndScan parses one file (src may be nil to read from disk, or a
// string for the analyser's own self-tests) and scans it.
func (s *guardScanner) guardParseAndScan(t *testing.T, path string, src any) {
	t.Helper()

	file, err := parser.ParseFile(s.fset, path, src, parser.SkipObjectResolution)
	if err != nil {
		t.Fatalf("could not parse %s: %v", path, err)
	}
	s.files = append(s.files, path)
	s.guardScanFile(file)
}

// guardScanFile finds every logging call in the file and inspects its
// arguments.
func (s *guardScanner) guardScanFile(file *ast.File) {
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}

		kind := guardClassifyCall(call)
		if kind == guardNotASink {
			return true
		}

		s.sinkCalls++
		if kind == guardSlogPackageCall {
			s.slogCalls++
		}
		for _, arg := range call.Args {
			s.guardInspectLogArg(call, arg, false)
		}
		// Keep descending: a sink can be nested inside another expression.
		return true
	})
}

// guardInspectLogArg walks one argument of a logging call. redacted is true
// once the walk is inside an approved redactor's argument list, which is the
// only way a secret reference is excused.
func (s *guardScanner) guardInspectLogArg(call *ast.CallExpr, expr ast.Expr, redacted bool) {
	ast.Inspect(expr, func(n ast.Node) bool {
		switch node := n.(type) {
		case *ast.CallExpr:
			if guardApprovedRedactors[guardFuncName(node.Fun)] {
				// Only the redactor's return value reaches the logger, so
				// everything it is given is excused. Re-entering with
				// redacted=true (instead of just skipping) keeps the excused
				// references countable, which is what the anti-vacuity
				// assertion in the main test relies on.
				for _, arg := range node.Args {
					s.guardInspectLogArg(call, arg, true)
				}
				return false
			}
		case *ast.KeyValueExpr:
			// In a composite literal only the value is data; the key is a field
			// name, so Report{SecretKey: masked} must not be flagged for its
			// key while its value is still checked.
			s.guardInspectLogArg(call, node.Value, redacted)
			return false
		case *ast.SelectorExpr:
			// Matched at the selector (cfg.SecretKey) and not descended into,
			// so the Sel identifier is not reported a second time.
			if guardIsSecretName(node.Sel.Name) {
				s.guardRecord(call, node, redacted)
				return false
			}
		case *ast.Ident:
			if guardIsSecretName(node.Name) {
				s.guardRecord(call, node, redacted)
				return false
			}
		}
		return true
	})
}

func (s *guardScanner) guardRecord(call *ast.CallExpr, expr ast.Expr, redacted bool) {
	finding := guardFinding{
		pos:  s.fset.Position(expr.Pos()),
		expr: guardRender(s.fset, expr),
		call: guardTruncate(guardRender(s.fset, call), 160),
	}

	key := fmt.Sprintf("%v|%s|%t", finding.pos, finding.expr, redacted)
	if s.seen[key] {
		return
	}
	s.seen[key] = true

	if redacted {
		s.excused = append(s.excused, finding)
		return
	}
	s.violations = append(s.violations, finding)
}

// guardClassifyCall decides whether a call is a logging sink.
//
// Calls with no arguments are never sinks. That is not just an optimisation: it
// is what keeps the error interface's err.Error() from being mistaken for
// slog.Error(...), since the two are indistinguishable by name alone.
func guardClassifyCall(call *ast.CallExpr) guardCallKind {
	if len(call.Args) == 0 {
		return guardNotASink
	}

	switch fun := call.Fun.(type) {
	case *ast.SelectorExpr:
		if pkg, ok := fun.X.(*ast.Ident); ok {
			if guardPackageSinks[pkg.Name+"."+fun.Sel.Name] {
				return guardPrintSink
			}
			// utils/logger.go imports the package as `slog "log/slog"`, and any
			// other alias still gets caught by the method-name rule below.
			if pkg.Name == "slog" && guardLoggerMethods[fun.Sel.Name] {
				return guardSlogPackageCall
			}
		}
		if guardLoggerMethods[fun.Sel.Name] {
			// A *slog.Logger value: slog.Default().Error(...), logger.Info(...).
			return guardLoggerMethodCall
		}
	case *ast.Ident:
		if guardBuiltinSinks[fun.Name] {
			return guardPrintSink
		}
	}

	return guardNotASink
}

// guardIsSecretName reports whether an identifier names a secret, ignoring case
// and underscores so secretKey, SecretKey and secret_key all match.
func guardIsSecretName(name string) bool {
	canonical := strings.ToLower(strings.ReplaceAll(name, "_", ""))
	return guardSecretIdentifiers[canonical]
}

// guardFuncName renders a callee as "pkg.Func" or "Func". It deliberately does
// not use the printer: no FileSet is needed and method values on complex
// receivers are simply not approved redactors.
func guardFuncName(fun ast.Expr) string {
	switch f := fun.(type) {
	case *ast.Ident:
		return f.Name
	case *ast.SelectorExpr:
		if x, ok := f.X.(*ast.Ident); ok {
			return x.Name + "." + f.Sel.Name
		}
	}
	return ""
}

func guardRender(fset *token.FileSet, node ast.Node) string {
	var buf bytes.Buffer
	if err := format.Node(&buf, fset, node); err != nil {
		return fmt.Sprintf("<unprintable %T: %v>", node, err)
	}
	return strings.Join(strings.Fields(buf.String()), " ")
}

func guardTruncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

// guardPackageDir returns the directory that holds this test file.
//
// `go test` runs the binary with the package directory as the working
// directory, so "." would be correct; runtime.Caller is preferred because it
// keeps the guard pointed at the right tree even when the compiled test binary
// is executed from somewhere else (agent_test.go re-executes os.Args[0]).
// The working directory is kept as a fallback for the cross-compiled case where
// the recorded source path does not exist on this machine.
func guardPackageDir(t *testing.T) string {
	t.Helper()

	if _, thisFile, _, ok := runtime.Caller(0); ok {
		dir := filepath.Dir(thisFile)
		if _, err := os.Stat(filepath.Join(dir, "agent.go")); err == nil {
			return dir
		}
	}
	if _, err := os.Stat("agent.go"); err != nil {
		t.Fatalf("cannot locate the InfrastructureAgent package source from the working directory: %v", err)
	}
	return "."
}

// guardSourceFiles lists every non-test .go file in the given directories.
func guardSourceFiles(t *testing.T, dirs []string) []string {
	t.Helper()

	var files []string
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatalf("could not read source directory %s: %v", dir, err)
		}
		for _, entry := range entries {
			name := entry.Name()
			if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
				continue
			}
			files = append(files, filepath.Join(dir, name))
		}
	}
	return files
}

// TestGuardNoSecretIsPassedToALoggerUnredacted is the guard itself.
func TestGuardNoSecretIsPassedToALoggerUnredacted(t *testing.T) {
	dir := guardPackageDir(t)
	files := guardSourceFiles(t, []string{
		dir,
		filepath.Join(dir, "utils"),
		filepath.Join(dir, "model"),
	})

	// Pin the files that must be in the scan. Without this the guard would
	// silently stop covering a file that got moved or renamed.
	scanned := map[string]bool{}
	for _, path := range files {
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			t.Fatalf("could not relativise %s against %s: %v", path, dir, err)
		}
		scanned[filepath.ToSlash(rel)] = true
	}
	for _, want := range []string{
		"agent.go",
		"main.go",
		"config.go",
		"shutdown.go",
		"utils/logger.go",
		"utils/redact.go",
		"model/server_monitor_report.go",
	} {
		if !scanned[want] {
			t.Fatalf("%s was not picked up by the scan; the guard is not covering the package. Scanned: %v", want, files)
		}
	}

	scanner := guardNewScanner()
	for _, path := range files {
		scanner.guardParseAndScan(t, path, nil)
	}

	for _, violation := range scanner.violations {
		t.Errorf("a secret is passed to a logger without redaction:\n    %s\n    wrap it in utils.MaskSecret(...) or log utils.RedactedPlaceholder instead", violation)
	}

	// Anti-vacuity #1: the walker must actually be finding logging calls. A
	// matcher that quietly stops matching reports zero violations forever.
	if scanner.slogCalls <= guardMinSlogCallSites {
		t.Errorf("the walker only saw %d slog call sites across %d files (want more than %d); it has stopped matching and its clean report means nothing",
			scanner.slogCalls, len(scanner.files), guardMinSlogCallSites)
	}
	if scanner.sinkCalls < scanner.slogCalls {
		t.Errorf("sink count %d is below the slog count %d; the counters are inconsistent", scanner.sinkCalls, scanner.slogCalls)
	}

	// Anti-vacuity #2: the two known-good sites must still be found AND excused.
	// If they vanish, either the redaction was removed (and the violation list
	// above would fire) or the walker no longer reaches them (and it would not).
	if len(scanner.excused) < guardMinExcusedSites {
		t.Errorf("the walker excused %d redacted secret reference(s), want at least %d (agent.go's and main.go's utils.MaskSecret banners); the excuse path is not being exercised",
			len(scanner.excused), guardMinExcusedSites)
	}
	excusedPerFile := map[string]int{}
	for _, excused := range scanner.excused {
		excusedPerFile[filepath.Base(excused.pos.Filename)]++
	}
	for _, want := range []string{"agent.go", "main.go"} {
		if excusedPerFile[want] == 0 {
			t.Errorf("no utils.MaskSecret-wrapped secret reference found in %s; the startup/configure banner must log the secret through MaskSecret. Excused sites: %v", want, scanner.excused)
		}
	}
}

// guardLeakySource is a synthetic file with one violation of every shape the
// walker claims to catch, plus three near-misses that must NOT be flagged.
// Nothing here is compiled: parser.ParseFile does no type checking, so the
// missing imports are fine and deliberate.
const guardLeakySource = `package main

import "log/slog"

type guardFakeConfig struct {
	SecretKey     string
	ProxyUsername string
	ProxyPassword string
}

func guardLeak(secretKey string, cfg *guardFakeConfig, logger *slog.Logger, url string) {
	slog.Info("Secret key: " + secretKey)                   // bare identifier
	slog.Error("configuration", "key", cfg.SecretKey)       // selector
	logger.Warn("proxy", "password", cfg.ProxyPassword)     // *slog.Logger method
	fmt.Printf("proxy user %s\n", cfg.ProxyUsername)        // non-slog sink
	slog.Info("Secret key: " + utils.MaskSecret(secretKey)) // excused
	slog.Warn("Secret key: " + strings.ToUpper(secretKey))  // wrapped, but not in an approved redactor

	// Near-misses: a comparison, a non-logging call and a string literal that
	// merely talks about the secret must all stay clean.
	if secretKey == "" {
		slog.Error("Secret key is empty")
	}
	_, _ = http.Get(url + "/verify/" + secretKey)
}
`

// TestGuardAnalyserFlagsKnownViolations self-tests the analyser. Without it a
// clean report from the guard above is ambiguous: it could mean "no leaks" or
// "the walker is broken". This proves the walker can fail.
func TestGuardAnalyserFlagsKnownViolations(t *testing.T) {
	scanner := guardNewScanner()
	scanner.guardParseAndScan(t, "guard_leaky_source.go", guardLeakySource)

	wantViolations := []string{
		"secretKey",
		"cfg.SecretKey",
		"cfg.ProxyPassword",
		"cfg.ProxyUsername",
		// strings.ToUpper is not an approved redactor, so wrapping the secret in
		// it must not buy an excuse. Without this case the excuse rule could
		// degrade into "any call excuses its arguments" unnoticed.
		"secretKey",
	}
	if len(scanner.violations) != len(wantViolations) {
		t.Fatalf("analyser reported %d violation(s), want %d:\n%v", len(scanner.violations), len(wantViolations), scanner.violations)
	}
	for i, want := range wantViolations {
		if got := scanner.violations[i].expr; got != want {
			t.Errorf("violation %d = %q, want %q", i, got, want)
		}
		if line := scanner.violations[i].pos.Line; line <= 0 {
			t.Errorf("violation %d has no source line, so a failure would not be actionable: %+v", i, scanner.violations[i])
		}
		if name := scanner.violations[i].pos.Filename; name != "guard_leaky_source.go" {
			t.Errorf("violation %d filename = %q, want %q", i, name, "guard_leaky_source.go")
		}
	}

	// The masked reference must be excused rather than dropped, otherwise the
	// excuse path and the detection path cannot be told apart.
	if len(scanner.excused) != 1 {
		t.Fatalf("analyser excused %d reference(s), want exactly 1 (the utils.MaskSecret call):\n%v", len(scanner.excused), scanner.excused)
	}
	if got := scanner.excused[0].expr; got != "secretKey" {
		t.Errorf("excused expression = %q, want %q", got, "secretKey")
	}

	// slog.Info, slog.Error, slog.Info, slog.Warn and slog.Error("Secret key is
	// empty").
	if scanner.slogCalls != 5 {
		t.Errorf("analyser counted %d slog call site(s), want 5", scanner.slogCalls)
	}
	// The five above plus logger.Warn and fmt.Printf.
	if scanner.sinkCalls != 7 {
		t.Errorf("analyser counted %d sink(s), want 7 (5 slog + logger.Warn + fmt.Printf)", scanner.sinkCalls)
	}
}

// guardCleanSource is the mirror image: every secret reference is either
// redacted or outside a logging call. It pins the analyser's false-positive
// behaviour, so the guard cannot be "fixed" by making it flag everything.
const guardCleanSource = `package main

import "log/slog"

type guardFakeConfig struct {
	SecretKey     string
	ProxyPassword string
}

func guardSafe(secretKey string, cfg *guardFakeConfig, baseURL string, ingestPath string) {
	slog.Info("Secret key: " + utils.MaskSecret(secretKey))
	slog.Info("Proxy password: " + utils.MaskSecret(cfg.ProxyPassword))
	slog.Info("Metrics pushed", "endpoint", baseURL+ingestPath+utils.RedactedPlaceholder)
	if secretKey == "" {
		slog.Error("Secret key is empty")
	}
	resp, err := http.Post(baseURL+ingestPath+secretKey, "application/json", nil)
	if err != nil {
		// The sanctioned shape for logging an error that embeds a
		// secret-bearing URL. The guard must accept it: this is the fix it
		// tells people to apply.
		slog.Error("Failed to send request to server", "error", utils.RedactSecret(err.Error(), secretKey))
	}
	_ = resp
	_ = guardFakeConfig{SecretKey: secretKey}
}
`

func TestGuardAnalyserAcceptsRedactedSource(t *testing.T) {
	scanner := guardNewScanner()
	scanner.guardParseAndScan(t, "guard_clean_source.go", guardCleanSource)

	if len(scanner.violations) != 0 {
		t.Errorf("analyser reported %d false positive(s) on source that redacts everything it logs:\n%v", len(scanner.violations), scanner.violations)
	}
	// All three redactor-wrapped references must be seen and excused; if the
	// walker had simply skipped the whole call this would be 0 and the test
	// above would be passing for the wrong reason.
	if len(scanner.excused) != 3 {
		t.Errorf("analyser excused %d reference(s), want 3 (two utils.MaskSecret calls and one utils.RedactSecret call):\n%v", len(scanner.excused), scanner.excused)
	}
	if scanner.slogCalls != 5 {
		t.Errorf("analyser counted %d slog call site(s), want 5", scanner.slogCalls)
	}
}

// guardForbiddenLogConcatenations are the exact source spellings of the leak
// that was fixed, in both spaced and unspaced form.
var guardForbiddenLogConcatenations = []string{
	"+ ag.SecretKey",
	"+ag.SecretKey",
	"+ *secretKey",
	"+*secretKey",
	"+ secretKey",
	"+secretKey",
}

// TestGuardNoRawSecretConcatenationOnSlogLines is deliberate redundancy: a dumb
// substring scan that repeats the check above without sharing any code with the
// AST walker, so a blind spot in the walker (an unhandled node type, a callee
// shape guardClassifyCall does not recognise) cannot silence both.
//
// It only looks at lines that mention slog, which is why agent.go's
// `client.Post(oneuptimeUrl+ingestPath+secretKey, ...)` - the request that must
// keep carrying the real secret - is correctly left alone. The flip side is
// that it cannot see a multi-line slog call; that gap is the AST walker's job.
//
// Its reach is narrower still than the walker's: guardForbiddenLogConcatenations
// is a list of six literal spellings, so this scan only ever catches the exact
// regression that was fixed coming back verbatim. Renaming the variable or
// hoisting the concatenation into a local defeats it. That is by design - it
// exists to be independent of the walker, not to be as general as it.
func TestGuardNoRawSecretConcatenationOnSlogLines(t *testing.T) {
	dir := guardPackageDir(t)

	// The two files the CodeQL alert fired on.
	for _, name := range []string{"agent.go", "main.go"} {
		path := filepath.Join(dir, name)

		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("could not read %s: %v", path, err)
		}

		slogLines := 0
		for i, line := range strings.Split(string(raw), "\n") {
			if !strings.Contains(line, "slog.") {
				continue
			}
			slogLines++
			for _, forbidden := range guardForbiddenLogConcatenations {
				if strings.Contains(line, forbidden) {
					t.Errorf("%s:%d concatenates the raw secret into a log record (%q):\n    %s\n    use utils.MaskSecret(...) or utils.RedactedPlaceholder",
						path, i+1, forbidden, strings.TrimSpace(line))
				}
			}
		}

		// Anti-vacuity: a scan that found no slog lines proves nothing.
		if slogLines < 10 {
			t.Errorf("only %d slog line(s) found in %s; the textual scan is not looking at the logging code any more", slogLines, path)
		}
	}
}

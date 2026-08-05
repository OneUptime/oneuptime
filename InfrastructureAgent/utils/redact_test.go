package utils

import (
	"bytes"
	slog "log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

// These tests pin the fix for the go/clear-text-logging alert: the agent used
// to write its monitor secret key verbatim into a log file that is created
// world readable (0666) under /var/log, so any local user could read it.
// MaskSecret is the only thing standing between the secret and that file, so
// its contract is treated here as a security boundary rather than as
// formatting.

const logPathEnv = "ONEUPTIME_AGENT_LOG_PATH"

// A realistic 32 character hex key, shaped like the ObjectID style secrets the
// agent is configured with.
const hexSecret = "0123456789abcdef0123456789abcdef"

// longSecret is 4096 characters. The repeating pattern deliberately never
// contains the digits of its own length ("4096"), so the no-leak scan below
// cannot pass or fail by coincidence.
var longSecret = strings.Repeat("0123456789abcdef", 256)

func TestMaskSecret_ExactOutput(t *testing.T) {
	// Multi-byte input: 13 runes but 22 bytes. Reported as characters, so a
	// regression back to len() (bytes) would show 22 here.
	const multiByteSecret = "sécrét-ключ-🔑"

	tests := []struct {
		name   string
		secret string
		want   string
	}{
		{
			// An unset secret must be visibly unset, not "[REDACTED] (0
			// characters)", so an operator can tell misconfiguration apart
			// from redaction.
			name:   "empty secret reads as not set",
			secret: "",
			want:   "(not set)",
		},
		{
			name:   "32 char hex object id style key",
			secret: hexSecret,
			want:   "[REDACTED] (32 characters)",
		},
		{
			name:   "uuid with dashes",
			secret: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
			want:   "[REDACTED] (36 characters)",
		},
		{
			// Grammar is intentionally left as "1 characters"; pinning it
			// keeps the output a pure function of the constant and the count.
			name:   "single character key",
			secret: "x",
			want:   "[REDACTED] (1 characters)",
		},
		{
			// Format verbs in the secret must never be interpreted. If the
			// secret were ever passed as a format string instead of being
			// dropped, this would render "%!s(MISSING)" style noise.
			name:   "format and regex metacharacters",
			secret: "%s%d\\n%v",
			want:   "[REDACTED] (8 characters)",
		},
		{
			name:   "multi byte utf8 key counts runes not bytes",
			secret: multiByteSecret,
			want:   "[REDACTED] (13 characters)",
		},
		{
			name:   "4KB key",
			secret: longSecret,
			want:   "[REDACTED] (4096 characters)",
		},
	}

	// Guard the guard: if this input ever stops being multi-byte the rune
	// counting case above would silently stop proving anything.
	if len(multiByteSecret) == utf8.RuneCountInString(multiByteSecret) {
		t.Fatalf("test input %q must be multi-byte to exercise rune counting", multiByteSecret)
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := MaskSecret(tt.secret); got != tt.want {
				t.Errorf("MaskSecret(%q) = %q, want %q", tt.secret, got, tt.want)
			}
		})
	}
}

func TestRedactedPlaceholder_Value(t *testing.T) {
	// agent.go builds the logged ingest URL as
	// oneuptimeUrl + ingestPath + RedactedPlaceholder, so this constant is
	// part of the package's contract, not an implementation detail.
	if RedactedPlaceholder != "[REDACTED]" {
		t.Errorf("RedactedPlaceholder = %q, want %q", RedactedPlaceholder, "[REDACTED]")
	}
	if got := MaskSecret(hexSecret); !strings.HasPrefix(got, RedactedPlaceholder) {
		t.Errorf("MaskSecret output %q should start with the placeholder %q", got, RedactedPlaceholder)
	}
}

// TestMaskSecret_DependsOnlyOnLength is the central security property: two
// different secrets of the same rune length must be indistinguishable in the
// log. Stated as "the output is a function of the rune count alone", which is
// the rigorous form of "zero content leakage" - if any byte of the secret
// influenced the output, a canonical string of the same length could not match.
//
// SUBTLETY, do not "simplify" this into the naive property "the output does not
// contain the secret as a substring": that property is FALSE and always will
// be, because "[REDACTED]" itself contains R, E, D, A, C, T and the suffix
// contains "characters" - so short secrets like "a", "red" or "char" are
// trivially substrings of a perfectly safe output. Length-equivalence is the
// property that actually means something.
func TestMaskSecret_DependsOnlyOnLength(t *testing.T) {
	secrets := []struct {
		name   string
		secret string
	}{
		{"empty", ""},
		{"single char", "x"},
		{"hex object id", hexSecret},
		{"uuid", "3f2504e0-4f89-11d3-9a0c-0305e82c3301"},
		{"jwt like", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVP"},
		{"format verbs", "%s%d\\n%v"},
		{"multi byte", "sécrét-ключ-🔑"},
		{"whitespace and newlines", "top\tsecret\nkey\r\n"},
		{"looks like a log line", "abc def=ghi msg=pwned"},
		{"4KB", longSecret},
	}

	for _, tt := range secrets {
		t.Run(tt.name, func(t *testing.T) {
			canonical := strings.Repeat("x", utf8.RuneCountInString(tt.secret))
			if got, want := MaskSecret(tt.secret), MaskSecret(canonical); got != want {
				t.Errorf("MaskSecret(%q) = %q but MaskSecret of a same-length placeholder = %q; the output leaks something other than the length",
					tt.secret, got, want)
			}
		})
	}
}

// FuzzMaskSecretLeaksNothingButLength generalises the property above to
// arbitrary input, including invalid UTF-8 (utf8.RuneCountInString counts each
// invalid byte as one rune, so the equivalence still has to hold). The body is
// deterministic and allocation-light, so running the seed corpus under a plain
// "go test" is cheap.
func FuzzMaskSecretLeaksNothingButLength(f *testing.F) {
	f.Add("")
	f.Add("x")
	f.Add(hexSecret)
	f.Add("3f2504e0-4f89-11d3-9a0c-0305e82c3301")
	f.Add("%s%d\\n%v")
	f.Add("sécrét-ключ-🔑")
	f.Add("top\tsecret\nkey\r\n")
	f.Add("\xff\xfe\x00invalid utf8")
	f.Add(strings.Repeat("0123456789abcdef", 16))

	f.Fuzz(func(t *testing.T, secret string) {
		runes := utf8.RuneCountInString(secret)

		got := MaskSecret(secret)
		want := MaskSecret(strings.Repeat("x", runes))
		if got != want {
			t.Fatalf("MaskSecret(%q) = %q, but a same-length placeholder masks to %q; output is not a function of length alone",
				secret, got, want)
		}

		// The masked value ends up inside a single slog record, so it must
		// never be able to terminate the line and forge another one.
		if strings.ContainsAny(got, "\n\r") {
			t.Fatalf("MaskSecret(%q) = %q contains a line break and could forge log lines", secret, got)
		}

		if secret == "" {
			if got != "(not set)" {
				t.Fatalf("MaskSecret(\"\") = %q, want %q", got, "(not set)")
			}
			return
		}
		if !strings.HasPrefix(got, RedactedPlaceholder) {
			t.Fatalf("MaskSecret(%q) = %q, want it to start with %q", secret, got, RedactedPlaceholder)
		}
	})
}

// TestMaskSecret_NoSecretFragmentsInOutput is a blunt backstop for the property
// above: scan the output for every 4 character window of the secret. Checking
// windows of exactly 4 is equivalent to checking every window of length >= 4,
// since any longer leaked run contains a 4 character one. The threshold of 4
// exists because shorter windows collide with the harmless literal text
// ("[REDACTED]", "characters") - see the comment on
// TestMaskSecret_DependsOnlyOnLength.
func TestMaskSecret_NoSecretFragmentsInOutput(t *testing.T) {
	const window = 4

	secrets := []string{
		hexSecret,
		"5f8d0d55b54764421b7156c9",
		"3f2504e0-4f89-11d3-9a0c-0305e82c3301",
		"aGVsbG8td29ybGQtdGhpcy1pcy1hLXNlY3JldA",
		"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVP",
		longSecret,
	}

	for _, secret := range secrets {
		masked := MaskSecret(secret)
		for i := 0; i+window <= len(secret); i++ {
			fragment := secret[i : i+window]
			if strings.Contains(masked, fragment) {
				t.Fatalf("MaskSecret output %q leaks the %d character fragment %q at offset %d of the secret",
					masked, window, fragment, i)
			}
		}
	}
}

// The shape of the value RedactSecret exists for: net/http's *url.Error text,
// which embeds the whole requested URL including the secret path segment.
const urlErrorText = `Post "http://10.0.0.7:3002/server-monitor/response/ingest/` + hexSecret + `": dial tcp 10.0.0.7:3002: connect: connection refused`

func TestRedactSecret_ExactOutput(t *testing.T) {
	tests := []struct {
		name   string
		text   string
		secret string
		want   string
	}{
		{
			// The reason the function exists: the transport error an agent logs
			// when it cannot reach OneUptime.
			name:   "url error keeps everything but the secret",
			text:   urlErrorText,
			secret: hexSecret,
			want:   `Post "http://10.0.0.7:3002/server-monitor/response/ingest/[REDACTED]": dial tcp 10.0.0.7:3002: connect: connection refused`,
		},
		{
			// A retrying client can name the URL more than once in one error.
			name:   "every occurrence is replaced",
			text:   hexSecret + " and again " + hexSecret,
			secret: hexSecret,
			want:   "[REDACTED] and again [REDACTED]",
		},
		{
			name:   "text without the secret is untouched",
			text:   "dial tcp 10.0.0.7:3002: connect: connection refused",
			secret: hexSecret,
			want:   "dial tcp 10.0.0.7:3002: connect: connection refused",
		},
		{
			// THE trap. strings.ReplaceAll(text, "", p) matches at every
			// position and returns "[REDACTED]d[REDACTED]i[REDACTED]a..." - a
			// diagnostic destroyed for an agent that has no secret at all.
			name:   "empty secret leaves the text alone",
			text:   "dial tcp: connection refused",
			secret: "",
			want:   "dial tcp: connection refused",
		},
		{
			name:   "empty text stays empty",
			text:   "",
			secret: hexSecret,
			want:   "",
		},
		{
			// The secret is configuration, so it may contain regex or format
			// metacharacters. Replacement is literal, not pattern based.
			name:   "secret with metacharacters is matched literally",
			text:   `Get "http://host/verify/.*%s+": EOF`,
			secret: `.*%s+`,
			want:   `Get "http://host/verify/[REDACTED]": EOF`,
		},
		{
			name:   "multi byte secret",
			text:   "verify/sécrét-ключ-🔑 failed",
			secret: "sécrét-ключ-🔑",
			want:   "verify/[REDACTED] failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := RedactSecret(tt.text, tt.secret); got != tt.want {
				t.Errorf("RedactSecret(%q, %q) = %q, want %q", tt.text, tt.secret, got, tt.want)
			}
		})
	}
}

// TestRedactSecret_NeverLeavesTheSecretBehind is the security property, stated
// independently of the exact output: whatever comes back must not contain the
// secret. Unlike MaskSecret's output this one is caller supplied text, so a
// plain substring check is meaningful here as long as the secret is long enough
// not to collide with the placeholder - all the secrets below are.
func TestRedactSecret_NeverLeavesTheSecretBehind(t *testing.T) {
	secrets := []string{
		hexSecret,
		"5f8d0d55b54764421b7156c9",
		"3f2504e0-4f89-11d3-9a0c-0305e82c3301",
		"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVP",
		"sécrét-ключ-🔑",
		longSecret,
	}

	// Every place a secret has been observed to appear inside an error string.
	templates := []string{
		`Post "http://host:3002/server-monitor/response/ingest/%s": EOF`,
		`Get "https://host/server-monitor/secret-key/verify/%s": context deadline exceeded`,
		`%s`,
		`prefix %s suffix %s`,
	}

	for _, secret := range secrets {
		for _, template := range templates {
			text := strings.ReplaceAll(template, "%s", secret)

			got := RedactSecret(text, secret)
			if strings.Contains(got, secret) {
				t.Fatalf("RedactSecret(%q, %q) = %q still contains the secret", text, secret, got)
			}
			if !strings.Contains(got, RedactedPlaceholder) {
				t.Fatalf("RedactSecret(%q, %q) = %q, want the placeholder %q to mark where the secret was",
					text, secret, got, RedactedPlaceholder)
			}
		}
	}
}

// FuzzRedactSecretNeverLeavesTheSecretBehind generalises the property to
// arbitrary text and secrets, including the empty secret and invalid UTF-8. The
// empty secret is the one input for which the output may legitimately still
// contain the "secret", so it is carved out explicitly rather than silently.
func FuzzRedactSecretNeverLeavesTheSecretBehind(f *testing.F) {
	f.Add(urlErrorText, hexSecret)
	f.Add("no secret here", hexSecret)
	f.Add("", "")
	f.Add("dial tcp: connection refused", "")
	f.Add("verify/sécrét-ключ-🔑", "sécrét-ключ-🔑")
	f.Add("\xff\xfe bad bytes \xff", "\xff")
	f.Add("aaaa", "a")

	f.Fuzz(func(t *testing.T, text string, secret string) {
		got := RedactSecret(text, secret)

		if secret == "" {
			// Nothing to redact: the message must survive intact rather than
			// being shredded by an empty-needle replacement.
			if got != text {
				t.Fatalf("RedactSecret(%q, \"\") = %q, want the text unchanged", text, got)
			}
			return
		}

		// The redaction must not invent or drop content: the result is the text
		// with occurrences of the secret swapped out, nothing more.
		if want := strings.ReplaceAll(text, secret, RedactedPlaceholder); got != want {
			t.Fatalf("RedactSecret(%q, %q) = %q, want %q", text, secret, got, want)
		}
		if strings.Contains(text, secret) && !strings.Contains(got, RedactedPlaceholder) {
			t.Fatalf("RedactSecret(%q, %q) = %q, want the placeholder to mark where the secret was", text, secret, got)
		}

		// The no-leak assertion, stated only where it is actually guaranteed.
		// This is a literal substring replacement, so a "secret" built out of
		// the placeholder's own characters can reappear across a replacement
		// boundary: RedactSecret("]aa", "]a") is "[REDACTED]a", which contains
		// "]a" again. That is a property of the fuzzer's alphabet, not a
		// disclosure - a real monitor key is a hex or UUID style token. When the
		// secret shares no character with the placeholder, no occurrence can
		// span a boundary and none can survive inside the untouched fragments,
		// so the check below is exact.
		if !strings.ContainsAny(secret, RedactedPlaceholder) && strings.Contains(got, secret) {
			t.Fatalf("RedactSecret(%q, %q) = %q still contains the secret", text, secret, got)
		}
	})
}

// TestSetDefaultLogger_SecretNeverReachesLogFile is the end-to-end threat model
// test. The alert is not "a string was formatted badly", it is "the secret key
// is sitting in a 0666 file under /var/log that any local user can read". So
// this drives the real logger, writes the real record, and then reads the file
// back off disk the way an attacker would.
func TestSetDefaultLogger_SecretNeverReachesLogFile(t *testing.T) {
	// slog's default logger is process global state, so this test cannot be
	// parallel and must put the previous logger back.
	previous := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previous) })

	logPath := filepath.Join(t.TempDir(), "oneuptime-infrastructure-agent.log")
	t.Setenv(logPathEnv, logPath)

	SetDefaultLogger()

	const secret = "ab5f3c9d1e7b2a4c6d8e0f1a2b3c4d5e"
	const oneuptimeUrl = "https://oneuptime.example.com"
	const ingestPath = "/ingestor/host-metrics/"

	// The two call sites that used to leak: the startup banner in NewAgent /
	// the configure command, and the ingest endpoint attribute logged by
	// collectMetricsJob.
	slog.Info("Secret key: " + MaskSecret(secret))
	slog.Info("Posting metrics", "endpoint", oneuptimeUrl+ingestPath+RedactedPlaceholder)

	raw, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("failed to read the agent log file at %s: %v", logPath, err)
	}

	// If SetDefaultLogger had fallen back to stdout the file would be empty
	// and every "does not contain the secret" assertion below would pass
	// vacuously.
	if !bytes.Contains(raw, []byte("Secret key:")) {
		t.Fatalf("log file %s does not contain the record under test; got %q", logPath, raw)
	}
	if !bytes.Contains(raw, []byte("Posting metrics")) {
		t.Fatalf("log file %s does not contain the endpoint record; got %q", logPath, raw)
	}

	if bytes.Contains(raw, []byte(secret)) {
		t.Fatalf("the raw secret key is readable in the log file %s: %q", logPath, raw)
	}
	if !bytes.Contains(raw, []byte(RedactedPlaceholder)) {
		t.Fatalf("expected %q in the log file %s, got %q", RedactedPlaceholder, logPath, raw)
	}
	if !bytes.Contains(raw, []byte(oneuptimeUrl+ingestPath+RedactedPlaceholder)) {
		t.Fatalf("expected the endpoint to be logged with the secret segment redacted, got %q", raw)
	}
}

// TestSetDefaultLogger_NoFragmentOfSecretOnDisk complements the test above:
// even a partial key on disk is a disclosure, and a naive "mask the middle"
// style fix would still put the head and tail of the key in the file.
func TestSetDefaultLogger_NoFragmentOfSecretOnDisk(t *testing.T) {
	previous := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previous) })

	logPath := filepath.Join(t.TempDir(), "agent.log")
	t.Setenv(logPathEnv, logPath)

	SetDefaultLogger()

	// Letters and digits alternate so that no 4 character window is all
	// letters or all digits. That keeps the scan from colliding with the
	// handler's own output ("level=INFO", "characters", the timestamp digits),
	// which would make this test fail for reasons that are not disclosures.
	const secret = "a1b2c3d4e5f6g7h8j9k0m1n2p3q4r5s6"
	slog.Info("Secret key: " + MaskSecret(secret))

	raw, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("failed to read the agent log file at %s: %v", logPath, err)
	}
	if !bytes.Contains(raw, []byte("Secret key:")) {
		t.Fatalf("log file %s does not contain the record under test; got %q", logPath, raw)
	}

	const window = 4
	for i := 0; i+window <= len(secret); i++ {
		fragment := secret[i : i+window]
		if bytes.Contains(raw, []byte(fragment)) {
			t.Fatalf("log file %s leaks the secret fragment %q: %q", logPath, fragment, raw)
		}
	}
}

// TestSetDefaultLogger_SecretCannotForgeLogLines covers the other half of the
// threat model: a secret is attacker-influenced configuration, so if any part
// of it reached the log verbatim it could inject whole fake records. Because
// MaskSecret returns a constant plus an integer, a single Info call must
// produce exactly one line no matter what the secret contains.
func TestSetDefaultLogger_SecretCannotForgeLogLines(t *testing.T) {
	previous := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previous) })

	logPath := filepath.Join(t.TempDir(), "agent.log")
	t.Setenv(logPathEnv, logPath)

	SetDefaultLogger()

	const secret = "wxyz\nlevel=ERROR msg=pwned host=attacker\n"
	slog.Info("Secret key: " + MaskSecret(secret))

	raw, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("failed to read the agent log file at %s: %v", logPath, err)
	}
	if !bytes.Contains(raw, []byte("Secret key:")) {
		t.Fatalf("log file %s does not contain the record under test; got %q", logPath, raw)
	}
	if bytes.Contains(raw, []byte("pwned")) {
		t.Fatalf("the secret's payload was written to the log file %s: %q", logPath, raw)
	}
	if got := bytes.Count(raw, []byte("\n")); got != 1 {
		t.Fatalf("expected exactly 1 log line, got %d; the secret forged extra records: %q", got, raw)
	}
}

// TestGetLogPath_EnvOverride pins the contract the two tests above rely on: the
// override is returned verbatim, so the tests never touch /var/log or the real
// user home directory.
func TestGetLogPath_EnvOverride(t *testing.T) {
	base := t.TempDir()

	tests := []struct {
		name     string
		override string
	}{
		{"plain file in temp dir", filepath.Join(base, "agent.log")},
		{"nested path", filepath.Join(base, "nested", "dir", "agent.log")},
		{"path with spaces", filepath.Join(base, "log dir", "oneuptime agent.log")},
		{"unusual extension", filepath.Join(base, "agent.txt")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv(logPathEnv, tt.override)

			got := GetLogPath()
			if got != tt.override {
				t.Fatalf("GetLogPath() = %q, want the override %q verbatim", got, tt.override)
			}
			// None of these live under /var/log or %PROGRAMDATA%; if the
			// override were ignored the assertion above would already have
			// failed, but this makes the intent explicit.
			if !strings.HasPrefix(got, base) {
				t.Fatalf("GetLogPath() = %q, want a path under the test temp dir %q", got, base)
			}
		})
	}
}

// TestGetLogPath_OverrideBeatsDefaultDirectory proves the override branch wins
// rather than merely agreeing with the default. The default path always ends in
// "oneuptime-infrastructure-agent.log" under a system directory, so an override
// with a different file name that comes back unchanged can only have come from
// the env var.
//
// The unset case is intentionally not exercised: GetLogPath creates
// /var/log/oneuptime-infrastructure-agent or a directory under $HOME as a side
// effect, and tests must not write outside t.TempDir().
func TestGetLogPath_OverrideBeatsDefaultDirectory(t *testing.T) {
	override := filepath.Join(t.TempDir(), "definitely-not-the-default-name.log")
	t.Setenv(logPathEnv, override)

	got := GetLogPath()
	if got != override {
		t.Fatalf("GetLogPath() = %q, want %q", got, override)
	}
	if strings.Contains(got, string(filepath.Separator)+"var"+string(filepath.Separator)+"log") {
		t.Fatalf("GetLogPath() = %q, the override must not be joined with the system log directory", got)
	}
	if _, err := os.Stat(filepath.Dir(got)); err != nil {
		t.Fatalf("expected the override's directory to be usable: %v", err)
	}
}

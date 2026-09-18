package utils

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// RedactedPlaceholder stands in for a secret value in anything that is logged,
// such as the secret key path segment of an ingest URL.
const RedactedPlaceholder = "[REDACTED]"

// MaskSecret describes a secret without disclosing it. The agent writes its
// logs to a long lived file that is readable by any local user (see
// GetLogPath), so no part of the secret is returned here - only whether it is
// set and how long it is, which is enough to debug a misconfigured agent.
//
// The length is reported in characters (runes) rather than bytes so that the
// label is truthful for multi-byte keys. A rune count is derived from the
// secret but carries none of its content, so the result stays safe to log.
func MaskSecret(secret string) string {
	if secret == "" {
		return "(not set)"
	}

	return fmt.Sprintf("%s (%d characters)", RedactedPlaceholder, utf8.RuneCountInString(secret))
}

// RedactSecret returns text with every occurrence of secret replaced by
// RedactedPlaceholder.
//
// MaskSecret covers the values that ARE the secret. This covers the values that
// merely CARRY one: net/http returns a *url.Error whose message embeds the whole
// requested URL, so logging such an error verbatim discloses the secret path
// segment of an ingest or verify URL even though nothing named "secret" appears
// in the logging call. Pass the error text through here first:
//
//	slog.Error("Failed to send request to server", "error",
//	    utils.RedactSecret(err.Error(), secretKey))
//
// An empty secret returns the text unchanged, deliberately. strings.ReplaceAll
// treats an empty needle as a match at every position, so the naive call would
// splice the placeholder between every character of the message - turning the
// diagnostic into noise in exactly the case (an unconfigured agent) where there
// is no secret to protect.
func RedactSecret(text string, secret string) string {
	if secret == "" {
		return text
	}

	return strings.ReplaceAll(text, secret, RedactedPlaceholder)
}

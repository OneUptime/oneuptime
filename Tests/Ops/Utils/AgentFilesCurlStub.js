"use strict";

/**
 * A curl stand-in for running an agent's install.sh with no network.
 *
 * Every agent's install.sh downloads its files from the OneUptime it reports
 * to, at <ONEUPTIME_URL>/install/<name>/<file>, and only when that OneUptime
 * is older than the scripts (it answers 404, or a page of its own) from the
 * agent's folder on GitHub ("Where the agent's files come from" in each
 * script). This answers both places the way they answer:
 *
 *   - <any URL>/install/<name>/<file> and the GitHub folder serve the file
 *     from `servedDir` (this checkout's agents/<Agent>), or from $SERVE_DIR
 *     when a test sets it (a newer release), with 200 and text/plain;
 *   - $STUB_DIR/oneuptime.answer or $STUB_DIR/github.answer, when a test
 *     writes one, is what that place answers instead: "<status> <content
 *     type>" ("404 text/html", "200 text/html; charset=utf-8",
 *     "500 text/plain; charset=utf-8"), or "000" for no answer at all. Any
 *     answer but 200 text/plain writes a page that is not the file;
 *   - -w '%{http_code} %{content_type}', the only format the scripts ask
 *     for, prints the status and the content type; -f fails a status of 400
 *     or more with curl's exit code 22.
 *
 * Every call is appended to $STUB_DIR/curl.log, one line of arguments each.
 * `extraCases` is bash run after the arguments are read (`$url`, `$out`),
 * for the other addresses a script calls (the Proxmox VE API).
 */

const GITHUB_AGENTS_URL =
  "https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents";

const WRITE_OUT_FORMAT = "%{http_code} %{content_type}";

function agentFilesCurlStub({
  installName,
  agentDirectory,
  servedDir,
  extraCases = "",
}) {
  return `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/curl.log"
url=""; out=""; format=""; fail=0
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) format="$2"; shift 2 ;;
    -H|--max-time|--connect-timeout) shift 2 ;;
    --*) shift ;;
    -*f*) fail=1; shift ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
${extraCases}
served="\${SERVE_DIR:-${servedDir}}"
github="${GITHUB_AGENTS_URL}/${agentDirectory}/"
case "$url" in
  "$github"*)
    rel="\${url#"$github"}"
    answer_file="$STUB_DIR/github.answer"
    ;;
  */install/${installName}/*)
    rel="\${url#*/install/${installName}/}"
    answer_file="$STUB_DIR/oneuptime.answer"
    ;;
  *)
    echo "curl: (6) Could not resolve host for $url (the stub serves no such address)" >&2
    exit 6
    ;;
esac
status="200"
type="text/plain; charset=utf-8"
if [ -f "$answer_file" ]; then
  answer="$(cat "$answer_file")"
  status="\${answer%% *}"
  type=""
  case "$answer" in
    *" "*) type="\${answer#* }" ;;
  esac
fi
if [ "$status" = "000" ]; then
  echo "curl: (7) Failed to connect: no answer" >&2
  [ -n "$format" ] && printf '000 '
  exit 7
fi
if [ "$status" = "200" ] && [ "\${type#text/plain}" != "$type" ]; then
  if [ -f "$served/$rel" ]; then
    if [ -n "$out" ]; then cp "$served/$rel" "$out"; else cat "$served/$rel"; fi
  else
    status="404"
    if [ -n "$out" ]; then printf 'Not found\\n' > "$out"; fi
  fi
elif [ -n "$out" ]; then
  printf '<!doctype html><title>Not the file</title>\\n' > "$out"
fi
if [ -n "$format" ]; then
  if [ "$format" != '${WRITE_OUT_FORMAT}' ]; then
    echo "curl stub: -w $format is not a format the scripts use" >&2
    exit 2
  fi
  printf '%s %s' "$status" "$type"
fi
if [ "$fail" = 1 ] && [ "$status" -ge 400 ]; then
  exit 22
fi
exit 0
`;
}

module.exports = {
  GITHUB_AGENTS_URL,
  WRITE_OUT_FORMAT,
  agentFilesCurlStub,
};

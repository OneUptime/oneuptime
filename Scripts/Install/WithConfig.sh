#!/bin/sh
#
# Runs a command with config.env's settings in its environment:
#
#   sh Scripts/Install/WithConfig.sh docker compose up --remove-orphans -d
#
# `npm start`, `npm run update`, `npm run logs` and the other scripts that
# wrap Docker Compose run through it, and so do backup.sh and restore.sh. It
# needs nothing but a POSIX shell, so the guide's Docker CLI commands use it
# too, on a server without Node.js.
#
# WHY
#
# The scripts used to run `export $(grep -v '^#' config.env | xargs)` first.
# That splits every value at its spaces and lets the shell expand what is
# left: config.example.env's own GLOBAL_PROBE_1_DESCRIPTION="Global probe to
# monitor oneuptime resources" reached the probe as "Global", a value such as
# "EU probe (Frankfurt)" stopped `npm start` with "bad variable name", and a
# value with a * in it became the names of the files in the folder.
#
# HOW A LINE IS READ - as ReplacePlaceholderSecrets.js's readSettings reads
# it, so every step of `npm start` sees the same values:
#
#   - a blank line, or one that starts with # or //, is skipped;
#   - NAME=VALUE sets NAME (an "export " before NAME is allowed too);
#   - the spaces around NAME and VALUE are dropped, then one pair of matching
#     quotes around VALUE, and the spaces just inside them;
#   - nothing else in VALUE changes: its spaces, quotes, #, $, * and \ stay as
#     written, and nothing is expanded;
#   - a line whose NAME is not a name a shell can export is skipped, with a
#     warning, rather than stopping the command;
#   - when a NAME is set twice, the last line wins.
#
# config.env's values replace the environment's, as the export did: a shell
# such as zsh sets a HOST of its own, and config.env's is the one meant.
#
# ONEUPTIME_CONFIG_FILE names another file; config.env in the current folder
# is the default. Without the file, the command runs with the environment as
# it is.
#
# No line costs a process: every step is the shell's own parameter expansion,
# so a config.env of hundreds of settings is read in a moment.

set -e

if [ "$#" -eq 0 ]; then
    echo "Usage: sh Scripts/Install/WithConfig.sh <command> [arguments...]" >&2
    exit 64
fi

_wc_file="${ONEUPTIME_CONFIG_FILE:-./config.env}"

# Sets `_wc_trimmed` to $1 without the whitespace at its ends.
trim() {
    _wc_trimmed="$1"
    _wc_trimmed="${_wc_trimmed#"${_wc_trimmed%%[![:space:]]*}"}"
    _wc_trimmed="${_wc_trimmed%"${_wc_trimmed##*[![:space:]]}"}"
}

if [ -f "$_wc_file" ]; then
    _wc_cr="$(printf '\r')"
    _wc_number=0

    while IFS= read -r _wc_line || [ -n "$_wc_line" ]; do
        _wc_number=$((_wc_number + 1))

        # A file saved with Windows line endings.
        _wc_line="${_wc_line%"$_wc_cr"}"
        trim "$_wc_line"
        _wc_line="$_wc_trimmed"

        case "$_wc_line" in
            "" | "#"* | "//"*)
                continue
                ;;
        esac

        case "$_wc_line" in
            "export "* | "export	"*)
                trim "${_wc_line#export}"
                _wc_line="$_wc_trimmed"
                ;;
        esac

        case "$_wc_line" in
            *=*) ;;
            *)
                continue
                ;;
        esac

        trim "${_wc_line%%=*}"
        _wc_name="$_wc_trimmed"
        trim "${_wc_line#*=}"
        _wc_value="$_wc_trimmed"

        case "$_wc_name" in
            "" | [0-9]* | *[!A-Za-z0-9_]*)
                echo "$_wc_file line $_wc_number: \"$_wc_name\" is not a setting name, so the line was skipped." >&2
                continue
                ;;
        esac

        # One pair of matching quotes around the value, and the spaces inside them.
        if [ "${#_wc_value}" -ge 2 ]; then
            case "$_wc_value" in
                \"*\" | \'*\')
                    _wc_value="${_wc_value#?}"
                    trim "${_wc_value%?}"
                    _wc_value="$_wc_trimmed"
                    ;;
            esac
        fi

        export "$_wc_name=$_wc_value"
    done < "$_wc_file"
fi

exec "$@"

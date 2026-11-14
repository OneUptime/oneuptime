#!/usr/bin/env bash
#
# Cluster-free, whole-chart coverage for email: the server's own email
# settings, set in the values instead of in Admin Dashboard > Settings > Emails
# (#7738), and handed to the pods as the GLOBAL_EMAIL_ variables.
#
# tests/email-environment_test.yaml holds the wiring template by template.
# helm-unittest asserts only on the templates a test names, so a workload added
# later that runs the server's code without the variables -- and would send
# through the settings saved in the Admin Dashboard while the others send
# through these -- fails nothing there. Here the whole chart is rendered with
# every workload switched on, in both database layouts, and:
#
#   1. Nothing changes for an install that leaves email.serverType empty: an
#      empty one, a Secret key name or a false switch alone, or values from
#      before the block existed (helm upgrade --reuse-values) render byte for
#      byte as the chart's defaults do, with no GLOBAL_EMAIL_ variable.
#   2. With the settings in the values, every workload that runs the server's
#      env helper gets all 25 variables -- the ones the app reads, no more and
#      no fewer -- each holding its value, and no other workload gets any; no
#      password or key is written anywhere else: no Secret, ConfigMap or
#      annotation of the chart holds a copy.
#   3. With email.existingSecret, exactly the same workloads read the one
#      password the settings read from that Secret, and none as a plain value;
#      a provider's key is read under its own name, or under
#      email.existingSecret.key.
#   4. A block nothing would read, settings without the password or key they
#      read, one given both ways and a Secret nothing reads are refused by helm
#      template itself, saying what to change, and never printing the
#      password.
#   5. The schema refuses a block of the wrong shape: a server type or
#      transport the app does not know (one of spaces too), a key the block
#      does not have.
#
# Everything here is `helm template`: no cluster, no images, no API server.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

harness_install_helm

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

SECRET_NAME="oneuptime-email"
# Values nothing else in the chart renders, so every place they land is found.
PASSWORD="smtp-password-sentinel-7738a1"
CLIENT_SECRET="oauth-client-secret-sentinel-7738b2"
SENDGRID_KEY="SG.sendgrid-key-sentinel-7738c3"
SES_SECRET="ses-secret-access-key-sentinel-7738d4"
MAILGUN_KEY="mailgun-key-sentinel-7738e5"
POSTMARK_TOKEN="postmark-token-sentinel-7738f6"
RESEND_KEY="re_resend-key-sentinel-7738a7"
SECRET_VALUES=("$PASSWORD" "$CLIENT_SECRET" "$SENDGRID_KEY" "$SES_SECRET" "$MAILGUN_KEY" "$POSTMARK_TOKEN" "$RESEND_KEY")

# The 25 variables, and the value each is set to below.
ENV_NAMES=(
    GLOBAL_EMAIL_SERVER_TYPE
    GLOBAL_EMAIL_FROM_EMAIL
    GLOBAL_EMAIL_FROM_NAME
    GLOBAL_EMAIL_SMTP_TRANSPORT
    GLOBAL_EMAIL_SMTP_HOST
    GLOBAL_EMAIL_SMTP_PORT
    GLOBAL_EMAIL_SMTP_REQUIRE_TLS
    GLOBAL_EMAIL_SMTP_AUTH_TYPE
    GLOBAL_EMAIL_SMTP_USERNAME
    GLOBAL_EMAIL_SMTP_PASSWORD
    GLOBAL_EMAIL_SMTP_OAUTH_PROVIDER_TYPE
    GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID
    GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET
    GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL
    GLOBAL_EMAIL_SMTP_OAUTH_SCOPE
    GLOBAL_EMAIL_SENDGRID_API_KEY
    GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE
    GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID
    GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY
    GLOBAL_EMAIL_AMAZON_SES_REGION
    GLOBAL_EMAIL_MAILGUN_API_KEY
    GLOBAL_EMAIL_MAILGUN_DOMAIN
    GLOBAL_EMAIL_MAILGUN_REGION
    GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN
    GLOBAL_EMAIL_RESEND_API_KEY
)
ENV_VALUES=(
    "custom-smtp"
    "alerts@example.com"
    "OneUptime Alerts"
    "smtp"
    "smtp.example.com"
    "587"
    "true"
    "username-and-password"
    "mailer@example.com"
    "$PASSWORD"
    "client-credentials"
    "oauth-client-id"
    "$CLIENT_SECRET"
    "https://login.example.com/token"
    "https://mail.example.com/.default"
    "$SENDGRID_KEY"
    "access-key"
    "AKIAIOSFODNN7EXAMPLE"
    "$SES_SECRET"
    "eu-west-1"
    "$MAILGUN_KEY"
    "mg.example.com"
    "eu"
    "$POSTMARK_TOKEN"
    "$RESEND_KEY"
)
# Everything but the passwords and keys: the settings, whichever way the one
# password they read is given.
SETTINGS=(
    --set "email.serverType=custom-smtp"
    --set "email.fromEmail=alerts@example.com"
    --set "email.fromName=OneUptime Alerts"
    --set "email.smtp.transport=smtp"
    --set "email.smtp.host=smtp.example.com"
    --set "email.smtp.port=587"
    --set "email.smtp.requireTls=true"
    --set "email.smtp.authType=username-and-password"
    --set "email.smtp.username=mailer@example.com"
    --set "email.smtp.oauth.providerType=client-credentials"
    --set "email.smtp.oauth.clientId=oauth-client-id"
    --set "email.smtp.oauth.tokenUrl=https://login.example.com/token"
    --set "email.smtp.oauth.scope=https://mail.example.com/.default"
    --set "email.amazonSes.authenticationType=access-key"
    --set "email.amazonSes.accessKeyId=AKIAIOSFODNN7EXAMPLE"
    --set "email.amazonSes.region=eu-west-1"
    --set "email.mailgun.domain=mg.example.com"
    --set "email.mailgun.region=eu"
)
# Every password and key, as values. The settings read only the SMTP password;
# the app reports the others as set but unused.
SECRET_SETTINGS=(
    --set "email.smtp.password=${PASSWORD}"
    --set "email.smtp.oauth.clientSecret=${CLIENT_SECRET}"
    --set "email.sendgrid.apiKey=${SENDGRID_KEY}"
    --set "email.amazonSes.secretAccessKey=${SES_SECRET}"
    --set "email.mailgun.apiKey=${MAILGUN_KEY}"
    --set "email.postmark.serverToken=${POSTMARK_TOKEN}"
    --set "email.resend.apiKey=${RESEND_KEY}"
)

# The workloads that run the server's env helper (oneuptime.env.runtime) today,
# as tests/vapid-existing-secret.sh and twilio-environment.sh list them. A
# workload in neither this list nor the render fails below, so a new one is
# looked at rather than quietly given -- or quietly denied -- the settings.
EXPECTED_WORKLOADS=(
    Deployment@oneuptime-app
    Deployment@oneuptime-home
    Deployment@oneuptime-nginx
    Deployment@oneuptime-telemetry-writer
    Deployment@oneuptime-test-server
    Deployment@oneuptime-worker
    Job@oneuptime-migrate-1
)

# Every workload the chart runs, switched on at once (as extra-values does).
cat >"${WORK_DIR}/all-on.yaml" <<'YAML'
worker:
  enabled: true
home:
  enabled: true
telemetryWriter:
  enabled: true
testServer:
  enabled: true
pgbouncer:
  enabled: true
vllm:
  enabled: true
cronJobs:
  cleanup:
    enabled: true
  e2e:
    enabled: true
YAML

# The operator-managed database backend renders a different set of workloads.
cat >"${WORK_DIR}/operators.yaml" <<'YAML'
postgresql:
  enabled: false
postgresOperator:
  cnpg:
    enabled: true
clickhouse:
  enabled: false
clickhouseOperator:
  altinity:
    enabled: true
YAML

render_all_on() {
    # render_all_on <output-file> [extra helm template arguments...]; fails the
    # suite and stops when the chart does not render.
    local out="$1"
    shift
    if ! helm template oneuptime "$HELM_CHART_DIR" -f "${WORK_DIR}/all-on.yaml" "$@" >"$out" 2>"${out}.err"; then
        fail "helm template failed for $(basename "$out")"
        sed 's/^/        /' "${out}.err"
        harness_report
        exit 1
    fi
}

# render_refused <output-file> [extra helm template arguments...]: renders
# expecting a refusal; prints helm's error output, or nothing when it rendered.
render_refused() {
    local out="$1"
    shift
    if helm template oneuptime "$HELM_CHART_DIR" -f "${WORK_DIR}/all-on.yaml" "$@" >"$out" 2>"${out}.err"; then
        return 0
    fi
    cat "${out}.err"
}

# Chart-generated secrets and the optional timestamp label are random per
# render; everything else has to match byte for byte.
normalise() {
    sed -E 's/^( *[a-zA-Z-]+): "[A-Za-z0-9]{32}"$/\1: "<random>"/; s/date: "[0-9]+"/date: "<ts>"/' "$1"
}

# How each env entry named <name> of a workload is written, one line per
# entry: "value=<value>", "secret=<name>/<key>", "both" (a value AND a
# Secret), or "neither".
entries_named() {
    # entries_named <workload-file> <env name>
    awk -v want="$2" '
        function emit() {
            if (hasvalue && hasfrom) { print "both" }
            else if (hasvalue) { print "value=" value }
            else if (hasfrom) { print "secret=" sname "/" skey }
            else { print "neither" }
            inentry = 0
        }
        function unquote(text) {
            sub(/^[^:]*:[[:space:]]*/, "", text)
            gsub(/["\047]/, "", text)
            sub(/[[:space:]]+$/, "", text)
            return text
        }
        {
            if (inentry) {
                if ($0 ~ /^[[:space:]]*$/) { next }
                if (match($0, /[^ ]/) <= dash) { emit() }
                else {
                    if ($0 ~ /^[[:space:]]*value:/) { hasvalue = 1; value = unquote($0) }
                    else if ($0 ~ /^[[:space:]]*valueFrom:/) { hasfrom = 1 }
                    else if ($0 ~ /^[[:space:]]*name:/) { sname = unquote($0) }
                    else if ($0 ~ /^[[:space:]]*key:/) { skey = unquote($0) }
                    next
                }
            }
            if ($0 ~ /^[[:space:]]*- name:[[:space:]]*/) {
                name = $0
                sub(/^[[:space:]]*- name:[[:space:]]*/, "", name)
                gsub(/["\047]/, "", name)
                sub(/[[:space:]]+$/, "", name)
                if (name == want) {
                    inentry = 1; dash = match($0, /-/)
                    hasvalue = 0; hasfrom = 0; value = ""; sname = ""; skey = ""
                }
            }
        }
        END { if (inentry) { emit() } }
    ' "$1"
}

# Every workload of a split render that is given <name>, one per line, sorted.
workloads_with() {
    # workloads_with <split-dir> <env name>
    local file
    for file in "$1"/*; do
        [ -f "$file" ] || continue
        if [ -n "$(entries_named "$file" "$2")" ]; then
            basename "$file"
        fi
    done | sort
}

# The <name> entries of a split render that are not written as <expected>, as
# "<workload>:<how>".
entries_other_than() {
    # entries_other_than <split-dir> <env name> <expected>
    local file entry
    for file in "$1"/*; do
        [ -f "$file" ] || continue
        while read -r entry; do
            [ -z "$entry" ] && continue
            [ "$entry" = "$3" ] || echo "$(basename "$file"):${entry}"
        done < <(entries_named "$file" "$2")
    done
}

# ---------------------------------------------------------------------------
# 0. The chart hands over the variables the app reads: no more, no fewer.
# ---------------------------------------------------------------------------
APP_READER="${TESTS_DIR}/../../packages/Common/Types/Email/ServerEmailEnvironment.ts"
app_names="$(grep -o '"GLOBAL_EMAIL_[A-Z_]*"' "$APP_READER" | tr -d '"' | sort -u)"
chart_names="$(printf '%s\n' "${ENV_NAMES[@]}" | sort -u)"
assert_eq "the suite checks every GLOBAL_EMAIL_ variable ServerEmailEnvironment.ts reads, and no other" "$app_names" "$chart_names"

# ---------------------------------------------------------------------------
# 1. Nothing changes for an install that leaves email.serverType empty.
# ---------------------------------------------------------------------------
render_all_on "${WORK_DIR}/default.yaml"
assert_absent "the chart's defaults render no GLOBAL_EMAIL_ variable" "$(cat "${WORK_DIR}/default.yaml")" "GLOBAL_EMAIL_"

# Parallel arrays rather than an associative one: macOS still ships bash 3.2.
UNSET_LABELS=(empty-type key-name-only false-switch-only values-from-before smtp-null secret-null)
UNSET_SETTINGS=(
    "email.serverType="
    "email.existingSecret.key=smtp-password"
    "email.smtp.requireTls=false"
    "email=null"
    "email.smtp=null"
    "email.existingSecret=null"
)
for index in "${!UNSET_LABELS[@]}"; do
    label="${UNSET_LABELS[$index]}"
    render_all_on "${WORK_DIR}/unset-${label}.yaml" --set "${UNSET_SETTINGS[$index]}"
    if diff -q <(normalise "${WORK_DIR}/default.yaml") <(normalise "${WORK_DIR}/unset-${label}.yaml") >/dev/null; then
        pass "no server type (${label}): the chart renders exactly as with its defaults"
    else
        fail "no server type (${label}) changed the render"
        diff <(normalise "${WORK_DIR}/default.yaml") <(normalise "${WORK_DIR}/unset-${label}.yaml") | head -40 | sed 's/^/        /'
    fi
done

# ---------------------------------------------------------------------------
# 2. and 3. The same workloads get the settings, the password from the value
#    or from the Secret -- in both database layouts.
# ---------------------------------------------------------------------------
check_layout() {
    # check_layout <label> [extra helm template arguments...]
    local label="$1"
    shift
    local plain_dir="${WORK_DIR}/${label}-plain.d" secret_dir="${WORK_DIR}/${label}-secret.d"
    local expected missing workload index name with entries copies secret_entries value

    render_all_on "${WORK_DIR}/${label}-plain.yaml" "$@" "${SETTINGS[@]}" "${SECRET_SETTINGS[@]}"
    render_all_on "${WORK_DIR}/${label}-secret.yaml" "$@" "${SETTINGS[@]}" --set "email.existingSecret.name=${SECRET_NAME}"
    split_workloads "${WORK_DIR}/${label}-plain.yaml" "$plain_dir"
    split_workloads "${WORK_DIR}/${label}-secret.yaml" "$secret_dir"

    expected="$(printf '%s\n' "${EXPECTED_WORKLOADS[@]}" | sort)"

    for index in "${!ENV_NAMES[@]}"; do
        name="${ENV_NAMES[$index]}"
        with="$(workloads_with "$plain_dir" "$name")"

        # The splitter and the entry reader have to see the workloads we know
        # of, or every check below passes on nothing.
        missing=""
        for workload in "${EXPECTED_WORKLOADS[@]}"; do
            grep -qxF -- "$workload" <<<"$with" || missing="${missing} ${workload}"
        done
        assert_eq "[${label}] every workload known to run the server's env helper gets ${name}" "" "$missing"
        assert_eq "[${label}] no other workload gets ${name} (a new one must be added to EXPECTED_WORKLOADS on purpose)" "$expected" "$with"
        assert_eq "[${label}] every ${name} entry holds its value" "" "$(entries_other_than "$plain_dir" "$name" "value=${ENV_VALUES[$index]}")"
    done

    # Each password and key appears once per entry, and nowhere else in the
    # whole render.
    for index in "${!ENV_NAMES[@]}"; do
        value="${ENV_VALUES[$index]}"
        case " ${SECRET_VALUES[*]} " in
            *" ${value} "*) ;;
            *) continue ;;
        esac
        name="${ENV_NAMES[$index]}"
        entries="$(grep -c -- "- name: ${name}$" "${WORK_DIR}/${label}-plain.yaml" || true)"
        copies="$(grep -c -F -- "$value" "${WORK_DIR}/${label}-plain.yaml" || true)"
        assert_eq "[${label}] the value of ${name} is written only into its entries, never copied into a Secret, ConfigMap or annotation" "$entries" "$copies"
    done

    assert_eq "[${label}] with email.existingSecret, exactly the same workloads get GLOBAL_EMAIL_SMTP_PASSWORD" "$(workloads_with "$plain_dir" GLOBAL_EMAIL_SMTP_PASSWORD)" "$(workloads_with "$secret_dir" GLOBAL_EMAIL_SMTP_PASSWORD)"
    assert_eq "[${label}] with email.existingSecret, every entry reads the operator's Secret, under smtpPassword" "" "$(entries_other_than "$secret_dir" GLOBAL_EMAIL_SMTP_PASSWORD "secret=${SECRET_NAME}/smtpPassword")"
    secret_entries="$(entries_other_than "$secret_dir" GLOBAL_EMAIL_SMTP_PASSWORD "every-entry-is-listed")"
    assert_absent "[${label}] with email.existingSecret, no workload renders the password as a plain value" "$secret_entries" ":value="
    assert_absent "[${label}] with email.existingSecret, no workload renders a plain value beside the Secret" "$secret_entries" ":both"
    # Sanity for the two lines above: the entry reader does see plain values.
    assert_present "[${label}] (the entry reader sees the plain values it is meant to refuse)" "$(entries_other_than "$plain_dir" GLOBAL_EMAIL_SMTP_PASSWORD "every-entry-is-listed")" ":value=${PASSWORD}"
    # Only the password the settings read comes from the Secret: the other
    # keys stay empty values.
    for name in GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET GLOBAL_EMAIL_SENDGRID_API_KEY GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY GLOBAL_EMAIL_MAILGUN_API_KEY GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN GLOBAL_EMAIL_RESEND_API_KEY; do
        assert_eq "[${label}] with email.existingSecret, ${name} - which the settings do not read - stays empty" "" "$(entries_other_than "$secret_dir" "$name" "value=")"
    done
    # The rest of the settings stay in the values beside the Secret.
    assert_eq "[${label}] with email.existingSecret, the username stays a plain value" "" "$(entries_other_than "$secret_dir" GLOBAL_EMAIL_SMTP_USERNAME "value=mailer@example.com")"
}

check_layout "standalone-db"
check_layout "operator-db" -f "${WORK_DIR}/operators.yaml"

# Each provider's key is read under its own name, or under
# email.existingSecret.key, by every workload.
PROVIDER_LABELS=(
    "SendGrid's API key"
    "Amazon SES's secret access key"
    "Mailgun's API key"
    "Postmark's server token"
    "Resend's API key"
    "the OAuth client secret for Microsoft Graph"
    "the OAuth client secret for SMTP"
    "SendGrid's API key under email.existingSecret.key"
)
PROVIDER_SETTINGS=(
    "--set email.serverType=sendgrid"
    "--set email.serverType=amazon-ses --set email.amazonSes.accessKeyId=AKIAIOSFODNN7EXAMPLE"
    "--set email.serverType=mailgun --set email.mailgun.domain=mg.example.com"
    "--set email.serverType=postmark"
    "--set email.serverType=resend"
    "--set email.serverType=custom-smtp --set email.smtp.transport=microsoft-graph"
    "--set email.serverType=custom-smtp --set email.smtp.authType=oauth --set email.smtp.username=mailer@example.com"
    "--set email.serverType=sendgrid --set email.existingSecret.key=sendgrid-api-key"
)
PROVIDER_ENTRIES=(
    GLOBAL_EMAIL_SENDGRID_API_KEY
    GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY
    GLOBAL_EMAIL_MAILGUN_API_KEY
    GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN
    GLOBAL_EMAIL_RESEND_API_KEY
    GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET
    GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET
    GLOBAL_EMAIL_SENDGRID_API_KEY
)
PROVIDER_KEYS=(sendgridApiKey amazonSesSecretAccessKey mailgunApiKey postmarkServerToken resendApiKey smtpOAuthClientSecret smtpOAuthClientSecret sendgrid-api-key)
for index in "${!PROVIDER_LABELS[@]}"; do
    label="${PROVIDER_LABELS[$index]}"
    # Word splitting on purpose: each entry is a few helm arguments.
    # shellcheck disable=SC2086
    render_all_on "${WORK_DIR}/provider-${index}.yaml" ${PROVIDER_SETTINGS[$index]} --set "email.existingSecret.name=${SECRET_NAME}"
    split_workloads "${WORK_DIR}/provider-${index}.yaml" "${WORK_DIR}/provider-${index}.d"
    assert_eq "every workload reads ${label} from the Secret" "$(printf '%s\n' "${EXPECTED_WORKLOADS[@]}" | sort)" "$(workloads_with "${WORK_DIR}/provider-${index}.d" "${PROVIDER_ENTRIES[$index]}")"
    assert_eq "every workload reads ${label} under ${PROVIDER_KEYS[$index]}" "" "$(entries_other_than "${WORK_DIR}/provider-${index}.d" "${PROVIDER_ENTRIES[$index]}" "secret=${SECRET_NAME}/${PROVIDER_KEYS[$index]}")"
    assert_eq "with ${label} from the Secret, the SMTP password stays empty" "" "$(entries_other_than "${WORK_DIR}/provider-${index}.d" GLOBAL_EMAIL_SMTP_PASSWORD "value=")"
done

# Settings that read no password or key need no Secret: a relay signed in to
# with nothing, and Amazon SES signed in as the server's IAM role.
render_all_on "${WORK_DIR}/no-secret-relay.yaml" --set "email.serverType=custom-smtp" --set "email.smtp.host=relay.example.com" --set "email.smtp.port=25"
split_workloads "${WORK_DIR}/no-secret-relay.yaml" "${WORK_DIR}/no-secret-relay.d"
assert_eq "an SMTP relay with no username renders, its password empty" "" "$(entries_other_than "${WORK_DIR}/no-secret-relay.d" GLOBAL_EMAIL_SMTP_PASSWORD "value=")"
render_all_on "${WORK_DIR}/no-secret-ses.yaml" --set "email.serverType=amazon-ses" --set "email.amazonSes.authenticationType=server-iam-role" --set "email.amazonSes.region=us-east-1"
split_workloads "${WORK_DIR}/no-secret-ses.yaml" "${WORK_DIR}/no-secret-ses.d"
assert_eq "Amazon SES signed in as the server's IAM role renders, its secret access key empty" "" "$(entries_other_than "${WORK_DIR}/no-secret-ses.d" GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY "value=")"

# ---------------------------------------------------------------------------
# 4. Refusals, each saying what to change.
# ---------------------------------------------------------------------------
REFUSAL_LABELS=(
    "a password without a server type"
    "a mail server without a server type"
    "a Secret without a server type"
    "a mail server signed in to without its password"
    "SendGrid without its API key"
    "Amazon SES without its secret access key"
    "a key given both ways"
    "a password the settings do not read beside a Secret"
    "a Secret the settings read nothing from"
    "a Secret for a mail server with no username"
)
REFUSAL_SETTINGS=(
    "--set email.smtp.password=${PASSWORD}"
    "--set email.fromEmail=alerts@example.com --set email.smtp.host=smtp.example.com --set email.smtp.requireTls=true"
    "--set email.existingSecret.name=${SECRET_NAME}"
    "--set email.serverType=custom-smtp --set email.smtp.username=mailer@example.com"
    "--set email.serverType=sendgrid"
    "--set email.serverType=amazon-ses --set email.amazonSes.region=us-east-1"
    "--set email.serverType=sendgrid --set email.sendgrid.apiKey=${SENDGRID_KEY} --set email.existingSecret.name=${SECRET_NAME}"
    "--set email.serverType=postmark --set email.smtp.password=${PASSWORD} --set email.existingSecret.name=${SECRET_NAME}"
    "--set email.serverType=amazon-ses --set email.amazonSes.authenticationType=server-iam-role --set email.existingSecret.name=${SECRET_NAME}"
    "--set email.serverType=custom-smtp --set email.smtp.host=smtp.example.com --set email.existingSecret.name=${SECRET_NAME}"
)
REFUSAL_MESSAGES=(
    "email.serverType is empty, so OneUptime reads none of the other email values, and these are set: email.smtp.password. Set email.serverType to send the server's email with them, or clear them to set email up in the Admin Dashboard."
    "these are set: email.fromEmail, email.smtp.host, email.smtp.requireTls. Set email.serverType"
    "these are set: email.existingSecret.name. Set email.serverType"
    "email.smtp.password is empty, and so is email.existingSecret.name: the mail server is signed in to with email.smtp.username and a password. To send without signing in, set email.smtp.authType to none. Set email.smtp.password, or name the Secret that holds it in email.existingSecret.name."
    "email.sendgrid.apiKey is empty, and so is email.existingSecret.name: SendGrid sends nothing without it."
    "email.amazonSes.secretAccessKey is empty, and so is email.existingSecret.name: Amazon SES is signed in to with an access key, unless email.amazonSes.authenticationType is server-iam-role."
    "email.sendgrid.apiKey and email.existingSecret.name are both set. Set one of them: to read the password or key from the Secret ${SECRET_NAME}, clear email.sendgrid.apiKey (--set email.sendgrid.apiKey=\"\")."
    "email.smtp.password and email.existingSecret.name are both set. Set one of them: to read the password or key from the Secret ${SECRET_NAME}, clear email.smtp.password (--set email.smtp.password=\"\")."
    "email.existingSecret.name is set, but the email settings these values describe read no password or key, so nothing would read the Secret ${SECRET_NAME}. Clear email.existingSecret.name."
    "nothing would read the Secret ${SECRET_NAME}. Clear email.existingSecret.name. To sign in to the mail server with the password the Secret holds, set email.smtp.username too."
)
for index in "${!REFUSAL_LABELS[@]}"; do
    label="${REFUSAL_LABELS[$index]}"
    # Word splitting on purpose: each entry is a few helm arguments.
    # shellcheck disable=SC2086
    refusal="$(render_refused "${WORK_DIR}/refused-${index}.yaml" ${REFUSAL_SETTINGS[$index]})"
    if [ -n "$refusal" ]; then
        pass "helm template refuses ${label}"
    else
        fail "helm template rendered ${label}"
    fi
    assert_present "the refusal of ${label} says what to change" "$refusal" "${REFUSAL_MESSAGES[$index]}"
    assert_absent "the refusal of ${label} does not print the password" "$refusal" "$PASSWORD"
    assert_absent "the refusal of ${label} does not print the API key" "$refusal" "$SENDGRID_KEY"
done

# ---------------------------------------------------------------------------
# 5. The schema refuses a block of the wrong shape. Helm's wording of a schema
#    error differs between versions; each names the property it refuses.
# ---------------------------------------------------------------------------
WRONG_SHAPE_LABELS=(
    "a server type the app does not know"
    "a server type of spaces"
    "a transport the app does not know"
    "a key the block does not have"
    "a Secret key under another name"
    "a string in place of the Secret block"
)
WRONG_SHAPE_SETTINGS=(
    "email.serverType=gmail"
    "email.serverType=   "
    "email.smtp.transport=graph"
    "email.smtp.hostname=smtp.example.com"
    "email.existingSecret.passwordKey=smtpPassword"
    "email.existingSecret=${SECRET_NAME}"
)
# The property each refusal has to name.
WRONG_SHAPE_PROPERTIES=(serverType serverType transport hostname passwordKey existingSecret)
for index in "${!WRONG_SHAPE_LABELS[@]}"; do
    label="${WRONG_SHAPE_LABELS[$index]}"
    refusal="$(render_refused "${WORK_DIR}/shape-${index}.yaml" --set "email.serverType=custom-smtp" --set "email.smtp.host=smtp.example.com" --set "${WRONG_SHAPE_SETTINGS[$index]}")"
    if [ -n "$refusal" ]; then
        pass "the schema refuses ${label}"
    else
        fail "the chart rendered with ${label}"
    fi
    assert_present "the refusal of ${label} names email" "$refusal" "email"
    assert_present "the refusal of ${label} names ${WRONG_SHAPE_PROPERTIES[$index]}" "$refusal" "${WRONG_SHAPE_PROPERTIES[$index]}"
done

harness_report

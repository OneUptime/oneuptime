import { SecurityBlocklistFeedFirewall } from "./SecurityBlocklistFeed";
import {
  SECURITY_BLOCKLIST_NFTABLES_IPV4_SET,
  SECURITY_BLOCKLIST_NFTABLES_IPV6_SET,
  SECURITY_BLOCKLIST_NFTABLES_TABLE,
} from "./SecurityBlocklistFeedFormat";

/*
 * WHAT A HOST RUNS TO APPLY A BLOCKLIST FEED (#10345): nftables, ipset with
 * iptables, nginx, HAProxy and Windows Firewall. Each is commands run once,
 * as root or an administrator, that save a script and run it every minute
 * (cron, or a scheduled task), and the script:
 *
 *   - sends the feed's secret as a bearer token, read by curl from a file
 *     only root reads (`--header @file`, curl 7.55 and later), so it is in
 *     no process list and no shell history;
 *   - sends the ETag of the list it last loaded (If-None-Match), so a list
 *     that has not changed is a 304 and costs nothing, and keeps the new
 *     ETag only once the new list is loaded - a list that failed to load is
 *     fetched again a minute later;
 *   - writes what it fetched to a file of its own, and only loads a 200:
 *     anything else changes nothing and says what the feed answered;
 *   - makes what it fills again when it is gone (after a reboot), and then
 *     fetches the whole list, whatever its ETag said.
 *
 * The secret stands in the commands as given: the feed's page fills it in
 * when it has it, the placeholder otherwise. Text fixtures pin each one
 * (SecurityBlocklistFeedSnippets.test.ts), and the docs page quotes them.
 */

// Where the scripts keep the secret, their state and themselves.
export const SECURITY_BLOCKLIST_SNIPPET_CONFIG_DIR: string =
  "/etc/oneuptime-blocklist";
export const SECURITY_BLOCKLIST_SNIPPET_STATE_DIR: string =
  "/var/lib/oneuptime-blocklist";
export const SECURITY_BLOCKLIST_SNIPPET_SCRIPT: string =
  "/usr/local/sbin/oneuptime-blocklist";
export const SECURITY_BLOCKLIST_SNIPPET_CRON: string =
  "/etc/cron.d/oneuptime-blocklist";

// What nginx includes, HAProxy reads, and ipset fills.
export const SECURITY_BLOCKLIST_NGINX_INCLUDE: string =
  "/etc/nginx/oneuptime-blocklist.conf";
export const SECURITY_BLOCKLIST_HAPROXY_ACL_FILE: string =
  "/etc/haproxy/oneuptime-blocklist.lst";
export const SECURITY_BLOCKLIST_HAPROXY_SOCKET: string =
  "/run/haproxy/admin.sock";
export const SECURITY_BLOCKLIST_IPSET_V4: string = "oneuptime-v4";
export const SECURITY_BLOCKLIST_IPSET_V6: string = "oneuptime-v6";

// The Windows Firewall rule the script keeps, and the task that runs it.
export const SECURITY_BLOCKLIST_WINDOWS_RULE: string = "OneUptime blocklist";
export const SECURITY_BLOCKLIST_WINDOWS_TASK: string = "OneUptime blocklist";

/*
 * Windows Firewall takes a rule's remote addresses as one list; the script
 * splits the feed into rules of this many, so a long list never meets a
 * limit of one rule.
 */
export const SECURITY_BLOCKLIST_WINDOWS_ADDRESSES_PER_RULE: number = 1000;

// A value put in single quotes for sh: ' becomes '\''.
export function quoteForShell(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

// A value put in single quotes for PowerShell: ' becomes ''.
export function quoteForPowerShell(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

// The commands that keep the secret where only root reads it, as curl sends it.
function secretFileLines(secret: string): Array<string> {
  return [
    `install -d -m 700 ${SECURITY_BLOCKLIST_SNIPPET_CONFIG_DIR} ${SECURITY_BLOCKLIST_SNIPPET_STATE_DIR}`,
    `printf 'Authorization: Bearer %s\\n' ${quoteForShell(secret)} > ${SECURITY_BLOCKLIST_SNIPPET_CONFIG_DIR}/auth`,
    `chmod 600 ${SECURITY_BLOCKLIST_SNIPPET_CONFIG_DIR}/auth`,
  ];
}

/*
 * The fetch every script starts with: the list into $TMP, its headers into
 * $TMP.h, the answer's code in $CODE. A 304 ends the run; anything but a
 * 200 ends it with what the feed answered.
 */
function fetchLines(url: string): Array<string> {
  return [
    `URL=${quoteForShell(url)}`,
    `STATE=${SECURITY_BLOCKLIST_SNIPPET_STATE_DIR}`,
    'TMP=$(mktemp)',
    'trap \'rm -f "$TMP" "$TMP.h"\' EXIT',
    'ETAG=$(cat "$STATE/etag" 2>/dev/null || true)',
    `CODE=$(curl --silent --show-error --max-time 60 --header @${SECURITY_BLOCKLIST_SNIPPET_CONFIG_DIR}/auth \\`,
    '  ${ETAG:+--header "If-None-Match: $ETAG"} \\',
    '  --dump-header "$TMP.h" --output "$TMP" --write-out \'%{http_code}\' "$URL")',
    '[ "$CODE" = 304 ] && exit 0',
    '[ "$CODE" = 200 ] || { echo "oneuptime-blocklist: the feed answered $CODE" >&2; exit 1; }',
  ];
}

// Keeps the ETag of the list just loaded, so the next fetch of the same list is a 304.
const SAVE_ETAG_LINE: string =
  "sed -n 's/^[Ee][Tt][Aa][Gg]:[[:space:]]*//p' \"$TMP.h\" | tr -d '\\r' > \"$STATE/etag\"";

// Saves a script, makes cron run it every minute, and runs it once now.
function installLines(scriptLines: Array<string>): Array<string> {
  return [
    `cat > ${SECURITY_BLOCKLIST_SNIPPET_SCRIPT} <<'SCRIPT'`,
    ...scriptLines,
    "SCRIPT",
    `chmod 700 ${SECURITY_BLOCKLIST_SNIPPET_SCRIPT}`,
    `echo '* * * * * root ${SECURITY_BLOCKLIST_SNIPPET_SCRIPT}' > ${SECURITY_BLOCKLIST_SNIPPET_CRON}`,
    SECURITY_BLOCKLIST_SNIPPET_SCRIPT,
  ];
}

function lines(all: Array<string>): string {
  return `${all.join("\n")}\n`;
}

/*
 * nftables: a table with two interval sets - IPv4 and IPv6 - and the one
 * rule pair that drops what they hold, made when the table is missing; the
 * feed's nftables.nft flushes and fills the sets in one transaction (nft -f).
 */
export function renderNftablesSnippet(data: {
  url: string;
  secret: string;
}): string {
  const table: string = `inet ${SECURITY_BLOCKLIST_NFTABLES_TABLE}`;

  return lines([
    "# Run once, as root.",
    ...secretFileLines(data.secret),
    ...installLines([
      "#!/bin/sh",
      "# Loads the OneUptime blocklist into nftables when it changed.",
      "set -eu",
      `if ! nft list table ${table} >/dev/null 2>&1; then`,
      '  rm -f "$STATE/etag" 2>/dev/null || true',
      "  nft -f - <<'NFT'",
      `table ${table} {`,
      `  set ${SECURITY_BLOCKLIST_NFTABLES_IPV4_SET} { type ipv4_addr; flags interval; }`,
      `  set ${SECURITY_BLOCKLIST_NFTABLES_IPV6_SET} { type ipv6_addr; flags interval; }`,
      "  chain input {",
      "    type filter hook input priority -10; policy accept;",
      `    ip saddr @${SECURITY_BLOCKLIST_NFTABLES_IPV4_SET} drop`,
      `    ip6 saddr @${SECURITY_BLOCKLIST_NFTABLES_IPV6_SET} drop`,
      "  }",
      "}",
      "NFT",
      "fi",
      ...fetchLines(data.url),
      'nft -f "$TMP"',
      SAVE_ETAG_LINE,
    ]),
  ]);
}

/*
 * ipset and iptables: two hash:net sets and the iptables and ip6tables
 * rules that drop what they hold, made when missing; the list fills two
 * new sets (ipset restore), swapped in at once, so a rule never sees a set
 * half full.
 */
export function renderIpsetSnippet(data: {
  url: string;
  secret: string;
}): string {
  const v4: string = SECURITY_BLOCKLIST_IPSET_V4;
  const v6: string = SECURITY_BLOCKLIST_IPSET_V6;

  return lines([
    "# Run once, as root.",
    ...secretFileLines(data.secret),
    ...installLines([
      "#!/bin/sh",
      "# Loads the OneUptime blocklist into ipset when it changed.",
      "set -eu",
      `if ! ipset list -n ${v4} >/dev/null 2>&1; then rm -f ${SECURITY_BLOCKLIST_SNIPPET_STATE_DIR}/etag; fi`,
      `ipset create ${v4} hash:net family inet -exist`,
      `ipset create ${v6} hash:net family inet6 -exist`,
      `iptables -C INPUT -m set --match-set ${v4} src -j DROP 2>/dev/null || iptables -I INPUT -m set --match-set ${v4} src -j DROP`,
      `ip6tables -C INPUT -m set --match-set ${v6} src -j DROP 2>/dev/null || ip6tables -I INPUT -m set --match-set ${v6} src -j DROP`,
      ...fetchLines(data.url),
      "{",
      `  echo "create ${v4}-new hash:net family inet -exist"`,
      `  echo "create ${v6}-new hash:net family inet6 -exist"`,
      `  echo "flush ${v4}-new"`,
      `  echo "flush ${v6}-new"`,
      `  grep -v '^#' "$TMP" | grep -v ':' | sed 's/^/add ${v4}-new /'`,
      `  grep -v '^#' "$TMP" | grep ':' | sed 's/^/add ${v6}-new /'`,
      "} | ipset restore -exist",
      `ipset swap ${v4}-new ${v4}`,
      `ipset swap ${v6}-new ${v6}`,
      `ipset destroy ${v4}-new`,
      `ipset destroy ${v6}-new`,
      SAVE_ETAG_LINE,
    ]),
  ]);
}

/*
 * nginx: the feed's nginx.conf (`deny` a line) written where the site's
 * server block includes it, then the configuration checked and nginx
 * reloaded, gracefully; a configuration nginx refuses puts the last file
 * back.
 */
export function renderNginxSnippet(data: {
  url: string;
  secret: string;
}): string {
  const include: string = SECURITY_BLOCKLIST_NGINX_INCLUDE;

  return lines([
    "# Run once, as root.",
    ...secretFileLines(data.secret),
    `touch ${include}`,
    ...installLines([
      "#!/bin/sh",
      "# Writes the OneUptime blocklist for nginx when it changed, and reloads nginx.",
      "set -eu",
      ...fetchLines(data.url),
      `cp ${include} "$STATE/last.conf"`,
      `cp "$TMP" ${include}`,
      `if nginx -t -q; then nginx -s reload; else cp "$STATE/last.conf" ${include}; exit 1; fi`,
      SAVE_ETAG_LINE,
    ]),
    "",
    "# Then add this line to the server block of the site to protect, and reload nginx:",
    `#   include ${include};`,
  ]);
}

/*
 * HAProxy: the feed's list as an ACL file the frontend's deny line reads
 * when HAProxy starts, and the same list swapped into the running HAProxy
 * through its Runtime API - a new version prepared, filled and committed
 * at once (prepare acl, add acl @<version>, commit acl) - with no reload.
 */
export function renderHaproxySnippet(data: {
  url: string;
  secret: string;
}): string {
  const acl: string = SECURITY_BLOCKLIST_HAPROXY_ACL_FILE;
  const socket: string = SECURITY_BLOCKLIST_HAPROXY_SOCKET;

  return lines([
    "# Run once, as root. HAProxy's Runtime API needs a socket at admin level in its global section:",
    `#   stats socket ${socket} mode 660 level admin`,
    ...secretFileLines(data.secret),
    `touch ${acl}`,
    ...installLines([
      "#!/bin/sh",
      "# Updates the OneUptime blocklist in HAProxy when it changed, with no reload.",
      "set -eu",
      ...fetchLines(data.url),
      `cp "$TMP" ${acl}`,
      `VERSION=$(echo "prepare acl ${acl}" | socat stdio ${socket} | sed -n 's/^New version created: //p')`,
      `grep -v '^#' "$TMP" | while read -r ENTRY; do echo "add acl @$VERSION ${acl} $ENTRY"; done | socat stdio ${socket} >/dev/null`,
      `echo "commit acl @$VERSION ${acl}" | socat stdio ${socket}`,
      SAVE_ETAG_LINE,
    ]),
    "",
    "# Then add this line to the frontend to protect, and reload HAProxy once:",
    `#   http-request deny if { src -f ${acl} }`,
  ]);
}

/*
 * Windows Firewall: a PowerShell script, run every minute by a scheduled
 * task as SYSTEM, that keeps inbound rules blocking every address on the
 * list - as many rules as it takes, SECURITY_BLOCKLIST_WINDOWS_ADDRESSES_PER_RULE
 * addresses each - and the task itself. Its folder is readable by SYSTEM and
 * Administrators only: the script holds the secret.
 */
export function renderWindowsFirewallSnippet(data: {
  url: string;
  secret: string;
}): string {
  const rule: string = SECURITY_BLOCKLIST_WINDOWS_RULE;

  const script: Array<string> = [
    `$Url = ${quoteForPowerShell(data.url)}`,
    `$Secret = ${quoteForPowerShell(data.secret)}`,
    "$State = Join-Path $env:ProgramData 'OneUptime\\Blocklist'",
    "$EtagFile = Join-Path $State 'etag'",
    "$Headers = @{ Authorization = \"Bearer $Secret\" }",
    "if (Test-Path $EtagFile) { $Headers['If-None-Match'] = (Get-Content $EtagFile -Raw).Trim() }",
    "try {",
    "  $Response = Invoke-WebRequest -Uri $Url -Headers $Headers -UseBasicParsing -TimeoutSec 60",
    "} catch {",
    "  if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 304) { return }",
    "  throw",
    "}",
    "if ([int]$Response.StatusCode -eq 304) { return }",
    "$Addresses = @($Response.Content -split \"`n\" | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })",
    `Get-NetFirewallRule -DisplayName ${quoteForPowerShell(`${rule}*`)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`,
    `for ($i = 0; $i -lt $Addresses.Count; $i += ${SECURITY_BLOCKLIST_WINDOWS_ADDRESSES_PER_RULE}) {`,
    `  $Part = $Addresses[$i..([Math]::Min($i + ${SECURITY_BLOCKLIST_WINDOWS_ADDRESSES_PER_RULE}, $Addresses.Count) - 1)]`,
    `  New-NetFirewallRule -DisplayName (${quoteForPowerShell(`${rule} `)} + ($i / ${SECURITY_BLOCKLIST_WINDOWS_ADDRESSES_PER_RULE} + 1)) -Direction Inbound -Action Block -RemoteAddress $Part | Out-Null`,
    "}",
    "Set-Content -Path $EtagFile -Value ([string]$Response.Headers['ETag']) -NoNewline",
  ];

  return lines([
    "# Run once, in PowerShell as an administrator.",
    "$State = Join-Path $env:ProgramData 'OneUptime\\Blocklist'",
    "New-Item -ItemType Directory -Force -Path $State | Out-Null",
    'icacls $State /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null',
    "$Script = Join-Path $State 'Update-Blocklist.ps1'",
    "@'",
    ...script,
    "'@ | Set-Content -Path $Script",
    "$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument \"-NoProfile -ExecutionPolicy Bypass -File `\"$Script`\"\"",
    "$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)",
    `Register-ScheduledTask -TaskName ${quoteForPowerShell(SECURITY_BLOCKLIST_WINDOWS_TASK)} -Action $Action -Trigger $Trigger -User 'SYSTEM' -RunLevel Highest -Force | Out-Null`,
    `Start-ScheduledTask -TaskName ${quoteForPowerShell(SECURITY_BLOCKLIST_WINDOWS_TASK)}`,
  ]);
}

// The script a host runs for a firewall, filled in; null for one set up in its own console.
export function renderSecurityBlocklistFeedSnippet(data: {
  firewall: SecurityBlocklistFeedFirewall;
  url: string;
  secret: string;
}): string | null {
  switch (data.firewall) {
    case SecurityBlocklistFeedFirewall.Nftables:
      return renderNftablesSnippet(data);
    case SecurityBlocklistFeedFirewall.Ipset:
      return renderIpsetSnippet(data);
    case SecurityBlocklistFeedFirewall.Nginx:
      return renderNginxSnippet(data);
    case SecurityBlocklistFeedFirewall.HAProxy:
      return renderHaproxySnippet(data);
    case SecurityBlocklistFeedFirewall.WindowsFirewall:
      return renderWindowsFirewallSnippet(data);
    default:
      return null;
  }
}

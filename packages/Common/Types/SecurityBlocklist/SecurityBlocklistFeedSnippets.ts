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
 * (cron under flock, so two runs never overlap; or a scheduled task), and
 * the script:
 *
 *   - sends the feed's secret as a bearer token that curl reads from a file
 *     only root reads (`--header @file`, which curl's manual recommends over
 *     a command line), so it is in no process list and no shell history;
 *   - sends the ETag of the list it last loaded (If-None-Match), so a list
 *     that has not changed is a 304 and costs nothing, and keeps the new
 *     ETag only once the new list is loaded: a list that failed to load is
 *     fetched again a minute later. It reads the ETag from the answer's
 *     headers itself rather than with --etag-compare and --etag-save, whose
 *     handling of a 304 and a 401 changed between curl 7.68 and 8.12;
 *   - loads only a 200, and says what the feed answered otherwise;
 *   - makes what it fills again when it is gone (after a reboot), and then
 *     fetches the whole list, whatever its ETag said.
 *
 * Every command is as its tool's own documentation writes it, and was run
 * as written (nftables 1.0.9, ipset 7.19 with iptables 1.8.10, nginx 1.24,
 * HAProxy 2.8, curl 8.5, PowerShell 7.7):
 *
 *   nftables  wiki.nftables.org, Sets and Atomic rule replacement: one inet
 *             table, an interval set per family, `nft -f` applies a file as
 *             one transaction. An empty element list is a syntax error, so
 *             the feed's file only flushes a set with nothing to hold.
 *   ipset     ipset(8): `restore` fills new sets line by line, and `swap`,
 *             the atomic step, puts them in place; the drop rules sit in
 *             iptables' raw table, as ipset's Tips advise.
 *   nginx     ngx_http_access_module: `deny address | CIDR;`, checked
 *             in order; `nginx -t` then `nginx -s reload`, which keeps the
 *             old configuration if the new one fails.
 *   HAProxy   the Runtime API's `prepare acl`, `add acl @<version>` and
 *             `commit acl` (HAProxy 2.4 and later): one atomic swap of the
 *             running list, no reload. Several commands in one connection
 *             need `prompt` first.
 *   Windows   New-NetFirewallRule's -RemoteAddress takes addresses and
 *             subnets; MS-FASP caps a rule's list at 1,000 entries, so the
 *             script keeps a rule per 1,000, by -Name, and an empty part
 *             is never written (an empty list would mean any address).
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
export const SECURITY_BLOCKLIST_SNIPPET_LOCK: string =
  "/run/oneuptime-blocklist.lock";

// What nginx includes, HAProxy reads, and ipset fills.
export const SECURITY_BLOCKLIST_NGINX_INCLUDE: string =
  "/etc/nginx/oneuptime-blocklist.conf";
export const SECURITY_BLOCKLIST_HAPROXY_ACL_FILE: string =
  "/etc/haproxy/oneuptime-blocklist.lst";
export const SECURITY_BLOCKLIST_HAPROXY_SOCKET: string =
  "/run/haproxy/admin.sock";
export const SECURITY_BLOCKLIST_IPSET_V4: string = "oneuptime_v4";
export const SECURITY_BLOCKLIST_IPSET_V6: string = "oneuptime_v6";

// Windows: where the script and the secret live, the rules it keeps, the task that runs it.
export const SECURITY_BLOCKLIST_WINDOWS_DIR: string =
  "C:\\ProgramData\\OneUptime\\Blocklist";
export const SECURITY_BLOCKLIST_WINDOWS_RULE_PREFIX: string =
  "OneUptime-Blocklist-In-";
export const SECURITY_BLOCKLIST_WINDOWS_TASK: string = "OneUptime Blocklist";

// MS-FASP: each address list of a firewall rule is [range(0, 1000)].
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
 * The fetch every script makes once what it fills exists: the list into
 * $TMP, its headers into $TMP.h, the answer's code in $CODE. A 304 ends the
 * run; anything but a 200 ends it with what the feed answered.
 */
function fetchLines(): Array<string> {
  return [
    "TMP=$(mktemp)",
    'trap \'rm -f "$TMP" "$TMP.h"\' EXIT',
    'ETAG=$(cat "$STATE/etag" 2>/dev/null || true)',
    `CODE=$(curl --silent --show-error --max-time 60 --header @${SECURITY_BLOCKLIST_SNIPPET_CONFIG_DIR}/auth \\`,
    '  ${ETAG:+--header "If-None-Match: $ETAG"} \\',
    '  --dump-header "$TMP.h" --output "$TMP" --write-out \'%{http_code}\' "$URL")',
    '[ "$CODE" = 304 ] && exit 0',
    '[ "$CODE" = 200 ] || { echo "oneuptime-blocklist: the feed answered $CODE" >&2; exit 1; }',
  ];
}

// Each script's first lines: what it is, and where it reads from.
function scriptHeadLines(data: { what: string; url: string }): Array<string> {
  return [
    "#!/bin/sh",
    `# ${data.what}`,
    "set -eu",
    `URL=${quoteForShell(data.url)}`,
    `STATE=${SECURITY_BLOCKLIST_SNIPPET_STATE_DIR}`,
  ];
}

// Keeps the ETag of the list just loaded, so the next fetch of the same list is a 304.
const SAVE_ETAG_LINE: string =
  "sed -n 's/^[Ee][Tt][Aa][Gg]:[[:space:]]*//p' \"$TMP.h\" | tr -d '\\r' > \"$STATE/etag\"";

// Saves a script, makes cron run it every minute (never two at once), and runs it once now.
function installLines(scriptLines: Array<string>): Array<string> {
  return [
    `cat > ${SECURITY_BLOCKLIST_SNIPPET_SCRIPT} <<'SCRIPT'`,
    ...scriptLines,
    "SCRIPT",
    `chmod 700 ${SECURITY_BLOCKLIST_SNIPPET_SCRIPT}`,
    `echo '* * * * * root flock -n ${SECURITY_BLOCKLIST_SNIPPET_LOCK} ${SECURITY_BLOCKLIST_SNIPPET_SCRIPT}' > ${SECURITY_BLOCKLIST_SNIPPET_CRON}`,
    SECURITY_BLOCKLIST_SNIPPET_SCRIPT,
  ];
}

function lines(all: Array<string>): string {
  return `${all.join("\n")}\n`;
}

/*
 * nftables: an inet table with an interval set per family, and the rules
 * that drop what they hold on the input and forward hooks, made when the
 * table is missing; the feed's nftables.nft flushes and fills the sets in
 * one transaction.
 */
export function renderNftablesSnippet(data: {
  url: string;
  secret: string;
}): string {
  const table: string = `inet ${SECURITY_BLOCKLIST_NFTABLES_TABLE}`;
  const v4: string = SECURITY_BLOCKLIST_NFTABLES_IPV4_SET;
  const v6: string = SECURITY_BLOCKLIST_NFTABLES_IPV6_SET;

  return lines([
    "# Run once, as root.",
    ...secretFileLines(data.secret),
    ...installLines([
      ...scriptHeadLines({
        what: "Loads the OneUptime blocklist into nftables when it changed.",
        url: data.url,
      }),
      `if ! nft list table ${table} >/dev/null 2>&1; then`,
      '  rm -f "$STATE/etag"',
      "  nft -f - <<'NFT'",
      `table ${table} {`,
      // The feed never lists two entries that overlap; auto-merge takes them if one ever did.
      `  set ${v4} { type ipv4_addr; flags interval; auto-merge; }`,
      `  set ${v6} { type ipv6_addr; flags interval; auto-merge; }`,
      "  chain input {",
      "    type filter hook input priority filter; policy accept;",
      `    ip saddr @${v4} drop`,
      `    ip6 saddr @${v6} drop`,
      "  }",
      "  chain forward {",
      "    type filter hook forward priority filter; policy accept;",
      `    ip saddr @${v4} drop`,
      `    ip6 saddr @${v6} drop`,
      "  }",
      "}",
      "NFT",
      "fi",
      ...fetchLines(),
      'nft -f "$TMP"',
      SAVE_ETAG_LINE,
    ]),
  ]);
}

/*
 * ipset and iptables: a hash:net set per family and the raw-table rules
 * that drop what they hold, made when missing; the list fills two new sets
 * (ipset restore), which `swap` puts in place at once, so a rule never sees
 * a set half full.
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
      ...scriptHeadLines({
        what: "Loads the OneUptime blocklist into ipset when it changed.",
        url: data.url,
      }),
      `if ! ipset list -n ${v4} >/dev/null 2>&1; then rm -f "$STATE/etag"; fi`,
      `ipset create ${v4} hash:net family inet -exist`,
      `ipset create ${v6} hash:net family inet6 -exist`,
      `iptables -t raw -C PREROUTING -m set --match-set ${v4} src -j DROP 2>/dev/null || iptables -t raw -I PREROUTING -m set --match-set ${v4} src -j DROP`,
      `ip6tables -t raw -C PREROUTING -m set --match-set ${v6} src -j DROP 2>/dev/null || ip6tables -t raw -I PREROUTING -m set --match-set ${v6} src -j DROP`,
      ...fetchLines(),
      `ipset destroy ${v4}_new 2>/dev/null || true`,
      `ipset destroy ${v6}_new 2>/dev/null || true`,
      "{",
      `  echo "create ${v4}_new hash:net family inet"`,
      `  echo "create ${v6}_new hash:net family inet6"`,
      // No blank line or comment reaches ipset: one would stop the restore.
      `  grep -v -e '^[[:space:]]*$' -e '^#' "$TMP" | grep -v ':' | sed 's/^/add ${v4}_new /'`,
      `  grep -v -e '^[[:space:]]*$' -e '^#' "$TMP" | grep ':' | sed 's/^/add ${v6}_new /'`,
      "} | ipset -exist restore",
      `ipset swap ${v4}_new ${v4}`,
      `ipset swap ${v6}_new ${v6}`,
      `ipset destroy ${v4}_new`,
      `ipset destroy ${v6}_new`,
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
      ...scriptHeadLines({
        what: "Writes the OneUptime blocklist for nginx when it changed, and reloads nginx.",
        url: data.url,
      }),
      ...fetchLines(),
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
 * through its Runtime API - a version prepared, filled and committed at
 * once - with no reload.
 */
export function renderHaproxySnippet(data: {
  url: string;
  secret: string;
}): string {
  const acl: string = SECURITY_BLOCKLIST_HAPROXY_ACL_FILE;
  const socket: string = `unix-connect:${SECURITY_BLOCKLIST_HAPROXY_SOCKET}`;

  /*
   * The Runtime API updates only a list HAProxy already reads, so the file
   * and the two lines of haproxy.cfg come first, and one reload.
   */
  return lines([
    "# As root, first make the list HAProxy reads:",
    `touch ${acl}`,
    "# then add these lines to haproxy.cfg (HAProxy 2.4 or later) and reload HAProxy once:",
    `#   global:   stats socket ${SECURITY_BLOCKLIST_HAPROXY_SOCKET} mode 660 level admin`,
    `#   frontend: http-request deny if { src -n -f ${acl} }`,
    "# and then run the rest, once:",
    ...secretFileLines(data.secret),
    ...installLines([
      ...scriptHeadLines({
        what: "Updates the OneUptime blocklist in HAProxy when it changed, with no reload.",
        url: data.url,
      }),
      ...fetchLines(),
      `VERSION=$(echo "prepare acl ${acl}" | socat -t 30 stdio ${socket} | awk '/New version created:/ {print $NF}')`,
      '[ -n "$VERSION" ] || { echo "oneuptime-blocklist: HAProxy made no new version of the list" >&2; exit 1; }',
      `{ echo prompt; grep -v -e '^[[:space:]]*$' -e '^#' "$TMP" | while read -r ENTRY; do echo "add acl @$VERSION ${acl} $ENTRY"; done`,
      `  echo "commit acl @$VERSION ${acl}"; echo quit; } | socat -t 30 stdio ${socket} >/dev/null`,
      `cp "$TMP" ${acl}.new && mv ${acl}.new ${acl}`,
      SAVE_ETAG_LINE,
    ]),
  ]);
}

/*
 * Windows Firewall: a PowerShell script, run every minute by a scheduled
 * task as SYSTEM, that keeps inbound rules blocking every address on the
 * list - a rule per 1,000 addresses, each updated in place by its name, the
 * ones no longer needed removed - with the secret in a file of the
 * script's folder, which only SYSTEM and Administrators read.
 */
export function renderWindowsFirewallSnippet(data: {
  url: string;
  secret: string;
}): string {
  const prefix: string = SECURITY_BLOCKLIST_WINDOWS_RULE_PREFIX;
  const perRule: number = SECURITY_BLOCKLIST_WINDOWS_ADDRESSES_PER_RULE;

  const script: Array<string> = [
    "$ErrorActionPreference = 'Stop'",
    `$Dir = ${quoteForPowerShell(SECURITY_BLOCKLIST_WINDOWS_DIR)}`,
    `$Uri = ${quoteForPowerShell(data.url)}`,
    `$Prefix = ${quoteForPowerShell(prefix)}`,
    "$EtagFile = Join-Path $Dir 'blocklist.etag'",
    // Rules removed (by hand, a policy reset) while an ETag is kept would never come back: the whole list is fetched again.
    "if (-not (Get-NetFirewallRule -Name ('{0}000' -f $Prefix) -ErrorAction SilentlyContinue)) { Remove-Item -Path $EtagFile -ErrorAction SilentlyContinue }",
    "$Headers = @{ Authorization = \"Bearer $((Get-Content (Join-Path $Dir 'token.txt') -Raw).Trim())\" }",
    "if (Test-Path $EtagFile) { $Headers['If-None-Match'] = (Get-Content $EtagFile -Raw).Trim() }",
    "try { $Resp = Invoke-WebRequest -Uri $Uri -Headers $Headers -UseBasicParsing -TimeoutSec 60 }",
    "catch { if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -eq 304) { exit 0 }; throw }",
    "$Addresses = @($Resp.Content -split \"`r?`n\" | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })",
    "$Count = 0",
    `for ($i = 0; $i -lt $Addresses.Count; $i += ${perRule}) {`,
    `  $Part = $Addresses[$i..([Math]::Min($i + ${perRule - 1}, $Addresses.Count - 1))]`,
    "  $Name = '{0}{1:D3}' -f $Prefix, $Count",
    "  if (Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue) { Set-NetFirewallRule -Name $Name -RemoteAddress $Part }",
    '  else { New-NetFirewallRule -Name $Name -DisplayName "OneUptime blocklist $Count" -Direction Inbound -Action Block -RemoteAddress $Part | Out-Null }',
    "  $Count++",
    "}",
    'Get-NetFirewallRule -Name "$Prefix*" -ErrorAction SilentlyContinue |',
    "  Where-Object { [int]$_.Name.Substring($Prefix.Length) -ge $Count } | Remove-NetFirewallRule",
    "$Etag = @($Resp.Headers['ETag'])[0]",
    "if ($Etag) { Set-Content -Path $EtagFile -Value $Etag }",
  ];

  return lines([
    "# Run once, in PowerShell as an administrator.",
    `$Dir = ${quoteForPowerShell(SECURITY_BLOCKLIST_WINDOWS_DIR)}`,
    "New-Item -ItemType Directory -Force -Path $Dir | Out-Null",
    'icacls $Dir /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null',
    `Set-Content -Path (Join-Path $Dir 'token.txt') -Value ${quoteForPowerShell(data.secret)}`,
    "$Script = Join-Path $Dir 'Update-OneUptimeBlocklist.ps1'",
    "@'",
    ...script,
    "'@ | Set-Content -Path $Script",
    '$Action = New-ScheduledTaskAction -Execute \'powershell.exe\' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Script`""',
    "$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)",
    "$Settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)",
    `Register-ScheduledTask -TaskName ${quoteForPowerShell(SECURITY_BLOCKLIST_WINDOWS_TASK)} -Action $Action -Trigger $Trigger -Settings $Settings -User 'NT AUTHORITY\\SYSTEM' -RunLevel Highest -Force | Out-Null`,
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

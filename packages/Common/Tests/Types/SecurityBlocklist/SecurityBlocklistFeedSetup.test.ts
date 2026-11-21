import {
  SECURITY_BLOCKLIST_FEED_FIREWALLS,
  SECURITY_BLOCKLIST_FEED_FIREWALL_NAMES,
  SECURITY_BLOCKLIST_FEED_RECOMMENDED_REFRESH_IN_MINUTES,
  SecurityBlocklistFeedFamily,
  SecurityBlocklistFeedFirewall,
} from "../../../Types/SecurityBlocklist/SecurityBlocklistFeed";
import { SecurityBlocklistFeedFormat } from "../../../Types/SecurityBlocklist/SecurityBlocklistFeedFormat";
import {
  SECURITY_BLOCKLIST_FEED_BASIC_USERNAME,
  SECURITY_BLOCKLIST_FEED_SECRET_PLACEHOLDER,
  SECURITY_BLOCKLIST_FEED_SETUPS,
  SecurityBlocklistFeedAuthentication,
  SecurityBlocklistFeedSetup,
  SecurityBlocklistFeedUrls,
  buildSecurityBlocklistFeedSnippet,
  buildSecurityBlocklistFeedUrls,
  getSecurityBlocklistFeedDefaultFamily,
  getSecurityBlocklistFeedDefaultName,
  getSecurityBlocklistFeedSetup,
} from "../../../Types/SecurityBlocklist/SecurityBlocklistFeedSetup";
import {
  SECURITY_BLOCKLIST_WINDOWS_ADDRESSES_PER_RULE,
  quoteForPowerShell,
  quoteForShell,
  renderHaproxySnippet,
  renderIpsetSnippet,
  renderNftablesSnippet,
  renderNginxSnippet,
  renderSecurityBlocklistFeedSnippet,
  renderWindowsFirewallSnippet,
} from "../../../Types/SecurityBlocklist/SecurityBlocklistFeedSnippets";
import { describe, expect, test } from "@jest/globals";

/*
 * How each firewall and proxy reads a blocklist feed (#10345): the file,
 * how it sends the secret, how often to fetch, and the steps and scripts
 * the feed's page shows - each as its maker documents it.
 */

const API_URL: string = "https://oneuptime.example.com/api";
const FEED_ID: string = "5c1e7a40-5c2d-4e8f-9a61-7d0c2b4e6f01";
const SECRET: string =
  "4f1c0e5d8a7b6c3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e";
const BASE: string = `${API_URL}/blocklist-feed/${FEED_ID}`;

function setup(firewall: SecurityBlocklistFeedFirewall): SecurityBlocklistFeedSetup {
  return SECURITY_BLOCKLIST_FEED_SETUPS[firewall];
}

describe("each firewall's setup", () => {
  test("every firewall has one, of its own", () => {
    for (const firewall of SECURITY_BLOCKLIST_FEED_FIREWALLS) {
      expect(setup(firewall).firewall).toBe(firewall);
      expect(setup(firewall).steps.length).toBeGreaterThanOrEqual(2);
      expect(setup(firewall).docsAnchor).toMatch(/^[a-z0-9-]+$/);
      expect(setup(firewall).documentationUrl).toMatch(/^https:\/\//);
    }

    expect(getSecurityBlocklistFeedSetup("Juniper")).toBe(
      setup(SecurityBlocklistFeedFirewall.Other),
    );
    expect(getSecurityBlocklistFeedSetup(undefined)).toBe(
      setup(SecurityBlocklistFeedFirewall.Other),
    );
  });

  test("each follows its maker's own documentation", () => {
    const domains: Partial<Record<SecurityBlocklistFeedFirewall, string>> = {
      [SecurityBlocklistFeedFirewall.PaloAlto]: "docs.paloaltonetworks.com",
      [SecurityBlocklistFeedFirewall.FortiGate]: "docs.fortinet.com",
      [SecurityBlocklistFeedFirewall.CheckPoint]: "sc1.checkpoint.com",
      [SecurityBlocklistFeedFirewall.Cisco]: "docs.manage.security.cisco.com",
      [SecurityBlocklistFeedFirewall.OPNsense]: "docs.opnsense.org",
      [SecurityBlocklistFeedFirewall.PfSense]: "docs.netgate.com",
      [SecurityBlocklistFeedFirewall.Nftables]: "wiki.nftables.org",
      [SecurityBlocklistFeedFirewall.Ipset]: "ipset.netfilter.org",
      [SecurityBlocklistFeedFirewall.Nginx]: "nginx.org",
      [SecurityBlocklistFeedFirewall.HAProxy]: "docs.haproxy.org",
      [SecurityBlocklistFeedFirewall.WindowsFirewall]: "learn.microsoft.com",
    };

    for (const [firewall, domain] of Object.entries(domains)) {
      expect(
        new URL(setup(firewall as SecurityBlocklistFeedFirewall).documentationUrl)
          .hostname,
      ).toBe(domain);
    }
  });

  test("the secret is a password where a firewall takes one, in the path where it documents no way to send it, and a bearer token from a host", () => {
    const byAuthentication: Record<
      SecurityBlocklistFeedAuthentication,
      Array<SecurityBlocklistFeedFirewall>
    > = {
      [SecurityBlocklistFeedAuthentication.Basic]: [],
      [SecurityBlocklistFeedAuthentication.Bearer]: [],
      [SecurityBlocklistFeedAuthentication.PathSecret]: [],
    };

    for (const firewall of SECURITY_BLOCKLIST_FEED_FIREWALLS) {
      byAuthentication[setup(firewall).authentication].push(firewall);
    }

    expect(byAuthentication).toEqual({
      // Palo Alto (HTTPS only), FortiGate and Check Point document a username and password.
      [SecurityBlocklistFeedAuthentication.Basic]: [
        SecurityBlocklistFeedFirewall.PaloAlto,
        SecurityBlocklistFeedFirewall.FortiGate,
        SecurityBlocklistFeedFirewall.CheckPoint,
        SecurityBlocklistFeedFirewall.Other,
      ],
      [SecurityBlocklistFeedAuthentication.Bearer]: [
        SecurityBlocklistFeedFirewall.Nftables,
        SecurityBlocklistFeedFirewall.Ipset,
        SecurityBlocklistFeedFirewall.Nginx,
        SecurityBlocklistFeedFirewall.HAProxy,
        SecurityBlocklistFeedFirewall.WindowsFirewall,
      ],
      // Cisco, OPNsense and pfSense document no way to send one.
      [SecurityBlocklistFeedAuthentication.PathSecret]: [
        SecurityBlocklistFeedFirewall.Cisco,
        SecurityBlocklistFeedFirewall.OPNsense,
        SecurityBlocklistFeedFirewall.PfSense,
      ],
    });
  });

  test("Palo Alto gets the plain list alone: it documents no comment line", () => {
    expect(setup(SecurityBlocklistFeedFirewall.PaloAlto)).toMatchObject({
      format: SecurityBlocklistFeedFormat.Plain,
      withComments: false,
      withMd5: false,
    });
  });

  test("FortiGate, Check Point, Cisco and OPNsense get the commented list: each skips lines starting with #", () => {
    for (const firewall of [
      SecurityBlocklistFeedFirewall.FortiGate,
      SecurityBlocklistFeedFirewall.CheckPoint,
      SecurityBlocklistFeedFirewall.Cisco,
      SecurityBlocklistFeedFirewall.OPNsense,
    ]) {
      expect(setup(firewall).withComments).toBe(true);
    }
  });

  test("Cisco alone gets an MD5 URL: it needs one for an update every 30 minutes or less", () => {
    expect(
      SECURITY_BLOCKLIST_FEED_FIREWALLS.filter(
        (firewall: SecurityBlocklistFeedFirewall): boolean => {
          return setup(firewall).withMd5;
        },
      ),
    ).toEqual([SecurityBlocklistFeedFirewall.Cisco]);
  });

  test("Check Point documents IPv4 for a network feed, so a feed for it serves IPv4; every other firewall takes both", () => {
    expect(
      getSecurityBlocklistFeedDefaultFamily(SecurityBlocklistFeedFirewall.CheckPoint),
    ).toBe(SecurityBlocklistFeedFamily.IPv4);

    for (const firewall of SECURITY_BLOCKLIST_FEED_FIREWALLS) {
      if (firewall !== SecurityBlocklistFeedFirewall.CheckPoint) {
        expect(getSecurityBlocklistFeedDefaultFamily(firewall)).toBe(
          SecurityBlocklistFeedFamily.Both,
        );
      }
    }
  });

  test("a firewall is fetched every five minutes, a host every minute; OPNsense and pfSense cannot fetch that often, and say so", () => {
    expect(SECURITY_BLOCKLIST_FEED_RECOMMENDED_REFRESH_IN_MINUTES).toBe(5);

    for (const firewall of [
      SecurityBlocklistFeedFirewall.PaloAlto,
      SecurityBlocklistFeedFirewall.FortiGate,
      SecurityBlocklistFeedFirewall.CheckPoint,
      SecurityBlocklistFeedFirewall.Cisco,
    ]) {
      expect(setup(firewall).refreshInMinutes).toBe(5);
    }

    for (const firewall of [
      SecurityBlocklistFeedFirewall.Nftables,
      SecurityBlocklistFeedFirewall.Ipset,
      SecurityBlocklistFeedFirewall.Nginx,
      SecurityBlocklistFeedFirewall.HAProxy,
      SecurityBlocklistFeedFirewall.WindowsFirewall,
    ]) {
      expect(setup(firewall).refreshInMinutes).toBe(1);
      expect(setup(firewall).hasSnippet).toBe(true);
    }

    for (const firewall of [
      SecurityBlocklistFeedFirewall.OPNsense,
      SecurityBlocklistFeedFirewall.PfSense,
    ]) {
      expect(setup(firewall).refreshInMinutes).toBeNull();
      expect(setup(firewall).note).toBeTruthy();
    }

    expect(setup(SecurityBlocklistFeedFirewall.PfSense).note).toContain(
      "too slow to block an attack",
    );
  });

  test("a step that names the URL, the username or the interval says so with its placeholder", () => {
    expect(setup(SecurityBlocklistFeedFirewall.PaloAlto).steps.join(" ")).toContain(
      "{{url}}",
    );
    expect(setup(SecurityBlocklistFeedFirewall.PaloAlto).steps.join(" ")).toContain(
      "{{username}}",
    );
    expect(setup(SecurityBlocklistFeedFirewall.Cisco).steps.join(" ")).toContain(
      "{{md5Url}}",
    );
    expect(setup(SecurityBlocklistFeedFirewall.FortiGate).steps.join(" ")).toContain(
      "{{minutes}}",
    );

    for (const firewall of SECURITY_BLOCKLIST_FEED_FIREWALLS) {
      for (const step of setup(firewall).steps) {
        // Every placeholder is one the page fills.
        for (const match of step.matchAll(/\{\{(\w+)\}\}/g)) {
          expect(["url", "md5Url", "username", "minutes"]).toContain(match[1]);
        }
      }
    }
  });

  test("a feed made for a firewall is named after it", () => {
    expect(
      getSecurityBlocklistFeedDefaultName(
        SecurityBlocklistFeedFirewall.FortiGate,
        SECURITY_BLOCKLIST_FEED_FIREWALL_NAMES,
      ),
    ).toBe("FortiGate feed");
    expect(
      getSecurityBlocklistFeedDefaultName(
        SecurityBlocklistFeedFirewall.PaloAlto,
        SECURITY_BLOCKLIST_FEED_FIREWALL_NAMES,
      ),
    ).toBe("Palo Alto Networks feed");
    expect(
      getSecurityBlocklistFeedDefaultName(
        SecurityBlocklistFeedFirewall.Other,
        SECURITY_BLOCKLIST_FEED_FIREWALL_NAMES,
      ),
    ).toBe("Blocklist feed");
  });
});

describe("the URLs a firewall is given", () => {
  function urls(
    firewall: SecurityBlocklistFeedFirewall,
    secret: string | null,
  ): SecurityBlocklistFeedUrls {
    return buildSecurityBlocklistFeedUrls({
      apiUrl: `${API_URL}/`,
      feedId: FEED_ID,
      setup: setup(firewall),
      secret,
    });
  }

  test("a firewall that sends the secret as a password or a token gets a URL with no secret in it", () => {
    expect(urls(SecurityBlocklistFeedFirewall.PaloAlto, SECRET)).toEqual({
      url: `${BASE}/blocklist.txt`,
      md5Url: null,
    });
    expect(urls(SecurityBlocklistFeedFirewall.FortiGate, SECRET)).toEqual({
      url: `${BASE}/blocklist.txt?comments=1`,
      md5Url: null,
    });
    expect(urls(SecurityBlocklistFeedFirewall.Nftables, SECRET).url).toBe(
      `${BASE}/nftables.nft`,
    );
    expect(urls(SecurityBlocklistFeedFirewall.Nginx, SECRET).url).toBe(
      `${BASE}/nginx.conf`,
    );
  });

  test("a firewall that sends it no other way gets it in the path, and Cisco its MD5 URL beside the list", () => {
    expect(urls(SecurityBlocklistFeedFirewall.Cisco, SECRET)).toEqual({
      url: `${BASE}/${SECRET}/blocklist.txt?comments=1`,
      md5Url: `${BASE}/${SECRET}/blocklist.txt.md5?comments=1`,
    });
    expect(urls(SecurityBlocklistFeedFirewall.PfSense, SECRET).url).toBe(
      `${BASE}/${SECRET}/blocklist.txt`,
    );
  });

  test("once OneUptime no longer shows the secret, the path holds the placeholder", () => {
    expect(urls(SecurityBlocklistFeedFirewall.OPNsense, null).url).toBe(
      `${BASE}/${SECURITY_BLOCKLIST_FEED_SECRET_PLACEHOLDER}/blocklist.txt?comments=1`,
    );
    expect(urls(SecurityBlocklistFeedFirewall.PaloAlto, null).url).toBe(
      `${BASE}/blocklist.txt`,
    );
  });

  test("a firewall's username is OneUptime's, and any works", () => {
    expect(SECURITY_BLOCKLIST_FEED_BASIC_USERNAME).toBe("oneuptime");
  });
});

describe("the scripts a host runs", () => {
  const URL_TEXT: string = `${BASE}/nftables.nft`;

  test("nftables: the table, its two sets and the rules, made when missing; the feed loaded in one transaction", () => {
    expect(renderNftablesSnippet({ url: URL_TEXT, secret: SECRET })).toBe(
      [
        "# Run once, as root.",
        "install -d -m 700 /etc/oneuptime-blocklist /var/lib/oneuptime-blocklist",
        `printf 'Authorization: Bearer %s\\n' '${SECRET}' > /etc/oneuptime-blocklist/auth`,
        "chmod 600 /etc/oneuptime-blocklist/auth",
        "cat > /usr/local/sbin/oneuptime-blocklist <<'SCRIPT'",
        "#!/bin/sh",
        "# Loads the OneUptime blocklist into nftables when it changed.",
        "set -eu",
        `URL='${URL_TEXT}'`,
        "STATE=/var/lib/oneuptime-blocklist",
        "if ! nft list table inet oneuptime >/dev/null 2>&1; then",
        '  rm -f "$STATE/etag"',
        "  nft -f - <<'NFT'",
        "table inet oneuptime {",
        "  set blocklist_v4 { type ipv4_addr; flags interval; auto-merge; }",
        "  set blocklist_v6 { type ipv6_addr; flags interval; auto-merge; }",
        "  chain input {",
        "    type filter hook input priority filter; policy accept;",
        "    ip saddr @blocklist_v4 drop",
        "    ip6 saddr @blocklist_v6 drop",
        "  }",
        "  chain forward {",
        "    type filter hook forward priority filter; policy accept;",
        "    ip saddr @blocklist_v4 drop",
        "    ip6 saddr @blocklist_v6 drop",
        "  }",
        "}",
        "NFT",
        "fi",
        "TMP=$(mktemp)",
        'trap \'rm -f "$TMP" "$TMP.h"\' EXIT',
        'ETAG=$(cat "$STATE/etag" 2>/dev/null || true)',
        "CODE=$(curl --silent --show-error --max-time 60 --header @/etc/oneuptime-blocklist/auth \\",
        '  ${ETAG:+--header "If-None-Match: $ETAG"} \\',
        '  --dump-header "$TMP.h" --output "$TMP" --write-out \'%{http_code}\' "$URL")',
        '[ "$CODE" = 304 ] && exit 0',
        '[ "$CODE" = 200 ] || { echo "oneuptime-blocklist: the feed answered $CODE" >&2; exit 1; }',
        'nft -f "$TMP"',
        "sed -n 's/^[Ee][Tt][Aa][Gg]:[[:space:]]*//p' \"$TMP.h\" | tr -d '\\r' > \"$STATE/etag\"",
        "SCRIPT",
        "chmod 700 /usr/local/sbin/oneuptime-blocklist",
        "echo '* * * * * root flock -n /run/oneuptime-blocklist.lock /usr/local/sbin/oneuptime-blocklist' > /etc/cron.d/oneuptime-blocklist",
        "/usr/local/sbin/oneuptime-blocklist",
        "",
      ].join("\n"),
    );
  });

  test("ipset: new sets filled with restore and swapped in, the drop rules in the raw table", () => {
    const snippet: string = renderIpsetSnippet({
      url: `${BASE}/blocklist.txt`,
      secret: SECRET,
    });

    for (const line of [
      "ipset create oneuptime_v4 hash:net family inet -exist",
      "ipset create oneuptime_v6 hash:net family inet6 -exist",
      "iptables -t raw -C PREROUTING -m set --match-set oneuptime_v4 src -j DROP 2>/dev/null || iptables -t raw -I PREROUTING -m set --match-set oneuptime_v4 src -j DROP",
      "ip6tables -t raw -C PREROUTING -m set --match-set oneuptime_v6 src -j DROP 2>/dev/null || ip6tables -t raw -I PREROUTING -m set --match-set oneuptime_v6 src -j DROP",
      "ipset destroy oneuptime_v4_new 2>/dev/null || true",
      '  echo "create oneuptime_v4_new hash:net family inet"',
      "  grep -v -e '^[[:space:]]*$' -e '^#' \"$TMP\" | grep -v ':' | sed 's/^/add oneuptime_v4_new /'",
      "  grep -v -e '^[[:space:]]*$' -e '^#' \"$TMP\" | grep ':' | sed 's/^/add oneuptime_v6_new /'",
      "} | ipset -exist restore",
      "ipset swap oneuptime_v4_new oneuptime_v4",
      "ipset swap oneuptime_v6_new oneuptime_v6",
    ]) {
      expect(snippet.split("\n")).toContain(line);
    }

    // The swap comes after the restore, and the ETag after the swap.
    expect(snippet.indexOf("ipset -exist restore")).toBeLessThan(
      snippet.indexOf("ipset swap oneuptime_v4_new"),
    );
    expect(snippet.indexOf("ipset swap oneuptime_v6_new")).toBeLessThan(
      snippet.lastIndexOf('> "$STATE/etag"'),
    );
  });

  test("nginx: the include written, the configuration checked, nginx reloaded - and the last file put back if nginx refuses it", () => {
    const snippet: string = renderNginxSnippet({
      url: `${BASE}/nginx.conf`,
      secret: SECRET,
    });

    expect(snippet).toContain("touch /etc/nginx/oneuptime-blocklist.conf\n");
    expect(snippet).toContain(
      'if nginx -t -q; then nginx -s reload; else cp "$STATE/last.conf" /etc/nginx/oneuptime-blocklist.conf; exit 1; fi\n',
    );
    expect(snippet).toContain(
      "#   include /etc/nginx/oneuptime-blocklist.conf;\n",
    );
  });

  test("HAProxy: a version prepared, filled and committed through the Runtime API in one prompt session, and the file kept for a restart", () => {
    const snippet: string = renderHaproxySnippet({
      url: `${BASE}/blocklist.txt`,
      secret: SECRET,
    });

    /*
     * The Runtime API updates only a list HAProxy already reads: the file,
     * the two lines of haproxy.cfg and a reload come before any command.
     */
    expect(snippet.split("\n").slice(0, 6)).toEqual([
      "# As root, first make the list HAProxy reads:",
      "touch /etc/haproxy/oneuptime-blocklist.lst",
      "# then add these lines to haproxy.cfg (HAProxy 2.4 or later) and reload HAProxy once:",
      "#   global:   stats socket /run/haproxy/admin.sock mode 660 level admin",
      "#   frontend: http-request deny if { src -n -f /etc/haproxy/oneuptime-blocklist.lst }",
      "# and then run the rest, once:",
    ]);
    expect(snippet).toContain(
      `VERSION=$(echo "prepare acl /etc/haproxy/oneuptime-blocklist.lst" | socat -t 30 stdio unix-connect:/run/haproxy/admin.sock | awk '/New version created:/ {print $NF}')\n`,
    );
    // Several commands in one connection need prompt first, or HAProxy runs the first alone.
    expect(snippet).toContain(
      "{ echo prompt; grep -v -e '^[[:space:]]*$' -e '^#' \"$TMP\" | while read -r ENTRY; do echo \"add acl @$VERSION /etc/haproxy/oneuptime-blocklist.lst $ENTRY\"; done\n",
    );
    expect(snippet).toContain(
      '  echo "commit acl @$VERSION /etc/haproxy/oneuptime-blocklist.lst"; echo quit; } | socat -t 30 stdio unix-connect:/run/haproxy/admin.sock >/dev/null\n',
    );
  });

  test("Windows Firewall: a rule per 1,000 addresses kept by name, a 304 that changes nothing, and a task every minute as SYSTEM", () => {
    const snippet: string = renderWindowsFirewallSnippet({
      url: `${BASE}/blocklist.txt`,
      secret: SECRET,
    });

    expect(SECURITY_BLOCKLIST_WINDOWS_ADDRESSES_PER_RULE).toBe(1000);

    for (const line of [
      `Set-Content -Path (Join-Path $Dir 'token.txt') -Value '${SECRET}'`,
      'icacls $Dir /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null',
      "catch { if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -eq 304) { exit 0 }; throw }",
      // Rules gone while an ETag is kept: the whole list again, never a 304 forever.
      "if (-not (Get-NetFirewallRule -Name ('{0}000' -f $Prefix) -ErrorAction SilentlyContinue)) { Remove-Item -Path $EtagFile -ErrorAction SilentlyContinue }",
      "for ($i = 0; $i -lt $Addresses.Count; $i += 1000) {",
      "  $Part = $Addresses[$i..([Math]::Min($i + 999, $Addresses.Count - 1))]",
      "  if (Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue) { Set-NetFirewallRule -Name $Name -RemoteAddress $Part }",
      "$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)",
      "Register-ScheduledTask -TaskName 'OneUptime Blocklist' -Action $Action -Trigger $Trigger -Settings $Settings -User 'NT AUTHORITY\\SYSTEM' -RunLevel Highest -Force | Out-Null",
    ]) {
      expect(snippet.split("\n")).toContain(line);
    }

    // The script reads the secret from its file: it is written into no script.
    const script: string = snippet.slice(
      snippet.indexOf("@'\n"),
      snippet.indexOf("'@"),
    );

    expect(script).not.toContain(SECRET);
  });

  test("every script sends the secret from a file only root reads, never on a command line", () => {
    for (const render of [
      renderNftablesSnippet,
      renderIpsetSnippet,
      renderNginxSnippet,
      renderHaproxySnippet,
    ]) {
      const snippet: string = render({ url: URL_TEXT, secret: SECRET });
      const lines: Array<string> = snippet.split("\n").filter((line: string): boolean => {
        return line.includes(SECRET);
      });

      expect(lines).toEqual([
        `printf 'Authorization: Bearer %s\\n' '${SECRET}' > /etc/oneuptime-blocklist/auth`,
      ]);
      expect(snippet).toContain("chmod 600 /etc/oneuptime-blocklist/auth");
      expect(snippet).toContain("--header @/etc/oneuptime-blocklist/auth");
      // The ETag is kept only once the list is loaded.
      expect(snippet.trimEnd().split("SCRIPT\n")[1]).toBeDefined();
      expect(snippet).toContain(
        "echo '* * * * * root flock -n /run/oneuptime-blocklist.lock /usr/local/sbin/oneuptime-blocklist' > /etc/cron.d/oneuptime-blocklist",
      );
    }
  });

  test("a firewall set up in its own console has no script", () => {
    for (const firewall of [
      SecurityBlocklistFeedFirewall.PaloAlto,
      SecurityBlocklistFeedFirewall.Cisco,
      SecurityBlocklistFeedFirewall.Other,
    ]) {
      expect(
        renderSecurityBlocklistFeedSnippet({
          firewall,
          url: URL_TEXT,
          secret: SECRET,
        }),
      ).toBeNull();
      expect(
        buildSecurityBlocklistFeedSnippet({
          setup: setup(firewall),
          url: URL_TEXT,
          secret: SECRET,
        }),
      ).toBeNull();
    }
  });

  test("without the secret, the script holds the placeholder", () => {
    expect(
      buildSecurityBlocklistFeedSnippet({
        setup: setup(SecurityBlocklistFeedFirewall.Nftables),
        url: URL_TEXT,
        secret: null,
      }),
    ).toContain(`'${SECURITY_BLOCKLIST_FEED_SECRET_PLACEHOLDER}'`);
  });

  test("a value is quoted so the shell and PowerShell take it whole", () => {
    expect(quoteForShell("it's")).toBe("'it'\\''s'");
    expect(quoteForShell("plain")).toBe("'plain'");
    expect(quoteForPowerShell("it's")).toBe("'it''s'");
  });
});

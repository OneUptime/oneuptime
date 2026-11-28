import { lookupTable } from "../../../Utils/LookupTable";
import { CrowdSecBehavior } from "./CrowdSecBehavior";

/*
 * THE CROWDSEC HUB'S OWN SCENARIOS, AS THE HUB LABELS THEM (#11158).
 *
 * A CrowdSec alert names the scenario that fired (crowdsecurity/ssh-bf)
 * and nothing of what the scenario is: the labels a scenario carries in
 * the Hub - its behaviour, its MITRE ATT&CK techniques, its name - stay
 * in the Hub. So OneUptime keeps them for CrowdSec's own scenarios, the
 * ones nearly every installation runs: each one's behaviour family (what
 * its severity follows), its techniques and its label, as the Hub's index
 * wrote them. A scenario not listed - a community or custom one - is
 * read by its name (CrowdSecScenarioReading).
 *
 * Generated from the Hub's .index.json at commit 99e0fb1e8973 (2026-11-26),
 * the official crowdsecurity/* scenarios only. The CrowdSec Hub is
 * MIT-licensed (https://github.com/crowdsecurity/hub). Regenerate it, do
 * not edit it by hand.
 */

export interface CrowdSecHubScenario {
  behavior: CrowdSecBehavior;
  // As the Hub classifies it: T1110, T1595.003.
  techniques: ReadonlyArray<string>;
  // The Hub's own name for it: "SSH Bruteforce".
  label: string;
}

export const CROWDSEC_HUB_INDEX_COMMIT: string =
  "99e0fb1e8973f862ce1a628033e9dbccec5fa34e";

export const CROWDSEC_HUB_SCENARIOS: ReadonlyMap<string, CrowdSecHubScenario> =
  lookupTable<CrowdSecHubScenario>({
    "crowdsecurity/CVE-2017-9841": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "PHP Unit Test Framework CVE-2017-9841",
    },
    "crowdsecurity/CVE-2019-18935": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "Telerik CVE-2019-18935",
    },
    "crowdsecurity/CVE-2021-4034": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1548"],
      label: "`pkexec` CVE-2021-4034",
    },
    "crowdsecurity/CVE-2022-26134": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "Confluence - RCE",
    },
    "crowdsecurity/CVE-2022-35914": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "GLPI CVE-2022-35914",
    },
    "crowdsecurity/CVE-2022-37042": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "ZCS CVE-2022-37042",
    },
    "crowdsecurity/CVE-2022-40684": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1548"],
      label: "Fortinet CVE-2022-40684",
    },
    "crowdsecurity/CVE-2022-41082": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "Microsoft Exchange CVE-2022-41082",
    },
    "crowdsecurity/CVE-2022-41697": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1589"],
      label: "Ghost CVE-2022-41697",
    },
    "crowdsecurity/CVE-2022-42889": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "Text4Shell CVE-2022-42889",
    },
    "crowdsecurity/CVE-2022-44877": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "Centos Webpanel CVE-2022-44877",
    },
    "crowdsecurity/CVE-2022-46169": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1592"],
      label: "Cacti CVE-2022-46169",
    },
    "crowdsecurity/CVE-2023-22515": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "Confluence CVE-2023-22515",
    },
    "crowdsecurity/CVE-2023-22518": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "Atlassian Confluence Server CVE-2023-22518",
    },
    "crowdsecurity/CVE-2023-23397": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1068"],
      label: "Microsoft Outlook CVE-2023-23397",
    },
    "crowdsecurity/CVE-2023-49103": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "ownCloud CVE-2023-49103",
    },
    "crowdsecurity/CVE-2023-4911": {
      behavior: CrowdSecBehavior.PostExploitation,
      techniques: ["T1548.004"],
      label: "CVE-2023-4911",
    },
    "crowdsecurity/CVE-2024-0012": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "CVE-2024-0012",
    },
    "crowdsecurity/CVE-2024-38475": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "CVE-2024-38475",
    },
    "crowdsecurity/CVE-2024-9474": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "CVE-2024-9474",
    },
    "crowdsecurity/amavis-blocked": {
      behavior: CrowdSecBehavior.Spam,
      techniques: ["T1203", "T1204"],
      label: "Infected Email",
    },
    "crowdsecurity/apache_log4j2_cve-2021-44228": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "Log4j CVE-2021-44228",
    },
    "crowdsecurity/appsec-bot-challenge-too-many-requests": {
      behavior: CrowdSecBehavior.Bot,
      techniques: ["T1110"],
      label: "Blocked by CrowdSec AppSec",
    },
    "crowdsecurity/appsec-bot-challenge-too-many-submissions": {
      behavior: CrowdSecBehavior.Bot,
      techniques: ["T1110"],
      label: "Blocked by CrowdSec AppSec",
    },
    "crowdsecurity/appsec-generic-test": {
      behavior: CrowdSecBehavior.Test,
      techniques: [],
      label: "Crowdsec Generic Test Scenario for AppSec",
    },
    "crowdsecurity/appsec-native": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190"],
      label: "Blocked by CrowdSec AppSec",
    },
    "crowdsecurity/appsec-vpatch": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190"],
      label: "Blocked by CrowdSec AppSec",
    },
    "crowdsecurity/asterisk_bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Asterisk Bruteforce",
    },
    "crowdsecurity/asterisk_user_enum": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1087", "T1589.001", "T1110"],
      label: "Asterisk User Enumeration",
    },
    "crowdsecurity/auditd-base64-exec-behavior": {
      behavior: CrowdSecBehavior.PostExploitation,
      techniques: ["T1059.004"],
      label: "Post Exploitation command execution from base64 encoded payload",
    },
    "crowdsecurity/auditd-postexploit-exec-from-net": {
      behavior: CrowdSecBehavior.PostExploitation,
      techniques: ["T1059.004"],
      label: "Post Exploitation command execution from Internet",
    },
    "crowdsecurity/auditd-postexploit-pkill": {
      behavior: CrowdSecBehavior.PostExploitation,
      techniques: ["T1059.004"],
      label: "Post Exploitation command execution",
    },
    "crowdsecurity/auditd-postexploit-rm": {
      behavior: CrowdSecBehavior.PostExploitation,
      techniques: ["T1059.004"],
      label: "Post Exploitation command execution",
    },
    "crowdsecurity/auditd-suid-crash": {
      behavior: CrowdSecBehavior.PostExploitation,
      techniques: ["T1548.004"],
      label: "Suspicious suid process crash",
    },
    "crowdsecurity/auditd-sus-exec": {
      behavior: CrowdSecBehavior.PostExploitation,
      techniques: ["T1059.004"],
      label: "Post Exploitation command execution",
    },
    "crowdsecurity/aws-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "AWS bruteforce",
    },
    "crowdsecurity/aws-bf-survey": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1589", "T1110"],
      label: "AWS Console User Enumeration",
    },
    "crowdsecurity/aws-cis-benchmark-cloudtrail-config-change": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1070"],
      label: "AWS CloudTrail indicator removal",
    },
    "crowdsecurity/aws-cis-benchmark-config-config-change": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1070"],
      label: "AWS Config indicator removal",
    },
    "crowdsecurity/aws-cis-benchmark-console-auth-fail": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "AWS bruteforce",
    },
    "crowdsecurity/aws-cis-benchmark-iam-policy-change": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1098.003"],
      label: "AWS IAM persistent access",
    },
    "crowdsecurity/aws-cis-benchmark-kms-deletion": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1485"],
      label: "AWS KMS indicator removal",
    },
    "crowdsecurity/aws-cis-benchmark-login-no-mfa": {
      behavior: CrowdSecBehavior.UnusualActivity,
      techniques: ["T1552", "T1078.004"],
      label: "AWS Credential misuse",
    },
    "crowdsecurity/aws-cis-benchmark-nacl-change": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1578"],
      label: "AWS NACL change",
    },
    "crowdsecurity/aws-cis-benchmark-ngw-change": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1578"],
      label: "AWS Network Gateway change",
    },
    "crowdsecurity/aws-cis-benchmark-root-usage": {
      behavior: CrowdSecBehavior.UnusualActivity,
      techniques: ["T1078", "T1098"],
      label: "AWS root account usage",
    },
    "crowdsecurity/aws-cis-benchmark-route-table-change": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1578"],
      label: "AWS route table change",
    },
    "crowdsecurity/aws-cis-benchmark-s3-policy-change": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1578"],
      label: "AWS S3 bucket policy change",
    },
    "crowdsecurity/aws-cis-benchmark-security-group-change": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1578"],
      label: "AWS Security Group change",
    },
    "crowdsecurity/aws-cis-benchmark-unauthorized-call": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1212"],
      label: "AWS API unauthorized calls",
    },
    "crowdsecurity/aws-cis-benchmark-vpc-change": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1578"],
      label: "AWS VPC change",
    },
    "crowdsecurity/aws-cloudtrail-postexploit": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1087", "T1526"],
      label: "AWS post-exploitation detection",
    },
    "crowdsecurity/aws-nwo-login": {
      behavior: CrowdSecBehavior.UnusualActivity,
      techniques: ["T1078"],
      label: "AWS bruteforce",
    },
    "crowdsecurity/configserver-lfd-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "SSH Bruteforce",
    },
    "crowdsecurity/cpanel-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "cPanel Bruteforce",
    },
    "crowdsecurity/cpanel-bf-attempt": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "cPanel Bruteforce",
    },
    "crowdsecurity/crowdsec-appsec-inband": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190"],
      label: "Triggered multiple InBand CrowdSec AppSec rules",
    },
    "crowdsecurity/crowdsec-appsec-outofband": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190"],
      label: "Triggered multiple OutOfBand CrowdSec AppSec rules",
    },
    "crowdsecurity/dovecot-spam": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Dovecot Bruteforce",
    },
    "crowdsecurity/endlessh-bf": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595"],
      label: "Endlessh SSH Scan",
    },
    "crowdsecurity/exchange-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Microsoft Exchange Bruteforce",
    },
    "crowdsecurity/exim-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Exim Bruteforce",
    },
    "crowdsecurity/exim-spam": {
      behavior: CrowdSecBehavior.Spam,
      techniques: [],
      label: "Exim Spam",
    },
    "crowdsecurity/f5-big-ip-cve-2020-5902": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190", "T1595"],
      label: "F5 BIG-IP TMUI - RCE",
    },
    "crowdsecurity/fortinet-cve-2018-13379": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190", "T1595"],
      label: "CVE-2018-13379",
    },
    "crowdsecurity/fortinet-vpn-bruteforce": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Fortinet VPN Bruteforce",
    },
    "crowdsecurity/freeswitch-acl-reject": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "FreeSWITCH ACL Reject",
    },
    "crowdsecurity/freeswitch-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Freeswitch Bruteforce",
    },
    "crowdsecurity/freeswitch-user-enumeration": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1589"],
      label: "Freeswitch User Enumeration",
    },
    "crowdsecurity/grafana-cve-2021-43798": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190", "T1595"],
      label: "Grafana - LFI",
    },
    "crowdsecurity/home-assistant-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Home Assistant Bruteforce",
    },
    "crowdsecurity/http-admin-interface-probing": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595"],
      label: "HTTP Admin Interface Probing",
    },
    "crowdsecurity/http-apiscp-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "apisCP bruteforce",
    },
    "crowdsecurity/http-backdoors-attempts": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595"],
      label: "Scanning for backdoors",
    },
    "crowdsecurity/http-bad-user-agent": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595"],
      label: "Bad User Agent",
    },
    "crowdsecurity/http-bf-wordpress_bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "WordPress Bruteforce",
    },
    "crowdsecurity/http-bf-wordpress_bf_xmlrpc": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "WP XMLRPC bruteforce",
    },
    "crowdsecurity/http-crawl-non_statics": {
      behavior: CrowdSecBehavior.Crawl,
      techniques: ["T1595"],
      label: "Aggressive Crawl",
    },
    "crowdsecurity/http-cve-2021-41773": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190", "T1595"],
      label: "CVE-2021-41773",
    },
    "crowdsecurity/http-cve-2021-42013": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190", "T1595"],
      label: "CVE-2021-42013",
    },
    "crowdsecurity/http-cve-probing": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595"],
      label: "HTTP CVE Probing",
    },
    "crowdsecurity/http-dos-bypass-cache": {
      behavior: CrowdSecBehavior.DenialOfService,
      techniques: ["T1498"],
      label: "HTTP DOS with cache bypass",
    },
    "crowdsecurity/http-dos-invalid-http-versions": {
      behavior: CrowdSecBehavior.DenialOfService,
      techniques: ["T1498"],
      label: "HTTP DOS with invalid HTTP version",
    },
    "crowdsecurity/http-dos-random-uri": {
      behavior: CrowdSecBehavior.DenialOfService,
      techniques: ["T1498"],
      label: "HTTP DOS via random URI",
    },
    "crowdsecurity/http-dos-switching-ua": {
      behavior: CrowdSecBehavior.DenialOfService,
      techniques: ["T1498"],
      label: "HTTP DOS with varying UA",
    },
    "crowdsecurity/http-generic-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "HTTP Bruteforce",
    },
    "crowdsecurity/http-generic-test": {
      behavior: CrowdSecBehavior.Test,
      techniques: [],
      label: "CrowdSec Generic Test Scenario",
    },
    "crowdsecurity/http-magento-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Magento Bruteforce",
    },
    "crowdsecurity/http-magento-ccs": {
      behavior: CrowdSecBehavior.Fraud,
      techniques: ["T1110.004"],
      label: "Magento Credit Card Stuffing",
    },
    "crowdsecurity/http-magento-ccs-by-as": {
      behavior: CrowdSecBehavior.Fraud,
      techniques: ["T1110.004"],
      label: "Magento Credit Card Stuffing By AS",
    },
    "crowdsecurity/http-magento-ccs-by-country": {
      behavior: CrowdSecBehavior.Fraud,
      techniques: ["T1110.004"],
      label: "Magento Credit Card Stuffing By Country",
    },
    "crowdsecurity/http-open-proxy": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595"],
      label: "HTTP Open Proxy Probing",
    },
    "crowdsecurity/http-path-traversal-probing": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595.002"],
      label: "HTTP Path Traversal Exploit",
    },
    "crowdsecurity/http-probing": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595"],
      label: "HTTP Probing",
    },
    "crowdsecurity/http-sap-interface-probing": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595"],
      label: "HTTP SAP Interface Probing",
    },
    "crowdsecurity/http-sensitive-files": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595.003"],
      label: "Access to sensitive files over HTTP",
    },
    "crowdsecurity/http-sqli-probing": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595.002"],
      label: "SQL Injection Attempt",
    },
    "crowdsecurity/http-technology-probing": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595"],
      label: "HTTP Technology Probing",
    },
    "crowdsecurity/http-wordpress-scan": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595"],
      label: "WordPress Vuln Hunting",
    },
    "crowdsecurity/http-wordpress_user-enum": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1589", "T1110", "T1595"],
      label: "WordPress User Enumeration",
    },
    "crowdsecurity/http-wordpress_wpconfig": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595"],
      label: "Access to WordPress wp-config.php",
    },
    "crowdsecurity/http-xss-probing": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595.002"],
      label: "XSS Attempt",
    },
    "crowdsecurity/impossible-travel": {
      behavior: CrowdSecBehavior.UnusualActivity,
      techniques: ["T1078"],
      label: "Impossible travel",
    },
    "crowdsecurity/impossible-travel-user": {
      behavior: CrowdSecBehavior.UnusualActivity,
      techniques: ["T1078"],
      label: "Impossible travel",
    },
    "crowdsecurity/iptables-scan-multi_ports": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595.001", "T1018", "T1046"],
      label: "TCP Port Scan",
    },
    "crowdsecurity/jira_cve-2021-26086": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595.001", "T1190"],
      label: "Jira CVE-2021-26086 exploitation",
    },
    "crowdsecurity/k8s-audit-anonymous-access": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595"],
      label: "Kubernetes API anonymous access",
    },
    "crowdsecurity/k8s-audit-api-server-bruteforce": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Kubernetes API Bruteforce",
    },
    "crowdsecurity/k8s-audit-pod-exec": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1609"],
      label: "Kubernetes Exec Into Pod",
    },
    "crowdsecurity/k8s-audit-pod-host-network": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1610"],
      label: "Kubernetes Pod Start With Host Networking",
    },
    "crowdsecurity/k8s-audit-pod-host-path-volume": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1610"],
      label: "Kubernetes Pod Start With Host Path",
    },
    "crowdsecurity/k8s-audit-privileged-pod-creation": {
      behavior: CrowdSecBehavior.Audit,
      techniques: ["T1610"],
      label: "Kubernetes Privileged Pod Creation",
    },
    "crowdsecurity/k8s-audit-service-account-access-denied": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1078", "T1069"],
      label: "Kubernetes Service Account Denied Request",
    },
    "crowdsecurity/kasm-bruteforce": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "KASM Bruteforce",
    },
    "crowdsecurity/litespeed-admin-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "LiteSpeed Admin Bruteforce",
    },
    "crowdsecurity/mariadb-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "MariaDB Bruteforce",
    },
    "crowdsecurity/modsecurity": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "Modsecurity Alert",
    },
    "crowdsecurity/mssql-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "MSSQL Bruteforce",
    },
    "crowdsecurity/mysql-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "MySQL Bruteforce",
    },
    "crowdsecurity/naxsi-exploit-vpatch": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "",
    },
    "crowdsecurity/netgear_rce": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1595", "T1190"],
      label: "Netgear RCE",
    },
    "crowdsecurity/nextcloud-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "NextCloud Bruteforce",
    },
    "crowdsecurity/nginx-req-limit-exceeded": {
      behavior: CrowdSecBehavior.DenialOfService,
      techniques: ["T1498"],
      label: "Nginx request limit exceeded",
    },
    "crowdsecurity/odoo-bf_user-enum": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Odoo Bruteforce",
    },
    "crowdsecurity/opnsense-gui-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "OPNsense GUI Bruteforce",
    },
    "crowdsecurity/pfsense-gui-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "pfSense GUI Bruteforce",
    },
    "crowdsecurity/pgsql-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Postgres Bruteforce",
    },
    "crowdsecurity/pgsql-user-enum": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110", "T1589"],
      label: "Postgres Bruteforce",
    },
    "crowdsecurity/postfix-helo-rejected": {
      behavior: CrowdSecBehavior.Spam,
      techniques: ["T1595", "T1592"],
      label: "Postfix Helo Rejected",
    },
    "crowdsecurity/postfix-non-smtp-command": {
      behavior: CrowdSecBehavior.Scan,
      techniques: [],
      label: "Postfix Non-SMTP Command",
    },
    "crowdsecurity/postfix-relay-denied": {
      behavior: CrowdSecBehavior.Spam,
      techniques: ["T1595", "T1190"],
      label: "Postfix Relay Denied",
    },
    "crowdsecurity/postfix-spam": {
      behavior: CrowdSecBehavior.Spam,
      techniques: [],
      label: "Postfix Spam",
    },
    "crowdsecurity/proftpd-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Proftpd Bruteforce",
    },
    "crowdsecurity/proftpd-bf_user-enum": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110", "T1190"],
      label: "Proftpd Bruteforce",
    },
    "crowdsecurity/pulse-secure-sslvpn-cve-2019-11510": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190"],
      label: "Pulse Secure CVE-2019-11510",
    },
    "crowdsecurity/sabnzbd-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Sabnzbd Bruteforce",
    },
    "crowdsecurity/smb-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "SMB Bruteforce",
    },
    "crowdsecurity/spring4shell_cve-2022-22965": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190"],
      label: "Spring4shell CVE-2022-22965",
    },
    "crowdsecurity/ssh-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "SSH Bruteforce",
    },
    "crowdsecurity/ssh-cve-2024-6387": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190"],
      label: "SSH CVE-2024-6387",
    },
    "crowdsecurity/ssh-generic-test": {
      behavior: CrowdSecBehavior.Test,
      techniques: ["T1110"],
      label: "Crowdsec Generic Test Scenario",
    },
    "crowdsecurity/ssh-refused-conn": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595"],
      label: "SSH Refused Connection",
    },
    "crowdsecurity/ssh-slow-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "SSH Slow Bruteforce",
    },
    "crowdsecurity/ssh-time-based-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "SSH Time-Based Bruteforce",
    },
    "crowdsecurity/stirling-pdf-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Stirling PDF Bruteforce",
    },
    "crowdsecurity/supavisor-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Supavisor bruteforce",
    },
    "crowdsecurity/suricata-alerts": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190", "T1595"],
      label: "Suricata Severity 1 Event",
    },
    "crowdsecurity/synology-dsm-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Synology DSM Bruteforce",
    },
    "crowdsecurity/teamspeak3-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "TeamSpeak3 Bruteforce",
    },
    "crowdsecurity/teleport-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Teleport Bruteforce",
    },
    "crowdsecurity/telnet-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Telnet Bruteforce",
    },
    "crowdsecurity/thehive-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "The Hive Bruteforce",
    },
    "crowdsecurity/thinkphp-cve-2018-20062": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190", "T1595"],
      label: "ThinkPHP CVE-2018-20062",
    },
    "crowdsecurity/vmware-cve-2022-22954": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190", "T1595"],
      label: "VMWARE CVE-2022-22954",
    },
    "crowdsecurity/vmware-vcenter-vmsa-2021-0027": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1190", "T1595"],
      label: "VMWARE VCenter VMSA CVE-2021-0027",
    },
    "crowdsecurity/vsftpd-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "VSFTPD Bruteforce",
    },
    "crowdsecurity/windows-CVE-2022-30190-msdt": {
      behavior: CrowdSecBehavior.Exploit,
      techniques: ["T1059", "T1203"],
      label: "CVE-2022-30190",
    },
    "crowdsecurity/windows-bf": {
      behavior: CrowdSecBehavior.BruteForce,
      techniques: ["T1110"],
      label: "Windows Bruteforce",
    },
    "crowdsecurity/wireguard-auth": {
      behavior: CrowdSecBehavior.Scan,
      techniques: ["T1595"],
      label: "Wireguard Rejected Packets",
    },
  });

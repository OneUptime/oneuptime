/*
 * Security products' CEF and LEEF records, as each vendor's documented
 * layout writes them: kept ones and ones that stay logs. RFC 5737
 * documentation addresses and made-up accounts. Not a test file itself.
 */

// The vendors' records, kept and not.
export const DEVICE_LINES: {
  paloAltoThreat: string;
  paloAltoDeny: string;
  paloAltoAllow: string;
  fortiGateAccept: string;
  fortiGateIps: string;
  fortiGateAdminLoginFailed: string;
  checkPointDrop: string;
  impervaSqlInjection: string;
  crowdStrikeDetection: string;
  trendMicroMalware: string;
  mikroTikLoginFailure: string;
  uniFiClientDisconnected: string;
  vpnLoginSucceeded: string;
  highSeverityAlone: string;
  zscalerLeefBlocked: string;
  zscalerLeefAllowed: string;
  paloAltoLeefDeny: string;
  qradarLeef2: string;
} = {
  paloAltoThreat:
    "<14>Oct 30 10:00:00 PA-3220 CEF:0|Palo Alto Networks|PAN-OS|10.1.0|spyware|THREAT|5|rt=1730282400000 deviceExternalId=0123456789 src=192.0.2.10 dst=203.0.113.50 cs1Label=Rule cs1=allow-web suser=corp\\alice app=web-browsing spt=50100 dpt=443 proto=tcp act=reset-both request=evil.example/beacon cat=Cobalt Strike Beacon C2(86245)",
  paloAltoDeny:
    "CEF:0|Palo Alto Networks|PAN-OS|10.1.0|deny|TRAFFIC|1|rt=1730282400000 src=203.0.113.99 dst=192.0.2.5 spt=40000 dpt=3389 proto=tcp act=deny",
  paloAltoAllow:
    "CEF:0|Palo Alto Networks|PAN-OS|10.1.0|end|TRAFFIC|1|rt=1730282400000 src=192.0.2.10 dst=198.51.100.80 spt=50000 dpt=443 proto=tcp act=allow cs1Label=Rule cs1=allow-web",
  fortiGateAccept:
    "CEF:0|Fortinet|Fortigate|v7.0.12|00013|traffic:forward accept|3|deviceExternalId=FGT60F act=accept src=192.0.2.10 dst=198.51.100.80 spt=50000 dpt=443 proto=6",
  fortiGateIps:
    "CEF:0|Fortinet|Fortigate|v7.0.12|16384|utm:ips signature|5|deviceExternalId=FGT60F act=dropped src=203.0.113.7 dst=192.0.2.20 dpt=80 cs4Label=attack cs4=Apache.Log4j.Error.Log.Remote.Code.Execution",
  fortiGateAdminLoginFailed:
    "CEF:0|Fortinet|Fortigate|v7.0.12|32002|event:system login failed|7|deviceExternalId=FGT60F duser=admin src=203.0.113.7 act=login outcome=failed msg=Administrator admin login failed from https(203.0.113.7) because of invalid password",
  checkPointDrop:
    "CEF:0|Check Point|VPN-1 & FireWall-1|Check Point|Drop|Drop|Medium|act=Drop src=203.0.113.9 dst=192.0.2.30 spt=1234 dpt=22 proto=6",
  impervaSqlInjection:
    "CEF:0|Imperva Inc.|SecureSphere|15.0|Protocol|SQL injection|High|act=block src=203.0.113.7 dst=10.0.0.5 dpt=443 request=/item?id\\=1' or 1\\=1 externalId=7718",
  crowdStrikeDetection:
    "CEF:0|CrowdStrike|FalconHost|1.0|DetectionSummaryEvent|Detection Summary Event|Medium|duser=alice dhost=WKS-07 fname=powershell.exe msg=Suspicious PowerShell",
  trendMicroMalware:
    "CEF:0|Trend Micro|Deep Security Agent|20.0|4000000|Eicar_test_file|6|cn1=1 cn1Label=Host ID dvchost=web-02 fname=Eicar.exe filePath=C:\\\\Windows\\\\Temp\\\\Eicar.exe act=Delete result=Delete msg=Realtime",
  mikroTikLoginFailure:
    "Oct  2 17:36:35 MikroTik CEF:0|MikroTik|hAP ax^2|7.25beta5|10|system,error,critical|High|dvchost=MikroTik dvc=192.168.88.36 msg=login failure for user guest from 192.168.88.17 via ssh app=ssh duser=guest outcome=failure src=192.168.88.17",
  uniFiClientDisconnected:
    "CEF:0|Ubiquiti|UniFi Network|9.3.33|401|WiFi Client Disconnected|2|UNIFIcategory=Monitoring UNIFIhost=Office UDM Pro msg=Apple Watch disconnected.",
  vpnLoginSucceeded:
    "CEF:0|Fortinet|Fortigate|v7.0.12|39947|event:vpn ssl login success|2|suser=bob src=198.51.100.23 outcome=success",
  highSeverityAlone:
    "CEF:0|Acme|Gateway|1.0|900|Tunnel endpoint unreachable|8|dvchost=gw-01",
  zscalerLeefBlocked:
    "<13>LEEF:1.0|Zscaler|NSSWeblog|5.7|Blocked|cat=Malicious Content\tsrc=192.0.2.15\tdst=203.0.113.80\tusrName=alice@example.com\taction=Blocked\turl=evil.example/payload.exe\tsev=9",
  zscalerLeefAllowed:
    "LEEF:1.0|Zscaler|NSSWeblog|5.7|Allowed|cat=Business and Economy\tsrc=192.0.2.15\tdst=203.0.113.81\tusrName=alice@example.com\taction=Allowed\turl=news.example/\tsev=1",
  paloAltoLeefDeny:
    "LEEF:1.0|Palo Alto Networks|PAN-OS Syslog Integration|10.1|deny|cat=TRAFFIC\tdevTime=1730282400000\tsrc=203.0.113.99\tdst=192.0.2.5\tsrcPort=40000\tdstPort=22\tproto=tcp\taction=deny",
  qradarLeef2:
    "LEEF:2.0|Lancope|StealthWatch|1.0|41|^|cat=Brute Force Login^src=203.0.113.44^dst=192.0.2.80^dstPort=22^sev=8",
};

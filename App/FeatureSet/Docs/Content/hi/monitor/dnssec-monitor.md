# DNSSEC Monitor

DNSSEC monitoring आपको अपने zones के लिए DNS responses की cryptographic integrity validate करने की अनुमति देता है। OneUptime समय-समय पर पूर्ण DNSSEC validation करता है — DNSKEY records, parent zone पर DS delegation, RRSIG signature की वैधता, AD flag पर resolver consensus, और authoritative nameservers के बीच consistency की जांच करता है।

## Overview

DNSSEC monitors root zone से आपके domain तक के पूरे trust chain को validate करते हैं। यह आपको सक्षम बनाता है:

- resolvers द्वारा users को SERVFAIL लौटाना शुरू करने से पहले टूटे हुए DNSSEC chains का पता लगाएं
- zone-signing keys expire होने से पहले चेतावनी प्राप्त करें
- सत्यापित करें कि आपके DS records parent zone पर सही ढंग से publish किए गए हैं
- authoritative nameservers के बीच विचलन (primary/secondary out of sync) पकड़ें
- पुष्टि करें कि validating resolvers वास्तव में आपके zone के लिए AD flag set करते हैं

## DNSSEC Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **DNSSEC** चुनें
4. वह zone (domain) दर्ज करें जिसे आप validate करना चाहते हैं
5. आवश्यकतानुसार resolvers और monitoring criteria configure करें

## Configuration Options

### Basic Settings

| Field | विवरण | आवश्यक |
|-------|-------|--------|
| Zone (Domain Name) | DNSSEC के माध्यम से validate करने के लिए zone (जैसे `example.com`) | हाँ |
| Resolvers | query करने के लिए validating resolvers की comma-separated सूची (जैसे `1.1.1.1, 8.8.8.8, 9.9.9.9`) | हाँ |
| Check Nameserver Consistency | प्रत्येक authoritative nameserver को सीधे query करें और verify करें कि वे एक ही SOA serial लौटाते हैं | नहीं |

### Advanced Settings

| Field | विवरण | Default |
|-------|-------|---------|
| Signature Expiry Warning (days) | RRSIG expiry filter के लिए default threshold | 7 |
| Timeout (ms) | प्रत्येक DNS query के लिए कितना इंतज़ार करें | 10000 |
| Retries | failure पर retry attempts की संख्या | 3 |

## Monitoring Criteria

आप criteria configure कर सकते हैं जो यह निर्धारित करे कि आपका zone निम्न के आधार पर online, degraded, या offline माना जाए:

### उपलब्ध Check Types

| Check Type | विवरण |
|------------|-------|
| DNSSEC Chain Is Valid | संपूर्ण validation chain (root → TLD → zone) सही ढंग से resolve होती है |
| DNSSEC DNSKEY Record Exists | zone कम से कम एक DNSKEY record publish करता है |
| DNSSEC DS Record Exists At Parent | parent zone एक DS record publish करता है जो zone के KSK से मेल खाता है |
| DNSSEC Signature Expires In Days | जल्द ही expire होने वाले RRSIG signature तक के दिन |
| DNSSEC Resolver Consensus (AD Flag) | प्रत्येक queried resolver AD (Authenticated Data) flag लौटाता है |
| DNSSEC Nameservers Are Consistent | सभी authoritative nameservers एक ही SOA serial लौटाते हैं |
| DNSSEC Is Valid | सभी validation checks में समग्र pass/fail |

### Filter Types

**DNSSEC Chain Is Valid**, **DNSSEC DNSKEY Record Exists**, **DNSSEC DS Record Exists At Parent**, **DNSSEC Resolver Consensus (AD Flag)**, **DNSSEC Nameservers Are Consistent**, और **DNSSEC Is Valid** के लिए:

- **True** — condition true है
- **False** — condition false है

**DNSSEC Signature Expires In Days** के लिए:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

### उदाहरण Criteria

#### DNSSEC chain टूटने पर Alert करें

- **Check On**: DNSSEC Chain Is Valid
- **Filter Type**: False

#### signatures expire होने से पहले चेतावनी दें

- **Check On**: DNSSEC Signature Expires In Days
- **Filter Type**: Less Than
- **Value**: 7

#### parent पर missing DS पकड़ें (delegation टूटा)

- **Check On**: DNSSEC DS Record Exists At Parent
- **Filter Type**: False

#### resolvers के बीच असहमति का पता लगाएं

- **Check On**: DNSSEC Resolver Consensus (AD Flag)
- **Filter Type**: False

#### nameserver data असंगति पकड़ें

- **Check On**: DNSSEC Nameservers Are Consistent
- **Filter Type**: False

## Best Practices

1. **कई public resolvers का उपयोग करें** — डिफ़ॉल्ट रूप से `1.1.1.1`, `8.8.8.8`, और `9.9.9.9` का उपयोग करें ताकि किसी एक resolver के outage से false positives न हों
2. **expiry से काफी पहले चेतावनी दें** — signature expiry से 7 दिन पहले degraded alerts और 2 दिन पहले offline alerts configure करें; key rollovers चुपचाप fail हो सकते हैं
3. **हर signed zone को monitor करें** — apex domains, signed subdomains, और किसी भी अन्य operator को delegated zones शामिल करें
4. **nameserver consistency checks सक्षम करें** — primary/secondary sync issues पकड़ता है जो अकेले DNSSEC validation से छूट जाते हैं, जब तक कि आपका network arbitrary IPs पर outbound DNS को block न करे

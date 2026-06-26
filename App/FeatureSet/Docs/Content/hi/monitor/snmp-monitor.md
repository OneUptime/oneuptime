# SNMP Monitor

SNMP (Simple Network Management Protocol) monitoring आपको SNMP OIDs (Object Identifiers) query करके switches, routers, firewalls और अन्य network infrastructure जैसे network devices monitor करने की अनुमति देता है।

## Overview

SNMP monitors OIDs का उपयोग करके network devices से specific management information query करते हैं। यह आपको सक्षम बनाता है:

- device availability और health monitor करें
- interface statistics (traffic, errors, status) track करें
- system metrics (CPU, memory, uptime) monitor करें
- custom vendor-specific OIDs जांचें
- OID values के आधार पर alerts सेट करें

## SNMP Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **SNMP** चुनें
4. नीचे वर्णित SNMP settings configure करें

## Configuration Options

### Basic Settings

| Field        | विवरण                                 | आवश्यक |
| ------------ | ------------------------------------- | ------ |
| SNMP Version | Protocol version: v1, v2c, या v3      | हाँ    |
| Hostname/IP  | SNMP device का hostname या IP address | हाँ    |
| Port         | SNMP port (default: 161)              | हाँ    |

### Authentication

#### SNMP v1/v2c

SNMP v1 और v2c के लिए, आपको केवल community string प्रदान करनी होगी:

| Field            | विवरण                                 | आवश्यक |
| ---------------- | ------------------------------------- | ------ |
| Community String | SNMP community string (जैसे "public") | हाँ    |

#### SNMP v3

SNMPv3 authentication और encryption के साथ enhanced security प्रदान करता है:

| Field          | विवरण                                 | आवश्यक                        |
| -------------- | ------------------------------------- | ----------------------------- |
| Security Level | noAuthNoPriv, authNoPriv, या authPriv | हाँ                           |
| Username       | SNMPv3 username                       | हाँ                           |
| Auth Protocol  | MD5, SHA, SHA256, या SHA512           | यदि authNoPriv या authPriv हो |
| Auth Key       | Authentication password               | यदि authNoPriv या authPriv हो |
| Priv Protocol  | DES, AES, या AES256                   | यदि authPriv हो               |
| Priv Key       | Privacy/encryption password           | यदि authPriv हो               |

### Monitor करने के लिए OIDs

वे OIDs जोड़ें जो आप device से query करना चाहते हैं। प्रत्येक OID के लिए, आप निर्दिष्ट कर सकते हैं:

| Field       | विवरण                                       | आवश्यक |
| ----------- | ------------------------------------------- | ------ |
| OID         | numeric OID (जैसे 1.3.6.1.2.1.1.1.0)        | हाँ    |
| Name        | OID के लिए एक friendly name (जैसे sysDescr) | नहीं   |
| Description | इस OID का description                       | नहीं   |

### सामान्य OID Templates

OneUptime commonly monitored OIDs के लिए templates प्रदान करता है:

#### System MIB

| OID               | Name        | विवरण                     |
| ----------------- | ----------- | ------------------------- |
| 1.3.6.1.2.1.1.1.0 | sysDescr    | System Description        |
| 1.3.6.1.2.1.1.3.0 | sysUpTime   | System Uptime (ticks में) |
| 1.3.6.1.2.1.1.5.0 | sysName     | System Name               |
| 1.3.6.1.2.1.1.6.0 | sysLocation | System Location           |
| 1.3.6.1.2.1.1.4.0 | sysContact  | System Contact            |

#### Interface MIB

| OID                    | Name         | विवरण                                              |
| ---------------------- | ------------ | -------------------------------------------------- |
| 1.3.6.1.2.1.2.1.0      | ifNumber     | Network Interfaces की संख्या                       |
| 1.3.6.1.2.1.2.2.1.8.X  | ifOperStatus | Interface Operational Status (X = interface index) |
| 1.3.6.1.2.1.2.2.1.10.X | ifInOctets   | Input Bytes (X = interface index)                  |
| 1.3.6.1.2.1.2.2.1.16.X | ifOutOctets  | Output Bytes (X = interface index)                 |

#### Host Resources MIB

| OID                      | Name              | विवरण                          |
| ------------------------ | ----------------- | ------------------------------ |
| 1.3.6.1.2.1.25.1.1.0     | hrSystemUptime    | Host System Uptime             |
| 1.3.6.1.2.1.25.1.5.0     | hrSystemNumUsers  | Users की संख्या                |
| 1.3.6.1.2.1.25.1.6.0     | hrSystemProcesses | Running Processes की संख्या    |
| 1.3.6.1.2.1.25.3.3.1.2.X | hrProcessorLoad   | CPU Load (X = processor index) |

### Advanced Settings

| Field   | विवरण                                   | Default |
| ------- | --------------------------------------- | ------- |
| Timeout | response के लिए कितना इंतज़ार करें (ms) | 5000    |
| Retries | failure पर retry attempts की संख्या     | 3       |

## Monitoring Criteria

आप SNMP responses जांचने और alerts या incidents trigger करने के लिए criteria सेट अप कर सकते हैं।

### उपलब्ध Check Types

| Check Type            | विवरण                                           |
| --------------------- | ----------------------------------------------- |
| SNMP Device Is Online | device SNMP queries का response देता है या नहीं |
| SNMP Response Time    | milliseconds में query response time जांचें     |
| SNMP OID Value        | एक specific OID द्वारा returned value जांचें    |
| SNMP OID Exists       | OID एक value return करता है (null नहीं)         |

### उदाहरण Criteria

#### जांचें कि device online है

- **Check On**: SNMP Device Is Online
- **Filter Type**: True

#### Response time threshold से अधिक होने पर Alert करें

- **Check On**: SNMP Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 1000

#### Interface status जांचें

- **Check On**: SNMP OID Value
- **OID**: 1.3.6.1.2.1.2.2.1.8.1
- **Filter Type**: Equal To
- **Value**: 1 (1 = up, 2 = down)

#### CPU load threshold जांचें

- **Check On**: SNMP OID Value
- **OID**: 1.3.6.1.2.1.25.3.3.1.2.1
- **Filter Type**: Greater Than
- **Value**: 80

## Monitor Secrets का उपयोग

Security के लिए, आप community strings और SNMPv3 credentials जैसी sensitive information को secrets के रूप में store कर सकते हैं।

### Secret जोड़ना

1. **Project Settings** -> **Monitor Secrets** -> **Create Monitor Secret** पर जाएं
2. अपना secret जोड़ें (जैसे community string या SNMPv3 password)
3. SNMP monitors चुनें जिन्हें इस secret तक पहुंच होनी चाहिए

### SNMP Configuration में Secrets का उपयोग

किसी भी sensitive field में `{{monitorSecrets.SECRET_NAME}}` syntax उपयोग करें:

- **Community String**: `{{monitorSecrets.SnmpCommunity}}`
- **SNMPv3 Auth Key**: `{{monitorSecrets.SnmpAuthKey}}`
- **SNMPv3 Priv Key**: `{{monitorSecrets.SnmpPrivKey}}`

## Alerts के लिए Template Variables

incident या alert templates बनाते समय, आप निम्नलिखित variables उपयोग कर सकते हैं:

| Variable               | विवरण                                                |
| ---------------------- | ---------------------------------------------------- |
| `{{isOnline}}`         | device online है (true/false)                        |
| `{{responseTimeInMs}}` | milliseconds में Query response time                 |
| `{{failureCause}}`     | query fail होने पर error message                     |
| `{{oidResponses}}`     | OID response objects का Array                        |
| `{{OID_NAME}}`         | name से specific OID का value (जैसे `{{sysUpTime}}`) |

## समस्या निवारण

### सामान्य समस्याएं

#### Device respond नहीं कर रहा

- सत्यापित करें कि device IP/hostname सही है
- जांचें कि device पर SNMP enabled है
- सत्यापित करें कि firewall rules UDP port 161 की अनुमति देते हैं
- confirm करें कि community string सही है

#### Authentication failures (v3)

- username, auth protocol और auth key सत्यापित करें
- सुनिश्चित करें कि security level device configuration से match करती है
- जांचें कि authPriv level के लिए priv protocol और key सही हैं

#### OID नहीं मिला

- सत्यापित करें कि OID आपके device द्वारा supported है
- जांचें कि OID को load करने के लिए specific MIB की आवश्यकता है
- snmpget/snmpwalk tools का उपयोग करके OID directly query करें

### SNMP Connectivity Testing

Monitoring सेट अप करने से पहले, आप command-line tools का उपयोग करके SNMP connectivity test कर सकते हैं:

```bash
# SNMP v2c
snmpget -v2c -c public 192.168.1.1 1.3.6.1.2.1.1.1.0

# SNMP v3 (authPriv)
snmpget -v3 -u username -l authPriv -a SHA -A authpassword -x AES -X privpassword 192.168.1.1 1.3.6.1.2.1.1.1.0
```

## सर्वोत्तम प्रथाएं

1. **जब possible हो SNMPv3 उपयोग करें** - यह बेहतर security के लिए authentication और encryption प्रदान करता है
2. **credentials को secrets के रूप में store करें** - community strings या passwords कभी hardcode न करें
3. **केवल essential OIDs monitor करें** - network overhead कम करने के लिए केवल जो आवश्यक हो query करें
4. **उचित timeouts सेट करें** - network devices के अलग-अलग response times हो सकते हैं
5. **वर्णनात्मक OID names उपयोग करें** - alert messages समझना आसान बनाता है
6. **deploy करने से पहले test करें** - monitors बनाने से पहले SNMP connectivity सत्यापित करें

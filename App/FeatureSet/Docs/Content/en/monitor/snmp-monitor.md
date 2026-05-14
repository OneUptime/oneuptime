# SNMP Monitor

SNMP (Simple Network Management Protocol) monitoring allows you to monitor network devices like switches, routers, firewalls, and other network infrastructure by querying SNMP OIDs (Object Identifiers).

## Overview

SNMP monitors query network devices for specific management information using OIDs. This enables you to:

- Monitor device availability and health
- Track interface statistics (traffic, errors, status)
- Monitor system metrics (CPU, memory, uptime)
- Check custom vendor-specific OIDs
- Set alerts based on OID values

## Creating an SNMP Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **SNMP** as the monitor type
4. Configure the SNMP settings as described below

## Configuration Options

### Basic Settings

| Field | Description | Required |
|-------|-------------|----------|
| SNMP Version | Protocol version: v1, v2c, or v3 | Yes |
| Hostname/IP | The hostname or IP address of the SNMP device | Yes |
| Port | SNMP port (default: 161) | Yes |

### Authentication

#### SNMP v1/v2c

For SNMP v1 and v2c, you only need to provide a community string:

| Field | Description | Required |
|-------|-------------|----------|
| Community String | The SNMP community string (e.g., "public") | Yes |

#### SNMP v3

SNMPv3 provides enhanced security with authentication and encryption:

| Field | Description | Required |
|-------|-------------|----------|
| Security Level | noAuthNoPriv, authNoPriv, or authPriv | Yes |
| Username | SNMPv3 username | Yes |
| Auth Protocol | MD5, SHA, SHA256, or SHA512 | If authNoPriv or authPriv |
| Auth Key | Authentication password | If authNoPriv or authPriv |
| Priv Protocol | DES, AES, or AES256 | If authPriv |
| Priv Key | Privacy/encryption password | If authPriv |

### OIDs to Monitor

Add the OIDs you want to query from the device. For each OID, you can specify:

| Field | Description | Required |
|-------|-------------|----------|
| OID | The numeric OID (e.g., 1.3.6.1.2.1.1.1.0) | Yes |
| Name | A friendly name for the OID (e.g., sysDescr) | No |
| Description | A description of what this OID represents | No |

### Common OID Templates

OneUptime provides templates for commonly monitored OIDs:

#### System MIB

| OID | Name | Description |
|-----|------|-------------|
| 1.3.6.1.2.1.1.1.0 | sysDescr | System Description |
| 1.3.6.1.2.1.1.3.0 | sysUpTime | System Uptime (in ticks) |
| 1.3.6.1.2.1.1.5.0 | sysName | System Name |
| 1.3.6.1.2.1.1.6.0 | sysLocation | System Location |
| 1.3.6.1.2.1.1.4.0 | sysContact | System Contact |

#### Interface MIB

| OID | Name | Description |
|-----|------|-------------|
| 1.3.6.1.2.1.2.1.0 | ifNumber | Number of Network Interfaces |
| 1.3.6.1.2.1.2.2.1.8.X | ifOperStatus | Interface Operational Status (X = interface index) |
| 1.3.6.1.2.1.2.2.1.10.X | ifInOctets | Input Bytes (X = interface index) |
| 1.3.6.1.2.1.2.2.1.16.X | ifOutOctets | Output Bytes (X = interface index) |

#### Host Resources MIB

| OID | Name | Description |
|-----|------|-------------|
| 1.3.6.1.2.1.25.1.1.0 | hrSystemUptime | Host System Uptime |
| 1.3.6.1.2.1.25.1.5.0 | hrSystemNumUsers | Number of Users |
| 1.3.6.1.2.1.25.1.6.0 | hrSystemProcesses | Number of Running Processes |
| 1.3.6.1.2.1.25.3.3.1.2.X | hrProcessorLoad | CPU Load (X = processor index) |

### Advanced Settings

| Field | Description | Default |
|-------|-------------|---------|
| Timeout | How long to wait for a response (ms) | 5000 |
| Retries | Number of retry attempts on failure | 3 |

## Monitoring Criteria

You can set up criteria to check SNMP responses and trigger alerts or incidents.

### Available Check Types

| Check Type | Description |
|------------|-------------|
| SNMP Device Is Online | Check if the device responds to SNMP queries |
| SNMP Response Time | Check the query response time in milliseconds |
| SNMP OID Value | Check the value returned by a specific OID |
| SNMP OID Exists | Check if an OID returns a value (not null) |

### Example Criteria

#### Check if device is online
- **Check On**: SNMP Device Is Online
- **Filter Type**: True

#### Alert if response time exceeds threshold
- **Check On**: SNMP Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 1000

#### Check interface status
- **Check On**: SNMP OID Value
- **OID**: 1.3.6.1.2.1.2.2.1.8.1
- **Filter Type**: Equal To
- **Value**: 1 (1 = up, 2 = down)

#### Check CPU load threshold
- **Check On**: SNMP OID Value
- **OID**: 1.3.6.1.2.1.25.3.3.1.2.1
- **Filter Type**: Greater Than
- **Value**: 80

## Using Monitor Secrets

For security, you can store sensitive information like community strings and SNMPv3 credentials as secrets.

### Adding a Secret

1. Go to **Project Settings** -> **Monitor Secrets** -> **Create Monitor Secret**
2. Add your secret (e.g., community string or SNMPv3 password)
3. Select the SNMP monitors that should have access to this secret

### Using Secrets in SNMP Configuration

Use the `{{monitorSecrets.SECRET_NAME}}` syntax in any sensitive field:

- **Community String**: `{{monitorSecrets.SnmpCommunity}}`
- **SNMPv3 Auth Key**: `{{monitorSecrets.SnmpAuthKey}}`
- **SNMPv3 Priv Key**: `{{monitorSecrets.SnmpPrivKey}}`

## Template Variables for Alerts

When creating incident or alert templates, you can use the following variables:

| Variable | Description |
|----------|-------------|
| `{{isOnline}}` | Whether the device is online (true/false) |
| `{{responseTimeInMs}}` | Query response time in milliseconds |
| `{{failureCause}}` | Error message if the query failed |
| `{{oidResponses}}` | Array of OID response objects |
| `{{OID_NAME}}` | Value of a specific OID by name (e.g., `{{sysUpTime}}`) |

## Troubleshooting

### Common Issues

#### Device not responding
- Verify the device IP/hostname is correct
- Check that SNMP is enabled on the device
- Verify firewall rules allow UDP port 161
- Confirm the community string is correct

#### Authentication failures (v3)
- Verify username, auth protocol, and auth key
- Ensure the security level matches the device configuration
- Check that priv protocol and key are correct for authPriv level

#### OID not found
- Verify the OID is supported by your device
- Check if the OID requires a specific MIB to be loaded
- Try querying the OID directly using snmpget/snmpwalk tools

### Testing SNMP Connectivity

Before setting up monitoring, you can test SNMP connectivity using command-line tools:

```bash
# SNMP v2c
snmpget -v2c -c public 192.168.1.1 1.3.6.1.2.1.1.1.0

# SNMP v3 (authPriv)
snmpget -v3 -u username -l authPriv -a SHA -A authpassword -x AES -X privpassword 192.168.1.1 1.3.6.1.2.1.1.1.0
```

## Best Practices

1. **Use SNMPv3 when possible** - It provides authentication and encryption for better security
2. **Store credentials as secrets** - Never hardcode community strings or passwords
3. **Monitor essential OIDs only** - Query only what you need to reduce network overhead
4. **Set appropriate timeouts** - Network devices may have varying response times
5. **Use descriptive OID names** - Makes it easier to understand alert messages
6. **Test before deploying** - Verify SNMP connectivity before creating monitors

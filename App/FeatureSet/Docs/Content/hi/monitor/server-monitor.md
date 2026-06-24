# Server / VM Monitor

Server और VM monitoring आपको एक lightweight agent install करके अपने servers, virtual machines और अन्य infrastructure की health और performance monitor करने की अनुमति देता है जो system metrics को OneUptime को report करता है।

## Overview

Server monitors आपके servers पर install एक infrastructure agent का उपयोग करके system metrics एकत्र और report करते हैं। यह आपको सक्षम बनाता है:

- server uptime और availability monitor करें
- CPU, memory और disk usage track करें
- running processes monitor करें
- resource utilization thresholds के आधार पर alerts सेट करें
- infrastructure issues को आपकी services को प्रभावित करने से पहले detect करें

## Server Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **Server / VM** चुनें
4. इस monitor के लिए एक **Secret Key** generate होगी — आपको agent configure करने के लिए इसकी आवश्यकता होगी
5. अपने server पर agent सेट अप करने के लिए installation निर्देशों का पालन करें

## Infrastructure Agent Install करना

OneUptime Infrastructure Agent एक lightweight Go-based daemon है जो system metrics एकत्र करता है और हर 30 seconds में OneUptime को भेजता है। यह Linux, macOS और Windows का समर्थन करता है।

### Linux / macOS

```bash
# agent install करें
curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh | sudo bash

# agent configure करें
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# agent start करें
sudo oneuptime-infrastructure-agent start
```

`YOUR_SECRET_KEY` को अपने monitor की settings में दिखाई दी secret key से बदलें, और यदि self-hosted हैं तो `https://oneuptime.com` को अपने OneUptime instance URL से बदलें।

### Windows

1. [GitHub Releases](https://github.com/OneUptime/oneuptime/releases/latest) से latest agent download करें
   - x64 systems के लिए `oneuptime-infrastructure-agent_windows_amd64.zip`
   - ARM64 systems के लिए `oneuptime-infrastructure-agent_windows_arm64.zip`
2. zip file extract करें
3. Command Prompt को Administrator के रूप में खोलें और चलाएं:

```bash
# agent configure करें
oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# agent start करें
oneuptime-infrastructure-agent start
```

### Proxy Support

यदि आपका server proxy के माध्यम से internet से connect होता है, तो आप agent को इसका उपयोग करने के लिए configure कर सकते हैं:

```bash
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com --proxy-url=http://proxy.example.com:8080
```

## Agent Commands

Infrastructure agent निम्नलिखित commands का समर्थन करता है:

| Command     | विवरण                                                                    |
| ----------- | ------------------------------------------------------------------------ |
| `configure` | agent को आपकी secret key और OneUptime URL के साथ configure करें          |
| `start`     | agent service start करें                                                 |
| `stop`      | agent service stop करें                                                  |
| `restart`   | agent service restart करें                                               |
| `status`    | वर्तमान service status दिखाएं                                            |
| `logs`      | agent logs देखें (line count के लिए `-n` उपयोग करें, follow के लिए `-f`) |
| `uninstall` | agent service uninstall करें                                             |

## Collected Metrics

Agent आपके server से निम्नलिखित metrics एकत्र करता है:

### CPU

- **CPU Usage Percent** — percentage के रूप में overall CPU utilization
- **CPU Cores** — CPU cores की संख्या

### Memory

- **Total Memory** — कुल available memory
- **Used Memory** — वर्तमान में उपयोग में memory
- **Free Memory** — available free memory
- **Memory Usage Percent** — percentage के रूप में Memory utilization

### Disk

प्रत्येक mounted disk/volume के लिए:

- **Total Disk Space** — disk की कुल capacity
- **Used Disk Space** — वर्तमान में उपयोग में space
- **Free Disk Space** — available free space
- **Disk Usage Percent** — percentage के रूप में disk utilization
- **Disk Path** — disk का mount path

### Processes

- **Process Name** — running process का नाम
- **Process ID (PID)** — Process identifier
- **Process Command** — process start करने के लिए उपयोग की गई full command

## Monitoring Criteria

आप criteria configure कर सकते हैं जो यह निर्धारित करे कि आपका server online, degraded, या offline माना जाए।

### उपलब्ध Check Types

| Check Type             | विवरण                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| Is Online              | server agent report कर रहा है (heartbeat के आधार पर)               |
| CPU Usage Percent      | वर्तमान CPU utilization percentage                                 |
| Memory Usage Percent   | वर्तमान memory utilization percentage                              |
| Disk Usage Percent     | वर्तमान disk utilization percentage (एक specific disk path के लिए) |
| Server Process Name    | एक specific नाम वाला process चल रहा है या नहीं                     |
| Server Process Command | एक specific command वाला process चल रहा है या नहीं                 |
| Server Process PID     | एक specific PID वाला process चल रहा है या नहीं                     |

### Filter Types

Numeric metrics के लिए (CPU, memory, disk):

- **Greater Than** — Value एक threshold से अधिक है
- **Less Than** — Value एक threshold से कम है
- **Greater Than or Equal To** — Value एक threshold पर या उससे ऊपर है
- **Less Than or Equal To** — Value एक threshold पर या उससे नीचे है
- **Evaluate Over Time** — एक time window पर aggregation (Average, Sum, Maximum, Minimum, All Values, Any Value) का उपयोग करके evaluate करें

Process checks के लिए:

- **Is Executing** — process वर्तमान में चल रहा है
- **Is Not Executing** — process नहीं चल रहा

### उदाहरण Criteria

#### Agent reporting बंद होने पर server offline mark करें

- **Check On**: Is Online
- **Filter Type**: False

#### CPU usage 90% से अधिक होने पर Alert करें

- **Check On**: CPU Usage Percent
- **Filter Type**: Greater Than
- **Value**: 90

#### Disk usage 85% से अधिक होने पर Alert करें

- **Check On**: Disk Usage Percent
- **Disk Path**: `/`
- **Filter Type**: Greater Than
- **Value**: 85

#### Memory usage 80% से अधिक होने पर Alert करें

- **Check On**: Memory Usage Percent
- **Filter Type**: Greater Than
- **Value**: 80

#### Critical process बंद होने पर Alert करें

- **Check On**: Server Process Name
- **Filter Type**: Is Not Executing
- **Value**: `nginx`

## समस्या निवारण

### Agent report नहीं कर रहा

- सत्यापित करें कि agent चल रहा है: `sudo oneuptime-infrastructure-agent status`
- agent logs जांचें: `sudo oneuptime-infrastructure-agent logs -n 50`
- confirm करें कि secret key सही है
- सुनिश्चित करें कि server आपके OneUptime instance URL तक पहुंच सकता है
- जांचें कि firewall rules outbound HTTPS connections की अनुमति देते हैं

### Agent द्वारा High resource usage

Agent lightweight होने के लिए designed है। यदि आप high resource usage देखते हैं:

- agent restart करें: `sudo oneuptime-infrastructure-agent restart`
- errors के लिए agent logs जांचें

## सर्वोत्तम प्रथाएं

1. **meaningful thresholds सेट करें** — degraded और offline criteria configure करें जो आपके server की सामान्य operating ranges से match करें
2. **critical processes monitor करें** — process monitoring का उपयोग करें ताकि web servers और databases जैसी essential services हमेशा चलती रहें
3. **disk usage proactively monitor करें** — disk space issues application failures में cascade हो सकती हैं; disks full होने से पहले alerts सेट करें
4. **"Evaluate Over Time" उपयोग करें** — CPU जैसे metrics के लिए जो briefly spike कर सकते हैं, false alerts से बचने के लिए time-based aggregation उपयोग करें
5. **agent को updated रखें** — latest improvements और fixes पाने के लिए infrastructure agent को periodically update करें

# AI Agents

OneUptime में AI Agents स्वचालित रूप से आपके कोड में त्रुटियों, प्रदर्शन संबंधी समस्याओं और डेटाबेस क्वेरी को ठीक करते हैं। OpenTelemetry observability डेटा द्वारा संचालित, AI Agents केवल अलर्ट नहीं—बल्कि सुधार सहित pull request बनाते हैं।

## AI Agents क्या कर सकते हैं?

AI Agents आपके observability डेटा (traces, logs और metrics) का विश्लेषण करते हैं और आपके codebase में समस्याओं को स्वचालित रूप से पहचानकर ठीक करते हैं:

- **त्रुटियाँ स्वचालित रूप से ठीक करें**: जब AI Agent आपके traces या logs में exceptions देखता है, तो वह स्वचालित रूप से समस्या ठीक करता है और pull request बनाता है।
- **प्रदर्शन संबंधी समस्याएं ठीक करें**: सबसे अधिक समय लेने वाले traces का विश्लेषण करता है और प्रदर्शन अनुकूलन सहित pull request बनाता है।
- **डेटाबेस क्वेरी ठीक करें**: धीमी या अकुशल डेटाबेस क्वेरी की पहचान करता है और उचित indexing व query rewrite के साथ उन्हें अनुकूलित करता है।
- **Frontend समस्याएं ठीक करें**: Frontend-विशिष्ट प्रदर्शन समस्याओं, rendering संबंधी मुद्दों और JavaScript त्रुटियों को स्वचालित रूप से हल करता है।
- **Telemetry स्वचालित रूप से जोड़ें**: एक क्लिक से अपने codebase में tracing, metrics और logs जोड़ें। कोई manual instrumentation की आवश्यकता नहीं।
- **GitHub और GitLab Integration**: आपके मौजूदा repositories के साथ निर्बाध रूप से integrate होता है। PR सीधे आपके workflow में बनाए जाते हैं।
- **CI/CD Integration**: आपके मौजूदा CI/CD pipelines के साथ integrate होता है। PR बनाने से पहले fixes को परीक्षित और सत्यापित किया जाता है।
- **Terraform Support**: Infrastructure संबंधी समस्याओं को स्वचालित रूप से ठीक करें। infrastructure-as-code के लिए Terraform और OpenTofu का समर्थन करता है।
- **Issue Tracker Integration**: Jira, Linear और अन्य issue trackers से जुड़ता है। fixes को संबंधित issues से स्वचालित रूप से लिंक करता है।

## यह कैसे काम करता है

1. **डेटा एकत्र करें**: OpenTelemetry आपके एप्लिकेशन से traces, logs और metrics एकत्र करता है
2. **समस्याएं पहचानें**: AI त्रुटियों, प्रदर्शन bottlenecks और धीमी queries की पहचान करता है
3. **Fix तैयार करें**: AI आपके codebase का विश्लेषण करता है और स्वचालित रूप से fix बनाता है
4. **PR बनाएं**: fix और विस्तृत रिपोर्ट सहित pull request समीक्षा के लिए तैयार होती है

## LLM Provider में लचीलापन

OneUptime किसी भी LLM provider के साथ काम करता है। आप उपयोग कर सकते हैं:

- **OpenAI GPT** मॉडल
- **Anthropic Claude** मॉडल
- **Meta Llama** (Ollama या अन्य providers के माध्यम से)
- **Custom self-hosted** मॉडल

अपना AI मॉडल self-host करें और अपना कोड पूरी तरह निजी रखें।

## गोपनीयता

आपकी योजना चाहे जो भी हो, OneUptime आपका कोड कभी नहीं देखता, संग्रहीत नहीं करता, और उस पर train नहीं करता:

- **कोई Code Access नहीं**: आपका कोड आपके infrastructure पर ही रहता है
- **कोई Data Storage नहीं**: शून्य डेटा retention नीति
- **कोई Training नहीं**: आपका कोड AI training के लिए कभी उपयोग नहीं किया जाता

## Global AI Agents बनाम Self-Hosted AI Agents

### Global AI Agents

यदि आप **OneUptime SaaS** (cloud-hosted संस्करण) का उपयोग कर रहे हैं, तो Global AI Agents OneUptime द्वारा प्रदान किए जाते हैं और पहले से configured व उपयोग के लिए तैयार होते हैं। इन agents को OneUptime द्वारा प्रबंधित किया जाता है और किसी अतिरिक्त setup की आवश्यकता नहीं होती।

Global AI Agents, project settings में अक्षम किए जाने तक सभी projects के लिए स्वचालित रूप से उपलब्ध रहते हैं।

### Self-Hosted AI Agents

उन organizations के लिए जिन्हें अपने स्वयं के infrastructure के भीतर AI agents चलाने की आवश्यकता है (जैसे सुरक्षा, अनुपालन, या नेटवर्क पहुंच आवश्यकताओं के लिए), OneUptime self-hosted AI agents का समर्थन करता है।

Self-hosted AI agents:
- आपके private network के भीतर चलते हैं
- आंतरिक resources और systems तक पहुंच सकते हैं
- agent के environment पर आपको पूर्ण नियंत्रण देते हैं
- आपकी विशिष्ट आवश्यकताओं के अनुसार अनुकूलित किए जा सकते हैं

## Self-Hosted AI Agent सेट अप करना

### चरण 1: OneUptime में AI Agent बनाएं

1. अपने OneUptime dashboard में लॉग इन करें
2. **Project Settings** > **AI Agents** पर जाएं
3. नया agent जोड़ने के लिए **Create AI Agent** पर क्लिक करें
4. आवश्यक fields भरें:
   - **Name**: आपके AI agent के लिए एक उचित नाम
   - **Description** (वैकल्पिक): agent के उद्देश्य का विवरण
5. बनाने के बाद, आपको `AI_AGENT_ID` और `AI_AGENT_KEY` मिलेंगे

**महत्वपूर्ण**: अपनी `AI_AGENT_KEY` को सुरक्षित रूप से सहेजें। यह केवल एक बार दिखाई जाएगी और बाद में प्राप्त नहीं की जा सकती।

### चरण 2: AI Agent Deploy करें

#### Docker

AI agent चलाने के लिए, सुनिश्चित करें कि Docker इंस्टॉल है। agent को निम्नानुसार चलाएं:

```bash
docker run --name oneuptime-ai-agent --network host \
  -e AI_AGENT_KEY=<ai-agent-key> \
  -e AI_AGENT_ID=<ai-agent-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/ai-agent:release
```

यदि आप OneUptime को self-host कर रहे हैं, तो `ONEUPTIME_URL` को अपने custom self-hosted instance URL में बदलें।

#### Docker Compose

आप docker-compose का उपयोग करके भी AI agent चला सकते हैं। एक `docker-compose.yml` फ़ाइल बनाएं:

```yaml
version: "3"

services:
  oneuptime-ai-agent:
    image: oneuptime/ai-agent:release
    container_name: oneuptime-ai-agent
    environment:
      - AI_AGENT_KEY=<ai-agent-key>
      - AI_AGENT_ID=<ai-agent-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

फिर चलाएं:

```bash
docker compose up -d
```

#### Kubernetes

एक `oneuptime-ai-agent.yaml` फ़ाइल बनाएं:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-ai-agent
spec:
  selector:
    matchLabels:
      app: oneuptime-ai-agent
  template:
    metadata:
      labels:
        app: oneuptime-ai-agent
    spec:
      containers:
      - name: oneuptime-ai-agent
        image: oneuptime/ai-agent:release
        env:
          - name: AI_AGENT_KEY
            value: "<ai-agent-key>"
          - name: AI_AGENT_ID
            value: "<ai-agent-id>"
          - name: ONEUPTIME_URL
            value: "https://oneuptime.com"
```

configuration लागू करें:

```bash
kubectl apply -f oneuptime-ai-agent.yaml
```

### Environment Variables

AI agent निम्नलिखित environment variables का समर्थन करता है:

#### आवश्यक Variables

| Variable | विवरण |
|----------|-------|
| `AI_AGENT_KEY` | आपके OneUptime dashboard से AI agent key |
| `AI_AGENT_ID` | आपके OneUptime dashboard से AI agent ID |
| `ONEUPTIME_URL` | आपके OneUptime instance का URL (डिफ़ॉल्ट: https://oneuptime.com) |


## अपने AI Agent को सत्यापित करना

अपना AI agent deploy करने के बाद:

1. अपने OneUptime dashboard में **Project Settings** > **AI Agents** पर जाएं
2. कुछ मिनटों के भीतर आपका agent **Connected** दिखाई देना चाहिए
3. यदि status **Disconnected** दिखाई दे, तो त्रुटियों के लिए container logs जांचें

container logs देखने के लिए:

```bash
# Docker
docker logs oneuptime-ai-agent

# Kubernetes
kubectl logs deployment/oneuptime-ai-agent
```

## समस्या निवारण

### Agent Connect नहीं हो रहा

1. **credentials सत्यापित करें**: सुनिश्चित करें कि `AI_AGENT_KEY` और `AI_AGENT_ID` सही हैं
2. **नेटवर्क जांचें**: सुनिश्चित करें कि agent आपके OneUptime instance तक पहुंच सकता है
3. **logs समीक्षा करें**: त्रुटि संदेशों के लिए container logs जांचें
4. **Firewall rules**: सुनिश्चित करें कि outbound HTTPS (port 443) की अनुमति है

### Agent बार-बार Disconnect हो रहा है

1. **Resource limits जांचें**: सुनिश्चित करें कि container के पास पर्याप्त memory और CPU है
2. **Network stability**: network connectivity की स्थिरता सत्यापित करें
3. **logs समीक्षा करें**: logs में timeout या connection त्रुटियों को देखें

## सहायता चाहिए?

यदि आपके AI agent में कोई समस्या आती है:

1. ज्ञात समस्याओं के लिए [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) देखें
2. यदि आपकी समस्या पहले से रिपोर्ट नहीं है तो एक नई issue बनाएं
3. यदि आप enterprise plan पर हैं तो [support](https://oneuptime.com/support) से संपर्क करें

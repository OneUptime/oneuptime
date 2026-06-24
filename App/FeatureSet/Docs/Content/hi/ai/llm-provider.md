# LLM Providers

OneUptime, platform भर में AI-संचालित सुविधाओं को सक्षम करने के लिए विभिन्न Large Language Model (LLM) providers के साथ integration का समर्थन करता है। यह मार्गदर्शिका आपको अपना LLM provider configure करने में सहायता करेगी।

## LLM Providers क्या कर सकते हैं?

OneUptime में LLM Providers आपके incident management workflow को स्वचालित और बेहतर बनाने में मदद करते हैं:

- **Incident Notes**: विस्तृत incident notes और updates स्वचालित रूप से तैयार करें
- **Alert Notes**: सार्थक alert विवरण और संदर्भ बनाएं
- **Scheduled Maintenance Notes**: maintenance event notes स्वचालित रूप से तैयार करें
- **Incident Postmortems**: व्यापक incident postmortem रिपोर्ट का मसौदा स्वचालित रूप से तैयार करें
- **Code Improvements**: यदि आप अपनी code repository को OneUptime से जोड़ते हैं, तो हम आपके LLM Provider का उपयोग telemetry डेटा (logs, traces, metrics, exceptions) का विश्लेषण करने और code improvements सुझाने के लिए करेंगे

## OneUptime SaaS उपयोगकर्ता

यदि आप **OneUptime SaaS** (cloud-hosted संस्करण) का उपयोग कर रहे हैं, तो आप बिना किसी अतिरिक्त configuration के डिफ़ॉल्ट रूप से **Global LLM Provider** का उपयोग कर सकते हैं। Global LLM Provider पहले से configured है और सभी AI सुविधाओं के लिए उपयोग के लिए तैयार है।

यदि आप अपनी स्वयं की API keys या किसी विशिष्ट provider का उपयोग करना पसंद करते हैं, तो आप नीचे दिए गए निर्देशों का पालन करते हुए एक custom LLM Provider configure कर सकते हैं।

## समर्थित Providers

OneUptime वर्तमान में निम्नलिखित LLM providers का समर्थन करता है:

| Provider      | विवरण                                                               | API Key आवश्यक | Base URL आवश्यक               |
| ------------- | ------------------------------------------------------------------- | -------------- | ----------------------------- |
| **OpenAI**    | GPT-4, GPT-4o, GPT-3.5 Turbo, और अन्य OpenAI मॉडल                   | हाँ            | नहीं (डिफ़ॉल्ट उपयोग करता है) |
| **Anthropic** | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku, और अन्य Claude मॉडल | हाँ            | नहीं (डिफ़ॉल्ट उपयोग करता है) |
| **Ollama**    | Llama 2, Mistral, CodeLlama आदि जैसे self-hosted open-source मॉडल   | नहीं           | हाँ                           |

## LLM Provider सेट अप करना

### चरण 1: LLM Providers Settings पर जाएं

1. अपने OneUptime dashboard में लॉग इन करें
2. **Project Settings** > **AI** > **LLM Providers** पर जाएं
3. नया provider जोड़ने के लिए **Create LLM Provider** पर क्लिक करें

### चरण 2: अपना Provider Configure करें

निम्नलिखित fields भरें:

- **Name**: इस LLM configuration के लिए एक उचित नाम (जैसे "Production OpenAI", "Local Ollama")
- **Description** (वैकल्पिक): इस provider के उद्देश्य की पहचान करने में सहायता के लिए एक विवरण
- **LLM Type**: provider प्रकार चुनें (OpenAI, Anthropic, या Ollama)
- **API Key**: आपकी API key (OpenAI और Anthropic के लिए आवश्यक)
- **Model Name**: उपयोग करने के लिए विशिष्ट मॉडल (जैसे `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **Base URL** (वैकल्पिक): Custom API endpoint URL (Ollama के लिए आवश्यक, अन्य के लिए वैकल्पिक)

## Provider-विशिष्ट Configuration

### OpenAI

1. [OpenAI Platform](https://platform.openai.com/api-keys) से अपनी API key प्राप्त करें
2. LLM Type के रूप में **OpenAI** चुनें
3. अपनी API key दर्ज करें
4. एक model name चुनें:
   - `gpt-4o` - सबसे सक्षम मॉडल, जटिल कार्यों के लिए सर्वोत्तम
   - `gpt-4o-mini` - तेज़ और अधिक किफायती
   - `gpt-4-turbo` - क्षमता और गति का अच्छा संतुलन
   - `gpt-3.5-turbo` - तेज़ और किफायती

**उदाहरण Configuration:**

```
Name: Production OpenAI
LLM Type: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-4o
```

### Anthropic

1. [Anthropic Console](https://console.anthropic.com/) से अपनी API key प्राप्त करें
2. LLM Type के रूप में **Anthropic** चुनें
3. अपनी API key दर्ज करें
4. एक model name चुनें:
   - `claude-3-opus-20240229` - सबसे सक्षम मॉडल
   - `claude-3-sonnet-20240229` - बुद्धिमत्ता और गति का अच्छा संतुलन
   - `claude-3-haiku-20240307` - सबसे तेज़ और सबसे कॉम्पैक्ट
   - `claude-3-5-sonnet-20241022` - नवीनतम Sonnet मॉडल

**उदाहरण Configuration:**

```
Name: Production Anthropic
LLM Type: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-3-5-sonnet-20241022
```

### Ollama (Self-Hosted)

Ollama आपको locally या अपने स्वयं के infrastructure पर open-source LLMs चलाने की अनुमति देता है।

1. [ollama.ai](https://ollama.ai) से Ollama इंस्टॉल करें
2. अपना इच्छित मॉडल pull करें: `ollama pull llama2`
3. सुनिश्चित करें कि Ollama चल रहा है और accessible है
4. LLM Type के रूप में **Ollama** चुनें
5. Base URL दर्ज करें (जैसे `http://localhost:11434`)
6. वह model name दर्ज करें जो आपने pull किया

**उदाहरण Configuration:**

```
Name: Local Ollama
LLM Type: Ollama
Base URL: http://localhost:11434
Model Name: llama2
```

**लोकप्रिय Ollama मॉडल:**

- `llama2` - Meta का Llama 2 मॉडल
- `llama3` - Meta का Llama 3 मॉडल
- `mistral` - Mistral AI का मॉडल
- `codellama` - Code-विशेषज्ञ Llama मॉडल
- `mixtral` - Mistral का mixture of experts मॉडल

## Custom Base URLs का उपयोग

Enterprise deployments के लिए या proxy services का उपयोग करते समय, आप एक custom Base URL निर्दिष्ट कर सकते हैं:

- **Azure OpenAI**: अपना Azure endpoint URL उपयोग करें
- **OpenAI-compatible APIs**: कोई भी API जो OpenAI के API specification का पालन करती है
- **Private Ollama instances**: आपके आंतरिक Ollama server का URL

## सर्वोत्तम प्रथाएं

1. **वर्णनात्मक नाम उपयोग करें**: अपने providers को स्पष्ट रूप से नाम दें (जैसे "Production GPT-4", "Development Ollama")
2. **अपनी API keys सुरक्षित करें**: API keys rest पर encrypt होती हैं, लेकिन उन्हें share करने से बचें
3. **अपनी configuration परीक्षण करें**: सेट अप के बाद, सत्यापित करें कि provider AI सुविधाओं के साथ काम करता है
4. **उपयोग monitor करें**: लागत प्रबंधित करने के लिए API उपयोग पर नज़र रखें

## समस्या निवारण

### Connection संबंधी समस्याएं

- **OpenAI/Anthropic**: सत्यापित करें कि आपकी API key valid है और पर्याप्त credits हैं
- **Ollama**: सुनिश्चित करें कि Ollama server चल रहा है और Base URL सही है
- **Firewall**: जांचें कि आपका नेटवर्क provider के API से outbound connections की अनुमति देता है

### मॉडल नहीं मिला

- सत्यापित करें कि model name सही वर्तनी में है
- Ollama के लिए, सुनिश्चित करें कि आपने `ollama pull <model-name>` से मॉडल pull किया है
- जांचें कि मॉडल आपके क्षेत्र में उपलब्ध है (कुछ मॉडलों में क्षेत्रीय प्रतिबंध हैं)

## सहायता चाहिए?

यदि आपको अपना LLM provider सेट अप करने में कोई समस्या आती है, तो कृपया:

1. ज्ञात समस्याओं के लिए [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) देखें
2. यदि आप enterprise plan पर हैं तो support से संपर्क करें

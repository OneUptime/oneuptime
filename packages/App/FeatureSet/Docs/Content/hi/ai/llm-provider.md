# LLM Providers

OneUptime, platform भर में AI-संचालित सुविधाओं को सक्षम करने के लिए विभिन्न Large Language Model (LLM) providers के साथ integration का समर्थन करता है। यह मार्गदर्शिका आपको अपना LLM provider configure करने में सहायता करेगी।

## LLM Providers क्या कर सकते हैं?

OneUptime में LLM Providers आपके incident management workflow को स्वचालित और बेहतर बनाने में मदद करते हैं:

- **Autonomous Investigations**: नए incidents और alerts की स्वचालित रूप से जांच करें और timeline पर citations के साथ root cause analysis post करें — देखें [AI SRE](/docs/ai/ai-sre)
- **Incident Notes**: विस्तृत incident notes और updates स्वचालित रूप से तैयार करें
- **Alert Notes**: सार्थक alert विवरण और संदर्भ बनाएं
- **Scheduled Maintenance Notes**: maintenance event notes स्वचालित रूप से तैयार करें
- **Incident Postmortems**: व्यापक incident postmortem रिपोर्ट का मसौदा स्वचालित रूप से तैयार करें
- **Code Improvements**: यदि आप अपनी code repository को OneUptime से जोड़ते हैं, तो हम आपके LLM Provider का उपयोग telemetry डेटा (logs, traces, metrics, exceptions) का विश्लेषण करने और code improvements सुझाने के लिए करेंगे

## OneUptime SaaS उपयोगकर्ता

यदि आप **OneUptime SaaS** (cloud-hosted संस्करण) का उपयोग कर रहे हैं, तो आप बिना किसी अतिरिक्त configuration के डिफ़ॉल्ट रूप से **Global LLM Provider** का उपयोग कर सकते हैं। Global LLM Provider पहले से configured है और सभी AI सुविधाओं के लिए उपयोग के लिए तैयार है।

यदि आप अपनी स्वयं की API keys या किसी विशिष्ट provider का उपयोग करना पसंद करते हैं, तो आप नीचे दिए गए निर्देशों का पालन करते हुए एक custom LLM Provider configure कर सकते हैं।

OneUptime SaaS केवल public internet पर मौजूद LLM endpoints तक पहुँच सकता है। यह आपके private network पर किसी मॉडल से, जैसे self-hosted Ollama या vLLM server से, connect नहीं कर सकता। जो मॉडल आप खुद चलाते हैं उसका उपयोग करने के लिए, OneUptime को ऐसे network पर self-host करें जहाँ से वह मॉडल तक पहुँच सके, या मॉडल को किसी public endpoint पर उपलब्ध कराएँ — देखें [Self-hosted मॉडल के लिए बेस URL चुनना](#self-hosted-मॉडल-के-लिए-बेस-url-चुनना)।

## Self-hosted: Environment variables से zero-config setup

Self-hosted instance पर **सभी projects के लिए एक साथ** AI सुविधाएं चालू करने का सबसे तेज़ तरीका है अपने OneUptime server पर `GLOBAL_LLM_PROVIDER_*` environment variables सेट करना — Docker Compose के लिए `config.env` में, या Helm values के ज़रिए। Startup पर OneUptime इनसे एक Global LLM Provider register करता है (और उसे sync में रखता है); हर project के लिए dashboard में अलग से setup की ज़रूरत नहीं पड़ती, और जिस project का अपना provider नहीं है, उसके AI fix tasks भी इसी का उपयोग करते हैं।

| Variable | विवरण |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | चालू करने के लिए आवश्यक। इनमें से एक: `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API key — OpenAI, Azure OpenAI, Anthropic, Groq, और Mistral के लिए आवश्यक; Ollama या बिना key वाले OpenAI-compatible servers के लिए ज़रूरी नहीं |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | API endpoint — Azure OpenAI, Ollama, और OpenAI-compatible servers के लिए आवश्यक |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | उपयोग किया जाने वाला मॉडल (OpenAI-compatible servers के लिए आवश्यक, बाकी के लिए अनुशंसित) |
| `GLOBAL_LLM_PROVIDER_NAME` | Dashboard में दिखने वाला वैकल्पिक friendly name |

**उदाहरण: self-hosted Ollama**

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# ऐसा address जिस तक OneUptime server पहुँच सके। localhost कभी नहीं: नीचे
# "Self-hosted मॉडल के लिए बेस URL चुनना" देखें।
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# API key की ज़रूरत नहीं — Ollama keyless है।
```

**उदाहरण: OpenAI**

```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```

Sync declarative है: variables बदलने पर अगले restart पर provider update हो जाता है, और `GLOBAL_LLM_PROVIDER_TYPE` हटाने पर वह हट जाता है। Admin Dashboard में manually बनाए गए global providers को कभी नहीं छुआ जाता। Projects अब भी **प्रोजेक्ट सेटिंग्स** > **एआई** > **LLM प्रदाता** के अंतर्गत अपना provider जोड़ सकते हैं — project का अपना provider हमेशा global provider पर प्राथमिकता पाता है।

## समर्थित Providers

OneUptime वर्तमान में निम्नलिखित LLM providers का समर्थन करता है:

| Provider              | विवरण                                                                 | API Key आवश्यक  | Base URL आवश्यक               |
| --------------------- | --------------------------------------------------------------------- | --------------- | ----------------------------- |
| **OpenAI**            | GPT-5.1 और अन्य OpenAI मॉडल                                           | हाँ             | नहीं (डिफ़ॉल्ट उपयोग करता है) |
| **Azure OpenAI**      | आपके Azure deployment पर होस्ट किए गए OpenAI मॉडल                     | हाँ             | हाँ                           |
| **Anthropic**         | Claude Sonnet 5, Claude Opus 5, Claude Haiku 4.5, और अन्य Claude मॉडल | हाँ             | नहीं (डिफ़ॉल्ट उपयोग करता है) |
| **Groq**              | Llama, Mixtral, और अन्य open मॉडलों के लिए तेज़ inference             | हाँ             | नहीं (डिफ़ॉल्ट उपयोग करता है) |
| **Mistral**           | Mistral के होस्ट किए गए मॉडल                                          | हाँ             | नहीं (डिफ़ॉल्ट उपयोग करता है) |
| **Ollama**            | Llama 3.1, Mistral, Qwen आदि जैसे self-hosted open-source मॉडल        | नहीं            | हाँ                           |
| **OpenAI Compatible** | कोई भी OpenAI-compatible server (vLLM, LocalAI, LM Studio, आदि)       | नहीं (वैकल्पिक) | हाँ                           |

## LLM Provider सेट अप करना

### चरण 1: LLM Providers Settings पर जाएं

1. अपने OneUptime dashboard में लॉग इन करें
2. **प्रोजेक्ट सेटिंग्स** > **एआई** > **LLM प्रदाता** पर जाएं
3. नया provider जोड़ने के लिए **LLM प्रदाता बनाएँ** पर क्लिक करें

### चरण 2: अपना Provider Configure करें

निम्नलिखित fields भरें:

- **नाम**: इस LLM configuration के लिए एक उचित नाम (जैसे "Production OpenAI", "Local Ollama")
- **विवरण** (वैकल्पिक): इस provider के उद्देश्य की पहचान करने में सहायता के लिए एक विवरण
- **LLM प्रदाता**: provider प्रकार चुनें (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama, या OpenAI Compatible)
- **API कुंजी**: आपकी API key (OpenAI, Azure OpenAI, Anthropic, Groq, और Mistral के लिए आवश्यक; Ollama और OpenAI-compatible servers के लिए वैकल्पिक)
- **मॉडल नाम**: उपयोग करने के लिए विशिष्ट मॉडल (जैसे `gpt-5.1`, `claude-sonnet-5`, `llama3.1`)
- **बेस URL** (वैकल्पिक): Custom API endpoint URL (Azure OpenAI, Ollama, और OpenAI Compatible के लिए आवश्यक; अन्य के लिए वैकल्पिक)
- **और फ़ील्ड**, ऊपर के fields के नीचे सिमटा हुआ: **डिफ़ॉल्ट के रूप में सेट करें**, जो नए provider के लिए चालू रहता है क्योंकि AI सुविधाएं केवल project के डिफ़ॉल्ट provider का उपयोग करती हैं, और **अतिरिक्त पैरामीटर**, अतिरिक्त parameters का एक वैकल्पिक JSON object जो हर request के साथ provider को भेजा जाता है (उदाहरण के लिए `{"temperature": 0.2}`)

## Provider-विशिष्ट Configuration

### OpenAI

1. [OpenAI Platform](https://platform.openai.com/api-keys) से अपनी API key प्राप्त करें
2. LLM प्रदाता के रूप में **OpenAI** चुनें
3. अपनी API key दर्ज करें
4. एक model name चुनें:
   - `gpt-5.1` - अनुशंसित डिफ़ॉल्ट, tool calling और जटिल investigations में मज़बूत
   - `gpt-5.1-mini` - तेज़ और अधिक किफायती

**उदाहरण Configuration:**

```
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. [Anthropic Console](https://console.anthropic.com/) से अपनी API key प्राप्त करें
2. LLM प्रदाता के रूप में **Anthropic** चुनें
3. अपनी API key दर्ज करें
4. एक model name चुनें:
   - `claude-sonnet-5` - अनुशंसित डिफ़ॉल्ट, बुद्धिमत्ता, गति और लागत का सबसे अच्छा संतुलन
   - `claude-opus-5` - सबसे सक्षम मॉडल, सबसे कठिन investigations के लिए
   - `claude-haiku-4-5` - सबसे तेज़ और सबसे किफायती

**उदाहरण Configuration:**

```
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5
```

### Ollama (Self-Hosted)

Ollama आपको locally या अपने स्वयं के infrastructure पर open-source LLMs चलाने की अनुमति देता है।

1. [ollama.ai](https://ollama.ai) से Ollama इंस्टॉल करें
2. अपना इच्छित मॉडल pull करें: `ollama pull llama3.1`
3. सुनिश्चित करें कि Ollama चल रहा है और OneUptime server से उस तक पहुँचा जा सकता है। Native install केवल `127.0.0.1` पर सुनता है, इसलिए उसे `OLLAMA_HOST=0.0.0.0:11434` के साथ शुरू करें ताकि वह दूसरी machines और containers से connections स्वीकार करे (आधिकारिक `ollama/ollama` Docker image यह पहले से करता है)
4. LLM प्रदाता के रूप में **Ollama** चुनें
5. Base URL दर्ज करें: Ollama server का वह address जिससे OneUptime server उस तक पहुँचता है, जैसे `http://ollama:11434` (OneUptime `/api/chat` खुद जोड़ता है)। `localhost` काम नहीं करता — देखें [Self-hosted मॉडल के लिए बेस URL चुनना](#self-hosted-मॉडल-के-लिए-बेस-url-चुनना)
6. वह model name दर्ज करें जो आपने pull किया

**उदाहरण Configuration (OneUptime के Docker Compose network पर `ollama` नाम की service के रूप में Ollama):**

```
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Context window बढ़ाएँ।** अलग से न बताया जाए तो Ollama किसी मॉडल को छोटी context window के साथ चलाता है (मौजूदा releases में 4096 tokens, पुराने releases में 2048) और जो उसमें नहीं समाता उसे चुपचाप काट देता है। OneUptime की AI सुविधाएँ हर request के साथ अपनी tool definitions भेजती हैं, और अकेले वे ही कई हज़ार tokens ले सकती हैं। जब वे कट जाती हैं तो कोई error नहीं आता: मॉडल बस जवाब देता है कि उसके पास इस सवाल के लिए कोई tool नहीं है। Provider के **अतिरिक्त पैरामीटर** में बड़ा `num_ctx` सेट करें:

```json
{ "options": { "num_ctx": 16384 } }
```

OneUptime इस `options` object को उन options में merge करता है जो वह Ollama को भेजता है, इसलिए केवल वही settings लिखें जिन्हें आप बदलना चाहते हैं। बड़ी context window को ज़्यादा memory चाहिए, इसलिए ऐसा size चुनें जिसे आपका मॉडल support करे और आपका hardware संभाल सके। इसके बजाय सभी clients के लिए default बढ़ाने के लिए Ollama server पर `OLLAMA_CONTEXT_LENGTH` सेट करें। `GLOBAL_LLM_PROVIDER_*` variables से registered global provider के लिए यह field Admin Dashboard में **सेटिंग्स** > **वैश्विक LLM प्रदाता** के अंतर्गत सेट करें; startup sync उस field को नहीं छूता।

**लोकप्रिय Ollama मॉडल:**

- `llama3.1` - Meta का Llama 3.1 मॉडल, tool calling support वाला सबसे पुराना Llama
- `llama3.3` - Meta का Llama 3.3 मॉडल
- `qwen2.5` - Alibaba का Qwen 2.5 मॉडल
- `mistral-nemo` - Mistral AI का Nemo मॉडल

> नोट: OneUptime की AI सुविधाएँ agentic हैं — वे tool calling पर बहुत निर्भर करती हैं। `llama3.1` या नया (या tool calling support करने वाला कोई दूसरा मॉडल) उपयोग करें। छोटे मॉडल या tool calling support के बिना वाले मॉडल (जैसे `llama2`, मूल `llama3`) खराब नतीजे देते हैं: वे आपके monitors, incidents या telemetry को query नहीं कर सकते, इसलिए investigations खाली या hallucinated लौटती हैं।

### Self-hosted मॉडल के लिए बेस URL चुनना

Self-hosted मॉडल का बेस URL — Ollama, vLLM, LM Studio या कोई भी दूसरा OpenAI-compatible server — ऐसा address होना चाहिए जिस तक **OneUptime server** पहुँच सके। आपका browser उससे कभी connect नहीं करता।

**Loopback addresses हमेशा ठुकरा दिए जाते हैं।** Connect करने से पहले OneUptime हर उस address की जाँच करता है जिस पर बेस URL का host name resolve होता है। `localhost`, `127.0.0.1`, `[::1]` और `0.0.0.0`, साथ ही link-local और cloud metadata addresses जैसे `169.254.169.254`, हर deployment में ठुकरा दिए जाते हैं, self-hosted में भी। यह जान-बूझकर है: किसी provider के बेस URL से OneUptime server पर ही चल रही services तक पहुँचना संभव नहीं होना चाहिए। वैसे भी Docker Compose या Kubernetes के अंदर `localhost` OneUptime container होता, न कि वह machine जो आपका मॉडल चलाती है।

इसके बजाय private address या internal host name उपयोग करें:

| Model server कहाँ चलता है | बेस URL |
| --- | --- |
| OneUptime के Docker Compose network (`oneuptime`) पर एक service | Service का नाम, जैसे `http://ollama:11434` |
| OneUptime वाला ही Kubernetes cluster | Service का DNS name, जैसे `http://ollama.<namespace>.svc.cluster.local:11434` — [bundled vLLM](#self-hosted-vllm-on-kubernetes-helm) वाला ही pattern |
| खुद host machine पर, किसी container के बाहर | Host का LAN IP, जैसे `http://192.168.1.20:11434`, या Docker Desktop पर `http://host.docker.internal:11434` |
| आपके network की कोई दूसरी machine | उसका private IP या internal host name, जैसे `http://10.0.0.12:11434` |

OpenAI-compatible servers भी अपने port और `/v1` path के साथ यही नियम मानते हैं, जैसे `http://vllm:8000/v1`, या LM Studio के लिए `http://192.168.1.20:1234/v1`। Native Ollama install की तरह LM Studio भी तब तक केवल `127.0.0.1` पर सुनता है जब तक आप उसकी server settings में **Serve on Local Network** चालू न करें।

**Self-hosted installs पर private addresses काम करते हैं।** Self-hosted OneUptime private network addresses तक पहुँच सकता है, जैसे `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` और IPv6 `fc00::/7`, जब तक आप `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` सेट न करें, जो उन्हें OneUptime Cloud की तरह ठुकरा देता है।

**OneUptime Cloud (SaaS) private networks तक नहीं पहुँच सकता।** यह हर LLM provider के लिए private network addresses, और उन पर resolve होने वाले host names, ठुकरा देता है। अपने infrastructure पर चल रहे मॉडल का उपयोग करने के लिए, या तो OneUptime को ऐसे network पर self-host करें जहाँ से वह मॉडल तक पहुँच सके, या मॉडल को publicly reachable endpoint पर उपलब्ध कराएँ। Public endpoint को API key से सुरक्षित करें: **Ollama** provider कोई credentials नहीं भेजता, जबकि **OpenAI Compatible** API key को bearer token के रूप में भेजता है (Ollama `/v1` के अंतर्गत OpenAI-compatible API भी देता है, इसलिए वह key जाँचने वाले reverse proxy के पीछे रह सकता है)।

### OpenAI Compatible (vLLM, LocalAI, LM Studio, आदि)

किसी भी ऐसे server के लिए **OpenAI Compatible** provider का उपयोग करें जो OpenAI का `/chat/completions` API लागू करता है लेकिन खुद OpenAI नहीं है — उदाहरण के लिए [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai), या text-generation-webui। ये आम तौर पर आपके अपने URL पर self-hosted होते हैं और अक्सर बिना authentication के चलते हैं।

1. अपना OpenAI-compatible server शुरू करें और उसका base URL नोट करें (यह आमतौर पर `/v1` पर समाप्त होता है)
2. LLM प्रदाता के रूप में **OpenAI Compatible** चुनें
3. **बेस URL** दर्ज करें (आवश्यक), जैसे `http://your-server:8000/v1`। यह OneUptime server से पहुँच योग्य होना चाहिए, इसलिए `localhost` नहीं — देखें [Self-hosted मॉडल के लिए बेस URL चुनना](#self-hosted-मॉडल-के-लिए-बेस-url-चुनना)
4. **मॉडल नाम** दर्ज करें (आवश्यक) — यह आपके server द्वारा उपलब्ध कराए गए किसी मॉडल से मेल खाना चाहिए
5. **API कुंजी** केवल तभी दर्ज करें जब आपके server को इसकी आवश्यकता हो; keyless servers के लिए इसे खाली छोड़ दें

**उदाहरण Configuration (keyless vLLM):**

```
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> Tip: सेव करने के बाद, connection, model name, और base URL सही हैं यह सुनिश्चित करने के लिए provider पर **परीक्षण** बटन का उपयोग करें।

### Self-Hosted vLLM on Kubernetes (Helm)

यदि आप Helm chart के साथ OneUptime को self-host करते हैं, तो आप अपने cluster के अंदर [vLLM](https://docs.vllm.ai) — एक OpenAI-compatible inference server — चला सकते हैं और अपने खुद के GPUs पर local मॉडल serve कर सकते हैं। कोई भी डेटा आपके infrastructure से बाहर नहीं जाता।

1. इसे अपने Helm values में सक्षम करें (NVIDIA GPU nodes आवश्यक हैं):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. `helm upgrade` चलाएं और vLLM pod के Ready होने की प्रतीक्षा करें (पहली शुरुआत में मॉडल डाउनलोड होता है)
3. बस इतना ही — vLLM startup पर एक Global LLM Provider के रूप में स्वचालित रूप से पंजीकृत हो जाता है (`vllm.globalProvider.enabled`, डिफ़ॉल्ट `true`), इसलिए AI सुविधाएं सभी projects के लिए काम करती हैं, AI fix tasks भी। (हर जगह — Cloud और self-hosted दोनों पर — जिस project का अपना कोई provider नहीं है, उसके agent fix tasks global provider का उपयोग करते हैं; Cloud पर यह उपयोग metered AI tokens के रूप में bill होता है। Project का अपना provider हमेशा प्राथमिकता पाता है।)

यदि आपने auto-registration (`vllm.globalProvider.enabled: false`) को अक्षम किया है, तो provider को मैन्युअल रूप से बनाएं:

1. LLM प्रदाता के रूप में **OpenAI Compatible** चुनें (vLLM OpenAI API बोलता है)
2. in-cluster Base URL दर्ज करें: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (अगर आपने `global.clusterDomain` बदला है तो `cluster.local` को बदलें)
3. Model Name दर्ज करें: पूरा HuggingFace model id (या यदि आपने एक सेट किया है तो `vllm.servedModelName`)
4. API Key केवल तभी दर्ज करें जब आपने `vllm.apiKey` सेट किया हो; keyless vLLM के लिए इसे खाली छोड़ दें

**उदाहरण Configuration:**

```
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

GPU scheduling, gated मॉडल और tuning विकल्पों के लिए [Helm chart की vLLM guide](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) देखें।

## Custom Base URLs का उपयोग

Enterprise deployments के लिए या proxy services का उपयोग करते समय, आप एक custom Base URL निर्दिष्ट कर सकते हैं:

- **Azure OpenAI**: अपना Azure endpoint URL उपयोग करें
- **OpenAI-compatible APIs**: कोई भी API जो OpenAI के API specification का पालन करती है
- **Private Ollama instances**: आपके आंतरिक Ollama server का URL

## सर्वोत्तम प्रथाएं

1. **वर्णनात्मक नाम उपयोग करें**: अपने providers को स्पष्ट रूप से नाम दें (जैसे "Production OpenAI", "Development Ollama")
2. **अपनी API keys सुरक्षित करें**: API keys rest पर encrypt होती हैं, लेकिन उन्हें share करने से बचें
3. **अपनी configuration परीक्षण करें**: सेट अप के बाद, सत्यापित करें कि provider AI सुविधाओं के साथ काम करता है
4. **उपयोग monitor करें**: लागत प्रबंधित करने के लिए API उपयोग पर नज़र रखें

## समस्या निवारण

### Connection संबंधी समस्याएं

- **OpenAI/Anthropic**: सत्यापित करें कि आपकी API key valid है और पर्याप्त credits हैं
- **Ollama**: सुनिश्चित करें कि Ollama server चल रहा है, ऐसे address पर सुन रहा है जिस तक OneUptime server पहुँच सके (native install के लिए `OLLAMA_HOST=0.0.0.0:11434`), और Base URL उसी address की ओर इशारा करता है
- **OpenAI Compatible**: सुनिश्चित करें कि Base URL `/v1` पर समाप्त होता है (या आपके server से मेल खाता है), Model Name आपके server द्वारा उपलब्ध कराए गए किसी मॉडल से मेल खाता है, और API Key केवल तभी सेट करें जब आपके server को इसकी आवश्यकता हो
- **"…points to an address OneUptime is not allowed to connect to"**: Base URL किसी ठुकराए गए address पर resolve होता है — `localhost` या कोई दूसरा loopback address, या OneUptime Cloud पर कोई private network address। (OneUptime Cloud ठुकराए गए host name को इसके बजाय "…could not be reached" के रूप में रिपोर्ट करता है।) देखें [Self-hosted मॉडल के लिए बेस URL चुनना](#self-hosted-मॉडल-के-लिए-बेस-url-चुनना)
- **Firewall**: जांचें कि आपका नेटवर्क provider के API से outbound connections की अनुमति देता है

### मॉडल नहीं मिला

- सत्यापित करें कि model name सही वर्तनी में है
- Ollama के लिए, सुनिश्चित करें कि आपने `ollama pull <model-name>` से मॉडल pull किया है
- जांचें कि मॉडल आपके क्षेत्र में उपलब्ध है (कुछ मॉडलों में क्षेत्रीय प्रतिबंध हैं)

## सहायता चाहिए?

यदि आपको अपना LLM provider सेट अप करने में कोई समस्या आती है, तो कृपया:

1. ज्ञात समस्याओं के लिए [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) देखें
2. यदि आप enterprise plan पर हैं तो support से संपर्क करें

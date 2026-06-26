# Runbook कॉन्फ़िगरेशन और सुरक्षा

## Bash और JavaScript वास्तव में कैसे चलते हैं

Bash और JavaScript चरण **OneUptime Worker पर कभी नहीं चलते**। उन्हें job के रूप में एक विशिष्ट [Runbook एजेंट](/docs/runbooks/agents) पर dispatch किया जाता है — एक छोटी प्रक्रिया जिसे आप अपनी अपनी इन्फ्रास्ट्रक्चर के एक होस्ट पर इंस्टॉल करते हैं।

Dispatch मॉडल:

1. Runbook step का लेखक step लिखते समय ड्रॉपडाउन से एक Runbook एजेंट चुनता है।
2. जब step चलता है, तो Worker `RunbookAgentJob` में एक पंक्ति डालता है जिसमें `targetAgentId` उस एजेंट की ID पर सेट होती है और status `Pending` होता है।
3. वही विशिष्ट एजेंट (और केवल वही एजेंट) atomic रूप से job को claim करता है, script को लोकल में चलाता है — Bash के लिए `bash -c <script>`, JavaScript के लिए `isolated-vm` sandbox के अंदर — और परिणाम वापस भेजता है।
4. Worker उस परिणाम के साथ runbook को आगे बढ़ाता है।

अब कोई `RUNBOOK_BASH_ENABLED` environment flag नहीं है। किसी deployment में Bash या JavaScript चरण काम करते हैं या नहीं, यह पूरी तरह से इस पर निर्भर करता है कि project में कम से कम एक connected Runbook एजेंट है या नहीं।

## आउटपुट सीमाएँ और timeouts

- प्रति-चरण आउटपुट: **50&nbsp;KB**। इससे बड़ा आउटपुट मार्कर के साथ काटा जाता है।
- प्रति-चरण execution timeout डिफ़ॉल्ट: JavaScript, Bash और HTTP के लिए **30 सेकंड**। प्रति चरण कॉन्फ़िगर करने योग्य।
- Bash और JavaScript चरणों के लिए प्रति-चरण **claim timeout**: **2 मिनट** — Worker कितनी देर चुने हुए एजेंट के job लेने का इंतज़ार करता है, इससे पहले कि वह fail हो।

## अनुमतियाँ

Runbook अनुमतियाँ `Runbook` अनुमति समूह में रहती हैं:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — Runbook टेम्पलेट्स प्रबंधन।
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — execution शुरू करना, टिक करना और पढ़ना।
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — ऑटो-ट्रिगर नियम प्रबंधन।
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — आपकी अपनी इन्फ्रास्ट्रक्चर में Bash और JavaScript चरण चलाने वाले Runbook एजेंट प्रबंधन।
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (भूमिकाएँ) — किसी टीम को असाइन करें ताकि क्रमशः पूर्ण नियंत्रण, रोज़मर्रा उपयोग या केवल-पठन पहुँच मिले। `RunbookAdmin` ऊपर की सभी सूक्ष्म अनुमतियों को bundle करता है।

## क्यू और वर्कर

Runbook executions `Runbook` BullMQ क्यू पर चलते हैं। वर्कर समवर्तिता 25 है — यदि आपकी डिप्लॉय में कई समवर्ती runs हैं तो समायोजित करें।

जब Manual चरण API के माध्यम से टिक होता है, तो execution को अगले चरण से जारी रखने के लिए फिर से क्यू में डाला जाता है। इससे वर्कर Runbook के बाक़ी हिस्से के लिए गर्म बना रहता है।

## हार्डनिंग नोट्स

- **JavaScript और Bash** आपके द्वारा नियंत्रित Runbook एजेंट होस्ट पर चलते हैं, OneUptime Worker पर नहीं। JavaScript को सामान्य प्रिएम्बल के साथ `isolated-vm` sandbox में लपेटा गया है (प्रोटोटाइप चेन तोड़ता है, `Function`/`eval` हटाता है, अंतर्निहित प्रोटोटाइप फ़्रीज़ करता है)। Bash एजेंट पर timeout प्रवर्तन के साथ `bash -c` के माध्यम से चलता है।
- **HTTP चरण** उदार स्टेटस सत्यापनकर्ता का उपयोग करते हैं, इसलिए 4xx या 5xx प्रतिक्रिया फेंकी नहीं जाती बल्कि असफल चरण के रूप में दर्ज होती है। इस तरह कैप्चर किया गया आउटपुट यह दिखाता है कि सामने वाले ने वास्तव में क्या लौटाया।
- **एजेंट प्रमाणीकरण** ID + secret key से होता है, जो एजेंट container पर env vars के रूप में सेट है। सर्वर साइड पर, अधिकारिक एजेंट पहचान प्रस्तुत ID/key से keyed DB पंक्ति से आती है — क्लाइंट compromised key के साथ भी किसी दूसरे एजेंट का प्रतिरूपण नहीं कर सकते।

## डेटाबेस तालिकाएँ

- `Runbook` — टेम्पलेट (name, slug, description, isEnabled, चरणों का JSON)।
- `RunbookExecution` — प्रति run एक पंक्ति, null-योग्य फॉरेन कीज़ `incidentId`, `alertId` और `scheduledMaintenanceId` के साथ और एक JSON सरणी `stepExecutions` जो चरणों और प्रति-चरण स्थिति का स्नैपशॉट लेती है।
- `RunbookRule` — `triggerEntityType` discriminator (Incident, Alert, ScheduledMaintenance) और शुरू करने के Runbook के लिए many-to-many संबंध वाले ऑटो-ट्रिगर नियम।
- `RunbookAgent` — प्रति इंस्टॉल किए गए एजेंट एक पंक्ति: नाम, secret key, `lastAlive`, `connectionStatus`, host जानकारी।
- `RunbookAgentJob` — प्रति dispatch किए गए Bash या JavaScript चरण एक पंक्ति: `targetAgentId` (वह एजेंट जिसे step लेखक ने चुना), step type, script, status (`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`), claim deadline, lease, output, exit code।

## संचालन सुझाव

- **सुनिश्चित करें कि किसी step पर आप जो एजेंट चुनते हैं वह स्वस्थ है।** अगर redundancy चाहिए तो दूसरा एजेंट चलाएँ और अपने steps को उनके बीच बाँटें, या एक backup runbook रखें जो दूसरे एजेंट को निशाना बनाता है।
- **URL कैप्चर करें, blobs नहीं।** यदि कोई चरण कुछ KB से अधिक आउटपुट देता है, तो S3 या अपनी log stack में लिखें और URL लौटाएँ।
- **idempotence मायने रखती है।** ऑटोमेटेड चरण (HTTP, JavaScript, Bash) तब एक से अधिक बार चल सकते हैं जब वर्कर चरण के बीच में पुनः शुरू हो या किसी एजेंट का lease चलते हुए script के दौरान expire हो जाए; उन्हें इस तरह डिज़ाइन करें कि retry सुरक्षित हो।

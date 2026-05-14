# Runbook कॉन्फ़िगरेशन और सुरक्षा

## आउटपुट सीमाएँ

- प्रति-चरण आउटपुट: **50KB**। इससे बड़ा आउटपुट मार्कर के साथ काटा जाता है।
- प्रति-चरण डिफ़ॉल्ट टाइमआउट: JavaScript, Bash और HTTP के लिए **30 सेकंड**। प्रति चरण कॉन्फ़िगर करने योग्य।
- Bash चरणों के लिए **Claim timeout** डिफ़ॉल्ट: **2 मिनट** — Worker कितनी देर एक Runbook एजेंट के job लेने का इंतज़ार करता है, इससे पहले कि वह fail हो।

## अनुमतियाँ

Runbook अनुमतियाँ `Runbook` अनुमति समूह में रहती हैं:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — Runbook टेम्पलेट्स प्रबंधन।
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — execution शुरू करना, टिक करना और पढ़ना।
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — ऑटो-ट्रिगर नियम प्रबंधन।
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — आपकी अपनी इन्फ्रास्ट्रक्चर में Bash चरण चलाने वाले Runbook एजेंट प्रबंधन।
- `RunbookManager` (भूमिका) — उपर्युक्त सभी का बंडल; किसी टीम को असाइन करें ताकि पूर्ण Runbook क्षमताएँ मिलें।

## क्यू और वर्कर

Runbook executions `Runbook` BullMQ क्यू पर चलते हैं। वर्कर समवर्तिता 25 है — यदि आपकी डिप्लॉय में कई समवर्ती runs हैं तो समायोजित करें।

जब Manual चरण API के माध्यम से टिक होता है, तो execution को अगले चरण से जारी रखने के लिए फिर से क्यू में डाला जाता है। इससे वर्कर Runbook के बाक़ी हिस्से के लिए गर्म बना रहता है।

## हार्डनिंग नोट्स

- **JavaScript चरण** `isolated-vm` में सैंडबॉक्स-हार्डनिंग प्रिएम्बल के साथ चलते हैं (प्रोटोटाइप चेन तोड़ता है, `Function` और `eval` हटाता है, अंतर्निहित प्रोटोटाइप फ़्रीज़ करता है)।
- **Bash चरण** कभी भी OneUptime Worker पर नहीं चलते। उन्हें job के रूप में आपके द्वारा अपनी इन्फ्रास्ट्रक्चर में इंस्टॉल किए गए [Runbook एजेंट](/docs/runbooks/agents) को भेजा जाता है। Worker चरण के **Agent Tag** के साथ job को कतार में डालता है, एक एजेंट atomic रूप से उसे claim करता है, स्थानीय रूप से `bash -c <script>` चलाता है और परिणाम वापस भेजता है। Worker प्रक्रिया स्वयं आपके वातावरण तक shell पहुँच नहीं रखती।
- **HTTP चरण** उदार स्टेटस सत्यापनकर्ता का उपयोग करते हैं, इसलिए 4xx या 5xx प्रतिक्रिया फेंकी नहीं जाती बल्कि असफल चरण के रूप में दर्ज होती है। इस तरह कैप्चर किया गया आउटपुट यह दिखाता है कि सामने वाले ने वास्तव में क्या लौटाया।

## डेटाबेस तालिकाएँ

- `Runbook` — टेम्पलेट (name, slug, description, isEnabled, चरणों का JSON)।
- `RunbookExecution` — प्रति run एक पंक्ति, null-योग्य फॉरेन कीज़ `incidentId`, `alertId` और `scheduledMaintenanceId` के साथ और एक JSON सरणी `stepExecutions` जो चरणों और प्रति-चरण स्थिति का स्नैपशॉट लेती है।
- `RunbookRule` — `triggerEntityType` discriminator (Incident, Alert, ScheduledMaintenance) और शुरू करने के Runbook के लिए many-to-many संबंध वाले ऑटो-ट्रिगर नियम।
- `RunbookAgent` — प्रति इंस्टॉल किए गए एजेंट एक पंक्ति: नाम, tags, secret key, `lastAlive`, `connectionStatus`, host जानकारी।
- `RunbookAgentJob` — प्रति डिस्पैच किए गए Bash चरण एक पंक्ति: आवश्यक tag, script, स्थिति (Pending → Claimed → Running → Succeeded/Failed/TimedOut/Cancelled), claim deadline, lease, output, exit code।

## संचालन सुझाव

- **जिस tag का लक्ष्य रखते हैं उसके लिए कम से कम एक एजेंट चलाएँ**, उच्च उपलब्धता के लिए दो अच्छा। एक ही tag वाले दो एजेंटों के साथ कोई भी एक job claim कर सकता है — आप runbooks तोड़े बिना rolling restart कर सकते हैं।
- **URL कैप्चर करें, blobs नहीं।** यदि कोई चरण कुछ KB से अधिक आउटपुट देता है, तो S3 या अपनी log stack में लिखें और URL लौटाएँ।
- **idempotence मायने रखती है।** ऑटोमेटेड चरण (HTTP, JavaScript, Bash) तब एक से अधिक बार चल सकते हैं जब वर्कर चरण के बीच में पुनः शुरू हो या किसी एजेंट का lease चलते हुए script के दौरान expire हो जाए; उन्हें इस तरह डिज़ाइन करें कि retry सुरक्षित हो।

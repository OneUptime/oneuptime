# Runbook एजेंट

एक **Runbook एजेंट** एक छोटा सेल्फ-होस्टेड प्रोसेस है जो आपके runbooks के Bash _और_ JavaScript steps को **आपके अपने इन्फ्रास्ट्रक्चर के अंदर** चलाता है। OneUptime का Worker आपके scripts को कभी खुद नहीं चलाता — वह उन्हें कतार में डालता है, और step के लेखक ने जिस Runbook एजेंट को चुना है, वही उन्हें claim करता है, चलाता है और परिणाम वापस भेजता है।

JavaScript अब भी `isolated-vm` sandbox में चलता है; अंतर सिर्फ इतना है कि वह sandbox हमारे यहाँ नहीं, बल्कि आपके एजेंट host पर रहता है।

यह पेज समझाता है कि एजेंट कैसे इंस्टॉल करें, Bash और JavaScript steps को उसकी ओर कैसे इंगित करें, और रोज़मर्रा में उसे कैसे चलाएँ।

## एजेंट क्यों ज़रूरी हैं

पहले OneUptime के संस्करण Bash और JavaScript steps Worker पर चलाते थे। JavaScript sandbox में था (`isolated-vm`), Bash नहीं। दोनों ही सिंगल-टेनेंट सेल्फ-होस्टेड सेटअप से परे किसी भी चीज़ के लिए समस्याजनक थे:

- **विश्वास सीमा।** जो भी runbook लिख सकता था वह Worker पर कोड चला सकता था, जिसके पास Worker की सारी env variables और filesystem तक पहुँच थी। JavaScript का sandbox स्पष्ट चीज़ें ब्लॉक करता था, लेकिन एक दृढ़ उपयोगकर्ता को यह जाँचने से नहीं रोक सकता था कि हमारे नेटवर्क से क्या-क्या पहुँच में है।
- **पहुँच।** अधिकांश उपयोगी steps _ग्राहक_ के इन्फ्रास्ट्रक्चर पर काम करना चाहते हैं ("इस service को restart करो", "हमारे cluster पर kubectl", "हमारे internal DB में एक record देखो") — OneUptime के नहीं।

Runbook एजेंट इसे उलट देते हैं। Bash और JavaScript steps हमारे यहाँ नहीं चलते। वे उस host पर चलते हैं जिसे आप नियंत्रित करते हैं, और आप तय करते हैं कि वह host क्या कर सकता है।

## यह कैसे काम करता है

1. आप OneUptime में एक Runbook एजेंट बनाते हैं। OneUptime एक ID और एक secret key जनरेट करता है।
2. आप उस ID/key और अपने OneUptime URL के साथ अपने इन्फ्रास्ट्रक्चर के एक host पर एजेंट का container चलाते हैं।
3. एजेंट हर कुछ सेकंड में OneUptime से पूछता है: "मेरे लिए कोई काम है?"
4. जब आप एक Bash या JavaScript step लिखते हैं, तो ड्रॉपडाउन से एजेंट चुनते हैं — step उस विशिष्ट एजेंट से बँध जाता है।
5. जब step चलता है, Worker `RunbookAgentJob` पंक्ति डालता है जिसमें `targetAgentId` उस एजेंट पर सेट होता है। केवल वही एजेंट उसे claim कर सकता है।
6. एजेंट script को लोकल में चलाता है — Bash के लिए `bash -c <script>`, JavaScript के लिए एक `isolated-vm` sandbox — परिणाम कैप्चर करके वापस भेजता है। Worker उस परिणाम के साथ runbook को आगे बढ़ाता है।

एजेंट को बस आपके OneUptime instance तक **outbound HTTPS** चाहिए। यह कोई inbound connection स्वीकार नहीं करता।

## एजेंट इंस्टॉल करें

### 1. एजेंट का रिकॉर्ड बनाएँ

**Runbooks → Settings → Agents** पर जाएँ और एक नया एजेंट बनाएँ। भरें:

| फ़ील्ड    | टिप्पणियाँ                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **नाम**   | एक सार्थक नाम — आमतौर पर `कहाँ-चलता-है-और-क्या-कर-सकता-है`, जैसे `prod-eu-west-1`। step लिखते समय ड्रॉपडाउन में यही नाम दिखेगा। |
| **विवरण** | वैकल्पिक। एक वाक्य कि यह host क्या-क्या तक पहुँच सकता है। भविष्य का आप आभारी होगा।                                              |

### 2. इंस्टॉल कमांड कॉपी करें

एजेंट बनाने के बाद, उसकी पंक्ति पर **Show setup instructions** क्लिक करें। आपको इस एजेंट के ID और key के साथ पहले से भरा हुआ `docker run` कमांड दिखेगा। **अभी key save कर लें** — आप इसे बाद में reset कर सकते हैं, लेकिन modal बंद करने के बाद वही value दोबारा नहीं देख पाएँगे।

### 3. अपने इन्फ्रास्ट्रक्चर के एक host पर चलाएँ

अपने environment के किसी भी host पर Docker कमांड चलाएँ जो:

- HTTPS पर आपके OneUptime instance तक पहुँच सकता हो, और
- वे चीज़ें कर सकता हो जो आप Bash/JavaScript steps से करवाना चाहते हैं (जैसे दूसरे hosts पर SSH, `kubectl`, database से बात करना)।

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runbook-agent:release
```

### 4. एजेंट का connection सत्यापित करें

**Runbooks → Settings → Agents** पर वापस जाएँ। लगभग 60 सेकंड के भीतर एजेंट की पंक्ति को ताज़ा **Last seen** टाइमस्टैम्प के साथ `Connected` में बदल जाना चाहिए। अगर वह `Disconnected` ही रहे:

- container logs (`docker logs oneuptime-runbook-agent`) में auth या नेटवर्क errors देखें।
- सत्यापित करें कि host `curl` से OneUptime URL तक पहुँचता है।
- सत्यापित करें कि ID और key बिना whitespace के copy हुए हैं।

## किसी step को एजेंट की ओर इंगित करें

अपने runbook में एक Bash या JavaScript step जोड़ें। फ़ॉर्म में एक **Runbook Agent** ड्रॉपडाउन होता है जिसमें वर्तमान प्रोजेक्ट के सभी एजेंट सूचीबद्ध हैं (साथ ही connected/disconnected इंडिकेटर):

- वह एजेंट चुनें जिसे यह step चलाना चाहिए।
- नीचे editor में अपनी script लिखें।

जब runbook चलकर step तक पहुँचेगा, Worker उस एजेंट की ID पर targeted एक job queue में डालता है। केवल वही एजेंट उसे claim कर सकता है। Bash `bash -c` के ज़रिए चलता है; JavaScript एजेंट पर `isolated-vm` sandbox के अंदर चलता है (कोई filesystem नहीं, कोई network नहीं, `Function`/`eval` नहीं)।

एक से अधिक एजेंट चाहिए? बना लीजिए, फिर अलग-अलग steps को उपयुक्त एजेंट की ओर इंगित कर दीजिए। अगर redundancy चाहिए, तो दो runbooks लिख सकते हैं (एक प्रति एजेंट) या steps को एजेंटों के बीच बाँट सकते हैं।

## संचालन संबंधी नोट

### Timeouts

हर Bash या JavaScript step पर दो timeouts लागू होते हैं:

| Timeout               | डिफ़ॉल्ट | क्या नियंत्रित करता है                                                                                                                                                                                             |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Claim timeout**     | 2 मिनट   | Worker कितनी देर चुने हुए एजेंट के job claim करने का इंतज़ार करता है। अगर एजेंट समय में नहीं उठाए, step `TimedOut` के साथ fail हो जाती है और runbook (**Continue on failure** के अनुसार) आगे बढ़ता है या रुकता है। |
| **Execution timeout** | 30 सेकंड | एजेंट script को समाप्त करने से पहले कितनी देर चलने देता है। प्रति step कॉन्फ़िगर करने योग्य। (Bash को `SIGKILL` मिलता है; JavaScript का isolate तोड़ दिया जाता है।)                                                |

Worker का कुल प्रतीक्षा window `claim timeout + execution timeout + कुछ सेकंड का margin` है। step के अनुरूप मान चुनें।

### Lease और heartbeat

जब कोई एजेंट किसी job को claim करता है, उसे एक छोटा lease मिलता है (डिफ़ॉल्ट 30 सेकंड)। script के चलते समय एजेंट हर 10 सेकंड में lease नवीनीकृत करता है। अगर script के बीच एजेंट मर जाए या network खो दे, lease expire हो जाता है और Worker job को अनंतकाल तक प्रतीक्षा करने के बजाय `TimedOut` कर देता है।

lease expire होने पर Bash के child processes अपने आप cancel **नहीं** होते (एक JavaScript isolate भी, अगर कभी पूरा होता है, पूरा होने तक चलने दिया जाता है) — लेकिन Worker उसका इंतज़ार छोड़ देता है, और किसी और claim के संभाल लेने के बाद एजेंट परिणाम submit नहीं कर पाएगा। अगर exactly-once मायने रखता है, scripts को safely re-runnable डिज़ाइन करें।

### कोई एजेंट online नहीं

अगर step के execute होने के समय चुना हुआ एजेंट offline है, job claim timeout बीतने तक `Pending` रहता है और फिर एक स्पष्ट संदेश ("no agent claimed the job") के साथ fail हो जाता है। एक runbook को असली में चलाने से पहले coverage की पुष्टि करने का स्थान Agents पेज है।

### Output सीमा

प्रति step stdout + stderr मिलाकर **50 KB** तक सीमित है। बड़े output को marker के साथ काटा जाता है। पूरी log चाहिए तो script से ही S3 या अपने log store में लिखें और URL को `echo` करें।

### रद्द करना

Runbook execution को रद्द करना (execution view या API से) तुरंत उसकी सभी `Pending`/`Claimed`/`Running` Bash और JavaScript jobs को `Cancelled` मार्क कर देता है। पहले से script बीच में चल रहा एजेंट काम पूरा करेगा, पर server उसका परिणाम स्वीकार नहीं करेगा।

### समवर्तीता (Concurrency)

हर एजेंट डिफ़ॉल्ट रूप से एक समय में एक job चलाता है। अधिक की अनुमति देने के लिए, एजेंट container पर `RUNBOOK_AGENT_CONCURRENCY` सेट करें — लेकिन याद रखें कि एजेंट host को वहाँ रहने वाली बाकी सब चीज़ों के साथ साझा करता है।

## Environment variables

एजेंट startup पर ये पढ़ता है:

| Variable                                  | आवश्यक | डिफ़ॉल्ट | टिप्पणियाँ                                                                    |
| ----------------------------------------- | ------ | -------- | ----------------------------------------------------------------------------- |
| `ONEUPTIME_URL`                           | हाँ    | —        | आपके OneUptime instance का base URL, जैसे `https://oneuptime.yourdomain.com`। |
| `RUNBOOK_AGENT_ID`                        | हाँ    | —        | एजेंट के setup modal में दिखाया गया UUID।                                     |
| `RUNBOOK_AGENT_KEY`                       | हाँ    | —        | एजेंट के setup modal में दिखाया गया secret।                                   |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS`          | नहीं   | `5000`   | एजेंट कितनी बार नए jobs के लिए poll करता है।                                  |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS`     | नहीं   | `60000`  | एजेंट कितनी बार जीवित होने की रिपोर्ट देता है।                                |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | नहीं   | `10000`  | एजेंट चालू job के lease को कितनी बार नवीनीकृत करता है।                        |
| `RUNBOOK_AGENT_CONCURRENCY`               | नहीं   | `1`      | इस एजेंट पर अधिकतम समवर्ती jobs।                                              |

## एजेंट की key rotate करना

अगर key लीक हो जाए, OneUptime में एजेंट खोलकर उसकी key reset करें। पुरानी तुरंत काम करना बंद कर देती है। एजेंट container को नई key से update करके restart करें।

## अनुमतियाँ

एजेंट का प्रबंधन मौजूदा Runbooks permission group के अंतर्गत आता है:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — एजेंट records का प्रबंधन।
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (भूमिकाएँ) — किसी टीम को असाइन करें ताकि क्रमशः पूर्ण नियंत्रण, रोज़मर्रा उपयोग या केवल-पठन पहुँच मिले। `RunbookAdmin` ऊपर की सभी सूक्ष्म अनुमतियों को bundle करता है।

Runbook को _trigger_ करने (और इस तरह Bash व JavaScript steps dispatch करने) की अनुमतियाँ अभी भी `CreateRunbookExecution` / `EditRunbookExecution` हैं।

## एजेंट-facing API

जिज्ञासुओं के लिए — एजेंट `/runbook-agent-ingest` के अंतर्गत मौजूद इन endpoints का उपयोग करता है। ये JSON body में एजेंट ID + key (या `x-agent-id` / `x-agent-key` headers) से authenticate होते हैं।

| Endpoint                     | उद्देश्य                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `POST /heartbeat`            | जीवंतता; `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion` update करता है।                                          |
| `POST /claim-next-job`       | इस एजेंट की ID पर targeted सबसे पुराने `Pending` job को atomic रूप से claim करता है। कुछ न होने पर `{ job: null }` लौटाता है। |
| `POST /job/:jobId/heartbeat` | Job के lease को नवीनीकृत करता है। lease expire होने या job के terminal होने पर 404 लौटाता है।                                 |
| `POST /job/:jobId/result`    | अंतिम परिणाम submit करता है। अगर lease पहले ही किसी और के पास चला गया है तो ignore।                                           |

आपको इन्हें हाथ से कॉल करने की ज़रूरत नहीं — साथ आने वाला एजेंट यही करता है। ये यहाँ documented हैं ताकि अगर आपकी constraints हमारे एजेंट से न मेल खाएँ तो आप अपना एजेंट बना सकें।

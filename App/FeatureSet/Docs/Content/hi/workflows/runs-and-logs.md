# रन और लॉग

हर बार जब कोई workflow चलता है, OneUptime इस बात का एक record save करता है कि क्या हुआ — यह कब चला, यह काम कर पाया या नहीं, और हर block ने क्या किया। इस record को **run** कहा जाता है। Runs ही वह तरीका हैं जिससे आप पुष्टि करते हैं कि कोई workflow ठीक चला, किसी असफल run को debug करते हैं, और पिछली activity को देख पाते हैं।

## इन्हें कहाँ खोजें

| Page                        | आपको क्या दिखता है                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| **Workflows → Runs & Logs** | project के हर workflow का हर run। workflow name, status, और time से filter करें।                 |
| **Workflow → Runs & Logs**  | सिर्फ इस एक workflow के runs। इसमें workflow filter की जगह एक **Run ID** filter होता है।           |
| **एक single run**           | किसी run row पर मौजूद **View Logs** button से खोला जाता है — run rows खुद clickable नहीं हैं।    |

## Run statuses

| Status                              | इसका मतलब क्या है                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduled**                       | trigger चल गया और run किसी runner के लिए queue में है। आमतौर पर एक second का एक हिस्सा। अगर 5 मिनट बाद भी run scheduled ही है तो वह failed है — किसी ने इसे उठाया नहीं। |
| **Running**                         | workflow अभी चल रहा है। लंबे समय तक चलने वाले blocks run को इस state में बनाए रखते हैं।                                                                                |
| **Waiting**                         | run एक **Sleep** block पर रुका हुआ है और अपने-आप फिर से शुरू होगा। इंतज़ार करते समय यह किसी worker को नहीं पकड़े रखता।                                                    |
| **Executed**                        | run बिना fail हुए अंत तक पहुँच गया। (यही success state है — pill पर **Executed** लिखा होता है, "Success" नहीं।)                                                        |
| **Error**                           | run इसलिए रुका क्योंकि किसी block ने error raise किया। तब भी इस्तेमाल होता है जब कोई queued run कभी उठाया नहीं जाता, किसी sleeping run का resume खो जाता है, कोई schedule expression resolve नहीं हो पाता, या run के बीच में ही workflow disable हो जाता है। |
| **Timeout**                         | run allowed समय से ज़्यादा देर चला। देखें [Configuration & Safety](/docs/workflows/configuration)।                                                                      |
| **Execution Exceeded Current Plan** | project पिछले 30 दिनों के अपने workflow runs इस्तेमाल कर चुका है, या subscription unpaid है। run record हो जाता है लेकिन execute नहीं होता। सिर्फ OneUptime Cloud पर।    |

कोई block जो अपने **Error** output पर hand off करता है — जैसे कोई API block किसी 4xx पर — run को fail नहीं करता। error branch चलती है और run फिर भी **Executed** पर ही ख़त्म होता है। फिर भी वह step लाल रंग में दिखाया जाता है ताकि आप उसे ढूँढ सकें।

## एक run पढ़ना

किसी run को खोलने के लिए उस पर **View Logs** पर क्लिक करें। **Workflow Run** view में दो tabs होते हैं।

**Steps** — हर उस block के लिए एक row जो चला, उसी क्रम में। हर row block का title, उसका component id, इसमें कितना समय लगा, और यह किस output से बाहर निकला (`→ success`, `→ error`, `→ yes`) दिखाती है। details के दो blocks देखने के लिए किसी row को expand करें:

- **Received** — block को दी गई settings, सारे variables resolve होने के बाद।
- **Returned** — इसने क्या produce किया।

Failed steps लाल होते हैं और expanded शुरू होते हैं, जिनमें error message **Received** के ऊपर छपा होता है।

**Full Log** — runner द्वारा print किया गया raw line-by-line log, जिसमें blocks ने खुद जो कुछ log किया वह भी शामिल है। इसका इस्तेमाल तब करें जब Steps view failure को समझा न पाए।

दो बातें जानने लायक हैं। हर step के title के नीचे छपा component id ठीक वही string है जिसे किसी `{{local.components.<id>.returnValues.…}}` reference में paste करना है, जिससे कोई reference सही पाना सबसे तेज़ तरीका बन जाता है। और एक run अपने सिर्फ आख़िरी 100 steps ही रखता है — कोई लंबा या बार-बार resume हुआ run वहाँ एक amber note दिखाता है जहाँ पहले वाले steps drop हो गए थे।

दिखाए गए values वही हैं जो block ने variables भरे जाने के बाद देखे, सिवाय दो अपवादों के: secrets और वे fields जिन्हें block sensitive मार्क करता है redact कर दिए जाते हैं, और बहुत लंबी values "… (truncated)" के साथ छोटी कर दी जाती हैं।

**Builder** से run शुरू करना यही view खोलता है जो पहले से run को follow कर रहा होता है, ताकि आप इसे बाद में ढूँढने के बजाय होते हुए देख सकें।

## आम debugging

### "मेरा workflow नहीं चला।"

1. सुनिश्चित करें कि workflow इसके **Overview** page पर **Enabled** है। नए workflows disabled शुरू होते हैं, और कोई disabled workflow हर run को — manual runs समेत — reject करता है।
2. किसी OneUptime event trigger के लिए: पुष्टि करें कि event वाकई हुआ। record खोलें और उसकी history देखें।
3. किसी webhook trigger के लिए: पुष्टि करें कि दूसरा system सही URL पर भेज रहा है। ज़्यादातर tools webhook भेजने पर log करते हैं — वहाँ जाँचें।
4. किसी schedule trigger के लिए: पुष्टि करें कि cron expression उस समय से मेल खाता है जिसकी आपको उम्मीद है।

अगर run *दिखता* है लेकिन status **Execution Exceeded Current Plan** के साथ, तो project ने पिछले 30 दिनों के अपने सारे workflow runs इस्तेमाल कर लिए हैं, या subscription unpaid है। run का log count और आपके plan की limit दोनों बताता है। यह सिर्फ OneUptime Cloud पर लागू होता है।

### "एक बाद वाला block कभी नहीं चला।"

कोई block जो नहीं चलता आमतौर पर एक wiring problem होता है। **Builder** खोलें और जाँचें:

- क्या पहले वाले block का output इस block के input से जुड़ा है?
- क्या पहले वाले block ने वह output नहीं लिया जिसकी आपको उम्मीद थी — expected **Success** की जगह **Error**, या **Yes** की जगह **No**? Steps tab दिखाता है कि उसने कौन सा लिया।

### "एक variable खाली आ गया।"

run खोलें और failing step के **Received** block को देखें।

- अगर आपको literal `{{local.components.…}}` text दिखता है, तो reference resolve नहीं हुआ। आमतौर पर यह component id या return-value id में कोई typo है — याद रखें यह block का **Identifier** है, वह नाम नहीं जो उस पर दिखाया जाता है। `local.components` की spelling भी जाँचें: `{{local.componets.api-get-1.returnValues.response-body}}` literal text के रूप में भेजा जाता है और run फिर भी **Executed** report करता है।
- अगर आपको एक empty string दिखती है, तो पहले वाला block चला लेकिन उसने वह field produce नहीं की।

**Full Log** tab पर एक warning line होती है जो resolve न हुए किसी भी reference का नाम बताती है, जो आमतौर पर उसे ढूँढने का सबसे तेज़ तरीका है।

### "यह हाथ से चलाने पर काम करता है लेकिन trigger से नहीं।"

**Builder** खोलें, **Run Workflow** पर क्लिक करें, और trigger के fields उन values से भरें जो असली trigger जो भेजता है उसके जैसी दिखें। फिर उस run की **Received** values की असली run वाली values से side by side तुलना करें। फर्क आमतौर पर एक ही field का name या type होता है।

## किसी workflow को फिर से चलाना

कोई "retry this run" button नहीं है। हम पुराने executions को अपने-आप फिर से नहीं चलाते क्योंकि side effects — Slack messages, API calls, tickets — शायद दोबारा करना safe न हो। काम को दोबारा करने के लिए, workflow को ठीक करें और अगले असली trigger को इसे चलाने दें, या **Builder** खोलें और उन्हीं values के साथ **Run Workflow** पर क्लिक करें।

## Runs कितनी देर तक रखे जाते हैं?

OneUptime Cloud पर, runs **30 दिनों** तक रखे जाते हैं और फिर delete कर दिए जाते हैं — इसीलिए दोनों run lists खुद को पिछले 30 दिनों को cover करने वाला बताती हैं। Self-hosted installs runs को तब तक रखते हैं जब तक आप उन्हें delete नहीं करते; अगर कोई workflow बहुत बार चलता है और आपकी history को भर देता है, तो noise बढ़ाना रोकने के लिए इसे disable या delete करें।

Step tracing जुड़ने से पहले record हुए runs में कोई **Steps** content नहीं होता और सिर्फ उनका **Full Log** दिखता है।

## आगे क्या पढ़ें

- [Configuration & Safety](/docs/workflows/configuration) — timeouts, recursion limits, hidden secrets।
- [Variables](/docs/workflows/variables) — आपके blocks में इस्तेमाल होने वाला variable syntax।
- [Components](/docs/workflows/components) — हर block क्या produce करता है।

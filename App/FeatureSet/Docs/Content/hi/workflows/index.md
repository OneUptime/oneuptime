# Workflows Overview

Workflows आपको बिना code लिखे OneUptime में tasks को automate करने देते हैं। canvas पर कुछ blocks जोड़ें, उन्हें आपस में connect करें, और आपके पास एक ऐसा automation तैयार होता है जो हर बार कुछ होने पर चलता है — कोई incident खुलता है, कोई schedule fire होता है, या कोई दूसरा tool OneUptime को data भेजता है।

Workflows को अपने project के background helpers की तरह सोचें: ये events पर react करते हैं, दूसरे tools से बात करते हैं, और आपके काम पर ध्यान देते रहने के दौरान चीज़ों को चुपचाप sync रखते हैं।

## आप workflows से क्या कर सकते हैं

- **Connect OneUptime to your other tools** — incidents को Slack पर भेजें, Jira tickets बनाएं, अपने stack के किसी webhook पर post करें।
- **React to what happens in OneUptime** — जब कोई critical incident बनता है, तो on-call team को notify करें और अपने-आप एक ticket खोलें।
- **Run jobs on a schedule** — हर पाँच मिनट में, हर रात, हर सोमवार सुबह।
- **Receive data from outside** — दूसरे systems को एक unique URL के जरिए OneUptime में data push करने दें।
- **Reuse common automation** — इसे एक बार बनाएं, किसी भी दूसरे workflow से call करें।

## एक workflow कैसे काम करता है

हर workflow के तीन हिस्से होते हैं:

1. **A trigger** — जो workflow को शुरू करता है। यह एक manual button, एक schedule, एक incoming webhook, या OneUptime में कोई event (जैसे एक नया incident) हो सकता है।
2. **One or more components** — जो workflow करता है। एक message भेजें, एक HTTP call करें, एक quick check चलाएं, किसी condition के आधार पर branch करें।
3. **Connections between them** — order तय करने के लिए आप एक block से दूसरे तक lines खींचते हैं।

यह सब आप canvas पर visually बनाते हैं। ज्यादातर workflows के लिए coding की जरूरत नहीं है, हालांकि जब जरूरत हो तो आप JavaScript का एक snippet जोड़ सकते हैं।

## मुख्य शब्द

| Term                 | इसका मतलब                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------- |
| **Workflow**         | पूरा automation — एक नाम, एक canvas, और इसे on या off करने के लिए एक switch।                      |
| **Trigger**          | पहला block। यह तय करता है कि workflow कब चलता है। हर workflow में ठीक एक trigger होता है।              |
| **Component**        | एक action block — यह एक message भेजता है, एक request करता है, एक condition check करता है।             |
| **Run**              | workflow का एक execution। timestamps और हर block के output के साथ save किया जाता है।                |
| **Global variable**  | एक value (जैसे एक API key) जिसे आप एक बार save करते हैं और किसी भी workflow में reuse करते हैं।         |

## OneUptime में workflows कहाँ मिलेंगे

left navigation में **Workflows** खोलें। इस section में ये होता है:

- **Workflows** — आपके workflows की सूची। नया बनाएं या किसी मौजूदा को खोलें।
- **Global Variables** — वे values जो आपके सभी workflows में shared होती हैं।
- **Runs & Logs** — आपके project के हर workflow की execution history।

एक अकेला workflow खोलें और उसका खुद का left menu इस तरह दिखता है:

- **Overview** — नाम, description, labels, और **Enabled** switch।
- **Builder** — वह canvas जहाँ आप workflow design करते हैं।
- **Workflow Variables** — वे values जो सिर्फ इसी एक workflow तक scoped हैं।
- **Runs & Logs** — इस workflow का हर run, details के साथ।
- **Settings** — webhook secret, duplicate, और export।

## अपना पहला workflow बनाना

1. **Create** — एक starting point चुनें, फिर अपने workflow को एक नाम दें।
2. **Pick a trigger** — manual, scheduled, webhook, या OneUptime से कोई event।
3. **Add components** — canvas पर actions जोड़ें और उन्हें connect करें।
4. **Turn it on** — **Overview** page से **Enabled** को on करें। एक disabled workflow बिल्कुल भी नहीं चल सकता, हाथ से भी नहीं।
5. **Test** — Builder पर **Run Workflow** पर क्लिक करें और run log देखें।

## एक जल्दी सा example

मान लीजिए आप चाहते हैं कि जब भी कोई critical incident बने तो Slack पर एक post हो जाए:

1. "Critical incidents to Slack" नाम का एक workflow बनाएं।
2. **On Create Incident** trigger चुनें।
3. एक **If / Else** block जोड़ें। इसे यह check करने के लिए set करें कि incident के title में "Sev 1" है या नहीं।
4. **Yes** branch से, एक **Slack** block जोड़ें। channel चुनें और message लिखें।
5. workflow को on करें।

अगली बार जब कोई "Sev 1" title वाला incident खोलेगा, तो Slack पर तुरंत सूचना पहुँच जाएगी।

## Workflows बाकी OneUptime के साथ कैसे fit होते हैं

- **Monitors** समस्या को पहचानते हैं। **Incidents** उसे record करते हैं। **Workflows** उस पर react करते हैं।
- **Runbooks** लोगों के लिए step-by-step guides हैं। Workflows unattended automation हैं। जब किसी इंसान को decisions लेने हों तो runbook का उपयोग करें; जब steps automatic हों तो workflow का उपयोग करें।
- **Workspace connections** (Slack, Teams) वे जगहें हैं जहाँ workflows अपने messages भेजते हैं।

## आगे क्या पढ़ें

- [Authoring a Workflow](/docs/workflows/authoring) — canvas पर building करना।
- [Triggers](/docs/workflows/triggers) — जिन अलग-अलग तरीकों से एक workflow शुरू हो सकता है।
- [Components](/docs/workflows/components) — जो building blocks आप जोड़ सकते हैं।
- [Variables](/docs/workflows/variables) — blocks और workflows के बीच values का उपयोग करना।
- [Runs & Logs](/docs/workflows/runs-and-logs) — यह देखना कि क्या हुआ।
- [Configuration & Safety](/docs/workflows/configuration) — जानने लायक settings।

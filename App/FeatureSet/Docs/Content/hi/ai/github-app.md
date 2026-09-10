# GitHub से OneUptime के साथ काम करना

OneUptime GitHub App सिर्फ़ आपके code तक का एक connection नहीं है — आप अपनी repository में ही इससे बात कर सकते हैं, और यह काम वहीं कर देता है।

किसी issue पर इसे mention करें और यह एक pull request खोल देता है। किसी pull request पर mention करें और यह उसी branch को revise कर देता है, या diff का review कर देता है। किसी issue पर label लगाएँ और यह उस issue को उठा लेता है। यह जो कुछ भी बनाता है वह एक pull request या एक review होता है जिसे कोई इंसान पढ़ता है: **यह कभी merge नहीं करता, और कभी किसी pull request को approve नहीं करता।**

```text
@oneuptime implement this                          →  एक pull request जो issue को बंद कर देता है
@oneuptime revise this — use exponential backoff   →  इसी pull request की अपनी branch पर नए commits
@oneuptime review                                  →  इस pull request पर पोस्ट किया गया एक code review
```

> `@oneuptime` की जगह अपने app का अपना handle लिखें। OneUptime Cloud पर यह `@oneuptime` ही है। Self-hosted instance पर यह वही नाम है जो आपने अपने GitHub App को दिया था — lowercase में, और spaces की जगह hyphens के साथ; "Acme AI" नाम वाले app को `@acme-ai` लिखकर mention किया जाता है। अगर mention करने पर कुछ नहीं होता, तो सबसे पहले यही जाँचें।

## शुरू करने से पहले

- repository का GitHub App के ज़रिए **किसी OneUptime project से connected** होना ज़रूरी है। Setup के लिए [GitHub Integration (self-hosted)](/docs/self-hosted/github-integration) देखें, या OneUptime Cloud पर **प्रोजेक्ट सेटिंग्स → कोड रिपॉजिटरी** से इसे connect करें।
- **"AI कोड सुधार चलाता है" capability वाला एक Runner** online होना चाहिए — वही Runner जो [AI Fix Tasks](/docs/ai/ai-agent) पूरे करता है। इसके बिना commands स्वीकार तो हो जाते हैं, लेकिन 30 मिनट बाद इस संदेश के साथ fail हो जाते हैं कि किसी agent ने उन्हें उठाया ही नहीं।
- GitHub App के पास **Issues: Read & write** permission होनी चाहिए, और उसे [किन events को subscribe करना है](#किन-events-को-subscribe-करना-है) में दिए गए webhook events subscribe होने चाहिए।

## Commands

हर command app के एक mention से शुरू होता है। mention comment में कहीं भी हो सकता है, और उसके बाद आप जो कुछ लिखते हैं वह आपके अनुरोध के रूप में आगे भेज दिया जाता है।

### किसी pull request पर

| कमांड | क्या होता है |
| --- | --- |
| `@oneuptime review` | branch clone करता है, बदले हुए code **और उसके आस-पास के code** को पढ़ता है, और comment के रूप में एक review पोस्ट करता है। कुछ भी बदलता नहीं। |
| `@oneuptime revise this — <आप जो बदलवाना चाहते हैं>` | pull request की अपनी branch clone करता है, बदलाव करता है, और उसी branch पर नए commits push करता है। दूसरा pull request कभी नहीं खोलता। |

mention के बाद आप जो कुछ लिखते हैं और जो कोई पहचाना हुआ command नहीं है, उसे revision request मान लिया जाता है — क्योंकि लगभग हमेशा वही होता है:

```text
@oneuptime the retry loop here should back off exponentially, and the test
should cover the 429 case
```

### किसी issue पर

| कमांड | क्या होता है |
| --- | --- |
| `@oneuptime implement this` | issue पर काम करता है और एक pull request खोलता है जो उसे बंद कर देता है। |
| `@oneuptime <और कुछ भी>` | वही, आपके शब्द अतिरिक्त निर्देश के रूप में लेकर। |

आप app को कोई issue **बिना कोई comment लिखे** भी सौंप सकते हैं:

- **trigger label लगाएँ।** किसी issue पर repository का trigger label — डिफ़ॉल्ट रूप से `oneuptime` — लगाने से वही काम शुरू हो जाता है। GitHub की UI से काम सौंपने का यह सबसे भरोसेमंद तरीका है।
- **issue को app के bot user को assign करें**, जहाँ आपकी repository इसकी अनुमति देती है। GitHub हर जगह किसी app को assignee नहीं बनने देता — label इसीलिए मौजूद है; अगर assign करने से कुछ न हो, तो label इस्तेमाल करें।

### कहीं भी

| कमांड | क्या होता है |
| --- | --- |
| `@oneuptime help` | commands की सूची देता है। बिना कुछ लिखे सिर्फ़ mention करने पर भी यही होता है। |
| `@oneuptime status` | बताता है कि इस thread में यह अभी किस काम पर लगा है। |
| `@oneuptime cancel` | इस thread में इसके चल रहे runs रोक देता है। जो काम push हो चुका है वह push ही रहता है। |

`help`, `status` और `cancel` कभी agent run शुरू नहीं करते, इसलिए इनकी कोई लागत नहीं है और ये आपके रोज़ाना के fix-task बजट में नहीं गिने जाते।

## यह thread में कैसा दिखता है

एक command से **एक ही comment** बनता है, जिसे काम आगे बढ़ने के साथ app खुद edit करता रहता है — इसलिए लंबा चलने वाला काम किसी pull request को status log में नहीं बदल देता।

1. यह आपके comment पर 👀 react करता है, और एक acknowledgement पोस्ट करता है जिसमें उस OneUptime project का नाम होता है जिससे run जुड़ा है और live run का link होता है।
2. काम पूरा होने पर वही comment नतीजे के साथ दोबारा लिख दिया जाता है: उसने जो pull request खोला, जो commits push किए, या ईमानदारी से यह बताना कि उसने कुछ क्यों नहीं किया।

अगर उसे बदलने लायक कुछ नहीं मिलता, तो वह अटकल पर pull request खोलने के बजाय यही कह देता है। यह सामान्य नतीजा है, विफलता नहीं — उसे और स्पष्ट निर्देश दें और दोबारा कहें।

## इसे command कौन दे सकता है

**सिर्फ़ वे लोग जिनके पास repository का write, maintain या admin access है।** OneUptime हर बार GitHub से सीधे पूछता है कि comment करने वाले के पास उस repository पर क्या permission है; वह comment के बगल में GitHub द्वारा दिखाए गए "contributor" बैज पर भरोसा नहीं करता, क्योंकि वह बैज मौजूदा access नहीं, बल्कि पुरानी गतिविधि बताता है।

किसी और के mention पर उसके comment पर सिर्फ़ एक 😕 reaction मिलता है, और कुछ नहीं। यह जानबूझकर है: किसी public repository पर कोई भी comment कर सकता है, और जो app अजनबियों को भरोसे से जवाब देता है, उसका इस्तेमाल किसी thread में spam करने के लिए किया जा सकता है।

यह हर उस comment को भी नज़रअंदाज़ करता है जो किसी bot ने लिखा हो — अपने खुद के comments समेत — और quote (`>`) या code block के अंदर आए mentions को command नहीं मानता। ये दो नियम मिलकर ही इसके अपने किसी comment के जवाब से इसे दोबारा चालू होने से रोकते हैं।

## यह क्या नहीं करेगा

- **यह कभी merge नहीं करता।** यह app जो कुछ भी करता है, उससे आपकी default branch पर code नहीं पहुँच सकता।
- **यह कभी approve या request changes नहीं करता।** Reviews comments के रूप में पोस्ट होते हैं, इसलिए किसी app का review कभी किसी branch protection rule को पूरा नहीं कर सकता।
- **यह कभी history दोबारा नहीं लिखता।** Revision commits जोड़ता है; force-push नहीं करता। अगर किसी और ने उस branch पर पहले push कर दिया है, तो revision उसका काम मिटाने के बजाय fail हो जाता है।
- **यह किसी fork से आए pull request को revise नहीं कर सकता।** Fork की branch ऐसी repository में होती है जिसमें installation लिख नहीं सकता। ऐसे pull request का review फिर भी होगा — उससे review करने को कहें।
- **यह किसी pull request का title, description या target branch कभी नहीं बदलता।** सिर्फ़ code।

## इसकी लागत क्या है, और इसे कैसे सीमित रखें

काम शुरू करने वाला हर command एक पूरा agent run है — एक clone, अधिकतम 40 LLM calls और 100,000 output tokens, और अगर आपने अपनी repository के build और test commands configure किए हैं तो वे भी।

दो सीमाएँ लागू होती हैं, और दोनों वही हैं जो पहले से [AI Fix Tasks](/docs/ai/ai-agent) पर लागू होती हैं:

- **project की रोज़ाना fix-run सीमा** (**प्रोजेक्ट सेटिंग्स → एआई**, डिफ़ॉल्ट रूप से 25/दिन)। GitHub commands यह बजट आपके project के बाकी fix runs के साथ साझा करते हैं।
- **हर repository के लिए खुले pull requests की अधिकतम संख्या** (**कोड रिपॉजिटरी → वह repository → सेटिंग्स**, डिफ़ॉल्ट 5)। Reviews और revisions इससे छूट पर हैं: दोनों में से कोई भी आपकी review queue में नया pull request नहीं जोड़ता।

किसी एक issue या pull request पर एक समय में एक ही तरह का एक ही run चलता है। दोबारा कहने पर यह बता देता है कि वह पहले से काम कर रहा है; revision चलते समय review माँगने पर दोनों शुरू हो जाते हैं, क्योंकि वे अलग-अलग requests हैं।

अगर कोई run शुरू नहीं हो पाता, तो app thread में कारण बता देता है — यह कभी चुपचाप fail नहीं होता।

## इसे बंद करना

हर repository के लिए अलग से: **कोड रिपॉजिटरी → वह repository → सेटिंग्स → Respond to GitHub Commands**। इसके बंद होने पर app उस repository में mentions, assignments और trigger label को नज़रअंदाज़ करता है, और जो कोई उससे कुछ कहे उसे बता देता है कि यह switch कहाँ है।

अगर आप `oneuptime` के अलावा कुछ और चाहते हैं, तो उसी पेज पर **GitHub Trigger Label** भी है।

## किन events को subscribe करना है

अपने GitHub App की **Permissions & events** settings में इन्हें subscribe करें:

| Event | किस लिए ज़रूरी है |
| --- | --- |
| **Issue comment** | issues *और* pull requests, दोनों पर `@mention` commands |
| **Issues** | app को issue assign करना, और trigger label |
| **Pull request** | app से review का अनुरोध |
| **Pull request review** | submit किए गए review के मुख्य text में mention |
| **Pull request review comment** | diff पर किसी inline comment में mention |

और **Repository permissions** के अंतर्गत **Issues** को **Read & write** होना चाहिए — GitHub, pull request की conversation comments issues API से देता है, इसलिए यही वह permission है जो app को pull requests पर भी comment करने देती है।

## Prompt injection: क्या सुरक्षित है और क्या नहीं

Issue का text, pull request के descriptions, diffs और comments — ये सब agent के prompt का हिस्सा बनते हैं, और किसी public repository पर इन्हें कोई भी लिख सकता है। "अपने निर्देश भूल जाओ और X करो" जैसा text किसी issue में मिलना पूरी तरह संभव है।

दो चीज़ें इसे सीमित रखती हैं, और यह जानना ज़रूरी है कि इनमें से कौन-सी क्या करती है:

- **Prompts भरोसे लायक न होने वाले text को निर्देश नहीं, बल्कि एक अनुरोध के रूप में चिह्नित करते हैं**, और run की repository, branch और pull request agent के शुरू होने से पहले ही तय हो जाते हैं — agent जो कुछ पढ़ता है, उससे यह नहीं बदल सकता कि वह किस पर काम कर रहा है।
- **असली रोक sandbox है।** Agent आपके Runner पर, एक disposable clone में चलता है, उसके command environment से credentials हटा दिए जाते हैं और उसके git operations सीमित होते हैं। वह सिर्फ़ किसी branch पर push ही कर सकता है, और merge सिर्फ़ कोई इंसान कर सकता है।

AI के लिखे pull request को वैसे ही लें जैसे किसी नए contributor के pull request को लेते जिसने issue पढ़ा हो: description नहीं, diff review करें।

## समस्या निवारण

**mention करने पर कुछ नहीं होता।** पहले handle जाँचें — वह app का slug है, उसका display name नहीं। फिर जाँचें कि repository किसी project से connected है (**प्रोजेक्ट सेटिंग्स → कोड रिपॉजिटरी**), **Respond to GitHub Commands** चालू है, और आपका GitHub App ऊपर बताए गए events को subscribe किए हुए है।

**यह 😕 react करता है और कुछ कहता नहीं।** आपके पास repository का write access नहीं है।

**यह कहता है कि वह पहले से इस पर काम कर रहा है।** इस issue या pull request पर उस तरह का एक run पहले से चल रहा है। `@oneuptime status` बताएगा कि कौन-सा, और `@oneuptime cancel` उसे रोक देगा।

**इसने acknowledge किया और फिर लंबे समय तक चुप रहा।** **सेटिंग्स → Runbook एजेंट** में जाँचें कि **AI कोड सुधार चलाता है** वाला कोई Runner online है। इसके बिना run 30 मिनट बाद fail कर दिया जाता है और thread में यह बता दिया जाता है।

**यह कहता है कि pull request किसी fork से आया है।** Revisions के लिए branch इसी repository में होनी चाहिए। इसके बजाय review माँगें, या branch यहाँ push करें।

## आगे क्या पढ़ें

- [AI Fix Tasks](/docs/ai/ai-agent) — वही agent, GitHub से नहीं बल्कि किसी exception से trigger होकर।
- [GitHub Integration (self-hosted)](/docs/self-hosted/github-integration) — GitHub App बनाना और configure करना।
- [Runbook एजेंट](/docs/runbooks/agents) — वह worker जो इन runs को अंजाम देता है।

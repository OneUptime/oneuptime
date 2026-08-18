# Authoring a Workflow

एक workflow बनाने के लिए, **Workflows** खोलें और **Create Workflow** पर क्लिक करें। **Create a workflow** नाम का एक wizard आपको इसमें से गुजारता है: पहले **Start from** — **Start from scratch** या किसी template में से चुनें — फिर **Name**, और आखिर में एक **Configure** step, जो सिर्फ तब दिखता है जब आपने चुना हुआ template अपनी खुद की settings मांगता है।

बन जाने के बाद, left menu में **Builder** खोलें। यही वह canvas है जहाँ आप workflow design करते हैं।

## Canvas

एक scratch से बना workflow एक अकेले dashed block के साथ खुलता है जिस पर लिखा होता है **Please click here to add trigger**। वह block starting point है — trigger चुनने के लिए इस पर क्लिक करें। किसी template से बनाया गया workflow अपने blocks पहले से जगह पर लिए हुए खुलता है।

हर workflow में सबसे ऊपर ठीक एक **trigger** होता है। बाकी सब कुछ एक **component** होता है जो कुछ करता है। दूसरा trigger जोड़ना पहले वाले की जगह ले लेता है, और आखिरी को delete करने पर dashed placeholder वापस आ जाता है।

Blocks जोड़ना:

- **The trigger** — dashed placeholder block पर क्लिक करें। **Add Trigger** शीर्षक वाला एक panel खुलता है।
- **Everything else** — canvas के ऊपर toolbar में **Add Component** पर क्लिक करें। वही panel खुलता है, इस बार **Add Component** शीर्षक के साथ।

दोनों panels searchable हैं — search box पर जाने के लिए `/` दबाएं — और category के हिसाब से grouped हैं। एक block select करें और **Add to Workflow** पर क्लिक करें।

नए blocks हमेशा canvas पर एक ही जगह आकर गिरते हैं, इसलिए कोई नया block पहले से रखी किसी चीज़ के ऊपर आ सकता है। इसे खींचकर हटाएं; जैसे-जैसे आप करते हैं canvas एक grid पर snap होता जाता है। Block positions save होती हैं, इसलिए अगला व्यक्ति वही arrangement देखता है जो आपने छोड़ा था।

Changes automatically save होते हैं। toolbar में एक pill इसे track करता है: change चलते समय **Saving…**, फिर **Saved**, या अगर काम नहीं बना तो **Could not save**। कोई Save button नहीं है और कोई अलग publish step नहीं है।

## एक block पर क्या होता है

| Field                          | यह क्या करता है                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (**ID** के नीचे) | block पर दिखने वाला short id, जैसे `log-1`। इसी से बाकी blocks इसका reference देते हैं, इसलिए इसका नाम बदलना इस पर point करने वाले हर `{{local.components.…}}` reference को तोड़ देता है। block की heading component का खुद का नाम है और बदली नहीं जा सकती। |
| **Settings**                    | block को अपना काम करने के लिए जिस चीज़ की जरूरत है — एक URL, एक Slack channel, एक message body। Optional fields **(Optional)** के रूप में label होते हैं; बाकी सब required है। कम इस्तेमाल होने वाली settings एक **Advanced** disclosure के पीछे रहती हैं। |
| **Input**                       | ऊपरी edge पर वह dot, जहाँ पहले वाले blocks से lines आती हैं। Triggers के पास यह नहीं होता — उनसे पहले कुछ नहीं चलता।                                                              |
| **Outputs**                     | नीचे की edge पर मौजूद dots, जिनके ऊपर उनका label होता है, जहाँ से lines अगले blocks की ओर जाती हैं। कई blocks के अलग **Success** और **Error** outputs होते हैं ताकि आप दोनों cases handle कर सकें। |

## Blocks को connect करना

एक block के नीचे मौजूद dot से खींचकर अगले block के ऊपर वाले dot तक ले जाएं। जो line आप खींचते हैं वह तय करती है कि आगे क्या चलेगा।

- अगर आप **Success** से connect करते हैं, तो अगला block तभी चलता है जब पहला वाला काम कर गया हो।
- अगर आप **Error** से connect करते हैं, तो अगला block तभी चलता है जब पहला वाला fail हो गया हो।
- अगर आप किसी output को connect नहीं करते, तो वह path वहीं रुक जाता है।

आप एक output को कई blocks से connect कर सकते हैं। वे सभी चलते हैं — लेकिन एक के बाद एक, एक ही queue में, parallel में नहीं। branches के बीच order पर भरोसा न करें, और यह उम्मीद न करें कि वे समय में overlap करेंगे। हर block एक run में ज्यादा से ज्यादा एक बार चलता है, इसलिए किसी पहले वाले block पर वापस जाने वाला loop उसे दो बार नहीं चलाएगा।

## एक block को configure करना

किसी block पर क्लिक करने पर उसकी settings एक dialog में खुलती हैं। हर setting के पास सही तरह का input होता है — text fields, dropdowns, code editors, toggles, वगैरह। इसे भरें और **Save** पर क्लिक करें।

यही dialog वह जगह है जहाँ आपको मिलता है:

- **Delete** — इस block को हटाएं।
- **Run just this step** — बाकी workflow के बिना, सिर्फ इस एक block को अपने-आप चलाएं। जो values यह दूसरे steps से पढ़ता, वे खाली आती हैं, और जो कुछ भी यह भेजता है, लिखता है या delete करता है वह वाकई होता है।
- **Documentation**, **Inputs**, **Outputs** और **Returns** — यह block क्या उम्मीद करता है और क्या produce करता है, इसके reference cards।

ज्यादातर text fields variables accept करते हैं — इसी तरह data एक block से दूसरे तक बहता है। syntax हाथ से type करने के बजाय, editor में मौजूद value picker का उपयोग करें: यह आपके चुने गए block और field से एक सही reference बना देता है। [Variables](/docs/workflows/variables) देखें।

## आप जैसे-जैसे बनाते हैं, checks होते रहते हैं

Builder हर बार जब आप इसे बदलते हैं तो पूरे graph को check करता है, और toolbar में एक pill में अपने findings बताता है। pill पर क्लिक करके **Problems with this workflow** खोलें, जो हर issue को सूचीबद्ध करता है और आपको जिम्मेदार block तक ले जाता है। किसी problem वाले blocks पर canvas पर एक red badge भी होता है।

यह उन गलतियों को पकड़ता है जो वरना किसी run के गलत होने तक invisible रहतीं — कोई trigger नहीं, दो blocks एक id share कर रहे हैं, किसी id के अंदर एक dot, कोई block जिससे कुछ भी connect नहीं है, खाली छोड़ी गई एक required setting, malformed JSON, `{{ }}` के अंदर spaces, और किसी ऐसे step या return value का reference जो मौजूद ही नहीं है।

एक चीज़ जो यह check नहीं कर सकता: क्या कोई variable name मौजूद है। एक renamed variable सिर्फ run log में दिखता है।

## आपका पहला workflow

canvas को महसूस करने का सबसे तेज़ तरीका:

1. dashed placeholder block पर क्लिक करें, **Add Trigger** panel में **Manual** चुनें, और **Add to Workflow** पर क्लिक करें।
2. **Add Component** पर क्लिक करें, (**Utils** के अंतर्गत) **Log** चुनें, और **Add to Workflow** पर क्लिक करें। नए block को trigger से हटाकर खींचें, फिर trigger के **Execute** dot को नीचे Log block के input dot से connect करें।
3. Log block खोलें और इसका **Value** सेट करें `Hello from {{local.components.manual-1.returnValues.value.name}}`। `manual-1` trigger का **Identifier** है, जो trigger block पर दिखता है — check करें कि यह मेल खाता है।
4. **Overview** पर जाएं, **Workflow Details** card पर **Edit Workflow** पर क्लिक करें, और **Enabled** on करें। एक disabled workflow बिल्कुल भी नहीं चल सकता, हाथ से भी नहीं।
5. वापस **Builder** पर, **Run Workflow** पर क्लिक करें, **JSON** field में `{ "name": "Ada" }` डालें, **Run Workflow Manually** पर क्लिक करें, और **Run** से confirm करें।
6. एक **Workflow Run** panel अपने-आप खुलता है और run को follow करता है। log में `Value:` के बाद `Hello from Ada` दिखता है।

वह cycle — add, connect, configure, run, log पढ़ना — इसी तरह आप हर workflow बनाएंगे।

## इसे on करना

नए workflows disabled शुरू होते हैं, और आपके duplicate या import किए गए किसी भी workflow के साथ भी यही होता है।

**Enabled** switch workflow के **Overview** page पर है, **Workflow Details** card में — Settings page पर नहीं। वही card मौजूदा state को एक हरे **Enabled** या लाल **Disabled** pill के रूप में दिखाता है।

एक disabled workflow बिल्कुल भी नहीं चल सकता। Manual runs को ठीक trigger किए गए runs की तरह "This workflow is not enabled" कहकर reject कर दिया जाता है, इसलिए order यह है: इसे enable करें, **Run Workflow** से इसे test करें, run log पढ़ें, और अगर आप इसके trigger को fire होने देने के लिए तैयार नहीं हैं तो **Enabled** को वापस off कर दें। पूरे workflow को चलाए बिना किसी एक block को test करने के लिए, उस block की settings में **Run just this step** का उपयोग करें।

किसी workflow को delete किए बिना pause करने के लिए, **Enabled** को off करें। कोई नया run शुरू नहीं होता। जो run mid-execution में है वह पूरा होता है, लेकिन कोई एक जो **Sleep** block पर parked है वह जागने पर cancel कर दिया जाता है और एक error के रूप में record होता है।

## साफ-सफाई

- Blocks को move करने के लिए खींचें। layout save होता है।
- किसी line को delete करने के लिए, इसके किसी एक end को dot से खींचकर खाली canvas पर छोड़ दें।
- किसी block को delete करने के लिए, इस पर क्लिक करें और इसकी settings dialog के नीचे मौजूद **Delete** का उपयोग करें। किसी block या line को select करके Backspace दबाना भी इसे हटा देता है।
- किसी एक block को duplicate करने का कोई तरीका नहीं है। workflow के **Settings** page पर **Duplicate Workflow** पूरी चीज़ copy करता है, और copy disabled होकर आती है।
- Blocks को ऊपर से नीचे stack करें ताकि वे उसी दिशा में पढ़े जाएं जिस दिशा में वे चलते हैं — inputs ऊपरी edge पर हैं, outputs नीचे की edge पर, इसलिए flow स्वाभाविक रूप से नीचे की ओर जाता है।

## आगे क्या पढ़ें

- [Triggers](/docs/workflows/triggers) — जिन चार तरीकों से एक workflow शुरू हो सकता है।
- [Components](/docs/workflows/components) — वह हर block जिसे आप जोड़ सकते हैं।
- [Variables](/docs/workflows/variables) — blocks के बीच data move करना।
- [Runs & Logs](/docs/workflows/runs-and-logs) — यह देखना कि क्या हुआ।

# Global SSO (Instance-wide Single Sign-On)

Global SSO एक OneUptime **instance administrator** (master admin) को एक ही SAML 2.0 या OpenID Connect (OIDC) identity provider को **instance स्तर पर एक बार** configure करने और उसे server पर किसी भी project से connect करने की अनुमति देता है। यह per-project SSO का instance-wide समकक्ष है: प्रत्येक project owner द्वारा अपना अलग identity provider configure करने के बजाय, एक master admin एक ऐसा provider सेट करता है जो पूरे instance को सेवा दे सकता है।

Global SSO एक **OneUptime Enterprise Edition** feature है और केवल उन instances पर उपलब्ध है जो Enterprise Edition build चला रहे हैं।

## Global SSO vs. Project SSO

| | Project SSO | Global SSO |
|---|---|---|
| किसके द्वारा configured | Project owner/admin (Project Settings) | Instance master admin (Admin Dashboard) |
| Scope | एक single project | पूरा instance — किसी भी project से connectable |
| Sign-in परिणाम | उस एक project तक access | उपयोगकर्ता जिस भी project तक पहुँच सकता है, उन सभी तक access |

## Global SSO सेट अप करना

1. **Admin Dashboard खोलें**
   - master admin के रूप में sign in करें और **Admin** > **Settings** > **Global SSO** (SAML के लिए) या **Global OIDC** (OpenID Connect के लिए) खोलें।

2. **एक provider बनाएं**
   - **Create Global SSO** पर क्लिक करें।
   - SAML के लिए: एक **Name**, अपने identity provider से **Sign On URL** और **Issuer** दर्ज करें, और **Public Certificate** paste करें। **Signature** और **Digest** methods चुनें (यदि आप अनिश्चित हैं तो defaults — `RSA-SHA256` / `SHA256` — रहने दें)।
   - OIDC के लिए: **Discovery URL**, **Issuer**, **Client ID**, **Client Secret**, **Scopes** (इनमें `openid` शामिल होना चाहिए), और **email** / **name** claim names दर्ज करें।

3. **OneUptime URLs को अपने identity provider में copy करें**
   - provider खोलें (list में उसकी row पर क्लिक करें) ताकि **Identity Provider URLs** card दिखाई दे।
   - SAML के लिए, **ACS URL (Reply URL)** और **Issuer (Entity ID)** को अपने IdP (Okta, Azure AD, OneLogin, JumpCloud और अन्य) में copy करें।
   - OIDC के लिए, **Redirect URI** को अपने IdP की allowed redirect list में copy करें।

4. **provider को test करें**
   - अपने identity provider के माध्यम से end-to-end sign-in चलाने के लिए provider के page पर **Test this SSO provider** link का उपयोग करें। link के काम करने के लिए provider **enabled** होना चाहिए। किसी global provider को enable करने से login page पर केवल एक "Sign in with SSO" option जुड़ता है — यह कभी भी SSO को बाध्य नहीं करता या किसी को बाहर lock नहीं करता, इसलिए इसे enable करना, test करना, और ज़रूरत होने पर फिर से disable करना सुरक्षित है।

## उपयोगकर्ता कैसे Sign In करते हैं

किसी global provider का व्यवहार इस पर निर्भर करता है कि आप उससे कोई projects attach करते हैं या नहीं:

- **कोई project attached नहीं (default-all / invite-first):** उपयोगकर्ता provider से sign in कर सकते हैं और **किसी भी ऐसे project तक पहुँच सकते हैं जिसके वे पहले से ही member हैं**। नए उपयोगकर्ता स्वतः **नहीं** बनाए जाते — किसी उपयोगकर्ता को पहले किसी project में invite किया जाना चाहिए। इसका उपयोग company-wide SSO के लिए करें जहाँ memberships कहीं और प्रबंधित की जाती हैं।

- **Projects attached (auto-provisioning):** provider खोलें और एक या अधिक projects attach करने के लिए **Attached Projects** table का उपयोग करें, प्रत्येक के लिए default teams के एक set के साथ। जो उपयोगकर्ता sign in करते हैं वे पहले login पर उन projects में **auto-provisioned** हो जाते हैं और default teams में जुड़ जाते हैं। list बनाने के लिए एक बार में एक project + teams जोड़ें; किसी attachment को बदलने के लिए, उसे delete करें और फिर से जोड़ें।

यदि आप चाहते हैं कि projects attached होने पर भी किसी automatic account creation को रोका जाए, तो provider पर **Disable Sign Up with SSO** enable करें — फिर उपयोगकर्ताओं को sign in करने से पहले invite किया जाना चाहिए।

## SSO को Enforce करना

किसी global provider को configure करना किसी को भी इसका उपयोग करने के लिए बाध्य नहीं करता; password login अभी भी काम करता है। SSO को आवश्यक बनाने के लिए, **Require SSO for Login** controls का उपयोग करें:

- **प्रति project:** एक project SSO को आवश्यक कर सकता है, और वैकल्पिक रूप से एक *specific* provider (project या global) को आवश्यक कर सकता है।
- **Instance-wide:** **Admin** > **Settings** > **Authentication** में एक **Require SSO for Login** toggle है जो instance भर में प्रत्येक उपयोगकर्ता के लिए SSO को बाध्य करता है। Master admins exempt रहते हैं ताकि उन्हें बाहर lock न किया जा सके।

## संबंधित

- [SSO (Project SSO)](/docs/identity/sso)
- [SCIM](/docs/identity/scim)

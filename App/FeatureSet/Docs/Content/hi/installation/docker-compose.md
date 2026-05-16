# Docker Compose के साथ OneUptime को पूरी तरह मुफ्त deploy करें

यदि आप OneUptime को अपने स्वयं के server पर host करना पसंद करते हैं, तो आप Debian, Ubuntu या RHEL पर OneUptime का single-server instance deploy करने के लिए Docker Compose का उपयोग कर सकते हैं। यह विकल्प आपके instance पर अधिक नियंत्रण और अनुकूलन देता है, लेकिन इसे deploy और बनाए रखने के लिए अधिक technical skills और resources की आवश्यकता होती है।

#### अपनी System Requirements चुनें
आपके उपयोग और बजट के आधार पर, आप अपने server के लिए अलग-अलग system requirements चुन सकते हैं। इष्टतम प्रदर्शन के लिए, हम OneUptime को इसके साथ उपयोग करने का सुझाव देते हैं:

- **अनुशंसित System Requirements**
  - 16GB RAM
  - 8 Core
  - 400 GB Disk
  - Ubuntu 22.04
  - Docker और Docker Compose इंस्टॉल
- **Homelab / न्यूनतम Requirements**
  - यदि आप home environment में personal या experimental उपयोग के लिए OneUptime चलाना चाहते हैं (हमारे कुछ users के पास RaspberryPi पर भी installed है), तो आप homelab requirements उपयोग कर सकते हैं:
    - 8 GB RAM
    - 4 Core
    - 20 GB Disk
    - Docker और Docker Compose इंस्टॉल


#### Single-Server Deployment के लिए पूर्व आवश्यकताएं

Installation tutorial: [https://youtu.be/j1SWmMW2oL4](https://youtu.be/j1SWmMW2oL4)

deployment process शुरू करने से पहले, सुनिश्चित करें कि आपके पास है:

- Debian, Ubuntu या RHEL derivative चलाने वाला एक server
- आपके server पर Docker और Docker Compose इंस्टॉल

OneUptime install करने के लिए: 

```
# केवल release branch के साथ इस repo clone करें और उसमें cd करें।
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# config.example.env को config.env पर Copy करें
cp config.example.env config.env

# महत्वपूर्ण: config.env फ़ाइल संपादित करें। सुनिश्चित करें कि आपके पास random secrets हैं।

npm start
```

यदि आप npm उपयोग करना पसंद नहीं करते या यह installed नहीं है, तो इसके बजाय यह चलाएं: 

```
# config.env फ़ाइल से env vars पढ़ें और docker compose up चलाएं।
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)

# यदि ports binding में permission issues आ रहे हैं तो sudo उपयोग करें। 
sudo bash -c "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)"
```


### OneUptime तक पहुंचना

OneUptime यहाँ चलना चाहिए: http://localhost। इसका उपयोग शुरू करने के लिए आपको अपने instance के लिए एक नया account register करना होगा।

### TLS/SSL Certificates सेट अप करना

OneUptime SSL/TLS certificates सेट अप करने का **समर्थन नहीं करता**। आपको SSL/TLS certificates अपने आप सेट अप करने होंगे।

यदि आपको SSL/TLS certificates उपयोग करने की आवश्यकता है, तो इन steps का पालन करें:

1. Nginx या Caddy जैसा reverse proxy उपयोग करें।
2. certificates provision करने के लिए Let's Encrypt उपयोग करें।
3. reverse proxy को OneUptime server की ओर point करें।
4. निम्नलिखित settings अपडेट करें:
   - `HTTP_PROTOCOL` env var को `https` पर सेट करें।
   - `HOST` env var को उस server के domain name पर बदलें जहाँ reverse proxy hosted है।

## Production Readiness Checklist

आदर्श रूप से OneUptime को production में docker-compose के साथ deploy न करें। हम Kubernetes उपयोग करने की दृढ़ता से अनुशंसा करते हैं। OneUptime के लिए एक helm chart [यहाँ](https://artifacthub.io/packages/helm/oneuptime/oneuptime) उपलब्ध है। 

यदि आप फिर भी docker-compose के साथ production में OneUptime deploy करना चाहते हैं, तो कृपया निम्नलिखित पर विचार करें:

- **SSL/TLS**: SSL/TLS certificates सेट अप करें। OneUptime SSL/TLS certificates सेट अप करने का समर्थन नहीं करता। आपको SSL/TLS certificates अपने आप सेट अप करने होंगे। कृपया ऊपर देखें। 
- **Secrets**: सुनिश्चित करें कि आपकी `config.env` फ़ाइल में random secrets हैं। उस फ़ाइल में कुछ default secrets हैं। कृपया उन्हें random long strings से बदलें। 
- **Backups**: अपने databases (Clickhouse, Postgres) को नियमित रूप से backup करें। Redis एक cache के रूप में उपयोग किया जाता है और stateless है और इसे safely ignore किया जा सकता है। 
- **Updates**: कृपया OneUptime को नियमित रूप से अपडेट करें। हम प्रतिदिन updates release करते हैं। यदि आप production में चला रहे हैं तो हम आपको सप्ताह में कम से कम एक बार software अपडेट करने की सलाह देते हैं। 

### OneUptime अपडेट करना

अपडेट करने के लिए: 

```
git checkout release # सुनिश्चित करें कि आप release branch पर हैं।
git pull
npm run update
```

### ध्यान देने योग्य बातें

- हमारे Docker setup में, हम एक local logging driver उपयोग करते हैं। OneUptime, विशेष रूप से probe और ingest containers के भीतर, बड़ी मात्रा में logs उत्पन्न करता है। आपके storage को भरने से रोकने के लिए, Docker में logging storage को limit करना महत्वपूर्ण है। इसे कैसे करें इसके विस्तृत निर्देशों के लिए, कृपया [यहाँ](https://docs.docker.com/config/containers/logging/local/) official Docker documentation देखें।


### OneUptime Uninstall करना

OneUptime uninstall करने के लिए, निम्नलिखित command चलाएं:

```
npm run down
```

यह OneUptime द्वारा बनाए गए सभी containers, networks और volumes को बंद और हटा देगा। यह `config.env` फ़ाइल या cloned repository को नहीं हटाएगा।

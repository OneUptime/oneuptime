import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in Hindi (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * Hindi. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Hindi words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "जिस होस्ट की निगरानी करनी है उस पर Docker इंस्टॉल हो",
  "Network access from the host to your OneUptime instance":
    "होस्ट से आपके OneUptime इंस्टेंस तक नेटवर्क पहुँच",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "इसे उस डायरेक्टरी में `config.yaml` के रूप में सहेजें जहाँ से आप `docker run` चलाएँगे — चरण 3 इसे कंटेनर में माउंट करता है।",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "`<YOUR_API_KEY>` भरने के लिए चरण 1 में एक इंजेशन कुंजी चुनें।",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "`--network host`, `--pid host` और `/hostfs` बाइंड माउंट की वजह से `hostmetrics` और `process` स्क्रेपर CPU, मेमोरी, डिस्क और हर प्रक्रिया की जानकारी कंटेनर के बजाय होस्ट कर्नेल से पढ़ते हैं। इनके बिना आपको केवल कलेक्टर कंटेनर के अपने मेट्रिक्स दिखेंगे।",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "OneUptime में **होस्ट** सूची खोलें — पहला मेट्रिक बैच पहुँचते ही (आम तौर पर 30 सेकंड के भीतर) आपका होस्ट अपने-आप दिखता है। नहीं दिख रहा? कलेक्टर जाँचें:",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI जाँच हर होस्ट के लिए डिफ़ॉल्ट रूप से चालू है**: होस्ट AI एजेंट के उस पर चलते ही OneUptime AI वहाँ की घटनाओं और अलर्ट की जाँच `systemctl status`, `df -h`, `free -m` और `ps aux` जैसे केवल-पढ़ने वाले कमांड से करता है, और जब तक आप सुधारों की अनुमति न दें, कुछ नहीं बदलता। यह अपने इंस्टॉलर वाला एक Linux कंटेनर है, इसलिए इसे केवल Linux होस्ट पर जोड़ें; इसे Compose प्लगइन के साथ Docker चाहिए (सिस्टम इंजन, rootless Docker नहीं):",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "पहली पंक्ति स्क्रिप्ट को `install.sh` के रूप में डाउनलोड करती है, ताकि आप उसे चलाने से पहले पढ़ सकें। यह आपका OneUptime URL, इंजेशन कुंजी और होस्ट का नाम पूछती है — होस्टनाम इस्तेमाल करने के लिए नाम खाली छोड़ दें, यही नाम यह कलेक्टर रिपोर्ट करता है। जुड़ने के बाद यह होस्ट के **एआई → AI एजेंट** पेज पर और उसके **अवलोकन** के नीचे कनेक्टेड दिखता है। यह क्या चला सकता है और सुधार कैसे काम करते हैं: [इन्फ़्रास्ट्रक्चर AI एजेंट](/docs/ai/infrastructure-ai-agents#hosts)।",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "कॉन्फ़िग पहले से ही मशीन के IP पते, MAC पते, आर्किटेक्चर, मशीन ID, OS विवरण और OS संस्करण को **इन्वेंटरी** में उसके आइटम पर भर देता है, जिसे CMDB एक्सपोर्ट पढ़ता है। सीरियल नंबर, निर्माता, मॉडल और फ़र्मवेयर (BIOS / UEFI) संस्करण अलग हैं: **कोई भी रिसोर्स डिटेक्टर इन्हें नहीं दे सकता।** ये मशीन के फ़र्मवेयर से DMI के ज़रिए आते हैं। इन्हें प्रोविज़निंग के समय एक बार पढ़ें और रिसोर्स पर दर्ज कर दें — यह प्रोसेसर कंटेनर में माउंट की गई `config.yaml` में जोड़ें और मेट्रिक्स पाइपलाइन में उसका नाम दें। इसे उन सेक्शन में मिलाएँ जो आपके कॉन्फ़िग में पहले से हैं — दूसरी `processors:` या `service:` कुंजी न जोड़ें।",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "फिर कंटेनर को दोबारा बनाएँ ताकि वह बदली हुई फ़ाइल पढ़े — उसे हटाएँ और चरण 3 का `docker run` कमांड फिर से चलाएँ:",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "ये मान मशीन के अपने हैं, इसलिए जो भी उसे प्रोविज़न करता है वह इन्हें एक बार लिखता है। Linux पर इन्हें root के रूप में पढ़ें (`bios_version` कोई भी पढ़ सकता है):",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "कुछ ही मिनटों में मान **इन्वेंटरी** में मशीन के आइटम पर **विवरण** के नीचे दिखते हैं। ये दर्ज किए गए हैं, पहचाने नहीं गए, इसलिए मदरबोर्ड बदलने या फ़र्मवेयर अपडेट के बाद इसे फिर से चलाएँ।",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`, `host.model.name`, `host.firmware.version` और `host.bios.version` वैकल्पिक वर्तनी के रूप में स्वीकार किए जाते हैं और ऊपर की `device.*` कुंजियों के नीचे सहेजे जाते हैं (और `device.serial_number`, `host.serial_number` के नीचे), ताकि किसी भी तरह लिखा कॉन्फ़िग एक ही जगह पहुँचे।",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **एक ही कॉन्फ़िग से मोबाइल ऐप के रिसोर्स और होस्ट के रिसोर्स, दोनों पर `device.manufacturer` सेट न करें।** जिस रिसोर्स पर `host.name` या `host.id` नहीं है, उस पर `device.manufacturer` अब भी बैच को मोबाइल Real User Monitoring के रूप में चिह्नित करता है।",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "`oneuptime.label.` उपसर्ग वाला कोई भी रिसोर्स एट्रिब्यूट प्रोजेक्ट लेबल बनकर होस्ट से (और इस कलेक्टर से भेजी जाने वाली टेलीमेट्री सेवा से) जुड़ जाता है। पैटर्न: `oneuptime.label.<dimension>=<value>` नाम `<dimension>:<value>` वाला लेबल बन जाता है।",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "एक `resource` प्रोसेसर कंटेनर में माउंट की गई `config.yaml` में जोड़ें और मेट्रिक्स पाइपलाइन से उसका हवाला दें। इसे उन सेक्शन में मिलाएँ जो आपके कॉन्फ़िग में पहले से हैं — दूसरी `processors:` या `service:` कुंजी न जोड़ें।",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "होस्ट `team:payments`, `env:production` और `region:us-east-1` टैग के साथ दिखता है। लेबल बड़े-छोटे अक्षरों का भेद किए बिना मिलाए जाते हैं, इसलिए हाथ से बना मौजूदा `Production` लेबल दोबारा बनाने के बजाय फिर से इस्तेमाल होता है। OneUptime UI में हाथ से जोड़े गए लेबल कलेक्टर कभी नहीं हटाता।",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "होस्ट OTel रिसोर्स एट्रिब्यूट `host.name` से अपने-आप खोजे जाते हैं, जिसे `resourcedetection` प्रोसेसर सेट करता है। `host.name` वाले बैच में इनमें से कुछ भी होते ही OneUptime होस्ट को दर्ज कर लेता है:",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- `hostmetrics` रिसीवर के मेट्रिक्स (CPU, मेमोरी, डिस्क, फ़ाइल सिस्टम, नेटवर्क, लोड, प्रक्रियाएँ), या",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- `process` स्क्रेपर के मेट्रिक्स (हर प्रक्रिया का CPU/मेमोरी/थ्रेड), या",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- मेट्रिक्स, लॉग या ट्रेस पर `os.type` या `container.runtime` रिसोर्स एट्रिब्यूट",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "…और अवलोकन, मेट्रिक्स, प्रक्रियाएँ और लॉग टैब भरना शुरू कर देता है। अकेले `host.id` या `host.arch` से होस्ट दर्ज नहीं होता, और Kubernetes पहचान (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) वाली टेलीमेट्री इसके बजाय अपने Kubernetes क्लस्टर के नीचे दर्ज होती है।",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**OpenStack पर चल रहा है?** `detectors: [nova, system, env]` इस्तेमाल करें, ताकि `host.id` इंस्टेंस का UUID हो और OneUptime इस होस्ट को उसके इंस्टेंस से जोड़े, और `nova: resource_attributes:` के नीचे `host.name` को `enabled: false` पर सेट करें ताकि उसका नाम वही रहे जो `system` रिपोर्ट करता है।",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "यही रिसोर्स एट्रिब्यूट **इन्वेंटरी** में मशीन का आइटम बनते हैं, जिसे CMDB एक्सपोर्ट पढ़ता है। `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` और `os.version` सभी `resourcedetection` प्रोसेसर से आते हैं; सीरियल नंबर, निर्माता, मॉडल और फ़र्मवेयर संस्करण का कोई डिटेक्टर नहीं है और इन्हें अलग से दर्ज किया जाता है (**सीरियल नंबर, निर्माता, मॉडल और फ़र्मवेयर संस्करण दर्ज करें** देखें)।",
  "Once the host is reporting:": "होस्ट के रिपोर्ट करना शुरू करने पर:",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- **मेट्रिक्स** टैब `system.*` टाइम-सीरीज़ दिखाता है।",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- `process` स्क्रेपर चालू होते ही **प्रक्रियाएँ** टैब CPU के क्रम में प्रक्रियाओं की सूची दिखाता है।",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- **लॉग** टैब वे सभी लॉग लगातार दिखाता है जिनके रिसोर्स एट्रिब्यूट में `host.name` शामिल है।",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "कॉन्फ़िग जिस कलेक्टर रिलीज़ के लिए है (`oneuptime.agent.version`), उसे होस्ट के **एजेंट संस्करण** के रूप में रिपोर्ट करता है। जब यह OneUptime कोई नई रिलीज़ पिन करता है, तो उसके बगल का चेतावनी चिह्न ये चरण खोलता है।",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. चरण 2 का कॉन्फ़िग उसी इंजेशन कुंजी के साथ फिर से सहेजें: यह नया संस्करण रिपोर्ट करता है। अपने कॉन्फ़िग में किया हर बदलाव इसमें ले आएँ।",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. जिस फ़ोल्डर में यह है, उसमें नई रिलीज़ इंस्टॉल करें और कलेक्टर को रीस्टार्ट करें:",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. एक्सपोर्ट त्रुटियों के लिए कलेक्टर के लॉग पढ़ें: `docker logs -f otel-collector`। HTTP `401` का मतलब है कि कुंजी गायब है, ग़लत है या उसकी अवधि ख़त्म हो गई है; `422` का मतलब है कि वह बंद कर दी गई है (या वह ब्राउज़र कुंजी है, जो होस्ट टेलीमेट्री नहीं भेज सकती)। चरण 1 में एक काम करने वाली कुंजी चुनें और कंटेनर में माउंट की गई `config.yaml` में `x-oneuptime-token` अपडेट करें।",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. जाँचें कि होस्ट OneUptime तक पहुँच सकता है: उसी मशीन से `curl -v <YOUR_ONEUPTIME_URL>/otlp`।",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. `resourcedetection` को मेट्रिक्स पाइपलाइन में रखें — यह `host.name` सेट करता है, जिससे OneUptime होस्ट को पहचानता है।",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "कलेक्टर अपने ही कंटेनर का कर्नेल दृश्य पढ़ रहा है। इसे `--network host`, `--pid host`, `/:/hostfs` बाइंड माउंट और `HOST_*` वेरिएबल के साथ ठीक वैसे चलाएँ जैसा चरण 3 दिखाता है — इनके बिना `hostmetrics` और `process` स्क्रेपर केवल कलेक्टर कंटेनर को ही देखते हैं।",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "`sudo` वाला एक Debian या Ubuntu होस्ट (amd64 या arm64)",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "इसे अपनी मौजूदा डायरेक्टरी में `config.yaml` के रूप में सहेजें — चरण 3 इसे इंस्टॉल करता है।",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **नेटिव इंस्टॉल के लिए नोट:** Docker के उलट, पैकेज इंस्टॉल `/proc` और `/sys` सीधे पढ़ता है — `HOST_PROC` env वेरिएबल या `/hostfs` माउंट की ज़रूरत नहीं। पैकेज के साथ आने वाली systemd यूनिट बिना विशेषाधिकार वाले `otelcol-contrib` उपयोगकर्ता के रूप में चलती है; अगर आप चाहते हैं कि `process` स्क्रेपर दूसरे उपयोगकर्ताओं की प्रक्रियाएँ देखे, तो उसे `CAP_SYS_PTRACE` दें या उसे root के रूप में चलाएँ।",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`otelcol-contrib` में **v0.142.0** से `systemd` रिसीवर शामिल है; **v0.143.0 या नया** चलाएँ, जिसमें इसके CPU मेट्रिक को मौजूदा नाम मिला और इसने ऐसी यूनिट से पूछना बंद किया जो सेवा नहीं हैं। इसे `/etc/otelcol-contrib/config.yaml` और मेट्रिक्स पाइपलाइन में जोड़कर चालू करें। इसे उन सेक्शन में मिलाएँ जो आपके कॉन्फ़िग में पहले से हैं — दूसरी `processors:` या `service:` कुंजी न जोड़ें।",
  "Then restart the service:": "फिर सेवा को रीस्टार्ट करें:",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "यह रिसीवर **केवल Linux** के लिए है और **अल्फ़ा** में है। यह सिस्टम D-Bus पर `systemctl list-units` जैसी ही केवल-पढ़ने वाली कॉल से यूनिट की स्थिति पढ़ता है, जिन्हें systemd बिना विशेषाधिकार के अनुमति देता है, इसलिए पैकेज वाली सेवा — जो `otelcol-contrib` उपयोगकर्ता के रूप में चलती है — को किसी अतिरिक्त अधिकार की ज़रूरत नहीं। कंटेनर में चलने वाला कलेक्टर होस्ट की बस तक नहीं पहुँच सकता, इसलिए नेटिव इंस्टॉल इस्तेमाल करें। मेट्रिक्स आते ही होस्ट का **Systemd यूनिट** टैब हर इकट्ठा की गई यूनिट और उसकी मौजूदा स्थिति (`active`, `failed`, `inactive`, ...) से भर जाता है।",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "हर यूनिट हर स्क्रेप में स्टेट सेट के लिए आठ डेटा पॉइंट लेती है, और अगर आप CPU मेट्रिक चालू रखें तो दो और, इसलिए सैकड़ों यूनिट वाले होस्ट पर सब कुछ स्क्रेप करने के बजाय `units:` सीमित करें या `collection_interval` बढ़ाएँ।",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI जाँच हर होस्ट के लिए डिफ़ॉल्ट रूप से चालू है**: होस्ट AI एजेंट के उस पर चलते ही OneUptime AI वहाँ की घटनाओं और अलर्ट की जाँच `systemctl status`, `df -h`, `free -m` और `ps aux` जैसे केवल-पढ़ने वाले कमांड से करता है, और जब तक आप सुधारों की अनुमति न दें, कुछ नहीं बदलता। यह अपने इंस्टॉलर वाला एक Linux कंटेनर है; इसे Compose प्लगइन के साथ Docker चाहिए (सिस्टम इंजन, rootless Docker नहीं):",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "कॉन्फ़िग पहले से ही मशीन के IP पते, MAC पते, आर्किटेक्चर, मशीन ID, OS विवरण और OS संस्करण को **इन्वेंटरी** में उसके आइटम पर भर देता है, जिसे CMDB एक्सपोर्ट पढ़ता है। सीरियल नंबर, निर्माता, मॉडल और फ़र्मवेयर (BIOS / UEFI) संस्करण अलग हैं: **कोई भी रिसोर्स डिटेक्टर इन्हें नहीं दे सकता।** ये मशीन के फ़र्मवेयर से DMI के ज़रिए आते हैं, और पैकेज वाला कलेक्टर बिना विशेषाधिकार के चलता है, इसलिए वह इन्हें ख़ुद नहीं पढ़ सकता। इन्हें प्रोविज़निंग के समय एक बार पढ़ें और रिसोर्स पर दर्ज कर दें — यह प्रोसेसर `/etc/otelcol-contrib/config.yaml` में जोड़ें और मेट्रिक्स पाइपलाइन में उसका नाम दें। इसे उन सेक्शन में मिलाएँ जो आपके कॉन्फ़िग में पहले से हैं — दूसरी `processors:` या `service:` कुंजी न जोड़ें।",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "एक `resource` प्रोसेसर `/etc/otelcol-contrib/config.yaml` में जोड़ें और मेट्रिक्स पाइपलाइन से उसका हवाला दें। इसे उन सेक्शन में मिलाएँ जो आपके कॉन्फ़िग में पहले से हैं — दूसरी `processors:` या `service:` कुंजी न जोड़ें।",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- `systemd` रिसीवर चालू होते ही **Systemd यूनिट** टैब यूनिट की स्थिति दिखाता है (**Systemd यूनिट टैब चालू करें** देखें)।",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. एक्सपोर्ट त्रुटियों के लिए कलेक्टर के लॉग पढ़ें: `sudo journalctl -u otelcol-contrib -f`। HTTP `401` का मतलब है कि कुंजी गायब है, ग़लत है या उसकी अवधि ख़त्म हो गई है; `422` का मतलब है कि वह बंद कर दी गई है (या वह ब्राउज़र कुंजी है, जो होस्ट टेलीमेट्री नहीं भेज सकती)। चरण 1 में एक काम करने वाली कुंजी चुनें और `/etc/otelcol-contrib/config.yaml` में `x-oneuptime-token` अपडेट करें।",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. `resourcedetection` को उसी मेट्रिक्स पाइपलाइन में रखें जिसमें `systemd` रिसीवर है — रिसीवर हर यूनिट पर केवल `systemd.unit.name` लगाता है, इसलिए `host.name` के बिना सैंपल कभी होस्ट से नहीं जुड़ते।",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. `otelcol-contrib` v0.143.0 या नया चलाएँ: पुराने बिल्ड स्टार्टअप पर `'receivers' unknown type: \"systemd\"` के साथ रुक जाते हैं, या CPU मेट्रिक को अलग नाम देते हैं (**Systemd यूनिट टैब चालू करें** देखें)।",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. जाँचें कि कलेक्टर सिस्टम D-Bus तक पहुँच सकता है: `/run/dbus/system_bus_socket` मौजूद होना चाहिए, और कलेक्टर के उपयोगकर्ता के रूप में `systemctl list-units` चलाना सबसे तेज़ जाँच है। root की ज़रूरत नहीं है।",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "`sudo` वाला एक RHEL, CentOS, Fedora या Amazon Linux होस्ट (x86_64 या aarch64)",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "systemd चलाने वाला और `sudo` वाला एक Linux होस्ट (x86_64 या aarch64)",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "`/etc/systemd/system/otelcol-contrib.service` पर एक systemd यूनिट रखें:",
  "Then enable and start it:": "फिर इसे चालू करें और शुरू करें:",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "इसे तब इस्तेमाल करें जब पैकेज उपलब्ध न हों — बंद किए गए सर्वर, या कंटेनर बेस इमेज जिन्हें आप बाहर से इंस्ट्रूमेंट करना चाहते हैं। `HOST_PROC` env वेरिएबल या `/hostfs` माउंट की ज़रूरत नहीं: कलेक्टर कर्नेल की स्थिति सीधे पढ़ता है, और `User=root` से `process` स्क्रेपर दूसरे उपयोगकर्ताओं की प्रक्रियाएँ देख पाता है (इसके बजाय `CAP_SYS_PTRACE` देना भी काम करता है)।",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "यह रिसीवर **केवल Linux** के लिए है और **अल्फ़ा** में है। यह सिस्टम D-Bus पर `systemctl list-units` जैसी ही केवल-पढ़ने वाली कॉल से यूनिट की स्थिति पढ़ता है, जिन्हें systemd बिना विशेषाधिकार के अनुमति देता है, इसलिए इसे किसी अतिरिक्त अधिकार की ज़रूरत नहीं। कंटेनर में चलने वाला कलेक्टर होस्ट की बस तक नहीं पहुँच सकता, इसलिए नेटिव इंस्टॉल इस्तेमाल करें। मेट्रिक्स आते ही होस्ट का **Systemd यूनिट** टैब हर इकट्ठा की गई यूनिट और उसकी मौजूदा स्थिति (`active`, `failed`, `inactive`, ...) से भर जाता है।",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "कॉन्फ़िग पहले से ही मशीन के IP पते, MAC पते, आर्किटेक्चर, मशीन ID, OS विवरण और OS संस्करण को **इन्वेंटरी** में उसके आइटम पर भर देता है, जिसे CMDB एक्सपोर्ट पढ़ता है। सीरियल नंबर, निर्माता, मॉडल और फ़र्मवेयर (BIOS / UEFI) संस्करण अलग हैं: **कोई भी रिसोर्स डिटेक्टर इन्हें नहीं दे सकता।** ये मशीन के फ़र्मवेयर से DMI के ज़रिए आते हैं। इन्हें प्रोविज़निंग के समय एक बार पढ़ें और रिसोर्स पर दर्ज कर दें — यह प्रोसेसर `/opt/otelcol-contrib/config.yaml` में जोड़ें और मेट्रिक्स पाइपलाइन में उसका नाम दें। इसे उन सेक्शन में मिलाएँ जो आपके कॉन्फ़िग में पहले से हैं — दूसरी `processors:` या `service:` कुंजी न जोड़ें।",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "एक Mac (Apple silicon या Intel) और `sudo` के लिए एक एडमिनिस्ट्रेटर खाता",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "`/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist` बनाएँ:",
  "Load it:": "इसे लोड करें:",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **ऊपर बताए अनुसार contrib बिल्ड इंस्टॉल करें।** core `otelcol` बिल्ड में `resourcedetection` प्रोसेसर नहीं है, इसलिए वह इस कॉन्फ़िग के साथ शुरू होने से इनकार कर देता है।",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "कॉन्फ़िग पहले से ही मशीन के IP पते, MAC पते, आर्किटेक्चर, मशीन ID, OS विवरण और OS संस्करण को **इन्वेंटरी** में उसके आइटम पर भर देता है, जिसे CMDB एक्सपोर्ट पढ़ता है। सीरियल नंबर, निर्माता, मॉडल और फ़र्मवेयर (BIOS / UEFI) संस्करण अलग हैं: **कोई भी रिसोर्स डिटेक्टर इन्हें नहीं दे सकता।** ये मशीन के फ़र्मवेयर से आते हैं। इन्हें प्रोविज़निंग के समय एक बार पढ़ें और रिसोर्स पर दर्ज कर दें — यह प्रोसेसर `/etc/otelcol-contrib/config.yaml` में जोड़ें और मेट्रिक्स पाइपलाइन में उसका नाम दें। इसे उन सेक्शन में मिलाएँ जो आपके कॉन्फ़िग में पहले से हैं — दूसरी `processors:` या `service:` कुंजी न जोड़ें।",
  "Then restart the collector:": "फिर कलेक्टर को रीस्टार्ट करें:",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "ये मान मशीन के अपने हैं, इसलिए जो भी उसे प्रोविज़न करता है वह इन्हें एक बार लिखता है। Mac पर इन्हें ऐसे पढ़ें — निर्माता `Apple Inc.` है:",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` मॉडल का *पहचानकर्ता* (`MacBookPro18,3`) है, मार्केटिंग नाम नहीं। फिर भी इसे `device.model.name` में डालें — `device.model.identifier` बैच को मोबाइल ऐप के रूप में चिह्नित करता है।",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803+ या Windows Server 2019+ (बिल्ट-इन `tar.exe` के लिए)",
  "An elevated PowerShell prompt (Run as administrator)":
    "एक एलिवेटेड PowerShell प्रॉम्प्ट (Run as administrator)",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "इसे उस फ़ोल्डर में `config.yaml` के रूप में सहेजें जहाँ से आप PowerShell कमांड चलाएँगे — चरण 3 इसे सही जगह कॉपी करता है।",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "Windows पर अपस्ट्रीम **`otelcol-contrib`** कलेक्टर इंस्टॉल करें — **v0.155.0** से इसमें `windows_service` रिसीवर शामिल है जो होस्ट के **सेवाएं** टैब को भरता है। एलिवेटेड PowerShell प्रॉम्प्ट से चलाएँ:",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **नोट:** सेवा `LocalSystem` के रूप में चलती है ताकि वह हर Windows सेवा पढ़ सके। Windows पर `load` स्क्रेपर केवल *Processor Queue Length* काउंटर से लोड औसत की नकल करता है (यह 0 से शुरू होता है); अगर वह काउंटर नहीं पढ़ पाता, तो यह लॉग होकर छोड़ दिया जाता है, और बाकी `hostmetrics` कॉन्फ़िग बिना बदलाव के चलता है। [होस्ट OpenTelemetry Collector दस्तावेज़](/docs/telemetry/host-otel-collector) में साइन किया गया `.msi` इंस्टॉलर भी शामिल है।",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "लॉग Windows के Application इवेंट लॉग में लिखे जाते हैं; इन्हें **Event Viewer → Windows Logs → Application** (स्रोत `otelcol-contrib`) में देखें।",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "**v0.155.0** से `otelcol-contrib` में `windows_service` रिसीवर शामिल है — इसे `C:\\Program Files\\otelcol-contrib\\config.yaml` और मेट्रिक्स पाइपलाइन में जोड़कर चालू करें। इसे उन सेक्शन में मिलाएँ जो आपके कॉन्फ़िग में पहले से हैं — दूसरी `processors:` या `service:` कुंजी न जोड़ें।",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "यह रिसीवर **केवल Windows** के लिए है और **अल्फ़ा** में है। मेट्रिक्स आते ही होस्ट का **सेवाएं** टैब हर सेवा की चलने की स्थिति और स्टार्टअप प्रकार से अपने-आप भर जाता है।",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "कॉन्फ़िग पहले से ही मशीन के IP पते, MAC पते, आर्किटेक्चर, मशीन ID, OS विवरण और OS संस्करण को **इन्वेंटरी** में उसके आइटम पर भर देता है, जिसे CMDB एक्सपोर्ट पढ़ता है। सीरियल नंबर, निर्माता, मॉडल और फ़र्मवेयर (BIOS / UEFI) संस्करण अलग हैं: **कोई भी रिसोर्स डिटेक्टर इन्हें नहीं दे सकता।** ये मशीन के फ़र्मवेयर से WMI के ज़रिए आते हैं।",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "मशीन पर एलिवेटेड PowerShell प्रॉम्प्ट से इसे चलाएँ — यह WMI से पूछता है और *इसी* मशीन के लिए सटीक YAML छापता है:",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "यह पहले से इंडेंट की हुई एक प्रोसेसर एंट्री छापता है। इसे उस `processors:` ब्लॉक के अंदर जोड़ें जो आपकी `config.yaml` में पहले से है — `resourcedetection:`, `resource:` और `batch:` के बगल में, दूसरी `processors:` कुंजी के रूप में नहीं — फिर मेट्रिक्स पाइपलाइन में उसका नाम दें:",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "`Get-CimInstance` इस्तेमाल करें, पुराना पड़ चुका `Get-WmiObject` नहीं — वह PowerShell 7 और उसके बाद के संस्करणों में नहीं है। मान एकल उद्धरण चिह्नों में छापे जाते हैं और भीतर का हर उद्धरण चिह्न दोगुना कर दिया जाता है, ताकि विराम चिह्नों वाला सीरियल या मॉडल मान्य YAML बना रहे। फ़र्मवेयर जो फ़ील्ड खाली छोड़ता है, वह `''` के रूप में छपता है; खाली एट्रिब्यूट भेजने के बजाय उसे हटा दें।",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "कुछ ही मिनटों में **इन्वेंटरी** में मशीन का आइटम **विवरण** के नीचे `host.serial_number`, `device.manufacturer`, `device.model.name` और `device.firmware.version` दिखाता है, उन IP और MAC पतों और मशीन ID के साथ जो डिटेक्टर पहले से देता है। मदरबोर्ड बदलने या BIOS अपडेट के बाद इसे फिर से चलाएँ — मान दर्ज किए गए हैं, पहचाने नहीं गए, इसलिए वे अपने-आप अपडेट नहीं होते।",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- `windows_service` रिसीवर चालू होते ही **सेवाएं** टैब हर सेवा की स्थिति दिखाता है (**Windows सेवाएं टैब चालू करें** देखें)।",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. एक्सपोर्ट त्रुटियों के लिए कलेक्टर के लॉग पढ़ें: **Event Viewer → Windows Logs → Application** (स्रोत `otelcol-contrib`)। HTTP `401` का मतलब है कि कुंजी गायब है, ग़लत है या उसकी अवधि ख़त्म हो गई है; `422` का मतलब है कि वह बंद कर दी गई है (या वह ब्राउज़र कुंजी है, जो होस्ट टेलीमेट्री नहीं भेज सकती)। चरण 1 में एक काम करने वाली कुंजी चुनें और `C:\\Program Files\\otelcol-contrib\\config.yaml` में `x-oneuptime-token` अपडेट करें।",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. सामान्य `Error 1064` के बजाय असली त्रुटि देखने के लिए कलेक्टर को फ़ोरग्राउंड में चलाएँ:",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. `Error 2: The system cannot find the file specified` का मतलब है कि सेवा ऐसी फ़ाइल की ओर इशारा करती है जो मौजूद नहीं — `sc.exe qc "otelcol-contrib"` के `BINARY_PATH_NAME` की तुलना `C:\\Program Files\\otelcol-contrib` की सामग्री से करें। आर्काइव `otelcol-contrib_` वाला होना चाहिए, जो `otelcol-contrib.exe` अनपैक करता है।',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application** (स्रोत `otelcol-contrib`) वह स्टार्टअप त्रुटि दर्ज करता है जिसे सर्विस मैनेजर ने निगल लिया।",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "अगर आपने `include_services` सेट किया है पर फिर भी हर सेवा दिख रही है, तो कलेक्टर ने बदलाव नहीं लिया है — सेवा को रीस्टार्ट करें (`Restart-Service otelcol-contrib`) और सेवाएं टैब को अपनी रोलिंग विंडो ताज़ा करने के लिए कुछ मिनट दें।",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "Kubernetes नोड की निगरानी होस्ट कलेक्टर के बजाय **OneUptime Kubernetes एजेंट** करता है: हर नोड **Kubernetes** → आपका क्लस्टर → **नोड** के नीचे, अपने पॉड और वर्कलोड के बगल में दिखता है, **होस्ट** सूची में नहीं। नीचे के चरण एक स्टैंडर्ड क्लस्टर पर एजेंट इंस्टॉल करते हैं; **Kubernetes** सेक्शन की इंस्टॉल गाइड में Amazon EKS, Google GKE, Azure AKS, GKE Autopilot और EKS Fargate के चरण हैं।",
  "A Kubernetes cluster running v1.23 or later":
    "v1.23 या नए संस्करण पर चलने वाला Kubernetes क्लस्टर",
  "`kubectl` and `helm` (v3) installed on your machine":
    "आपकी मशीन पर इंस्टॉल किए गए `kubectl` और `helm` (v3)",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "ग़लत क्लस्टर? `kubectl config use-context <context-name>` से बदलें।",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "`my-cluster` को इस क्लस्टर के किसी नाम से बदलें, जैसे `prod-us-east-1`। OneUptime में क्लस्टर इसी नाम से दिखता है, इसलिए इसे स्थिर रखें: नया नाम एक नया क्लस्टर रजिस्टर करता है।",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` **एआई जाँच** चालू करता है, जैसा chart डिफ़ॉल्ट रूप से करता है: OneUptime AI, Kubernetes AI एजेंट के ज़रिए केवल-पढ़ने वाले kubectl से इस क्लस्टर की घटनाओं और अलर्ट की जाँच करता है।",
  "You should see:": "आपको यह दिखना चाहिए:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "कलेक्टर और Kubernetes AI एजेंट, साथ ही हर नोड पर एक `-logs` और एक `-ebpf` पॉड। उनके `Running` होते ही क्लस्टर अपने-आप **Kubernetes** सेक्शन में दिखता है, आमतौर पर एक-दो मिनट के भीतर।",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes AI एजेंट (डिफ़ॉल्ट रूप से चालू, केवल-पढ़ने वाला)।** `kubernetes-agent-ai-agent` पॉड उसी API कुंजी से OneUptime AI को केवल-पढ़ने वाले kubectl (`get`, `describe`, `logs`, `events`, `top`) से इस क्लस्टर की घटनाओं और अलर्ट की जाँच करने देता है, और जब तक आप बाद में उसे लिखने की अनुमति न दें, वह कुछ नहीं बदल सकता। उसे देखने के लिए क्लस्टर खोलें और **एआई → एजेंट** पर जाएँ। इसकी ज़रूरत नहीं? `--set aiAgent.enabled=true` के बजाय `--set aiAgent.enabled=false` के साथ इंस्टॉल करें।",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "नेमस्पेस नियम तय करते हैं कि एजेंट हर नेमस्पेस से क्या इकट्ठा करे। सिर्फ़ `default`, `production` और `staging` से पॉड लॉग और eBPF डेटा इकट्ठा करने के लिए:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "सब कुछ रखते हुए शोर वाले नेमस्पेस के लॉग रोकने के लिए, उन्हें सिर्फ़ `podLogs` से बाहर करें:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **दायरे:** `podLogs` (कंटेनर का stdout/stderr), `ebpfDiscovery` (eBPF ट्रेस और मेट्रिक्स), `metrics` (नेमस्पेस वाले मेट्रिक्स) और `traces` (हर span)।",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **पैटर्न** पूरे नेमस्पेस नाम से मेल खाते हैं और `*` स्वीकार करते हैं, जैसे `team-*` में। `exclude` नियम हमेशा `include` नियम पर भारी पड़ता है।",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **नियम सेट करने से डिफ़ॉल्ट नियम बदल जाता है**, जो `kube-system` को `podLogs` और `ebpfDiscovery` से बाहर रखता है। अगर आपको अब भी वह चाहिए, तो उसे दूसरे उदाहरण की तरह अपनी सूची में रखें।",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- नोड और क्लस्टर मेट्रिक्स का कोई नेमस्पेस नहीं होता, इसलिए वे हमेशा रखे जाते हैं।",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` के लिए Helm 3.10 या नया ज़रूरी है।",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**सिर्फ़ ज़रूरी पंक्तियाँ भेजें।** क्लस्टर से निकलने से पहले, किसी गंभीरता से कम की पॉड लॉग पंक्तियाँ छोड़ दें:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    '`TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` और `FATAL` स्वीकार करता है: `WARN` चेतावनियाँ, त्रुटियाँ और घातक पंक्तियाँ रखता है। गंभीरता लॉग पंक्ति से ही पढ़ी जाती है (`[ERROR]`, `level=warn`, `"level":"info"`)। इससे Kubernetes इवेंट कभी नहीं छोड़े जाते।',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**पॉड लॉग बंद करें।** मेट्रिक्स पर असर नहीं पड़ता: नोड कलेक्टर kubelet और cAdvisor मेट्रिक्स के लिए चलता रहता है, बस पॉड लॉग पढ़ना बंद कर देता है:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**लॉग पढ़ने का तरीका बदलें।** प्रीसेट यह आपके लिए चुनता है; स्पष्ट रूप से दिया गया `logs.mode` हमेशा उस पर भारी पड़ता है:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: हर नोड पर hostPath के ज़रिए `/var/log/pods` पढ़ता है (सबसे कम ओवरहेड; hostPath ज़रूरी)।",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: एक Deployment, Kubernetes API के ज़रिए पॉड लॉग फ़ॉलो करता है (किसी भी क्लस्टर पर काम करता है)।",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: कोई पॉड लॉग नहीं।",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "यह API सर्वर को पढ़ता है, जहाँ वह क्लस्टर के भीतर जवाब देता है। etcd, शेड्यूलर और कंट्रोलर मैनेजर कंट्रोल प्लेन नोड पर जवाब देते हैं, जिनका अनुमान एजेंट का पॉड नहीं लगा सकता, इसलिए आप हर नोड का पता दे दें, तो वह उन्हें पढ़ता है:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **शेड्यूलर और कंट्रोलर मैनेजर** HTTPS देते हैं और एजेंट का टोकन स्वीकार करते हैं, लेकिन kubeadm उन्हें `127.0.0.1` से बाँध देता है: उन्हें एक ऐसा `--bind-address` दें जिस तक एजेंट का पॉड पहुँच सके।",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** ऊपर बताए अनुसार kubeadm के `--listen-metrics-urls` (पोर्ट 2381, नोड का पता जोड़ने तक `127.0.0.1` से बँधा) पर सादे HTTP में अपने मेट्रिक्स देता है। या उसके HTTPS क्लाइंट पोर्ट 2379 को उस क्लाइंट सर्टिफ़िकेट से स्क्रैप करें जो वह माँगता है: `ca.crt`, `tls.crt` और `tls.key` को `oneuptime-agent` के एक Secret में रखें और `controlPlane.etcd.clientCertSecret` में उसका नाम दें।",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "सिर्फ़ सेल्फ़-मैनेज्ड क्लस्टर के लिए: मैनेज्ड सर्विस (EKS, GKE, AKS) अपने कंट्रोल प्लेन के मेट्रिक्स नहीं दिखातीं।",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "लागत निगरानी डिफ़ॉल्ट रूप से चालू है: एजेंट में ओपन-सोर्स OpenCost इंजन (और उसे चाहिए छोटा Prometheus) शामिल है, यह आपके क्लाउड प्रोवाइडर की सार्वजनिक सूची-कीमतों से आपके नोड और वॉल्यूम की क़ीमत तय करता है, किसी क्रेडेंशियल के बिना, और भेजता है कि हर नेमस्पेस और वर्कलोड की लागत कितनी है। पहला पूरा घंटा बीतने के बाद पहला डेटा क्लस्टर के अवलोकन और लागत पेज पर दिखता है।",
  "On an agent installed before it was on by default, upgrade it:":
    "जो एजेंट इसके डिफ़ॉल्ट रूप से चालू होने से पहले इंस्टॉल हुआ था, उसे अपग्रेड करें:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **इसे बंद करें:** उसी अपग्रेड में `--set cost.enabled=false` जोड़ें।",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **पहले से Kubecost या OpenCost चला रहे हैं?** एजेंट उसे ढूँढ लेता है और chart में शामिल इंजन के बजाय उसी को पढ़ता है, और क्लस्टर का अवलोकन यह बताता है: दूसरा इंजन शामिल करना बंद करने के लिए `--set cost.engine.url=auto` जोड़ें।",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **ऑन-प्रेम या बेयर मेटल?** `--set cost.opencost.customPricing.enabled=true` से एक रेट कार्ड सेट करें (प्रति रिसोर्स-घंटा USD; chart का `values.yaml` देखें)।",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "पूरी गाइड: [Kubernetes लागत ऑब्ज़र्वेबिलिटी](/docs/telemetry/kubernetes-cost)।",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "एजेंट हर नोड पर [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) चलाता है। यह Go, .NET, Java, Node.js, Python, Ruby और Rust सर्विस का HTTP/HTTPS, gRPC और SQL/Redis ट्रैफ़िक बिना SDK और बिना sidecar के पकड़ता है, और कलेक्टर के ज़रिए ट्रेस, रिक्वेस्ट (RED) मेट्रिक्स और सर्विस-ग्राफ़ डेटा भेजता है।",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**आवश्यकताएं:** BTF के साथ Linux कर्नेल **5.8+** (Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+ पर डिफ़ॉल्ट)। eBPF पॉड **विशेषाधिकार** के साथ चलते हैं, जो उन्हें eBPF प्रोग्राम लोड करने के लिए चाहिए।",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "अगर आपके नोड पुराना कर्नेल चलाते हैं, विशेषाधिकार वाले पॉड की अनुमति नहीं है, या आपकी सर्विस पहले से OpenTelemetry SDK से ट्रेस भेजती हैं और आप डुप्लिकेट नहीं चाहते, तो **इसे बंद करें**:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**सिग्नल चुनें।** हर परिवार `--set ebpf.features.<name>=false` (या `=true`) से चालू या बंद होता है:",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | डिफ़ॉल्ट | यह क्या जोड़ता है |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | चालू | हर सर्विस के लिए HTTP/gRPC रिक्वेस्ट दर, त्रुटियाँ और लेटेंसी |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | चालू | span की कॉल गिनती और अवधि (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | चालू | कॉलर → कॉली के किनारे; सर्विस मैप बनाते हैं |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | चालू | पॉड-से-पॉड TCP/UDP फ़्लो काउंटर |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | बंद | ज़ोन के बीच के नेटवर्क मेट्रिक्स (उनकी कार्डिनैलिटी दोगुनी कर देता है) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | चालू | नोड-स्तर का TCP RTT, विफल कनेक्शन और पुनर्प्रेषण काउंटर |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**सर्विसों के बीच ट्रेस का प्रसार** (पॉड A → पॉड B तक जाने वाली रिक्वेस्ट को एक ही ट्रेस में जोड़ना, दूसरे नोड पर भी) **डिफ़ॉल्ट रूप से चालू** है। यह पहले से चल रहे ट्रैफ़िक को फिर से लिखकर काम करता है (कर्नेल में सादे HTTP रिक्वेस्ट को फैलाकर, और TLS व कच्चे TCP में एक TCP विकल्प जोड़कर), और इस बाइट गिनती में कोई ग़लती स्ट्रीम को असमकालिक कर देती है: बताया गया लक्षण यह है कि nginx जैसे L7 प्रॉक्सी से होने वाले ट्रांसफ़र, जवाब ~64KB पार करते ही अटक जाते हैं। अगर आपको यह दिखे, या कोई सर्विस मेश पॉड को विफल करने लगे, तो इसे `--set ebpf.contextPropagation=false` से बंद करें; OpenTelemetry SDK इनमें से कुछ भी किए बिना यूज़रस्पेस में `traceparent` का प्रसार करता है।",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "हर `oneuptime.labels.<key>=<value>` क्लस्टर पर, और उसकी रिपोर्ट की गई सर्विस और होस्ट पर, लेबल `<key>:<value>` बन जाता है। लेबल बड़े-छोटे अक्षरों का भेद किए बिना मिलाए जाते हैं, इसलिए मौजूदा `Production` लेबल फिर से इस्तेमाल होता है; OneUptime इंटरफ़ेस में जोड़े गए लेबल एजेंट कभी नहीं हटाता।",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "नवीनतम chart पर **अपग्रेड करें**। `--reset-then-reuse-values` (Helm 3.14+) आपके सेट किए मान (प्रीसेट, क्लस्टर का नाम, फ़िल्टर) रखता है और बाकी सब नए chart से लेता है; इसके ऊपर कोई भी नए `--set` फ़्लैग जोड़ें:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Helm 3.13 और पुराने पर, इसके बजाय अपने सेट किए मानों के साथ अपग्रेड करें:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "`--reuse-values` का इस्तेमाल न करें: यह उस chart के डिफ़ॉल्ट भी रखता है जिससे आप अपग्रेड करते हैं, इसलिए नए chart के डिफ़ॉल्ट (उनमें उसकी eBPF इमेज भी) कभी लागू नहीं होते।",
  "**Uninstall** the agent and its namespace:":
    "एजेंट और उसके नेमस्पेस को **अनइंस्टॉल करें**:",
  "| Category | Data |": "| श्रेणी | डेटा |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **नोड मेट्रिक्स** | CPU, मेमोरी, फ़ाइल सिस्टम और नेटवर्क का उपयोग |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **पॉड और कंटेनर मेट्रिक्स** | CPU, मेमोरी, नेटवर्क I/O और रीस्टार्ट |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **क्लस्टर मेट्रिक्स** | नोड की स्थितियाँ, आवंटन योग्य रिसोर्स, पॉड और वर्कलोड की गिनती |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes इवेंट** | चेतावनियाँ, त्रुटियाँ और शेड्यूलिंग इवेंट |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **पॉड लॉग** | हर कंटेनर का stdout/stderr, हर नोड से पढ़ा गया |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **ऐप्लिकेशन ट्रेस** *(eBPF)* | हर पॉड से HTTP, gRPC और SQL/Redis span, बिना SDK या कोड बदलाव के |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **रिक्वेस्ट मेट्रिक्स और सर्विस ग्राफ़** *(eBPF)* | हर सर्विस के लिए रिक्वेस्ट दर, त्रुटियाँ और लेटेंसी, और सर्विस मैप के लिए कॉलर → कॉली के किनारे |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **नेटवर्क फ़्लो** *(eBPF)* | पॉड-से-पॉड TCP/UDP बाइट और पैकेट काउंटर |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **वर्कलोड लागत** *(डिफ़ॉल्ट रूप से चालू)* | हर नेमस्पेस, वर्कलोड और पॉड का ख़र्च, खाली क्षमता और दक्षता के साथ, अलर्ट के लिए मेट्रिक्स के रूप में भी |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "आपका क्लस्टर `hostPath` वॉल्यूम या विशेषाधिकार वाले पॉड रोकता है। **GKE Autopilot** और **EKS Fargate** पर यह सामान्य है: इस गाइड में सबसे ऊपर वह प्लेटफ़ॉर्म चुनें और उसके चरणों का पालन करें। इसके उलट **OpenShift** पर इंस्टॉल सफल होता है, लेकिन एजेंट के नोड पॉड कभी शुरू नहीं होते: **Red Hat OpenShift** चुनें।",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "प्रतिबंधात्मक Pod Security नीति वाले किसी भी दूसरे क्लस्टर पर विफल रिलीज़ हटाएँ:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "फिर `--set preset=gke-autopilot` जोड़कर इंस्टॉल कमांड दोबारा चलाएँ। वह प्रीसेट hostPath के बजाय Kubernetes API से पॉड लॉग पढ़ता है, एक सख़्त सुरक्षा संदर्भ लागू करता है, और विशेषाधिकार वाले eBPF और प्रोफ़ाइलिंग पॉड छोड़ देता है।",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. जाँचें कि एजेंट के पॉड चल रहे हैं: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. कलेक्टर के लॉग जाँचें: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. पुष्टि करें कि इंस्टॉल कमांड में OneUptime URL और इंजेशन कुंजी सही हैं।",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. पक्का करें कि क्लस्टर नेटवर्क पर आपके OneUptime इंस्टेंस तक पहुँच सकता है।",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. AI एजेंट का पॉड जाँचें: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. उसके लॉग जाँचें: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. कोई पॉड नहीं? chart को अपग्रेड करें (उन्नत में **एजेंट को अपग्रेड या अनइंस्टॉल करें** देखें) और `--set aiAgent.enabled=true` जोड़ें।",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. जाँचें कि क्लस्टर का नाम मेल खाता है: यह गाइड **`my-cluster`** इंस्टॉल करती है।",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. एजेंट की RBAC अनुमतियों की पुष्टि करें: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. कलेक्टर के लॉग में एक्सपोर्ट त्रुटियाँ देखें: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **कर्नेल बहुत पुराना है या BTF नहीं है।** eBPF को BTF के साथ Linux 5.8+ चाहिए; किसी नोड पर `uname -r` से जाँचें। अगर आप अपग्रेड नहीं कर सकते, तो `--set ebpf.enabled=false` से eBPF बंद करें।",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **विशेषाधिकार वाले पॉड रोके गए।** कुछ कड़े क्लस्टर उन्हें अस्वीकार कर देते हैं। eBPF बंद करें।",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **होस्ट पर `debugfs` / `tracefs` उपलब्ध नहीं।** सिर्फ़ TCP आँकड़ों का परिवार बंद करें: `--set ebpf.features.tcpStats=false`।",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. जाँचें कि eBPF पॉड ठीक हैं: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. यह पुष्टि करने के लिए कि OBI ट्रैफ़िक देखता है, उसका डीबग आउटपुट चालू करें: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, फिर `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200` पढ़ें।",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. अगर span वहाँ दिखते हैं लेकिन OneUptime में नहीं, तो कलेक्टर के लॉग में एक्सपोर्ट त्रुटियाँ देखें: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;

import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The OpenStack setup guide in Danish (#8341): each piece of the English
 * guide's markdown (Pages/OpenStack/Utils/DocumentationMarkdown.ts) and its
 * Danish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Danish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "With `enable_prometheus` on in `/etc/kolla/globals.yml`, which Kolla-Ansible leaves off until you set it, it runs Prometheus, Alertmanager and an exporter for each thing under the cloud, and ships no alert rules. This guide reads what those run rather than starting a second copy.":
    "Med `enable_prometheus` slået til i `/etc/kolla/globals.yml`, som Kolla-Ansible lader være slået fra, indtil du sætter den, kører det Prometheus, Alertmanager og en exporter for hver komponent under cloud'en og leverer ingen alarmregler. Denne guide læser det, de kører, i stedet for at starte en kopi mere.",
  "**How far this guide has been tested:** Its paths and ports were read from Kolla-Ansible's own source. Its commands were then run on a real all-in-one at stable/2026.1 with Open vSwitch, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, without Docker, on Kolla-Ansible's own exporter and on your own at the pinned version and at 1.7.0, the agent's exporter on the Infrastructure only credential, the targets read from its real prometheus.yml, and the logs profile. With Memcached really stopped there, its Alertmanager posted a firing webhook and then a resolved one, and what it posted, sent to a running OneUptime, opened one incident on the right cloud and on no other, and resolved it. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**Hvor langt denne guide er testet:** Dens stier og porte er læst fra Kolla-Ansibles egen kildekode. Dens kommandoer blev derefter kørt på en rigtig all-in-one på stable/2026.1 med Open vSwitch, med en stand-in for OneUptime, der gemte det, agenten sendte: agenten på credential'en for Fuld visning, uden Docker, på Kolla-Ansibles egen exporter og på din egen i den fastlåste version og i 1.7.0, agentens exporter på credential'en for Kun infrastruktur, målene læst fra dens rigtige prometheus.yml, og log-profilen. Med Memcached virkelig stoppet der sendte dens Alertmanager en udløst webhook og derefter en løst, og det, den sendte, videresendt til en kørende OneUptime, åbnede én hændelse på den rigtige cloud og på ingen anden og løste den. Agenten og en sonde har hver taget en rigtig DevStack hele vejen ind i en kørende OneUptime, gennem en stoppet nova-compute og tilbage igen, men ikke fra dette værktøj.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent (or `bash install.sh --without-docker`, under Advanced)":
    "Docker Engine 20.10 eller nyere med Docker Compose v2-pluginnet, på den maskine, der skal køre agenten (eller `bash install.sh --without-docker`, under Avanceret)",
  "A machine outside the cloud it watches: an agent inside a failed cloud goes quiet with it":
    "En maskine uden for den cloud, den overvåger: en agent inde i en nedbrudt cloud bliver tavs sammen med den",
  "That machine can reach Keystone and every service's API":
    "Den maskine kan nå Keystone og hver tjenestes API",
  "The `openstack` command line, as someone who can create the credential below":
    "Kommandolinjen `openstack`, som en, der kan oprette credential'en nedenfor",
  "An alert that fires becomes an incident, with on-call and status pages from the first hour, and it resolves when the alert does. There is nothing to install.":
    "En alarm, der udløses, bliver til en hændelse, med vagt og statussider fra første time, og den løses, når alarmen løses. Der er intet at installere.",
  "1. In OneUptime, make an Incoming Request monitor as [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) says, and copy its **Heartbeat URL**. That is the `<secret key>` address below.":
    "1. Opret i OneUptime en Indgående anmodning-monitor, som [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) beskriver, og kopiér dens **Heartbeat URL**. Det er adressen med `<secret key>` nedenfor.",
  "2. Open the monitor's **Overview → Linked Resources** and add the OpenStack cloud `my-openstack-cloud`. Each incident is then on that cloud's **Incidents** page, so each cloud's Alertmanager needs a monitor of its own. The cloud shows up in that list once its first data arrives, so do this after the steps below, or add the cloud under **OpenStack → All Clouds** first.":
    "2. Åbn monitorens **Oversigt → Tilknyttede ressourcer**, og tilføj OpenStack-cloud'en `my-openstack-cloud`. Hver hændelse ligger så på den clouds side **Hændelser**, så hver clouds Alertmanager skal have sin egen monitor. Cloud'en dukker op i den liste, så snart dens første data ankommer, så gør dette efter trinene nedenfor, eller tilføj først cloud'en under **OpenStack → Alle clouds**.",
  "Then, on the host you deploy from, write `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, which Kolla-Ansible reads in place of its own, and apply it:":
    "Skriv derefter, på den host du udruller fra, `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, som Kolla-Ansible læser i stedet for sin egen, og anvend den:",
  "- Log in as an admin with `source /etc/kolla/admin-openrc.sh`, which `kolla-ansible post-deploy` writes.":
    "- Log ind som administrator med `source /etc/kolla/admin-openrc.sh`, som `kolla-ansible post-deploy` skriver.",
  "- **Full view** needs one change, to Cinder. Kolla-Ansible's templates already set `service_type` under `[keystone_authtoken]` on Nova, Neutron, Glance and Placement, but its Cinder says `volume` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Add `service_type = block-storage` under `[keystone_authtoken]` in `/etc/kolla/config/cinder.conf`, then run `kolla-ansible reconfigure -i <inventory> --tags cinder`.":
    "- **Fuld visning** kræver én ændring, i Cinder. Kolla-Ansibles skabeloner sætter allerede `service_type` under `[keystone_authtoken]` på Nova, Neutron, Glance og Placement, men dens Cinder siger `volume` og dens katalog siger `block-storage`, og keystonemiddleware afviser en credential begrænset af adgangsregler med en `401`, medmindre de to stemmer overens. Tilføj `service_type = block-storage` under `[keystone_authtoken]` i `/etc/kolla/config/cinder.conf`, og kør derefter `kolla-ansible reconfigure -i <inventory> --tags cinder`.",
  "- **Infrastructure only** takes its overrides at `/etc/kolla/config/nova/policy.yaml`, and the same for `neutron`, `keystone` and `placement`, merged with anything already there. Apply them with `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.":
    "- **Kun infrastruktur** tager sine overrides i `/etc/kolla/config/nova/policy.yaml`, og det samme for `neutron`, `keystone` og `placement`, flettet med det, der allerede ligger der. Anvend dem med `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.",
  "**Recommended.** The agent sees everything it reads: services, hypervisors, every project's instances, volumes, networks and routers, and `cinder-volume` and `cinder-scheduler` state and storage pools, which only this level sees. It leaves out Keystone's users and groups, on purpose.":
    "**Anbefalet.** Agenten ser alt, hvad den læser: tjenester, hypervisorer, hvert projekts instanser, volumes, netværk og routere, samt tilstanden for `cinder-volume` og `cinder-scheduler` og lagringspuljerne, som kun dette niveau ser. Den udelader med vilje Keystones brugere og grupper.",
  "This is an application credential on an account with `admin` on a project of its own, limited by access rules to the exact `GET` calls the agent makes, so it cannot write: on every release we record, every read answered `200` and every write `401`. As an admin, make the project and the account:":
    "Dette er en application credential på en konto med `admin` på sit eget projekt, begrænset af adgangsregler til præcis de `GET`-kald, agenten foretager, så den ikke kan skrive: på hver release, vi registrerer, blev hver læsning besvaret med `200` og hver skrivning med `401`. Opret som administrator projektet og kontoen:",
  "Then, logged in as that account on that project, make the credential. An access rule is matched against the path the service sees, and a service behind a path prefix refuses the shipped rules with a `401`, so these commands fit them to this cloud from its catalog first:":
    "Opret derefter, logget ind som den konto på det projekt, credential'en. En adgangsregel sammenlignes med den sti, tjenesten ser, og en tjeneste bag et stipræfiks afviser de medfølgende regler med en `401`, så disse kommandoer tilpasser dem først til denne cloud ud fra dens katalog:",
  "- Copy the `id` and the `secret` it prints: the secret is shown only once.":
    "- Kopiér det `id` og den `secret`, den udskriver: secret'en vises kun én gang.",
  "- Never add `--unrestricted`, which would let it make more credentials.":
    "- Tilføj aldrig `--unrestricted`, som ville lade den oprette flere credentials.",
  "- Access rules work only where each service sets `service_type` in its `[keystone_authtoken]` section and has been restarted since: `compute`, `network`, `block-storage` (the rules also carry `volume` and `volumev3`, for a Cinder configured that way), `image` and `placement`. Keystone needs nothing. Without that, the services refuse the credential with a `401`.":
    "- Adgangsregler virker kun, hvor hver tjeneste sætter `service_type` i sin sektion `[keystone_authtoken]` og er genstartet siden: `compute`, `network`, `block-storage` (reglerne har også `volume` og `volumev3`, til en Cinder, der er sat sådan op), `image` og `placement`. Keystone behøver intet. Uden det afviser tjenesterne credential'en med en `401`.",
  "- If you won't change that, leave out `--access-rules`. That makes a plain admin application credential, which can write as well as read, so keep it as safe as an admin password.":
    "- Vil du ikke ændre det, så udelad `--access-rules`. Det giver en almindelig application credential for en administrator, som kan skrive såvel som læse, så pas lige så godt på den som på en administratoradgangskode.",
  "- It stops working when it expires. To replace it, make the second credential before you delete the first.":
    "- Den holder op med at virke, når den udløber. For at erstatte den skal du oprette den nye credential, før du sletter den gamle.",
  "No admin. The agent sees all of Keystone's projects, domains, services and endpoints, all of Nova including every project's instances, all of Placement, and Neutron's agents and address pools. Volumes, snapshots, networks, subnets, routers, floating IPs and ports appear only for the projects the role is assigned on, so on a project that holds nothing just the shared and external ones, and OneUptime can't see the others.":
    "Ingen administrator. Agenten ser alle Keystones projekter, domæner, tjenester og endpoints, hele Nova inklusive hvert projekts instanser, hele Placement samt Neutrons agenter og adressepuljer. Volumes, snapshots, netværk, subnet, routere, floating IP'er og porte vises kun for de projekter, rollen er tildelt på, så på et tomt projekt kun de delte og eksterne, og OneUptime kan ikke se de andre.",
  "It does not see `cinder-volume` or `cinder-scheduler` state or storage pools: Cinder's own code asks for an admin there, after policy has already passed, so no override opens them, and only **Full view** sees them.":
    "Den ser ikke tilstanden for `cinder-volume` eller `cinder-scheduler` eller lagringspuljer: Cinders egen kode kræver en administrator der, efter at policy allerede har godkendt, så ingen override åbner dem, og kun **Fuld visning** ser dem.",
  "This is a role of its own, `oneuptime_monitoring`, with the policy overrides the agent ships, on a project of its own that holds nothing and has zero quota. Where Cinder has `enforce_new_defaults` off, which is Cinder's own default, any role on a project can create that project's volumes. With nothing to touch and no quota to make anything with, there is nothing for it to write: on every release we record, every write answered `403`, or `409` and `413` from quota. As an admin, make the role, the project and an account:":
    "Dette er en rolle for sig, `oneuptime_monitoring`, med de policy-overrides, agenten leverer, på et eget projekt, der intet indeholder og har nul i kvote. Hvor Cinder har `enforce_new_defaults` slået fra, hvilket er Cinders egen standard, kan enhver rolle på et projekt oprette det projekts volumes. Uden noget at røre ved og uden kvote at oprette noget med er der intet for den at skrive: på hver release, vi registrerer, blev hver skrivning besvaret med `403`, eller med `409` og `413` på grund af kvoten. Opret som administrator rollen, projektet og en konto:",
  "Download the overrides, and merge each, on every controller, into the file named by `[oslo_policy] policy_file` in that service's config. That is `/etc/nova/policy.yaml` and so on, unless your deployment says otherwise. Each override keeps the service's default and adds the role. oslo.policy notices a changed file on its own, so nothing restarts:":
    "Download overrides'ene, og flet hver af dem, på hver controller, ind i den fil, som `[oslo_policy] policy_file` angiver i den tjenestes konfiguration. Det er `/etc/nova/policy.yaml` og så videre, medmindre din udrulning siger andet. Hver override beholder tjenestens standard og tilføjer rollen. oslo.policy opdager selv en ændret fil, så intet genstartes:",
  "**To take the overrides off again, empty the file (`{}`) and never delete it.** On Flamingo (2025.2) and Epoxy (2025.1), oslo.policy raises on every check once a policy file it has read is gone, so that service fails every request. When the service is Keystone, it stops validating tokens and the whole cloud answers `503`. If it has already happened, restart the service.":
    "**Vil du fjerne dine overrides igen, så tøm filen (`{}`), og slet den aldrig.** På Flamingo (2025.2) og Epoxy (2025.1) fejler oslo.policy ved hvert tjek, så snart en policyfil, den har læst, er væk, så den tjeneste fejler hver anmodning. Når tjenesten er Keystone, holder den op med at validere tokens, og hele cloud'en svarer `503`. Er det allerede sket, så genstart tjenesten.",
  "Then, logged in as that account on that project, make the credential and copy the `id` and the `secret` it prints:":
    "Opret derefter, logget ind som den konto på det projekt, credential'en, og kopiér det `id` og den `secret`, den udskriver:",
  "Putting the role on a real project to see its volumes and routers also lets the account write there, on a cloud where Cinder has `enforce_new_defaults` off. `troubleshoot.sh` warns when the credential's project holds things.":
    "Sætter du rollen på et rigtigt projekt for at se dets volumes og routere, kan kontoen også skrive der, på en cloud, hvor Cinder har `enforce_new_defaults` slået fra. `troubleshoot.sh` advarer, når credential'ens projekt indeholder noget.",
  "For a team watching its own part of a cloud someone else runs. The agent sees one project's volumes, networks and routers, and no infrastructure: no hypervisors, services or storage pools.":
    "Til et team, der overvåger sin egen del af en cloud, som en anden driver. Agenten ser ét projekts volumes, netværk og routere og ingen infrastruktur: ingen hypervisorer, tjenester eller lagringspuljer.",
  "Through the agent it shows no instances at all: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. Only a OneUptime probe, collecting without this agent, can list one project's instances.":
    "Gennem agenten viser dette niveau slet ingen instanser: exporteren beder Nova om alle projekters servere, Nova afviser en almindelig læser, og den læsning fejler helt. Kun en OneUptime-sonde, der indsamler uden denne agent, kan liste ét projekts instanser.",
  "This is the plain `reader` role. Give an account the role on the project:":
    "Dette er den almindelige rolle `reader`. Giv en konto rollen på projektet:",
  "Neutron and Cinder answer a reader with its own project and no error, so these lists look complete, and hold only that project.":
    "Neutron og Cinder svarer en læser med dens eget projekt og uden fejl, så disse lister ser fuldstændige ud og indeholder kun det projekt.",
  "It may be able to write. On a cloud where Cinder has `enforce_new_defaults` off, which is Cinder's own default, plain `reader` can create volumes in its project too. On Epoxy, Flamingo and Gazpacho it did, and on Hibiscus it was refused, because DevStack only turns `enforce_new_defaults` on there.":
    "Den kan måske skrive. På en cloud, hvor Cinder har `enforce_new_defaults` slået fra, hvilket er Cinders egen standard, kan en almindelig `reader` også oprette volumes i sit projekt. På Epoxy, Flamingo og Gazpacho gjorde den det, og på Hibiscus blev det afvist, fordi DevStack kun slår `enforce_new_defaults` til der.",
  "No credential and nothing new to run: the agent reads the exporter Kolla-Ansible already runs, through its internal VIP on `9198`. Skip the install's credential questions by giving it the address:":
    "Ingen credential og intet nyt at køre: agenten læser den exporter, Kolla-Ansible allerede kører, gennem dens interne VIP på `9198`. Spring installationens spørgsmål om credential over ved at give den adressen:",
  "Kolla-Ansible pins exporter 1.7.0 and runs it without `--multi-cloud`, so it has no `/probe`: the agent asks it for everything at once, every 2 minutes, on top of Kolla-Ansible's own Prometheus asking every minute. Its answer also says less. On five real clouds, the pages went without:":
    "Kolla-Ansible låser exporteren til 1.7.0 og kører den uden `--multi-cloud`, så den har ingen `/probe`: agenten beder den om alt på én gang, hvert 2. minut, oven i Kolla-Ansibles egen Prometheus, der spørger hvert minut. Dens svar siger også mindre. På fem rigtige clouds manglede siderne:",
  "| Goes without | Because | What it costs |":
    "| Mangler | Fordi | Hvad det koster |",
  "| Everything of Cinder's | It asks the catalog for `volumev3`, and finds no such thing where Cinder registers as `block-storage` | **Volumes** and **Storage pools** stay empty, and **Services** has no Block Storage API, `cinder-volume` or `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** and **Volume Stuck** stay quiet |":
    "| Alt fra Cinder | Den beder kataloget om `volumev3` og finder ikke noget sådant, hvor Cinder registrerer sig som `block-storage` | **Diskenheder** og **Lagringspuljer** forbliver tomme, og **Tjenester** har ingen Block Storage API, `cinder-volume` eller `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** og **Volume Stuck** forbliver tavse |",
  "| How many instances a hypervisor holds, and its aggregates | Nova's list of hypervisors fails at the newest microversion, which Kolla-Ansible asks for | Those two on **Hypervisors**, and what a lost host says it takes with it. Its vCPUs, memory and disk are still there: they come from Placement |":
    "| Hvor mange instanser en hypervisor har, og dens aggregater | Novas liste over hypervisorer fejler ved den nyeste mikroversion, som Kolla-Ansible beder om | De to på **Hypervisorer**, og hvad en tabt host siger, den tager med sig. Dens vCPU'er, hukommelse og disk er der stadig: de kommer fra Placement |",
  "| Domains | It has no such series | **Domains** stays empty |":
    "| Domæner | Den har ingen sådan serie | **Domæner** forbliver tom |",
  "| An image's status, visibility and creation date | It has no such labels | Those columns on **Images**. **Image Stuck** stays quiet, so an image stuck on its way to `active` goes unnoticed |":
    "| Et images status, synlighed og oprettelsesdato | Den har ingen sådanne labels | De kolonner på **Billeder**. **Image Stuck** forbliver tavs, så et image, der sidder fast på vej til `active`, går ubemærket hen |",
  "| A network's MTU | It has no such label | That line on a network's page |":
    "| Et netværks MTU | Den har ingen sådan label | Den linje på et netværks side |",
  "If you need those, use one of the other tabs and the agent's own exporter. You can change your mind later: a cloud keeps its name whichever reads it.":
    "Har du brug for dem, så brug en af de andre faner og agentens egen exporter. Du kan skifte mening senere: en cloud beholder sit navn, uanset hvad der læser den.",
  "The script asks for:": "Scriptet spørger om:",
  "- **OneUptime URL and ingestion key**, both shown in step 1. Pick a key there to have them filled in here.":
    "- **OneUptime-URL og indtagelsesnøgle**, begge vist i trin 1. Vælg en nøgle der for at få dem udfyldt her.",
  "- **Cloud name**: how the cloud appears in OneUptime. Keep it stable: a new name registers a new cloud.":
    "- **Cloudnavn**: hvordan cloud'en vises i OneUptime. Hold det stabilt: et nyt navn registrerer en ny cloud.",
  "- **Keystone auth URL**, such as `https://keystone.example.com:5000/v3`.":
    "- **Keystone-auth-URL**, såsom `https://keystone.example.com:5000/v3`.",
  "- **Region names**, comma-separated (`RegionOne` if you have one).":
    "- **Regionsnavne**, kommaseparerede (`RegionOne`, hvis du har én).",
  "- **Application credential**: the ID and secret from the previous step. Neither is echoed to the screen, and neither goes on a command line.":
    "- **Application credential**: ID'et og secret'en fra forrige trin. Ingen af dem vises på skærmen, og ingen af dem havner på en kommandolinje.",
  "- **Private CA file**, only if the cloud's certificate comes from its own certificate authority.":
    "- **Fil til privat CA**, kun hvis cloud'ens certifikat kommer fra dens egen certifikatmyndighed.",
  "It checks the credential with Keystone before it installs anything, installs to `/opt/oneuptime-openstack-agent` (or to `oneuptime-openstack-agent` in your home folder if you have no rights on `/opt`, and it says which), writes a `.env` file and a `clouds.yaml` only their owner can read, and starts everything with Docker Compose. Running it again reuses all of that instead of asking again, so it is also how you upgrade.":
    "Det tjekker credential'en hos Keystone, før det installerer noget, installerer til `/opt/oneuptime-openstack-agent` (eller til `oneuptime-openstack-agent` i din hjemmemappe, hvis du ikke har rettigheder til `/opt`, og det siger hvilken), skriver en `.env`-fil og en `clouds.yaml`, som kun deres ejer kan læse, og starter det hele med Docker Compose. Kører du det igen, genbruger det alt det i stedet for at spørge igen, så det er også sådan, du opgraderer.",
  "`docker compose ps` lists the collector (`oneuptime-openstack-agent`), the bundled exporter (`oneuptime-openstack-exporter`) and the OneUptime AI agent (`oneuptime-openstack-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cloud then appears in the **OpenStack** section by itself. Give it about five minutes to fill in: compute, network, volume and Placement are read every 2 minutes, identity and images every 5.":
    "`docker compose ps` viser collectoren (`oneuptime-openstack-agent`), den medfølgende exporter (`oneuptime-openstack-exporter`) og OneUptimes AI-agent (`oneuptime-openstack-ai-agent`). Kig i collectorens logs efter `Everything is ready. Begin running and processing data.` Cloud'en dukker derefter selv op i sektionen **OpenStack**. Giv den omkring fem minutter til at blive udfyldt: compute, netværk, volumes og Placement læses hvert 2. minut, identitet og images hvert 5.",
  "On the host that runs Kolla-Ansible's Prometheus, this reads its targets from the file Kolla-Ansible rendered, and prints them as settings for the agent:":
    "På den host, der kører Kolla-Ansibles Prometheus, læser dette dens mål fra den fil, Kolla-Ansible genererede, og udskriver dem som indstillinger til agenten:",
  "Add what it prints to the agent's `.env`, then run `docker compose up -d` in the agent's folder. Each exporter listens on the API network, so the agent's machine needs a route there. The cloud's **Control Plane** card then says how each one is, and says plainly which ones are not watched.":
    "Tilføj det, den udskriver, til agentens `.env`, og kør derefter `docker compose up -d` i agentens mappe. Hver exporter lytter på API-netværket, så agentens maskine skal have en rute dertil. Cloud'ens kort **Kontrolplan** siger så, hvordan hver enkelt har det, og siger klart, hvilke der ikke overvåges.",
  "| Reads | Port | Setting |": "| Læser | Port | Indstilling |",
  "| RabbitMQ's Prometheus plugin | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |":
    "| RabbitMQ's Prometheus-plugin | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |",
  "| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |":
    "| mysqld_exporter, til MariaDB | `9104` | `OPENSTACK_MARIADB_TARGETS` |",
  "| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |":
    "| memcached_exporter, til Memcached | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |",
  "| HAProxy's own exporter | `9101` | `OPENSTACK_HAPROXY_TARGETS` |":
    "| HAProxys egen exporter | `9101` | `OPENSTACK_HAPROXY_TARGETS` |",
  "| openstack-network-exporter, for OVN and Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |":
    "| openstack-network-exporter, til OVN og Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |",
  "| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |":
    "| prometheus-libvirt-exporter, til libvirt | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |",
  "- **OVN's databases:** Kolla-Ansible runs openstack-network-exporter from 2026.1, on compute and network nodes only, and an OVN database is read from the host it runs on. If your control nodes are neither, add them under `[prometheus-openstack-network-exporter:children]` in your inventory and reconfigure, or the Northbound and Southbound databases read as not watched.":
    "- **OVN's databaser:** Kolla-Ansible kører openstack-network-exporter fra 2026.1, kun på compute- og netværksnoder, og en OVN-database læses fra den host, den kører på. Er dine kontrolnoder ingen af delene, så tilføj dem under `[prometheus-openstack-network-exporter:children]` i dit inventory og omkonfigurér, ellers vises Northbound- og Southbound-databaserne som ikke overvåget.",
  "- **Before 2026.1** there is no network exporter, so OVN and Open vSwitch read as not watched.":
    "- **Før 2026.1** er der ingen netværks-exporter, så OVN og Open vSwitch vises som ikke overvåget.",
  "The agent's logs profile runs on each node, and reads Kolla-Ansible's files. It is what joins a line to the cloud's pages:":
    "Agentens log-profil kører på hver node og læser Kolla-Ansibles filer. Det er den, der knytter en linje til cloud'ens sider:",
  "Kolla's own Fluentd can forward too, with an output in `/etc/kolla/config/fluentd/output/*.conf` as [Fluentd](/docs/telemetry/fluentd) describes, but those records reach **Logs** under a service's name, and not the cloud's pages.":
    "Kollas egen Fluentd kan også videresende, med et output i `/etc/kolla/config/fluentd/output/*.conf`, som [Fluentd](/docs/telemetry/fluentd) beskriver, men de poster når **Protokoller** under en tjenestes navn og ikke cloud'ens sider.",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from `/var/log/kolla`.":
    "Hver skriver til tjenestens egen log, uden nogen forbruger på bussen. OneUptime læser dem derfra, så snart **Find sikkerhedshændelser i dine logs** er slået til under **Sikkerhedshændelser → Forbindelser**. Agentens log-profil læser begge fra `/var/log/kolla`.",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw.":
    "Det sender en linje for hvert login, som **OpenStack admin credential used from a new address** læser. Vil du kun sende mislykkede logins, så tilføj `identity.authenticate.success` til `notification_opt_out`; den detektion læser så, hvad auditfilteret så.",
  "For who did what through Nova, Neutron, Cinder and Glance, the audit filter needs a setting, which goes in every service's config at once:":
    "For at se, hvem der gjorde hvad gennem Nova, Neutron, Cinder og Glance, har auditfilteret brug for en indstilling, som kommer i alle tjenesters konfiguration på én gang:",
  "It also needs a paste file, and Kolla-Ansible's config tasks copy no paste file for these services. Put yours on each API host, and mount it over the one in the image with `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` and `glance_api_extra_volumes` in `globals.yml`. pyCADF's map files are in `/var/lib/kolla/venv/etc/pycadf` in the image. [Who did what](/docs/telemetry/openstack#who-did-what) has the filter's lines.":
    "Det har også brug for en paste-fil, og Kolla-Ansibles konfigurationsopgaver kopierer ingen paste-fil til disse tjenester. Læg din på hver API-host, og montér den over den i imaget med `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` og `glance_api_extra_volumes` i `globals.yml`. pyCADF's map-filer ligger i `/var/lib/kolla/venv/etc/pycadf` i imaget. [Hvem gjorde hvad](/docs/telemetry/openstack#who-did-what) har filterets linjer.",
  "OpenStack's `reader` role is scoped to a project everywhere except Keystone and Ironic, and hypervisors, services, agents, pools and Placement default to admin. A policy override can't open all-project lists in Cinder or Neutron, because they scope those lists in code, and Cinder's own code keeps its services and storage pools for an admin. So what a credential can read depends on which level you choose. This is what five real clouds answered, on Epoxy, Flamingo, Gazpacho (OVN and OVS) and Hibiscus:":
    "OpenStacks rolle `reader` er begrænset til ét projekt overalt undtagen i Keystone og Ironic, og hypervisorer, tjenester, agenter, puljer og Placement er som standard forbeholdt administratoren. En policy-override kan ikke åbne lister over alle projekter i Cinder eller Neutron, fordi de begrænser de lister i koden, og Cinders egen kode forbeholder sine tjenester og lagringspuljer en administrator. Så hvad en credential kan læse, afhænger af, hvilket niveau du vælger. Det her svarede fem rigtige clouds, på Epoxy, Flamingo, Gazpacho (OVN og OVS) og Hibiscus:",
  "| Read | Level 1: Full view | Level 2: Infrastructure only | Level 3: Project view |":
    "| Læsning | Niveau 1: Fuld visning | Niveau 2: Kun infrastruktur | Niveau 3: Projektvisning |",
  "| Keystone: projects | all | all | refused |":
    "| Keystone: projekter | alt | alt | afvist |",
  "| Keystone: domains | all | all | refused |":
    "| Keystone: domæner | alt | alt | afvist |",
  "| Keystone: regions | all | what anyone sees | what anyone sees |":
    "| Keystone: regioner | alt | hvad alle ser | hvad alle ser |",
  "| Keystone: services | all | all | refused |":
    "| Keystone: tjenester | alt | alt | afvist |",
  "| Keystone: endpoints | all | all | refused |":
    "| Keystone: endpoints | alt | alt | afvist |",
  "| Nova: servers, all projects | all | all | refused |":
    "| Nova: servere, alle projekter | alt | alt | afvist |",
  "| Nova: services | all | all | refused |":
    "| Nova: tjenester | alt | alt | afvist |",
  "| Nova: hypervisors | all | all | refused |":
    "| Nova: hypervisorer | alt | alt | afvist |",
  "| Nova: aggregates | all | all | refused |":
    "| Nova: aggregater | alt | alt | afvist |",
  "| Nova: availability zones, detail | all | all | refused |":
    "| Nova: tilgængelighedszoner, detaljer | alt | alt | afvist |",
  "| Nova: flavors | all | what anyone sees | what anyone sees |":
    "| Nova: flavors | alt | hvad alle ser | hvad alle ser |",
  "| Nova: usage per project | all | all | refused |":
    "| Nova: forbrug pr. projekt | alt | alt | afvist |",
  "| Placement: resource providers | all | all | refused |":
    "| Placement: ressourceudbydere | alt | alt | afvist |",
  "| Neutron: agents | all | all | nothing |":
    "| Neutron: agenter | alt | alt | intet |",
  "| Neutron: networks | all | own project only | own project only |":
    "| Neutron: netværk | alt | kun eget projekt | kun eget projekt |",
  "| Neutron: subnets | all | own project only | own project only |":
    "| Neutron: subnet | alt | kun eget projekt | kun eget projekt |",
  "| Neutron: routers | all | own project only | own project only |":
    "| Neutron: routere | alt | kun eget projekt | kun eget projekt |",
  "| Neutron: floating IPs | all | own project only | own project only |":
    "| Neutron: floating IP'er | alt | kun eget projekt | kun eget projekt |",
  "| Neutron: IP availabilities | all | all | nothing |":
    "| Neutron: IP-tilgængelighed | alt | alt | intet |",
  "| Neutron: security groups | all | 409, expected | own project only |":
    "| Neutron: sikkerhedsgrupper | alt | 409, forventet | kun eget projekt |",
  "| Neutron: ports | all | own project only | own project only |":
    "| Neutron: porte | alt | kun eget projekt | kun eget projekt |",
  "| Neutron: quotas | all | refused | refused |":
    "| Neutron: kvoter | alt | afvist | afvist |",
  "| Cinder: volumes, all projects | all | own project only | own project only |":
    "| Cinder: volumes, alle projekter | alt | kun eget projekt | kun eget projekt |",
  "| Cinder: services | all | refused | refused |":
    "| Cinder: tjenester | alt | afvist | afvist |",
  "| Cinder: pools | all | refused | refused |":
    "| Cinder: puljer | alt | afvist | afvist |",
  "| Cinder: snapshots, all projects | all | own project only | own project only |":
    "| Cinder: snapshots, alle projekter | alt | kun eget projekt | kun eget projekt |",
  "| Cinder: backups, all projects | all | none recorded | none recorded |":
    "| Cinder: backups, alle projekter | alt | intet registreret | intet registreret |",
  "| Cinder: volume types | all | what anyone sees | what anyone sees |":
    "| Cinder: volumetyper | alt | hvad alle ser | hvad alle ser |",
  "| Glance: images | all | what anyone sees | what anyone sees |":
    "| Glance: images | alt | hvad alle ser | hvad alle ser |",
  "- **all**: the same rows an admin saw.":
    "- **alt**: de samme rækker, som en administrator så.",
  "- **own project only**: that project's rows, and anything shared or external. On a project that holds nothing, that is just the shared and external ones.":
    "- **kun eget projekt**: det projekts rækker og alt, der er delt eller eksternt. På et tomt projekt er det kun de delte og eksterne.",
  "- **refused**: a `401` or a `403`.":
    "- **afvist**: en `401` eller en `403`.",
  "- **what anyone sees**: every credential saw every row, on clouds that hold only public flavors, volume types and images. A private one in another project takes **Full view**.":
    "- **hvad alle ser**: hver credential så hver række, på clouds, der kun har offentlige flavors, volumetyper og images. Et privat element i et andet projekt kræver **Fuld visning**.",
  "- **nothing**: a `200` with no rows, on a project that has networks too. It looks like it worked, and it did not.":
    "- **intet**: en `200` uden rækker, på et projekt, der også har netværk. Det ser ud, som om det virkede, og det gjorde det ikke.",
  "- **none recorded**: a `200` with no rows where an admin saw none either, so there was nothing to tell by.":
    "- **intet registreret**: en `200` uden rækker, hvor en administrator heller ikke så nogen, så der var intet at skelne ud fra.",
  "- **409, expected**: Neutron tries to create the project's default security group when it lists them, and zero quota does not let it, so it answers `409 Quota exceeded`. That is harmless, and nothing to fix.":
    "- **409, forventet**: Neutron prøver at oprette projektets standardsikkerhedsgruppe, når den lister dem, og en kvote på nul tillader det ikke, så den svarer `409 Quota exceeded`. Det er harmløst, og der er intet at rette.",
  "A list a credential can't read looks empty here: `troubleshoot.sh` says what this credential can read, and what each gap costs.":
    "En liste, som en credential ikke kan læse, ser tom ud her: `troubleshoot.sh` siger, hvad denne credential kan læse, og hvad hvert hul koster.",
  "Monitoring must never be what takes a cloud down, so the agent is gentle by default:":
    "Overvågning må aldrig være det, der vælter en cloud, så agenten er skånsom som standard:",
  "| Reads | Every | Gives |": "| Læser | Hvert | Giver |",
  "| **Compute (Nova)** | 2 minutes | Services, hypervisors, instances and flavors |":
    "| **Compute (Nova)** | 2. minut | Tjenester, hypervisorer, instanser og flavors |",
  "| **Placement** | 2 minutes | What each hypervisor can promise, and has promised |":
    "| **Placement** | 2. minut | Hvad hver hypervisor kan love, og har lovet |",
  "| **Networking (Neutron)** | 2 minutes | Agents, networks, subnets, address use, routers and floating IPs |":
    "| **Netværk (Neutron)** | 2. minut | Agenter, netværk, subnet, adresseforbrug, routere og floating IP'er |",
  "| **Block Storage (Cinder)** | 2 minutes | Services, volumes, snapshots and storage pools |":
    "| **Bloklagring (Cinder)** | 2. minut | Tjenester, volumes, snapshots og lagringspuljer |",
  "| **Identity (Keystone)** | 5 minutes | Projects and domains |":
    "| **Identitet (Keystone)** | 5. minut | Projekter og domæner |",
  "| **Images (Glance)** | 5 minutes | Images |":
    "| **Images (Glance)** | 5. minut | Images |",
  "- Each service is read on its own, so a failing Nova costs only Nova's numbers, and the rest keep reporting.":
    "- Hver tjeneste læses for sig, så en Nova, der fejler, koster kun Novas tal, og resten bliver ved med at rapportere.",
  "- A read never outlasts its interval, so a slow one never stacks on the next.":
    "- En læsning varer aldrig længere end sit interval, så en langsom hober sig aldrig op oven på den næste.",
  "- Each project's quotas are off. To turn them on, run the installer again with `OPENSTACK_COLLECT_QUOTAS=true`: a second exporter reads them once an hour, at four calls per project per region. Neutron's quotas answer only **Full view**.":
    "- Hvert projekts kvoter er slået fra. Kør installationsprogrammet igen med `OPENSTACK_COLLECT_QUOTAS=true` for at slå dem til: en ekstra exporter læser dem én gang i timen, med fire kald pr. projekt pr. region. Neutrons kvoter svarer kun **Fuld visning**.",
  "- Nova's own quota lists and usage per server are off. To turn one on, delete its `--disable-metric` line from the exporter's `command` in `docker-compose.yml`. The cost is one call per project per scrape.":
    "- Novas egne kvotelister og forbrug pr. server er slået fra. Slet den tilhørende linje `--disable-metric` fra exporterens `command` i `docker-compose.yml` for at slå en af dem til. Prisen er ét kald pr. projekt pr. indsamling.",
  "- The per-port series are off: listing every port with an admin credential can saturate Neutron on a large cloud.":
    "- Serierne pr. port er slået fra: at liste hver port med en administrator-credential kan mætte Neutron på en stor cloud.",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Give the install script every region's name. It writes one `clouds.yaml` entry for each. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "En cloud er én Keystone, uanset hvor mange regioner den har, og én agent læser dem alle. Giv installationsscriptet hver regions navn. Det skriver en `clouds.yaml`-post for hver. Hver post skal være opkaldt efter sin region: collectoren sætter det navn på exporterens serier som `openstack.region.name`, fordi serierne ikke siger, hvilken region de kommer fra. Hver liste i OneUptime kan så filtreres efter region.",
  "Regions with a Keystone of their own are separate clouds to OneUptime: run one agent for each.":
    "Regioner med deres egen Keystone er separate clouds for OneUptime: kør én agent for hver.",
  "**[Very Large OpenStack Clouds](/docs/telemetry/openstack-very-large-clouds)** has what each size costs and how each of these works.":
    "**[Meget store OpenStack-clouds](/docs/telemetry/openstack-very-large-clouds)** beskriver, hvad hver størrelse koster, og hvordan hver af disse muligheder virker.",
  "**Past 5,000 instances, summary mode.** The cloud keeps a row for every part and counts per hypervisor, project and status, and its series per instance and per volume stop. It gives up the history of each settled instance's and volume's status, and a chart or a monitor over those series. An instance or volume in a state an alert watches keeps its series, so every alert template goes on working. To keep them for some, choose their projects under **Real usage per instance** on the cloud's **Settings** page.":
    "**Over 5.000 instanser: opsummeringstilstand.** Cloud'en beholder en række for hver del og optællinger pr. hypervisor, projekt og status, og dens serier pr. instans og pr. volume stopper. Den opgiver historikken over hver faldet-til-ro instans' og volumes status samt diagrammer og monitorer over de serier. En instans eller et volume i en tilstand, som en alarm holder øje med, beholder sine serier, så hver alarmskabelon bliver ved med at virke. Vil du beholde dem for nogle, så vælg deres projekter under **Reelt forbrug pr. instans** på cloud'ens side **Indstillinger**.",
  "**Sharing a cloud between agents.** Run one agent per region, or per service for the largest clouds, each with the same `OPENSTACK_CLOUD_NAME`. A region and a service belong to one agent, and Keystone to one agent for the whole cloud, or their series arrive twice. List an agent's regions in `OPENSTACK_EXPORTER_CLOUDS`, and its services in `OPENSTACK_AGENT_SERVICES`, such as `compute|placement`.":
    "**Del en cloud mellem flere agenter.** Kør én agent pr. region, eller pr. tjeneste for de største clouds, hver med det samme `OPENSTACK_CLOUD_NAME`. En region og en tjeneste hører til én agent, og Keystone til én agent for hele cloud'en, ellers ankommer deres serier to gange. Angiv en agents regioner i `OPENSTACK_EXPORTER_CLOUDS` og dens tjenester i `OPENSTACK_AGENT_SERVICES`, såsom `compute|placement`.",
  "**Past 1,500 hypervisors or 100,000 instances, the database path.** The agent can read the cloud's databases rather than its APIs, which at that size cannot be read in a scrape's time. It asks for a read-only account on each service's database, a route to them from this machine, and one exporter per region and Nova cell. It reads the same series, but for whether each Nova worker is alive and how full each storage pool is, which it still reads from the API, and it cannot say whether an API answers. It has not yet been run against a real database.":
    "**Over 1.500 hypervisorer eller 100.000 instanser: databasevejen.** Agenten kan læse cloud'ens databaser i stedet for dens API'er, som ved den størrelse ikke kan læses inden for en indsamlings tid. Den kræver en skrivebeskyttet konto på hver tjenestes database, en rute til dem fra denne maskine og én exporter pr. region og Nova-celle. Den læser de samme serier, bortset fra om hver Nova-worker lever, og hvor fuld hver lagringspulje er, som den stadig læser fra API'et, og den kan ikke sige, om et API svarer. Den er endnu ikke kørt mod en rigtig database.",
  "The install script writes these to `/opt/oneuptime-openstack-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`.":
    "Installationsscriptet skriver disse til `/opt/oneuptime-openstack-agent/.env`. Når du har ændret en, så anvend den med `docker compose up -d` i `/opt/oneuptime-openstack-agent`.",
  "| Variable | Required | Description |":
    "| Variabel | Påkrævet | Beskrivelse |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL'en til din OneUptime-instans (f.eks. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key: the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Indtagelsesnøgle til telemetri: den, du valgte i trin 1 |",
  "| `OPENSTACK_CLOUD_NAME` | Yes | The cloud's name in OneUptime, stamped on every metric as the `openstack.cloud.name` resource attribute. Keep it stable: changing it registers a new cloud |":
    "| `OPENSTACK_CLOUD_NAME` | Ja | Cloud'ens navn i OneUptime, sat på hver metrik som ressourceattributten `openstack.cloud.name`. Hold det stabilt: ændres det, registreres en ny cloud |",
  "| `OPENSTACK_EXPORTER_CLOUDS` | Yes | The `clouds.yaml` entries to read, one per region and named for the region, in square brackets: `[RegionOne,RegionTwo]` |":
    "| `OPENSTACK_EXPORTER_CLOUDS` | Ja | De `clouds.yaml`-poster, der skal læses, én pr. region og opkaldt efter regionen, i kantede parenteser: `[RegionOne,RegionTwo]` |",
  "| `OPENSTACK_AUTH_URL` | Bundled exporter | The Keystone auth URL. `/v3` is added if it is missing |":
    "| `OPENSTACK_AUTH_URL` | Medfølgende exporter | Keystones auth-URL. `/v3` tilføjes, hvis det mangler |",
  "| `OPENSTACK_EXPORTER_ADDRESS` | No | `host:port` of your own exporter, with no scheme. Leave it out for the bundled one |":
    "| `OPENSTACK_EXPORTER_ADDRESS` | Nej | `host:port` for din egen exporter, uden skema. Udelad den for den medfølgende |",
  "| `OPENSTACK_QUOTA_CLOUDS` | No | The `clouds.yaml` entries to read each project's quotas from, once an hour. The install script sets it when run with `OPENSTACK_COLLECT_QUOTAS=true` |":
    "| `OPENSTACK_QUOTA_CLOUDS` | Nej | De `clouds.yaml`-poster, som hvert projekts kvoter læses fra, én gang i timen. Installationsscriptet sætter den, når det køres med `OPENSTACK_COLLECT_QUOTAS=true` |",
  "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | No | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | Nej | `host:port` for den exporter, der læser dem. Udelad den for den medfølgende |",
  "| `OPENSTACK_EXPORTER_USER` | No | The `uid:gid` the exporter's container runs as, which must own `clouds.yaml` (default: `65532:65532`) |":
    "| `OPENSTACK_EXPORTER_USER` | Nej | Den `uid:gid`, exporterens container kører som, og som skal eje `clouds.yaml` (standard: `65532:65532`) |",
  "| `OPENSTACK_CA_FILE` | No | A PEM file with the certificate authority of a cloud that has its own |":
    "| `OPENSTACK_CA_FILE` | Nej | En PEM-fil med certifikatmyndigheden for en cloud, der har sin egen |",
  "| `COMPOSE_PROFILES` | Bundled exporter | `openstack-exporter` starts the bundled exporter, and `openstack-ai-agent` the OneUptime AI agent |":
    "| `COMPOSE_PROFILES` | Medfølgende exporter | `openstack-exporter` starter den medfølgende exporter, og `openstack-ai-agent` OneUptimes AI-agent |",
  "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | No | An exporter already running without `--multi-cloud`, such as Kolla-Ansible's: `[10.0.0.254:9198]`. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it |":
    "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | Nej | En exporter, der allerede kører uden `--multi-cloud`, såsom Kolla-Ansibles: `[10.0.0.254:9198]`. Sæt `OPENSTACK_EXPORTER_CLOUDS=[]` sammen med den |",
  "| `OPENSTACK_RABBITMQ_TARGETS` | No | RabbitMQ's Prometheus plugin on each node: `[10.0.0.11:15692,10.0.0.12:15692]` |":
    "| `OPENSTACK_RABBITMQ_TARGETS` | Nej | RabbitMQ's Prometheus-plugin på hver node: `[10.0.0.11:15692,10.0.0.12:15692]` |",
  "| `OPENSTACK_MARIADB_TARGETS` | No | mysqld_exporter beside each MariaDB node, usually on `9104` |":
    "| `OPENSTACK_MARIADB_TARGETS` | Nej | mysqld_exporter ved siden af hver MariaDB-node, som regel på `9104` |",
  "| `OPENSTACK_MEMCACHED_TARGETS` | No | memcached_exporter beside each Memcached, usually on `9150` |":
    "| `OPENSTACK_MEMCACHED_TARGETS` | Nej | memcached_exporter ved siden af hver Memcached, som regel på `9150` |",
  "| `OPENSTACK_HAPROXY_TARGETS` | No | HAProxy's own Prometheus exporter |":
    "| `OPENSTACK_HAPROXY_TARGETS` | Nej | HAProxys egen Prometheus-exporter |",
  "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | No | openstack-network-exporter on each node, for OVN and Open vSwitch, usually on `1981` |":
    "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | Nej | openstack-network-exporter på hver node, til OVN og Open vSwitch, som regel på `1981` |",
  "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | No | prometheus-libvirt-exporter on each compute node, usually on `9177`, for whether libvirt answers and nothing per instance |":
    "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | Nej | prometheus-libvirt-exporter på hver compute-node, som regel på `9177`, til om libvirt svarer, og intet pr. instans |",
  "| `OPENSTACK_CONTROL_PLANE_REGION` | No | The region of a target above that does not say its own. A target can: `RegionTwo@10.1.0.11:15692` |":
    "| `OPENSTACK_CONTROL_PLANE_REGION` | Nej | Regionen for et mål ovenfor, der ikke angiver sin egen. Et mål kan: `RegionTwo@10.1.0.11:15692` |",
  "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | No | The same exporter, for what each instance is really doing. Per-instance series multiply fast |":
    "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | Nej | Den samme exporter, til hvad hver instans virkelig laver. Serier pr. instans mangedobles hurtigt |",
  "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | No | Ceilometer's exporter on each compute node, usually on `9101`, for the same |":
    "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | Nej | Ceilometers exporter på hver compute-node, som regel på `9101`, til det samme |",
  "`clouds.yaml` alone holds the credential.":
    "Kun `clouds.yaml` indeholder credential'en.",
  "Only the largest clouds need these, and none is asked for:":
    "Kun de største clouds har brug for disse, og der spørges ikke om nogen af dem:",
  "| Variable | Description |": "| Variabel | Beskrivelse |",
  "| `OPENSTACK_AGENT_SERVICES` | Which services this agent reads, as a pattern: `compute\\|placement` here and the rest on a second agent. Every service by default. No two agents should read one service of one region |":
    "| `OPENSTACK_AGENT_SERVICES` | Hvilke tjenester denne agent læser, som et mønster: `compute\\|placement` her og resten på en anden agent. Alle tjenester som standard. To agenter må aldrig læse den samme tjeneste i én region |",
  "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | The memory the collector may use, in MiB (default: `512`). It holds a whole scrape, so raise this past tens of thousands of instances |":
    "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | Den hukommelse, collectoren må bruge, i MiB (standard: `512`). Den holder en hel indsamling, så hæv den, når du kommer over titusindvis af instanser |",
  "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | Reading each service's database rather than its API, with a read-only account: where that exporter answers. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it, or every series arrives twice |":
    "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | Læsning af hver tjenestes database i stedet for dens API, med en skrivebeskyttet konto: hvor den exporter svarer. Sæt `OPENSTACK_EXPORTER_CLOUDS=[]` sammen med den, ellers ankommer hver serie to gange |",
  "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | The database of each service it reads, as `mysql+pymysql://oneuptime:secret@db.example:3306/nova`. One left empty is a service it leaves alone. Each holds a password, and `.env` is readable by its owner alone |":
    "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | Databasen for hver tjeneste, den læser, som `mysql+pymysql://oneuptime:secret@db.example:3306/nova`. En, der står tom, er en tjeneste, den lader være. Hver indeholder en adgangskode, og `.env` kan kun læses af sin ejer |",
  "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | What Nova adds to a host's name to make a hypervisor's, such as `.example.org`, so an instance finds the hypervisor it runs on |":
    "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | Det, Nova føjer til en hosts navn for at danne en hypervisors, såsom `.example.org`, så en instans finder den hypervisor, den kører på |",
  "| `OPENSTACK_WORKER_STATE_CLOUDS` | The `clouds.yaml` entries to read from Nova's and Cinder's APIs what their databases cannot say: whether each worker is alive, and how full each pool is |":
    "| `OPENSTACK_WORKER_STATE_CLOUDS` | De `clouds.yaml`-poster, der bruges til at læse fra Novas og Cinders API'er, hvad deres databaser ikke kan sige: om hver worker lever, og hvor fuld hver pulje er |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | `host:port` for den exporter, der læser dem. Udelad den for den medfølgende |",
  "| `OPENSTACK_QUOTA_CLOUDS` | The `clouds.yaml` entries to read each project's quotas from, once an hour. Empty reads none, and `OPENSTACK_COLLECT_QUOTAS=true` in the install script fills it in |":
    "| `OPENSTACK_QUOTA_CLOUDS` | De `clouds.yaml`-poster, som hvert projekts kvoter læses fra, én gang i timen. Tom læser ingen, og `OPENSTACK_COLLECT_QUOTAS=true` i installationsscriptet udfylder den |",
  "The OneUptime AI agent reads the credential in `clouds.yaml` unless these say otherwise, and none is asked for:":
    "OneUptimes AI-agent læser credential'en i `clouds.yaml`, medmindre disse siger andet, og der spørges ikke om nogen af dem:",
  "| `ONEUPTIME_AI_INVESTIGATION` | `false` stops OneUptime AI investigating this cloud with the agent |":
    "| `ONEUPTIME_AI_INVESTIGATION` | `false` forhindrer OneUptime AI i at undersøge denne cloud med agenten |",
  "| `OPENSTACK_AI_CLOUDS_FILE` | The `clouds.yaml` it mounts. `/dev/null` when it has a credential of its own and there is no such file beside it |":
    "| `OPENSTACK_AI_CLOUDS_FILE` | Den `clouds.yaml`, den monterer. `/dev/null`, når den har sin egen credential, og der ikke ligger en sådan fil ved siden af |",
  "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | The entry of `clouds.yaml` to use, when it is not the first of `OPENSTACK_EXPORTER_CLOUDS` |":
    "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | Den post i `clouds.yaml`, der skal bruges, når det ikke er den første i `OPENSTACK_EXPORTER_CLOUDS` |",
  "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | A credential of its own, used instead of `clouds.yaml`'s. Set both, with `OPENSTACK_AUTH_URL` |":
    "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | En egen credential, der bruges i stedet for den i `clouds.yaml`. Sæt begge, sammen med `OPENSTACK_AUTH_URL` |",
  "| `OPENSTACK_AUTH_URL` | The Keystone a credential of its own logs in to |":
    "| `OPENSTACK_AUTH_URL` | Den Keystone, en egen credential logger ind på |",
  "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | The region a command reads when it names none, which endpoints it uses (`public`, `internal` or `admin`), and a certificate authority. `clouds.yaml` says these unless they do |":
    "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | Den region, en kommando læser, når den ikke nævner nogen, hvilke endpoints den bruger (`public`, `internal` eller `admin`), og en certifikatmyndighed. `clouds.yaml` angiver disse, medmindre de gør |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | The name it registers under, when it is not `OPENSTACK_CLOUD_NAME` |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | Det navn, den registrerer sig under, når det ikke er `OPENSTACK_CLOUD_NAME` |",
  "| `LOG_LEVEL` | How much it logs |":
    "| `LOG_LEVEL` | Hvor meget den logger |",
  "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | Off until set: let it make changes, through a credential of their own. The OpenStack guide says how to make it with the least it needs |":
    "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | Slået fra, indtil de sættes: lader den foretage ændringer, gennem deres egen credential. OpenStack-guiden siger, hvordan du opretter den med det mindste, den har brug for |",
  "| `ONEUPTIME_AI_FIXES` | How AI may apply a fix: off, ask-for-approval, automatic or bypass-approval. Empty: fixes stay off until someone chooses on this page |":
    "| `ONEUPTIME_AI_FIXES` | Hvordan AI må anvende en rettelse: off, ask-for-approval, automatic eller bypass-approval. Tom: rettelser forbliver slået fra, indtil nogen vælger på denne side |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | What is never touched, whatever else is set and whoever approves it: `project:ID`, `host:NAME` or `instance:ID`, separated by commas |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | Det, der aldrig røres, uanset hvad der ellers er sat, og hvem der godkender det: `project:ID`, `host:NAME` eller `instance:ID`, adskilt af kommaer |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | Where changes may land, written the same way. Empty: anywhere that is not protected |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | Hvor ændringer må lande, skrevet på samme måde. Tom: overalt, hvor intet er beskyttet |",
  "Set `OPENSTACK_EXPORTER_ADDRESS` as you run the install script, such as `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`. The bundled exporter then never starts, and no Keystone URL or credential is asked for.":
    "Sæt `OPENSTACK_EXPORTER_ADDRESS`, når du kører installationsscriptet, såsom `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`. Den medfølgende exporter starter så aldrig, og der spørges hverken om en Keystone-URL eller en credential.",
  "Your exporter must run with `--multi-cloud`, and its `clouds.yaml` needs an entry named for each region. Turn off what the bundled one turns off: see **What the agent collects, and what it costs your cloud**. Use an address the agent's container can reach: `localhost` inside the container is the container itself.":
    "Din exporter skal køre med `--multi-cloud`, og dens `clouds.yaml` skal have en post opkaldt efter hver region. Slå det fra, som den medfølgende slår fra: se **Hvad agenten indsamler, og hvad det koster din cloud**. Brug en adresse, agentens container kan nå: `localhost` inde i containeren er containeren selv.",
  "**Started without `--multi-cloud`?** Kolla-Ansible's is, and Canonical's charm. It has no `/probe`, so set `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` instead of the address above, with `OPENSTACK_EXPORTER_CLOUDS=[]` and `OPENSTACK_CONTROL_PLANE_REGION`. It is then asked for everything at once, every 2 minutes.":
    "**Startet uden `--multi-cloud`?** Det er Kolla-Ansibles, og Canonicals charm. Den har ingen `/probe`, så sæt `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` i stedet for adressen ovenfor, med `OPENSTACK_EXPORTER_CLOUDS=[]` og `OPENSTACK_CONTROL_PLANE_REGION`. Den bliver så spurgt om alt på én gang, hvert 2. minut.",
  "**On exporter 1.7.0,** which Kolla-Ansible pins, it answers either way, and the pages go without what it does not say. On five real clouds that was:":
    "**På exporter 1.7.0,** som Kolla-Ansible låser til, svarer den begge veje, og siderne mangler det, den ikke siger. På fem rigtige clouds var det:",
  "Give the install script the file when it asks for a private CA file. It copies it to `ca.pem`, and names it in `clouds.yaml`.":
    "Giv installationsscriptet filen, når det spørger efter en fil til privat CA. Det kopierer den til `ca.pem` og angiver den i `clouds.yaml`.",
  "On Linux (x86_64 or arm64) with systemd 235 or later and glibc 2.34 or later (not RHEL 8), the install script can run the same collector and exporter releases as systemd services instead:":
    "På Linux (x86_64 eller arm64) med systemd 235 eller nyere og glibc 2.34 eller nyere (ikke RHEL 8) kan installationsscriptet i stedet køre de samme collector- og exporter-releases som systemd-tjenester:",
  "Moving off a Docker install? Run `docker compose down` first, or every metric arrives twice. Running the script again stays whichever it was, so `sudo bash install.sh` is the upgrade.":
    "Flytter du fra en Docker-installation? Kør først `docker compose down`, ellers ankommer hver metrik to gange. Kører du scriptet igen, bliver det ved den måde, det allerede kørte på, så `sudo bash install.sh` er opgraderingen.",
  "The `resource` processor in `otel-collector-config.yaml` stamps every metric with the cloud's name. OneUptime registers the cloud from that attribute, and every page and monitor scopes on it. The two deletes keep OneUptime from registering a Service named after the scrape job, so keep them if you customize the file:":
    "Processoren `resource` i `otel-collector-config.yaml` sætter cloud'ens navn på hver metrik. OneUptime registrerer cloud'en ud fra den attribut, og hver side og monitor afgrænses efter den. De to sletninger forhindrer OneUptime i at registrere en tjeneste opkaldt efter scrape-jobbet, så behold dem, hvis du tilpasser filen:",
  "The whole file is on this OneUptime:":
    "Hele filen ligger på denne OneUptime:",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cloud: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `openstack.cloud.name`:":
    "Enhver ressourceattribut med præfikset `oneuptime.label.` bliver til en projektlabel på cloud'en: `oneuptime.label.<dimension>=<value>` er labelen `<dimension>:<value>`. Tilføj dem til processoren `resource` i `otel-collector-config.yaml`, ved siden af `openstack.cloud.name`:",
  "Then restart the collector so it reads the new config:":
    "Genstart derefter collectoren, så den læser den nye konfiguration:",
  "The cloud shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Cloud'en vises med labels `team:platform` og `env:production`. Labels sammenlignes uden hensyn til store og små bogstaver, så en eksisterende label `Production` genbruges; labels, der er tilføjet i OneUptimes brugerflade, fjernes aldrig af agenten.",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` and `clouds.yaml` (nothing is asked again), downloads the latest files (a file you edited is kept next to the new one as `<file>.bak.<timestamp>`), pulls the images and recreates the agent with them:":
    "**Opgradering.** Images er låst i `docker-compose.yml`, og dens konfiguration er en fil ved siden af, så et pull alene flytter ikke agenten fremad. Kør installationsscriptet igen. Det genbruger hver værdi i dine eksisterende `.env` og `clouds.yaml` (der spørges ikke om noget igen), downloader de nyeste filer (en fil, du har redigeret, beholdes ved siden af den nye som `<file>.bak.<timestamp>`), henter images og genopretter agenten med dem:",
  "The config reports the collector version it pins as the cloud's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Konfigurationen rapporterer den collector-version, den låser til, som cloud'ens **Agentversion**. Når denne OneUptime låser til en nyere, åbner et advarselstegn ved siden af disse kommandoer.",
  "**Uninstall** the agent:": "**Afinstallér** agenten:",
  "Then delete `/opt/oneuptime-openstack-agent`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "Slet derefter `/opt/oneuptime-openstack-agent`, som indeholder credential'en, og selve application credential'en: `openstack application credential delete oneuptime-agent`.",
  "`troubleshoot.sh` checks the whole chain, from DNS and TLS to Keystone, each service in the catalog and your ingestion key, and says what this credential can read and what each gap costs.":
    "`troubleshoot.sh` tjekker hele kæden, fra DNS og TLS til Keystone, hver tjeneste i kataloget og din indtagelsesnøgle, og siger, hvad denne credential kan læse, og hvad hvert hul koster.",
  "It needs `sudo` to read `clouds.yaml`, or it skips the credential checks. It ends with a verdict naming the most likely cause.":
    "Det skal bruge `sudo` for at læse `clouds.yaml`, ellers springer det credential-tjekkene over. Det slutter med en dom, der nævner den mest sandsynlige årsag.",
  "1. Check that the agent is running (in `/opt/oneuptime-openstack-agent`): `docker compose ps`":
    "1. Tjek, at agenten kører (i `/opt/oneuptime-openstack-agent`): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-openstack-agent | grep -i error`":
    "2. Tjek agentens logs for fejl: `docker compose logs oneuptime-openstack-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Bekræft, at din OneUptime-URL og indtagelsesnøgle er korrekte.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Sørg for, at agentmaskinen kan nå OneUptime-instansen over netværket.",
  "A **Project view** credential can't read them, and neither can a role without the policy overrides: Nova, Neutron and Placement keep them for admins by default. Use **Full view**, or **Infrastructure only** with the files in `access/policy` merged into the file each service's `[oslo_policy] policy_file` names. `troubleshoot.sh` says which reads were refused.":
    "En credential med **Projektvisning** kan ikke læse dem, og det kan en rolle uden policy-overrides heller ikke: Nova, Neutron og Placement forbeholder dem som standard administratorer. Brug **Fuld visning**, eller **Kun infrastruktur** med filerne i `access/policy` flettet ind i den fil, som hver tjenestes `[oslo_policy] policy_file` angiver. `troubleshoot.sh` siger, hvilke læsninger der blev afvist.",
  "Only **Full view** sees `cinder-volume` and `cinder-scheduler` state and storage pools. Cinder's own code answers anything else with `403 User does not have admin privileges`, after policy has already passed, so no override opens them.":
    "Kun **Fuld visning** ser tilstanden for `cinder-volume` og `cinder-scheduler` og lagringspuljerne. Cinders egen kode svarer alt andet med `403 User does not have admin privileges`, efter at policy allerede har godkendt, så ingen override åbner dem.",
  "Neutron and Cinder answer anything but an admin with `200` and only its own project, which looks like it worked. Seeing every project takes **Full view**. With **Infrastructure only**, they appear for the projects the role is assigned on, and a role on a real project can also write there on many clouds.":
    "Neutron og Cinder svarer alt andet end en administrator med `200` og kun dens eget projekt, hvilket ser ud, som om det virkede. At se hvert projekt kræver **Fuld visning**. Med **Kun infrastruktur** vises de for de projekter, rollen er tildelt på, og en rolle på et rigtigt projekt kan også skrive der på mange clouds.",
  "A **Project view** credential shows no instances through the agent: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. **Full view** and **Infrastructure only** both see every project's instances.":
    "En credential med **Projektvisning** viser ingen instanser gennem agenten: exporteren beder Nova om alle projekters servere, Nova afviser en almindelig læser, og den læsning fejler helt. **Fuld visning** og **Kun infrastruktur** ser begge hvert projekts instanser.",
  "That is expected with **Infrastructure only**, and harmless. Neutron tries to create a project's default security group when it lists them, and a project with zero quota cannot hold one. There is nothing to fix.":
    "Det er forventet med **Kun infrastruktur**, og harmløst. Neutron prøver at oprette et projekts standardsikkerhedsgruppe, når den lister dem, og et projekt med en kvote på nul kan ikke rumme en. Der er intet at rette.",
  "On Flamingo and Epoxy, oslo.policy raises on every check once a policy file it has read is gone, and when the service is Keystone the whole cloud answers `503`. Restart the service. To take the overrides off, empty the file (`{}`) and never delete it.":
    "På Flamingo og Epoxy fejler oslo.policy ved hvert tjek, så snart en policyfil, den har læst, er væk, og når tjenesten er Keystone, svarer hele cloud'en `503`. Genstart tjenesten. Vil du fjerne dine overrides, så tøm filen (`{}`), og slet den aldrig.",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in `/opt/oneuptime-openstack-agent`): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "Agenten læser hver tjeneste for sig, så en tjeneste, der fejler, koster kun sine egne tal. Se, hvorfor exporteren ikke kan læse den (i `/opt/oneuptime-openstack-agent`): `docker compose logs oneuptime-openstack-exporter`. Siden **Tjenester** viser det API som `down`. En credential med adgangsregler, der er lavet ud fra en ældre kopi af reglerne, gør også dette på Swift og på Octavia bag en sti: opret en ny, som **Fuld visning** beskriver.",
  "The services are refusing a credential limited by access rules. A service behind a path prefix refuses the shipped rules: fit them to this cloud with `access-rules-for-cloud.py`, as **Full view** does. And each service needs `service_type` set for keystonemiddleware, and a restart:":
    "Tjenesterne afviser en credential, der er begrænset af adgangsregler. En tjeneste bag et stipræfiks afviser de medfølgende regler: tilpas dem til denne cloud med `access-rules-for-cloud.py`, som **Fuld visning** beskriver. Og hver tjeneste skal have `service_type` sat for keystonemiddleware og en genstart:",
  "If you won't change that, create the credential without `--access-rules`, knowing it can write.":
    "Vil du ikke ændre det, så opret credential'en uden `--access-rules`, velvidende at den kan skrive.",
  "The exporter runs as uid 65532, and `clouds.yaml` is readable by its owner alone. Give the file to that user, or set `OPENSTACK_EXPORTER_USER` in `.env` to the file owner's `uid:gid`, and apply it with `docker compose up -d`.":
    "Exporteren kører som uid 65532, og `clouds.yaml` kan kun læses af sin ejer. Giv filen til den bruger, eller sæt `OPENSTACK_EXPORTER_USER` i `.env` til filejerens `uid:gid`, og anvend det med `docker compose up -d`.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "Cloud'ens identitet kommer fra `OPENSTACK_CLOUD_NAME`, sat på hver metrik som `openstack.cloud.name`. Ret det i `.env`, og anvend det med `docker compose up -d` i `/opt/oneuptime-openstack-agent`. Et nyt navn registrerer en ny cloud.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "Cloud'ens identitet kommer fra `OPENSTACK_CLOUD_NAME`, sat på hver metrik som `openstack.cloud.name`. Denne cloud er **`cloud-1`**. Ret det i `.env`, og anvend det med `docker compose up -d` i `/opt/oneuptime-openstack-agent`. Et nyt navn registrerer en ny cloud.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent":
    "Docker Engine 20.10 eller nyere med Docker Compose v2-pluginnet, på den maskine, der skal køre agenten",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Download `docker-compose.yml` og `otel-collector-config.yaml` fra denne OneUptime til en ny mappe:",
  "Create a `clouds.yaml` file next to them, with the credential from the previous step. It needs one entry per region, each named for its region, because the exporter's series do not say which region they are from:":
    "Opret en `clouds.yaml`-fil ved siden af dem, med credential'en fra forrige trin. Den skal have én post pr. region, hver opkaldt efter sin region, fordi exporterens serier ikke siger, hvilken region de kommer fra:",
  "Create a `.env` file next to them too:":
    "Opret også en `.env`-fil ved siden af dem:",
  "- Replace `my-openstack-cloud` with a name for this cloud, such as `prod-eu`. It is how the cloud appears in OneUptime, so keep it stable: a new name registers a new cloud.":
    "- Erstat `my-openstack-cloud` med et navn til denne cloud, såsom `prod-eu`. Det er sådan, cloud'en vises i OneUptime, så hold det stabilt: et nyt navn registrerer en ny cloud.",
  "- List every region in `OPENSTACK_EXPORTER_CLOUDS`, in square brackets, such as `[RegionOne,RegionTwo]`.":
    "- Angiv hver region i `OPENSTACK_EXPORTER_CLOUDS`, i kantede parenteser, såsom `[RegionOne,RegionTwo]`.",
  "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` starts the bundled exporter, which reads the cloud with `clouds.yaml`, and the OneUptime AI agent, which reads it with the same file while OneUptime AI investigates.":
    "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` starter den medfølgende exporter, som læser cloud'en med `clouds.yaml`, og OneUptimes AI-agent, som læser den med den samme fil, mens OneUptime AI undersøger.",
  "Both files hold secrets, so keep them to their owner. The exporter runs as uid 65532, and must be the one account that can read `clouds.yaml`. Then start the agent:":
    "Begge filer indeholder hemmeligheder, så hold dem for deres ejer. Exporteren kører som uid 65532 og skal være den eneste konto, der kan læse `clouds.yaml`. Start derefter agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Vælg en indtagelsesnøgle i trin 1 for at udfylde `<YOUR_API_KEY>`.",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Add one `clouds.yaml` entry per region, and list them all in `OPENSTACK_EXPORTER_CLOUDS`. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "En cloud er én Keystone, uanset hvor mange regioner den har, og én agent læser dem alle. Tilføj én `clouds.yaml`-post pr. region, og angiv dem alle i `OPENSTACK_EXPORTER_CLOUDS`. Hver post skal være opkaldt efter sin region: collectoren sætter det navn på exporterens serier som `openstack.region.name`, fordi serierne ikke siger, hvilken region de kommer fra. Hver liste i OneUptime kan så filtreres efter region.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Agenten læser disse fra `.env`-filen ved siden af `docker-compose.yml`. Når du har ændret en, så anvend den med `docker compose up -d` i mappen med `docker-compose.yml`.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter, as `host:port` with no scheme: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`. The bundled exporter then never starts.":
    "Udelad `COMPOSE_PROFILES` fra `.env`, og peg agenten på din exporter, som `host:port` uden skema: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`. Den medfølgende exporter starter så aldrig.",
  "Put the file next to `docker-compose.yml` as `ca.pem`, set `OPENSTACK_CA_FILE=./ca.pem` in `.env`, and add `cacert: /etc/openstack/ca.pem` to each entry of `clouds.yaml`.":
    "Læg filen ved siden af `docker-compose.yml` som `ca.pem`, sæt `OPENSTACK_CA_FILE=./ca.pem` i `.env`, og tilføj `cacert: /etc/openstack/ca.pem` til hver post i `clouds.yaml`.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Kør disse i agentens mappe, den med `docker-compose.yml`.",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `clouds.yaml` stay, and a change you made to either file has to be made again:":
    "**Opgradering.** Images er låst i `docker-compose.yml`, og dens konfiguration er en fil ved siden af, så et pull alene flytter ikke agenten fremad. Download begge filer igen; din `.env` og `clouds.yaml` bliver, og en ændring, du havde lavet i en af de to downloadede filer, skal laves igen:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Hent derefter images, og genopret agenten, så collectoren læser sin nye konfiguration:",
  "Then delete the folder with `docker-compose.yml`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "Slet derefter mappen med `docker-compose.yml`, som indeholder credential'en, og selve application credential'en: `openstack application credential delete oneuptime-agent`.",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. Tjek, at agenten kører (i agentens mappe): `docker compose ps`",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in the agent's folder): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "Agenten læser hver tjeneste for sig, så en tjeneste, der fejler, koster kun sine egne tal. Se, hvorfor exporteren ikke kan læse den (i agentens mappe): `docker compose logs oneuptime-openstack-exporter`. Siden **Tjenester** viser det API som `down`. En credential med adgangsregler, der er lavet ud fra en ældre kopi af reglerne, gør også dette på Swift og på Octavia bag en sti: opret en ny, som **Fuld visning** beskriver.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "Cloud'ens identitet kommer fra `OPENSTACK_CLOUD_NAME`, sat på hver metrik som `openstack.cloud.name`. Ret det i `.env`, og anvend det med `docker compose up -d` i mappen med `docker-compose.yml`. Et nyt navn registrerer en ny cloud.",
  "- This installs the agent for **`cloud-1`**. Keep `OPENSTACK_CLOUD_NAME` exactly as it is, or the data registers as a new cloud.":
    "- Dette installerer agenten for **`cloud-1`**. Behold `OPENSTACK_CLOUD_NAME` præcis, som det er, ellers registreres dataene som en ny cloud.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "Cloud'ens identitet kommer fra `OPENSTACK_CLOUD_NAME`, sat på hver metrik som `openstack.cloud.name`. Denne cloud er **`cloud-1`**. Ret det i `.env`, og anvend det med `docker compose up -d` i mappen med `docker-compose.yml`. Et nyt navn registrerer en ny cloud.",
  "OpenStack-Ansible keeps its services' logs in journald and runs no Prometheus of its own, so the agent is the way in, and the logs have a path of their own.":
    "OpenStack-Ansible holder sine tjenesters logs i journald og kører ingen egen Prometheus, så agenten er vejen ind, og logs har deres egen vej.",
  "**How far this guide has been tested:** Its paths and variables were read from OpenStack-Ansible's own source and docs. Its commands were then run on a real all-in-one at stable/2026.1, in LXC containers, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, the agent's exporter on the Infrastructure only credential with its policy overrides, the RabbitMQ and HAProxy settings with the agent reading each, and the logs profile on the journal. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**Hvor langt denne guide er testet:** Dens stier og variabler er læst fra OpenStack-Ansibles egen kildekode og dokumentation. Dens kommandoer blev derefter kørt på en rigtig all-in-one på stable/2026.1, i LXC-containere, med en stand-in for OneUptime, der gemte det, agenten sendte: agenten på credential'en for Fuld visning, agentens exporter på credential'en for Kun infrastruktur med dens policy-overrides, indstillingerne for RabbitMQ og HAProxy med agenten, der læste hver, og log-profilen på journalen. Agenten og en sonde har hver taget en rigtig DevStack hele vejen ind i en kørende OneUptime, gennem en stoppet nova-compute og tilbage igen, men ikke fra dette værktøj.",
  "- Log in as an admin from the utility container: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, then `. ~/openrc`. It has no `curl`, which the commands below use, so run `apt-get install -y curl` there first.":
    "- Log ind som administrator fra utility-containeren: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, derefter `. ~/openrc`. Den har ikke `curl`, som kommandoerne nedenfor bruger, så kør først `apt-get install -y curl` der.",
  "- **Full view** needs one change, to Cinder. OpenStack-Ansible's roles already set `service_type` under `[keystone_authtoken]`, but its Cinder says `volumev3` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Set `service_type: block-storage` under `keystone_authtoken` in `cinder_cinder_conf_overrides` in `/etc/openstack_deploy/user_variables.yml`, then run `openstack-ansible openstack.osa.cinder --tags cinder-config`.":
    "- **Fuld visning** kræver én ændring, i Cinder. OpenStack-Ansibles roller sætter allerede `service_type` under `[keystone_authtoken]`, men dens Cinder siger `volumev3` og dens katalog siger `block-storage`, og keystonemiddleware afviser en credential begrænset af adgangsregler med en `401`, medmindre de to stemmer overens. Sæt `service_type: block-storage` under `keystone_authtoken` i `cinder_cinder_conf_overrides` i `/etc/openstack_deploy/user_variables.yml`, og kør derefter `openstack-ansible openstack.osa.cinder --tags cinder-config`.",
  "- **Infrastructure only** takes its overrides as `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` and `placement_policy_overrides` in `/etc/openstack_deploy/user_variables.yml`. Apply each with its own playbook and tag, such as `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Taking one out later leaves an empty file behind rather than none, so nothing fails.":
    "- **Kun infrastruktur** tager sine overrides som `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` og `placement_policy_overrides` i `/etc/openstack_deploy/user_variables.yml`. Anvend hver med sin egen playbook og tag, såsom `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Fjerner du en senere, efterlader det en tom fil i stedet for ingen, så intet fejler.",
  "- **RabbitMQ:** turn on its Prometheus plugin, then name each container's address on `15692` as `OPENSTACK_RABBITMQ_TARGETS` in the agent's `.env`:":
    "- **RabbitMQ:** slå dens Prometheus-plugin til, og angiv derefter hver containers adresse på `15692` som `OPENSTACK_RABBITMQ_TARGETS` i agentens `.env`:",
  "- **HAProxy:** its exporter is off, and its stats listener is on `127.0.0.1` with TLS, which the agent cannot read. Turn it on where the agent can, then name that address on `1936` as `OPENSTACK_HAPROXY_TARGETS`:":
    "- **HAProxy:** dens exporter er slået fra, og dens stats-listener ligger på `127.0.0.1` med TLS, som agenten ikke kan læse. Slå den til, hvor agenten kan læse den, og angiv derefter den adresse på `1936` som `OPENSTACK_HAPROXY_TARGETS`:",
  "- **MariaDB and Memcached:** OpenStack-Ansible ships no exporter for either. Run [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) and [memcached_exporter](https://github.com/prometheus/memcached_exporter) yourself and name them as `OPENSTACK_MARIADB_TARGETS` and `OPENSTACK_MEMCACHED_TARGETS`, or leave them out: the cloud's **Control Plane** card then says they are not watched, rather than that they are fine.":
    "- **MariaDB og Memcached:** OpenStack-Ansible leverer ingen exporter til nogen af dem. Kør selv [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) og [memcached_exporter](https://github.com/prometheus/memcached_exporter), og angiv dem som `OPENSTACK_MARIADB_TARGETS` og `OPENSTACK_MEMCACHED_TARGETS`, eller udelad dem: cloud'ens kort **Kontrolplan** siger så, at de ikke overvåges, i stedet for at de er i orden.",
  "This runs the agent's logs profile as a systemd service, and reads `/var/log/journal/`, where OpenStack-Ansible's containers' journals arrive.":
    "Dette kører agentens log-profil som en systemd-tjeneste og læser `/var/log/journal/`, hvor journalerne fra OpenStack-Ansibles containere ankommer.",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from the journal.":
    "Hver skriver til tjenestens egen log, uden nogen forbruger på bussen. OneUptime læser dem derfra, så snart **Find sikkerhedshændelser i dine logs** er slået til under **Sikkerhedshændelser → Forbindelser**. Agentens log-profil læser begge fra journalen.",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw. A second value of `notification_opt_out` goes in as a YAML set, as [its config_template](https://docs.openstack.org/ansible-config_template/latest/) writes a repeated key.":
    "Det sender en linje for hvert login, som **OpenStack admin credential used from a new address** læser. Vil du kun sende mislykkede logins, så tilføj `identity.authenticate.success` til `notification_opt_out`; den detektion læser så, hvad auditfilteret så. En ekstra værdi i `notification_opt_out` angives som et YAML-sæt, sådan som [dens config_template](https://docs.openstack.org/ansible-config_template/latest/) skriver en gentaget nøgle.",
  "For who did what through Nova, Neutron, Cinder and Glance, each API takes the filter's setting in its conf overrides, and the filter in its paste overrides, with `audit` right after `authtoken` and the context filter that follows it in each pipeline. Nova's, and the same in `neutron_neutron_conf_overrides` and `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` and `cinder_api_paste_ini_overrides`, and `glance_glance_api_conf_overrides` and `glance_glance_api_paste_ini_overrides`:":
    "For at se, hvem der gjorde hvad gennem Nova, Neutron, Cinder og Glance, tager hver API filterets indstilling i sine conf-overrides og filteret i sine paste-overrides, med `audit` lige efter `authtoken` og det kontekstfilter, der følger efter den i hver pipeline. Her er Novas, og det samme i `neutron_neutron_conf_overrides` og `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` og `cinder_api_paste_ini_overrides` samt `glance_glance_api_conf_overrides` og `glance_glance_api_paste_ini_overrides`:",
  "OpenStack-Helm offers charts for Prometheus, Alertmanager and exporters, and whether they are running is up to you. Its control plane runs in Kubernetes, so a probe reads the APIs and the Kubernetes agent sees the pods.":
    "OpenStack-Helm tilbyder charts til Prometheus, Alertmanager og exportere, og om de kører, er op til dig. Dens kontrolplan kører i Kubernetes, så en sonde læser API'erne, og Kubernetes-agenten ser pods'ene.",
  "**How far this guide has been tested:** Its chart values were read from OpenStack-Helm's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**Hvor langt denne guide er testet:** Dens chart-værdier er læst fra OpenStack-Helms egen kildekode. Den er ikke fulgt fra ende til anden på en rigtig udrulning med dette værktøj. Agenten og en sonde har hver taget en rigtig DevStack hele vejen ind i en kørende OneUptime, gennem en stoppet nova-compute og tilbage igen, men ikke fra dette værktøj. Sonden og Kubernetes-agenten er hver testet for sig, ikke sammen på dette værktøj.",
  "Then add the receiver under `conf.alertmanager` in the chart's values, and send your route to it:":
    "Tilføj derefter receiveren under `conf.alertmanager` i chartets værdier, og send din route til den:",
  "Open **OpenStack → All Clouds**, click **Connect Cloud**, and give it Keystone's address, an application credential and the probe to use. A probe only speaks HTTPS to a cloud. [OpenStack Without an Agent](/docs/telemetry/openstack-agentless) says what each level of access reads, and the connection test says what yours can. The agent also works from any machine with a route to the APIs: choose **Not sure, or something else** above for its steps.":
    "Åbn **OpenStack → Alle clouds**, klik på **Tilslut cloud**, og angiv Keystones adresse, en application credential og den sonde, der skal bruges. En sonde taler kun HTTPS med en cloud. [OpenStack uden agent](/docs/telemetry/openstack-agentless) siger, hvad hvert adgangsniveau læser, og forbindelsestesten siger, hvad dit kan. Agenten virker også fra enhver maskine med en rute til API'erne: vælg **Usikker, eller noget andet** ovenfor for dens trin.",
  "Follow **Kubernetes → Documentation** for this cluster. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "Følg **Kubernetes → Dokumentation** for denne klynge. Dens pods, deres logs og deres noder når så Kubernetes-siderne, og OpenStack-tjenesterne blandt dem overvåges der.",
  "To have those services' logs on this cloud's **Logs** page as well, each stack trace one record, name the cloud in the agent's values, with the namespaces its services run in:":
    "For også at have de tjenesters logs på denne clouds side **Protokoller**, hver stack trace som én post, så navngiv cloud'en i agentens værdier, med de namespaces, dens tjenester kører i:",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The Kubernetes agent reads both from the pods' logs, with the cloud named in its values.":
    "Hver skriver til tjenestens egen log, uden nogen forbruger på bussen. OneUptime læser dem derfra, så snart **Find sikkerhedshændelser i dine logs** er slået til under **Sikkerhedshændelser → Forbindelser**. Kubernetes-agenten læser begge fra pods'enes logs, med cloud'en navngivet i dens værdier.",
  "A chart's `logging.conf` keeps the root logger at `WARNING`, and the log driver writes under a logger of its own, so without one for it nothing is written. A list in values replaces the chart's, so `keys` holds what the chart's has, plus this:":
    "Et charts `logging.conf` holder root-loggeren på `WARNING`, og log-driveren skriver under sin egen logger, så uden en logger til den bliver intet skrevet. En liste i værdierne erstatter chartets, så `keys` indeholder det, chartets har, plus dette:",
  "For who did what through Nova, Neutron and Cinder, their charts' `conf.paste` already has the audit filter in each pipeline, and it needs telling where to write. Each needs the same logger, in `conf.logging`. Glance's chart has the map, and neither the filter nor a place for it in its pipelines: add both to its `conf.paste`.":
    "For at se, hvem der gjorde hvad gennem Nova, Neutron og Cinder, har deres charts' `conf.paste` allerede auditfilteret i hver pipeline, og det skal have at vide, hvor det skal skrive. Hver skal have den samme logger, i `conf.logging`. Glances chart har map'et, men hverken filteret eller en plads til det i sine pipelines: tilføj begge til dens `conf.paste`.",
  "Atmosphere runs kube-prometheus-stack with its own alert rules, and Loki with Vector for logs. Forward its alerts first, then a probe reads the APIs and the Kubernetes agent sees the pods.":
    "Atmosphere kører kube-prometheus-stack med egne alarmregler og Loki med Vector til logs. Videresend først dens alarmer; derefter læser en sonde API'erne, og Kubernetes-agenten ser pods'ene.",
  "**How far this guide has been tested:** Its configuration was read from Atmosphere's own docs and source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**Hvor langt denne guide er testet:** Dens konfiguration er læst fra Atmospheres egen dokumentation og kildekode. Den er ikke fulgt fra ende til anden på en rigtig udrulning med dette værktøj. Agenten og en sonde har hver taget en rigtig DevStack hele vejen ind i en kørende OneUptime, gennem en stoppet nova-compute og tilbage igen, men ikke fra dette værktøj. Sonden og Kubernetes-agenten er hver testet for sig, ikke sammen på dette værktøj.",
  "Then add the receiver to your Atmosphere configuration, beside whichever receivers you already have, and deploy it:":
    "Tilføj derefter receiveren til din Atmosphere-konfiguration, ved siden af de receivere, du allerede har, og udrul den:",
  "For who did what through Nova, Neutron and Cinder, the charts Atmosphere deploys already have the audit filter in each pipeline, and it needs telling where to write, in `nova_helm_values`, `neutron_helm_values` and `cinder_helm_values`. Glance's chart has neither the filter nor a place for it in its pipelines: add both to its `conf.paste`, in `glance_helm_values`.":
    "For at se, hvem der gjorde hvad gennem Nova, Neutron og Cinder, har de charts, Atmosphere udruller, allerede auditfilteret i hver pipeline, og det skal have at vide, hvor det skal skrive, i `nova_helm_values`, `neutron_helm_values` og `cinder_helm_values`. Glances chart har hverken filteret eller en plads til det i sine pipelines: tilføj begge til dens `conf.paste`, i `glance_helm_values`.",
  "Sunbeam can deploy the Canonical Observability Stack, with `sunbeam enable observability embedded`. Canonical also has an `openstack-exporter` charm, which the agent can read if you run it.":
    "Sunbeam kan udrulle Canonical Observability Stack med `sunbeam enable observability embedded`. Canonical har også en `openstack-exporter`-charm, som agenten kan læse, hvis du kører den.",
  "**How far this guide has been tested:** Its commands were read from Canonical's docs and its charms' source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. Nothing here has been run on Sunbeam, and Sunbeam's own docs do not mention the exporter charm.":
    "**Hvor langt denne guide er testet:** Dens kommandoer er læst fra Canonicals dokumentation og kildekoden til dens charms. Den er ikke fulgt fra ende til anden på en rigtig udrulning med dette værktøj. Agenten og en sonde har hver taget en rigtig DevStack hele vejen ind i en kørende OneUptime, gennem en stoppet nova-compute og tilbage igen, men ikke fra dette værktøj. Intet her er kørt på Sunbeam, og Sunbeams egen dokumentation nævner ikke exporter-charmen.",
  "Then give the stack's Alertmanager a configuration with the receiver in it:":
    "Giv derefter stackens Alertmanager en konfiguration med receiveren i:",
  "If you run Canonical's `openstack-exporter` charm, the agent can read it with no credential of its own. It answers one cloud on `/metrics`, on port `9180` unless you changed its `port` setting. Find its address with `juju status openstack-exporter`:":
    "Kører du Canonicals `openstack-exporter`-charm, kan agenten læse den uden egen credential. Den svarer for én cloud på `/metrics`, på port `9180`, medmindre du har ændret dens indstilling `port`. Find dens adresse med `juju status openstack-exporter`:",
  "Which series it says depends on the exporter release in its snap, which was not recorded here: `bash troubleshoot.sh` says whether it reads the cloud.":
    "Hvilke serier den giver, afhænger af exporter-releasen i dens snap, som ikke blev registreret her: `bash troubleshoot.sh` siger, om den læser cloud'en.",
  "With observability on, the stack's Loki holds the services' logs. OneUptime has no way to read Loki, and the agent's logs profile has not been tried on Sunbeam's charms, so nothing here collects them yet.":
    "Med observability slået til holder stackens Loki tjenesternes logs. OneUptime har ingen måde at læse Loki på, og agentens log-profil er ikke afprøvet på Sunbeams charms, så intet her indsamler dem endnu.",
  "Sunbeam's charms write each service's configuration from their own templates, and its Keystone charm has no setting for where notifications go. So neither Keystone's audit trail nor the audit filter can be turned on from outside the charm, and nothing here reaches Security Events.":
    "Sunbeams charms skriver hver tjenestes konfiguration ud fra deres egne skabeloner, og dens Keystone-charm har ingen indstilling for, hvor notifikationer sendes hen. Så hverken Keystones audit trail eller auditfilteret kan slås til uden for charmen, og intet her når Sikkerhedshændelser.",
  "Its Telemetry Operator runs Ceilometer's Prometheus exporter and a monitoring stack with Alertmanager on OpenShift. The Kubernetes agent's OpenShift preset watches the control plane, and Ceilometer's exporter says what the compute nodes are doing.":
    "Dens Telemetry Operator kører Ceilometers Prometheus-exporter og en overvågningsstack med Alertmanager på OpenShift. Kubernetes-agentens OpenShift-preset overvåger kontrolplanet, og Ceilometers exporter siger, hvad compute-noderne laver.",
  "**How far this guide has been tested:** Its resources were read from the Telemetry Operator's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The OpenShift preset and Ceilometer's exporter were each tested on their own, not together on this tool.":
    "**Hvor langt denne guide er testet:** Dens ressourcer er læst fra Telemetry Operators egen kildekode. Den er ikke fulgt fra ende til anden på en rigtig udrulning med dette værktøj. Agenten og en sonde har hver taget en rigtig DevStack hele vejen ind i en kørende OneUptime, gennem en stoppet nova-compute og tilbage igen, men ikke fra dette værktøj. OpenShift-presettet og Ceilometers exporter er hver testet for sig, ikke sammen på dette værktøj.",
  "Then apply a receiver the monitoring stack picks up:":
    "Anvend derefter en receiver, som overvågningsstacken samler op:",
  "Follow **Kubernetes → Documentation** for this cluster, with **Red Hat OpenShift** picked, which sets `preset=openshift`. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "Følg **Kubernetes → Dokumentation** for denne klynge, med **Red Hat OpenShift** valgt, hvilket sætter `preset=openshift`. Dens pods, deres logs og deres noder når så Kubernetes-siderne, og OpenStack-tjenesterne blandt dem overvåges der.",
  "A probe says what is allocated, not what is busy. To read real usage, run the agent on a machine that can reach the compute nodes, with `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` naming each node on Ceilometer's port, `9101`.":
    "En sonde siger, hvad der er tildelt, ikke hvad der er optaget. For at læse det reelle forbrug skal du køre agenten på en maskine, der kan nå compute-noderne, med `OPENSTACK_CEILOMETER_EXPORTER_TARGETS`, der angiver hver node på Ceilometers port, `9101`.",
  "For who did what through Nova and Neutron, each takes the filter's setting in its `customServiceConfig`, and its paste file in `defaultConfigOverwrite`. Cinder's and Glance's operators take no paste file, so nothing here reaches them.":
    "For at se, hvem der gjorde hvad gennem Nova og Neutron, tager hver filterets indstilling i sin `customServiceConfig` og sin paste-fil i `defaultConfigOverwrite`. Cinders og Glances operatorer tager ingen paste-fil, så intet her når dem.",
  "StackLight already watches OpenStack's services, MariaDB, Memcached, RabbitMQ and libvirt, with its own alert rules. Forward its alerts first, then a probe reads the APIs.":
    "StackLight overvåger allerede OpenStacks tjenester, MariaDB, Memcached, RabbitMQ og libvirt, med egne alarmregler. Videresend først dens alarmer; derefter læser en sonde API'erne.",
  "**How far this guide has been tested:** Its settings were read from Mirantis's docs, whose examples show other receivers rather than a webhook. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**Hvor langt denne guide er testet:** Dens indstillinger er læst fra Mirantis' dokumentation, hvis eksempler viser andre receivere end en webhook. Den er ikke fulgt fra ende til anden på en rigtig udrulning med dette værktøj. Agenten og en sonde har hver taget en rigtig DevStack hele vejen ind i en kørende OneUptime, gennem en stoppet nova-compute og tilbage igen, men ikke fra dette værktøj.",
  "Then add the receiver and its route to your StackLight values:":
    "Tilføj derefter receiveren og dens route til dine StackLight-værdier:",
  "For who did what through Nova, Neutron, Cinder and Glance, MOSK has a setting of its own, with the audit filter already in place. With the log driver, each service writes to its standard output, and the Kubernetes agent reads that from the pods' logs, with the cloud named in its values. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "For at se, hvem der gjorde hvad gennem Nova, Neutron, Cinder og Glance, har MOSK sin egen indstilling, med auditfilteret allerede på plads. Med log-driveren skriver hver tjeneste til sin standardoutput, og Kubernetes-agenten læser det fra pods'enes logs, med cloud'en navngivet i dens værdier. Hver skriver til tjenestens egen log, uden nogen forbruger på bussen. OneUptime læser dem derfra, så snart **Find sikkerhedshændelser i dine logs** er slået til under **Sikkerhedshændelser → Forbindelser**.",
  "That setting does not cover Keystone. Its own audit trail takes `spec:services`, which Mirantis does not validate and takes no responsibility for, so weigh this with your support contract:":
    "Den indstilling dækker ikke Keystone. Dens egen audit trail tager `spec:services`, som Mirantis ikke validerer og ikke påtager sig noget ansvar for, så vej det op mod din supportaftale:",
  "Keystone's audit trail says who signed in and who changed what in Keystone, and the audit filter says who did what through Nova, Neutron, Cinder and Glance. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "Keystones audit trail siger, hvem der loggede ind, og hvem der ændrede hvad i Keystone, og auditfilteret siger, hvem der gjorde hvad gennem Nova, Neutron, Cinder og Glance. Hver skriver til tjenestens egen log, uden nogen forbruger på bussen. OneUptime læser dem derfra, så snart **Find sikkerhedshændelser i dine logs** er slået til under **Sikkerhedshændelser → Forbindelser**.",
  "The audit filter goes in each API's paste file, right after `authtoken` and the context filter that follows it in each pipeline, with the map file pyCADF ships for that service, in `etc/pycadf` under the Python environment the service runs in. Not at the end of a pipeline: Neutron's `extensions` filter answers its routers and security groups, and the filter would never see them.":
    "Auditfilteret skal i hver API's paste-fil, lige efter `authtoken` og det kontekstfilter, der følger efter den i hver pipeline, med den map-fil, pyCADF leverer til den tjeneste, i `etc/pycadf` under det Python-miljø, tjenesten kører i. Ikke i slutningen af en pipeline: Neutrons filter `extensions` svarer for dens routere og sikkerhedsgrupper, og auditfilteret ville aldrig se dem.",
  "[Who did what](/docs/telemetry/openstack#who-did-what) says what reaches Security Events, and [each tool's guide](/docs/telemetry/openstack-deployment-tools) says where these go on it.":
    "[Hvem gjorde hvad](/docs/telemetry/openstack#who-did-what) siger, hvad der når Sikkerhedshændelser, og [hvert værktøjs guide](/docs/telemetry/openstack-deployment-tools) siger, hvor dette skal placeres på det.",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | Nej | Collectorens containernavn (standard: `oneuptime-openstack-agent`). En anden clouds agent på samme maskine skal have sine egne navne: installationsscriptet navngiver en ny agents containere efter dens mappe, medmindre du angiver dem, og beholder dem, når du kører scriptet igen |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). The install script names a second cloud's bundled exporter after its collector (`oneuptime-openstack-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | Nej | Den medfølgende exporters containernavn (standard: `oneuptime-openstack-exporter`). Installationsscriptet navngiver en anden clouds medfølgende exporter efter dens collector (`oneuptime-openstack-exporter-cloud2` ved siden af `oneuptime-openstack-agent-cloud2`), medmindre du angiver det, og beholder det, når du kører scriptet igen |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). The install script names a second cloud's quota exporter after its collector (`oneuptime-openstack-quota-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | Nej | Kvote-exporterens containernavn (standard: `oneuptime-openstack-quota-exporter`). Installationsscriptet navngiver en anden clouds kvote-exporter efter dens collector (`oneuptime-openstack-quota-exporter-cloud2` ved siden af `oneuptime-openstack-agent-cloud2`), medmindre du angiver det, og beholder det, når du kører scriptet igen |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). The install script names a second cloud's database exporter after its collector (`oneuptime-openstack-database-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | Nej | Database-exporterens containernavn (standard: `oneuptime-openstack-database-exporter`). Installationsscriptet navngiver en anden clouds database-exporter efter dens collector (`oneuptime-openstack-database-exporter-cloud2` ved siden af `oneuptime-openstack-agent-cloud2`), medmindre du angiver det, og beholder det, når du kører scriptet igen |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). The install script names a second cloud's worker state exporter after its collector (`oneuptime-openstack-worker-state-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | Nej | Workerstatus-exporterens containernavn (standard: `oneuptime-openstack-worker-state-exporter`). Installationsscriptet navngiver en anden clouds workerstatus-exporter efter dens collector (`oneuptime-openstack-worker-state-exporter-cloud2` ved siden af `oneuptime-openstack-agent-cloud2`), medmindre du angiver det, og beholder det, når du kører scriptet igen |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). The install script names a second cloud's AI agent after its collector (`oneuptime-openstack-ai-agent-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | Nej | AI-agentens containernavn (standard: `oneuptime-openstack-ai-agent`). Installationsscriptet navngiver en anden clouds AI-agent efter dens collector (`oneuptime-openstack-ai-agent-cloud2` ved siden af `oneuptime-openstack-agent-cloud2`), medmindre du angiver det, og beholder det, når du kører scriptet igen |",
  "One agent reads one cloud. For a second cloud, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Én agent læser én cloud. Til en anden cloud skal du installere en anden agent i sin egen mappe, med sine egne containernavne, for to containere kan ikke dele et navn:",
  "The script names the containers after the folder, such as `oneuptime-openstack-agent-cloud2`, unless you set their variables, such as `OPENSTACK_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Scriptet navngiver containerne efter mappen, fx `oneuptime-openstack-agent-cloud2`, medmindre du angiver deres variabler, fx `OPENSTACK_AGENT_CONTAINER_NAME`. Det gemmer navnene i den agents `.env`, så når du kører scriptet igen med samme `INSTALL_DIR` for at opgradere agenten, beholdes navnene, og en agent, hvis `container_name` du engang redigerede i `docker-compose.yml`, beholder det navn.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Giv hver mappe sit eget navn: Docker Compose navngiver et projekt efter dets mappe alene, så scriptet afviser en mappe, der hedder det samme som en, der allerede kører en agent et andet sted. Giv mappen til diagnosescriptet med `-d`.",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | Nej | Collectorens containernavn (standard: `oneuptime-openstack-agent`). En anden clouds agent på samme maskine skal have sit eget |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | Nej | Den medfølgende exporters containernavn (standard: `oneuptime-openstack-exporter`). En anden clouds agent på samme maskine skal have sit eget |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | Nej | Kvote-exporterens containernavn (standard: `oneuptime-openstack-quota-exporter`). En anden clouds agent på samme maskine skal have sit eget |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | Nej | Database-exporterens containernavn (standard: `oneuptime-openstack-database-exporter`). En anden clouds agent på samme maskine skal have sit eget |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | Nej | Workerstatus-exporterens containernavn (standard: `oneuptime-openstack-worker-state-exporter`). En anden clouds agent på samme maskine skal have sit eget |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | Nej | AI-agentens containernavn (standard: `oneuptime-openstack-ai-agent`). En anden clouds agent på samme maskine skal have sit eget |",
  "One agent reads one cloud. For a second cloud, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Én agent læser én cloud. Til en anden cloud skal du sætte en anden agent op i sin egen mappe, med sine egne containernavne, for to containere kan ikke dele et navn. Angiv dem i den agents `.env`:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Giv hver mappe sit eget navn: Docker Compose navngiver et projekt efter dets mappe alene, så en anden mappe med samme navn ville erstatte den første agents containere. Hold navnene ude af `docker-compose.yml`, som en opgradering erstatter.",
};

export default TRANSLATION;

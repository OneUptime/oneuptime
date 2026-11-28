import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The OpenStack setup guide in Norwegian (#8341): each piece of the English
 * guide's markdown (Pages/OpenStack/Utils/DocumentationMarkdown.ts) and its
 * Norwegian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Norwegian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "With `enable_prometheus` on in `/etc/kolla/globals.yml`, which Kolla-Ansible leaves off until you set it, it runs Prometheus, Alertmanager and an exporter for each thing under the cloud, and ships no alert rules. This guide reads what those run rather than starting a second copy.":
    "Med `enable_prometheus` slått på i `/etc/kolla/globals.yml`, som Kolla-Ansible lar være av til du setter den, kjører det Prometheus, Alertmanager og en exporter for hver komponent under skyen, og leverer ingen varslingsregler. Denne veiledningen leser det de kjører, i stedet for å starte en kopi til.",
  "**How far this guide has been tested:** Its paths and ports were read from Kolla-Ansible's own source. Its commands were then run on a real all-in-one at stable/2026.1 with Open vSwitch, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, without Docker, on Kolla-Ansible's own exporter and on your own at the pinned version and at 1.7.0, the agent's exporter on the Infrastructure only credential, the targets read from its real prometheus.yml, and the logs profile. With Memcached really stopped there, its Alertmanager posted a firing webhook and then a resolved one, and what it posted, sent to a running OneUptime, opened one incident on the right cloud and on no other, and resolved it. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**Hvor langt denne veiledningen er testet:** Stiene og portene er lest fra Kolla-Ansibles egen kildekode. Kommandoene ble deretter kjørt på en ekte all-in-one på stable/2026.1 med Open vSwitch, med en stand-in for OneUptime som tok vare på det agenten sendte: agenten på legitimasjonen for Full visning, uten Docker, på Kolla-Ansibles egen exporter og på din egen i den fastlåste versjonen og i 1.7.0, agentens exporter på legitimasjonen for Kun infrastruktur, målene lest fra dens ekte prometheus.yml, og loggprofilen. Med Memcached virkelig stoppet der sendte dens Alertmanager en utløst webhook og deretter en løst, og det den sendte, videresendt til en kjørende OneUptime, åpnet én hendelse på riktig sky og på ingen annen, og løste den. Agenten og en sonde har hver tatt en ekte DevStack hele veien inn i en kjørende OneUptime, gjennom en stoppet nova-compute og tilbake igjen, men ikke fra dette verktøyet.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent (or `bash install.sh --without-docker`, under Advanced)":
    "Docker Engine 20.10 eller nyere med Docker Compose v2-tillegget, på maskinen som skal kjøre agenten (eller `bash install.sh --without-docker`, under Avansert)",
  "A machine outside the cloud it watches: an agent inside a failed cloud goes quiet with it":
    "En maskin utenfor skyen den overvåker: en agent inne i en sky som har falt ut, blir stille sammen med den",
  "That machine can reach Keystone and every service's API":
    "Den maskinen når Keystone og API-et til hver tjeneste",
  "The `openstack` command line, as someone who can create the credential below":
    "Kommandolinjen `openstack`, som en som kan opprette legitimasjonen nedenfor",
  "An alert that fires becomes an incident, with on-call and status pages from the first hour, and it resolves when the alert does. There is nothing to install.":
    "Et varsel som utløses, blir en hendelse, med vakt og statussider fra første time, og den løses når varselet løses. Det er ingenting å installere.",
  "1. In OneUptime, make an Incoming Request monitor as [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) says, and copy its **Heartbeat URL**. That is the `<secret key>` address below.":
    "1. Opprett i OneUptime en monitor for Innkommende forespørsel slik [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) beskriver, og kopier dens **Heartbeat URL**. Det er adressen med `<secret key>` nedenfor.",
  "2. Open the monitor's **Overview → Linked Resources** and add the OpenStack cloud `my-openstack-cloud`. Each incident is then on that cloud's **Incidents** page, so each cloud's Alertmanager needs a monitor of its own. The cloud shows up in that list once its first data arrives, so do this after the steps below, or add the cloud under **OpenStack → All Clouds** first.":
    "2. Åpne monitorens **Oversikt → Tilkoblede ressurser**, og legg til OpenStack-skyen `my-openstack-cloud`. Hver hendelse ligger da på den skyens side **Hendelser**, så hver skys Alertmanager trenger sin egen monitor. Skyen dukker opp i den listen så snart de første dataene kommer, så gjør dette etter trinnene nedenfor, eller legg først til skyen under **OpenStack → Alle skyer**.",
  "Then, on the host you deploy from, write `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, which Kolla-Ansible reads in place of its own, and apply it:":
    "Skriv deretter, på verten du ruller ut fra, `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, som Kolla-Ansible leser i stedet for sin egen, og ta den i bruk:",
  "- Log in as an admin with `source /etc/kolla/admin-openrc.sh`, which `kolla-ansible post-deploy` writes.":
    "- Logg på som administrator med `source /etc/kolla/admin-openrc.sh`, som `kolla-ansible post-deploy` skriver.",
  "- **Full view** needs one change, to Cinder. Kolla-Ansible's templates already set `service_type` under `[keystone_authtoken]` on Nova, Neutron, Glance and Placement, but its Cinder says `volume` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Add `service_type = block-storage` under `[keystone_authtoken]` in `/etc/kolla/config/cinder.conf`, then run `kolla-ansible reconfigure -i <inventory> --tags cinder`.":
    "- **Full visning** trenger én endring, i Cinder. Kolla-Ansibles maler setter allerede `service_type` under `[keystone_authtoken]` på Nova, Neutron, Glance og Placement, men dens Cinder sier `volume` og dens katalog sier `block-storage`, og keystonemiddleware avviser en legitimasjon begrenset av tilgangsregler med en `401` med mindre de to stemmer overens. Legg til `service_type = block-storage` under `[keystone_authtoken]` i `/etc/kolla/config/cinder.conf`, og kjør deretter `kolla-ansible reconfigure -i <inventory> --tags cinder`.",
  "- **Infrastructure only** takes its overrides at `/etc/kolla/config/nova/policy.yaml`, and the same for `neutron`, `keystone` and `placement`, merged with anything already there. Apply them with `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.":
    "- **Kun infrastruktur** tar sine overstyringer i `/etc/kolla/config/nova/policy.yaml`, og det samme for `neutron`, `keystone` og `placement`, flettet med det som allerede ligger der. Ta dem i bruk med `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.",
  "**Recommended.** The agent sees everything it reads: services, hypervisors, every project's instances, volumes, networks and routers, and `cinder-volume` and `cinder-scheduler` state and storage pools, which only this level sees. It leaves out Keystone's users and groups, on purpose.":
    "**Anbefalt.** Agenten ser alt den leser: tjenester, hypervisorer, hvert prosjekts instanser, volumer, nettverk og rutere, og tilstanden til `cinder-volume` og `cinder-scheduler` og lagringspoolene, som bare dette nivået ser. Den utelater med vilje Keystones brukere og grupper.",
  "This is an application credential on an account with `admin` on a project of its own, limited by access rules to the exact `GET` calls the agent makes, so it cannot write: on every release we record, every read answered `200` and every write `401`. As an admin, make the project and the account:":
    "Dette er en applikasjonslegitimasjon på en konto med `admin` på et eget prosjekt, begrenset av tilgangsregler til nøyaktig de `GET`-kallene agenten gjør, så den ikke kan skrive: på hver utgivelse vi registrerer, ble hver lesing besvart med `200` og hver skriving med `401`. Opprett prosjektet og kontoen som administrator:",
  "Then, logged in as that account on that project, make the credential. An access rule is matched against the path the service sees, and a service behind a path prefix refuses the shipped rules with a `401`, so these commands fit them to this cloud from its catalog first:":
    "Opprett deretter, pålogget som den kontoen på det prosjektet, legitimasjonen. En tilgangsregel sammenlignes med stien tjenesten ser, og en tjeneste bak et stiprefiks avviser de medfølgende reglene med en `401`, så disse kommandoene tilpasser dem først til denne skyen ut fra katalogen:",
  "- Copy the `id` and the `secret` it prints: the secret is shown only once.":
    "- Kopier `id` og `secret` som den skriver ut: hemmeligheten vises bare én gang.",
  "- Never add `--unrestricted`, which would let it make more credentials.":
    "- Legg aldri til `--unrestricted`, som ville la den opprette flere legitimasjoner.",
  "- Access rules work only where each service sets `service_type` in its `[keystone_authtoken]` section and has been restarted since: `compute`, `network`, `block-storage` (the rules also carry `volume` and `volumev3`, for a Cinder configured that way), `image` and `placement`. Keystone needs nothing. Without that, the services refuse the credential with a `401`.":
    "- Tilgangsregler virker bare der hver tjeneste setter `service_type` i sin seksjon `[keystone_authtoken]` og har blitt startet på nytt siden: `compute`, `network`, `block-storage` (reglene har også `volume` og `volumev3`, for en Cinder som er satt opp slik), `image` og `placement`. Keystone trenger ingenting. Uten det avviser tjenestene legitimasjonen med en `401`.",
  "- If you won't change that, leave out `--access-rules`. That makes a plain admin application credential, which can write as well as read, so keep it as safe as an admin password.":
    "- Vil du ikke endre det, utelater du `--access-rules`. Det gir en vanlig applikasjonslegitimasjon for administrator, som kan skrive like godt som lese, så ta like godt vare på den som på et administratorpassord.",
  "- It stops working when it expires. To replace it, make the second credential before you delete the first.":
    "- Den slutter å virke når den utløper. For å erstatte den oppretter du den nye legitimasjonen før du sletter den gamle.",
  "No admin. The agent sees all of Keystone's projects, domains, services and endpoints, all of Nova including every project's instances, all of Placement, and Neutron's agents and address pools. Volumes, snapshots, networks, subnets, routers, floating IPs and ports appear only for the projects the role is assigned on, so on a project that holds nothing just the shared and external ones, and OneUptime can't see the others.":
    "Ingen administrator. Agenten ser alle Keystones prosjekter, domener, tjenester og endepunkter, hele Nova inkludert hvert prosjekts instanser, hele Placement, og Neutrons agenter og adressepooler. Volumer, øyeblikksbilder, nettverk, subnett, rutere, flytende IP-er og porter vises bare for prosjektene rollen er tildelt på, så på et tomt prosjekt bare de delte og eksterne, og OneUptime kan ikke se de andre.",
  "It does not see `cinder-volume` or `cinder-scheduler` state or storage pools: Cinder's own code asks for an admin there, after policy has already passed, so no override opens them, and only **Full view** sees them.":
    "Den ser ikke tilstanden til `cinder-volume` eller `cinder-scheduler` eller lagringspooler: Cinders egen kode krever en administrator der, etter at policyen allerede har godkjent, så ingen overstyring åpner dem, og bare **Full visning** ser dem.",
  "This is a role of its own, `oneuptime_monitoring`, with the policy overrides the agent ships, on a project of its own that holds nothing and has zero quota. Where Cinder has `enforce_new_defaults` off, which is Cinder's own default, any role on a project can create that project's volumes. With nothing to touch and no quota to make anything with, there is nothing for it to write: on every release we record, every write answered `403`, or `409` and `413` from quota. As an admin, make the role, the project and an account:":
    "Dette er en egen rolle, `oneuptime_monitoring`, med policyoverstyringene agenten leverer, på et eget prosjekt som ikke inneholder noe og har null kvote. Der Cinder har `enforce_new_defaults` slått av, som er Cinders egen standard, kan enhver rolle på et prosjekt opprette det prosjektets volumer. Uten noe å røre og uten kvote å opprette noe med, er det ingenting for den å skrive: på hver utgivelse vi registrerer, ble hver skriving besvart med `403`, eller med `409` og `413` på grunn av kvoten. Opprett rollen, prosjektet og en konto som administrator:",
  "Download the overrides, and merge each, on every controller, into the file named by `[oslo_policy] policy_file` in that service's config. That is `/etc/nova/policy.yaml` and so on, unless your deployment says otherwise. Each override keeps the service's default and adds the role. oslo.policy notices a changed file on its own, so nothing restarts:":
    "Last ned overstyringene, og flett hver av dem, på hver kontroller, inn i filen som `[oslo_policy] policy_file` angir i den tjenestens konfigurasjon. Det er `/etc/nova/policy.yaml` og så videre, med mindre utrullingen din sier noe annet. Hver overstyring beholder tjenestens standard og legger til rollen. oslo.policy oppdager selv en endret fil, så ingenting startes på nytt:",
  "**To take the overrides off again, empty the file (`{}`) and never delete it.** On Flamingo (2025.2) and Epoxy (2025.1), oslo.policy raises on every check once a policy file it has read is gone, so that service fails every request. When the service is Keystone, it stops validating tokens and the whole cloud answers `503`. If it has already happened, restart the service.":
    "**For å fjerne overstyringene igjen tømmer du filen (`{}`) og sletter den aldri.** På Flamingo (2025.2) og Epoxy (2025.1) feiler oslo.policy ved hver sjekk så snart en policyfil den har lest, er borte, så den tjenesten feiler hver forespørsel. Når tjenesten er Keystone, slutter den å validere tokener, og hele skyen svarer `503`. Har det allerede skjedd, starter du tjenesten på nytt.",
  "Then, logged in as that account on that project, make the credential and copy the `id` and the `secret` it prints:":
    "Opprett deretter, pålogget som den kontoen på det prosjektet, legitimasjonen, og kopier `id` og `secret` som den skriver ut:",
  "Putting the role on a real project to see its volumes and routers also lets the account write there, on a cloud where Cinder has `enforce_new_defaults` off. `troubleshoot.sh` warns when the credential's project holds things.":
    "Setter du rollen på et ekte prosjekt for å se volumene og ruterne der, kan kontoen også skrive der, på en sky der Cinder har `enforce_new_defaults` slått av. `troubleshoot.sh` advarer når legitimasjonens prosjekt inneholder noe.",
  "For a team watching its own part of a cloud someone else runs. The agent sees one project's volumes, networks and routers, and no infrastructure: no hypervisors, services or storage pools.":
    "For et team som overvåker sin egen del av en sky som noen andre driver. Agenten ser ett prosjekts volumer, nettverk og rutere, og ingen infrastruktur: ingen hypervisorer, tjenester eller lagringspooler.",
  "Through the agent it shows no instances at all: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. Only a OneUptime probe, collecting without this agent, can list one project's instances.":
    "Gjennom agenten viser dette nivået ingen instanser i det hele tatt: exporteren ber Nova om alle prosjekters servere, Nova avviser en vanlig leser, og den lesingen feiler helt. Bare en OneUptime-sonde, som samler inn uten denne agenten, kan liste ett prosjekts instanser.",
  "This is the plain `reader` role. Give an account the role on the project:":
    "Dette er den vanlige rollen `reader`. Gi en konto rollen på prosjektet:",
  "Neutron and Cinder answer a reader with its own project and no error, so these lists look complete, and hold only that project.":
    "Neutron og Cinder svarer en leser med dens eget prosjekt og uten feil, så disse listene ser fullstendige ut og inneholder bare det prosjektet.",
  "It may be able to write. On a cloud where Cinder has `enforce_new_defaults` off, which is Cinder's own default, plain `reader` can create volumes in its project too. On Epoxy, Flamingo and Gazpacho it did, and on Hibiscus it was refused, because DevStack only turns `enforce_new_defaults` on there.":
    "Den kan kanskje skrive. På en sky der Cinder har `enforce_new_defaults` slått av, som er Cinders egen standard, kan en vanlig `reader` også opprette volumer i sitt prosjekt. På Epoxy, Flamingo og Gazpacho gjorde den det, og på Hibiscus ble det avvist, fordi DevStack bare slår på `enforce_new_defaults` der.",
  "No credential and nothing new to run: the agent reads the exporter Kolla-Ansible already runs, through its internal VIP on `9198`. Skip the install's credential questions by giving it the address:":
    "Ingen legitimasjon og ingenting nytt å kjøre: agenten leser exporteren Kolla-Ansible allerede kjører, gjennom dens interne VIP på `9198`. Hopp over installasjonens spørsmål om legitimasjon ved å gi den adressen:",
  "Kolla-Ansible pins exporter 1.7.0 and runs it without `--multi-cloud`, so it has no `/probe`: the agent asks it for everything at once, every 2 minutes, on top of Kolla-Ansible's own Prometheus asking every minute. Its answer also says less. On five real clouds, the pages went without:":
    "Kolla-Ansible låser exporteren til 1.7.0 og kjører den uten `--multi-cloud`, så den har ingen `/probe`: agenten ber den om alt på én gang, hvert 2. minutt, i tillegg til Kolla-Ansibles egen Prometheus som spør hvert minutt. Svaret sier også mindre. På fem ekte skyer manglet sidene:",
  "| Goes without | Because | What it costs |":
    "| Mangler | Fordi | Hva det koster |",
  "| Everything of Cinder's | It asks the catalog for `volumev3`, and finds no such thing where Cinder registers as `block-storage` | **Volumes** and **Storage pools** stay empty, and **Services** has no Block Storage API, `cinder-volume` or `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** and **Volume Stuck** stay quiet |":
    "| Alt fra Cinder | Den ber katalogen om `volumev3` og finner ikke noe slikt der Cinder registrerer seg som `block-storage` | **Volumer** og **Lagringspooler** forblir tomme, og **Tjenester** har ingen Block Storage API, `cinder-volume` eller `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** og **Volume Stuck** forblir stille |",
  "| How many instances a hypervisor holds, and its aggregates | Nova's list of hypervisors fails at the newest microversion, which Kolla-Ansible asks for | Those two on **Hypervisors**, and what a lost host says it takes with it. Its vCPUs, memory and disk are still there: they come from Placement |":
    "| Hvor mange instanser en hypervisor har, og dens aggregater | Novas liste over hypervisorer feiler ved den nyeste mikroversjonen, som Kolla-Ansible ber om | De to på **Hypervisorer**, og hva en tapt vert sier at den tar med seg. Dens vCPU-er, minne og disk er der fortsatt: de kommer fra Placement |",
  "| Domains | It has no such series | **Domains** stays empty |":
    "| Domener | Den har ingen slik serie | **Domener** forblir tom |",
  "| An image's status, visibility and creation date | It has no such labels | Those columns on **Images**. **Image Stuck** stays quiet, so an image stuck on its way to `active` goes unnoticed |":
    "| Et images status, synlighet og opprettelsesdato | Den har ingen slike etiketter | De kolonnene på **Bilder**. **Image Stuck** forblir stille, så et image som setter seg fast på vei til `active`, går ubemerket hen |",
  "| A network's MTU | It has no such label | That line on a network's page |":
    "| Et nettverks MTU | Den har ingen slik etikett | Den linjen på et nettverks side |",
  "If you need those, use one of the other tabs and the agent's own exporter. You can change your mind later: a cloud keeps its name whichever reads it.":
    "Trenger du dem, bruker du en av de andre fanene og agentens egen exporter. Du kan ombestemme deg senere: en sky beholder navnet sitt uansett hva som leser den.",
  "The script asks for:": "Skriptet spør etter:",
  "- **OneUptime URL and ingestion key**, both shown in step 1. Pick a key there to have them filled in here.":
    "- **OneUptime-URL og inntaksnøkkel**, begge vist i trinn 1. Velg en nøkkel der for å få dem fylt inn her.",
  "- **Cloud name**: how the cloud appears in OneUptime. Keep it stable: a new name registers a new cloud.":
    "- **Skynavn**: hvordan skyen vises i OneUptime. Hold det stabilt: et nytt navn registrerer en ny sky.",
  "- **Keystone auth URL**, such as `https://keystone.example.com:5000/v3`.":
    "- **Keystone-autentiserings-URL**, for eksempel `https://keystone.example.com:5000/v3`.",
  "- **Region names**, comma-separated (`RegionOne` if you have one).":
    "- **Regionnavn**, kommaseparert (`RegionOne` hvis du har én).",
  "- **Application credential**: the ID and secret from the previous step. Neither is echoed to the screen, and neither goes on a command line.":
    "- **Applikasjonslegitimasjon**: ID-en og hemmeligheten fra forrige trinn. Ingen av dem vises på skjermen, og ingen av dem havner på en kommandolinje.",
  "- **Private CA file**, only if the cloud's certificate comes from its own certificate authority.":
    "- **Fil for privat CA**, bare hvis skyens sertifikat kommer fra dens egen sertifiseringsinstans.",
  "It checks the credential with Keystone before it installs anything, installs to `/opt/oneuptime-openstack-agent` (or to `oneuptime-openstack-agent` in your home folder if you have no rights on `/opt`, and it says which), writes a `.env` file and a `clouds.yaml` only their owner can read, and starts everything with Docker Compose. Running it again reuses all of that instead of asking again, so it is also how you upgrade.":
    "Det sjekker legitimasjonen mot Keystone før det installerer noe, installerer til `/opt/oneuptime-openstack-agent` (eller til `oneuptime-openstack-agent` i hjemmemappen din hvis du ikke har rettigheter på `/opt`, og det sier hvilken), skriver en `.env`-fil og en `clouds.yaml` som bare eieren kan lese, og starter alt med Docker Compose. Kjører du det igjen, gjenbruker det alt dette i stedet for å spørre på nytt, så det er også slik du oppgraderer.",
  "`docker compose ps` lists the collector (`oneuptime-openstack-agent`), the bundled exporter (`oneuptime-openstack-exporter`) and the OneUptime AI agent (`oneuptime-openstack-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cloud then appears in the **OpenStack** section by itself. Give it about five minutes to fill in: compute, network, volume and Placement are read every 2 minutes, identity and images every 5.":
    "`docker compose ps` viser innsamleren (`oneuptime-openstack-agent`), den medfølgende exporteren (`oneuptime-openstack-exporter`) og OneUptimes AI-agent (`oneuptime-openstack-ai-agent`). Se i innsamlerens logger etter `Everything is ready. Begin running and processing data.` Skyen dukker deretter opp av seg selv i seksjonen **OpenStack**. Gi den omtrent fem minutter på å fylles: compute, nettverk, volumer og Placement leses hvert 2. minutt, identitet og images hvert 5.",
  "On the host that runs Kolla-Ansible's Prometheus, this reads its targets from the file Kolla-Ansible rendered, and prints them as settings for the agent:":
    "På verten som kjører Kolla-Ansibles Prometheus, leser dette målene dens fra filen Kolla-Ansible genererte, og skriver dem ut som innstillinger for agenten:",
  "Add what it prints to the agent's `.env`, then run `docker compose up -d` in the agent's folder. Each exporter listens on the API network, so the agent's machine needs a route there. The cloud's **Control Plane** card then says how each one is, and says plainly which ones are not watched.":
    "Legg det den skriver ut til i agentens `.env`, og kjør deretter `docker compose up -d` i agentens mappe. Hver exporter lytter på API-nettverket, så agentens maskin trenger en rute dit. Skyens kort **Kontrollplan** sier da hvordan det står til med hver, og sier klart hvilke som ikke overvåkes.",
  "| Reads | Port | Setting |": "| Leser | Port | Innstilling |",
  "| RabbitMQ's Prometheus plugin | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |":
    "| RabbitMQs Prometheus-tillegg | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |",
  "| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |":
    "| mysqld_exporter, for MariaDB | `9104` | `OPENSTACK_MARIADB_TARGETS` |",
  "| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |":
    "| memcached_exporter, for Memcached | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |",
  "| HAProxy's own exporter | `9101` | `OPENSTACK_HAPROXY_TARGETS` |":
    "| HAProxys egen exporter | `9101` | `OPENSTACK_HAPROXY_TARGETS` |",
  "| openstack-network-exporter, for OVN and Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |":
    "| openstack-network-exporter, for OVN og Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |",
  "| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |":
    "| prometheus-libvirt-exporter, for libvirt | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |",
  "- **OVN's databases:** Kolla-Ansible runs openstack-network-exporter from 2026.1, on compute and network nodes only, and an OVN database is read from the host it runs on. If your control nodes are neither, add them under `[prometheus-openstack-network-exporter:children]` in your inventory and reconfigure, or the Northbound and Southbound databases read as not watched.":
    "- **OVNs databaser:** Kolla-Ansible kjører openstack-network-exporter fra 2026.1, bare på compute- og nettverksnoder, og en OVN-database leses fra verten den kjører på. Er kontrollnodene dine ingen av delene, legger du dem til under `[prometheus-openstack-network-exporter:children]` i inventaret ditt og konfigurerer på nytt, ellers vises Northbound- og Southbound-databasene som ikke overvåket.",
  "- **Before 2026.1** there is no network exporter, so OVN and Open vSwitch read as not watched.":
    "- **Før 2026.1** finnes det ingen nettverks-exporter, så OVN og Open vSwitch vises som ikke overvåket.",
  "The agent's logs profile runs on each node, and reads Kolla-Ansible's files. It is what joins a line to the cloud's pages:":
    "Agentens loggprofil kjører på hver node og leser Kolla-Ansibles filer. Det er den som knytter en linje til skyens sider:",
  "Kolla's own Fluentd can forward too, with an output in `/etc/kolla/config/fluentd/output/*.conf` as [Fluentd](/docs/telemetry/fluentd) describes, but those records reach **Logs** under a service's name, and not the cloud's pages.":
    "Kollas egen Fluentd kan også videresende, med en utdata i `/etc/kolla/config/fluentd/output/*.conf` slik [Fluentd](/docs/telemetry/fluentd) beskriver, men de postene havner i **Logger** under en tjenestes navn, og ikke på skyens sider.",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from `/var/log/kolla`.":
    "Hver skriver til tjenestens egen logg, uten noen forbruker på bussen. OneUptime leser dem derfra så snart **Finn sikkerhetshendelser i loggene dine** er slått på under **Sikkerhetshendelser → Tilkoblinger**. Agentens loggprofil leser begge fra `/var/log/kolla`.",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw.":
    "Dette sender en linje for hver pålogging, som **OpenStack admin credential used from a new address** leser. For å sende bare mislykkede pålogginger legger du `identity.authenticate.success` til `notification_opt_out`; den deteksjonen leser da det revisjonsfilteret så.",
  "For who did what through Nova, Neutron, Cinder and Glance, the audit filter needs a setting, which goes in every service's config at once:":
    "For å se hvem som gjorde hva gjennom Nova, Neutron, Cinder og Glance, trenger revisjonsfilteret en innstilling, som skal i alle tjenestenes konfigurasjon på én gang:",
  "It also needs a paste file, and Kolla-Ansible's config tasks copy no paste file for these services. Put yours on each API host, and mount it over the one in the image with `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` and `glance_api_extra_volumes` in `globals.yml`. pyCADF's map files are in `/var/lib/kolla/venv/etc/pycadf` in the image. [Who did what](/docs/telemetry/openstack#who-did-what) has the filter's lines.":
    "Det trenger også en paste-fil, og Kolla-Ansibles konfigurasjonsoppgaver kopierer ingen paste-fil for disse tjenestene. Legg din på hver API-vert, og monter den over den i imaget med `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` og `glance_api_extra_volumes` i `globals.yml`. pyCADFs map-filer ligger i `/var/lib/kolla/venv/etc/pycadf` i imaget. [Hvem gjorde hva](/docs/telemetry/openstack#who-did-what) har filterets linjer.",
  "OpenStack's `reader` role is scoped to a project everywhere except Keystone and Ironic, and hypervisors, services, agents, pools and Placement default to admin. A policy override can't open all-project lists in Cinder or Neutron, because they scope those lists in code, and Cinder's own code keeps its services and storage pools for an admin. So what a credential can read depends on which level you choose. This is what five real clouds answered, on Epoxy, Flamingo, Gazpacho (OVN and OVS) and Hibiscus:":
    "OpenStacks rolle `reader` er begrenset til ett prosjekt overalt unntatt i Keystone og Ironic, og hypervisorer, tjenester, agenter, pooler og Placement er som standard forbeholdt administratoren. En policyoverstyring kan ikke åpne lister over alle prosjekter i Cinder eller Neutron, fordi de begrenser de listene i koden, og Cinders egen kode forbeholder tjenestene og lagringspoolene sine en administrator. Så hva en legitimasjon kan lese, avhenger av hvilket nivå du velger. Dette svarte fem ekte skyer, på Epoxy, Flamingo, Gazpacho (OVN og OVS) og Hibiscus:",
  "| Read | Level 1: Full view | Level 2: Infrastructure only | Level 3: Project view |":
    "| Lesing | Nivå 1: Full visning | Nivå 2: Kun infrastruktur | Nivå 3: Prosjektvisning |",
  "| Keystone: projects | all | all | refused |":
    "| Keystone: prosjekter | alt | alt | avvist |",
  "| Keystone: domains | all | all | refused |":
    "| Keystone: domener | alt | alt | avvist |",
  "| Keystone: regions | all | what anyone sees | what anyone sees |":
    "| Keystone: regioner | alt | det alle ser | det alle ser |",
  "| Keystone: services | all | all | refused |":
    "| Keystone: tjenester | alt | alt | avvist |",
  "| Keystone: endpoints | all | all | refused |":
    "| Keystone: endepunkter | alt | alt | avvist |",
  "| Nova: servers, all projects | all | all | refused |":
    "| Nova: servere, alle prosjekter | alt | alt | avvist |",
  "| Nova: services | all | all | refused |":
    "| Nova: tjenester | alt | alt | avvist |",
  "| Nova: hypervisors | all | all | refused |":
    "| Nova: hypervisorer | alt | alt | avvist |",
  "| Nova: aggregates | all | all | refused |":
    "| Nova: aggregater | alt | alt | avvist |",
  "| Nova: availability zones, detail | all | all | refused |":
    "| Nova: tilgjengelighetssoner, detaljer | alt | alt | avvist |",
  "| Nova: flavors | all | what anyone sees | what anyone sees |":
    "| Nova: flavors | alt | det alle ser | det alle ser |",
  "| Nova: usage per project | all | all | refused |":
    "| Nova: bruk per prosjekt | alt | alt | avvist |",
  "| Placement: resource providers | all | all | refused |":
    "| Placement: ressursleverandører | alt | alt | avvist |",
  "| Neutron: agents | all | all | nothing |":
    "| Neutron: agenter | alt | alt | ingenting |",
  "| Neutron: networks | all | own project only | own project only |":
    "| Neutron: nettverk | alt | bare eget prosjekt | bare eget prosjekt |",
  "| Neutron: subnets | all | own project only | own project only |":
    "| Neutron: subnett | alt | bare eget prosjekt | bare eget prosjekt |",
  "| Neutron: routers | all | own project only | own project only |":
    "| Neutron: rutere | alt | bare eget prosjekt | bare eget prosjekt |",
  "| Neutron: floating IPs | all | own project only | own project only |":
    "| Neutron: flytende IP-er | alt | bare eget prosjekt | bare eget prosjekt |",
  "| Neutron: IP availabilities | all | all | nothing |":
    "| Neutron: IP-tilgjengelighet | alt | alt | ingenting |",
  "| Neutron: security groups | all | 409, expected | own project only |":
    "| Neutron: sikkerhetsgrupper | alt | 409, forventet | bare eget prosjekt |",
  "| Neutron: ports | all | own project only | own project only |":
    "| Neutron: porter | alt | bare eget prosjekt | bare eget prosjekt |",
  "| Neutron: quotas | all | refused | refused |":
    "| Neutron: kvoter | alt | avvist | avvist |",
  "| Cinder: volumes, all projects | all | own project only | own project only |":
    "| Cinder: volumer, alle prosjekter | alt | bare eget prosjekt | bare eget prosjekt |",
  "| Cinder: services | all | refused | refused |":
    "| Cinder: tjenester | alt | avvist | avvist |",
  "| Cinder: pools | all | refused | refused |":
    "| Cinder: pooler | alt | avvist | avvist |",
  "| Cinder: snapshots, all projects | all | own project only | own project only |":
    "| Cinder: øyeblikksbilder, alle prosjekter | alt | bare eget prosjekt | bare eget prosjekt |",
  "| Cinder: backups, all projects | all | none recorded | none recorded |":
    "| Cinder: sikkerhetskopier, alle prosjekter | alt | ingen registrert | ingen registrert |",
  "| Cinder: volume types | all | what anyone sees | what anyone sees |":
    "| Cinder: volumtyper | alt | det alle ser | det alle ser |",
  "| Glance: images | all | what anyone sees | what anyone sees |":
    "| Glance: images | alt | det alle ser | det alle ser |",
  "- **all**: the same rows an admin saw.":
    "- **alt**: de samme radene som en administrator så.",
  "- **own project only**: that project's rows, and anything shared or external. On a project that holds nothing, that is just the shared and external ones.":
    "- **bare eget prosjekt**: det prosjektets rader, og alt som er delt eller eksternt. På et tomt prosjekt er det bare de delte og eksterne.",
  "- **refused**: a `401` or a `403`.":
    "- **avvist**: en `401` eller en `403`.",
  "- **what anyone sees**: every credential saw every row, on clouds that hold only public flavors, volume types and images. A private one in another project takes **Full view**.":
    "- **det alle ser**: hver legitimasjon så hver rad, på skyer som bare har offentlige flavors, volumtyper og images. Et privat element i et annet prosjekt krever **Full visning**.",
  "- **nothing**: a `200` with no rows, on a project that has networks too. It looks like it worked, and it did not.":
    "- **ingenting**: en `200` uten rader, på et prosjekt som også har nettverk. Det ser ut som det virket, og det gjorde det ikke.",
  "- **none recorded**: a `200` with no rows where an admin saw none either, so there was nothing to tell by.":
    "- **ingen registrert**: en `200` uten rader der en administrator heller ikke så noen, så det var ingenting å skille på.",
  "- **409, expected**: Neutron tries to create the project's default security group when it lists them, and zero quota does not let it, so it answers `409 Quota exceeded`. That is harmless, and nothing to fix.":
    "- **409, forventet**: Neutron prøver å opprette prosjektets standard sikkerhetsgruppe når den lister dem, og null kvote tillater det ikke, så den svarer `409 Quota exceeded`. Det er ufarlig, og ingenting å rette.",
  "A list a credential can't read looks empty here: `troubleshoot.sh` says what this credential can read, and what each gap costs.":
    "En liste som en legitimasjon ikke kan lese, ser tom ut her: `troubleshoot.sh` sier hva denne legitimasjonen kan lese, og hva hvert hull koster.",
  "Monitoring must never be what takes a cloud down, so the agent is gentle by default:":
    "Overvåking må aldri være det som tar ned en sky, så agenten er skånsom som standard:",
  "| Reads | Every | Gives |": "| Leser | Hvert | Gir |",
  "| **Compute (Nova)** | 2 minutes | Services, hypervisors, instances and flavors |":
    "| **Compute (Nova)** | 2. minutt | Tjenester, hypervisorer, instanser og flavors |",
  "| **Placement** | 2 minutes | What each hypervisor can promise, and has promised |":
    "| **Placement** | 2. minutt | Hva hver hypervisor kan love, og har lovet |",
  "| **Networking (Neutron)** | 2 minutes | Agents, networks, subnets, address use, routers and floating IPs |":
    "| **Nettverk (Neutron)** | 2. minutt | Agenter, nettverk, subnett, adressebruk, rutere og flytende IP-er |",
  "| **Block Storage (Cinder)** | 2 minutes | Services, volumes, snapshots and storage pools |":
    "| **Blokklagring (Cinder)** | 2. minutt | Tjenester, volumer, øyeblikksbilder og lagringspooler |",
  "| **Identity (Keystone)** | 5 minutes | Projects and domains |":
    "| **Identitet (Keystone)** | 5. minutt | Prosjekter og domener |",
  "| **Images (Glance)** | 5 minutes | Images |":
    "| **Images (Glance)** | 5. minutt | Images |",
  "- Each service is read on its own, so a failing Nova costs only Nova's numbers, and the rest keep reporting.":
    "- Hver tjeneste leses for seg, så en Nova som feiler, koster bare Novas tall, og resten fortsetter å rapportere.",
  "- A read never outlasts its interval, so a slow one never stacks on the next.":
    "- En lesing varer aldri lenger enn intervallet sitt, så en treg en hoper seg aldri opp på den neste.",
  "- Each project's quotas are off. To turn them on, run the installer again with `OPENSTACK_COLLECT_QUOTAS=true`: a second exporter reads them once an hour, at four calls per project per region. Neutron's quotas answer only **Full view**.":
    "- Hvert prosjekts kvoter er slått av. For å slå dem på kjører du installasjonsprogrammet igjen med `OPENSTACK_COLLECT_QUOTAS=true`: en ekstra exporter leser dem én gang i timen, med fire kall per prosjekt per region. Neutrons kvoter svarer bare **Full visning**.",
  "- Nova's own quota lists and usage per server are off. To turn one on, delete its `--disable-metric` line from the exporter's `command` in `docker-compose.yml`. The cost is one call per project per scrape.":
    "- Novas egne kvotelister og bruk per server er slått av. For å slå på en av dem sletter du linjen `--disable-metric` for den fra exporterens `command` i `docker-compose.yml`. Kostnaden er ett kall per prosjekt per innsamling.",
  "- The per-port series are off: listing every port with an admin credential can saturate Neutron on a large cloud.":
    "- Seriene per port er slått av: å liste hver port med en administratorlegitimasjon kan mette Neutron på en stor sky.",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Give the install script every region's name. It writes one `clouds.yaml` entry for each. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "En sky er én Keystone, uansett hvor mange regioner den har, og én agent leser alle. Gi installasjonsskriptet navnet på hver region. Det skriver én `clouds.yaml`-oppføring for hver. Hver oppføring må være oppkalt etter sin region: innsamleren setter det navnet på exporterens serier som `openstack.region.name`, fordi seriene ikke sier hvilken region de kommer fra. Hver liste i OneUptime kan da filtreres etter region.",
  "Regions with a Keystone of their own are separate clouds to OneUptime: run one agent for each.":
    "Regioner med sin egen Keystone er separate skyer for OneUptime: kjør én agent for hver.",
  "**[Very Large OpenStack Clouds](/docs/telemetry/openstack-very-large-clouds)** has what each size costs and how each of these works.":
    "**[Svært store OpenStack-skyer](/docs/telemetry/openstack-very-large-clouds)** beskriver hva hver størrelse koster og hvordan hver av disse fungerer.",
  "**Past 5,000 instances, summary mode.** The cloud keeps a row for every part and counts per hypervisor, project and status, and its series per instance and per volume stop. It gives up the history of each settled instance's and volume's status, and a chart or a monitor over those series. An instance or volume in a state an alert watches keeps its series, so every alert template goes on working. To keep them for some, choose their projects under **Real usage per instance** on the cloud's **Settings** page.":
    "**Over 5 000 instanser: sammendragsmodus.** Skyen beholder en rad for hver del og tellinger per hypervisor, prosjekt og status, og seriene per instans og per volum stopper. Den gir opp historikken over statusen til hver instans og hvert volum som har roet seg, og diagrammer eller monitorer over de seriene. En instans eller et volum i en tilstand som et varsel følger med på, beholder seriene sine, så hver varselmal fortsetter å virke. For å beholde dem for noen velger du prosjektene deres under **Faktisk bruk per instans** på skyens side **Innstillinger**.",
  "**Sharing a cloud between agents.** Run one agent per region, or per service for the largest clouds, each with the same `OPENSTACK_CLOUD_NAME`. A region and a service belong to one agent, and Keystone to one agent for the whole cloud, or their series arrive twice. List an agent's regions in `OPENSTACK_EXPORTER_CLOUDS`, and its services in `OPENSTACK_AGENT_SERVICES`, such as `compute|placement`.":
    "**Del en sky mellom agenter.** Kjør én agent per region, eller per tjeneste for de største skyene, hver med samme `OPENSTACK_CLOUD_NAME`. En region og en tjeneste hører til én agent, og Keystone til én agent for hele skyen, ellers kommer seriene deres to ganger. List opp en agents regioner i `OPENSTACK_EXPORTER_CLOUDS`, og tjenestene i `OPENSTACK_AGENT_SERVICES`, for eksempel `compute|placement`.",
  "**Past 1,500 hypervisors or 100,000 instances, the database path.** The agent can read the cloud's databases rather than its APIs, which at that size cannot be read in a scrape's time. It asks for a read-only account on each service's database, a route to them from this machine, and one exporter per region and Nova cell. It reads the same series, but for whether each Nova worker is alive and how full each storage pool is, which it still reads from the API, and it cannot say whether an API answers. It has not yet been run against a real database.":
    "**Over 1 500 hypervisorer eller 100 000 instanser: databaseveien.** Agenten kan lese skyens databaser i stedet for API-ene, som i den størrelsen ikke kan leses innenfor tiden til en innsamling. Den trenger en skrivebeskyttet konto på hver tjenestes database, en rute dit fra denne maskinen, og én exporter per region og Nova-celle. Den leser de samme seriene, bortsett fra om hver Nova-worker lever og hvor full hver lagringspool er, som den fortsatt leser fra API-et, og den kan ikke si om et API svarer. Den er ennå ikke kjørt mot en ekte database.",
  "The install script writes these to `/opt/oneuptime-openstack-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`.":
    "Installasjonsskriptet skriver disse til `/opt/oneuptime-openstack-agent/.env`. Etter at du har endret en, tar du den i bruk med `docker compose up -d` i `/opt/oneuptime-openstack-agent`.",
  "| Variable | Required | Description |":
    "| Variabel | Påkrevd | Beskrivelse |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL-en til OneUptime-instansen din (f.eks. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key: the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Inntaksnøkkel for telemetri: den du valgte i trinn 1 |",
  "| `OPENSTACK_CLOUD_NAME` | Yes | The cloud's name in OneUptime, stamped on every metric as the `openstack.cloud.name` resource attribute. Keep it stable: changing it registers a new cloud |":
    "| `OPENSTACK_CLOUD_NAME` | Ja | Skyens navn i OneUptime, satt på hver måling som ressursattributtet `openstack.cloud.name`. Hold det stabilt: endrer du det, registreres en ny sky |",
  "| `OPENSTACK_EXPORTER_CLOUDS` | Yes | The `clouds.yaml` entries to read, one per region and named for the region, in square brackets: `[RegionOne,RegionTwo]` |":
    "| `OPENSTACK_EXPORTER_CLOUDS` | Ja | `clouds.yaml`-oppføringene som skal leses, én per region og oppkalt etter regionen, i hakeparenteser: `[RegionOne,RegionTwo]` |",
  "| `OPENSTACK_AUTH_URL` | Bundled exporter | The Keystone auth URL. `/v3` is added if it is missing |":
    "| `OPENSTACK_AUTH_URL` | Medfølgende exporter | Keystones autentiserings-URL. `/v3` legges til hvis det mangler |",
  "| `OPENSTACK_EXPORTER_ADDRESS` | No | `host:port` of your own exporter, with no scheme. Leave it out for the bundled one |":
    "| `OPENSTACK_EXPORTER_ADDRESS` | Nei | `host:port` for din egen exporter, uten skjema. Utelat den for den medfølgende |",
  "| `OPENSTACK_QUOTA_CLOUDS` | No | The `clouds.yaml` entries to read each project's quotas from, once an hour. The install script sets it when run with `OPENSTACK_COLLECT_QUOTAS=true` |":
    "| `OPENSTACK_QUOTA_CLOUDS` | Nei | `clouds.yaml`-oppføringene som hvert prosjekts kvoter leses fra, én gang i timen. Installasjonsskriptet setter den når det kjøres med `OPENSTACK_COLLECT_QUOTAS=true` |",
  "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | No | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | Nei | `host:port` for exporteren som leser dem. Utelat den for den medfølgende |",
  "| `OPENSTACK_EXPORTER_USER` | No | The `uid:gid` the exporter's container runs as, which must own `clouds.yaml` (default: `65532:65532`) |":
    "| `OPENSTACK_EXPORTER_USER` | Nei | `uid:gid` som exporterens container kjører som, og som må eie `clouds.yaml` (standard: `65532:65532`) |",
  "| `OPENSTACK_CA_FILE` | No | A PEM file with the certificate authority of a cloud that has its own |":
    "| `OPENSTACK_CA_FILE` | Nei | En PEM-fil med sertifiseringsinstansen til en sky som har sin egen |",
  "| `COMPOSE_PROFILES` | Bundled exporter | `openstack-exporter` starts the bundled exporter, and `openstack-ai-agent` the OneUptime AI agent |":
    "| `COMPOSE_PROFILES` | Medfølgende exporter | `openstack-exporter` starter den medfølgende exporteren, og `openstack-ai-agent` OneUptimes AI-agent |",
  "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | No | An exporter already running without `--multi-cloud`, such as Kolla-Ansible's: `[10.0.0.254:9198]`. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it |":
    "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | Nei | En exporter som allerede kjører uten `--multi-cloud`, som Kolla-Ansibles: `[10.0.0.254:9198]`. Sett `OPENSTACK_EXPORTER_CLOUDS=[]` sammen med den |",
  "| `OPENSTACK_RABBITMQ_TARGETS` | No | RabbitMQ's Prometheus plugin on each node: `[10.0.0.11:15692,10.0.0.12:15692]` |":
    "| `OPENSTACK_RABBITMQ_TARGETS` | Nei | RabbitMQs Prometheus-tillegg på hver node: `[10.0.0.11:15692,10.0.0.12:15692]` |",
  "| `OPENSTACK_MARIADB_TARGETS` | No | mysqld_exporter beside each MariaDB node, usually on `9104` |":
    "| `OPENSTACK_MARIADB_TARGETS` | Nei | mysqld_exporter ved siden av hver MariaDB-node, vanligvis på `9104` |",
  "| `OPENSTACK_MEMCACHED_TARGETS` | No | memcached_exporter beside each Memcached, usually on `9150` |":
    "| `OPENSTACK_MEMCACHED_TARGETS` | Nei | memcached_exporter ved siden av hver Memcached, vanligvis på `9150` |",
  "| `OPENSTACK_HAPROXY_TARGETS` | No | HAProxy's own Prometheus exporter |":
    "| `OPENSTACK_HAPROXY_TARGETS` | Nei | HAProxys egen Prometheus-exporter |",
  "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | No | openstack-network-exporter on each node, for OVN and Open vSwitch, usually on `1981` |":
    "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | Nei | openstack-network-exporter på hver node, for OVN og Open vSwitch, vanligvis på `1981` |",
  "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | No | prometheus-libvirt-exporter on each compute node, usually on `9177`, for whether libvirt answers and nothing per instance |":
    "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | Nei | prometheus-libvirt-exporter på hver compute-node, vanligvis på `9177`, for om libvirt svarer, og ingenting per instans |",
  "| `OPENSTACK_CONTROL_PLANE_REGION` | No | The region of a target above that does not say its own. A target can: `RegionTwo@10.1.0.11:15692` |":
    "| `OPENSTACK_CONTROL_PLANE_REGION` | Nei | Regionen til et mål ovenfor som ikke oppgir sin egen. Et mål kan gjøre det: `RegionTwo@10.1.0.11:15692` |",
  "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | No | The same exporter, for what each instance is really doing. Per-instance series multiply fast |":
    "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | Nei | Den samme exporteren, for hva hver instans faktisk gjør. Serier per instans mangedobles raskt |",
  "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | No | Ceilometer's exporter on each compute node, usually on `9101`, for the same |":
    "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | Nei | Ceilometers exporter på hver compute-node, vanligvis på `9101`, for det samme |",
  "`clouds.yaml` alone holds the credential.":
    "Bare `clouds.yaml` inneholder legitimasjonen.",
  "Only the largest clouds need these, and none is asked for:":
    "Bare de største skyene trenger disse, og det spørres ikke om noen av dem:",
  "| Variable | Description |": "| Variabel | Beskrivelse |",
  "| `OPENSTACK_AGENT_SERVICES` | Which services this agent reads, as a pattern: `compute\\|placement` here and the rest on a second agent. Every service by default. No two agents should read one service of one region |":
    "| `OPENSTACK_AGENT_SERVICES` | Hvilke tjenester denne agenten leser, som et mønster: `compute\\|placement` her og resten på en annen agent. Alle tjenester som standard. To agenter skal aldri lese den samme tjenesten i én region |",
  "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | The memory the collector may use, in MiB (default: `512`). It holds a whole scrape, so raise this past tens of thousands of instances |":
    "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | Minnet innsamleren kan bruke, i MiB (standard: `512`). Den holder en hel innsamling, så øk dette når du passerer titusenvis av instanser |",
  "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | Reading each service's database rather than its API, with a read-only account: where that exporter answers. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it, or every series arrives twice |":
    "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | Lesing av hver tjenestes database i stedet for API-et, med en skrivebeskyttet konto: der den exporteren svarer. Sett `OPENSTACK_EXPORTER_CLOUDS=[]` sammen med den, ellers kommer hver serie to ganger |",
  "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | The database of each service it reads, as `mysql+pymysql://oneuptime:secret@db.example:3306/nova`. One left empty is a service it leaves alone. Each holds a password, and `.env` is readable by its owner alone |":
    "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | Databasen til hver tjeneste den leser, som `mysql+pymysql://oneuptime:secret@db.example:3306/nova`. En som står tom, er en tjeneste den lar være. Hver inneholder et passord, og `.env` kan bare leses av eieren |",
  "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | What Nova adds to a host's name to make a hypervisor's, such as `.example.org`, so an instance finds the hypervisor it runs on |":
    "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | Det Nova legger til navnet på en vert for å lage navnet på en hypervisor, for eksempel `.example.org`, så en instans finner hypervisoren den kjører på |",
  "| `OPENSTACK_WORKER_STATE_CLOUDS` | The `clouds.yaml` entries to read from Nova's and Cinder's APIs what their databases cannot say: whether each worker is alive, and how full each pool is |":
    "| `OPENSTACK_WORKER_STATE_CLOUDS` | `clouds.yaml`-oppføringene som brukes til å lese fra Novas og Cinders API-er det databasene deres ikke kan si: om hver worker lever, og hvor full hver pool er |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | `host:port` for exporteren som leser dem. Utelat den for den medfølgende |",
  "| `OPENSTACK_QUOTA_CLOUDS` | The `clouds.yaml` entries to read each project's quotas from, once an hour. Empty reads none, and `OPENSTACK_COLLECT_QUOTAS=true` in the install script fills it in |":
    "| `OPENSTACK_QUOTA_CLOUDS` | `clouds.yaml`-oppføringene som hvert prosjekts kvoter leses fra, én gang i timen. Tom leser ingen, og `OPENSTACK_COLLECT_QUOTAS=true` i installasjonsskriptet fyller den ut |",
  "The OneUptime AI agent reads the credential in `clouds.yaml` unless these say otherwise, and none is asked for:":
    "OneUptimes AI-agent leser legitimasjonen i `clouds.yaml` med mindre disse sier noe annet, og det spørres ikke om noen av dem:",
  "| `ONEUPTIME_AI_INVESTIGATION` | `false` stops OneUptime AI investigating this cloud with the agent |":
    "| `ONEUPTIME_AI_INVESTIGATION` | `false` hindrer OneUptime AI i å undersøke denne skyen med agenten |",
  "| `OPENSTACK_AI_CLOUDS_FILE` | The `clouds.yaml` it mounts. `/dev/null` when it has a credential of its own and there is no such file beside it |":
    "| `OPENSTACK_AI_CLOUDS_FILE` | `clouds.yaml` som den monterer. `/dev/null` når den har sin egen legitimasjon og det ikke ligger noen slik fil ved siden av |",
  "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | The entry of `clouds.yaml` to use, when it is not the first of `OPENSTACK_EXPORTER_CLOUDS` |":
    "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | Oppføringen i `clouds.yaml` som skal brukes, når det ikke er den første i `OPENSTACK_EXPORTER_CLOUDS` |",
  "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | A credential of its own, used instead of `clouds.yaml`'s. Set both, with `OPENSTACK_AUTH_URL` |":
    "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | En egen legitimasjon, brukt i stedet for den i `clouds.yaml`. Sett begge, sammen med `OPENSTACK_AUTH_URL` |",
  "| `OPENSTACK_AUTH_URL` | The Keystone a credential of its own logs in to |":
    "| `OPENSTACK_AUTH_URL` | Keystonen som en egen legitimasjon logger på |",
  "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | The region a command reads when it names none, which endpoints it uses (`public`, `internal` or `admin`), and a certificate authority. `clouds.yaml` says these unless they do |":
    "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | Regionen en kommando leser når den ikke nevner noen, hvilke endepunkter den bruker (`public`, `internal` eller `admin`), og en sertifiseringsinstans. `clouds.yaml` oppgir disse med mindre de gjør det |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | The name it registers under, when it is not `OPENSTACK_CLOUD_NAME` |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | Navnet den registrerer seg under, når det ikke er `OPENSTACK_CLOUD_NAME` |",
  "| `LOG_LEVEL` | How much it logs |": "| `LOG_LEVEL` | Hvor mye den logger |",
  "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | Off until set: let it make changes, through a credential of their own. The OpenStack guide says how to make it with the least it needs |":
    "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | Av til de er satt: lar den gjøre endringer, gjennom en egen legitimasjon. OpenStack-veiledningen sier hvordan du oppretter den med det minste den trenger |",
  "| `ONEUPTIME_AI_FIXES` | How AI may apply a fix: off, ask-for-approval, automatic or bypass-approval. Empty: fixes stay off until someone chooses on this page |":
    "| `ONEUPTIME_AI_FIXES` | Hvordan AI kan bruke en rettelse: off, ask-for-approval, automatic eller bypass-approval. Tom: rettelser forblir av til noen velger på denne siden |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | What is never touched, whatever else is set and whoever approves it: `project:ID`, `host:NAME` or `instance:ID`, separated by commas |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | Det som aldri røres, uansett hva annet som er satt og hvem som godkjenner det: `project:ID`, `host:NAME` eller `instance:ID`, skilt med komma |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | Where changes may land, written the same way. Empty: anywhere that is not protected |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | Hvor endringer kan lande, skrevet på samme måte. Tom: overalt der ingenting er beskyttet |",
  "Set `OPENSTACK_EXPORTER_ADDRESS` as you run the install script, such as `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`. The bundled exporter then never starts, and no Keystone URL or credential is asked for.":
    "Sett `OPENSTACK_EXPORTER_ADDRESS` når du kjører installasjonsskriptet, for eksempel `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`. Den medfølgende exporteren starter da aldri, og det spørres verken om en Keystone-URL eller legitimasjon.",
  "Your exporter must run with `--multi-cloud`, and its `clouds.yaml` needs an entry named for each region. Turn off what the bundled one turns off: see **What the agent collects, and what it costs your cloud**. Use an address the agent's container can reach: `localhost` inside the container is the container itself.":
    "Exporteren din må kjøre med `--multi-cloud`, og dens `clouds.yaml` trenger en oppføring oppkalt etter hver region. Slå av det den medfølgende slår av: se **Hva agenten samler inn, og hva det koster skyen din**. Bruk en adresse agentens container kan nå: `localhost` inne i containeren er containeren selv.",
  "**Started without `--multi-cloud`?** Kolla-Ansible's is, and Canonical's charm. It has no `/probe`, so set `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` instead of the address above, with `OPENSTACK_EXPORTER_CLOUDS=[]` and `OPENSTACK_CONTROL_PLANE_REGION`. It is then asked for everything at once, every 2 minutes.":
    "**Startet uten `--multi-cloud`?** Kolla-Ansibles er det, og Canonicals charm. Den har ingen `/probe`, så sett `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` i stedet for adressen ovenfor, med `OPENSTACK_EXPORTER_CLOUDS=[]` og `OPENSTACK_CONTROL_PLANE_REGION`. Den blir da spurt om alt på én gang, hvert 2. minutt.",
  "**On exporter 1.7.0,** which Kolla-Ansible pins, it answers either way, and the pages go without what it does not say. On five real clouds that was:":
    "**På exporter 1.7.0,** som Kolla-Ansible låser til, svarer den uansett, og sidene mangler det den ikke sier. På fem ekte skyer var det:",
  "Give the install script the file when it asks for a private CA file. It copies it to `ca.pem`, and names it in `clouds.yaml`.":
    "Gi installasjonsskriptet filen når det spør etter en fil for privat CA. Det kopierer den til `ca.pem` og oppgir den i `clouds.yaml`.",
  "On Linux (x86_64 or arm64) with systemd 235 or later and glibc 2.34 or later (not RHEL 8), the install script can run the same collector and exporter releases as systemd services instead:":
    "På Linux (x86_64 eller arm64) med systemd 235 eller nyere og glibc 2.34 eller nyere (ikke RHEL 8) kan installasjonsskriptet i stedet kjøre de samme utgivelsene av innsamleren og exporteren som systemd-tjenester:",
  "Moving off a Docker install? Run `docker compose down` first, or every metric arrives twice. Running the script again stays whichever it was, so `sudo bash install.sh` is the upgrade.":
    "Flytter du fra en Docker-installasjon? Kjør `docker compose down` først, ellers kommer hver måling to ganger. Kjører du skriptet igjen, blir det ved den måten det allerede kjørte på, så `sudo bash install.sh` er oppgraderingen.",
  "The `resource` processor in `otel-collector-config.yaml` stamps every metric with the cloud's name. OneUptime registers the cloud from that attribute, and every page and monitor scopes on it. The two deletes keep OneUptime from registering a Service named after the scrape job, so keep them if you customize the file:":
    "Prosessoren `resource` i `otel-collector-config.yaml` setter skyens navn på hver måling. OneUptime registrerer skyen ut fra det attributtet, og hver side og monitor avgrenses etter det. De to slettingene hindrer OneUptime i å registrere en tjeneste oppkalt etter innsamlingsjobben, så behold dem hvis du tilpasser filen:",
  "The whole file is on this OneUptime:":
    "Hele filen ligger på denne OneUptime:",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cloud: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `openstack.cloud.name`:":
    "Ethvert ressursattributt med prefikset `oneuptime.label.` blir en prosjektetikett på skyen: `oneuptime.label.<dimension>=<value>` er etiketten `<dimension>:<value>`. Legg dem til prosessoren `resource` i `otel-collector-config.yaml`, ved siden av `openstack.cloud.name`:",
  "Then restart the collector so it reads the new config:":
    "Start deretter innsamleren på nytt så den leser den nye konfigurasjonen:",
  "The cloud shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Skyen vises med etikettene `team:platform` og `env:production`. Etiketter sammenlignes uten hensyn til store og små bokstaver, så en eksisterende etikett `Production` gjenbrukes; etiketter som er lagt til i OneUptimes brukergrensesnitt, fjernes aldri av agenten.",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` and `clouds.yaml` (nothing is asked again), downloads the latest files (a file you edited is kept next to the new one as `<file>.bak.<timestamp>`), pulls the images and recreates the agent with them:":
    "**Oppgradering.** Imagene er låst i `docker-compose.yml` og konfigurasjonen er en fil ved siden av, så en pull alene flytter ikke agenten fremover. Kjør installasjonsskriptet igjen. Det gjenbruker hver verdi i din eksisterende `.env` og `clouds.yaml` (det spørres ikke om noe på nytt), laster ned de nyeste filene (en fil du har redigert, beholdes ved siden av den nye som `<file>.bak.<timestamp>`), henter imagene og gjenoppretter agenten med dem:",
  "The config reports the collector version it pins as the cloud's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Konfigurasjonen rapporterer innsamlerversjonen den låser til som skyens **Agentversjon**. Når denne OneUptime låser til en nyere, åpner et varseltegn ved siden av disse kommandoene.",
  "**Uninstall** the agent:": "**Avinstaller** agenten:",
  "Then delete `/opt/oneuptime-openstack-agent`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "Slett deretter `/opt/oneuptime-openstack-agent`, som inneholder legitimasjonen, og selve applikasjonslegitimasjonen: `openstack application credential delete oneuptime-agent`.",
  "`troubleshoot.sh` checks the whole chain, from DNS and TLS to Keystone, each service in the catalog and your ingestion key, and says what this credential can read and what each gap costs.":
    "`troubleshoot.sh` sjekker hele kjeden, fra DNS og TLS til Keystone, hver tjeneste i katalogen og inntaksnøkkelen din, og sier hva denne legitimasjonen kan lese og hva hvert hull koster.",
  "It needs `sudo` to read `clouds.yaml`, or it skips the credential checks. It ends with a verdict naming the most likely cause.":
    "Det trenger `sudo` for å lese `clouds.yaml`, ellers hopper det over sjekkene av legitimasjonen. Det avslutter med en dom som nevner den mest sannsynlige årsaken.",
  "1. Check that the agent is running (in `/opt/oneuptime-openstack-agent`): `docker compose ps`":
    "1. Sjekk at agenten kjører (i `/opt/oneuptime-openstack-agent`): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-openstack-agent | grep -i error`":
    "2. Sjekk agentens logger for feil: `docker compose logs oneuptime-openstack-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Bekreft at OneUptime-URL-en og inntaksnøkkelen din er riktige.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Sørg for at agentmaskinen kan nå OneUptime-instansen over nettverket.",
  "A **Project view** credential can't read them, and neither can a role without the policy overrides: Nova, Neutron and Placement keep them for admins by default. Use **Full view**, or **Infrastructure only** with the files in `access/policy` merged into the file each service's `[oslo_policy] policy_file` names. `troubleshoot.sh` says which reads were refused.":
    "En legitimasjon med **Prosjektvisning** kan ikke lese dem, og det kan heller ikke en rolle uten policyoverstyringene: Nova, Neutron og Placement forbeholder dem administratorer som standard. Bruk **Full visning**, eller **Kun infrastruktur** med filene i `access/policy` flettet inn i filen som hver tjenestes `[oslo_policy] policy_file` angir. `troubleshoot.sh` sier hvilke lesinger som ble avvist.",
  "Only **Full view** sees `cinder-volume` and `cinder-scheduler` state and storage pools. Cinder's own code answers anything else with `403 User does not have admin privileges`, after policy has already passed, so no override opens them.":
    "Bare **Full visning** ser tilstanden til `cinder-volume` og `cinder-scheduler` og lagringspoolene. Cinders egen kode svarer alt annet med `403 User does not have admin privileges`, etter at policyen allerede har godkjent, så ingen overstyring åpner dem.",
  "Neutron and Cinder answer anything but an admin with `200` and only its own project, which looks like it worked. Seeing every project takes **Full view**. With **Infrastructure only**, they appear for the projects the role is assigned on, and a role on a real project can also write there on many clouds.":
    "Neutron og Cinder svarer alt annet enn en administrator med `200` og bare dens eget prosjekt, som ser ut som om det virket. Å se hvert prosjekt krever **Full visning**. Med **Kun infrastruktur** vises de for prosjektene rollen er tildelt på, og en rolle på et ekte prosjekt kan også skrive der på mange skyer.",
  "A **Project view** credential shows no instances through the agent: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. **Full view** and **Infrastructure only** both see every project's instances.":
    "En legitimasjon med **Prosjektvisning** viser ingen instanser gjennom agenten: exporteren ber Nova om alle prosjekters servere, Nova avviser en vanlig leser, og den lesingen feiler helt. **Full visning** og **Kun infrastruktur** ser begge hvert prosjekts instanser.",
  "That is expected with **Infrastructure only**, and harmless. Neutron tries to create a project's default security group when it lists them, and a project with zero quota cannot hold one. There is nothing to fix.":
    "Det er forventet med **Kun infrastruktur**, og ufarlig. Neutron prøver å opprette et prosjekts standard sikkerhetsgruppe når den lister dem, og et prosjekt med null kvote kan ikke ha en. Det er ingenting å rette.",
  "On Flamingo and Epoxy, oslo.policy raises on every check once a policy file it has read is gone, and when the service is Keystone the whole cloud answers `503`. Restart the service. To take the overrides off, empty the file (`{}`) and never delete it.":
    "På Flamingo og Epoxy feiler oslo.policy ved hver sjekk så snart en policyfil den har lest, er borte, og når tjenesten er Keystone, svarer hele skyen `503`. Start tjenesten på nytt. For å fjerne overstyringene tømmer du filen (`{}`) og sletter den aldri.",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in `/opt/oneuptime-openstack-agent`): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "Agenten leser hver tjeneste for seg, så en tjeneste som feiler, koster bare sine egne tall. Se hvorfor exporteren ikke kan lese den (i `/opt/oneuptime-openstack-agent`): `docker compose logs oneuptime-openstack-exporter`. Siden **Tjenester** viser det API-et som `down`. En legitimasjon med tilgangsregler laget fra en eldre kopi av reglene gjør også dette på Swift, og på Octavia bak en sti: opprett en ny, slik **Full visning** beskriver.",
  "The services are refusing a credential limited by access rules. A service behind a path prefix refuses the shipped rules: fit them to this cloud with `access-rules-for-cloud.py`, as **Full view** does. And each service needs `service_type` set for keystonemiddleware, and a restart:":
    "Tjenestene avviser en legitimasjon begrenset av tilgangsregler. En tjeneste bak et stiprefiks avviser de medfølgende reglene: tilpass dem til denne skyen med `access-rules-for-cloud.py`, slik **Full visning** beskriver. Og hver tjeneste trenger `service_type` satt for keystonemiddleware, og en omstart:",
  "If you won't change that, create the credential without `--access-rules`, knowing it can write.":
    "Vil du ikke endre det, oppretter du legitimasjonen uten `--access-rules`, vel vitende om at den kan skrive.",
  "The exporter runs as uid 65532, and `clouds.yaml` is readable by its owner alone. Give the file to that user, or set `OPENSTACK_EXPORTER_USER` in `.env` to the file owner's `uid:gid`, and apply it with `docker compose up -d`.":
    "Exporteren kjører som uid 65532, og `clouds.yaml` kan bare leses av eieren. Gi filen til den brukeren, eller sett `OPENSTACK_EXPORTER_USER` i `.env` til fileierens `uid:gid`, og ta det i bruk med `docker compose up -d`.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "Skyens identitet kommer fra `OPENSTACK_CLOUD_NAME`, satt på hver måling som `openstack.cloud.name`. Rett det i `.env`, og ta det i bruk med `docker compose up -d` i `/opt/oneuptime-openstack-agent`. Et nytt navn registrerer en ny sky.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "Skyens identitet kommer fra `OPENSTACK_CLOUD_NAME`, satt på hver måling som `openstack.cloud.name`. Denne skyen er **`cloud-1`**. Rett det i `.env`, og ta det i bruk med `docker compose up -d` i `/opt/oneuptime-openstack-agent`. Et nytt navn registrerer en ny sky.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent":
    "Docker Engine 20.10 eller nyere med Docker Compose v2-tillegget, på maskinen som skal kjøre agenten",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Last ned `docker-compose.yml` og `otel-collector-config.yaml` fra denne OneUptime til en ny mappe:",
  "Create a `clouds.yaml` file next to them, with the credential from the previous step. It needs one entry per region, each named for its region, because the exporter's series do not say which region they are from:":
    "Opprett en `clouds.yaml`-fil ved siden av dem, med legitimasjonen fra forrige trinn. Den trenger én oppføring per region, hver oppkalt etter sin region, fordi exporterens serier ikke sier hvilken region de kommer fra:",
  "Create a `.env` file next to them too:":
    "Opprett også en `.env`-fil ved siden av dem:",
  "- Replace `my-openstack-cloud` with a name for this cloud, such as `prod-eu`. It is how the cloud appears in OneUptime, so keep it stable: a new name registers a new cloud.":
    "- Erstatt `my-openstack-cloud` med et navn for denne skyen, for eksempel `prod-eu`. Det er slik skyen vises i OneUptime, så hold det stabilt: et nytt navn registrerer en ny sky.",
  "- List every region in `OPENSTACK_EXPORTER_CLOUDS`, in square brackets, such as `[RegionOne,RegionTwo]`.":
    "- List opp hver region i `OPENSTACK_EXPORTER_CLOUDS`, i hakeparenteser, for eksempel `[RegionOne,RegionTwo]`.",
  "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` starts the bundled exporter, which reads the cloud with `clouds.yaml`, and the OneUptime AI agent, which reads it with the same file while OneUptime AI investigates.":
    "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` starter den medfølgende exporteren, som leser skyen med `clouds.yaml`, og OneUptimes AI-agent, som leser den med den samme filen mens OneUptime AI undersøker.",
  "Both files hold secrets, so keep them to their owner. The exporter runs as uid 65532, and must be the one account that can read `clouds.yaml`. Then start the agent:":
    "Begge filene inneholder hemmeligheter, så hold dem for eieren. Exporteren kjører som uid 65532 og må være den eneste kontoen som kan lese `clouds.yaml`. Start deretter agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Velg en inntaksnøkkel i trinn 1 for å fylle inn `<YOUR_API_KEY>`.",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Add one `clouds.yaml` entry per region, and list them all in `OPENSTACK_EXPORTER_CLOUDS`. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "En sky er én Keystone, uansett hvor mange regioner den har, og én agent leser alle. Legg til én `clouds.yaml`-oppføring per region, og list opp alle i `OPENSTACK_EXPORTER_CLOUDS`. Hver oppføring må være oppkalt etter sin region: innsamleren setter det navnet på exporterens serier som `openstack.region.name`, fordi seriene ikke sier hvilken region de kommer fra. Hver liste i OneUptime kan da filtreres etter region.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Agenten leser disse fra `.env`-filen ved siden av `docker-compose.yml`. Etter at du har endret en, tar du den i bruk med `docker compose up -d` i mappen med `docker-compose.yml`.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter, as `host:port` with no scheme: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`. The bundled exporter then never starts.":
    "Utelat `COMPOSE_PROFILES` fra `.env`, og pek agenten mot exporteren din, som `host:port` uten skjema: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`. Den medfølgende exporteren starter da aldri.",
  "Put the file next to `docker-compose.yml` as `ca.pem`, set `OPENSTACK_CA_FILE=./ca.pem` in `.env`, and add `cacert: /etc/openstack/ca.pem` to each entry of `clouds.yaml`.":
    "Legg filen ved siden av `docker-compose.yml` som `ca.pem`, sett `OPENSTACK_CA_FILE=./ca.pem` i `.env`, og legg til `cacert: /etc/openstack/ca.pem` i hver oppføring i `clouds.yaml`.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Kjør disse i agentens mappe, den med `docker-compose.yml`.",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `clouds.yaml` stay, and a change you made to either file has to be made again:":
    "**Oppgradering.** Imagene er låst i `docker-compose.yml` og konfigurasjonen er en fil ved siden av, så en pull alene flytter ikke agenten fremover. Last ned begge filene på nytt; din `.env` og `clouds.yaml` blir værende, og en endring du hadde gjort i en av de to nedlastede filene, må gjøres på nytt:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Hent deretter imagene og gjenopprett agenten, så innsamleren leser den nye konfigurasjonen:",
  "Then delete the folder with `docker-compose.yml`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "Slett deretter mappen med `docker-compose.yml`, som inneholder legitimasjonen, og selve applikasjonslegitimasjonen: `openstack application credential delete oneuptime-agent`.",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. Sjekk at agenten kjører (i agentens mappe): `docker compose ps`",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in the agent's folder): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "Agenten leser hver tjeneste for seg, så en tjeneste som feiler, koster bare sine egne tall. Se hvorfor exporteren ikke kan lese den (i agentens mappe): `docker compose logs oneuptime-openstack-exporter`. Siden **Tjenester** viser det API-et som `down`. En legitimasjon med tilgangsregler laget fra en eldre kopi av reglene gjør også dette på Swift, og på Octavia bak en sti: opprett en ny, slik **Full visning** beskriver.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "Skyens identitet kommer fra `OPENSTACK_CLOUD_NAME`, satt på hver måling som `openstack.cloud.name`. Rett det i `.env`, og ta det i bruk med `docker compose up -d` i mappen med `docker-compose.yml`. Et nytt navn registrerer en ny sky.",
  "- This installs the agent for **`cloud-1`**. Keep `OPENSTACK_CLOUD_NAME` exactly as it is, or the data registers as a new cloud.":
    "- Dette installerer agenten for **`cloud-1`**. Behold `OPENSTACK_CLOUD_NAME` nøyaktig som det er, ellers registreres dataene som en ny sky.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "Skyens identitet kommer fra `OPENSTACK_CLOUD_NAME`, satt på hver måling som `openstack.cloud.name`. Denne skyen er **`cloud-1`**. Rett det i `.env`, og ta det i bruk med `docker compose up -d` i mappen med `docker-compose.yml`. Et nytt navn registrerer en ny sky.",
  "OpenStack-Ansible keeps its services' logs in journald and runs no Prometheus of its own, so the agent is the way in, and the logs have a path of their own.":
    "OpenStack-Ansible holder tjenestenes logger i journald og kjører ingen egen Prometheus, så agenten er veien inn, og loggene har sin egen vei.",
  "**How far this guide has been tested:** Its paths and variables were read from OpenStack-Ansible's own source and docs. Its commands were then run on a real all-in-one at stable/2026.1, in LXC containers, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, the agent's exporter on the Infrastructure only credential with its policy overrides, the RabbitMQ and HAProxy settings with the agent reading each, and the logs profile on the journal. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**Hvor langt denne veiledningen er testet:** Stiene og variablene er lest fra OpenStack-Ansibles egen kildekode og dokumentasjon. Kommandoene ble deretter kjørt på en ekte all-in-one på stable/2026.1, i LXC-containere, med en stand-in for OneUptime som tok vare på det agenten sendte: agenten på legitimasjonen for Full visning, agentens exporter på legitimasjonen for Kun infrastruktur med policyoverstyringene, innstillingene for RabbitMQ og HAProxy med agenten som leste hver av dem, og loggprofilen på journalen. Agenten og en sonde har hver tatt en ekte DevStack hele veien inn i en kjørende OneUptime, gjennom en stoppet nova-compute og tilbake igjen, men ikke fra dette verktøyet.",
  "- Log in as an admin from the utility container: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, then `. ~/openrc`. It has no `curl`, which the commands below use, so run `apt-get install -y curl` there first.":
    "- Logg på som administrator fra utility-containeren: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, deretter `. ~/openrc`. Den har ikke `curl`, som kommandoene nedenfor bruker, så kjør `apt-get install -y curl` der først.",
  "- **Full view** needs one change, to Cinder. OpenStack-Ansible's roles already set `service_type` under `[keystone_authtoken]`, but its Cinder says `volumev3` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Set `service_type: block-storage` under `keystone_authtoken` in `cinder_cinder_conf_overrides` in `/etc/openstack_deploy/user_variables.yml`, then run `openstack-ansible openstack.osa.cinder --tags cinder-config`.":
    "- **Full visning** trenger én endring, i Cinder. OpenStack-Ansibles roller setter allerede `service_type` under `[keystone_authtoken]`, men dens Cinder sier `volumev3` og dens katalog sier `block-storage`, og keystonemiddleware avviser en legitimasjon begrenset av tilgangsregler med en `401` med mindre de to stemmer overens. Sett `service_type: block-storage` under `keystone_authtoken` i `cinder_cinder_conf_overrides` i `/etc/openstack_deploy/user_variables.yml`, og kjør deretter `openstack-ansible openstack.osa.cinder --tags cinder-config`.",
  "- **Infrastructure only** takes its overrides as `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` and `placement_policy_overrides` in `/etc/openstack_deploy/user_variables.yml`. Apply each with its own playbook and tag, such as `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Taking one out later leaves an empty file behind rather than none, so nothing fails.":
    "- **Kun infrastruktur** tar overstyringene sine som `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` og `placement_policy_overrides` i `/etc/openstack_deploy/user_variables.yml`. Ta hver i bruk med sin egen playbook og tag, for eksempel `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Fjerner du en senere, blir det igjen en tom fil i stedet for ingen, så ingenting feiler.",
  "- **RabbitMQ:** turn on its Prometheus plugin, then name each container's address on `15692` as `OPENSTACK_RABBITMQ_TARGETS` in the agent's `.env`:":
    "- **RabbitMQ:** slå på Prometheus-tillegget, og oppgi deretter hver containers adresse på `15692` som `OPENSTACK_RABBITMQ_TARGETS` i agentens `.env`:",
  "- **HAProxy:** its exporter is off, and its stats listener is on `127.0.0.1` with TLS, which the agent cannot read. Turn it on where the agent can, then name that address on `1936` as `OPENSTACK_HAPROXY_TARGETS`:":
    "- **HAProxy:** exporteren er slått av, og stats-lytteren ligger på `127.0.0.1` med TLS, som agenten ikke kan lese. Slå den på der agenten kan lese den, og oppgi deretter den adressen på `1936` som `OPENSTACK_HAPROXY_TARGETS`:",
  "- **MariaDB and Memcached:** OpenStack-Ansible ships no exporter for either. Run [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) and [memcached_exporter](https://github.com/prometheus/memcached_exporter) yourself and name them as `OPENSTACK_MARIADB_TARGETS` and `OPENSTACK_MEMCACHED_TARGETS`, or leave them out: the cloud's **Control Plane** card then says they are not watched, rather than that they are fine.":
    "- **MariaDB og Memcached:** OpenStack-Ansible leverer ingen exporter for noen av dem. Kjør [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) og [memcached_exporter](https://github.com/prometheus/memcached_exporter) selv og oppgi dem som `OPENSTACK_MARIADB_TARGETS` og `OPENSTACK_MEMCACHED_TARGETS`, eller utelat dem: skyens kort **Kontrollplan** sier da at de ikke overvåkes, i stedet for at de er i orden.",
  "This runs the agent's logs profile as a systemd service, and reads `/var/log/journal/`, where OpenStack-Ansible's containers' journals arrive.":
    "Dette kjører agentens loggprofil som en systemd-tjeneste, og leser `/var/log/journal/`, der journalene fra OpenStack-Ansibles containere kommer inn.",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from the journal.":
    "Hver skriver til tjenestens egen logg, uten noen forbruker på bussen. OneUptime leser dem derfra så snart **Finn sikkerhetshendelser i loggene dine** er slått på under **Sikkerhetshendelser → Tilkoblinger**. Agentens loggprofil leser begge fra journalen.",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw. A second value of `notification_opt_out` goes in as a YAML set, as [its config_template](https://docs.openstack.org/ansible-config_template/latest/) writes a repeated key.":
    "Dette sender en linje for hver pålogging, som **OpenStack admin credential used from a new address** leser. For å sende bare mislykkede pålogginger legger du `identity.authenticate.success` til `notification_opt_out`; den deteksjonen leser da det revisjonsfilteret så. En ekstra verdi i `notification_opt_out` legges inn som et YAML-sett, slik [dens config_template](https://docs.openstack.org/ansible-config_template/latest/) skriver en gjentatt nøkkel.",
  "For who did what through Nova, Neutron, Cinder and Glance, each API takes the filter's setting in its conf overrides, and the filter in its paste overrides, with `audit` right after `authtoken` and the context filter that follows it in each pipeline. Nova's, and the same in `neutron_neutron_conf_overrides` and `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` and `cinder_api_paste_ini_overrides`, and `glance_glance_api_conf_overrides` and `glance_glance_api_paste_ini_overrides`:":
    "For å se hvem som gjorde hva gjennom Nova, Neutron, Cinder og Glance, tar hvert API filterets innstilling i sine conf-overstyringer, og filteret i sine paste-overstyringer, med `audit` rett etter `authtoken` og kontekstfilteret som følger etter det i hver pipeline. Her er Novas, og det samme i `neutron_neutron_conf_overrides` og `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` og `cinder_api_paste_ini_overrides`, og `glance_glance_api_conf_overrides` og `glance_glance_api_paste_ini_overrides`:",
  "OpenStack-Helm offers charts for Prometheus, Alertmanager and exporters, and whether they are running is up to you. Its control plane runs in Kubernetes, so a probe reads the APIs and the Kubernetes agent sees the pods.":
    "OpenStack-Helm tilbyr charts for Prometheus, Alertmanager og exportere, og om de kjører, er opp til deg. Kontrollplanet kjører i Kubernetes, så en sonde leser API-ene og Kubernetes-agenten ser podene.",
  "**How far this guide has been tested:** Its chart values were read from OpenStack-Helm's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**Hvor langt denne veiledningen er testet:** Chart-verdiene er lest fra OpenStack-Helms egen kildekode. Den er ikke fulgt fra start til slutt på en ekte utrulling med dette verktøyet. Agenten og en sonde har hver tatt en ekte DevStack hele veien inn i en kjørende OneUptime, gjennom en stoppet nova-compute og tilbake igjen, men ikke fra dette verktøyet. Sonden og Kubernetes-agenten er hver testet for seg, ikke sammen på dette verktøyet.",
  "Then add the receiver under `conf.alertmanager` in the chart's values, and send your route to it:":
    "Legg deretter til mottakeren under `conf.alertmanager` i chartets verdier, og send ruten din til den:",
  "Open **OpenStack → All Clouds**, click **Connect Cloud**, and give it Keystone's address, an application credential and the probe to use. A probe only speaks HTTPS to a cloud. [OpenStack Without an Agent](/docs/telemetry/openstack-agentless) says what each level of access reads, and the connection test says what yours can. The agent also works from any machine with a route to the APIs: choose **Not sure, or something else** above for its steps.":
    "Åpne **OpenStack → Alle skyer**, klikk **Koble til sky**, og oppgi Keystones adresse, en applikasjonslegitimasjon og sonden som skal brukes. En sonde snakker bare HTTPS med en sky. [OpenStack uten agent](/docs/telemetry/openstack-agentless) sier hva hvert tilgangsnivå leser, og tilkoblingstesten sier hva ditt kan lese. Agenten virker også fra enhver maskin med en rute til API-ene: velg **Usikker, eller noe annet** ovenfor for trinnene.",
  "Follow **Kubernetes → Documentation** for this cluster. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "Følg **Kubernetes → Dokumentasjon** for denne klyngen. Podene, loggene deres og nodene deres når da Kubernetes-sidene, og OpenStack-tjenestene blant dem overvåkes der.",
  "To have those services' logs on this cloud's **Logs** page as well, each stack trace one record, name the cloud in the agent's values, with the namespaces its services run in:":
    "For også å ha de tjenestenes logger på skyens side **Logger**, hver stack trace som én post, navngir du skyen i agentens verdier, med navnerommene tjenestene kjører i:",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The Kubernetes agent reads both from the pods' logs, with the cloud named in its values.":
    "Hver skriver til tjenestens egen logg, uten noen forbruker på bussen. OneUptime leser dem derfra så snart **Finn sikkerhetshendelser i loggene dine** er slått på under **Sikkerhetshendelser → Tilkoblinger**. Kubernetes-agenten leser begge fra podenes logger, med skyen navngitt i verdiene sine.",
  "A chart's `logging.conf` keeps the root logger at `WARNING`, and the log driver writes under a logger of its own, so without one for it nothing is written. A list in values replaces the chart's, so `keys` holds what the chart's has, plus this:":
    "Et charts `logging.conf` holder rotloggeren på `WARNING`, og loggdriveren skriver under en egen logger, så uten en logger for den skrives ingenting. En liste i verdiene erstatter chartets, så `keys` inneholder det chartets har, pluss dette:",
  "For who did what through Nova, Neutron and Cinder, their charts' `conf.paste` already has the audit filter in each pipeline, and it needs telling where to write. Each needs the same logger, in `conf.logging`. Glance's chart has the map, and neither the filter nor a place for it in its pipelines: add both to its `conf.paste`.":
    "For å se hvem som gjorde hva gjennom Nova, Neutron og Cinder, har `conf.paste` i chartene deres allerede revisjonsfilteret i hver pipeline, og det må få vite hvor det skal skrive. Hver trenger den samme loggeren, i `conf.logging`. Glances chart har mappingen, men verken filteret eller en plass til det i pipelinene: legg til begge i dens `conf.paste`.",
  "Atmosphere runs kube-prometheus-stack with its own alert rules, and Loki with Vector for logs. Forward its alerts first, then a probe reads the APIs and the Kubernetes agent sees the pods.":
    "Atmosphere kjører kube-prometheus-stack med egne varslingsregler, og Loki med Vector for logger. Videresend varslene først; deretter leser en sonde API-ene og Kubernetes-agenten ser podene.",
  "**How far this guide has been tested:** Its configuration was read from Atmosphere's own docs and source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**Hvor langt denne veiledningen er testet:** Konfigurasjonen er lest fra Atmospheres egen dokumentasjon og kildekode. Den er ikke fulgt fra start til slutt på en ekte utrulling med dette verktøyet. Agenten og en sonde har hver tatt en ekte DevStack hele veien inn i en kjørende OneUptime, gjennom en stoppet nova-compute og tilbake igjen, men ikke fra dette verktøyet. Sonden og Kubernetes-agenten er hver testet for seg, ikke sammen på dette verktøyet.",
  "Then add the receiver to your Atmosphere configuration, beside whichever receivers you already have, and deploy it:":
    "Legg deretter mottakeren til i Atmosphere-konfigurasjonen din, ved siden av mottakerne du allerede har, og rull den ut:",
  "For who did what through Nova, Neutron and Cinder, the charts Atmosphere deploys already have the audit filter in each pipeline, and it needs telling where to write, in `nova_helm_values`, `neutron_helm_values` and `cinder_helm_values`. Glance's chart has neither the filter nor a place for it in its pipelines: add both to its `conf.paste`, in `glance_helm_values`.":
    "For å se hvem som gjorde hva gjennom Nova, Neutron og Cinder, har chartene Atmosphere ruller ut allerede revisjonsfilteret i hver pipeline, og det må få vite hvor det skal skrive, i `nova_helm_values`, `neutron_helm_values` og `cinder_helm_values`. Glances chart har verken filteret eller en plass til det i pipelinene: legg til begge i dens `conf.paste`, i `glance_helm_values`.",
  "Sunbeam can deploy the Canonical Observability Stack, with `sunbeam enable observability embedded`. Canonical also has an `openstack-exporter` charm, which the agent can read if you run it.":
    "Sunbeam kan rulle ut Canonical Observability Stack med `sunbeam enable observability embedded`. Canonical har også en `openstack-exporter`-charm, som agenten kan lese hvis du kjører den.",
  "**How far this guide has been tested:** Its commands were read from Canonical's docs and its charms' source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. Nothing here has been run on Sunbeam, and Sunbeam's own docs do not mention the exporter charm.":
    "**Hvor langt denne veiledningen er testet:** Kommandoene er lest fra Canonicals dokumentasjon og kildekoden til charmene. Den er ikke fulgt fra start til slutt på en ekte utrulling med dette verktøyet. Agenten og en sonde har hver tatt en ekte DevStack hele veien inn i en kjørende OneUptime, gjennom en stoppet nova-compute og tilbake igjen, men ikke fra dette verktøyet. Ingenting her er kjørt på Sunbeam, og Sunbeams egen dokumentasjon nevner ikke exporter-charmen.",
  "Then give the stack's Alertmanager a configuration with the receiver in it:":
    "Gi deretter stackens Alertmanager en konfigurasjon med mottakeren i:",
  "If you run Canonical's `openstack-exporter` charm, the agent can read it with no credential of its own. It answers one cloud on `/metrics`, on port `9180` unless you changed its `port` setting. Find its address with `juju status openstack-exporter`:":
    "Kjører du Canonicals `openstack-exporter`-charm, kan agenten lese den uten egen legitimasjon. Den svarer for én sky på `/metrics`, på port `9180` med mindre du har endret innstillingen `port`. Finn adressen med `juju status openstack-exporter`:",
  "Which series it says depends on the exporter release in its snap, which was not recorded here: `bash troubleshoot.sh` says whether it reads the cloud.":
    "Hvilke serier den gir, avhenger av exporter-utgivelsen i snapen, som ikke ble registrert her: `bash troubleshoot.sh` sier om den leser skyen.",
  "With observability on, the stack's Loki holds the services' logs. OneUptime has no way to read Loki, and the agent's logs profile has not been tried on Sunbeam's charms, so nothing here collects them yet.":
    "Med observability slått på holder stackens Loki tjenestenes logger. OneUptime har ingen måte å lese Loki på, og agentens loggprofil er ikke prøvd på Sunbeams charms, så ingenting her samler dem inn ennå.",
  "Sunbeam's charms write each service's configuration from their own templates, and its Keystone charm has no setting for where notifications go. So neither Keystone's audit trail nor the audit filter can be turned on from outside the charm, and nothing here reaches Security Events.":
    "Sunbeams charms skriver hver tjenestes konfigurasjon fra sine egne maler, og Keystone-charmen har ingen innstilling for hvor varsler sendes. Så verken Keystones revisjonsspor eller revisjonsfilteret kan slås på fra utenfor charmen, og ingenting her når Sikkerhetshendelser.",
  "Its Telemetry Operator runs Ceilometer's Prometheus exporter and a monitoring stack with Alertmanager on OpenShift. The Kubernetes agent's OpenShift preset watches the control plane, and Ceilometer's exporter says what the compute nodes are doing.":
    "Telemetry Operator kjører Ceilometers Prometheus-exporter og en overvåkingsstack med Alertmanager på OpenShift. Kubernetes-agentens OpenShift-forhåndsinnstilling overvåker kontrollplanet, og Ceilometers exporter sier hva compute-nodene gjør.",
  "**How far this guide has been tested:** Its resources were read from the Telemetry Operator's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The OpenShift preset and Ceilometer's exporter were each tested on their own, not together on this tool.":
    "**Hvor langt denne veiledningen er testet:** Ressursene er lest fra Telemetry Operators egen kildekode. Den er ikke fulgt fra start til slutt på en ekte utrulling med dette verktøyet. Agenten og en sonde har hver tatt en ekte DevStack hele veien inn i en kjørende OneUptime, gjennom en stoppet nova-compute og tilbake igjen, men ikke fra dette verktøyet. OpenShift-forhåndsinnstillingen og Ceilometers exporter er hver testet for seg, ikke sammen på dette verktøyet.",
  "Then apply a receiver the monitoring stack picks up:":
    "Ta deretter i bruk en mottaker som overvåkingsstacken plukker opp:",
  "Follow **Kubernetes → Documentation** for this cluster, with **Red Hat OpenShift** picked, which sets `preset=openshift`. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "Følg **Kubernetes → Dokumentasjon** for denne klyngen, med **Red Hat OpenShift** valgt, som setter `preset=openshift`. Podene, loggene deres og nodene deres når da Kubernetes-sidene, og OpenStack-tjenestene blant dem overvåkes der.",
  "A probe says what is allocated, not what is busy. To read real usage, run the agent on a machine that can reach the compute nodes, with `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` naming each node on Ceilometer's port, `9101`.":
    "En sonde sier hva som er tildelt, ikke hva som er opptatt. For å lese faktisk bruk kjører du agenten på en maskin som kan nå compute-nodene, med `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` som oppgir hver node på Ceilometers port, `9101`.",
  "For who did what through Nova and Neutron, each takes the filter's setting in its `customServiceConfig`, and its paste file in `defaultConfigOverwrite`. Cinder's and Glance's operators take no paste file, so nothing here reaches them.":
    "For å se hvem som gjorde hva gjennom Nova og Neutron, tar hver filterets innstilling i sin `customServiceConfig`, og paste-filen i `defaultConfigOverwrite`. Cinders og Glances operatorer tar ingen paste-fil, så ingenting her når dem.",
  "StackLight already watches OpenStack's services, MariaDB, Memcached, RabbitMQ and libvirt, with its own alert rules. Forward its alerts first, then a probe reads the APIs.":
    "StackLight overvåker allerede OpenStacks tjenester, MariaDB, Memcached, RabbitMQ og libvirt, med egne varslingsregler. Videresend varslene først; deretter leser en sonde API-ene.",
  "**How far this guide has been tested:** Its settings were read from Mirantis's docs, whose examples show other receivers rather than a webhook. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**Hvor langt denne veiledningen er testet:** Innstillingene er lest fra Mirantis' dokumentasjon, der eksemplene viser andre mottakere enn en webhook. Den er ikke fulgt fra start til slutt på en ekte utrulling med dette verktøyet. Agenten og en sonde har hver tatt en ekte DevStack hele veien inn i en kjørende OneUptime, gjennom en stoppet nova-compute og tilbake igjen, men ikke fra dette verktøyet.",
  "Then add the receiver and its route to your StackLight values:":
    "Legg deretter til mottakeren og ruten i StackLight-verdiene dine:",
  "For who did what through Nova, Neutron, Cinder and Glance, MOSK has a setting of its own, with the audit filter already in place. With the log driver, each service writes to its standard output, and the Kubernetes agent reads that from the pods' logs, with the cloud named in its values. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "For å se hvem som gjorde hva gjennom Nova, Neutron, Cinder og Glance, har MOSK sin egen innstilling, med revisjonsfilteret allerede på plass. Med loggdriveren skriver hver tjeneste til sin standard utdata, og Kubernetes-agenten leser det fra podenes logger, med skyen navngitt i verdiene sine. Hver skriver til tjenestens egen logg, uten noen forbruker på bussen. OneUptime leser dem derfra så snart **Finn sikkerhetshendelser i loggene dine** er slått på under **Sikkerhetshendelser → Tilkoblinger**.",
  "That setting does not cover Keystone. Its own audit trail takes `spec:services`, which Mirantis does not validate and takes no responsibility for, so weigh this with your support contract:":
    "Den innstillingen dekker ikke Keystone. Keystones eget revisjonsspor tar `spec:services`, som Mirantis ikke validerer og ikke tar noe ansvar for, så vei dette opp mot supportavtalen din:",
  "Keystone's audit trail says who signed in and who changed what in Keystone, and the audit filter says who did what through Nova, Neutron, Cinder and Glance. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "Keystones revisjonsspor sier hvem som logget på og hvem som endret hva i Keystone, og revisjonsfilteret sier hvem som gjorde hva gjennom Nova, Neutron, Cinder og Glance. Hver skriver til tjenestens egen logg, uten noen forbruker på bussen. OneUptime leser dem derfra så snart **Finn sikkerhetshendelser i loggene dine** er slått på under **Sikkerhetshendelser → Tilkoblinger**.",
  "The audit filter goes in each API's paste file, right after `authtoken` and the context filter that follows it in each pipeline, with the map file pyCADF ships for that service, in `etc/pycadf` under the Python environment the service runs in. Not at the end of a pipeline: Neutron's `extensions` filter answers its routers and security groups, and the filter would never see them.":
    "Revisjonsfilteret skal i hvert API sin paste-fil, rett etter `authtoken` og kontekstfilteret som følger etter det i hver pipeline, med map-filen som pyCADF leverer for den tjenesten, i `etc/pycadf` under Python-miljøet tjenesten kjører i. Ikke på slutten av en pipeline: Neutrons filter `extensions` svarer for ruterne og sikkerhetsgruppene, og revisjonsfilteret ville aldri se dem.",
  "[Who did what](/docs/telemetry/openstack#who-did-what) says what reaches Security Events, and [each tool's guide](/docs/telemetry/openstack-deployment-tools) says where these go on it.":
    "[Hvem gjorde hva](/docs/telemetry/openstack#who-did-what) sier hva som når Sikkerhetshendelser, og [veiledningen for hvert verktøy](/docs/telemetry/openstack-deployment-tools) sier hvor disse skal på det.",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | Nei | Containernavnet til innsamleren (standard: `oneuptime-openstack-agent`). Agenten for en andre sky på samme maskin trenger sine egne navn: installasjonsskriptet navngir containerne til en ny agent etter mappen dens med mindre du angir dem, og beholder dem når du kjører skriptet på nytt |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). The install script names a second cloud's bundled exporter after its collector (`oneuptime-openstack-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | Nei | Containernavnet til den medfølgende exporteren (standard: `oneuptime-openstack-exporter`). Installasjonsskriptet navngir den medfølgende exporteren for en andre sky etter innsamleren (`oneuptime-openstack-exporter-cloud2` ved siden av `oneuptime-openstack-agent-cloud2`) med mindre du angir det, og beholder det når du kjører skriptet på nytt |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). The install script names a second cloud's quota exporter after its collector (`oneuptime-openstack-quota-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | Nei | Containernavnet til kvote-exporteren (standard: `oneuptime-openstack-quota-exporter`). Installasjonsskriptet navngir kvote-exporteren for en andre sky etter innsamleren (`oneuptime-openstack-quota-exporter-cloud2` ved siden av `oneuptime-openstack-agent-cloud2`) med mindre du angir det, og beholder det når du kjører skriptet på nytt |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). The install script names a second cloud's database exporter after its collector (`oneuptime-openstack-database-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | Nei | Containernavnet til database-exporteren (standard: `oneuptime-openstack-database-exporter`). Installasjonsskriptet navngir database-exporteren for en andre sky etter innsamleren (`oneuptime-openstack-database-exporter-cloud2` ved siden av `oneuptime-openstack-agent-cloud2`) med mindre du angir det, og beholder det når du kjører skriptet på nytt |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). The install script names a second cloud's worker state exporter after its collector (`oneuptime-openstack-worker-state-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | Nei | Containernavnet til workerstatus-exporteren (standard: `oneuptime-openstack-worker-state-exporter`). Installasjonsskriptet navngir workerstatus-exporteren for en andre sky etter innsamleren (`oneuptime-openstack-worker-state-exporter-cloud2` ved siden av `oneuptime-openstack-agent-cloud2`) med mindre du angir det, og beholder det når du kjører skriptet på nytt |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). The install script names a second cloud's AI agent after its collector (`oneuptime-openstack-ai-agent-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | Nei | Containernavnet til AI-agenten (standard: `oneuptime-openstack-ai-agent`). Installasjonsskriptet navngir AI-agenten for en andre sky etter innsamleren (`oneuptime-openstack-ai-agent-cloud2` ved siden av `oneuptime-openstack-agent-cloud2`) med mindre du angir det, og beholder det når du kjører skriptet på nytt |",
  "One agent reads one cloud. For a second cloud, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Én agent leser én sky. For en andre sky installerer du en andre agent i en egen mappe, med sine egne containernavn, for to containere kan ikke dele et navn:",
  "The script names the containers after the folder, such as `oneuptime-openstack-agent-cloud2`, unless you set their variables, such as `OPENSTACK_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Skriptet navngir containerne etter mappen, for eksempel `oneuptime-openstack-agent-cloud2`, med mindre du angir variablene deres, for eksempel `OPENSTACK_AGENT_CONTAINER_NAME`. Det lagrer navnene i `.env` til den agenten, så når du kjører skriptet på nytt med samme `INSTALL_DIR` for å oppgradere agenten, beholdes navnene, og en agent der du en gang redigerte `container_name` i `docker-compose.yml`, beholder det navnet.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Gi hver mappe sitt eget navn: Docker Compose navngir et prosjekt etter mappen alene, så skriptet avviser en mappe med samme navn som en som allerede kjører en agent et annet sted. Send mappen til diagnoseskriptet med `-d`.",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | Nei | Containernavnet til innsamleren (standard: `oneuptime-openstack-agent`). Agenten for en andre sky på samme maskin trenger sitt eget |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | Nei | Containernavnet til den medfølgende exporteren (standard: `oneuptime-openstack-exporter`). Agenten for en andre sky på samme maskin trenger sitt eget |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | Nei | Containernavnet til kvote-exporteren (standard: `oneuptime-openstack-quota-exporter`). Agenten for en andre sky på samme maskin trenger sitt eget |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | Nei | Containernavnet til database-exporteren (standard: `oneuptime-openstack-database-exporter`). Agenten for en andre sky på samme maskin trenger sitt eget |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | Nei | Containernavnet til workerstatus-exporteren (standard: `oneuptime-openstack-worker-state-exporter`). Agenten for en andre sky på samme maskin trenger sitt eget |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | Nei | Containernavnet til AI-agenten (standard: `oneuptime-openstack-ai-agent`). Agenten for en andre sky på samme maskin trenger sitt eget |",
  "One agent reads one cloud. For a second cloud, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Én agent leser én sky. For en andre sky setter du opp en andre agent i en egen mappe, med sine egne containernavn, for to containere kan ikke dele et navn. Angi dem i `.env` til den agenten:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Gi hver mappe sitt eget navn: Docker Compose navngir et prosjekt etter mappen alene, så en andre mappe med samme navn ville erstattet containerne til den første agenten. Hold navnene utenfor `docker-compose.yml`, som en oppgradering erstatter.",
};

export default TRANSLATION;

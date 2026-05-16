# Provider Terraform OneUptime

Il Provider Terraform OneUptime consente di gestire le risorse OneUptime usando Infrastructure as Code (IaC). Questo provider permette di configurare monitoraggio, gestione degli incidenti, pagine di stato e altre funzionalità di OneUptime tramite Terraform.

## Sommario

- [Installazione](#installazione)
- [Configurazione Provider](#configurazione-provider)
- [Avvio Rapido](#avvio-rapido)
- [Compatibilità Versioni](#compatibilità-versioni)
- [Risorse Disponibili](#risorse-disponibili)
- [Esempi](#esempi)
- [Buone Pratiche](#buone-pratiche)
- [Guida alla Migrazione](#guida-alla-migrazione)

## Installazione

### Dal Registro Terraform (Consigliato)

Il provider Terraform OneUptime è disponibile nel [Registro Terraform](https://registry.terraform.io/providers/oneuptime/oneuptime).

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Usa la versione più recente 7.x
    }
  }
  required_version = ">= 1.0"
}
```

### Blocco della Versione per Installazioni Self-Hosted

⚠️ **Importante per i Clienti Self-Hosted**: Bloccare sempre la versione del provider Terraform per corrispondere alla versione dell'installazione OneUptime e garantire la compatibilità API.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Bloccare alla versione esatta corrispondente all'installazione OneUptime
    }
  }
  required_version = ">= 1.0"
}
```

#### Trovare la Propria Versione OneUptime

È possibile trovare la versione OneUptime in diversi modi:

1. **Dashboard**: Accedere a Impostazioni → Informazioni nel dashboard OneUptime
2. **API**: Chiamare l'endpoint `GET /api/status`
3. **Docker**: Controllare il tag dell'immagine in uso
4. **Helm**: Controllare la versione del chart Helm

```bash
# Esempio: Se si esegue OneUptime 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"
    }
  }
}
```

## Configurazione Provider

### Configurazione Base

```hcl
provider "oneuptime" {
  oneuptime_url = "https://vostra-istanza-oneuptime.com"  # O https://oneuptime.com per il cloud
  api_key       = var.oneuptime_api_key
}
```

### Variabili d'Ambiente

È possibile configurare il provider usando variabili d'ambiente:

```bash
export ONEUPTIME_URL="https://vostra-istanza-oneuptime.com"
export ONEUPTIME_API_KEY="vostra-api-key"
```

Quindi usare il provider senza configurazione esplicita:

```hcl
provider "oneuptime" {
  # La configurazione verrà letta dalle variabili d'ambiente
}
```

### Opzioni di Configurazione

| Argomento | Variabile d'Ambiente | Descrizione | Obbligatorio |
|----------|---------------------|-------------|----------|
| `oneuptime_url` | `ONEUPTIME_URL` | URL OneUptime | Sì |
| `api_key` | `ONEUPTIME_API_KEY` | Chiave API OneUptime | Sì |

## Avvio Rapido

### 1. Creare la Chiave API

Prima, creare una chiave API nel dashboard OneUptime:

1. Accedere a **Impostazioni** → **Chiavi API**
2. Fare clic su **Crea Chiave API**
3. Darle un nome descrittivo (ad es. "Automazione Terraform")
4. Selezionare i permessi appropriati
5. Copiare la chiave API generata

### 2. Configurazione Terraform Base

Creare un file `main.tf`:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Usare l'URL della propria istanza
  api_key       = var.oneuptime_api_key
}

# Nota: I progetti devono essere creati manualmente nel dashboard OneUptime
variable "project_id" {
  description = "ID progetto OneUptime"
  type        = string
}

# Creare un monitor
resource "oneuptime_monitor" "website" {
  name        = "Monitor Sito Web"
  description = "Monitor per l'uptime del sito web"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Creare un team
resource "oneuptime_team" "platform" {
  name        = "Team Platform"
  description = "Team di ingegneria della piattaforma"
}
    value = "alerts@example.com"
  }
}
```

### 3. Inizializzare e Applicare

```bash
# Inizializzare Terraform
terraform init

# Pianificare le modifiche
terraform plan

# Applicare la configurazione
terraform apply
```

## Compatibilità Versioni

### Clienti Cloud

Per i clienti OneUptime Cloud, usare la versione più recente del provider:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Usa sempre la versione compatibile più recente
    }
  }
}
```

### Clienti Self-Hosted

**Critico**: I clienti self-hosted devono bloccare la versione del provider per corrispondere alla propria installazione OneUptime:

| Versione OneUptime | Versione Provider | Configurazione |
|-------------------|------------------|---------------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| 7.2.x | 7.2.x | `version = "~> 7.2.0"` |

Esempio per OneUptime 7.0.123:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Corrispondenza esatta della versione
    }
  }
}
```

## Risorse Disponibili

Il provider Terraform OneUptime supporta le seguenti risorse:

### Risorse Core
- `oneuptime_team` - Gestire i team

### Monitoraggio
- `oneuptime_monitor` - Creare e gestire i monitor
- `oneuptime_probe` - Gestire le probe di monitoraggio

### Gestione On-Call
- `oneuptime_on_call_duty_policy` - Configurare le pianificazioni on-call

### Pagine di Stato
- `oneuptime_status_page` - Creare pagine di stato

### Catalogo Servizi
- `oneuptime_service_catalog` - Gestire le voci del catalogo dei servizi

### Catalogo Servizi
- `oneuptime_service` - Definire i servizi
- `oneuptime_service_dependency` - Mappare le dipendenze dei servizi

### Sorgenti Dati
Nota: Le sorgenti dati non sono attualmente disponibili nel provider poiché non sono definite nello schema del provider.

## Esempi

### Configurazione Monitoraggio Completa

```hcl
# Variabili
variable "oneuptime_api_key" {
  description = "Chiave API OneUptime"
  type        = string
  sensitive   = true
}

variable "project_id" {
  description = "ID progetto OneUptime (creare il progetto manualmente nel dashboard)"
  type        = string
}

variable "oneuptime_url" {
  description = "URL OneUptime"
  type        = string
  default     = "https://oneuptime.com"
}

# Configurazione provider
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.oneuptime_api_key
}

# Team
resource "oneuptime_team" "platform" {
  name        = "Team Platform"
  description = "Team di ingegneria della piattaforma"
}

# Monitor
resource "oneuptime_monitor" "api" {
  name        = "Controllo Salute API"
  description = "Monitor per l'endpoint di salute API"
  data        = jsonencode({
    url = "https://api.miacompany.com/health"
    method = "GET"
    interval = "1m"
    timeout = "30s"
  })
  }
}

resource "oneuptime_monitor" "database" {
  name       = "Connessione Database"
  project_id = oneuptime_project.production.id
  
  monitor_type = "port"
  hostname     = "db.miacompany.com"
  port         = 5432
  interval     = "2m"
  
  tags = {
    service     = "database"
    environment = "production"
    criticality = "critical"
  }
}

# Policy on-call
resource "oneuptime_on_call_policy" "platform_oncall" {
  name       = "On-Call Platform"
  project_id = oneuptime_project.production.id
  team_id    = oneuptime_team.platform.id
  
  schedules {
    name      = "Orario Lavorativo"
    timezone  = "Europe/Rome"
    
    layers {
      name = "Primario"
      users = ["user1@miacompany.com", "user2@miacompany.com"]
      rotation_type = "weekly"
      start_time = "09:00"
      end_time = "17:00"
      days = ["monday", "tuesday", "wednesday", "thursday", "friday"]
    }
  }
}

# Policy avvisi
resource "oneuptime_alert_policy" "critical_alerts" {
  name       = "Avvisi Sistema Critici"
  project_id = oneuptime_project.production.id
  
  conditions {
    monitor_id = oneuptime_monitor.api.id
    threshold  = "down"
  }
  
  conditions {
    monitor_id = oneuptime_monitor.database.id
    threshold  = "down"
  }
  
  actions {
    type = "webhook"
    url  = "https://hooks.slack.com/services/VOSTRO/SLACK/WEBHOOK"
  }
  
  actions {
    type           = "oncall_escalation"
    oncall_policy_id = oneuptime_on_call_policy.platform_oncall.id
  }
}

# Pagina di stato
resource "oneuptime_status_page" "public" {
  name       = "Stato MiaCompany"
  project_id = oneuptime_project.production.id
  
  domain = "status.miacompany.com"
  
  components {
    name       = "API"
    monitor_id = oneuptime_monitor.api.id
  }
  
  components {
    name       = "Database"
    monitor_id = oneuptime_monitor.database.id
  }
}
```

### Esempio Configurazione Self-Hosted

```hcl
# Per istanza OneUptime self-hosted versione 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Deve corrispondere esattamente alla versione OneUptime
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.miacompany.com"  # Il proprio URL self-hosted
  api_key       = var.oneuptime_api_key
}

# Il resto della configurazione...
```

## Buone Pratiche

### 1. Gestione Versioni

**Per i Clienti Cloud:**
- Usare il versioning semantico con `~>` per ricevere aggiornamenti compatibili
- Esaminare il changelog prima degli aggiornamenti di versione major

**Per i Clienti Self-Hosted:**
- Bloccare sempre alla versione esatta corrispondente all'installazione
- Aggiornare la versione del provider quando si aggiorna OneUptime
- Testare prima in un ambiente non di produzione

### 2. Gestione dello Stato

```hcl
terraform {
  backend "s3" {
    bucket = "mio-stato-terraform"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}
```

### 3. Separazione degli Ambienti

Usare workspace o file di stato separati per ambienti diversi:

```bash
# Usando i workspace
terraform workspace new production
terraform workspace new staging

# Usando directory separate
mkdir -p environments/{staging,production}
```

### 4. Gestione Variabili

```hcl
# variables.tf
variable "environment" {
  description = "Nome dell'ambiente"
  type        = string
}

variable "monitors" {
  description = "Elenco di monitor da creare"
  type = list(object({
    name = string
    url  = string
    type = string
  }))
}

# terraform.tfvars
environment = "production"
monitors = [
  {
    name = "Sito Web"
    url  = "https://example.com"
    type = "website"
  },
  {
    name = "API"
    url  = "https://api.example.com/health"
    type = "api"
  }
]
```

### 5. Denominazione delle Risorse

Usare convenzioni di denominazione coerenti:

```hcl
resource "oneuptime_monitor" "website_production" {
  name = "${var.environment}-monitor-sito-web"
  # ...
}

resource "oneuptime_alert_policy" "critical_production" {
  name = "${var.environment}-avvisi-critici"
  # ...
}
```

## Guida alla Migrazione

### Dalla Configurazione Manuale

1. **Verificare le risorse esistenti** nel dashboard OneUptime
2. **Creare la configurazione Terraform** per le risorse esistenti
3. **Importare le risorse esistenti** nello stato Terraform
4. **Validare la configurazione** corrisponde allo stato corrente
5. **Applicare le modifiche** in modo incrementale

Esempio di importazione:

```bash
# Importare un monitor esistente
terraform import oneuptime_monitor.website id-monitor

# Importare un progetto esistente
terraform import oneuptime_project.main id-progetto
```

### Aggiornamenti di Versione

Quando si aggiorna OneUptime (self-hosted):

1. **Fare il backup dello stato corrente**
2. **Verificare la compatibilità del provider**
3. **Aggiornare la versione del provider** nella configurazione
4. **Testare nell'ambiente di staging**
5. **Applicare in produzione**

```bash
# Backup dello stato
terraform state pull > backup.tfstate

# Aggiornare la versione del provider
# Modificare il blocco terraform nella configurazione

# Pianificare e applicare
terraform init -upgrade
terraform plan
terraform apply
```

## Supporto e Risorse

- **Documentazione**: [Documentazione OneUptime](https://docs.oneuptime.com)
- **Registro Terraform**: [Provider OneUptime](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **Issue GitHub**: [GitHub OneUptime](https://github.com/OneUptime/oneuptime/issues)
- **Community**: [Community OneUptime](https://community.oneuptime.com)

## Risoluzione dei Problemi

### Problemi Comuni

1. **Mancata Corrispondenza di Versione (Self-Hosted)**
   ```
   Error: API version incompatible
   ```
   **Soluzione**: Assicurarsi che la versione del provider corrisponda all'installazione OneUptime

2. **Problemi di Autenticazione**
   ```
   Error: Invalid API key
   ```
   **Soluzione**: Verificare la chiave API e i permessi

3. **Risorsa Non Trovata**
   ```
   Error: Resource not found
   ```
   **Soluzione**: Controllare gli ID delle risorse e assicurarsi che la risorsa esista

### Modalità Debug

Abilitare il logging dettagliato:

```bash
export TF_LOG=DEBUG
terraform apply
```

### Verifica Versione

Verificare la propria configurazione:

```bash
# Controllare la versione Terraform
terraform version

# Controllare la versione del provider
terraform providers

# Validare la configurazione
terraform validate
```

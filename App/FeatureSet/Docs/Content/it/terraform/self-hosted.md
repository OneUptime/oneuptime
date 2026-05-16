# Guida alla Configurazione Terraform OneUptime Self-Hosted

Questa guida è specifica per i clienti che eseguono istanze self-hosted di OneUptime. Copre la gestione delle versioni, la configurazione e le buone pratiche per l'uso del provider Terraform con la propria distribuzione OneUptime.

## Note Importanti

⚠️ **I progetti non possono essere creati tramite Terraform** - I progetti devono essere creati manualmente nel dashboard OneUptime. Usare l'ID del progetto nelle proprie configurazioni Terraform.

⚠️ **La regola più importante per i clienti self-hosted**: Bloccare sempre la versione del provider Terraform per corrispondere esattamente alla versione dell'installazione OneUptime.

## Struttura delle Risorse

Tutte le risorse Terraform OneUptime seguono una struttura semplificata:
- `name` (obbligatorio) - Nome della risorsa
- `description` (opzionale) - Descrizione della risorsa  
- `data` (opzionale) - Configurazione complessa come JSON

## Critico: Compatibilità delle Versioni

⚠️ **La regola più importante per i clienti self-hosted**: Bloccare sempre la versione del provider Terraform per corrispondere esattamente alla versione dell'installazione OneUptime.

### Perché il Blocco della Versione è Critico

- Il provider Terraform viene generato automaticamente dall'API di OneUptime
- Ogni versione di OneUptime può avere endpoint API e schemi diversi
- L'uso di una versione del provider non corrispondente può causare errori o comportamenti imprevisti
- Il blocco della versione garantisce compatibilità e comportamento prevedibile

## Trovare la Propria Versione OneUptime

### Metodo 1: Dashboard
1. Effettuare il login nel proprio dashboard OneUptime
2. Accedere a **Impostazioni** → **Informazioni**
3. Cercare il numero di versione (ad es. "7.0.123")

### Metodo 2: Endpoint API
```bash
curl https://vostra-istanza-oneuptime.com/api/status
```

### Metodo 3: Immagini Docker
Se si esegue OneUptime con Docker:
```bash
docker images | grep oneuptime
# Cercare il tag, ad es. oneuptime/dashboard:7.0.123
```

### Metodo 4: Chart Helm
Se si usa Helm:
```bash
helm list -n oneuptime
# Controllare la versione del chart
```

### Metodo 5: Variabili d'Ambiente
Controllare i propri file di configurazione per le variabili di versione:
```bash
grep -r "APP_VERSION\|IMAGE_TAG" /percorso/alla/propria/configurazione/oneuptime
```

## Template di Configurazione Provider

### Template per Versione 7.0.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Sostituire 123 con il proprio numero di build esatto
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.vostracompany.com"  # Il proprio URL self-hosted
  api_key       = var.oneuptime_api_key
}
```

### Template per Versione 7.1.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.1.45"  # Sostituire con la propria versione esatta
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.vostracompany.com"
  api_key       = var.oneuptime_api_key
}
```

## Esempio Completo di Configurazione Self-Hosted

Ecco un esempio completo per un'istanza OneUptime self-hosted:

```hcl
# versions.tf
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Deve corrispondere alla versione OneUptime
    }
  }
  required_version = ">= 1.0"
  
  # Opzionale: Usare lo stato remoto per la collaborazione del team
  backend "s3" {
    bucket = "vostro-bucket-stato-terraform"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}

# variables.tf
variable "oneuptime_url" {
  description = "URL istanza OneUptime"
  type        = string
  default     = "https://oneuptime.vostracompany.com"
}

variable "oneuptime_api_key" {
  description = "Chiave API OneUptime"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Nome dell'ambiente"
  type        = string
  default     = "production"
}

# providers.tf
provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.oneuptime_api_key
}

# variables.tf
variable "project_id" {
  description = "ID progetto OneUptime (creare manualmente nel dashboard)"
  type        = string
}

# main.tf
# Creare team
resource "oneuptime_team" "infrastructure" {
  name        = "Team Infrastruttura"
  description = "Team di infrastruttura e operazioni"
}

resource "oneuptime_team" "development" {
  name        = "Team Sviluppo"
  description = "Team di sviluppo applicazioni"  
  project_id = oneuptime_project.main.id
}

# Monitor infrastruttura
resource "oneuptime_monitor" "database" {
  name       = "${var.environment}-database"
  project_id = oneuptime_project.main.id
  
  monitor_type = "port"
  hostname     = "db.internal.vostracompany.com"
  port         = 5432
  interval     = "2m"
  timeout      = "10s"
  
  tags = {
    team        = "infrastructure"
    service     = "database"
    environment = var.environment
    criticality = "critical"
  }
}

resource "oneuptime_monitor" "application" {
  name       = "${var.environment}-application"
  project_id = oneuptime_project.main.id
  
  monitor_type = "website"
  url          = "https://app.vostracompany.com/health"
  interval     = "1m"
  timeout      = "30s"
  
  expected_status_codes = [200]
  
  tags = {
    team        = "development"
    service     = "application"
    environment = var.environment
    criticality = "high"
  }
}

# Policy on-call
resource "oneuptime_on_call_policy" "infrastructure_oncall" {
  name       = "On-Call Infrastruttura"
  project_id = oneuptime_project.main.id
  team_id    = oneuptime_team.infrastructure.id
  
  schedules {
    name     = "Infrastruttura 24x7"
    timezone = "Europe/Rome"
    
    layers {
      name          = "Primario"
      users         = ["infra1@vostracompany.com", "infra2@vostracompany.com"]
      rotation_type = "weekly"
      start_time    = "00:00"
      end_time      = "23:59"
      days          = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    }
  }
}

# Policy avvisi
resource "oneuptime_alert_policy" "critical_infrastructure" {
  name       = "Avvisi Infrastruttura Critici"
  project_id = oneuptime_project.main.id
  
  conditions {
    monitor_id = oneuptime_monitor.database.id
    threshold  = "down"
  }
  
  actions {
    type = "email"
    recipients = ["infrastruttura@vostracompany.com"]
  }
  
  actions {
    type             = "oncall_escalation"
    oncall_policy_id = oneuptime_on_call_policy.infrastructure_oncall.id
  }
}

# Pagina di stato interna
resource "oneuptime_status_page" "internal" {
  name       = "Stato Servizi Interni"
  project_id = oneuptime_project.main.id
  
  domain = "status.internal.vostracompany.com"
  
  components {
    name       = "Database"
    monitor_id = oneuptime_monitor.database.id
  }
  
  components {
    name       = "Applicazione"
    monitor_id = oneuptime_monitor.application.id
  }
}

# outputs.tf
output "project_id" {
  description = "ID Progetto"
  value       = oneuptime_project.main.id
}

output "status_page_url" {
  description = "URL pagina di stato"
  value       = "https://${oneuptime_status_page.internal.domain}"
}
```

## Configurazione Specifica per Ambiente

### Ambiente di Sviluppo

```hcl
# dev.tfvars
oneuptime_url = "https://oneuptime-dev.vostracompany.com"
environment = "development"
```

### Ambiente di Staging

```hcl
# staging.tfvars
oneuptime_url = "https://oneuptime-staging.vostracompany.com"  
environment = "staging"
```

### Ambiente di Produzione

```hcl
# prod.tfvars
oneuptime_url = "https://oneuptime.vostracompany.com"
environment = "production"
```

## Processo di Aggiornamento per Self-Hosted

Quando si aggiorna l'istanza OneUptime:

### 1. Checklist Pre-Aggiornamento

```bash
# Backup dello stato Terraform corrente
terraform state pull > backup-$(date +%Y%m%d).tfstate

# Annotare la versione OneUptime corrente
curl https://oneuptime.vostracompany.com/api/status | jq '.version'

# Annotare la versione del provider corrente
terraform providers | grep oneuptime
```

### 2. Aggiornare l'Istanza OneUptime

Seguire il proprio processo standard di aggiornamento OneUptime (Docker, Helm, ecc.)

### 3. Aggiornare il Provider Terraform

```hcl
# Aggiornare la versione nel blocco terraform
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.124"  # Nuova versione dopo l'aggiornamento
    }
  }
}
```

### 4. Testare e Applicare

```bash
# Aggiornare il provider
terraform init -upgrade

# Pianificare per vedere le modifiche
terraform plan

# Applicare se tutto sembra corretto
terraform apply
```

## Configurazione di Rete

### Regole Firewall

Assicurarsi che il proprio runner Terraform possa accedere a:
- Endpoint API OneUptime (solitamente porta 443/HTTPS)
- Qualsiasi risorsa interna monitorata

### VPN/Reti Private

Se OneUptime si trova in una rete privata:

```hcl
provider "oneuptime" {
  oneuptime_url = "https://10.0.1.100:443"  # IP interno
  api_key       = var.oneuptime_api_key
}
```

## Buone Pratiche di Sicurezza

### 1. Gestione Chiavi API

```bash
# Usare variabili d'ambiente
export ONEUPTIME_API_KEY="vostra-api-key"

# O usare un sistema di gestione dei segreti
export ONEUPTIME_API_KEY=$(vault kv get -field=api_key secret/oneuptime)
```

### 2. Chiavi API con Privilegi Minimi

Creare chiavi API con i permessi minimi richiesti:
- Gestione monitor
- Gestione policy avvisi
- Gestione team (se necessario)

### 3. Sicurezza di Rete

```hcl
# Esempio con verifica TLS
provider "oneuptime" {
  oneuptime_url = "https://oneuptime.vostracompany.com"
  api_key       = var.oneuptime_api_key
  
  # Opzioni di sicurezza aggiuntive se supportate
  verify_ssl = true
  timeout    = "30s"
}
```

## Monitorare la Propria Automazione Terraform

Creare monitor per la propria automazione Terraform:

```hcl
resource "oneuptime_monitor" "terraform_runner" {
  name       = "Salute Runner Terraform"
  project_id = oneuptime_project.main.id
  
  monitor_type = "heartbeat"
  interval     = "15m"
  
  tags = {
    automation = "terraform"
    criticality = "medium"
  }
}
```

## Risoluzione dei Problemi Self-Hosted

### Problema: Connessione Rifiutata

```
Error: connection refused
```

**Soluzioni**:
1. Controllare che l'istanza OneUptime sia in esecuzione
2. Verificare che l'URL API sia corretto
3. Controllare la connettività firewall/rete
4. Verificare che i certificati TLS siano validi

### Problema: Mancata Corrispondenza Versione API

```
Error: API version incompatible
```

**Soluzioni**:
1. Controllare la versione OneUptime: `curl https://vostra-istanza/api/status`
2. Aggiornare la versione del provider per corrispondere
3. Eseguire `terraform init -upgrade`

### Problema: Certificati Autofirmati

Se si usano certificati autofirmati:

```bash
# Saltare temporaneamente la verifica TLS (non consigliato per la produzione)
export ONEUPTIME_SKIP_TLS_VERIFY=true
```

Soluzione migliore: Aggiungere il proprio certificato CA all'archivio di attendibilità del sistema.

## Backup e Disaster Recovery

### Backup dello Stato

```bash
# Backup periodici dello stato
terraform state pull > backup-$(date +%Y%m%d-%H%M%S).tfstate

# Script di backup automatizzato
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)
terraform state pull > "backups/terraform-state-${DATE}.tfstate"
find backups/ -name "terraform-state-*.tfstate" -mtime +30 -delete
```

### Backup della Configurazione

```bash
# Backup della configurazione Terraform
tar -czf terraform-config-$(date +%Y%m%d).tar.gz *.tf *.tfvars
```

## Gestione Multi-Ambiente

### Usando i Workspace

```bash
# Creare ambienti
terraform workspace new dev
terraform workspace new staging  
terraform workspace new prod

# Passare tra gli ambienti
terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

### Usando Directory Separate

```
terraform/
├── environments/
│   ├── dev/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   ├── staging/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   └── prod/
│       ├── main.tf
│       └── terraform.tfvars
└── modules/
    └── oneuptime/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

Questo approccio fornisce un migliore isolamento e una gestione più facile della versione per ambiente.

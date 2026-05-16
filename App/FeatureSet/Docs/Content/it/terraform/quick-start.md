# Guida Rapida al Provider Terraform

Questa guida aiuterà a iniziare con il Provider Terraform OneUptime in pochi minuti.

## Prerequisiti

- Terraform >= 1.0 installato
- Account OneUptime (Cloud o Self-Hosted)
- Chiave API OneUptime

## Fase 1: Creare la Chiave API

### Per OneUptime Cloud
1. Accedere a [OneUptime Cloud](https://oneuptime.com) ed effettuare il login
2. Navigare a **Impostazioni** → **Chiavi API**
3. Fare clic su **Crea Chiave API**
4. Nominarla "Provider Terraform"
5. Selezionare i permessi richiesti
6. Copiare la chiave API generata

### Per OneUptime Self-Hosted
1. Accedere alla propria istanza OneUptime
2. Navigare a **Impostazioni** → **Chiavi API**
3. Fare clic su **Crea Chiave API**
4. Nominarla "Provider Terraform"
5. Selezionare i permessi richiesti
6. Copiare la chiave API generata

## Fase 2: Creare la Configurazione Terraform

Creare una nuova directory e un file `main.tf`:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      # Per i clienti Cloud
      version = "~> 7.0"
      
      # Per i clienti Self-Hosted - bloccare alla versione esatta
      # version = "= 7.0.123"  # Sostituire con la propria versione OneUptime
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  # Per i clienti Cloud
  oneuptime_url = "https://oneuptime.com"
  
  # Per i clienti Self-Hosted - usare l'URL della propria istanza
  # oneuptime_url = "https://oneuptime.vostracompany.com"
  
  api_key = var.oneuptime_api_key
}

variable "oneuptime_api_key" {
  description = "Chiave API OneUptime"
  type        = string
  sensitive   = true
}

# Nota: I progetti devono essere creati manualmente nel dashboard OneUptime
# Usare qui il proprio ID progetto esistente
variable "project_id" {
  description = "ID progetto OneUptime"
  type        = string
}

# Creare un semplice monitor sito web
resource "oneuptime_monitor" "website" {
  name        = "Monitor Sito Web"
  description = "Monitor per l'uptime del sito web"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Restituire l'ID del monitor
output "monitor_id" {
  value = oneuptime_monitor.website.id
}
```

## Fase 3: Creare il File Variabili

Creare `terraform.tfvars`:

```hcl
# terraform.tfvars
oneuptime_api_key = "vostra-api-key"
project_id        = "vostro-id-progetto"  # Ottenere dal dashboard OneUptime
```

**Importante**: Aggiungere `terraform.tfvars` al proprio `.gitignore` per tenere le chiavi API al sicuro!

## Fase 4: Inizializzare e Applicare

```bash
# Inizializzare Terraform
terraform init

# Pianificare la distribuzione
terraform plan

# Applicare la configurazione
terraform apply
```

## Fase 5: Verificare le Risorse

1. Controllare il dashboard OneUptime
2. Accedere al proprio progetto esistente
3. Verificare che il "Monitor Sito Web" sia creato e in esecuzione

## Prossimi Passi

1. **Esplorare Altre Risorse**: Consultare la [documentazione completa](./README.md) per tutte le risorse disponibili
2. **Configurare gli Avvisi**: Aggiungere policy avvisi e canali di notifica
3. **Creare Pagine di Stato**: Configurare pagine di stato pubbliche per i propri servizi
4. **Organizzare con i Team**: Creare team e assegnare permessi

## Esempi Specifici per Versione

### Clienti Cloud (Ultima Versione)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Ottiene sempre la versione 7.x compatibile più recente
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Clienti Self-Hosted (Versione Bloccata)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Deve corrispondere esattamente alla versione OneUptime
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.miacompany.com"  # Il proprio URL self-hosted
  api_key       = var.oneuptime_api_key
}
```

## Risoluzione Rapida dei Problemi

### Problema: Provider non trovato
```
Error: Failed to query available provider packages
```
**Soluzione**: Eseguire `terraform init` per scaricare il provider

### Problema: Autenticazione fallita
```
Error: Invalid API key
```
**Soluzione**: 
1. Verificare la chiave API nel dashboard OneUptime
2. Controllare che la chiave API abbia permessi sufficienti
3. Assicurarsi che `oneuptime_url` sia corretto per la propria istanza

### Problema: Mancata corrispondenza di versione (Self-Hosted)
```
Error: API version incompatible
```
**Soluzione**: 
1. Controllare la versione OneUptime nel dashboard
2. Aggiornare la versione del provider per corrispondere esattamente
3. Eseguire `terraform init -upgrade`

## Pulizia

Per rimuovere tutte le risorse create in questa guida rapida:

```bash
terraform destroy
```

Questo eliminerà il monitor e il progetto creati durante la guida rapida.

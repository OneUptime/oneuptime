# Terraform-Konfigurationsleitfaden für selbst gehostetes OneUptime

Dieser Leitfaden richtet sich speziell an Kunden, die selbst gehostete OneUptime-Instanzen betreiben. Er behandelt Versionsverwaltung, Konfiguration und Best Practices für die Verwendung des Terraform-Providers mit Ihrer eigenen OneUptime-Bereitstellung.

## Wichtige Hinweise

⚠️ **Projekte können nicht über Terraform erstellt werden** – Projekte müssen zuerst manuell im OneUptime-Dashboard erstellt werden. Verwenden Sie die Projekt-ID in Ihren Terraform-Konfigurationen.

⚠️ **Die wichtigste Regel für selbst gehostete Kunden**: Pinnen Sie Ihre Terraform-Provider-Version immer exakt auf Ihre OneUptime-Installationsversion.

## Kritisch: Versionskompatibilität

### Warum Versions-Pinning kritisch ist

- Der Terraform-Provider wird automatisch aus der OneUptime-API generiert
- Jede OneUptime-Version kann unterschiedliche API-Endpunkte und Schemata haben
- Die Verwendung einer nicht übereinstimmenden Provider-Version kann Fehler oder unerwartetes Verhalten verursachen
- Versions-Pinning stellt Kompatibilität und vorhersehbares Verhalten sicher

## Ihre OneUptime-Version finden

### Methode 1: Dashboard
1. Melden Sie sich bei Ihrem OneUptime-Dashboard an
2. Gehen Sie zu **Einstellungen** → **Über**
3. Notieren Sie die Versionsnummer (z. B. "7.0.123")

### Methode 2: API-Endpunkt
```bash
curl https://your-oneuptime-instance.com/api/status
```

### Methode 3: Docker-Images
```bash
docker images | grep oneuptime
# Nach dem Tag suchen, z. B. oneuptime/dashboard:7.0.123
```

### Methode 4: Helm-Chart
```bash
helm list -n oneuptime
# Chart-Version prüfen
```

## Provider-Konfigurationsvorlagen

### Vorlage für Version 7.0.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 123 durch Ihre genaue Build-Nummer ersetzen
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # Ihre selbst gehostete URL
  api_key       = var.oneuptime_api_key
}
```

## Upgrade-Prozess für selbst gehostete Instanzen

Beim Upgrade Ihrer OneUptime-Instanz:

### 1. Vor-Upgrade-Checkliste

```bash
# Aktuellen Terraform-Zustand sichern
terraform state pull > backup-$(date +%Y%m%d).tfstate

# Aktuelle OneUptime-Version notieren
curl https://oneuptime.yourcompany.com/api/status | jq '.version'

# Aktuelle Provider-Version notieren
terraform providers | grep oneuptime
```

### 2. OneUptime-Instanz upgraden

Folgen Sie Ihrem Standard-OneUptime-Upgrade-Prozess (Docker, Helm usw.)

### 3. Terraform-Provider aktualisieren

```hcl
# Version im terraform-Block aktualisieren
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.124"  # Neue Version nach dem Upgrade
    }
  }
}
```

### 4. Testen und anwenden

```bash
# Provider aktualisieren
terraform init -upgrade

# Planen, um Änderungen zu sehen
terraform plan

# Anwenden, wenn alles gut aussieht
terraform apply
```

## Sicherheits-Best-Practices

### 1. API-Schlüsselverwaltung

```bash
# Umgebungsvariablen verwenden
export ONEUPTIME_API_KEY="your-api-key"

# Oder ein Geheimnisverwaltungssystem verwenden
export ONEUPTIME_API_KEY=$(vault kv get -field=api_key secret/oneuptime)
```

### 2. Minimale Berechtigungen

Erstellen Sie API-Schlüssel mit minimal erforderlichen Berechtigungen:
- Monitor-Verwaltung
- Benachrichtigungsrichtlinien-Verwaltung
- Team-Verwaltung (falls erforderlich)

## Multi-Umgebungs-Verwaltung

### Workspaces verwenden

```bash
# Umgebungen erstellen
terraform workspace new dev
terraform workspace new staging  
terraform workspace new prod

# Zwischen Umgebungen wechseln
terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

### Separate Verzeichnisse verwenden

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

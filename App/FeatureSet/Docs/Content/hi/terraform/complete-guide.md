# OneUptime Terraform Provider

OneUptime Terraform Provider आपको Infrastructure as Code (IaC) का उपयोग करके OneUptime resources प्रबंधित करने की अनुमति देता है। यह provider आपको Terraform के माध्यम से monitoring, incident management, status pages और अन्य OneUptime features configure करने में सक्षम बनाता है।

## Installation

### Terraform Registry से (अनुशंसित)

OneUptime Terraform provider [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime) पर उपलब्ध है।

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # नवीनतम 7.x version उपयोग करें
    }
  }
  required_version = ">= 1.0"
}
```

### Self-Hosted Installations के लिए Version Pinning

⚠️ **Self-Hosted Customers के लिए महत्वपूर्ण**: API compatibility सुनिश्चित करने के लिए Terraform provider version को हमेशा अपने OneUptime installation version से match करने के लिए pin करें।

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # अपने OneUptime installation से match करने वाले exact version पर pin करें
    }
  }
  required_version = ">= 1.0"
}
```

#### अपना OneUptime Version खोजना

आप कई तरीकों से अपना OneUptime version पा सकते हैं:

1. **Dashboard**: अपने OneUptime dashboard में Settings → About पर जाएं
2. **API**: `GET /api/status` endpoint call करें
3. **Docker**: आप जो image tag उपयोग कर रहे हैं वह जांचें
4. **Helm**: अपना Helm chart version जांचें

## Provider Configuration

### Basic Configuration

```hcl
provider "oneuptime" {
  oneuptime_url = "https://your-oneuptime-instance.com"  # या cloud के लिए https://oneuptime.com
  api_key       = var.oneuptime_api_key
}
```

### Environment Variables

आप environment variables का उपयोग करके provider configure कर सकते हैं:

```bash
export ONEUPTIME_URL="https://your-oneuptime-instance.com"
export ONEUPTIME_API_KEY="your-api-key-here"
```

### Configuration Options

| Argument | Environment Variable | विवरण | आवश्यक |
|----------|---------------------|-------|--------|
| `oneuptime_url` | `ONEUPTIME_URL` | OneUptime URL | हाँ |
| `api_key` | `ONEUPTIME_API_KEY` | OneUptime API Key | हाँ |

## Quick Start

### 1. API Key बनाएं

पहले, अपने OneUptime dashboard में एक API key बनाएं:

1. **Settings** → **API Keys** पर जाएं
2. **Create API Key** पर क्लिक करें
3. इसे एक वर्णनात्मक नाम दें (जैसे "Terraform Automation")
4. उचित permissions चुनें
5. generated API key copy करें

### 2. Basic Terraform Configuration

एक `main.tf` फ़ाइल बनाएं:

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
  oneuptime_url = "https://oneuptime.com"  # अपना instance URL उपयोग करें
  api_key       = var.oneuptime_api_key
}

# नोट: Projects OneUptime dashboard में manually बनाने होंगे
variable "project_id" {
  description = "OneUptime project ID"
  type        = string
}

# एक monitor बनाएं
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "website uptime के लिए Monitor"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# एक team बनाएं
resource "oneuptime_team" "platform" {
  name        = "Platform Team"
  description = "Platform engineering team"
}
```

### 3. Initialize और Apply करें

```bash
# Terraform initialize करें
terraform init

# changes plan करें
terraform plan

# configuration apply करें
terraform apply
```

## Version Compatibility

### Cloud Customers

OneUptime Cloud customers के लिए, latest provider version उपयोग करें:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # हमेशा latest compatible version प्राप्त करें
    }
  }
}
```

### Self-Hosted Customers

**Critical**: Self-hosted customers को provider version को अपने OneUptime installation से match करने के लिए pin करना होगा।

| OneUptime Version | Provider Version | Configuration |
|-------------------|------------------|---------------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| 7.2.x | 7.2.x | `version = "~> 7.2.0"` |

## उपलब्ध Resources

OneUptime Terraform provider निम्नलिखित resources का समर्थन करता है:

### Core Resources
- `oneuptime_team` - teams प्रबंधित करें

### Monitoring
- `oneuptime_monitor` - monitors बनाएं और प्रबंधित करें
- `oneuptime_probe` - monitoring probes प्रबंधित करें

### On-Call Management
- `oneuptime_on_call_duty_policy` - on-call schedules सेट अप करें

### Status Pages
- `oneuptime_status_page` - status pages बनाएं

### Service Catalog
- `oneuptime_service_catalog` - service catalog entries प्रबंधित करें
- `oneuptime_service` - services define करें
- `oneuptime_service_dependency` - service dependencies map करें

## Best Practices

### 1. Version Management

**Cloud Customers के लिए:**
- compatible updates पाने के लिए semantic versioning `~>` उपयोग करें
- major version upgrades से पहले changelog review करें

**Self-Hosted Customers के लिए:**
- हमेशा अपने installation से match करने वाले exact version पर pin करें
- OneUptime upgrade करने पर provider version update करें
- पहले non-production environment में test करें

### 2. State Management

```hcl
terraform {
  backend "s3" {
    bucket = "my-terraform-state"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}
```

## समस्या निवारण

### सामान्य समस्याएं

1. **Version Mismatch (Self-Hosted)**
   ```
   Error: API version incompatible
   ```
   **Solution**: सुनिश्चित करें कि provider version OneUptime installation से match करती है

2. **Authentication Issues**
   ```
   Error: Invalid API key
   ```
   **Solution**: API key और permissions verify करें

3. **Resource Not Found**
   ```
   Error: Resource not found
   ```
   **Solution**: resource IDs जांचें और सुनिश्चित करें कि resource मौजूद है

### Debug Mode

Detailed logging सक्षम करें:

```bash
export TF_LOG=DEBUG
terraform apply
```

# Terraform Provider Installation और Usage Guide

## Terraform Registry से Installation

OneUptime Terraform Provider official [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime) पर उपलब्ध है।

### OneUptime Cloud Users के लिए

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # latest compatible version उपयोग करें
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Self-Hosted OneUptime Users के लिए

⚠️ **Critical**: Self-hosted customers को provider version को exactly अपने OneUptime installation से match करने के लिए pin करना होगा।

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # अपने exact OneUptime version से बदलें
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # आपका self-hosted URL
  api_key       = var.oneuptime_api_key
}
```

## Self-Hosted के लिए Version Pinning क्यों?

OneUptime Terraform provider OneUptime API specification से automatically generated है। प्रत्येक OneUptime version में हो सकते हैं:

- अलग API endpoints
- Updated resource schemas
- नई या removed features
- Changed validation rules

आपके OneUptime installation से match न करने वाले provider version का उपयोग करने पर हो सकता है:

- API compatibility errors
- Failed resource creation/updates
- Unexpected behavior
- Resource state drift

## अपना OneUptime Version खोजना

### Method 1: Dashboard

1. अपने OneUptime dashboard में login करें
2. **Settings** → **About** पर जाएं
3. version number नोट करें (जैसे "7.0.123")

### Method 2: API

```bash
curl https://your-oneuptime-instance.com/api/version | jq '.version'
```

### Method 3: Docker

```bash
docker images | grep oneuptime
# tag देखें, जैसे oneuptime/dashboard:7.0.123
```

## Provider Registry Information

- **Registry URL**: https://registry.terraform.io/providers/oneuptime/oneuptime
- **Source Repository**: https://github.com/OneUptime/terraform-provider-oneuptime
- **Documentation**: https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs
- **Releases**: https://github.com/OneUptime/terraform-provider-oneuptime/releases

## Version Compatibility Matrix

| OneUptime Version | Provider Version | Terraform Config       |
| ----------------- | ---------------- | ---------------------- |
| 7.0.x             | 7.0.x            | `version = "~> 7.0.0"` |
| 7.1.x             | 7.1.x            | `version = "~> 7.1.0"` |
| Latest Cloud      | Latest Provider  | `version = "~> 7.0"`   |

## Installation Steps

1. **अपनी Terraform configuration** provider block के साथ बनाएं
2. **Terraform Initialize करें**: `terraform init`
3. **अपनी API key सेट करें**: अपनी API key के साथ `terraform.tfvars` बनाएं
4. **अपना deployment plan करें**: `terraform plan`
5. **अपनी configuration apply करें**: `terraform apply`

## Registry Updates

Provider automatically Terraform Registry पर publish होता है जब नए OneUptime versions release होते हैं। Cloud users semantic versioning (`~> 7.0`) उपयोग करके automatically compatible updates प्राप्त कर सकते हैं, जबकि self-hosted users को exact versions पर pin करना चाहिए।

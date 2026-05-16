# Terraform Provider Quick Start Guide

यह guide आपको कुछ ही मिनटों में OneUptime Terraform Provider के साथ शुरू करने में मदद करेगी।

## पूर्व आवश्यकताएं

- Terraform >= 1.0 installed
- OneUptime account (Cloud या Self-Hosted)
- OneUptime API key

## चरण 1: API Key बनाएं

### OneUptime Cloud के लिए
1. [OneUptime Cloud](https://oneuptime.com) पर जाएं और log in करें
2. **Settings** → **API Keys** पर जाएं
3. **Create API Key** पर क्लिक करें
4. इसे "Terraform Provider" नाम दें
5. आवश्यक permissions चुनें
6. generated API key copy करें

### Self-Hosted OneUptime के लिए
1. अपने OneUptime instance access करें
2. **Settings** → **API Keys** पर जाएं
3. **Create API Key** पर क्लिक करें
4. इसे "Terraform Provider" नाम दें
5. आवश्यक permissions चुनें
6. generated API key copy करें

## चरण 2: Terraform Configuration बनाएं

एक नई directory और `main.tf` फ़ाइल बनाएं:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      # Cloud customers के लिए
      version = "~> 7.0"
      
      # Self-Hosted customers के लिए - अपने exact version पर pin करें
      # version = "= 7.0.123"  # अपने OneUptime version से बदलें
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  # Cloud customers के लिए
  oneuptime_url = "https://oneuptime.com"
  
  # Self-Hosted customers के लिए - अपना instance URL उपयोग करें
  # oneuptime_url = "https://oneuptime.yourcompany.com"
  
  api_key = var.oneuptime_api_key
}

variable "oneuptime_api_key" {
  description = "OneUptime API Key"
  type        = string
  sensitive   = true
}

# नोट: Projects OneUptime dashboard में manually बनाने होंगे
# अपना existing project ID यहाँ उपयोग करें
variable "project_id" {
  description = "OneUptime project ID"
  type        = string
}

# एक simple website monitor बनाएं
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "website uptime के लिए Monitor"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# monitor ID output करें
output "monitor_id" {
  value = oneuptime_monitor.website.id
}
```

## चरण 3: Variables फ़ाइल बनाएं

`terraform.tfvars` बनाएं:

```hcl
# terraform.tfvars
oneuptime_api_key = "your-api-key-here"
project_id        = "your-project-id-here"  # OneUptime dashboard से प्राप्त करें
```

**महत्वपूर्ण**: API keys secret रखने के लिए `terraform.tfvars` को अपनी `.gitignore` में जोड़ें!

## चरण 4: Initialize और Apply करें

```bash
# Terraform initialize करें
terraform init

# deployment plan करें
terraform plan

# configuration apply करें
terraform apply
```

## चरण 5: Resources Verify करें

1. अपना OneUptime dashboard जांचें
2. अपने existing project पर जाएं
3. सत्यापित करें कि "Website Monitor" बनाया गया है और चल रहा है

## Troubleshooting Quick Start

### समस्या: Provider नहीं मिला
```
Error: Failed to query available provider packages
```
**Solution**: Provider download करने के लिए `terraform init` चलाएं

### समस्या: Authentication failed
```
Error: Invalid API key
```
**Solution**: 
1. OneUptime dashboard में अपनी API key verify करें
2. जांचें कि API key में पर्याप्त permissions हैं
3. सुनिश्चित करें कि `oneuptime_url` आपके instance के लिए correct है

### समस्या: Version mismatch (Self-Hosted)
```
Error: API version incompatible
```
**Solution**: 
1. dashboard में अपना OneUptime version जांचें
2. provider version को exactly match करने के लिए update करें
3. `terraform init -upgrade` चलाएं

## Clean Up

इस quick start में बनाए सभी resources हटाने के लिए:

```bash
terraform destroy
```

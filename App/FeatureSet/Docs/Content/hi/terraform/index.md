# Terraform Provider Documentation

OneUptime Terraform Provider आपको Terraform के माध्यम से Infrastructure as Code (IaC) management करने की अनुमति देता है — monitoring, alerting और observability resources के लिए।

## Documentation Sections

### [Getting Started](./quick-start.md)

OneUptime Terraform Provider के साथ मिनटों में शुरू करने के लिए Quick setup guide।

### [Complete Provider Guide](./README.md)

Installation, configuration, resources और best practices को cover करने वाली व्यापक documentation।

### [Self-Hosted Configuration](./self-hosted.md)

**Self-hosted customers के लिए Critical**: Version pinning, compatibility और deployment strategies।

### [Examples](./examples.md)

सामान्य OneUptime Terraform configurations के लिए real-world examples और patterns।

## Quick Links

### OneUptime Cloud Customers के लिए

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
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Self-Hosted Customers के लिए

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # अपने OneUptime version से match होना चाहिए
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## Self-Hosted Users के लिए महत्वपूर्ण

**Version Compatibility Critical है**: Terraform provider version को हमेशा exactly अपने OneUptime installation version से match करने के लिए pin करें। Mismatched versions API compatibility issues पैदा कर सकते हैं।

## External Resources

- **Terraform Registry**: [OneUptime Provider](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub Repository**: [OneUptime Source Code](https://github.com/OneUptime/oneuptime)
- **Community Support**: [OneUptime Community](https://community.oneuptime.com)

## उपलब्ध Resources

Provider, OneUptime resource management का व्यापक समर्थन करता है:

- **Projects & Teams**: अपनी monitoring structure organize करें
- **Monitors**: Website, API, port, heartbeat और custom monitors
- **Incident Management**: Alert policies, on-call schedules, escalations
- **Status Pages**: custom branding के साथ Public और private status pages
- **Service Catalog**: Service definitions और dependency mapping
- **Workflows**: Automated response और remediation workflows

## Support

Issues, questions, या contributions के लिए:

1. **Documentation Issues**: [OneUptime repository](https://github.com/OneUptime/oneuptime/issues) में issue बनाएं
2. **Provider Bugs**: main OneUptime repository में report करें
3. **Feature Requests**: OneUptime community में discuss करें
4. **General Questions**: community forums उपयोग करें

## Next Steps

1. **New Users**: [Quick Start Guide](./quick-start.md) से शुरू करें
2. **Self-Hosted**: [Self-Hosted Configuration](./self-hosted.md) review करें
3. **Advanced Users**: complex setups के लिए [Examples](./examples.md) explore करें
4. **Full Reference**: सभी features के लिए [Complete Guide](./README.md) जांचें

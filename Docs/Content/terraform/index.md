# Terraform Provider Documentation

The OneUptime Terraform Provider enables Infrastructure as Code (IaC) management of your OneUptime monitoring, alerting, and observability resources.

## 📚 Documentation Sections

### [Getting Started](./quick-start.md)
Quick setup guide to get you started with the OneUptime Terraform Provider in minutes.

### [Complete Provider Guide](./README.md)
Comprehensive documentation covering installation, configuration, resources, and best practices.

### [Self-Hosted Configuration](./self-hosted.md)
**Critical for self-hosted customers**: Version pinning, compatibility, and deployment strategies.

### [Examples](./examples.md)
Real-world examples and patterns for common OneUptime Terraform configurations.

## 🚀 Quick Links

### For OneUptime Cloud Customers
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

### For Self-Hosted Customers
```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Must match your OneUptime version
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## ⚠️ Important for Self-Hosted Users

**Version Compatibility is Critical**: Always pin the Terraform provider version to exactly match your OneUptime installation version. Mismatched versions can cause API compatibility issues.

## 🔗 External Resources

- **Terraform Registry**: [OneUptime Provider](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub Repository**: [OneUptime Source Code](https://github.com/OneUptime/oneuptime)
- **Community Support**: [OneUptime Community](https://community.oneuptime.com)

## 📋 Available Resources

The provider supports comprehensive OneUptime resource management:

- **Projects & Teams**: Organize your monitoring structure
- **Monitors**: Website, API, port, heartbeat, and custom monitors
- **Incident Management**: Alert policies, on-call schedules, escalations
- **Status Pages**: Public and private status pages with custom branding
- **Service Catalog**: Service definitions and dependency mapping
- **Workflows**: Automated response and remediation workflows

## 🛠️ Support

For issues, questions, or contributions:

1. **Documentation Issues**: Create an issue in the [OneUptime repository](https://github.com/OneUptime/oneuptime/issues)
2. **Provider Bugs**: Report in the main OneUptime repository
3. **Feature Requests**: Discuss in the OneUptime community
4. **General Questions**: Use the community forums

## 🎯 Next Steps

1. **New Users**: Start with the [Quick Start Guide](./quick-start.md)
2. **Self-Hosted**: Review the [Self-Hosted Configuration](./self-hosted.md)
3. **Advanced Users**: Explore [Examples](./examples.md) for complex setups
4. **Full Reference**: Check the [Complete Guide](./README.md) for all features

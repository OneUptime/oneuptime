terraform {
  # 1.5.0 is the floor for Terraform. Every OpenTofu release satisfies it too:
  # OpenTofu's version series starts at 1.6.0, so `tofu` never fails this check.
  required_version = ">= 1.5.0"

  required_providers {
    oneuptime = {
      # A bare "namespace/name" address is resolved against whichever registry
      # the engine defaults to — registry.terraform.io under Terraform,
      # registry.opentofu.org under OpenTofu. The provider is published to both,
      # so this one line is all that is needed for the module to work under
      # either engine. Do not hard-code a registry hostname here.
      source  = "oneuptime/oneuptime"
      version = ">= 11.0.0"
    }
  }
}

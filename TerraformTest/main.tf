terraform {
  required_providers {
    oneuptime = {
      source = "oneuptime/oneuptime"
      version = "1.0.0"
    }
  }
}

provider "oneuptime" {
  host    = "https://local.genosyn.com"
  api_key = "d1d933e0-4bb2-11f0-8dd8-397583fee542"
}
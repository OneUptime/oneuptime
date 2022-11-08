
# What image should we pull from docker hub. This only applies when the ENVIRONMENT is production or test
APP_TAG=latest

# This supports test | production | development. 
# Development is used for local development. Test is used for insider / beta / staging builds. Production is used for production ready app. 
ENVIRONMENT=production

# IS BILLING ENABLED for this installer. 
BILLING_ENABLED=false
# Public and private key for billing provider, usually stripe. 
BILLING_PUBLIC_KEY=
BILLING_PRIVATE_KEY=


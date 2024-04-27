# This script replcaes BILLING_ENABLED in config.env to true
# This is used to enable billing for the tests

# Replace BILLING_ENABLED in config.env to true
sed -i 's/BILLING_ENABLED=false/BILLING_ENABLED=true/g' config.env
# This script replcaes BILLING_ENABLED in config.env to true
# This is used to enable billing for the tests

# Replace BILLING_ENABLED in config.env to true
sed -i 's/BILLING_ENABLED=false/BILLING_ENABLED=true/g' config.env

# Billing being on used to be the only thing switching Google Tag Manager on, so
# turning it on here reported every scripted registration as a real sign_up
# conversion in the production container - the key-events trigger matches on the
# event name with no hostname condition, and GA4 data filters are not applied
# retroactively. Turn the container off for the suite. Both workflows that force
# billing on call this script, so fixing it here covers both.
sed -i 's/^GOOGLE_TAG_MANAGER_ENABLED=.*/GOOGLE_TAG_MANAGER_ENABLED=false/g' config.env

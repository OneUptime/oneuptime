# Add these lines to: sudo crontab -e

# Run this on Reboot. 
@reboot sudo curl https://fyipe.com/chart/install.sh | sudo bash -s thirdPartyBillingEnabled

# Run this once every 24 hours. 
0 0 * * * sudo curl https://fyipe.com/chart/install.sh | sudo bash -s thirdPartyBillingEnabled

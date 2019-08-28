sudo sed -i '/accounts/c\' /etc/hosts
echo $ACCOUNTS_URL'      accounts' | sudo tee -a /etc/hosts
sudo sed -i '/dashboard/c\' /etc/hosts
echo $DASHBOARD_URL'      dashboard' | sudo tee -a /etc/hosts
sudo sed -i '/backend/c\' /etc/hosts
echo $BACKEND_URL'      backend' | sudo tee -a /etc/hosts
sudo sed -i '/home/c\' /etc/hosts
echo $HOME_URL'      home' | sudo tee -a /etc/hosts
sudo sed -i '/status-page/c\' /etc/hosts
echo $STATUSPAGE_URL'      status-page' | sudo tee -a /etc/hosts
sudo sed -i '/api-docs/c\' /etc/hosts
echo $APIDOCS_URL'      api-docs' | sudo tee -a /etc/hosts
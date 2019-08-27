sudo sed -i '/accounts/c\' /etc/hosts
echo $ACCOUNTS_URL'      accounts' | sudo tee -a /etc/hosts
sudo sed -i '/dashboard/c\' /etc/hosts
echo $DASHBOARD_URL'      dashboard' | sudo tee -a /etc/hosts
sudo sed -i '/backend/c\' /etc/hosts
echo $BACKEND_URL'      backend' | sudo tee -a /etc/hosts
sudo sed -i '/home/c\' /etc/hosts
echo $HOME_URL'      home' | sudo tee -a /etc/hosts
sudo sed -i '/statuspage/c\' /etc/hosts
echo $STATUSPAGE_URL'      statuspage' | sudo tee -a /etc/hosts
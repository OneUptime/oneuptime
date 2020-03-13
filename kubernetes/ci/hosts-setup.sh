sudo sed -i '/accounts/c\' /etc/hosts
ACCOUNTS_IP=`sudo k describe svc accounts | grep Endpoints | cut -d ":" -f 2`
echo $ACCOUNTS_IP'      accounts.app.local' | sudo tee -a /etc/hosts

sudo sed -i '/dashboard/c\' /etc/hosts
DASHBOARD_IP=`sudo k describe svc dashboard | grep Endpoints | cut -d ":" -f 2`
echo $DASHBOARD_IP'      dashboard.app.local' | sudo tee -a /etc/hosts

sudo sed -i '/backend/c\' /etc/hosts
BACKEND_IP=`sudo k describe svc backend | grep Endpoints | cut -d ":" -f 2`
echo $BACKEND_IP'      backend.app.local' | sudo tee -a /etc/hosts

sudo sed -i '/home/c\' /etc/hosts
HOME_IP=`sudo k describe svc home | grep Endpoints | cut -d ":" -f 2`
echo $HOME_IP'      home.app.local' | sudo tee -a /etc/hosts

sudo sed -i '/status-page/c\' /etc/hosts
STATUSPAGE_IP=`sudo k describe svc status-page | grep Endpoints | cut -d ":" -f 2`
echo $STATUSPAGE_IP'      status-page.app.local' | sudo tee -a /etc/hosts

sudo sed -i '/api-docs/c\' /etc/hosts
APIDOCS_IP=`sudo k describe svc api-docs | grep Endpoints | cut -d ":" -f 2`
echo $APIDOCS_IP'      api-docs.app.local' | sudo tee -a /etc/hosts

sudo sed -i '/licensing/c\' /etc/hosts
LICENSING_IP=`sudo k describe svc licensing | grep Endpoints | cut -d ":" -f 2`
echo $LICENSING_IP'      licensing.app.local' | sudo tee -a /etc/hosts
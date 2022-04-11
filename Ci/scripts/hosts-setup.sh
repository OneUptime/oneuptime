sudo sed -i '/accounts/c\' /etc/hosts
ACCOUNTS_IP=`sudo k describe svc oneuptime-accounts | grep Endpoints | cut -d ":" -f 2`
echo $ACCOUNTS_IP'      accounts.app.local' | sudo tee -a /etc/hosts

sudo sed -i '/AdminDashboard/c\' /etc/hosts
ADMIN_DASHBOARD_IP=`sudo k describe svc oneuptime-admin | grep Endpoints | cut -d ":" -f 2`
echo $ADMIN_DASHBOARD_IP'      admin.app.local' | sudo tee -a /etc/hosts

sudo sed -i '/dashboard/c\' /etc/hosts
DASHBOARD_IP=`sudo k describe svc oneuptime-dashboard | grep Endpoints | cut -d ":" -f 2`
echo $DASHBOARD_IP'      dashboard.app.local' | sudo tee -a /etc/hosts

sudo sed -i '/backend/c\' /etc/hosts
BACKEND_IP=`sudo k describe svc oneuptime-backend | grep Endpoints | cut -d ":" -f 2`
echo $BACKEND_IP'      backend.app.local' | sudo tee -a /etc/hosts

sudo sed -i '/home/c\' /etc/hosts
HOME_IP=`sudo k describe svc oneuptime-home | grep Endpoints | cut -d ":" -f 2`
echo $HOME_IP'      home.app.local' | sudo tee -a /etc/hosts

sudo sed -i '/StatusPage/c\' /etc/hosts
STATUSPAGE_IP=`sudo k describe svc oneuptime-status | grep Endpoints | cut -d ":" -f 2`
echo $STATUSPAGE_IP'      status.app.local' | sudo tee -a /etc/hosts

sudo sed -i '/ApiDocs/c\' /etc/hosts
APIDOCS_IP=`sudo k describe svc oneuptime-ApiDocs | grep Endpoints | cut -d ":" -f 2`
echo $APIDOCS_IP'      ApiDocs.app.local' | sudo tee -a /etc/hosts

sudo sed -i '/licensing/c\' /etc/hosts
LICENSING_IP=`sudo k describe svc oneuptime-licensing | grep Endpoints | cut -d ":" -f 2`
echo $LICENSING_IP'      licensing.app.local' | sudo tee -a /etc/hosts
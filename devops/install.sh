# !/bin/sh

IP_ADDRESS=1

function HELP (){
  echo ""
  echo "Fyipe DB backup command line documentation."
  echo ""
  echo "all arguments are optional and have a default value when not set"
  echo ""
  echo " -a      IP address of remote server."
  echo ""
  echo " -h       Help."
  echo ""
  exit 1
}


# PASS IN ARGUMENTS
while getopts ":a:v" opt; do
  case $opt in
    a) IP_ADDRESS="$OPTARG"
    ;;
    v) KUBECTL_VERSION="$OPTARG"
    ;;
    h) HELP
       ;;
    \?) echo "Invalid option -$OPTARG" >&2
       HELP
       echo -e "Use -h to see the help documentation."
       exit 2
    ;;
  esac
done

if [[ $IP_ADDRESS == 1 ]]
then
  HELP
else


  #Install Docker and setup registry and insecure access to it.
  if [[ ! $(which kubectl) ]]
  then
      #Install Kubectl
      echo "RUNNING COMMAND: curl -LO https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl"
      curl -LO https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl
      echo "RUNNING COMMAND: chmod +x ./kubectl"
      chmod +x ./kubectl
      echo "RUNNING COMMAND: sudo mv ./kubectl /usr/local/bin/kubectl"
      sudo mv ./kubectl /usr/local/bin/kubectl
  fi

  # STEP 2: create directories
  mkdir -p ~/.kube
  mkdir -p ~/Documents/backup

  # STEP: copy remote kube config and replace local
  scp root@${IP_ADDRESS}:$HOME/.kube/config $HOME/.kube/config
fi


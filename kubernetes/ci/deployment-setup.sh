cd ./kubernetes/credentials
openssl enc -in encrypted-credentials.enc -out encrypted-credentials.tar -d -aes256 -pbkdf2 -k $KUBE_ENC
tar -xvf encrypted-credentials.tar
cd ..
cd ..
curl -sSL https://sdk.cloud.google.com | bash > /dev/null;
source $HOME/google-cloud-sdk/path.bash.inc
$HOME/google-cloud-sdk/bin/gcloud components update kubectl
sudo docker login --username $DOCKERUSERNAME --password $DOCKERPASSWORD registry.gitlab.com
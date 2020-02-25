cd ./kubernetes/credentials
openssl enc -in encrypted-credentials.enc -out encrypted-credentials.tar -d -aes-256-cbc -k $KUBE_ENC
tar -xvf encrypted-credentials.tar
cd ..
cd ..
sudo snap install kubectl --classic
sudo docker login -u $DOCKERUSERNAME -p $PERSONAL_ACCESS_TOKEN registry.gitlab.com
# [ ! -d "$HOME/.kube" ] && sudo mkdir "$HOME/.kube"
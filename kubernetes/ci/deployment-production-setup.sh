[ ! -d "$HOME/.kube" ] && sudo mkdir "$HOME/.kube"
ls
cd kubernetes/credentials
ls
sudo mv kubernetes/credentials/encrypted-credentials/production/config $HOME/.kube/config
[ ! -d "$HOME/.kube" ] && sudo mkdir "$HOME/.kube"
ls
echo "---------------------"
sudo mv kubernetes/credentials/encrypted-credentials/production/config $HOME/.kube/config
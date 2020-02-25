[ ! -d "$HOME/.kube" ] && sudo mkdir "$HOME/.kube"
ls
sudo mv credentials/encrypted-credentials/production/config $HOME/.kube/config
sudo $HOME/google-cloud-sdk/bin/gcloud auth activate-service-account --key-file ./kubernetes/credentials/encrypted-credentials/production/fyipe-production.json
sudo $HOME/google-cloud-sdk/bin/gcloud container clusters get-credentials fyipe --zone us-central1-c --project fyipe-production
sudo $HOME/google-cloud-sdk/bin/kubectl config use-context gke_fyipe-production_us-central1-c_fyipe
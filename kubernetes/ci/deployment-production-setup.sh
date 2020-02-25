sudo $HOME/google-cloud-sdk/bin/gcloud auth activate-service-account --key-file credentials/encrypted-credentials/production/fyipe-production.json
sudo $HOME/google-cloud-sdk/bin/gcloud container clusters get-credentials fyipe-production --zone us-central1-a --project fyipe-production
sudo $HOME/google-cloud-sdk/bin/kubectl config use-context gke_fyipe-production_us-central1-a_fyipe-production

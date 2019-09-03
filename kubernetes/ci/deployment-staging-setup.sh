sudo $HOME/google-cloud-sdk/bin/gcloud auth activate-service-account --key-file ./kubernetes/credentials/encrypted-credentials/staging/fyipe-staging.json
sudo $HOME/google-cloud-sdk/bin/gcloud container clusters get-credentials fyipe-staging --zone us-central1-a --project fyipe-staging
sudo $HOME/google-cloud-sdk/bin/kubectl config use-context gke_fyipe-staging_us-central1-a_fyipe-staging
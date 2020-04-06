sudo $HOME/google-cloud-sdk/bin/gcloud auth activate-service-account --key-file ./ci/credentials/encrypted-credentials/staging/fyipe-staging.json
sudo $HOME/google-cloud-sdk/bin/gcloud container clusters get-credentials fyipe-helm --zone us-central1-c --project fyipe-staging

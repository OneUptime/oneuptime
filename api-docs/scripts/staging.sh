git clone https://github.com/fyipe/kube-credentials.git
cd kube-credentials &&  openssl enc -in encrypted-credentials-api-docs.enc -out encrypted-credentials-api-docs.tar -d -aes256 -k $KUBE_ENC
tar -xvf encrypted-credentials-api-docs.tar
cd ..
gcloud auth activate-service-account --key-file kube-credentials/encrypted-credentials/staging/fyipe-staging.json
gcloud container clusters get-credentials fyipe-staging --zone us-central1-a --project fyipe-staging
docker build -t fyipeproject/api-docs:master .
docker build -t fyipeproject/api-docs:1.0.$TRAVIS_BUILD_NUMBER .
docker login --username $DOCKERUSERNAME --password $DOCKERPASSWORD
docker push fyipeproject/api-docs:master
docker push fyipeproject/api-docs:1.0.$TRAVIS_BUILD_NUMBER
kubectl config use-context gke_fyipe-staging_us-central1-a_fyipe-staging
kubectl set image deployment/fyipe-api-docs fyipe-api-docs=fyipeproject/api-docs:1.0.$TRAVIS_BUILD_NUMBER
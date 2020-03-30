cd $1
echo "Building $1"
sudo docker build -t fyipeproject/$1:test .
echo "Pushing $1"
sudo docker push fyipeproject/$1:test
cd ..
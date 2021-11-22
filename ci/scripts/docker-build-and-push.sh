cd $1
echo "Building $1"
sudo docker build -t oneuptimeproject/$1:$2 .
echo "Pushing $1"
sudo docker push oneuptimeproject/$1:$2
cd ..
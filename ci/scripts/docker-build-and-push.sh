cd $1
echo "Building $1"
sudo docker build -t oneuptime/$1:$2 .
echo "Pushing $1"
sudo docker push oneuptime/$1:$2
cd ..
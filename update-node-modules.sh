

npm install -g npm-check-updates

# Loop through all the directories. 
for d in */ ; do
    cd $d || echo "Cannot cd into $d"
    ncu -u || echo "Cannot update $d"
    npm install || echo "Cannot npm install $d"
    cd .. || echo "Cannot cd out"
done
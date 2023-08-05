

npm install -g npm-check-updates

# Loop through all the directories. 
for d in */ ; do
    cd $d || echo "Cannot cd into $d"
    rm package-lock.json && ncu -u || echo "Cannot update $d"
    npm install || npm install --force || echo "Cannot npm install $d"
    cd .. || echo "Cannot cd out"
done
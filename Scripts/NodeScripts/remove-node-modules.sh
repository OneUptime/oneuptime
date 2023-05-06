

for d in */ ; do
    cd $d || echo "Cannot cd into $d"
    rm -rf node_modules || echo "node_modules directory not found $d"
    cd .. || echo "Cannot cd out"
done
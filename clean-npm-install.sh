
# Loop through all the directories. 
for d in */ ; do
    PACKAGE_JSON=./$d/package.json
    if test -f "$PACKAGE_JSON"; then
        cd $d
        rm package-lock.json || echo "Cant delete package lock file in $PACKAGE_JSON"
        rm -rf node_modules || echo "Cant delete node_modules file in $PACKAGE_JSON"
        npm i --force
        cd ..
    fi
done


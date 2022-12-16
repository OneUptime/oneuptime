
# Loop through all the directories. 
npm i -g madge
for d in */ ; do
    PACKAGE_JSON=./$d/package.json
    if test -f "$PACKAGE_JSON"; then
        cd $d
        npm i --force
        npm run compile || echo  "No compile script found"
        madge --circular .
        cd ..
    fi
done


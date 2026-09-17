
# Act on the repository root no matter where this is run from.
CDPATH= cd -- "$(dirname -- "$0")/../.." || exit 1
REPO_ROOT=$(pwd)

# Loop through all the directories, including the packages under packages/ and agents/.
for d in */ packages/*/ agents/*/ ; do
    PACKAGE_JSON=./$d/package.json
    if test -f "$PACKAGE_JSON"; then
        cd $d
        rm package-lock.json || echo "Cant delete package lock file in $PACKAGE_JSON"
        rm -rf node_modules || echo "Cant delete node_modules file in $PACKAGE_JSON"
        npm i --force
        cd "$REPO_ROOT"
    fi
done



# Act on the repository root no matter where this is run from.
CDPATH= cd -- "$(dirname -- "$0")/../.." || exit 1
REPO_ROOT=$(pwd)

# Loop through all the directories, including the packages under packages/ and agents/.
for d in */ packages/*/ agents/*/ ; do
    # ee/ links packages/Common and packages/App, so it is regenerated last, below.
    if [ "$d" = "ee/" ]; then
        continue
    fi
    PACKAGE_JSON=./$d/package.json
    if test -f "$PACKAGE_JSON"; then
        cd $d
        rm package-lock.json || echo "Cant delete package lock file in $PACKAGE_JSON"
        rm -rf node_modules || echo "Cant delete node_modules file in $PACKAGE_JSON"
        npm i --force
        cd "$REPO_ROOT"
    fi
done

# The Enterprise Edition, after the packages it links. --ignore-scripts stops
# npm from running the linked Common and App packages' lifecycle scripts too.
if [ -f ee/package.json ]; then
    cd ee || exit 1
    rm package-lock.json || echo "Cant delete package lock file in ee/"
    rm -rf node_modules || echo "Cant delete node_modules in ee/"
    npm install --ignore-scripts
    cd "$REPO_ROOT" || exit 1
fi


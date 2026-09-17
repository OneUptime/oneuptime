

# Act on the repository root no matter where this is run from.
CDPATH= cd -- "$(dirname -- "$0")/../.." || exit 1

for d in */ ; do
    cd $d || echo "Cannot cd into $d"
    rm -rf node_modules || echo "node_modules directory not found $d"
    npm install --force || echo "Cannot npm install $d"
    cd .. || echo "Cannot cd out"
done
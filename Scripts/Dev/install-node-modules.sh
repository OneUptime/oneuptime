

# Act on the repository root no matter where this is run from.
CDPATH= cd -- "$(dirname -- "$0")/../.." || exit 1
REPO_ROOT=$(pwd)

# Loop through all the directories, including the packages under packages/ and agents/.
for d in */ packages/*/ agents/*/ ; do
    # packages/ and agents/ only group the packages below them.
    case "$d" in
        packages/ | agents/) continue ;;
    esac
    cd $d || echo "Cannot cd into $d"
    rm -rf node_modules || echo "node_modules directory not found $d"
    npm install --force || echo "Cannot npm install $d"
    cd "$REPO_ROOT" || echo "Cannot cd out"
done
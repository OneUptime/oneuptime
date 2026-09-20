

# Act on the repository root no matter where this is run from.
CDPATH= cd -- "$(dirname -- "$0")/../.." || exit 1
REPO_ROOT=$(pwd)

npm install -g npm-check-updates

# Loop through all the directories, including the packages under packages/ and agents/.
for d in */ packages/*/ agents/*/ ; do
    # packages/ and agents/ only group the packages below them.
    # ee/ is updated last, below.
    case "$d" in
        packages/ | agents/ | ee/) continue ;;
    esac
    cd $d || echo "Cannot cd into $d"
    ncu -u || echo "Cannot update $d"
    npm install || echo "Cannot npm install $d"
    cd "$REPO_ROOT" || echo "Cannot cd out"
done

# The Enterprise Edition links packages/Common and packages/App (file:), so it
# goes after them, and --ignore-scripts stops npm from running their lifecycle
# scripts as well.
if [ -f ee/package.json ]; then
    cd ee || echo "Cannot cd into ee/"
    ncu -u || echo "Cannot update ee/"
    npm install --ignore-scripts || echo "Cannot npm install ee/"
    cd "$REPO_ROOT" || echo "Cannot cd out"
fi

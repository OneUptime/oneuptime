

# Act on the repository root no matter where this is run from.
CDPATH= cd -- "$(dirname -- "$0")/../.." || exit 1
REPO_ROOT=$(pwd)

# Loop through all the directories, including the packages under packages/ and agents/.
for d in */ packages/*/ agents/*/ ; do
    # packages/ and agents/ only group the packages below them.
    # ee/ is installed last, below.
    case "$d" in
        packages/ | agents/ | ee/) continue ;;
    esac
    cd $d || echo "Cannot cd into $d"
    rm -rf node_modules || echo "node_modules directory not found $d"
    npm install --force || echo "Cannot npm install $d"
    cd "$REPO_ROOT" || echo "Cannot cd out"
done

# The Enterprise Edition. Its package.json links packages/Common and
# packages/App (file:), so it goes after them. `npm ci` installs exactly the
# lockfile and never rewrites it, and --ignore-scripts stops npm from running
# the linked packages' lifecycle scripts as well. A checkout without ee/ (the
# Community Edition) skips this.
if [ -f ee/package.json ]; then
    cd ee || echo "Cannot cd into ee/"
    npm ci --ignore-scripts || echo "Cannot npm ci ee/"
    cd "$REPO_ROOT" || echo "Cannot cd out"
fi

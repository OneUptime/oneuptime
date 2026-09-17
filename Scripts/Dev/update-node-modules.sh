

# Act on the repository root no matter where this is run from.
CDPATH= cd -- "$(dirname -- "$0")/../.." || exit 1
REPO_ROOT=$(pwd)

npm install -g npm-check-updates

# Loop through all the directories, including the packages under packages/ and agents/.
for d in */ packages/*/ agents/*/ ; do
    # packages/ and agents/ only group the packages below them.
    case "$d" in
        packages/ | agents/) continue ;;
    esac
    cd $d || echo "Cannot cd into $d"
    ncu -u || echo "Cannot update $d"
    npm install || echo "Cannot npm install $d"
    cd "$REPO_ROOT" || echo "Cannot cd out"
done
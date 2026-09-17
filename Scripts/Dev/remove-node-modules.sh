
#!/bin/bash

# Act on the repository root no matter where this is run from.
CDPATH= cd -- "$(dirname -- "$0")/../.." || exit 1
REPO_ROOT=$(pwd)

echo "Removing node_modules directories..."

# Remove node_modules in root directory first
if [ -d "node_modules" ]; then
    echo "Removing node_modules in root directory"
    rm -rf node_modules || echo "Failed to remove node_modules in root directory"
else
    echo "No node_modules found in root directory"
fi

# Loop through all the directories, including the packages under packages/ and agents/.
for d in */ packages/*/ agents/*/ ; do
    # packages/ and agents/ only group the packages below them.
    case "$d" in
        packages/ | agents/) continue ;;
    esac
    if [ -d "$d" ]; then
        cd "$d" || { echo "Cannot cd into $d"; continue; }
        
        if [ -d "node_modules" ]; then
            echo "Removing node_modules in $d"
            rm -rf node_modules || echo "Failed to remove node_modules in $d"
        else
            echo "No node_modules found in $d"
        fi
        
        cd "$REPO_ROOT" || echo "Cannot cd out of $d"
    fi
done

echo "Finished removing node_modules directories."
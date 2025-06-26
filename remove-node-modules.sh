
#!/bin/bash

echo "Removing node_modules directories..."

# Remove node_modules in root directory first
if [ -d "node_modules" ]; then
    echo "Removing node_modules in root directory"
    rm -rf node_modules || echo "Failed to remove node_modules in root directory"
else
    echo "No node_modules found in root directory"
fi

for d in */ ; do
    if [ -d "$d" ]; then
        cd "$d" || { echo "Cannot cd into $d"; continue; }
        
        if [ -d "node_modules" ]; then
            echo "Removing node_modules in $d"
            rm -rf node_modules || echo "Failed to remove node_modules in $d"
        else
            echo "No node_modules found in $d"
        fi
        
        cd .. || echo "Cannot cd out of $d"
    fi
done

echo "Finished removing node_modules directories."
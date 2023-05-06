
#!/usr/bin/env bash

set -e

if [[ ! $(which git) ]]; then
    if [[ "$OSTYPE" != "darwin"* ]]; then
        sudo apt install -y git
    fi
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install git
    fi
fi

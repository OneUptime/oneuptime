
#!/usr/bin/env bash

set -e

if [[ ! $(which gomplate) ]]; then
    ARCHITECTURE=$(uname -m)

    if [[ $ARCHITECTURE == "aarch64" ]]; then
        ARCHITECTURE="arm64"
    fi

    if [[ $ARCHITECTURE == "x86_64" ]]; then
        ARCHITECTURE="amd64"
    fi

    echo "ARCHITECTURE:"
    echo "$(uname -s) $(uname -m)"

    sudo curl -o /usr/local/bin/gomplate -sSL https://github.com/hairyhenderson/gomplate/releases/download/v3.11.3/gomplate_$(uname -s)-$ARCHITECTURE
    sudo chmod 755 /usr/local/bin/gomplate
fi

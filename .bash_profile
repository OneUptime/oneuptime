# These are aliases that will make your life simple when you're building OneUptime

# Make directory and change directory at the same time. 
mkcdir ()
{
    mkdir -p -- "$1" &&
      cd -P -- "$1"
}

alias g="git"
alias k="kubectl"

# Docker aliases
alias d="docker"
alias dc="docker compose"
alias dcu="docker compose up"
alias dcd="docker compose down"

# Node aliases
alias n="npm"

# Rust aliases
alias c="cargo"
alias cb="cargo build"
alias cr="cargo run"

# OneUptime Specific Aliases
# --------------------------

alias nrd="npm run dev"
alias nrl="npm run logs"
alias nrb="npm run build"
alias nrfb="npm run foce-build"
alias nrps="npm run ps-dev"

# OneUptime Copilot
alias nrfbc="npm run force-build-copilot"
alias nrdc="npm run dev-copilot"
alias nrlc="npm run logs-copilot"
alias nrbc="npm run build-copilot"

# OneUptime LLM Server
alias nrfbl="npm run force-build-llm"
alias nrdl="npm run dev-llm"
alias nrll="npm run logs-llm"
alias nrbl="npm run build-llm"


# These are aliases that will make your life simple when you're building OneUptime

# Make directory and change directory at the same time. 
mkcdir ()
{
    mkdir -p -- "$1" &&
      cd -P -- "$1"
}

# Git aliases
alias g="git"
alias gs="git status"
alias ga="git add"
alias gc="git checkout"
alias gb="git branch"
alias gp="git pull"
alias gpo="git push origin"
alias gl="git log"
alias gd="git diff"
alias gm="git merge"

# Kubernetes aliases
alias k="kubectl"
alias kg="kubectl get"
alias kd="kubectl describe"
alias kc="kubectl create"
alias kdel="kubectl delete"
alias klo="kubectl logs"
alias klof="kubectl logs -f"
alias kex="kubectl exec"
alias kexi="kubectl exec -it"

# Docker aliases
alias d="docker"
alias dc="docker compose"
alias dcu="docker compose up"
alias dcd="docker compose down"

# Node aliases
alias n="npm"
alias ni="npm install"
alias nis="npm install --save"
alias nid="npm install --save-dev"
alias nr="npm run"
alias nt="npm test"
alias ns="npm start"
alias nb="npm build"

# Rust aliases
alias c="cargo"
alias cb="cargo build"
alias cr="cargo run"

# OneUptime Specific Aliases
# --------------------------

alias nrd="npm run dev"
alias nrl="npm run logs"
alias nrb="npm run build"
alias nrfb="npm run force-build"
alias nrps="npm run ps-dev"

# OneUptime LLM Server
alias nrfbl="npm run force-build-llm"
alias nrdl="npm run dev-llm"
alias nrll="npm run logs-llm"
alias nrbl="npm run build-llm"


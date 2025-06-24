#!/bin/bash

# Script to lint folders in batches to prevent memory issues
# This script dynamically detects all directories and lints them one by one

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Please run this script from the project root."
    exit 1
fi

# Parse command line arguments
FIX_MODE=false
CACHE_FLAG="--cache"
NODE_MEMORY="32768"

while [[ $# -gt 0 ]]; do
    case $1 in
        --fix)
            FIX_MODE=true
            shift
            ;;
        --no-cache)
            CACHE_FLAG=""
            shift
            ;;
        --memory)
            NODE_MEMORY="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --fix        Run eslint with --fix flag"
            echo "  --no-cache   Disable eslint cache"
            echo "  --memory     Set Node.js memory limit in MB (default: 32768)"
            echo "  --help, -h   Show this help message"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Set Node options for memory
export NODE_OPTIONS="--max-old-space-size=${NODE_MEMORY}"

# Get all directories in the current directory, excluding hidden directories and common non-code directories
print_status "Scanning for directories to lint..."

# List of directories to exclude from linting
EXCLUDE_DIRS=(
    "node_modules"
    ".git"
    ".vscode"
    "Backups"
    "Certs"
    "Data"
    "Environment"
    "public"
    "logs"
    "tmp"
    "temp"
    ".tmp"
    ".temp"
    "coverage"
    "dist"
    "build"
    "out"
    "greenlock"
)

# Function to check if directory should be excluded
should_exclude() {
    local dir="$1"
    for exclude in "${EXCLUDE_DIRS[@]}"; do
        if [[ "$dir" == "$exclude" ]]; then
            return 0  # true - should exclude
        fi
    done
    return 1  # false - should not exclude
}

# Get all directories
DIRECTORIES=()
for dir in */; do
    # Remove trailing slash
    dir_name=${dir%/}
    
    # Skip if directory should be excluded
    if should_exclude "$dir_name"; then
        print_warning "Skipping excluded directory: $dir_name"
        continue
    fi
    
    # Check if directory contains TypeScript/JavaScript files
    if find "$dir_name" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) -print -quit | grep -q .; then
        DIRECTORIES+=("$dir_name")
        print_status "Found directory with code files: $dir_name"
    else
        print_warning "Skipping directory with no code files: $dir_name"
    fi
done

# Also lint root-level files
ROOT_FILES_EXIST=false
if find . -maxdepth 1 -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) -print -quit | grep -q .; then
    ROOT_FILES_EXIST=true
    print_status "Found root-level code files to lint"
fi

if [ ${#DIRECTORIES[@]} -eq 0 ] && [ "$ROOT_FILES_EXIST" = false ]; then
    print_error "No directories with code files found to lint"
    exit 1
fi

print_status "Found ${#DIRECTORIES[@]} directories to lint"

# Prepare eslint command
ESLINT_CMD="npx eslint"
if [ "$FIX_MODE" = true ]; then
    ESLINT_CMD="$ESLINT_CMD --fix"
    print_status "Running in fix mode"
fi

if [ -n "$CACHE_FLAG" ]; then
    ESLINT_CMD="$ESLINT_CMD $CACHE_FLAG"
fi

# Track results
TOTAL_DIRS=$((${#DIRECTORIES[@]} + ($ROOT_FILES_EXIST && 1 || 0)))
SUCCESS_COUNT=0
FAILED_DIRS=()

print_status "Starting batch linting of $TOTAL_DIRS locations..."
echo "=========================================="

# Lint root-level files first if they exist
if [ "$ROOT_FILES_EXIST" = true ]; then
    print_status "Linting root-level files..."
    if eval "$ESLINT_CMD *.ts *.tsx *.js *.jsx 2>/dev/null" || true; then
        print_success "Root-level files: PASSED"
        ((SUCCESS_COUNT++))
    else
        print_error "Root-level files: FAILED"
        FAILED_DIRS+=("root-level-files")
    fi
    echo "------------------------------------------"
fi

# Lint each directory
for dir in "${DIRECTORIES[@]}"; do
    print_status "Linting directory: $dir"
    
    # Run eslint on the directory
    if eval "$ESLINT_CMD \"$dir\""; then
        print_success "$dir: PASSED"
        ((SUCCESS_COUNT++))
    else
        print_error "$dir: FAILED"
        FAILED_DIRS+=("$dir")
    fi
    
    echo "------------------------------------------"
done

# Print summary
echo "=========================================="
print_status "LINTING SUMMARY"
echo "=========================================="
print_status "Total locations processed: $TOTAL_DIRS"
print_success "Successful: $SUCCESS_COUNT"

if [ ${#FAILED_DIRS[@]} -gt 0 ]; then
    print_error "Failed: ${#FAILED_DIRS[@]}"
    print_error "Failed locations:"
    for failed_dir in "${FAILED_DIRS[@]}"; do
        echo "  - $failed_dir"
    done
    echo "=========================================="
    exit 1
else
    print_success "All locations passed linting!"
    echo "=========================================="
    exit 0
fi

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
CACHE_FLAG=""  
NODE_MEMORY="8192"  
ESLINT_FORMAT="compact"  
MAX_FILES_PER_BATCH="50"  
TIMEOUT="600"  # 10 minute timeout per directory

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
        --cache)
            CACHE_FLAG="--cache"
            shift
            ;;
        --memory)
            NODE_MEMORY="$2"
            shift 2
            ;;
        --format)
            ESLINT_FORMAT="$2"
            shift 2
            ;;
        --tap)
            ESLINT_FORMAT="tap"
            shift
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --max-files)
            MAX_FILES_PER_BATCH="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --fix        Run eslint with --fix flag"
            echo "  --cache      Enable eslint cache (disabled by default to save memory)"
            echo "  --no-cache   Disable eslint cache (default)"
            echo "  --memory     Set Node.js memory limit in MB (default: 8192)"
            echo "  --timeout    Timeout per directory in seconds (default: 600)"
            echo "  --max-files  Maximum files to process per batch (default: 50)"
            echo "  --format     Set ESLint format (default: compact, options: compact, stylish, unix, visualstudio, checkstyle, html, jslint-xml, json, json-with-metadata, junit, tap)"
            echo "  --tap        Use TAP format for better progress reporting"
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

# Set Node options for memory - very aggressive memory management
export NODE_OPTIONS="--max-old-space-size=${NODE_MEMORY} --optimize-for-size --gc-interval=100 --gc-global"

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
    
    # Check if directory contains TypeScript files (JS files are ignored by ESLint config)
    if find "$dir_name" -type f \( -name "*.ts" -o -name "*.tsx" \) -print -quit | grep -q .; then
        DIRECTORIES+=("$dir_name")
        print_status "Found directory with TypeScript files: $dir_name"
    else
        print_warning "Skipping directory with no TypeScript files: $dir_name"
    fi
done

# Also lint root-level files (only TypeScript since JS is ignored)
ROOT_FILES_EXIST=false
# Temporarily disable root-level file processing due to hanging issues
# if find . -maxdepth 1 -type f \( -name "*.ts" -o -name "*.tsx" \) -print -quit | grep -q .; then
#     ROOT_FILES_EXIST=true
#     print_status "Found root-level TypeScript files to lint"
# fi

if [ ${#DIRECTORIES[@]} -eq 0 ] && [ "$ROOT_FILES_EXIST" = false ]; then
    print_error "No directories with TypeScript files found to lint"
    exit 1
fi

print_status "Found ${#DIRECTORIES[@]} directories to lint"

# Prepare eslint command with progress reporting
ESLINT_CMD="npx eslint --format=$ESLINT_FORMAT"
if [ "$FIX_MODE" = true ]; then
    ESLINT_CMD="$ESLINT_CMD --fix"
    print_status "Running in fix mode with $ESLINT_FORMAT format"
fi

if [ -n "$CACHE_FLAG" ]; then
    ESLINT_CMD="$ESLINT_CMD $CACHE_FLAG"
fi

# Track results
TOTAL_DIRS=$((${#DIRECTORIES[@]} + ($ROOT_FILES_EXIST && 1 || 0)))
SUCCESS_COUNT=0
FAILED_DIRS=()
START_TIME=$(date +%s)

print_status "Starting batch linting of $TOTAL_DIRS locations..."
echo "=========================================="

# Lint root-level files first if they exist
if [ "$ROOT_FILES_EXIST" = true ]; then
    print_status "Progress: [1/$TOTAL_DIRS] Processing root-level files..."
    
    # Show a spinner while processing root files
    (
        spin_chars="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
        i=0
        while kill -0 $$ 2>/dev/null; do
            echo -ne "\r  ${spin_chars:$i:1} Processing root files..."
            i=$(( (i + 1) % ${#spin_chars} ))
            sleep 0.1
        done
    ) &
    SPINNER_PID=$!
    
    # Run eslint on root files with timeout
    ESLINT_OUTPUT=$(timeout $TIMEOUT eval "$ESLINT_CMD *.ts *.tsx 2>/dev/null" 2>&1)
    ESLINT_EXIT_CODE=$?
    
    # Stop spinner
    kill $SPINNER_PID 2>/dev/null || true
    wait $SPINNER_PID 2>/dev/null || true
    echo -ne "\r  ✓ Completed processing\n"
    
    if [ $ESLINT_EXIT_CODE -eq 124 ]; then
        print_error "Root-level files: TIMEOUT (exceeded ${TIMEOUT}s)"
        FAILED_DIRS+=("root-level-files")
    elif [ $ESLINT_EXIT_CODE -eq 0 ]; then
        print_success "Root-level files: PASSED"
        ((SUCCESS_COUNT++))
    else
        print_error "Root-level files: FAILED"
        FAILED_DIRS+=("root-level-files")
        echo "$ESLINT_OUTPUT"
    fi
    echo "------------------------------------------"
fi

# Lint each directory
CURRENT_DIR=1
if [ "$ROOT_FILES_EXIST" = true ]; then
    CURRENT_DIR=2
fi

# Function to process a directory in file batches
process_directory_in_batches() {
    local dir="$1"
    local dir_start_time=$(date +%s)
    
    # Get all TypeScript files in the directory
    local files=()
    while IFS= read -r -d '' file; do
        files+=("$file")
    done < <(find "$dir" -type f \( -name "*.ts" -o -name "*.tsx" \) -print0)
    
    local total_files=${#files[@]}
    local batches=$(( (total_files + MAX_FILES_PER_BATCH - 1) / MAX_FILES_PER_BATCH ))
    
    if [ $total_files -eq 0 ]; then
        print_warning "$dir: SKIPPED (no TypeScript files found)"
        return 0
    fi
    
    if [ $batches -eq 1 ]; then
        # Small directory, process normally
        print_status "Processing $dir ($total_files files)"
        
        # Show a simple spinner while processing
        (
            spin_chars="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
            i=0
            while kill -0 $$ 2>/dev/null; do
                echo -ne "\r  ${spin_chars:$i:1} Processing $total_files files..."
                i=$(( (i + 1) % ${#spin_chars} ))
                sleep 0.1
            done
        ) &
        SPINNER_PID=$!
        
        local output=$(timeout $TIMEOUT eval "$ESLINT_CMD \"$dir\"" 2>&1)
        local exit_code=$?
        
        # Stop spinner
        kill $SPINNER_PID 2>/dev/null || true
        wait $SPINNER_PID 2>/dev/null || true
        echo -ne "\r  ✓ Completed processing\n"
        
        local dir_end_time=$(date +%s)
        local dir_duration=$((dir_end_time - dir_start_time))
        
        if [ $exit_code -eq 124 ]; then
            print_error "$dir: TIMEOUT (exceeded ${TIMEOUT}s) [${dir_duration}s]"
            return 1
        elif echo "$output" | grep -q "all of the files matching the glob pattern.*are ignored"; then
            print_warning "$dir: SKIPPED (all files ignored) [${dir_duration}s]"
            return 0
        elif [ $exit_code -eq 0 ]; then
            print_success "$dir: PASSED [${dir_duration}s]"
            return 0
        else
            if echo "$output" | grep -q "JavaScript heap out of memory"; then
                print_error "$dir: FAILED (Out of memory) [${dir_duration}s]"
            else
                print_error "$dir: FAILED [${dir_duration}s]"
            fi
            echo "$output"
            return 1
        fi
    else
        # Large directory, process in batches
        print_status "Processing $dir in $batches batches ($total_files files total)"
        local batch_num=1
        local failed=0
        
        for ((i=0; i<total_files; i+=MAX_FILES_PER_BATCH)); do
            local batch_files=("${files[@]:i:MAX_FILES_PER_BATCH}")
            local batch_size=${#batch_files[@]}
            
            print_status "  Batch $batch_num/$batches: Processing $batch_size files"
            
            # Show progress with dots for each file processed
            (
                for file in "${batch_files[@]}"; do
                    echo -n "."
                    sleep 0.1
                done
                echo
            ) &
            PROGRESS_PID=$!
            
            # Create a temporary file list
            local temp_file=$(mktemp)
            printf '%s\n' "${batch_files[@]}" > "$temp_file"
            
            local output=$(timeout $TIMEOUT xargs -a "$temp_file" eval "$ESLINT_CMD" 2>&1)
            local exit_code=$?
            
            # Stop progress indicator
            kill $PROGRESS_PID 2>/dev/null || true
            wait $PROGRESS_PID 2>/dev/null || true
            
            rm -f "$temp_file"
            
            if [ $exit_code -eq 124 ]; then
                print_error "  Batch $batch_num: TIMEOUT (exceeded ${TIMEOUT}s)"
                failed=1
            elif [ $exit_code -ne 0 ]; then
                if echo "$output" | grep -q "JavaScript heap out of memory"; then
                    print_error "  Batch $batch_num: FAILED (Out of memory)"
                else
                    print_error "  Batch $batch_num: FAILED"
                fi
                echo "$output"
                failed=1
            else
                print_success "  Batch $batch_num: PASSED"
            fi
            
            ((batch_num++))
        done
        
        local dir_end_time=$(date +%s)
        local dir_duration=$((dir_end_time - dir_start_time))
        
        if [ $failed -eq 0 ]; then
            print_success "$dir: ALL BATCHES PASSED [${dir_duration}s]"
            return 0
        else
            print_error "$dir: SOME BATCHES FAILED [${dir_duration}s]"
            return 1
        fi
    fi
}

for dir in "${DIRECTORIES[@]}"; do
    print_status "Progress: [$CURRENT_DIR/$TOTAL_DIRS] Linting directory: $dir"
    
    # Process directory using the batching function
    if process_directory_in_batches "$dir"; then
        ((SUCCESS_COUNT++))
    else
        FAILED_DIRS+=("$dir")
    fi
    
    ((CURRENT_DIR++))
    
    # Calculate estimated time remaining
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    if [ $CURRENT_DIR -gt 1 ]; then
        AVG_TIME_PER_DIR=$((ELAPSED / (CURRENT_DIR - 1)))
        REMAINING_DIRS=$((TOTAL_DIRS - CURRENT_DIR + 1))
        ETA_SECONDS=$((AVG_TIME_PER_DIR * REMAINING_DIRS))
        ETA_MINUTES=$((ETA_SECONDS / 60))
        print_status "Estimated time remaining: ${ETA_MINUTES}m $((ETA_SECONDS % 60))s"
    fi
    
    echo "------------------------------------------"
done

# Print summary
echo "=========================================="
print_status "LINTING SUMMARY"
echo "=========================================="
END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))
TOTAL_MINUTES=$((TOTAL_DURATION / 60))
TOTAL_SECONDS=$((TOTAL_DURATION % 60))

print_status "Total locations processed: $TOTAL_DIRS"
print_status "Total time: ${TOTAL_MINUTES}m ${TOTAL_SECONDS}s"
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

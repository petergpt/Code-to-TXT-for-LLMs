
#!/bin/bash

# Get current timestamp for the output file
timestamp=$(date '+%Y%m%dT%H%M%S')
output_file="collected_code_${timestamp}.txt"

# Function to append a file with header
append_file() {
  echo -e "\n\nFile: $1\n========================================" >> "$output_file"
  if [ -f "$1" ]; then
    cat "$1" >> "$output_file"
  else
    echo "File not found" >> "$output_file"
  fi
}

# Clear or create the output file
> "$output_file"

# List of key files to include
declare -a key_files=(
  "src/tool/main.tsx"
  "src/rules.ts"
  "src/tool/index.html"
  "vite.config.ts"
  "extension.json"
)

# Process each key file
for file in "${key_files[@]}"; do
  if [ -f "$file" ]; then
    append_file "$file"
    echo "Added $file to collection"
  else
    echo "Warning: File $file not found"
  fi
done

echo "Code collection complete. Output saved to: $output_file"

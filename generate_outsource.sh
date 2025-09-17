#!/bin/bash

process_directory() {
    local dir=$1
    local base_name=$(basename "$dir")
    local output_file="outsource/${base_name}.txt"

    echo "==== DIRECTORY: $dir ====" > "$output_file"
    echo "" >> "$output_file"

    local total_chars=0
    local total_tokens=0
    local file_count=0

    while IFS= read -r file; do
        if [[ -f "$file" ]]; then
            ((file_count++))
            local loc=$(wc -l < "$file")
            local chars=$(wc -c < "$file")
            ((total_chars += chars))

            echo "==== FILE: $file (LOC $loc) ====" >> "$output_file"
            cat "$file" >> "$output_file"
            echo "" >> "$output_file"
            echo "==== END ====" >> "$output_file"
            echo "" >> "$output_file"
        fi
    done < <(find "$dir" -type f -name "*.ts" -o -name "*.js" -o -name "*.json" | sort)

    # Rough token estimate (1 token ≈ 4 chars for code)
    total_tokens=$((total_chars / 4))

    echo "==== SUMMARY ====" >> "$output_file"
    echo "Files: $file_count" >> "$output_file"
    echo "Total characters: $total_chars" >> "$output_file"
    echo "Estimated tokens: $total_tokens" >> "$output_file"
    echo "==== END ====" >> "$output_file"

    echo "Generated $output_file (${file_count} files, ~${total_tokens} tokens)"
}

# Process each subdirectory
for dir in src/collectors src/detectors src/engine src/errors src/schemas src/scoped src/utils; do
    if [[ -d "$dir" ]]; then
        process_directory "$dir"
    fi
done

# Process root src files separately
output_file="outsource/root.txt"
echo "==== DIRECTORY: src (root files only) ====" > "$output_file"
echo "" >> "$output_file"

total_chars=0
total_tokens=0
file_count=0

for file in src/*.ts src/*.js src/*.json; do
    if [[ -f "$file" ]]; then
        ((file_count++))
        loc=$(wc -l < "$file")
        chars=$(wc -c < "$file")
        ((total_chars += chars))

        echo "==== FILE: $file (LOC $loc) ====" >> "$output_file"
        cat "$file" >> "$output_file"
        echo "" >> "$output_file"
        echo "==== END ====" >> "$output_file"
        echo "" >> "$output_file"
    fi
done

total_tokens=$((total_chars / 4))

echo "==== SUMMARY ====" >> "$output_file"
echo "Files: $file_count" >> "$output_file"
echo "Total characters: $total_chars" >> "$output_file"
echo "Estimated tokens: $total_tokens" >> "$output_file"
echo "==== END ====" >> "$output_file"

echo "Generated $output_file (${file_count} files, ~${total_tokens} tokens)"

# Create master summary
echo "All outsource files generated. Creating summary..."
total_all_tokens=0
for file in outsource/*.txt; do
    if grep -q "Estimated tokens:" "$file"; then
        tokens=$(grep "Estimated tokens:" "$file" | tail -1 | awk '{print $3}')
        ((total_all_tokens += tokens))
    fi
done

echo ""
echo "==== TOTAL SUMMARY ===="
echo "Total estimated tokens across all files: $total_all_tokens"
echo "Files generated in outsource/:"
ls -lh outsource/*.txt | awk '{print "  " $9 " (" $5 ")"}'
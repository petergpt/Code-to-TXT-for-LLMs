// src/rules.ts

// Directories to ignore
const IGNORED_DIRS = [
  "node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".next"
];

// Allowed file extensions
const ALLOWED_EXTENSIONS = [
  ".js", ".jsx", ".ts", ".tsx", ".py", ".json", ".html", ".css"
];

/**
 * Returns true if the file should be included.
 */
export function shouldIncludeFile(path: string): boolean {
  // Skip if path contains any ignored directory
  for (const dir of IGNORED_DIRS) {
    if (path.includes(`${dir}/`)) {
      return false;
    }
  }

  // Include only if extension is in ALLOWED_EXTENSIONS
  return ALLOWED_EXTENSIONS.some(ext => path.endsWith(ext));
}

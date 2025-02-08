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
  for (const dir of IGNORED_DIRS) {
    if (path.includes(`${dir}/`)) {
      return false;
    }
  }
  return ALLOWED_EXTENSIONS.some(ext => path.endsWith(ext));
}

// src/rules.ts

// By default, we auto-select these file extensions.
const AUTO_SELECT_EXTS = [
  ".js", ".jsx", ".ts", ".tsx", ".py", ".json", ".html", ".css"
];

/**
 * Returns true if path is a string and ends with one of the “code” extensions
 * we want to auto-select by default, except we explicitly exclude "package-lock.json."
 */
export function shouldIncludeFile(path: unknown): boolean {
  if (typeof path !== "string") return false;

  // Explicitly exclude package-lock.json
  if (path.endsWith("package-lock.json")) {
    return false;
  }

  // Otherwise, if it ends with one of our known code/file extensions, include it
  for (const ext of AUTO_SELECT_EXTS) {
    if (path.endsWith(ext)) return true;
  }
  return false;
}

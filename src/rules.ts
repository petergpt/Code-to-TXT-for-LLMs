// src/rules.ts

// By default, we auto-select these file extensions.
const AUTO_SELECT_EXTS = [
  ".js", ".jsx", ".ts", ".tsx", ".py", ".json", ".html", ".css"
];

/**
 * Returns true if path is a string and ends with one of the “code” extensions
 * we want to auto-select by default.
 */
export function shouldIncludeFile(path: unknown): boolean {
  if (typeof path !== "string") return false;
  for (const ext of AUTO_SELECT_EXTS) {
    if (path.endsWith(ext)) return true;
  }
  return false;
}

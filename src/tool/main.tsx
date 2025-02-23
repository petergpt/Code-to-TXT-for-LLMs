// src/tool/main.tsx

import * as React from "react";
import { createRoot } from "react-dom/client";
import { HandshakeProvider, useReplit } from "@replit/extensions-react";
import { shouldIncludeFile } from "../rules";

////////////////////////////////////////////////////////////////////////////////
// CONFIG
////////////////////////////////////////////////////////////////////////////////

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  ".venv",
  "venv",
  "dist",
  "build",
  ".pythonlibs",
  "lib64"
]);

const SKIP_FILE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp",
  ".pdf", ".mp4", ".mp3", ".zip"
]);

const MAX_CONCURRENT_READS = 10;
const MAX_BASE64_BYTES = 2_000_000; // ~2MB in base64 form

////////////////////////////////////////////////////////////////////////////////

interface TreeNode {
  name: string;       // e.g. "src" or "main.tsx"
  path: string;       // e.g. "src/main.tsx"
  isDir: boolean;
  lineCount?: number; // only for files
  children?: TreeNode[];
}

interface FileInfo {
  path: string;
  lineCount: number;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return <div>Something went wrong. Please refresh the page.</div>;
    }
    return this.props.children;
  }
}

function App() {
  const [rootTree, setRootTree] = React.useState<TreeNode[]>([]);
  const [selectedMap, setSelectedMap] = React.useState<Record<string, boolean>>({});
  const [logs, setLogs] = React.useState<string[]>([]);
  const [scanning, setScanning] = React.useState(false);
  const [hasScanned, setHasScanned] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);

  const { replit, status } = useReplit();
  const visitedDirs = React.useRef<Set<string>>(new Set());
  const treeContainerRef = React.useRef<HTMLDivElement>(null);

  /** Append a line to logs. */
  function appendLog(msg: string) {
    setLogs((prev) => [...prev, msg]);
  }

  //
  // PRESERVE SCROLL
  //
  function preserveScroll(action: () => void) {
    const container = treeContainerRef.current;
    const oldScroll = container ? container.scrollTop : 0;
    action();
    requestAnimationFrame(() => {
      if (container) {
        container.scrollTop = oldScroll;
      }
    });
  }

  //
  // SCAN LOGIC
  //
  function shouldSkipDir(dirPath: string): boolean {
    if (dirPath === ".") return false;
    const segments = dirPath.split("/");
    return SKIP_DIRS.has(segments[segments.length - 1]);
  }

  function shouldSkipFile(filePath: string): boolean {
    for (const ext of SKIP_FILE_EXTS) {
      if (filePath.endsWith(ext)) return true;
    }
    return false;
  }

  async function readDirectoryRecursive(dirPath: string, collector: FileInfo[]) {
    if (visitedDirs.current.has(dirPath)) return;
    visitedDirs.current.add(dirPath);

    if (dirPath !== "." && shouldSkipDir(dirPath)) {
      appendLog(`Skipping dir: "${dirPath}"`);
      return;
    }

    const dirRes = await replit.fs.readDir(dirPath);
    if (dirRes.error) {
      appendLog(`readDir error for "${dirPath}": ${dirRes.error}`);
      return;
    }
    const { children } = dirRes;
    if (!children) return;

    const dirs: string[] = [];
    const filesToRead: string[] = [];

    for (const child of children) {
      const fullPath = dirPath === "." ? child.filename : `${dirPath}/${child.filename}`;
      if (child.type === "DIRECTORY") {
        dirs.push(fullPath);
      } else {
        filesToRead.push(fullPath);
      }
    }

    // Recurse subdirs
    for (const d of dirs) {
      await readDirectoryRecursive(d, collector);
    }

    // Then read files in batches
    for (let i = 0; i < filesToRead.length; i += MAX_CONCURRENT_READS) {
      const slice = filesToRead.slice(i, i + MAX_CONCURRENT_READS);
      await Promise.all(slice.map(async (filePath) => {
        await processOneFile(filePath, collector);
      }));
    }
  }

  async function processOneFile(filePath: string, collector: FileInfo[]) {
    try {
      if (shouldSkipFile(filePath)) {
        appendLog(`Skipping file (extension): "${filePath}"`);
        return;
      }
      // base64 partial read => skip if huge
      const b64Res = await replit.fs.readFile(filePath, "base64");
      if ("error" in b64Res && b64Res.error) {
        appendLog(`Failed base64 read "${filePath}": ${b64Res.error}`);
        return;
      }
      const b64Content = b64Res.content || "";
      if (b64Content.length > MAX_BASE64_BYTES) {
        appendLog(`Skipping large file: "${filePath}" (base64 size: ${b64Content.length})`);
        return;
      }

      // read in utf8 => line count
      const utf8Res = await replit.fs.readFile(filePath, "utf8");
      if ("error" in utf8Res && utf8Res.error) {
        appendLog(`Failed utf8 read "${filePath}": ${utf8Res.error}`);
        return;
      }
      const content = utf8Res.content || "";
      const lineCount = content.split("\n").length;

      collector.push({ path: filePath, lineCount });
    } catch (err) {
      appendLog(`Error reading file "${filePath}": ${String(err)}`);
    }
  }

  //
  // BUILD TREE
  //
  function buildTree(allFiles: FileInfo[]): TreeNode[] {
    const root: Record<string, any> = {};

    for (const f of allFiles) {
      const parts = f.path.split("/");
      let curr = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!curr[part]) {
          curr[part] = { __isDir: true, __children: {} };
        }
        if (i === parts.length - 1) {
          curr[part].__isDir = false;
          curr[part].__lineCount = f.lineCount;
        }
        curr = curr[part].__children;
      }
    }

    function toTreeNodes(obj: any, prefix: string): TreeNode[] {
      const out: TreeNode[] = [];
      for (const name of Object.keys(obj)) {
        const nodeData = obj[name];
        const path = prefix === "." ? name : `${prefix}/${name}`;
        const isDir = nodeData.__isDir;
        if (isDir) {
          const kids = toTreeNodes(nodeData.__children, path);
          out.push({
            name,
            path,
            isDir: true,
            children: kids
          });
        } else {
          out.push({
            name,
            path,
            isDir: false,
            lineCount: nodeData.__lineCount
          });
        }
      }

      // Sort: folders alpha, files by descending lineCount
      out.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        if (!a.isDir && !b.isDir) {
          const lcA = a.lineCount || 0;
          const lcB = b.lineCount || 0;
          return lcB - lcA;
        }
        return a.name.localeCompare(b.name);
      });
      return out;
    }

    const top = toTreeNodes({ ".": { __isDir: true, __children: root } }, ".")[0];
    return top?.children || [];
  }

  //
  // SCAN
  //
  async function handleScan() {
    if (!replit?.fs) return;
    setScanning(true);
    setRootTree([]);
    setSelectedMap({});
    setLogs([]);
    visitedDirs.current.clear();

    appendLog("Scanning codebase (skips node_modules, .git, etc.)...");
    try {
      const allFiles: FileInfo[] = [];
      await readDirectoryRecursive(".", allFiles);

      appendLog(`Discovered ${allFiles.length} file(s). Building tree...`);
      const tree = buildTree(allFiles);
      setRootTree(tree);

      // Auto-select
      const newSel: Record<string, boolean> = {};
      for (const f of allFiles) {
        newSel[f.path] = shouldIncludeFile(f.path);
      }
      setSelectedMap(newSel);

      appendLog("Scan complete.");
      setHasScanned(true);
    } catch (err) {
      appendLog(`Error scanning codebase: ${String(err)}`);
    } finally {
      setScanning(false);
    }
  }

  //
  // GENERATE
  //
  async function handleGenerate() {
    try {
      setGenerating(true);
      const now = new Date().toISOString().replace(/[^\dT]/g, "").split(".")[0];
      const outFileName = `code-to-text-${now}.txt`;

      // 1) Build a "table of contents" (tree structure) for only selected items
      const tocLines: string[] = [];
      function buildSelectedTreeText(node: TreeNode, prefix: string, isLast: boolean) {
        // Check if this node is relevant: if it's a file, must be selected; if it's a folder, must have any selected child
        if (!node.isDir && !selectedMap[node.path]) {
          // file not selected => skip entirely
          return;
        }
        if (node.isDir && !folderHasAnySelected(node)) {
          // no selected children => skip
          return;
        }

        // Compose this node's line
        const branch = isLast ? "└─ " : "├─ ";
        let line = prefix + branch + node.name;
        if (!node.isDir && node.lineCount != null) {
          line += ` (${node.lineCount} lines)`;
        }
        tocLines.push(line);

        // If directory, handle children
        if (node.isDir && node.children) {
          const subCount = node.children.filter((c) => {
            return c.isDir ? folderHasAnySelected(c) : selectedMap[c.path];
          }).length;
          node.children.forEach((child, idx) => {
            const isSubLast = idx === subCount - 1;
            // prefix for children
            const childPrefix = prefix + (isLast ? "   " : "|  ");
            buildSelectedTreeText(child, childPrefix, isSubLast);
          });
        }
      }

      // Build lines recursively
      rootTree.forEach((node, i) => {
        const isLastRoot = i === rootTree.length - 1;
        buildSelectedTreeText(node, "", isLastRoot);
      });

      // 2) Gather full file contents
      let combined = "";
      async function gatherSelectedContent(node: TreeNode) {
        if (node.isDir && node.children) {
          for (const child of node.children) {
            await gatherSelectedContent(child);
          }
        } else if (!node.isDir && selectedMap[node.path]) {
          const readRes = await replit.fs.readFile(node.path, "utf8");
          if ("error" in readRes && readRes.error) {
            replit.messages.showError(`Could not read "${node.path}": ${readRes.error}`);
          } else {
            const content = ("content" in readRes && readRes.content) ? readRes.content : "";
            // We'll append file content
            combined += `FILE: ${node.path}\n`;
            combined += `----------------------------------------\n`;
            combined += content + "\n\n";
          }
        }
      }
      for (const t of rootTree) {
        await gatherSelectedContent(t);
      }

      // 3) Construct final text with Table of Contents + actual file contents
      let finalText = "### FILE TREE (SELECTED)\n\n";
      if (tocLines.length === 0) {
        finalText += "(No files selected)\n";
      } else {
        finalText += tocLines.join("\n") + "\n";
      }
      finalText += "\n\n### FILE CONTENTS\n\n";
      finalText += combined || "(No file contents)\n";

      // 4) Write to disk
      const writeRes = await replit.fs.writeFile(outFileName, finalText);
      if ("error" in writeRes && writeRes.error) {
        throw new Error(writeRes.error);
      }
      appendLog(`File generated: "${outFileName}"`);
      replit.messages.showNotice(`Created: ${outFileName}`, 5000);
    } catch (err) {
      replit.messages.showError(`Failed generating file: ${String(err)}`);
    } finally {
      setGenerating(false);
    }
  }

  //
  // FOLDER TOGGLING
  //
  function handleToggleFolder(folderPath: string, newVal: boolean) {
    const updated = { ...selectedMap };
    const folderNode = findNode(rootTree, folderPath);
    if (!folderNode || !folderNode.isDir) return;

    function setAllFilesRec(n: TreeNode) {
      if (n.isDir && n.children) {
        n.children.forEach(setAllFilesRec);
      } else if (!n.isDir) {
        updated[n.path] = newVal;
      }
    }
    folderNode.children?.forEach(setAllFilesRec);
    setSelectedMap(updated);
  }

  function findNode(nodes: TreeNode[], searchPath: string): TreeNode | null {
    for (const n of nodes) {
      if (n.path === searchPath) return n;
      if (n.isDir && n.children) {
        const found = findNode(n.children, searchPath);
        if (found) return found;
      }
    }
    return null;
  }

  /** Returns true if `node` is a folder with at least one selected file in its subtree. */
  function folderHasAnySelected(node: TreeNode): boolean {
    if (!node.isDir || !node.children) return false;
    // If any child is a selected file or a folder with a selected child
    return node.children.some((child) => {
      if (!child.isDir) {
        return selectedMap[child.path];
      } else {
        return folderHasAnySelected(child);
      }
    });
  }

  //
  // FOLDER/FILE COMPONENT
  //
  function NodeItem({ node }: { node: TreeNode }) {
    const [expanded, setExpanded] = React.useState(true);

    if (node.isDir) {
      // Count how many files in folder vs how many are selected
      const fileCount = countFiles(node);
      const selectedCount = countSelected(node, selectedMap);
      const totalLines = totalFolderLines(node);
      const selectedLines = selectedFolderLines(node, selectedMap);

      const isAllSelected = selectedCount === fileCount;
      const isNoneSelected = selectedCount === 0;
      const isPartial = !isAllSelected && !isNoneSelected;

      const checkboxRef = React.useRef<HTMLInputElement>(null);
      React.useEffect(() => {
        if (checkboxRef.current) {
          checkboxRef.current.indeterminate = isPartial;
        }
      }, [isPartial]);

      function toggleFolderCheckbox() {
        preserveScroll(() => {
          const newVal = !isAllSelected;
          handleToggleFolder(node.path, newVal);
        });
      }

      function toggleExpand() {
        preserveScroll(() => {
          setExpanded(!expanded);
        });
      }

      return (
        <div style={{ marginBottom: 8 }}>
          <div style={styles.folderRow}>
            <input
              type="checkbox"
              ref={checkboxRef}
              checked={isAllSelected}
              onChange={toggleFolderCheckbox}
            />
            <span
              style={{ cursor: "pointer", marginLeft: 6, userSelect: "none" }}
              onClick={toggleExpand}
            >
              {expanded ? "📂" : "📁"} <strong>{node.name}</strong>{" "}
              <span style={{ fontSize: "0.8rem", color: "#666" }}>
                ({selectedCount}/{fileCount} files, {selectedLines}/{totalLines} lines)
              </span>
            </span>
          </div>
          {expanded && node.children && (
            <div style={{ marginLeft: 20, marginTop: 4 }}>
              {node.children.map((c) => (
                <NodeItem key={c.path} node={c} />
              ))}
            </div>
          )}
        </div>
      );
    } else {
      // File
      const checked = !!selectedMap[node.path];
      function toggle() {
        preserveScroll(() => {
          setSelectedMap((prev) => ({ ...prev, [node.path]: !checked }));
        });
      }
      return (
        <div style={styles.fileRow}>
          <input type="checkbox" checked={checked} onChange={toggle} />
          <span style={{ marginLeft: 6, fontFamily: "monospace" }}>
            {node.name}{" "}
            {node.lineCount != null && (
              <span style={lineCountStyle(node.lineCount)}>
                {node.lineCount} lines
              </span>
            )}
          </span>
        </div>
      );
    }
  }

  //
  // SELECTED SUMMARY
  //
  const { selectedFileCount, selectedLineCount } = React.useMemo(() => {
    let fCount = 0;
    let lCount = 0;
    function visit(n: TreeNode) {
      if (n.isDir && n.children) {
        n.children.forEach(visit);
      } else if (!n.isDir && selectedMap[n.path]) {
        fCount++;
        lCount += n.lineCount || 0;
      }
    }
    rootTree.forEach(visit);
    return { selectedFileCount: fCount, selectedLineCount: lCount };
  }, [rootTree, selectedMap]);

  //
  // COUNT UTILS
  //
  function countFiles(folder: TreeNode): number {
    if (!folder.isDir) return 1;
    let sum = 0;
    folder.children?.forEach((c) => {
      sum += countFiles(c);
    });
    return sum;
  }

  function countSelected(folder: TreeNode, selMap: Record<string, boolean>): number {
    if (!folder.isDir) {
      return selMap[folder.path] ? 1 : 0;
    }
    let sum = 0;
    folder.children?.forEach((c) => {
      sum += countSelected(c, selMap);
    });
    return sum;
  }

  function totalFolderLines(folder: TreeNode): number {
    if (!folder.isDir) return folder.lineCount || 0;
    let sum = 0;
    folder.children?.forEach((c) => {
      sum += totalFolderLines(c);
    });
    return sum;
  }

  function selectedFolderLines(folder: TreeNode, selMap: Record<string, boolean>): number {
    if (!folder.isDir) {
      return selMap[folder.path] ? (folder.lineCount || 0) : 0;
    }
    let sum = 0;
    folder.children?.forEach((c) => {
      sum += selectedFolderLines(c, selMap);
    });
    return sum;
  }

  function lineCountStyle(lines: number): React.CSSProperties {
    let bg = "transparent";
    if (lines >= 5000) bg = "rgba(255, 0, 0, 0.2)";       
    else if (lines >= 1000) bg = "rgba(255, 165, 0, 0.2)";
    else if (lines >= 500) bg = "rgba(255, 215, 0, 0.2)";
    else if (lines >= 100) bg = "rgba(144, 238, 144, 0.3)";
    return {
      marginLeft: 8,
      backgroundColor: bg,
      borderRadius: 4,
      padding: "2px 6px",
      color: "#333",
      fontSize: "0.8rem",
    };
  }

  //
  // RENDER
  //
  if (status === "loading") {
    return <div style={styles.loading}>Connecting to Replit...</div>;
  }
  if (status === "error") {
    return <div style={styles.loading}>Error initializing extension.</div>;
  }

  const hasFiles = rootTree.length > 0;

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Code to TXT</h1>
      <p>
        Quickly scan your codebase, select/deselect folders or files, and generate a single TXT file
        with a table of contents plus the actual code.
      </p>

      <div style={styles.buttonRow}>
        <button style={styles.scanBtn} onClick={handleScan} disabled={scanning}>
          {scanning ? "Scanning..." : "Scan Codebase"}
        </button>
        {hasScanned && (
          <button
            style={styles.generateBtn}
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? "Generating..." : "Generate a TXT File"}
          </button>
        )}
      </div>

      {hasFiles && (
        <div style={styles.summaryRow}>
          <strong>Selected:</strong> {selectedFileCount} file
          {selectedFileCount === 1 ? "" : "s"},{" "}
          {selectedLineCount} lines
        </div>
      )}

      {hasFiles ? (
        <div style={styles.treeContainer} ref={treeContainerRef}>
          <p style={styles.note}>
            Click a folder checkbox to select/unselect all files within it, 
            or expand/collapse by clicking the folder icon. The final TXT 
            will contain a “FILE TREE (SELECTED)” plus the actual file contents below it.
          </p>
          {rootTree.map((n) => (
            <NodeItem key={n.path} node={n} />
          ))}
        </div>
      ) : (
        <p style={{ margin: "1rem 0" }}>
          {scanning ? "Scanning in progress..." : "No files found yet."}
        </p>
      )}

      <h3 style={{ marginTop: "1rem" }}>Logs</h3>
      <div style={styles.logsBox}>
        {logs.map((line, i) => (
          <div key={i} style={styles.logLine}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

// Standard React entry point
const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <ErrorBoundary>
    <HandshakeProvider>
      <App />
    </HandshakeProvider>
  </ErrorBoundary>
);

////////////////////////////////////////////////////////////////////////////////
// STYLES
////////////////////////////////////////////////////////////////////////////////

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "'Inter', system-ui, sans-serif",
    padding: "2rem",
    maxWidth: 900,
    margin: "0 auto",
    backgroundColor: "#fff",
    color: "#1a1a1a",
  },
  title: {
    fontSize: "2rem",
    marginBottom: "1rem",
    fontWeight: 700,
    background: "linear-gradient(45deg, #2563eb, #3b82f6)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  loading: {
    padding: "2rem",
    fontSize: "1.1rem",
    color: "#666",
  },
  buttonRow: {
    display: "flex",
    gap: "1rem",
    marginBottom: "1rem",
  },
  scanBtn: {
    padding: "0.75rem 1.5rem",
    cursor: "pointer",
    backgroundColor: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "1rem",
    fontWeight: 500,
  },
  generateBtn: {
    padding: "0.75rem 1.5rem",
    cursor: "pointer",
    backgroundColor: "#16a34a",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "1rem",
    fontWeight: 500,
  },
  summaryRow: {
    marginBottom: "0.5rem",
    fontSize: "0.95rem",
    color: "#222",
  },
  note: {
    fontSize: "0.95rem",
    color: "#666",
    lineHeight: 1.5,
    marginBottom: "1rem",
  },
  treeContainer: {
    borderLeft: "3px solid #e5e7eb",
    paddingLeft: "1rem",
    marginBottom: "1rem",
    maxHeight: "55vh",
    overflowY: "auto",
  },
  folderRow: {
    display: "flex",
    alignItems: "center",
    margin: "4px 0",
  },
  fileRow: {
    display: "flex",
    alignItems: "center",
    margin: "4px 0",
  },
  logsBox: {
    marginTop: "1rem",
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    backgroundColor: "#f8fafc",
    padding: "1rem",
    height: "160px",
    overflowY: "auto",
    boxShadow: "inset 0 2px 4px rgba(0,0,0,0.05)",
  },
  logLine: {
    fontFamily: "'Fira Code', monospace",
    fontSize: "0.9rem",
    marginBottom: "0.4rem",
    color: "#475569",
    lineHeight: 1.4,
  },
};

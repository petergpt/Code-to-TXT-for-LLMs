// src/tool/main.tsx
import * as React from "react";
import { createRoot } from "react-dom/client";
import { HandshakeProvider, useReplit } from "@replit/extensions-react";
import { shouldIncludeFile } from "../rules";

// We skip scanning these directories to avoid huge overhead
const SKIP_DIRS = ["node_modules", ".git", ".cache", ".venv", "venv", "dist", "build"];

/** Each file has a path and a lineCount once we read it. */
interface FileInfo {
  path: string;
  lineCount: number;
}

/**
 * The main UI for “Code to TXT.”
 */
function App() {
  const { replit, status } = useReplit();

  const [files, setFiles] = React.useState<FileInfo[]>([]);
  const [selectedFiles, setSelectedFiles] = React.useState<Record<string, boolean>>({});
  const [logs, setLogs] = React.useState<string[]>([]);
  const [scanning, setScanning] = React.useState(false);

  /** Appends a line of text to the logs. */
  function appendLog(msg: string) {
    setLogs(prev => [...prev, msg]);
  }

  /**
   * Recursively gather file paths from `dirPath`, skipping big/irrelevant folders.
   * We do a single pass that also reads line counts for each file. 
   */
  async function readDirectoryRecursive(dirPath: string, collector: FileInfo[]) {
    // If dirPath matches or ends with a skip dir, do not recurse
    for (const skipName of SKIP_DIRS) {
      if (dirPath === skipName || dirPath.endsWith(`/${skipName}`)) {
        return;
      }
    }
    const dirRes = await replit.fs.readDir(dirPath);
    if (dirRes.error) {
      appendLog(`readDir error for "${dirPath}": ${dirRes.error}`);
      return;
    }
    const { children } = dirRes;
    if (!children) return;

    for (const child of children) {
      const fullPath = dirPath === "." ? child.filename : `${dirPath}/${child.filename}`;
      if (child.type === "DIRECTORY") {
        await readDirectoryRecursive(fullPath, collector);
      } else {
        // It's a file => read once to get line count
        const readRes = await replit.fs.readFile(fullPath, "utf8");
        let lineCount = 0;
        if ("error" in readRes && readRes.error) {
          appendLog(`Failed reading lines in "${fullPath}": ${readRes.error}`);
        } else {
          const content = ("content" in readRes && readRes.content) ? readRes.content : "";
          lineCount = content.split("\n").length;
        }
        collector.push({ path: fullPath, lineCount });
      }
    }
  }

  /**
   * When user clicks “Scan Codebase.”
   * We gather all file paths (skipping SKIP_DIRS), read line counts, and
   * auto‐select those that pass shouldIncludeFile.
   */
  async function handleScan() {
    if (!replit?.fs) return;
    setScanning(true);
    setFiles([]);
    setSelectedFiles({});
    setLogs([]);

    appendLog("Scanning codebase (skips node_modules, .git, etc.)...");

    try {
      const allFiles: FileInfo[] = [];
      await readDirectoryRecursive(".", allFiles);

      appendLog(`Discovered ${allFiles.length} file(s). Now auto-selecting & sorting...`);

      // Build initial selection map
      const initSelected: Record<string, boolean> = {};
      for (const f of allFiles) {
        initSelected[f.path] = shouldIncludeFile(f.path);
      }

      // Sort: selected first, then alpha by path
      allFiles.sort((a, b) => {
        const selA = initSelected[a.path] ? 1 : 0;
        const selB = initSelected[b.path] ? 1 : 0;
        if (selA !== selB) {
          return selB - selA; // selected goes on top
        }
        return a.path.localeCompare(b.path);
      });

      setFiles(allFiles);
      setSelectedFiles(initSelected);

      appendLog("Scan complete. All line counts are loaded.");
    } catch (err) {
      appendLog(`Error scanning codebase: ${String(err)}`);
    } finally {
      setScanning(false);
    }
  }

  /** Toggles selection of one file. */
  function handleCheckbox(path: string) {
    setSelectedFiles(prev => ({
      ...prev,
      [path]: !prev[path]
    }));
  }

  /**
   * “Generate File” => read content for selected files, produce a single .txt.
   * We already have line counts, but we re‐read the actual contents here to
   * produce the final text.
   */
  async function handleGenerate() {
    try {
      const now = new Date().toISOString().replace(/[^\dT]/g, "").split(".")[0];
      const outFileName = `code-to-text-${now}.txt`;

      let combined = "";
      for (const f of files) {
        if (selectedFiles[f.path]) {
          const readRes = await replit.fs.readFile(f.path, "utf8");
          if ("error" in readRes && readRes.error) {
            replit.messages.showError(`Could not read "${f.path}": ${readRes.error}`);
            continue;
          }
          const content = ("content" in readRes && readRes.content) ? readRes.content : "";
          combined += `File: ${f.path}\n`;
          combined += "----------------------------------------\n";
          combined += content + "\n\n\n";
        }
      }

      const writeRes = await replit.fs.writeFile(outFileName, combined);
      if ("error" in writeRes && writeRes.error) {
        throw new Error(writeRes.error);
      }
      replit.messages.showNotice(`Created: ${outFileName}`, 5000);
    } catch (err) {
      replit.messages.showError(`Failed generating file: ${String(err)}`);
    }
  }

  // If extension handshake not ready
  if (status === "loading") {
    return <div style={styles.loading}>Connecting to Replit...</div>;
  }
  if (status === "error") {
    return <div style={styles.loading}>Error initializing extension.</div>;
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Code to TXT</h1>
      <p>
        This tool scans your codebase (skipping large system folders), loads line counts,
        and auto‐selects common code files. Then click “Generate File.”
      </p>

      <button style={styles.scanBtn} onClick={handleScan} disabled={scanning}>
        {scanning ? "Scanning..." : "Scan Codebase"}
      </button>

      {files.length > 0 ? (
        <>
          <p style={styles.note}>
            <strong>Lines</strong> on the left for quick visibility; 
            selected files appear on top. Uncheck anything you don’t want included.
          </p>
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.headerCell}>Lines</th>
                  <th style={styles.headerCell}>Select</th>
                  <th style={styles.headerCell}>File Path</th>
                </tr>
              </thead>
              <tbody>
                {files.map(f => (
                  <tr key={f.path}>
                    <td style={styles.lineCell}>{f.lineCount}</td>
                    <td style={styles.checkCell}>
                      <input
                        type="checkbox"
                        checked={!!selectedFiles[f.path]}
                        onChange={() => handleCheckbox(f.path)}
                      />
                    </td>
                    <td style={styles.filePathCell}>{f.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button style={styles.generateBtn} onClick={handleGenerate}>
            Generate File
          </button>
        </>
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
  <HandshakeProvider>
    <App />
  </HandshakeProvider>
);

// Inline styling
const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "sans-serif",
    padding: "1rem",
    maxWidth: "850px",
    margin: "0 auto"
  },
  title: {
    fontSize: "1.4rem",
    marginBottom: "0.5rem"
  },
  loading: {
    padding: "1rem"
  },
  scanBtn: {
    padding: "0.5rem 1rem",
    marginRight: "0.75rem",
    cursor: "pointer"
  },
  note: {
    margin: "0.5rem 0",
    fontSize: "0.9rem",
    fontStyle: "italic"
  },
  tableContainer: {
    marginTop: "1rem",
    border: "1px solid #ddd",
    borderRadius: "4px",
    maxHeight: "50vh",
    overflowY: "auto"
  },
  table: {
    width: "100%",
    borderCollapse: "collapse"
  },
  headerCell: {
    backgroundColor: "#f2f2f2",
    fontWeight: "bold",
    borderBottom: "1px solid #ccc",
    padding: "6px",
    position: "sticky",
    top: 0
  },
  lineCell: {
    borderBottom: "1px solid #eee",
    padding: "5px 8px",
    textAlign: "right",
    width: "4rem"
  },
  checkCell: {
    borderBottom: "1px solid #eee",
    padding: "5px 8px",
    textAlign: "center",
    width: "3rem"
  },
  filePathCell: {
    borderBottom: "1px solid #eee",
    padding: "5px 8px",
    fontFamily: "monospace"
  },
  generateBtn: {
    marginTop: "0.75rem",
    padding: "0.5rem 1rem",
    cursor: "pointer"
  },
  logsBox: {
    marginTop: "0.5rem",
    border: "1px solid #ddd",
    borderRadius: "4px",
    backgroundColor: "#fafafa",
    padding: "0.5rem",
    maxHeight: "160px",
    overflowY: "auto"
  },
  logLine: {
    fontFamily: "monospace",
    fontSize: "0.9rem",
    marginBottom: "0.25rem"
  }
};

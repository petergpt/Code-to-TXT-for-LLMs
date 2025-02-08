// src/tool/main.tsx
import * as React from "react";
import { createRoot } from "react-dom/client";
import { HandshakeProvider, useReplit } from "@replit/extensions-react";
import { shouldIncludeFile } from "../rules.ts";

function App() {
  const { replit, status } = useReplit();
  const [files, setFiles] = React.useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = React.useState<{ [path: string]: boolean }>({});

  // Fetch files when extension loads
  React.useEffect(() => {
    if (status !== "ready") return;

    async function fetchFiles() {
      try {
        const allPaths: string[] = [];
        await readDirectoryRecursive(".", allPaths);
        setFiles(allPaths);

        const initialSelection: { [path: string]: boolean } = {};
        for (const filePath of allPaths) {
          initialSelection[filePath] = shouldIncludeFile(filePath);
        }
        setSelectedFiles(initialSelection);
      } catch (err) {
        console.error("Error reading files:", err);
      }
    }

    fetchFiles();

    async function readDirectoryRecursive(dirPath: string, collector: string[]) {
      const dirEntries = await replit.fs.readDir(dirPath);
      for (const entry of dirEntries) {
        if (entry.isDir) {
          await readDirectoryRecursive(entry.path, collector);
        } else {
          collector.push(entry.path);
        }
      }
    }
  }, [status, replit]);

  // Toggle selection of a file
  const handleCheckbox = (filePath: string) => {
    setSelectedFiles(prev => ({
      ...prev,
      [filePath]: !prev[filePath]
    }));
  };

  // Generate the text file
  const handleGenerate = async () => {
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
    const outFileName = `code-extractor-${timestamp}.txt`;

    let combinedContent = "";
    for (const filePath of files) {
      if (selectedFiles[filePath]) {
        try {
          const fileData = await replit.fs.readFile(filePath, "utf8");
          combinedContent += `File: ${filePath}\n`;
          combinedContent += `----------------------------------------\n`;
          combinedContent += fileData.content + "\n\n\n";
        } catch (err) {
          console.warn("Failed to read file:", filePath, err);
        }
      }
    }

    try {
      await replit.fs.writeFile(outFileName, combinedContent);
      replit.messages.showNotice(`Successfully created: ${outFileName}`, 5000);
    } catch (err) {
      console.error("Failed to write output file:", err);
      replit.messages.showError(`Error writing file: ${outFileName}`);
    }
  };

  if (status === "loading") {
    return <div style={styles.loading}>Connecting to Replit...</div>;
  }
  if (status === "error") {
    return <div style={styles.loading}>Error initializing extension</div>;
  }

  return (
    <div style={styles.container}>
      <h2>Code Extractor</h2>
      <p>Select the files you'd like to include. Then click “Generate File.”</p>

      <div style={styles.fileList}>
        {files.map(filePath => (
          <div key={filePath} style={styles.fileItem}>
            <input
              type="checkbox"
              checked={!!selectedFiles[filePath]}
              onChange={() => handleCheckbox(filePath)}
            />
            <span style={{ marginLeft: "8px" }}>{filePath}</span>
          </div>
        ))}
      </div>

      <button onClick={handleGenerate} style={styles.button}>
        Generate File
      </button>
    </div>
  );
}

// Wrap App in HandshakeProvider
const root = createRoot(document.getElementById("root") as Element);
root.render(
  <HandshakeProvider>
    <App />
  </HandshakeProvider>
);

// Basic styles
const styles = {
  container: { padding: "1rem", fontFamily: "sans-serif" },
  loading: { padding: "1rem", fontFamily: "sans-serif" },
  fileList: { maxHeight: "40vh", overflowY: "auto", border: "1px solid #ccc", padding: "0.5rem", marginBottom: "1rem" },
  fileItem: { display: "flex", alignItems: "center", marginBottom: "0.3rem" },
  button: { padding: "0.5rem 1rem", cursor: "pointer", fontSize: "1rem" }
};

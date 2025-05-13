// File: src/extension.ts
import * as vscode from "vscode";
import * as path from "path";
import * as child_process from "child_process";
// Removed 'fs/promises' and 'os' as temp file logic is gone

// --- Globals ---
let outputChannel: vscode.OutputChannel;
const PENDING_ACTION_KEY = "diffClipboard.pendingAction"; // Key for global state
const CLIPBOARD_SCHEME = "diff-clipboard-helper"; // Unique scheme for our virtual doc

// --- Interfaces ---
interface PendingActionState {
  timestamp: number;
  command: "diffClipboard";
  filePath: string;
}

// --- Logging Helper ---
function log(
  level: "INFO" | "WARN" | "ERROR",
  message: string,
  error?: any
): void {
  if (!outputChannel) {
    try {
      outputChannel = vscode.window.createOutputChannel(
        "Diff Clipboard Helper",
        { log: true }
      );
      console.log(
        `[${getWindowContext()}] Output channel 'Diff Clipboard Helper' created.`
      );
    } catch (e) {
      console.error(
        `[${getWindowContext()}] FAILED to create output channel: ${e}`
      );
      return;
    }
  }
  const timestamp = new Date().toISOString();
  const context = getWindowContext();
  const logLine = `[${timestamp}] [${context}] [${level}] ${message}`;
  try {
    outputChannel.appendLine(logLine);
    if (error) {
      const errorMsg =
        error instanceof Error ? error.message : JSON.stringify(error);
      outputChannel.appendLine(`    Error Details: ${errorMsg}`);
      // Optionally log stack trace during development
      // if (context.extensionMode === vscode.ExtensionMode.Development && error instanceof Error && error.stack) {
      //     outputChannel.appendLine(`    Stack: ${error.stack}`);
      // }
    }
  } catch (e) {
    console.error(
      `[${getWindowContext()}] FAILED to append to output channel: ${e}`
    );
    console.error(
      `[${getWindowContext()}] Original message (${level}): ${message}`,
      error
    );
  }
}

// --- Window Context Helper ---
function getWindowContext(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders.length === 1
      ? folders[0].name
      : folders.map((f) => f.name).join(",");
  }
  if (vscode.workspace.workspaceFile) {
    return path.basename(vscode.workspace.workspaceFile.fsPath);
  }
  return "NoWorkspace";
}

// --- Workspace Check Helper ---
function checkFileUriBelongsToWindow(fileUri: vscode.Uri): boolean {
  const currentWorkspaceFolders = vscode.workspace.workspaceFolders || [];
  // Check if the file is directly within any open workspace folder
  const isFileInWorkspaceFolder = currentWorkspaceFolders.some(
    (folder) =>
      fileUri.fsPath.startsWith(folder.uri.fsPath + path.sep) ||
      fileUri.fsPath === folder.uri.fsPath
  );
  // Check if this window is handling files outside of any specific workspace folder
  const isWindowHandlingLooseFiles =
    currentWorkspaceFolders.length === 0 && !vscode.workspace.workspaceFile;

  return isFileInWorkspaceFolder || isWindowHandlingLooseFiles;
}

// --- Clipboard Content Provider ---
// Provides the content for the virtual document representing the clipboard
class ClipboardContentProvider implements vscode.TextDocumentContentProvider {
  // Optional: Event emitter to signal content changes (rarely needed for clipboard)
  // readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  // readonly onDidChange = this.onDidChangeEmitter.event;

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    // Uri will be like: diff-clipboard-helper://clipboard/compare.ts?ts=...
    log(
      "INFO",
      `PROVIDER: Providing content for virtual URI: ${uri.toString()}`
    );
    try {
      const clipboardText = await vscode.env.clipboard.readText();
      return clipboardText || ""; // Return empty string if clipboard is empty
    } catch (error) {
      log(
        "ERROR",
        `PROVIDER: Failed to read clipboard for URI: ${uri.toString()}`,
        error
      );
      vscode.window.showErrorMessage(
        `Failed to read clipboard: ${
          error instanceof Error ? error.message : error
        }`
      );
      // Return error message in the virtual document itself
      return `// Error reading clipboard: ${
        error instanceof Error ? error.message : error
      }`;
    }
  }
}

// --- Virtual Document Diff Implementation ---
// Uses the TextDocumentContentProvider and vscode.diff
async function performDiffWithClipboardVirtualDoc(
  originalFileUri: vscode.Uri
): Promise<void> {
  const baseName = path.basename(originalFileUri.fsPath);
  const extension = path.extname(originalFileUri.fsPath) || ".txt"; // Get extension for syntax hint

  log("INFO", `DIFF(Virtual): Starting diff for ${baseName}`);

  try {
    // 1. Check Clipboard (Good practice before creating URIs/commands)
    const clipboardText = await vscode.env.clipboard.readText();
    if (!clipboardText) {
      log(
        "WARN",
        `DIFF(Virtual): Clipboard empty. Aborting diff for ${baseName}.`
      );
      vscode.window.showInformationMessage("Clipboard is empty, cannot diff.");
      return;
    }

    // 2. Create the Virtual URI for the clipboard content
    // Include the original file extension in the path for syntax highlighting hint.
    // Using a stable path but adding a timestamp query to ensure freshness if needed.
    const clipboardUri = vscode.Uri.parse(
      `${CLIPBOARD_SCHEME}://clipboard/compare${extension}?ts=${Date.now()}`
    );
    log(
      "INFO",
      `DIFF(Virtual): Created clipboard URI: ${clipboardUri.toString()}`
    );

    // 3. Define the Diff Title
    const diffTitle = `${baseName} ↔ Clipboard`; // Original File vs Clipboard

    // 4. Execute the Diff Command with swapped sides
    log(
      "INFO",
      `DIFF(Virtual): Executing vscode.diff: Left='${
        originalFileUri.fsPath
      }', Right='${clipboardUri.toString()}'`
    );
    await vscode.commands.executeCommand(
      "vscode.diff",
      originalFileUri, // <<< Left side: The actual file
      clipboardUri, // <<< Right side: The virtual clipboard document
      diffTitle,
      { preview: false } // Optional: ensure the diff tab isn't preview
    );
    log("INFO", `DIFF(Virtual): vscode.diff command executed for ${baseName}.`);
  } catch (error) {
    log("ERROR", `DIFF(Virtual): Error executing diff for ${baseName}`, error);
    const message =
      error instanceof Error ? error.message : JSON.stringify(error);
    vscode.window.showErrorMessage(`Diff with clipboard failed: ${message}`);
  }
}

// --- State Check and Action Trigger ---
// Called on focus change or activation timer
async function checkAndExecutePendingAction(context: vscode.ExtensionContext) {
  let pendingAction: PendingActionState | undefined;
  try {
    pendingAction =
      context.globalState.get<PendingActionState>(PENDING_ACTION_KEY);
  } catch (e) {
    log(
      "ERROR",
      `STATE: Failed to read global state key ${PENDING_ACTION_KEY}`,
      e
    );
    return;
  }

  // Validate state object structure
  if (
    !pendingAction ||
    typeof pendingAction !== "object" ||
    pendingAction.command !== "diffClipboard" ||
    typeof pendingAction.filePath !== "string" ||
    typeof pendingAction.timestamp !== "number"
  ) {
    if (pendingAction) {
      log(
        "WARN",
        `STATE: Invalid pending action found: ${JSON.stringify(
          pendingAction
        )}. Clearing.`
      );
      // Clear invalid state
      try {
        await context.globalState.update(PENDING_ACTION_KEY, undefined);
      } catch (e) {
        log("ERROR", `STATE: Failed to clear invalid state`, e);
      }
    }
    return; // No valid pending action
  }

  // Check staleness
  const maxAgeMs = 15000; // 15 seconds tolerance
  if (Date.now() - pendingAction.timestamp > maxAgeMs) {
    log(
      "INFO",
      `STATE: Stale pending action found (>${maxAgeMs}ms) for ${path.basename(
        pendingAction.filePath
      )}, clearing.`
    );
    try {
      await context.globalState.update(PENDING_ACTION_KEY, undefined);
    } catch (e) {
      log("ERROR", `STATE: Failed to clear stale state`, e);
    }
    return;
  }

  // Valid, non-stale action found
  const fileUri = vscode.Uri.file(pendingAction.filePath);
  const baseName = path.basename(fileUri.fsPath);
  log("INFO", `STATE: Found pending action for: ${baseName}`);

  // Check if file belongs to this window (THE CRITICAL CHECK)
  if (checkFileUriBelongsToWindow(fileUri)) {
    log(
      "INFO",
      `STATE: File '${baseName}' belongs to this window. Preparing to execute diff from state.`
    );

    // Clear state *before* performing action to prevent re-execution
    log("INFO", "STATE: Clearing pending action state...");
    try {
      await context.globalState.update(PENDING_ACTION_KEY, undefined);
      log("INFO", "STATE: Pending action state cleared successfully.");
    } catch (e) {
      // Log error but attempt to proceed with the action anyway, as state might clear on next focus
      log(
        "ERROR",
        `STATE: Failed to clear state BEFORE action. Proceeding cautiously.`,
        e
      );
    }

    // Execute the diff using the virtual document method
    log(
      "INFO",
      `STATE: Executing virtual doc diff from state for ${baseName}.`
    );
    await performDiffWithClipboardVirtualDoc(fileUri); // <-- USE NEW METHOD
  } else {
    log(
      "INFO",
      `STATE: File '${baseName}' does not belong to this window. Action will be handled by the correct window's focus event.`
    );
    // Do nothing - the correct window's focus event will trigger *its* checkAndExecutePendingAction
  }
}

// --- Extension Activation ---
export function activate(context: vscode.ExtensionContext) {
  log("INFO", "ACTIVATE: Extension activating.");

  // --- Register Content Provider (Needs to be available before diff is called) ---
  log(
    "INFO",
    `ACTIVATE: Registering clipboard content provider for scheme '${CLIPBOARD_SCHEME}'.`
  );
  const clipboardProvider = new ClipboardContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      CLIPBOARD_SCHEME,
      clipboardProvider
    )
  );

  // --- Register Listener for Window Focus Changes ---
  log("INFO", "ACTIVATE: Registering listener for window state changes.");
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(async (windowState) => {
      try {
        // Only check state when a window *gains* focus
        if (windowState.focused) {
          log("INFO", "EVENT: Window gained focus, checking state...");
          // Add a small delay - sometimes focus triggers slightly before state is fully settled
          await new Promise((resolve) => setTimeout(resolve, 100));
          await checkAndExecutePendingAction(context);
        } else {
          log("INFO", "EVENT: Window lost focus.");
        }
      } catch (e) {
        log("ERROR", `Error in onDidChangeWindowState handler`, e);
      }
    })
  );

  // --- Initial check on activation (after small delay) ---
  // Handles cases where VS Code starts/reloads with the correct window already focused
  // and potentially pending state from a previous session or failed 'code --goto'.
  log(
    "INFO",
    "ACTIVATE: Scheduling initial check for pending actions (500ms delay)."
  );
  const initialCheckTimeout = setTimeout(() => {
    try {
      log("INFO", "ACTIVATE: Performing initial check for pending actions.");
      checkAndExecutePendingAction(context);
    } catch (e) {
      log("ERROR", `Error during initial checkAndExecutePendingAction`, e);
    }
  }, 500); // Slightly shorter delay now focus handler also has one

  // --- Register URI Handler ---
  log("INFO", "ACTIVATE: Registering URI handler.");
  const uriHandler = vscode.window.registerUriHandler({
    handleUri: async (uri: vscode.Uri) => {
      log("INFO", `URI: Handler received URI: ${uri.toString()}.`);
      try {
        // Validate URI path and query parameter
        if (!uri.path.startsWith("/diff")) {
          log("WARN", `URI: Unrecognized path: ${uri.path}. Aborting.`);
          return;
        }
        const params = new URLSearchParams(uri.query);
        const encodedFilePath = params.get("path");
        if (!encodedFilePath) {
          log("WARN", "URI: Missing 'path' query parameter. Aborting.");
          vscode.window.showErrorMessage(
            "Diff request URI is missing the 'path' query parameter."
          );
          return;
        }

        const filePath = decodeURIComponent(encodedFilePath);
        const fileUri = vscode.Uri.file(filePath);
        const baseName = path.basename(fileUri.fsPath);
        log("INFO", `URI: Processing request for file: ${baseName}`);

        // --- Main Logic Branch ---
        if (checkFileUriBelongsToWindow(fileUri)) {
          // --- CORRECT WINDOW: Use Virtual Document Diff Directly ---
          log(
            "INFO",
            `URI: File '${baseName}' belongs to this window. Using virtual doc diff directly.`
          );
          // No need to open/show/wait - vscode.diff handles it
          await performDiffWithClipboardVirtualDoc(fileUri); // <-- USE NEW METHOD
          log(
            "INFO",
            `URI: Virtual doc diff initiated for '${baseName}' in correct window.`
          );
        } else {
          // --- WRONG WINDOW: Set State and Trigger Focus Change ---
          log(
            "INFO",
            `URI: File '${baseName}' does not belong to this window. Setting state & spawning 'code --goto'.`
          );
          const state: PendingActionState = {
            timestamp: Date.now(),
            command: "diffClipboard",
            filePath: filePath,
          };
          try {
            log("INFO", `URI: Updating global state for file: ${baseName}`);
            await context.globalState.update(PENDING_ACTION_KEY, state);
            log(
              "INFO",
              `URI: Global state updated successfully for '${baseName}'.`
            );
          } catch (stateError) {
            log(
              "ERROR",
              `URI: Failed to update global state for '${baseName}'. Proceeding with goto anyway.`,
              stateError
            );
            // Still attempt the goto, maybe the state is already set or will set later
          }

          // Execute 'code --goto' to switch focus
          const command = process.platform === "win32" ? "code.cmd" : "code";
          const args = ["--goto", `${fileUri.fsPath}:1:1`]; // Add line/col hint for better focus
          log(
            "INFO",
            `URI: Spawning '${command} ${args.join(" ")}' for ${baseName}`
          );
          const child = child_process.spawn(command, args, {
            detached: true, // Allow parent (VS Code) to exit independently
            stdio: "ignore", // Don't capture stdio
          });
          child.on("error", (err) => {
            log(
              "ERROR",
              `URI: Failed to spawn '${command}'. Is 'code' in PATH?`,
              err
            );
            vscode.window.showErrorMessage(
              `Failed to execute '${command}' to switch window. Is 'code' in your system PATH?`
            );
            // Attempt to clear state if spawn failed, as focus won't change
            try {
              context.globalState.update(PENDING_ACTION_KEY, undefined);
            } catch (clearErr) {
              log(
                "ERROR",
                `URI: Failed to clear state after spawn error.`,
                clearErr
              );
            }
          });
          // Prevent the child process from keeping the extension host alive
          child.unref();
          log("INFO", `URI: 'code --goto' process spawned for '${baseName}'.`);
        }
      } catch (error) {
        log("ERROR", `Uncaught error in handleUri`, error);
        const message =
          error instanceof Error ? error.message : JSON.stringify(error);
        vscode.window.showErrorMessage(
          `Unexpected error processing diff request: ${message}`
        );
      } finally {
        log("INFO", `URI: Handler finished processing URI: ${uri.toString()}.`);
      }
    }, // End handleUri
  }); // End registerUriHandler
  context.subscriptions.push(uriHandler); // Add URI handler to subscriptions

  // --- Register Manual Command ---
  log(
    "INFO",
    "ACTIVATE: Registering manual command 'diffActiveEditorWithClipboard'."
  );
  const diffActiveEditorWithClipboardCommand = vscode.commands.registerCommand(
    "vscode-diff-clipboard.diffActiveEditorWithClipboard",
    async () => {
      log("INFO", "COMMAND: Manual diff triggered.");
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        log("WARN", "COMMAND: No active editor.");
        vscode.window.showInformationMessage(
          "No active editor to compare with clipboard."
        );
        return;
      }
      if (activeEditor.document.isUntitled) {
        log("WARN", "COMMAND: Active editor is untitled.");
        vscode.window.showInformationMessage(
          "Cannot compare an untitled file with clipboard this way."
        );
        return;
      }
      if (activeEditor.document.uri.scheme !== "file") {
        log(
          "WARN",
          `COMMAND: Active editor has non-file scheme: ${activeEditor.document.uri.scheme}`
        );
        vscode.window.showInformationMessage(
          `Cannot compare non-file ('${activeEditor.document.uri.scheme}') editor with clipboard.`
        );
        return;
      }

      // Use the virtual doc diff method for the command palette action
      log(
        "INFO",
        `COMMAND: Executing virtual doc diff for active file: ${path.basename(
          activeEditor.document.uri.fsPath
        )}`
      );
      await performDiffWithClipboardVirtualDoc(activeEditor.document.uri); // <-- USE NEW METHOD
      log("INFO", "COMMAND: Manual diff command finished.");
    }
  );
  context.subscriptions.push(diffActiveEditorWithClipboardCommand); // Add command to subscriptions

  log("INFO", "ACTIVATE: Extension setup complete.");
} // End activate

// --- Extension Deactivation ---
export function deactivate(): Promise<void> | undefined {
  log("INFO", "DEACTIVATE: Extension deactivating.");
  // No temp files to clean up with this approach
  if (outputChannel) {
    log("INFO", "DEACTIVATE: Disposing output channel.");
    outputChannel.dispose();
  }
  // Note: Content providers are automatically disposed when the extension deactivates.
  // Note: State is persisted, no need to clear it here unless specifically desired.
  return undefined; // Return void or undefined for synchronous cleanup
} // End deactivate

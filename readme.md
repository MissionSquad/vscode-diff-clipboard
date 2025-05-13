# VS Code Diff Clipboard

**VS Code Diff Clipboard** is an extension that allows you to open files and diff their content against your clipboard, primarily triggered via a custom URI. This is particularly useful for integrating with external tools or scripts that need to initiate a diff operation within VS Code.

## Features

*   **Diff via URI:** Open a specific file and diff it against the current clipboard content using a custom URI: `vscode://MissionSquad.vscode-diff-clipboard/diff?path=<encoded_file_path>`.
*   **Multi-Window Handling:** If you have multiple VS Code windows open, the extension intelligently attempts to switch to the window containing the specified file. If the file isn't open in any window, it will try to open it in the most relevant one.
*   **Command Palette Integration:** A command "Diff With Clipboard" allows you to diff the currently active and saved file against your clipboard.
*   **Virtual Document for Clipboard:** Clipboard content is displayed in a virtual document, which attempts to use the same language/syntax highlighting as the file being diffed.
*   **Output Channel Logging:** Provides logs in an output channel named "Diff Clipboard Helper" for troubleshooting.

## Usage

### 1. Using the URI Scheme

You can trigger a diff operation by opening a specially formatted URI. This is the primary way to use the extension, especially for integrations.

**URI Format:**

```
vscode://MissionSquad.vscode-diff-clipboard/diff?path=<URL_encoded_full_file_path>
```

*   `MissionSquad.vscode-diff-clipboard`: The unique identifier of this extension.
*   `/diff`: The action to perform.
*   `path=<URL_encoded_full_file_path>`: The query parameter specifying the absolute path to the file you want to diff. This path **must be URL-encoded**.

**Example:**

If you want to diff the file `/Users/johndoe/project/file.txt`, the URI would be:

```
vscode://MissionSquad.vscode-diff-clipboard/diff?path=%2FUsers%2Fjohndoe%2Fproject%2Ffile.txt
```

(Note: `%2F` is the URL encoding for `/`)

You can open this URI using your system's default mechanism for handling URI schemes (e.g., `open` on macOS, `xdg-open` on Linux, or directly in a browser).

### 2. Using the Command Palette

You can also initiate a diff with the clipboard for the currently active file:

1.  Open the Command Palette (Cmd+Shift+P on macOS, Ctrl+Shift+P on Windows/Linux).
2.  Type "Diff With Clipboard" and select the command.
3.  This will open a diff view with the content of your active editor on one side and the content of your clipboard on the other.

**Note:** This command only works if the active editor contains a saved file (not an untitled file or a virtual document from another extension).

## Installation

### From VS Code Marketplace (Recommended)

1.  Open VS Code.
2.  Go to the Extensions view (Cmd+Shift+X or Ctrl+Shift+X).
3.  Search for "VS Code Diff Clipboard" or "MissionSquad.vscode-diff-clipboard".
4.  Click "Install".

### Manual Installation from .vsix file

If you have a `.vsix` package file:

1.  Open VS Code.
2.  Go to the Extensions view.
3.  Click the "..." menu in the top-right corner of the Extensions view.
4.  Select "Install from VSIX..." and choose the `.vsix` file.

Alternatively, you can use the command line:
```bash
code --install-extension vscode-diff-clipboard-VERSION.vsix
```
(Replace `vscode-diff-clipboard-VERSION.vsix` with the actual file name).

## Development

To build and package the extension from source:

1.  **Clone the repository:**
    ```bash
    git clone <repository_url>
    cd vscode-diff-clipboard
    ```
2.  **Install dependencies:**
    ```bash
    yarn install
    ```
3.  **Compile TypeScript:**
    ```bash
    yarn compile
    ```
    Or, to watch for changes and compile automatically:
    ```bash
    yarn watch
    ```
4.  **Package the extension:**
    This will create a `.vsix` file (e.g., `vscode-diff-clipboard-0.1.17.vsix`).
    ```bash
    vsce package
    ```
    (You might need to install `vsce` globally: `npm install -g @vscode/vsce`)

## Important Notes

*   **`code` command in PATH:** For the URI-triggered diff to correctly switch between VS Code windows or open files in the appropriate window, the `code` command-line tool must be installed and available in your system's PATH. You can install it by opening the Command Palette in VS Code and searching for "Shell Command: Install 'code' command in PATH".
*   **Clipboard Access:** The extension requires access to read from your clipboard.

---

If you encounter any issues or have suggestions, please report them on the project's issue tracker.

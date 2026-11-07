# dsh-k8s-manager

[中文](./README.md)

A Kubernetes cluster manager for DeepSeek Harness (DSH). Manage your K8s clusters from a sidebar entry or conversation view, with a UI that follows the DSH theme.

Current version: **0.2.2** · Current target host: **DSH 0.2.2-rc.1**.

## Features

- **Multi-cluster management**: Add, switch, and delete multiple kubeconfigs
- **Resource browser**: Pods, Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, ReplicaSets, Services, Ingresses, Endpoints, ConfigMaps, Secrets, PVs, PVCs, StorageClasses, Nodes, Namespaces, Events
- **Resource filtering**: Filter by namespace, Pod phase, node readiness, or search text; overview cards open the corresponding resources
- **Resource detail panel**: Aligned table columns and clickable resource names, YAML for resources, and logs and terminals for Pods. Navigation and details adapt to narrow panels
- **Theme synchronization**: Inherits DSH colors, background transparency, borders, and overlays; terminal colors update dynamically
- **Interactive terminal**: Access Pod containers using xterm.js and a DSH-managed PTY, with UTF-8 input/output and terminal resizing
- **Workload operations**: Restart Deployments/StatefulSets/DaemonSets, scale Deployments/StatefulSets/ReplicaSets, and edit and apply YAML
- **No remote dependency**: Uses your local `kubectl` and kubeconfig files

## Compatibility

Plugin **0.2.2** updates all development SDKs to **0.2.2-rc.1** for Web and Desktop. The supported host range is declared in `package.json` through `engines.dsh`:

```text
0.2.0-rc.2 || >=0.2.1-rc.1 <0.3.0-0
```

This retains the previously verified **DSH 0.2.0-rc.2** and spans both the **0.2.1-rc.1** and **0.2.2-rc.1** prerelease lines. The current target environment runs **DSH 0.2.2-rc.1**, the runtime bundled with the desktop client. DSH validates `engines.dsh` on both installation and profile startup and silently skips plugins outside that range, so this range covers 0.2.1 and 0.2.2 without an incompatible-plugin risk override. Later DSH releases still require an API and support-range review.

Plugin 0.1.0 was based on `@deepseek-ai/dsh-settings ^0.1.0-rc.8` and is only suitable for older hosts that meet its dependency requirements.

The 0.2 migration uses `dsh-client-ui-renderer` for client slots, `shell.execute()` for ordinary host commands, and DSH's `subprocess.spawnTerminal()` for interactive terminals. It no longer depends on the removed `dsh-client-runtime` or the unused `dsh-settings`.

### Changes in 0.2.2

- Fixes the plugin not loading after the desktop client upgrades to **DSH 0.2.2-rc.1**: the previous `engines.dsh` upper bound was `<0.2.2-0`, so the host compatibility check rejected it and skipped the bundle
- Extends the range to `<0.3.0-0` while keeping 0.2.0/0.2.1 support, and widens the `peerDependencies` for shell, subprocess, and host-webserver to match
- Updates development SDKs to `0.2.2-rc.1`; the host `shell`, `subprocess`, and `webServer` contracts and the client slot contract are unchanged between 0.2.1 and 0.2.2, so only the build artifacts changed
- Compatibility tests now cover `0.2.2-rc.1` and the stable `0.2.2`, and still reject `0.3.0` plus unverified releases such as 0.2.0-rc.1 and 0.2.1-alpha

### Changes in 0.2.1

- Uses the `engines.dsh` compatibility declaration supported by newer DSH releases, fixing incompatibility reports caused by the old exact SDK versions after a host upgrade
- Updates development SDKs to `0.2.1-rc.2` while continuing to use the host shell, Web server, and managed PTY

### Changes in 0.2.0

- Adds a **Kubernetes** entry below **插件** (Plugins) in the sidebar while preserving the Kubernetes conversation view
- Redesigns overview cards, resource tables, filters, details, and cluster management, including narrow-panel layouts
- Synchronizes the page and terminal with DSH's standard theme tokens, including colors and transparency
- Switches to a DSH-managed PTY, fixing the previous standalone `node-pty` `posix_spawnp failed` error and supporting input/output, terminal resizing, and cleanup on exit
- Adds compatibility, resource filtering, theme, and terminal lifecycle tests

## Installation

### Prerequisites

- DSH **0.2.2-rc.1** (recommended — the runtime bundled with the current desktop client), or a version within the `engines.dsh` range above
- `kubectl` installed locally and accessible on `PATH` to the user running DSH
- A valid kubeconfig and Kubernetes permissions to view the target resources
- Node.js **24 or later** and npm when building from source

### Desktop: Install a local directory

```bash
git clone https://github.com/MrYangyt/dsh-k8s.git
cd dsh-k8s
npm ci
npm run build
```

1. Open the DSH desktop **插件** (Plugins) management page
2. Choose installation from a local directory and select the built `dsh-k8s` project root containing `package.json`
3. Restart the client after installation, then click **Kubernetes** in the sidebar

Desktop uses its bundled DSH runtime and manages its own `desktop` profile. The global `dsh` CLI in your terminal is installed separately; updating Desktop does not update that CLI. Manage desktop plugins through the desktop client.

To update the global CLI to the version targeted by this release:

```bash
npm install -g @deepseek-ai/dsh@0.2.2-rc.1
dsh --version
```

Confirm that the output is `0.2.2-rc.1`. This updates the global CLI in your terminal and does not replace the runtime bundled with Desktop; desktop plugins always run against the client's own 0.2.2-rc.1 runtime.

### Web: Install directly from GitHub

Run `dsh --version` first and ensure the CLI runtime is within the supported range above (`0.2.2-rc.1` recommended), then install:

```bash
dsh plugin --profile web add github:MrYangyt/dsh-k8s
```

The repository includes built `lib/` and `client/` files, so installation directly from GitHub requires no manual build.

Pin to a specific commit (recommended to avoid unexpected upgrades):

```bash
dsh plugin --profile web add "github:MrYangyt/dsh-k8s#<commit-hash>"
```

### Web: Install local source

```bash
git clone https://github.com/MrYangyt/dsh-k8s.git
cd dsh-k8s
npm ci
npm run build
dsh plugin --profile web add /path/to/dsh-k8s
```

After Web installation, stop the existing Web process and start DSH again:

```bash
dsh web
```

### Upgrade an existing local installation

Update and rebuild in the project directory:

```bash
git pull --ff-only
npm ci
npm run build
```

An existing local-directory link remains valid. There is no need to uninstall the plugin or remove cluster configurations first. Restart DSH after the build; if the client still loads the old version, select this directory again in plugin management to reinstall it. Refreshing the management page alone does not reload host modules.

Upgrading from plugin 0.1.0 continues to use the existing `~/.kube/configs/` files, so clusters do not need to be added again. For a GitHub installation, run the installation command again; if you previously pinned a commit, replace it with the new commit.

## Usage

1. Restart DSH after installation
2. Click **Kubernetes** below the plugin entry in the sidebar to open the manager directly, without creating a conversation
3. Alternatively, open a conversation and use the **Kubernetes** tab (next to Chat / Trajectory)
4. Use **管理集群** (Manage clusters) to paste a kubeconfig YAML and name the cluster, then click **保存集群** (Save cluster)
5. Switch clusters via the dropdown at the top
6. Choose a resource type, filter by namespace, Pod phase, node readiness, or search text, then click a resource name to view details
7. Use **刷新** (Refresh) to reload resources manually

### Add a cluster

On first startup, the plugin scans `~/.kube/configs/`; it does not automatically import an existing `~/.kube/config`. Saving or deleting a config regenerates the main config from that directory. Back up your existing `~/.kube/config` before proceeding.

- Click **管理集群** in the top toolbar
- Enter a cluster name (e.g. `prod`, `staging`)
- Paste your kubeconfig YAML
- Click **保存集群**
- The plugin saves it to `~/.kube/configs/<name>.yaml` and merges all configs into `~/.kube/config`
- The context inside the YAML is automatically renamed to your cluster name

### Delete a cluster

- Click **管理集群** again
- In the saved configs list, click **删除** (Delete) next to the config you want to remove

Deletion removes only the local kubeconfig file, not the Kubernetes cluster. Deleting the last config leaves the generated `~/.kube/config` empty.

### Browse, filter, and modify resources

- Click an overview card to open nodes, namespaces, or Pods with the corresponding phase
- Pod phase filtering uses the actual Kubernetes `phase`. Table statuses such as `ImagePullBackOff` provide more specific information and may differ from the phase name
- Click a resource name to view **YAML** in the detail panel. Choose **编辑 YAML** (Edit YAML), make changes, then click **应用修改** (Apply changes) and confirm
- For Deployments, StatefulSets, and DaemonSets, **重启** (Restart) in the detail panel triggers a rolling restart
- For Deployments, StatefulSets, and ReplicaSets, click **扩缩容** (Scale), enter an integer from `0–10000`, and confirm
- Use **刷新** (Refresh) after an operation to retrieve the latest state; resource lists do not refresh automatically on a timer

### Pod logs and terminal

- Select a Pod, open **日志** (Logs), select a container, and click **跟随日志** (Follow logs). The latest 300 lines are read first, followed by new logs; you can stop following at any time
- Open **终端** (Terminal), select a container, and click **连接终端** (Connect terminal)
- Once the terminal is ready, you get a `/bin/sh` session inside the container through `kubectl exec -it`
- Wait until the page displays **已连接** (Connected) and the container shell prompt appears, then type commands and press Enter to execute them
- When the window or panel is resized, terminal dimensions are synchronized with the container
- Type `exit` or click **断开连接** (Disconnect) to end the session; you can reconnect afterward

The container dropdowns for logs and terminals show the Pod's regular containers; init container selection is not currently available. The terminal uses DSH 0.2's managed PTY and requires no additional native terminal dependency for this plugin. The target container must include `/bin/sh`, and your account needs `pods/exec` permission. Startup errors appear directly in the UI. Disconnecting, switching detail tabs, closing the detail panel, or unloading the plugin ends the corresponding terminal process.

### Following the DSH theme

The UI directly inherits DSH's standard CSS semantic tokens (`--dsw-alias-*`, sidebar tokens, and others), without a separate theme preference. When DSH or a theme plugin updates those tokens, text, buttons, status colors, borders, background colors and their alpha, and overlays follow automatically. The main canvas remains transparent to preserve the host background, and terminal semantic colors update dynamically.

In narrow panels, navigation scrolls horizontally, details appear over the resource view, and tables support horizontal scrolling. Theme plugins that only apply private CSS to other components, without updating standard semantic tokens, cannot be guaranteed to map their colors or transparency to this plugin.

## Safety

- Restart, Scale, and Apply YAML actions in the UI require confirmation
- Terminal commands execute directly inside the selected container without an additional plugin confirmation step
- Apply YAML shows an explicit warning: "please make sure you are operating on test resources"
- Cluster configs are saved under `~/.kube/configs/`; adding or deleting a cluster regenerates `~/.kube/config`. Back up your existing main config first

## Development

### Prerequisites

- Node.js >= 24
- pnpm or npm
- kubectl installed and available on PATH

### Build and validation

```bash
npm ci
npm run typecheck
npm test
```

`npm test` builds before running tests. Use `npm run build` when you only need to build.

Outputs:

- `lib/index.js` — host plugin (ESM)
- `lib/terminal.js` — DSH-managed PTY / WebSocket bridge
- `client/client.js` — client plugin (ModuleLoader bundle with xterm.js bundled)

### Watch mode

```bash
npm run watch
```

This command watches client source and writes to `.tsdown-output/`. It does not compile the host or generate the final `client/client.js` wrapper. Run `npm run build` and restart DSH for the installed plugin to load changes.

### Local testing

```bash
cd /path/to/dsh-k8s
npm run build
dsh plugin --profile web add /path/to/dsh-k8s
```

Then restart `dsh web`.

## Project Structure

```
dsh-k8s-manager/
├── client/
│   └── client.js          # Browser bundle (ModuleLoader)
├── lib/
│   ├── index.js           # Host plugin (ESM)
│   └── terminal.js        # Terminal bridge output
├── scripts/
│   └── build-client.mjs   # Post-build wrapper for client bundle
├── src/
│   ├── index.ts           # Host plugin source
│   ├── terminal.ts        # DSH-managed PTY / WebSocket bridge
│   └── client/
│       ├── index.tsx      # Client UI and interactions
│       ├── styles.css     # Responsive layout and host theme styles
│       ├── resources.ts   # Resource table parsing and status presentation
│       └── theme.ts       # Terminal theme synchronization
├── tests/                # Compatibility, resource, theme, and terminal tests
├── cordis.patch.yml       # DSH bundle patch
├── package.json
├── tsconfig.json          # Host TS config
├── tsconfig.client.json   # Client TS config
├── tsdown.config.ts       # Client bundler config
├── LICENSE
├── README.md
└── README.en.md
```

## How It Works

- **Host side** registers HTTP routes under `/dsh-k8s-manager/*` and a WebSocket route `/dsh-k8s-manager/ws/shell`
- **Terminal** uses `ctx.subprocess.resolveExecutable()` to locate kubectl and `spawnTerminal()` to create a managed PTY. WebSocket bridges UTF-8 input/output and terminal sizes; connection shutdown and plugin unloading wait for terminal cleanup
- **Client side** provides direct access through the `sidebar.panellist` and `main` slots, preserves the `conversation.view` tab, and inherits host theme tokens
- Cluster configs live in `~/.kube/configs/*.yaml`; the plugin merges them into `~/.kube/config` via `kubectl config view --flatten`
- All kubectl operations use `KUBECONFIG=~/.kube/configs/<name>.yaml` for stateless multi-cluster switching

## Troubleshooting

### "kubectl not found"

Install kubectl and make sure it is on your PATH.

### The page displays "添加您的第一个集群" (Add your first cluster)

The plugin has not found any configs in `~/.kube/configs/`. Click **管理集群**, paste a valid kubeconfig YAML, and click **保存集群**. An existing main config is not imported automatically.

### Installation reports incompatibility with DSH

This release declares `engines.dsh` as `0.2.0-rc.2 || >=0.2.1-rc.1 <0.3.0-0` and uses development SDKs at `0.2.2-rc.1`. If the desktop client upgraded to 0.2.2-rc.1 reports something like:

```text
dsh: installation rejected: Plugin dsh-k8s-manager@0.2.1 is incompatible with dsh 0.2.2-rc.1:
requirements {"engines.dsh":"0.2.0-rc.2 || >=0.2.1-rc.1 <0.2.2-0"}
```

the old 0.2.1 (or earlier) build is still being loaded — its `<0.2.2-0` upper bound excludes 0.2.2-rc.1. Update the project, run `npm ci && npm run build`, and restart DSH. If needed, select the local directory again in plugin management; do not remove `~/.kube/configs/`.

This release fixes that case, so a risk override is normally unnecessary. Only an older plugin build that must be loaded temporarily needs `dsh plugin allow-version`, and that exemption should be revoked once this version is installed.

If the error mentions `dsh-k8s-manager@0.1.0` or requires `@deepseek-ai/dsh-settings ^0.1.0-rc.8`, update that older plugin as well. Desktop uses its bundled runtime version; `dsh --version` reports only the CLI resolved by your current terminal.

### Installation fails a minimumReleaseAge or supply-chain policy check

This is a dependency publication-age check applied by the host profile. Inspect the rejected dependency's package name, version, and publication time in the error; it may come from another plugin in the same profile. Wait until the version meets the host's publication-age requirement before retrying, or have the profile administrator review the lockfile and relevant policies. This error does not indicate that this plugin is incompatible with DSH.

### Terminal cannot connect or accept input

Check the startup error shown in the UI. Ensure DSH can find `kubectl` on PATH, the selected Pod and container are running, and the target container includes `/bin/sh`. Also check kubeconfig connectivity and `pods/exec` permissions; PTY startup is handled by DSH's subprocess runtime.

If `[pty fallback: posix_spawnp failed.]` still appears, the old terminal implementation is being loaded. This release removes standalone `node-pty` and the non-TTY fallback path. Update, rebuild, and restart DSH; refreshing the page alone is insufficient.

## Historical UI Examples

These screenshots are from 0.1.0. For the 0.2.0 entry points, layout, and theme behavior, refer to the documentation above and the current client.

<img width="3008" height="1740" alt="0.1.0 management UI example" src="https://github.com/user-attachments/assets/16b55c36-776e-4709-afdf-99aaa2ead8b2" />
<img width="3126" height="1862" alt="0.1.0 resource detail example" src="https://github.com/user-attachments/assets/d1308392-c7ce-4adb-9db7-ff71c485dd07" />

## License

MIT

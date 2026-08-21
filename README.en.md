# dsh-k8s-manager

[中文](./README.md)

A Lens-style Kubernetes cluster manager for DeepSeek Harness (DSH). Manage your K8s clusters directly inside the DSH conversation view.
<img width="3008" height="1740" alt="image" src="https://github.com/user-attachments/assets/16b55c36-776e-4709-afdf-99aaa2ead8b2" />
<img width="3126" height="1862" alt="image" src="https://github.com/user-attachments/assets/d1308392-c7ce-4adb-9db7-ff71c485dd07" />
## Features

- **Multi-cluster management**: Add, switch, and delete multiple kubeconfigs
- **Resource browser**: Pods, Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, ReplicaSets, Services, Ingresses, Endpoints, ConfigMaps, Secrets, PVs, PVCs, StorageClasses, Nodes, Namespaces, Events
- **Namespace filtering**: Filter resources by namespace
- **Resource detail panel**: View YAML and Logs for any resource
- **Interactive Shell**: Open a real shell into any Pod (xterm.js + node-pty)
- **Write operations**: Restart Deployments/StatefulSets/DaemonSets, Scale workloads, Edit and Apply YAML
- **No remote dependency**: Uses your local `kubectl` and kubeconfig files

## Installation

### Option 2: Install directly from GitHub

```bash
dsh plugin --profile web add github:MrYangyt/dsh-k8s
```

Pin to a specific commit (recommended to avoid unexpected upgrades):

```bash
dsh plugin --profile web add "github:MrYangyt/dsh-k8s#<commit-hash>"
```

### Option 3: Local development

```bash
git clone https://github.com/MrYangyt/dsh-k8s.git
cd dsh-k8s-manager
npm install
npm run build
dsh plugin --profile web add /path/to/dsh-k8s
```

After installation, restart the DSH web process to take effect:

```bash
dsh web
```

## Usage

1. Restart DSH after installation
2. Open a conversation session
3. Click the **Kubernetes** tab in the view selector (next to Chat / Trajectory)
4. Use **Add Config** to paste a kubeconfig YAML and name the cluster
5. Switch clusters via the dropdown at the top
6. Browse resources in the left tree, click to view details
7. Use **Refresh** to reload resources manually

### Add Config

- Click **Add Config** in the top toolbar
- Enter a **Cluster config name** (e.g. `prod`, `staging`)
- Paste your kubeconfig YAML
- The plugin saves it to `~/.kube/configs/<name>.yaml` and merges all configs into `~/.kube/config`
- The context inside the YAML is automatically renamed to your cluster name

### Delete a cluster

- Click **Add Config** again
- In the saved configs list, click **Delete** next to the config you want to remove

### Pod Shell

- Select a Pod, open the **Shell** tab
- Choose a container and click **Connect**
- You get an interactive shell powered by `kubectl exec -it`

> Note: `node-pty` is used for the interactive shell. If prebuilt binaries are not available for your platform, the plugin falls back to a non-tty mode (`kubectl exec -i`). On most systems it works out of the box.

## Safety

- All write operations (Restart, Scale, Apply YAML) require confirmation
- Apply YAML shows an explicit warning: "please make sure you are operating on test resources"
- The plugin never modifies your existing `~/.kube/config` directly; it writes per-cluster files under `~/.kube/configs/` and merges them

## Development

### Prerequisites

- Node.js >= 18
- pnpm or npm
- kubectl installed and available on PATH

### Build

```bash
npm install
npm run build
```

Outputs:

- `lib/index.js` — host plugin (ESM)
- `client/client.js` — client plugin (ModuleLoader bundle with xterm.js bundled)

### Watch mode

```bash
npm run watch
```

### Local testing

```bash
cd /path/to/dsh-k8s-manager
pnpm add file:/path/to/dsh-k8s-manager --dir ~/.dsh/profiles/web
```

Then restart `dsh web`.

## Project Structure

```
dsh-k8s-manager/
├── client/
│   └── client.js          # Browser bundle (ModuleLoader)
├── lib/
│   └── index.js           # Host plugin (ESM)
├── scripts/
│   └── build-client.mjs   # Post-build wrapper for client bundle
├── src/
│   ├── index.ts           # Host plugin source
│   └── client/
│       └── index.tsx      # Client plugin source
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
- **Client side** renders a Lens-style UI inside `conversation.view`
- Cluster configs live in `~/.kube/configs/*.yaml`; the plugin merges them into `~/.kube/config` via `kubectl config view --flatten`
- All kubectl operations use `KUBECONFIG=~/.kube/configs/<name>.yaml` for stateless multi-cluster switching

## Troubleshooting

### "kubectl not found"

Install kubectl and make sure it is on your PATH.

### "No kubeconfig contexts found"

Click **Add Config** and paste a valid kubeconfig YAML.

### Interactive shell not working

If the shell connects but you cannot type, ensure `node-pty` installed correctly. On Linux you may need `make g++ python3`; on macOS Xcode Command Line Tools; on Windows Visual Studio Build Tools.

## License

MIT

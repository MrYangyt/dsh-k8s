# dsh-k8s-manager

[English](./README.en.md)

一个 Lens 风格的 Kubernetes 集群管理插件，用于 DeepSeek Harness (DSH)。在 DSH 会话视图中直接管理你的 K8s 集群。
<img width="3008" height="1740" alt="image" src="https://github.com/user-attachments/assets/16b55c36-776e-4709-afdf-99aaa2ead8b2" />
<img width="3126" height="1862" alt="image" src="https://github.com/user-attachments/assets/d1308392-c7ce-4adb-9db7-ff71c485dd07" />

## 功能特性

- **多集群管理**：添加、切换、删除多个 kubeconfig
- **资源浏览**：Pods、Deployments、StatefulSets、DaemonSets、Jobs、CronJobs、ReplicaSets、Services、Ingresses、Endpoints、ConfigMaps、Secrets、PV、PVC、StorageClasses、Nodes、Namespaces、Events
- **Namespace 筛选**：按 namespace 过滤资源列表
- **资源详情面板**：查看任意资源的 YAML 和 Logs
- **交互式 Shell**：通过 xterm.js + node-pty 进入任意 Pod 内部调试
- **写操作**：Restart Deployments/StatefulSets/DaemonSets、Scale 副本数、编辑并 Apply YAML
- **无远程依赖**：使用你本地的 `kubectl` 和 kubeconfig

## 安装

### 作为 DSH 插件安装

```bash
dsh plugin --profile web add dsh-k8s-manager
```

然后重启 DSH web 进程：

```bash
dsh web
```

### 从源码安装

```bash
git clone https://github.com/your-org/dsh-k8s-manager.git
cd dsh-k8s-manager
npm install
npm run build
```

把本地路径添加到你的 DSH profile：

```bash
dsh plugin --profile web add /path/to/dsh-k8s-manager
```

## 使用

1. 安装后重启 DSH
2. 打开一个会话
3. 在视图切换栏点击 **Kubernetes** tab（和 Chat / Trajectory 并列）
4. 点击 **Add Config** 粘贴 kubeconfig YAML 并命名集群
5. 通过顶部下拉框切换集群
6. 在左侧资源树中选择资源，点击查看详情
7. 使用 **Refresh** 手动刷新资源

### 添加配置

- 点击顶部工具栏的 **Add Config**
- 输入 **Cluster config name**（如 `prod`、`staging`）
- 粘贴 kubeconfig YAML
- 插件会把它保存到 `~/.kube/configs/<name>.yaml`，并自动把所有配置合并到 `~/.kube/config`
- YAML 中的 context 名称会自动重命名为你填的集群名字

### 删除集群

- 再次点击 **Add Config**
- 在已保存配置列表中，点击对应配置旁边的 **Delete**

### Pod Shell

- 选择一个 Pod，打开 **Shell** tab
- 选择 container 并点击 **Connect**
- 即可进入由 `kubectl exec -it` 驱动的交互式 shell

> 提示：交互式 shell 依赖 `node-pty`。如果你的平台没有预编译二进制，插件会自动降级到非 tty 模式（`kubectl exec -i`）。在大多数主流平台上可以开箱即用。

## 安全说明

- 所有写操作（Restart、Scale、Apply YAML）都需要二次确认
- Apply YAML 会明确提示：请确保你在测试资源上操作
- 插件不会直接覆盖你现有的 `~/.kube/config`，而是把每个集群配置保存到 `~/.kube/configs/` 下，再合并生成主配置

## 开发

### 环境要求

- Node.js >= 18
- pnpm 或 npm
- 本地安装并配置好 `kubectl`

### 构建

```bash
npm install
npm run build
```

构建产物：

- `lib/index.js` —— Host 插件（ESM）
- `client/client.js` —— Client 插件（ModuleLoader bundle，内含 xterm.js）

### Watch 模式

```bash
npm run watch
```

### 本地调试

```bash
cd /path/to/dsh-k8s-manager
pnpm add file:/path/to/dsh-k8s-manager --dir ~/.dsh/profiles/web
```

然后重启 `dsh web`。

## 项目结构

```
dsh-k8s-manager/
├── client/
│   └── client.js          # 浏览器端打包产物
├── lib/
│   └── index.js           # Host 插件产物（ESM）
├── scripts/
│   └── build-client.mjs   # client bundle 后处理脚本
├── src/
│   ├── index.ts           # Host 插件源码
│   └── client/
│       └── index.tsx      # Client 插件源码
├── cordis.patch.yml       # DSH bundle patch
├── package.json
├── tsconfig.json          # Host TS 配置
├── tsconfig.client.json   # Client TS 配置
├── tsdown.config.ts       # 打包配置
├── LICENSE
├── README.md
└── README.en.md
```

## 工作原理

- **Host 端**：注册 `/dsh-k8s-manager/*` HTTP 路由和 `/dsh-k8s-manager/ws/shell` WebSocket 路由
- **Client 端**：在 `conversation.view` slot 中渲染 Lens 风格界面
- 集群配置存放在 `~/.kube/configs/*.yaml`，插件通过 `kubectl config view --flatten` 合并到 `~/.kube/config`
- 所有 kubectl 操作通过 `KUBECONFIG=~/.kube/configs/<name>.yaml` 实现无状态多集群切换

## 常见问题

### "kubectl not found"

请先安装 kubectl 并确保它在 PATH 中。

### "No kubeconfig contexts found"

点击 **Add Config** 并粘贴有效的 kubeconfig YAML。

### 交互式 shell 无法输入

确保 `node-pty` 安装成功。Linux 可能需要 `make g++ python3`，macOS 需要 Xcode Command Line Tools，Windows 需要 Visual Studio Build Tools。

## License

MIT

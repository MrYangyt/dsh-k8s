# dsh-k8s-manager

[English](./README.en.md)

一个用于 DeepSeek Harness (DSH) 的 Kubernetes 集群管理插件。通过侧栏入口或会话视图管理你的 K8s 集群，界面跟随 DSH 主题。

当前版本：**0.2.0** · 已验证宿主：**DSH 0.2.0-rc.2**。

## 功能特性

- **多集群管理**：添加、切换、删除多个 kubeconfig
- **资源浏览**：Pods、Deployments、StatefulSets、DaemonSets、Jobs、CronJobs、ReplicaSets、Services、Ingresses、Endpoints、ConfigMaps、Secrets、PV、PVC、StorageClasses、Nodes、Namespaces、Events
- **资源筛选**：按命名空间、Pod 阶段、节点就绪状态或关键词筛选；概览卡片可直接打开对应资源
- **资源详情面板**：表格列清晰对齐，点击资源名称查看 YAML；Pod 支持日志和终端。窄窗口自动调整导航与详情布局
- **主题同步**：继承 DSH 的颜色、背景透明度、边框与遮罩，终端也会动态更新配色
- **交互式终端**：通过 xterm.js 与 DSH 托管 PTY 进入 Pod 容器，支持 UTF-8 输入输出和窗口尺寸同步
- **工作负载操作**：重启 Deployments/StatefulSets/DaemonSets，调整 Deployments/StatefulSets/ReplicaSets 的副本数，编辑并应用 YAML
- **无远程依赖**：使用你本地的 `kubectl` 和 kubeconfig

## 版本兼容

当前插件版本为 **0.2.0**，针对 **DSH 0.2.0-rc.2**（Web 和 Desktop）构建。DSH 预发布接口变化较快，本版明确锁定已验证的宿主版本。插件 0.1.0 基于 `@deepseek-ai/dsh-settings ^0.1.0-rc.8`，仅适用于满足其依赖要求的旧宿主。

0.2 迁移使用 `dsh-client-ui-renderer` 提供客户端插槽，普通宿主命令使用 `shell.execute()`，交互式终端使用 DSH 的 `subprocess.spawnTerminal()`；不再依赖已移除的 `dsh-client-runtime` 或未使用的 `dsh-settings`。

### 0.2.0 更新

- 新增左侧 **插件** 下方的 **Kubernetes** 入口，保留会话中的 Kubernetes 视图
- 重做概览卡片、资源表格、筛选、详情和集群管理布局，适配窄窗口
- 页面和终端动态跟随 DSH 的标准主题变量，包括颜色和透明度
- 改用 DSH 托管 PTY，修复旧独立 `node-pty` 的 `posix_spawnp failed`，支持输入输出、窗口尺寸同步及退出清理
- 补充兼容性、资源筛选、主题和终端生命周期测试

## 安装

### 准备条件

- DSH **0.2.0-rc.2**
- 本地安装 `kubectl`，并确保启动 DSH 的用户可以从 `PATH` 找到它
- 可用的 kubeconfig，以及查看目标资源的 Kubernetes 权限
- 从源码构建时需要 Node.js **24 或以上**和 npm

### 桌面客户端：安装本地目录

```bash
git clone https://github.com/MrYangyt/dsh-k8s.git
cd dsh-k8s
npm ci
npm run build
```

1. 打开 DSH 桌面客户端的 **插件** 管理页面
2. 选择从本地目录安装，选中刚构建的 `dsh-k8s` 项目根目录（包含 `package.json`）
3. 安装完成后重启客户端，点击左侧 **Kubernetes**

桌面客户端管理自己的 `desktop` profile。终端中的 npm CLI 可能使用另一版本的运行时，请通过桌面客户端管理插件。

### Web：直接从 GitHub 安装

确认 `dsh` CLI 本身使用兼容的 0.2.0-rc.2 运行时，然后安装：

```bash
dsh plugin --profile web add github:MrYangyt/dsh-k8s
```

仓库包含构建后的 `lib/` 和 `client/`，直接从 GitHub 安装无需手动构建。

锁定到某个 commit（推荐，避免意外升级）：

```bash
dsh plugin --profile web add "github:MrYangyt/dsh-k8s#<commit-hash>"
```

### Web：安装本地源码

```bash
git clone https://github.com/MrYangyt/dsh-k8s.git
cd dsh-k8s
npm ci
npm run build
dsh plugin --profile web add /path/to/dsh-k8s
```

Web 安装完成后，结束原来的 Web 进程，再启动 DSH：

```bash
dsh web
```

### 升级已有的本地安装

在项目目录中更新并重新构建：

```bash
git pull --ff-only
npm ci
npm run build
```

然后重启 DSH。若客户端仍加载旧版本，在插件管理中重新选择这个目录安装。仅刷新管理页面不会重新加载后端模块。

从插件 0.1.0 升级后，集群配置仍使用原来的 `~/.kube/configs/`，无需重新添加。GitHub 安装可重新执行安装命令；若之前锁定了 commit，请换成新 commit。

## 使用

1. 安装后重启 DSH
2. 点击左侧 **插件** 下方的 **Kubernetes** 按钮，直接打开管理页面，无需创建会话
3. 也可以打开会话，在视图切换栏点击 **Kubernetes** tab（和 Chat / Trajectory 并列）
4. 点击 **管理集群**，粘贴 kubeconfig YAML 并命名集群，然后点击 **保存集群**
5. 通过顶部下拉框切换集群
6. 在资源导航中选择类型，通过命名空间、Pod 阶段、节点状态或搜索筛选，点击资源名称查看详情
7. 使用 **刷新** 手动刷新资源

### 添加配置

首次启动会扫描 `~/.kube/configs/`，不会自动导入现有的 `~/.kube/config`。保存或删除配置会根据该目录重新生成主配置；操作前请备份已有的 `~/.kube/config`。

- 点击顶部工具栏的 **管理集群**
- 输入集群名称（如 `prod`、`staging`）
- 粘贴 kubeconfig YAML
- 点击 **保存集群**
- 插件会把它保存到 `~/.kube/configs/<name>.yaml`，并自动把所有配置合并到 `~/.kube/config`
- YAML 中的 context 名称会自动重命名为你填的集群名字

### 删除集群

- 再次点击 **管理集群**
- 在已保存配置列表中，点击对应配置旁边的 **删除**

删除只移除本地 kubeconfig 文件，不会删除 Kubernetes 集群。删除最后一个配置时，生成的 `~/.kube/config` 会变为空文件。

### 浏览、筛选与修改资源

- 点击概览卡片，可打开节点、命名空间或对应阶段的 Pod 列表
- Pod 阶段筛选使用 Kubernetes 的真实 `phase`；表格中的 `ImagePullBackOff` 等状态是更具体的展示信息，因此不一定与阶段名称相同
- 点击资源名称，在详情中查看 **YAML**；选择 **编辑 YAML**，修改后点击 **应用修改** 并确认
- Deployments、StatefulSets、DaemonSets 可通过详情中的 **重启** 触发滚动重启
- Deployments、StatefulSets、ReplicaSets 可点击 **扩缩容**，输入 `0–10000` 的整数并确认
- 操作后使用 **刷新** 获取最新状态；资源列表不会自动定时刷新

### Pod 日志与终端

- 选择一个 Pod，打开 **日志**，选择容器并点击 **跟随日志**；先读取最近 300 行，再跟随新日志，可随时停止跟随
- 打开 **终端**，选择容器并点击 **连接终端**
- 终端就绪后，通过 `kubectl exec -it` 进入容器内的 `/bin/sh`
- 等页面显示 **已连接**、容器 shell 提示符出现后输入命令，按回车执行
- 窗口或面板尺寸变化时，终端行列数会同步到容器
- 输入 `exit` 或点击 **断开连接** 结束会话；退出后可再次连接

日志和终端的容器下拉框显示 Pod 的普通容器，暂不提供 init container 选择。终端由 DSH 0.2 的托管 PTY 提供，无需为本插件另行安装终端原生依赖。目标容器必须包含 `/bin/sh`，且账号需要 `pods/exec` 权限；启动错误会直接显示在页面。断开连接、切换详情标签、关闭详情或卸载插件时，会结束对应终端进程。

### 跟随 DSH 主题

页面直接继承 DSH 的标准 CSS 语义变量（`--dsw-alias-*`、侧栏变量等），无需单独切换主题。宿主或主题插件更新这些变量时，文字、按钮、状态色、边框、背景颜色及其 alpha、遮罩会自动同步；主画布保持透明，保留宿主背景，终端也会动态同步语义配色。

窄窗口中资源导航改为横向滚动，详情覆盖显示，表格支持横向滚动。主题插件若只用私有 CSS 定向修改其他组件，没有更新标准语义变量，其配色或透明度无法保证自动映射到本插件。

## 安全说明

- 界面中的重启、扩缩容和应用 YAML 都需要二次确认
- 终端命令会直接在选中的容器中执行，没有额外的插件确认步骤
- Apply YAML 会明确提示：请确保你在测试资源上操作
- 集群配置保存到 `~/.kube/configs/`；添加或删除集群时会重新生成 `~/.kube/config`，请先备份已有主配置

## 开发

### 环境要求

- Node.js >= 24（与 DSH 0.2 桌面运行时一致）
- pnpm 或 npm
- 本地安装并配置好 `kubectl`

### 构建与验证

```bash
npm ci
npm run typecheck
npm test
```

`npm test` 会先构建再运行测试；仅构建时使用 `npm run build`。

构建产物：

- `lib/index.js` —— Host 插件（ESM）
- `lib/terminal.js` —— DSH 托管 PTY 与 WebSocket 桥接
- `client/client.js` —— Client 插件（ModuleLoader bundle，内含 xterm.js）

### Watch 模式

```bash
npm run watch
```

此命令仅监视客户端源码并输出到 `.tsdown-output/`，不会编译 Host，也不会生成最终的 `client/client.js` 包装文件。要让已安装插件加载修改，仍需执行 `npm run build` 并重启 DSH。

### 本地调试

```bash
cd /path/to/dsh-k8s
npm run build
dsh plugin --profile web add /path/to/dsh-k8s
```

然后重启 `dsh web`。

## 项目结构

```
dsh-k8s-manager/
├── client/
│   └── client.js          # 浏览器端打包产物
├── lib/
│   ├── index.js           # Host 插件产物（ESM）
│   └── terminal.js        # 终端桥接产物
├── scripts/
│   └── build-client.mjs   # client bundle 后处理脚本
├── src/
│   ├── index.ts           # Host 插件源码
│   ├── terminal.ts        # DSH 托管 PTY 与 WebSocket 桥接
│   └── client/
│       ├── index.tsx      # Client 页面与交互
│       ├── styles.css     # 响应式布局与宿主主题样式
│       ├── resources.ts   # 资源表格解析与状态显示
│       └── theme.ts       # 终端主题同步
├── tests/                # 兼容性、资源、主题与终端测试
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
- **终端**：通过 `ctx.subprocess.resolveExecutable()` 查找 kubectl，使用 `spawnTerminal()` 创建托管 PTY；WebSocket 双向传输 UTF-8 数据与窗口尺寸，连接结束和插件卸载会等待终端进程清理
- **Client 端**：通过侧栏 `sidebar.panellist` 和 `main` 插槽提供直接入口，并保留 `conversation.view` 会话视图；样式继承宿主主题变量
- 集群配置存放在 `~/.kube/configs/*.yaml`，插件通过 `kubectl config view --flatten` 合并到 `~/.kube/config`
- 所有 kubectl 操作通过 `KUBECONFIG=~/.kube/configs/<name>.yaml` 实现无状态多集群切换

## 常见问题

### "kubectl not found"

请先安装 kubectl 并确保它在 PATH 中。

### 页面显示“添加您的第一个集群”

插件尚未在 `~/.kube/configs/` 找到配置。点击 **管理集群**，粘贴有效的 kubeconfig YAML，然后点击 **保存集群**。已有主配置不会自动导入。

### 安装提示与 DSH 不兼容

本版插件要求 DSH 0.2.0-rc.2 的 shell、subprocess 和 webserver SDK。如果错误仍显示 `dsh-k8s-manager@0.1.0` 或要求 `@deepseek-ai/dsh-settings ^0.1.0-rc.8`，说明加载的是旧版本；更新项目、重新构建并重新安装项目目录，再重启 DSH。

### 安装提示 minimumReleaseAge 或供应链策略失败

这是宿主 profile 的依赖发布时间检查。根据错误中的包名、版本和发布时间检查被拒绝的依赖；它可能来自同一 profile 中的其他插件。等待该版本满足宿主的发布时间要求后再重试，或由 profile 管理者审查锁文件及对应策略。不要把此错误当作本插件与 DSH 的版本不兼容。

### 终端无法连接或输入

先查看页面显示的启动错误，确认 DSH 可以从 PATH 找到 `kubectl`、选中的 Pod 和容器正在运行，且目标容器包含 `/bin/sh`。同时检查 kubeconfig 的集群连接和 `pods/exec` 权限；PTY 启动问题由 DSH 的 subprocess 运行时处理。

若仍出现 `[pty fallback: posix_spawnp failed.]`，加载的还是旧终端实现。本版已移除独立 `node-pty` 及非 TTY 降级路径；更新并构建后重启 DSH，不能只刷新页面。

## 历史界面示例

以下截图来自 0.1.0。0.2.0 的入口、布局和主题行为以以上说明及当前客户端为准。

<img width="3008" height="1740" alt="0.1.0 管理界面示例" src="https://github.com/user-attachments/assets/16b55c36-776e-4709-afdf-99aaa2ead8b2" />
<img width="3126" height="1862" alt="0.1.0 资源详情示例" src="https://github.com/user-attachments/assets/d1308392-c7ce-4adb-9db7-ff71c485dd07" />

## License

MIT

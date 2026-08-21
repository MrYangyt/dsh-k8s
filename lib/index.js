import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let nodePty = null;
try {
    nodePty = require('node-pty');
}
catch (e) {
    console.warn('[k8s-manager] node-pty not available, falling back to spawn');
}
export const name = 'dsh-k8s-manager';
export const inject = ['shell', 'webServer'];
const KINDS = {
    pods: { ns: true }, deployments: { ns: true }, statefulsets: { ns: true },
    daemonsets: { ns: true }, jobs: { ns: true }, cronjobs: { ns: true }, replicasets: { ns: true },
    services: { ns: true }, ingresses: { ns: true }, endpoints: { ns: true },
    configmaps: { ns: true }, secrets: { ns: true },
    persistentvolumes: { ns: false }, persistentvolumeclaims: { ns: true }, storageclasses: { ns: false },
    nodes: { ns: false }, namespaces: { ns: false }, events: { ns: true },
};
const NAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._\-]*[a-zA-Z0-9])?$/;
function isName(v) {
    return typeof v === 'string' && v.length > 0 && v.length <= 253 && NAME_RE.test(v);
}
function shq(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
}
function fail(msg) {
    return { ok: false, error: msg };
}
function lastErr(r) {
    return r.stderr?.text?.slice(-500) || '';
}
class K8sService {
    shellSvc;
    configsDir;
    constructor(shellSvc, configsDir) {
        this.shellSvc = shellSvc;
        this.configsDir = configsDir;
    }
    kubeconfigPath(clusterName) {
        return path.join(this.configsDir, `${clusterName}.yaml`);
    }
    async run(command, clusterName, timeoutMs, maxBytes) {
        const kubeconfig = this.kubeconfigPath(clusterName);
        const spec = this.shellSvc.resolve({
            command: `KUBECONFIG=${shq(kubeconfig)} ${command}`,
            timeoutMs: timeoutMs || 20000,
            stdoutMaxBytes: maxBytes || 8 * 1024 * 1024,
        });
        return this.shellSvc.run(spec);
    }
    async runRaw(command, timeoutMs, maxBytes) {
        const spec = this.shellSvc.resolve({
            command,
            timeoutMs: timeoutMs || 20000,
            stdoutMaxBytes: maxBytes || 8 * 1024 * 1024,
        });
        return this.shellSvc.run(spec);
    }
    safeJson(text, path) {
        try {
            return JSON.parse(text || '{}');
        }
        catch (e) {
            if (path)
                return fail(`${path} JSON 解析失败`);
            return fail('JSON 解析失败');
        }
    }
    listConfigs() {
        try {
            if (!fs.existsSync(this.configsDir))
                return [];
            return fs.readdirSync(this.configsDir)
                .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
                .map((f) => f.replace(/\.(yaml|yml)$/, ''))
                .sort();
        }
        catch (e) {
            return [];
        }
    }
    async detect() {
        try {
            const which = await this.runRaw('command -v kubectl', 8000);
            if (which.exitCode !== 0 || !which.stdout.text.trim()) {
                return { ok: true, kubectl: false };
            }
            const configs = this.listConfigs();
            if (configs.length === 0) {
                return { ok: true, kubectl: true, kubeconfig: false, configs: [], current: '' };
            }
            const first = configs[0];
            const view = await this.run('kubectl config view -o json', first, 15000);
            if (view.exitCode !== 0) {
                return { ok: true, kubectl: true, kubeconfig: false, configs, current: first, error: lastErr(view) };
            }
            return {
                ok: true,
                kubectl: true,
                kubeconfig: true,
                configs,
                current: first,
            };
        }
        catch (e) {
            return fail(String(e?.message || e));
        }
    }
    async overview(args) {
        const clusterName = args?.context;
        if (!isName(clusterName))
            return fail('invalid cluster');
        const [nodesR, podsR, nsR, verR] = await Promise.all([
            this.run('kubectl get nodes -o json', clusterName, 20000),
            this.run('kubectl get pods -A -o json', clusterName, 30000),
            this.run('kubectl get namespaces -o json', clusterName, 15000),
            this.run('kubectl version -o json', clusterName, 15000),
        ]);
        if (nodesR.exitCode !== 0) {
            return fail('连接集群失败: ' + (lastErr(nodesR) || 'unknown'));
        }
        const nodes = this.safeJson(nodesR.stdout.text);
        const pods = this.safeJson(podsR.stdout.text);
        const ns = this.safeJson(nsR.stdout.text);
        const ver = this.safeJson(verR.stdout.text);
        const nodeItems = nodes.items || [];
        const podItems = pods.items || [];
        const nsItems = ns.items || [];
        const readyNodes = nodeItems.filter((n) => {
            const cs = (n.status && n.status.conditions) || [];
            return cs.some((x) => x.type === 'Ready' && x.status === 'True');
        }).length;
        const podStats = { Running: 0, Pending: 0, Failed: 0, Succeeded: 0, Unknown: 0 };
        podItems.forEach((p) => {
            const ph = (p.status && p.status.phase) || 'Unknown';
            podStats[ph] = (podStats[ph] || 0) + 1;
        });
        return {
            ok: true,
            nodes: { total: nodeItems.length, ready: readyNodes },
            pods: podStats,
            namespaces: nsItems.length,
            serverVersion: (ver.serverVersion && ver.serverVersion.gitVersion) || '',
        };
    }
    async list(args) {
        const { context: clusterName, kind } = args || {};
        const meta = KINDS[kind];
        if (!isName(clusterName) || !meta)
            return fail('invalid args');
        const nsFlag = meta.ns ? '-A ' : '';
        const [tableR, jsonR] = await Promise.all([
            this.run('kubectl get ' + shq(kind) + ' ' + nsFlag, clusterName, 25000),
            this.run('kubectl get ' + shq(kind) + ' ' + nsFlag + '-o json', clusterName, 30000),
        ]);
        if (tableR.exitCode !== 0) {
            return fail(lastErr(tableR) || 'kubectl get 失败');
        }
        const data = this.safeJson(jsonR.stdout.text);
        const items = (data.items || []).map((it) => ({
            name: (it.metadata && it.metadata.name) || '',
            namespace: (it.metadata && it.metadata.namespace) || '',
            created: (it.metadata && it.metadata.creationTimestamp) || '',
        }));
        return { ok: true, table: tableR.stdout.text, items };
    }
    async yaml(args) {
        const { context: clusterName, kind, namespace, name } = args || {};
        const meta = KINDS[kind];
        if (!isName(clusterName) || !meta || !isName(name))
            return fail('invalid args');
        if (meta.ns && !isName(namespace))
            return fail('invalid namespace');
        const nsFlag = meta.ns ? ' -n ' + shq(namespace) : '';
        const r = await this.run('kubectl get ' + shq(kind) + ' ' + shq(name) + nsFlag + ' -o yaml', clusterName, 20000);
        if (r.exitCode !== 0)
            return fail(lastErr(r) || '获取 YAML 失败');
        return { ok: true, yaml: r.stdout.text };
    }
    async podContainers(args) {
        const { context: clusterName, namespace, pod } = args || {};
        if (!isName(clusterName) || !isName(namespace) || !isName(pod))
            return fail('invalid args');
        const r = await this.run('kubectl get pod ' + shq(pod) + ' -n ' + shq(namespace) + ' -o json', clusterName, 15000);
        if (r.exitCode !== 0)
            return fail(lastErr(r) || '获取 Pod 失败');
        const data = this.safeJson(r.stdout.text);
        const names = (arr) => (arr || []).map((x) => x.name).filter(Boolean);
        return {
            ok: true,
            containers: names(data.spec && data.spec.containers),
            initContainers: names(data.spec && data.spec.initContainers),
        };
    }
    async logsStart(args) {
        const { context: clusterName, namespace, pod, container } = args || {};
        if (!isName(clusterName) || !isName(namespace) || !isName(pod))
            return fail('invalid args');
        if (container !== undefined && container !== '' && !isName(container))
            return fail('invalid container');
        let cmd = 'kubectl logs ' + shq(pod) + ' -n ' + shq(namespace) + ' --tail=300 -f';
        if (container)
            cmd += ' -c ' + shq(container);
        const spec = this.shellSvc.resolve({
            command: `KUBECONFIG=${shq(this.kubeconfigPath(clusterName))} ${cmd}`,
            stdoutMaxBytes: 2 * 1024 * 1024,
        });
        const proc = this.shellSvc.start(spec);
        return { ok: true, proc };
    }
    async restart(args) {
        const { context: clusterName, kind, namespace, name } = args || {};
        if (!isName(clusterName) || !isName(namespace) || !isName(name) || !KINDS[kind])
            return fail('invalid args');
        const validKinds = ['deployments', 'statefulsets', 'daemonsets', 'replicasets'];
        if (!validKinds.includes(kind))
            return fail('restart not supported for ' + kind);
        const cmd = 'kubectl rollout restart ' + shq(kind) + '/' + shq(name) + ' -n ' + shq(namespace);
        const r = await this.run(cmd, clusterName, 30000);
        if (r.exitCode !== 0)
            return fail(lastErr(r) || 'restart failed');
        return { ok: true, message: r.stdout.text.trim() || 'restarted' };
    }
    async scale(args) {
        const { context: clusterName, kind, namespace, name, replicas } = args || {};
        if (!isName(clusterName) || !isName(namespace) || !isName(name) || !KINDS[kind])
            return fail('invalid args');
        const validKinds = ['deployments', 'statefulsets', 'replicasets'];
        if (!validKinds.includes(kind))
            return fail('scale not supported for ' + kind);
        const n = Number(replicas);
        if (!Number.isInteger(n) || n < 0 || n > 10000)
            return fail('invalid replicas');
        const cmd = 'kubectl scale ' + shq(kind) + '/' + shq(name) + ' -n ' + shq(namespace) + ' --replicas=' + n;
        const r = await this.run(cmd, clusterName, 30000);
        if (r.exitCode !== 0)
            return fail(lastErr(r) || 'scale failed');
        return { ok: true, message: r.stdout.text.trim() || 'scaled' };
    }
    async apply(args) {
        const { context: clusterName, yaml } = args || {};
        if (!isName(clusterName) || !yaml)
            return fail('invalid args');
        const tmp = path.join(os.tmpdir(), 'k8s-apply-' + Date.now() + '.yaml');
        try {
            fs.writeFileSync(tmp, String(yaml));
            const r = await this.run('kubectl apply -f ' + shq(tmp), clusterName, 30000);
            fs.unlinkSync(tmp);
            if (r.exitCode !== 0)
                return fail(lastErr(r) || 'apply failed');
            return { ok: true, message: r.stdout.text.trim() || 'applied' };
        }
        catch (e) {
            try {
                fs.unlinkSync(tmp);
            }
            catch (e2) { }
            return fail(e?.message || String(e));
        }
    }
    async exec(args) {
        const { context: clusterName, namespace, pod, container, command } = args || {};
        if (!isName(clusterName) || !isName(namespace) || !isName(pod) || !command)
            return fail('invalid args');
        let cmd = 'kubectl exec ' + shq(pod) + ' -n ' + shq(namespace);
        if (container)
            cmd += ' -c ' + shq(container);
        cmd += ' -- ' + command;
        const r = await this.run(cmd, clusterName, 30000);
        if (r.exitCode !== 0)
            return fail(lastErr(r) || 'exec failed');
        return { ok: true, stdout: r.stdout.text, stderr: r.stderr.text };
    }
    readLog(proc) {
        const read = proc.readOutput();
        return { ok: true, delta: read.delta, lossy: read.lossy, status: proc.status };
    }
    stopLog(proc) {
        try {
            proc.kill();
        }
        catch (e) { }
        return { ok: true };
    }
}
export function apply(ctx) {
    const shell = ctx.get('shell');
    const webServer = ctx.get('webServer');
    if (!shell || !webServer) {
        console.error('[k8s-manager] shell or webServer unavailable');
        return;
    }
    const kubeDir = path.join(os.homedir(), '.kube');
    const configsDir = path.join(kubeDir, 'configs');
    const mergedPath = path.join(kubeDir, 'config');
    function listConfigFiles() {
        try {
            if (!fs.existsSync(configsDir))
                return [];
            return fs.readdirSync(configsDir)
                .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
                .sort();
        }
        catch (e) {
            return [];
        }
    }
    async function mergeKubeconfigs() {
        try {
            fs.mkdirSync(configsDir, { recursive: true });
            const files = listConfigFiles();
            if (files.length === 0) {
                fs.writeFileSync(mergedPath, '', { mode: 0o600 });
                return { ok: true };
            }
            const kubeconfig = files.map((f) => path.join(configsDir, f)).join(':');
            const r = await shell.run(shell.resolve({
                command: `KUBECONFIG=${shq(kubeconfig)} kubectl config view --flatten > ${shq(mergedPath)}`,
                timeoutMs: 15000,
            }));
            if (r.exitCode !== 0)
                return { ok: false, error: lastErr(r) || 'merge failed' };
            return { ok: true };
        }
        catch (e) {
            return { ok: false, error: e?.message || String(e) };
        }
    }
    const k8s = new K8sService(shell, configsDir);
    const logSessions = new Map();
    let logSeq = 0;
    const sendJson = (res, status, body) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(body));
    };
    const readBody = (req) => new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    const parseBody = async (req) => {
        try {
            return JSON.parse((await readBody(req)) || '{}');
        }
        catch (e) {
            return {};
        }
    };
    const routes = [
        {
            kind: 'exact',
            path: '/dsh-k8s-manager/detect',
            handler: async (req, res) => {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed' });
                sendJson(res, 200, await k8s.detect());
            },
        },
        {
            kind: 'exact',
            path: '/dsh-k8s-manager/save-kubeconfig',
            handler: async (req, res) => {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed' });
                const body = await parseBody(req);
                const yaml = String(body.yaml || '');
                const name = String(body.name || '').trim() || 'cluster';
                if (!yaml.includes('apiVersion') || !yaml.includes('kind')) {
                    return sendJson(res, 200, { ok: false, error: 'invalid kubeconfig yaml' });
                }
                try {
                    fs.mkdirSync(configsDir, { recursive: true });
                    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
                    const filePath = path.join(configsDir, `${safeName}.yaml`);
                    fs.writeFileSync(filePath, yaml, { mode: 0o600 });
                    const currentCtxR = await shell.run(shell.resolve({
                        command: `KUBECONFIG=${shq(filePath)} kubectl config current-context`,
                        timeoutMs: 10000,
                    }));
                    if (currentCtxR.exitCode === 0) {
                        const currentCtx = currentCtxR.stdout.text.trim();
                        if (currentCtx && currentCtx !== safeName) {
                            await shell.run(shell.resolve({
                                command: `KUBECONFIG=${shq(filePath)} kubectl config rename-context ${shq(currentCtx)} ${shq(safeName)} && KUBECONFIG=${shq(filePath)} kubectl config use-context ${shq(safeName)}`,
                                timeoutMs: 10000,
                            }));
                        }
                    }
                    const merged = await mergeKubeconfigs();
                    if (!merged.ok)
                        return sendJson(res, 200, { ok: false, error: merged.error });
                    return sendJson(res, 200, { ok: true, name: safeName, path: filePath });
                }
                catch (e) {
                    return sendJson(res, 200, { ok: false, error: e?.message || String(e) });
                }
            },
        },
        {
            kind: 'exact',
            path: '/dsh-k8s-manager/list-kubeconfigs',
            handler: async (req, res) => {
                if (req.method !== 'POST' && req.method !== 'GET')
                    return sendJson(res, 405, { error: 'method not allowed' });
                sendJson(res, 200, { ok: true, configs: listConfigFiles() });
            },
        },
        {
            kind: 'exact',
            path: '/dsh-k8s-manager/delete-kubeconfig',
            handler: async (req, res) => {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed' });
                const body = await parseBody(req);
                const name = String(body.name || '').trim();
                if (!name)
                    return sendJson(res, 200, { ok: false, error: 'name required' });
                try {
                    const filePath = path.join(configsDir, name);
                    if (fs.existsSync(filePath))
                        fs.unlinkSync(filePath);
                    const merged = await mergeKubeconfigs();
                    if (!merged.ok)
                        return sendJson(res, 200, { ok: false, error: merged.error });
                    return sendJson(res, 200, { ok: true });
                }
                catch (e) {
                    return sendJson(res, 200, { ok: false, error: e?.message || String(e) });
                }
            },
        },
        {
            kind: 'exact',
            path: '/dsh-k8s-manager/overview',
            handler: async (req, res) => {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed' });
                sendJson(res, 200, await k8s.overview(await parseBody(req)));
            },
        },
        {
            kind: 'exact',
            path: '/dsh-k8s-manager/list',
            handler: async (req, res) => {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed' });
                sendJson(res, 200, await k8s.list(await parseBody(req)));
            },
        },
        {
            kind: 'exact',
            path: '/dsh-k8s-manager/yaml',
            handler: async (req, res) => {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed' });
                sendJson(res, 200, await k8s.yaml(await parseBody(req)));
            },
        },
        {
            kind: 'exact',
            path: '/dsh-k8s-manager/pod-containers',
            handler: async (req, res) => {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed' });
                sendJson(res, 200, await k8s.podContainers(await parseBody(req)));
            },
        },
        {
            kind: 'exact',
            path: '/dsh-k8s-manager/restart',
            handler: async (req, res) => {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed' });
                sendJson(res, 200, await k8s.restart(await parseBody(req)));
            },
        },
        {
            kind: 'exact',
            path: '/dsh-k8s-manager/scale',
            handler: async (req, res) => {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed' });
                sendJson(res, 200, await k8s.scale(await parseBody(req)));
            },
        },
        {
            kind: 'exact',
            path: '/dsh-k8s-manager/apply',
            handler: async (req, res) => {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed' });
                sendJson(res, 200, await k8s.apply(await parseBody(req)));
            },
        },
        {
            kind: 'exact',
            path: '/dsh-k8s-manager/exec',
            handler: async (req, res) => {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed' });
                sendJson(res, 200, await k8s.exec(await parseBody(req)));
            },
        },
        {
            kind: 'exact',
            path: '/dsh-k8s-manager/logs/start',
            handler: async (req, res) => {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed' });
                const r = await k8s.logsStart(await parseBody(req));
                if (!r.ok)
                    return sendJson(res, 200, r);
                const id = 'log-' + (++logSeq);
                logSessions.set(id, { proc: r.proc });
                sendJson(res, 200, { ok: true, sessionId: id });
            },
        },
        {
            kind: 'exact',
            path: '/dsh-k8s-manager/logs/poll',
            handler: async (req, res) => {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed' });
                const body = await parseBody(req);
                const session = body?.sessionId && logSessions.get(body.sessionId);
                if (!session)
                    return sendJson(res, 200, { ok: false, error: 'no such log session' });
                sendJson(res, 200, k8s.readLog(session.proc));
            },
        },
        {
            kind: 'exact',
            path: '/dsh-k8s-manager/logs/stop',
            handler: async (req, res) => {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed' });
                const body = await parseBody(req);
                const session = body?.sessionId && logSessions.get(body.sessionId);
                if (session) {
                    k8s.stopLog(session.proc);
                    logSessions.delete(body.sessionId);
                }
                sendJson(res, 200, { ok: true });
            },
        },
    ];
    const disposers = routes.map((r) => webServer.register(r));
    const wss = new WebSocketServer({ noServer: true });
    disposers.push(ctx.effect(() => ctx.webServer.registerUpgrade({
        path: '/dsh-k8s-manager/ws/shell',
        handler: (req, socket, head) => {
            wss.handleUpgrade(req, socket, head, (ws) => {
                const url = new URL(req.url, 'http://dsh.internal');
                const clusterName = String(url.searchParams.get('cluster') || '');
                const namespace = String(url.searchParams.get('namespace') || '');
                const pod = String(url.searchParams.get('pod') || '');
                const container = String(url.searchParams.get('container') || '');
                if (!isName(clusterName) || !isName(namespace) || !isName(pod)) {
                    ws.close(1008, 'invalid params');
                    return;
                }
                const kubeconfig = path.join(configsDir, `${clusterName}.yaml`);
                ws.send(`[k8s-manager] connected, starting shell in ${namespace}/${pod}\r\n`);
                console.log(`[k8s-manager] shell ws started for ${namespace}/${pod}/${container}`);
                let ptyProc = null;
                if (nodePty) {
                    try {
                        const args = ['exec', '-it', pod, '-n', namespace];
                        if (container)
                            args.push('-c', container);
                        args.push('--', '/bin/sh');
                        ptyProc = nodePty.spawn('kubectl', args, {
                            name: 'xterm-256color',
                            cols: 80,
                            rows: 24,
                            cwd: process.cwd(),
                            env: { ...process.env, KUBECONFIG: kubeconfig },
                        });
                        ptyProc.onData((data) => {
                            if (ws.readyState === 1)
                                ws.send(data);
                        });
                        ptyProc.onExit((exit) => {
                            setTimeout(() => { if (ws.readyState === 1)
                                ws.close(1000, `exit ${exit.exitCode}`); }, 500);
                        });
                        ws.on('message', (data) => {
                            const text = typeof data === 'string' ? data : data.toString('utf8');
                            try {
                                if (ptyProc) {
                                    ptyProc.write(text);
                                }
                            }
                            catch (e) { }
                        });
                        ws.on('close', () => {
                            try {
                                if (ptyProc)
                                    ptyProc.kill();
                            }
                            catch (e) { }
                        });
                        return;
                    }
                    catch (e) {
                        ws.send('[pty fallback: ' + (e?.message || String(e)) + ']\r\n');
                    }
                }
                const args = ['exec', '-i', pod, '-n', namespace];
                if (container)
                    args.push('-c', container);
                args.push('--', '/bin/sh');
                const proc = spawn('kubectl', args, {
                    env: { ...process.env, KUBECONFIG: kubeconfig },
                });
                proc.stdout.on('data', (data) => {
                    if (ws.readyState === 1)
                        ws.send(data);
                });
                proc.stderr.on('data', (data) => {
                    if (ws.readyState === 1)
                        ws.send(data);
                });
                proc.on('error', (err) => {
                    if (ws.readyState === 1)
                        ws.send('[spawn error: ' + err.message + ']');
                });
                proc.on('close', (code) => {
                    setTimeout(() => { if (ws.readyState === 1)
                        ws.close(1000, `exit ${code}`); }, 500);
                });
                ws.on('message', (data) => {
                    if (proc.stdin.writable)
                        proc.stdin.write(data);
                });
                ws.on('close', () => {
                    try {
                        proc.kill();
                    }
                    catch (e) { }
                });
            });
        },
    })), 'k8s-manager.ws');
    ctx.effect(() => () => {
        disposers.forEach((d) => d && d());
        wss.close();
    }, 'k8s-manager.routes');
}

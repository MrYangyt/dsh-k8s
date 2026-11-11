import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import semver from 'semver'
import { apply } from '../lib/index.js'
import manifest from '../package.json' with { type: 'json' }

function harness(stdoutForCommand = () => '/usr/bin/kubectl\n', resultForCommand = null) {
  const routes = new Map()
  const upgrades = new Map()
  const effects = []
  const executions = []
  const shell = {
    resolve: request => request,
    async execute(spec) {
      let killed = false
      const proc = {
        status: 'running',
        readOutput: () => ({ delta: 'pod output', lossy: false }),
        kill: () => { killed = true; proc.status = 'killed' },
        result: async () => resultForCommand
          ? resultForCommand(spec.command)
          : ({ exitCode: 0, stdout: { text: stdoutForCommand(spec.command) }, stderr: { text: '' } }),
        get killed() { return killed },
      }
      executions.push({ spec, proc })
      return proc
    },
  }
  const webServer = {
    register(route) {
      assert.equal(routes.has(route.path), false)
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
    registerUpgrade(route) {
      upgrades.set(route.path, route)
      return () => upgrades.delete(route.path)
    },
  }
  const ctx = {
    shell,
    get: key => ({ shell, webServer, subprocess: {} })[key],
    effect: fn => { const dispose = fn(); effects.push(dispose); return dispose },
  }
  apply(ctx)
  return {
    routes, upgrades, executions,
    dispose: () => effects.reverse().forEach(dispose => dispose()),
    async call(path, body = {}) {
      const req = Readable.from([Buffer.from(JSON.stringify(body))])
      req.method = 'POST'
      let result
      const res = { setHeader() {}, end: text => { result = JSON.parse(text) } }
      await routes.get('/dsh-k8s-manager/' + path).handler(req, res)
      return result
    },
  }
}

const dshPeers = ['@deepseek-ai/dsh-shell', '@deepseek-ai/dsh-subprocess', '@deepseek-ai/dsh-host-webserver']

test('manifest declares host compatibility and builds against the current desktop SDK', () => {
  assert.equal(manifest.version, '0.2.2')
  assert.ok(semver.validRange(manifest.engines.dsh))
  for (const name of [...dshPeers, '@deepseek-ai/dsh-client-ui-renderer']) {
    assert.equal(manifest.devDependencies[name], '0.2.2-rc.1')
    assert.equal(manifest.dependencies[name], undefined)
  }
  assert.equal(manifest.dependencies['node-pty'], undefined)
  assert.deepEqual(manifest.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-renderer'])
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-settings'], undefined)
})

test('host and SDK peer ranges accept the supported desktop releases without exemptions', () => {
  // 0.2.2-rc.1 是当前桌面客户端的运行时；升级客户端后不再需要版本豁免。
  for (const version of ['0.2.0-rc.2', '0.2.1-rc.1', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1', '0.2.2-rc.1', '0.2.2']) {
    assert.ok(semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true }), version)
    // Older hosts use SDK peers; npm also needs explicit prerelease comparators.
    for (const name of dshPeers) {
      assert.ok(semver.satisfies(version, manifest.peerDependencies[name], { includePrerelease: true }), `${name}: ${version}`)
    }
  }
})

test('compatibility declarations still reject releases outside the supported API line', () => {
  for (const version of ['0.1.0-rc.8', '0.2.0-rc.1', '0.2.1-alpha.5', '0.2.1-rc.0', '0.3.0-0', '0.3.0-rc.1', '1.0.0']) {
    assert.equal(semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true }), false, version)
    for (const name of dshPeers) {
      assert.equal(semver.satisfies(version, manifest.peerDependencies[name], { includePrerelease: true }), false, `${name}: ${version}`)
    }
  }
})

test('foreground commands use asynchronous execute().result()', async () => {
  const host = harness()
  try {
    assert.equal((await host.call('detect')).kubectl, true)
    assert.equal(host.executions[0].spec.command, 'command -v kubectl')
  } finally { host.dispose() }
  assert.equal(host.routes.size, 0)
  assert.equal(host.upgrades.size, 0)
})

test('Pod 列表保留真实 phase，避免用展示状态误筛概览卡片', async () => {
  const table = `NAMESPACE   NAME          READY   STATUS             RESTARTS   AGE
prod        pending-api   0/1     ImagePullBackOff   0          3m
prod        crash-api     0/1     CrashLoopBackOff   5          9m\n`
  const created = '2026-10-01T00:00:00Z'
  const pods = {
    items: [
      { metadata: { name: 'pending-api', namespace: 'prod', creationTimestamp: created }, status: { phase: 'Pending', containerStatuses: [{ state: { waiting: { reason: 'ImagePullBackOff' } } }] } },
      { metadata: { name: 'crash-api', namespace: 'prod', creationTimestamp: created }, status: { phase: 'Running', containerStatuses: [{ state: { waiting: { reason: 'CrashLoopBackOff' } } }] } },
    ],
  }
  const host = harness(command => /-o json$/.test(command) ? JSON.stringify(pods) : table)
  try {
    const result = await host.call('list', { context: 'test', kind: 'pods' })
    assert.equal(result.ok, true)
    assert.equal(result.table, table)
    assert.deepEqual(result.items, [
      { name: 'pending-api', namespace: 'prod', created, phase: 'Pending' },
      { name: 'crash-api', namespace: 'prod', created, phase: 'Running' },
    ])
    assert.equal(host.executions.length, 2)
    assert.ok(host.executions.every(({ spec }) => /kubectl get 'pods' -A/.test(spec.command)))
  } finally { host.dispose() }
})

test('节点列表按 Ready condition 判定就绪，不把 NotReady 误识别为 Ready', async () => {
  const table = `NAME         STATUS                     ROLES    AGE   VERSION
ready-node   Ready,SchedulingDisabled   <none>   20d   v1.34.0
bad-node     NotReady                   <none>   20d   v1.34.0
unknown      Unknown                    <none>   20d   v1.34.0
new-node     Unknown                    <none>   1m    v1.34.0\n`
  const nodes = {
    items: [
      { metadata: { name: 'ready-node' }, status: { conditions: [{ type: 'MemoryPressure', status: 'False' }, { type: 'Ready', status: 'True' }] } },
      { metadata: { name: 'bad-node' }, status: { conditions: [{ type: 'MemoryPressure', status: 'True' }, { type: 'Ready', status: 'False' }] } },
      { metadata: { name: 'unknown' }, status: { conditions: [{ type: 'Ready', status: 'Unknown' }] } },
      { metadata: { name: 'new-node' } },
    ],
  }
  const host = harness(command => /-o json$/.test(command) ? JSON.stringify(nodes) : table)
  try {
    const result = await host.call('list', { context: 'test', kind: 'nodes' })
    assert.equal(result.ok, true)
    assert.equal(result.table, table)
    assert.deepEqual(result.items, [
      { name: 'ready-node', namespace: '', created: '', ready: true },
      { name: 'bad-node', namespace: '', created: '', ready: false },
      { name: 'unknown', namespace: '', created: '', ready: false },
      { name: 'new-node', namespace: '', created: '', ready: false },
    ])
  } finally { host.dispose() }
})

const forbidden = text => ({ exitCode: 1, stdout: { text: '' }, stderr: { text: `Error from server (Forbidden): ${text} at the cluster scope` } })
const ok = text => ({ exitCode: 0, stdout: { text }, stderr: { text: '' } })

test('命名空间级权限：-A 被拒绝时回退到 context 默认命名空间', async () => {
  const table = `NAME       READY   STATUS    RESTARTS   AGE
api-abc    1/1     Running   0          5m\n`
  const pods = { items: [{ metadata: { name: 'api-abc', namespace: 'team-a', creationTimestamp: '' }, status: { phase: 'Running' } }] }
  const host = harness(undefined, command => {
    if (/kubectl get 'pods' -A/.test(command)) return forbidden('pods is forbidden: User "dev" cannot list resource "pods" in API group ""')
    if (/config view --minify/.test(command)) return ok('team-a\n')
    return ok(/-o json$/.test(command) ? JSON.stringify(pods) : table)
  })
  try {
    const result = await host.call('list', { context: 'test', kind: 'pods' })
    assert.equal(result.ok, true)
    assert.equal(result.scope, 'namespace')
    assert.equal(result.namespace, 'team-a')
    assert.deepEqual(result.items, [{ name: 'api-abc', namespace: 'team-a', created: '', phase: 'Running' }])
    assert.ok(host.executions.some(({ spec }) => /kubectl get 'pods' -n 'team-a' -o json$/.test(spec.command)))
  } finally { host.dispose() }
})

test('命名空间级权限且 context 未设置 namespace 时给出可操作的提示', async () => {
  const host = harness(undefined, command => /-A\b/.test(command)
    ? forbidden('pods is forbidden')
    : ok(''))
  try {
    const result = await host.call('list', { context: 'test', kind: 'pods' })
    assert.equal(result.ok, false)
    assert.match(result.error, /context 未设置 namespace/)
  } finally { host.dispose() }
})

test('集群级读取被拒绝时概览仍可用，节点数按 Pod 分布推算', async () => {
  const pods = { items: [
    { metadata: { name: 'a', namespace: 'team-a' }, spec: { nodeName: 'node-1' }, status: { phase: 'Running' } },
    { metadata: { name: 'b', namespace: 'team-a' }, spec: { nodeName: 'node-1' }, status: { phase: 'Running' } },
    { metadata: { name: 'c', namespace: 'team-a' }, spec: { nodeName: 'node-2' }, status: { phase: 'Pending' } },
  ] }
  const host = harness(undefined, command => {
    if (/kubectl get nodes|kubectl get namespaces|kubectl get pods -A/.test(command)) return forbidden('cannot list resource')
    if (/config view --minify/.test(command)) return ok('team-a\n')
    if (/kubectl version/.test(command)) return ok(JSON.stringify({ serverVersion: { gitVersion: 'v1.32.9' } }))
    return ok(JSON.stringify(pods))
  })
  try {
    const result = await host.call('overview', { context: 'test' })
    assert.equal(result.ok, true)
    assert.equal(result.scope, 'namespace')
    assert.equal(result.namespace, 'team-a')
    assert.deepEqual(result.nodes, { total: 2, ready: 2, derived: true })
    assert.equal(result.namespaces, 1)
    assert.equal(result.pods.Running, 2)
    assert.equal(result.pods.Pending, 1)
    assert.equal(result.serverVersion, 'v1.32.9')
  } finally { host.dispose() }
})

test('集群级权限正常时概览仍使用真实节点与命名空间数据', async () => {
  const nodes = { items: [
    { metadata: { name: 'node-1' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } },
    { metadata: { name: 'node-2' }, status: { conditions: [{ type: 'Ready', status: 'False' }] } },
  ] }
  const namespaces = { items: [{ metadata: { name: 'default' } }, { metadata: { name: 'team-a' } }] }
  const pods = { items: [{ metadata: { name: 'a', namespace: 'team-a' }, spec: { nodeName: 'node-1' }, status: { phase: 'Running' } }] }
  const host = harness(undefined, command => {
    if (/kubectl get nodes/.test(command)) return ok(JSON.stringify(nodes))
    if (/kubectl get namespaces/.test(command)) return ok(JSON.stringify(namespaces))
    if (/kubectl version/.test(command)) return ok(JSON.stringify({ serverVersion: { gitVersion: 'v1.32.9' } }))
    return ok(JSON.stringify(pods))
  })
  try {
    const result = await host.call('overview', { context: 'test' })
    assert.equal(result.ok, true)
    assert.equal(result.scope, 'cluster')
    assert.deepEqual(result.nodes, { total: 2, ready: 1, derived: false })
    assert.equal(result.namespaces, 2)
  } finally { host.dispose() }
})

test('log follow has no expiry, supports polling and stops on unload', async () => {
  const host = harness()
  const { sessionId } = await host.call('logs/start', { context: 'test', namespace: 'default', pod: 'pod' })
  assert.ok(sessionId)
  assert.equal(host.executions[0].spec.onExpiry, 'none')
  assert.equal((await host.call('logs/poll', { sessionId })).delta, 'pod output')
  host.dispose()
  assert.equal(host.executions[0].proc.killed, true)
  assert.equal(host.routes.size, 0)
})

test('invalid log arguments never spawn a process', async () => {
  const host = harness()
  try {
    assert.equal((await host.call('logs/start', { context: '../escape' })).ok, false)
    assert.equal(host.executions.length, 0)
  } finally { host.dispose() }
})

test('built client registers through slots and removes styles on unload', async () => {
  const { readFileSync } = await import('node:fs')
  const { runInNewContext } = await import('node:vm')
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const styles = []
  let client
  const document = {
    createElement: () => ({ remove() { styles.splice(styles.indexOf(this), 1) } }),
    head: { appendChild: style => styles.push(style) },
  }
  runInNewContext(readFileSync(new URL('../client/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: ({ id, factory }) => {
      assert.equal(id, 'dsh-k8s-manager')
      client = factory(require)
    } } },
    document, console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    navigator: { platform: "MacIntel", userAgent: "Macintosh", language: "zh-CN" },
  })
  assert.deepEqual(Array.from(client.inject), ['slots'])
  const effects = []
  const registrations = new Map()
  client.apply({
    get: () => ({
      inject(key, callback) {
        assert.ok(['main', 'sidebar.panellist', 'conversation.view'].includes(key))
        effects.push(callback())
      },
      register(options, component) {
        assert.equal(options.key ?? options.id, 'k8s-manager')
        registrations.set(options.name, { options, component })
        return () => { registrations.delete(options.name) }
      },
    }),
    effect: fn => { effects.push(fn()) },
  })
  assert.deepEqual([...registrations.keys()], ['main', 'sidebar.panellist', 'conversation.view'])
  const sidebar = registrations.get('sidebar.panellist')
  assert.equal(sidebar.options.label, 'Kubernetes')
  assert.equal(sidebar.options.order, 1)
  assert.equal(registrations.get('main').options.key, sidebar.options.id)
  assert.equal(sidebar.component({ size: 18 }).props.width, 18)
  const count = styles.length
  effects.reverse().forEach(dispose => dispose())
  assert.equal(registrations.size, 0)
  assert.equal(count, 1)
  assert.equal(styles.length, 0)
})

import * as React from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

export const inject = ['timer']

async function call(method: string, args?: any): Promise<any> {
  const res = await fetch('/dsh-k8s-manager/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || res.statusText || 'request failed')
  }
  return res.json()
}

interface DetailState {
  kind: string
  name: string
  namespace: string
  tab: 'yaml' | 'logs'
  yaml: string
  yamlLoading: boolean
  yamlError: string
}

interface StoreState {
  open: boolean
  boot: 'idle' | 'loading' | 'no-kubectl' | 'no-contexts' | 'error' | 'ready'
  bootError: string
  configs: string[]
  current: string
  view: string
  overview: any
  overviewLoading: boolean
  overviewError: string
  table: string
  items: { name: string; namespace: string; created: string }[]
  tableLoading: boolean
  tableError: string
  filter: string
  nsFilter: string
  detail: DetailState | null
}

const TREE = [
  { group: 'Overview', items: [['overview', 'Overview']] },
  { group: 'Cluster', items: [['nodes', 'Nodes'], ['namespaces', 'Namespaces'], ['events', 'Events']] },
  { group: 'Workloads', items: [['pods', 'Pods'], ['deployments', 'Deployments'], ['statefulsets', 'StatefulSets'], ['daemonsets', 'DaemonSets'], ['jobs', 'Jobs'], ['cronjobs', 'CronJobs'], ['replicasets', 'ReplicaSets']] },
  { group: 'Network', items: [['services', 'Services'], ['ingresses', 'Ingresses'], ['endpoints', 'Endpoints']] },
  { group: 'Config', items: [['configmaps', 'ConfigMaps'], ['secrets', 'Secrets']] },
  { group: 'Storage', items: [['persistentvolumes', 'PVs'], ['persistentvolumeclaims', 'PVCs'], ['storageclasses', 'StorageClasses']] },
]

const KIND_LABEL: Record<string, string> = {
  overview: 'Overview', pods: 'Pods', deployments: 'Deployments', statefulsets: 'StatefulSets',
  daemonsets: 'DaemonSets', jobs: 'Jobs', cronjobs: 'CronJobs', replicasets: 'ReplicaSets',
  services: 'Services', ingresses: 'Ingresses', endpoints: 'Endpoints',
  configmaps: 'ConfigMaps', secrets: 'Secrets', persistentvolumes: 'PVs',
  persistentvolumeclaims: 'PVCs', storageclasses: 'StorageClasses', nodes: 'Nodes',
  namespaces: 'Namespaces', events: 'Events',
}

const listeners = new Set<() => void>()
const state: StoreState = {
  open: false,
  boot: 'idle',
  bootError: '',
  configs: [],
  current: '',
  view: 'overview',
  overview: null,
  overviewLoading: false,
  overviewError: '',
  table: '',
  items: [],
  tableLoading: false,
  tableError: '',
  filter: '',
  nsFilter: 'all',
  detail: null,
}

function set(patch: Partial<StoreState>) {
  Object.assign(state, patch)
  listeners.forEach((f) => f())
}

function useStore(): StoreState {
  const [, tick] = React.useState(0)
  React.useEffect(() => {
    const fn = () => tick((x) => x + 1)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  return state
}


async function boot() {
  if (state.boot === 'loading') return
  set({ boot: 'loading', bootError: '' })
  try {
    const r = await call('detect')
    if (!r.ok) { set({ boot: 'error', bootError: r.error || 'unknown' }); return }
    if (!r.kubectl) { set({ boot: 'no-kubectl' }); return }
    if (!r.configs || r.configs.length === 0) { set({ boot: 'no-contexts' }); return }
    set({ boot: 'ready', configs: r.configs, current: r.current || r.configs[0] })
    loadOverview()
  } catch (e: any) {
    set({ boot: 'error', bootError: e?.message || String(e) })
  }
}

async function loadOverview() {
  set({ overviewLoading: true, overviewError: '', view: 'overview', detail: null, nsFilter: 'all' })
  try {
    const r = await call('overview', { context: state.current })
    if (!r.ok) { set({ overviewLoading: false, overviewError: r.error }); return }
    set({ overviewLoading: false, overview: r })
  } catch (e: any) {
    set({ overviewLoading: false, overviewError: e?.message || String(e) })
  }
}

async function loadKind(kind: string) {
  set({ tableLoading: true, tableError: '', view: kind, detail: null, filter: '', nsFilter: 'all', table: '', items: [] })
  try {
    const r = await call('list', { context: state.current, kind })
    if (!r.ok) { set({ tableLoading: false, tableError: r.error, table: '', items: [] }); return }
    set({ tableLoading: false, table: r.table || '', items: r.items || [] })
  } catch (e: any) {
    set({ tableLoading: false, tableError: e?.message || String(e), table: '', items: [] })
  }
}

async function loadDetail(kind: string, idx: number) {
  const it = state.items[idx]
  if (!it) return
  const d: DetailState = { kind, name: it.name, namespace: it.namespace, tab: 'yaml', yaml: '', yamlLoading: true, yamlError: '' }
  set({ detail: d })
  try {
    const r = await call('yaml', { context: state.current, kind, namespace: it.namespace, name: it.name })
    if (!r.ok) {
      set({ detail: { ...d, yamlLoading: false, yamlError: r.error || 'failed' } })
    } else {
      set({ detail: { ...d, yamlLoading: false, yaml: r.yaml } })
    }
  } catch (e: any) {
    set({ detail: { ...d, yamlLoading: false, yamlError: e?.message || String(e) } })
  }
}

const icon = (t: string) => React.createElement('span', { className: 'k8s-icon' }, t)

function OverviewView() {
  const s = useStore()
  if (s.overviewLoading || !s.overview) {
    return React.createElement('div', { className: 'k8s-empty' }, 'Loading overview…')
  }
  if (s.overviewError) return React.createElement('div', { className: 'k8s-empty k8s-error' }, s.overviewError)
  const ov = s.overview || {}
  const podStats = ov.pods || {}
  const cards = [
    { value: (ov.nodes || {}).total || 0, label: 'Nodes', color: '' },
    { value: (ov.nodes || {}).ready || 0, label: 'Ready Nodes', color: 'k8s-status-ok' },
    { value: podStats.Running || 0, label: 'Running Pods', color: 'k8s-status-ok' },
    { value: podStats.Pending || 0, label: 'Pending Pods', color: 'k8s-status-warn' },
    { value: podStats.Failed || 0, label: 'Failed Pods', color: 'k8s-status-err' },
    { value: ov.namespaces || 0, label: 'Namespaces', color: '' },
  ]
  return React.createElement('div', { className: 'k8s-content' },
    React.createElement('div', { className: 'k8s-title' }, 'Cluster Overview'),
    React.createElement('div', { className: 'k8s-stat-grid' }, cards.map((c, i) =>
      React.createElement('div', { key: i, className: 'k8s-stat-card' },
        React.createElement('div', { className: 'k8s-stat-value ' + (c.color || '') }, String(c.value)),
        React.createElement('div', { className: 'k8s-stat-label' }, c.label)
      )
    )),
    ov.serverVersion ? React.createElement('div', { className: 'k8s-stat-label' }, 'Server version: ', ov.serverVersion) : null
  )
}

function ResourceTable({ ctx }: { ctx: any }) {
  const s = useStore()

  if (s.tableLoading && !s.table) return React.createElement('div', { className: 'k8s-empty' }, 'Loading…')
  if (s.tableError) return React.createElement('div', { className: 'k8s-empty k8s-error' }, s.tableError)
  const rows = (s.table || '').split('\n').filter((l) => l.trim())
  const allNamespaces = ['all', ...Array.from(new Set(s.items.map((it) => it.namespace).filter(Boolean)))]
  const activeNsFilter = allNamespaces.includes(s.nsFilter) ? s.nsFilter : 'all'
  const filteredRows = rows.slice(1).map((r, i) => ({ text: r, idx: i }))
    .filter((row) => {
      if (activeNsFilter === 'all') return true
      const item = s.items[row.idx]
      return item && item.namespace === activeNsFilter
    })
    .filter((row) => !s.filter || row.text.toLowerCase().includes(s.filter.toLowerCase()))
  const header = rows[0] || ''
  return React.createElement('div', { className: 'k8s-content' },
    React.createElement('div', { style: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' } },
      React.createElement('span', { className: 'k8s-title' }, KIND_LABEL[s.view] || s.view),
      React.createElement('select', {
        className: 'k8s-select-small', value: activeNsFilter,
        onChange: (e: any) => set({ nsFilter: e.target.value })
      }, allNamespaces.map((ns) => React.createElement('option', { key: ns, value: ns }, ns === 'all' ? 'All namespaces' : ns))),
      React.createElement('input', {
        className: 'k8s-filter', placeholder: 'Filter rows…',
        value: s.filter, onChange: (e: any) => set({ filter: e.target.value })
      })
    ),
    React.createElement('div', { className: 'k8s-table-wrap' },
      React.createElement('div', { className: 'k8s-table-header' }, header),
      React.createElement('div', { className: 'k8s-table-rows' },
        React.createElement('pre', { className: 'k8s-table' },
          filteredRows.map((row) =>
            React.createElement('div', {
              key: row.idx,
              className: 'k8s-row ' + (s.detail && s.items[row.idx] && s.detail.name === s.items[row.idx].name ? 'active' : ''),
              onClick: () => loadDetail(s.view, row.idx)
            }, row.text)
          )
        )
      )
    )
  )
}

const SCALABLE = ['deployments', 'statefulsets', 'replicasets']
const RESTARTABLE = ['deployments', 'statefulsets', 'daemonsets', 'replicasets']

function DetailDrawer() {
  const s = useStore()
  if (!s.detail) return null
  const d = s.detail
  const tabs: ('yaml' | 'logs' | 'shell')[] = ['yaml']
  if (d.kind === 'pods') { tabs.push('logs'); tabs.push('shell') }

  async function onRestart() {
    if (!confirm(`确认重启 ${d.kind}/${d.name} in ${d.namespace || 'default'}?`)) return
    try {
      const r = await call('restart', { context: state.current, kind: d.kind, namespace: d.namespace || 'default', name: d.name })
      alert(r.ok ? '重启已触发' : '失败: ' + (r.error || 'unknown'))
    } catch (e: any) {
      alert('重启失败: ' + (e?.message || String(e)))
    }
  }

  async function onScale() {
    const input = prompt(`调整 ${d.kind}/${d.name} 副本数 (0-10000):`, '1')
    if (input === null) return
    const replicas = Number(input)
    if (!Number.isInteger(replicas) || replicas < 0 || replicas > 10000) {
      alert('副本数必须是 0-10000 的整数')
      return
    }
    if (!confirm(`确认将 ${d.kind}/${d.name} 副本数调整为 ${replicas}?`)) return
    try {
      const r = await call('scale', { context: state.current, kind: d.kind, namespace: d.namespace || 'default', name: d.name, replicas })
      alert(r.ok ? '扩缩容已触发' : '失败: ' + (r.error || 'unknown'))
    } catch (e: any) {
      alert('扩缩容失败: ' + (e?.message || String(e)))
    }
  }

  return React.createElement('div', { className: 'k8s-detail' },
    React.createElement('div', { className: 'k8s-detail-head' },
      React.createElement('div', null,
        React.createElement('div', { className: 'k8s-title' }, d.name),
        React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, d.namespace || 'cluster-scoped'),
        React.createElement('div', { className: 'k8s-tabs' }, tabs.map((t) =>
          React.createElement('div', {
            key: t, className: 'k8s-tab ' + (d.tab === t ? 'active' : ''),
            onClick: () => set({ detail: { ...d, tab: t } })
          }, t)
        ))
      ),
      React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        RESTARTABLE.includes(d.kind) ? React.createElement('button', { className: 'k8s-btn k8s-btn-warn', onClick: onRestart }, 'Restart') : null,
        SCALABLE.includes(d.kind) ? React.createElement('button', { className: 'k8s-btn', onClick: onScale }, 'Scale') : null,
        React.createElement('button', { className: 'k8s-btn', onClick: () => set({ detail: null }) }, '×')
      )
    ),
    React.createElement('div', { className: 'k8s-detail-body' },
      d.tab === 'yaml' ? React.createElement(YamlTab, d) : (d.tab === 'shell' ? React.createElement(ShellTab, d) : React.createElement(LogsTab, d))
    )
  )
}

function YamlTab(d: DetailState) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(d.yaml || '')
  const [applying, setApplying] = React.useState(false)

  React.useEffect(() => {
    if (!editing) setDraft(d.yaml || '')
  }, [d.yaml, editing])

  if (d.yamlLoading) return React.createElement('div', { className: 'k8s-empty' }, 'Loading YAML…')
  if (d.yamlError) return React.createElement('div', { className: 'k8s-empty k8s-error' }, d.yamlError)

  async function onApply() {
    if (!confirm('确认应用修改后的 YAML? 请确保你在测试资源上操作。')) return
    setApplying(true)
    try {
      const r = await call('apply', { context: state.current, yaml: draft })
      if (r.ok) {
        alert('Apply 成功')
        setEditing(false)
      } else {
        alert('Apply 失败: ' + (r.error || 'unknown'))
      }
    } catch (e: any) {
      alert('Apply 失败: ' + (e?.message || String(e)))
    }
    setApplying(false)
  }

  return React.createElement('div', { className: 'k8s-detail-panel' },
    React.createElement('div', { className: 'k8s-log-controls' },
      editing ?
        React.createElement(React.Fragment, null,
          React.createElement('button', { className: 'k8s-btn', onClick: () => setEditing(false), disabled: applying }, 'Cancel'),
          React.createElement('button', { className: 'k8s-btn k8s-btn-primary', onClick: onApply, disabled: applying }, applying ? 'Applying…' : 'Apply')
        ) :
        React.createElement('button', { className: 'k8s-btn', onClick: () => setEditing(true) }, 'Edit YAML')
    ),
    editing ?
      React.createElement('div', { className: 'k8s-detail-scroll' },
        React.createElement('textarea', {
          className: 'k8s-textarea',
          style: { height: '100%' },
          value: draft,
          onChange: (e: any) => setDraft(e.target.value),
          disabled: applying,
        })
      ) :
      React.createElement('div', { className: 'k8s-detail-scroll' },
        React.createElement('pre', { className: 'k8s-pre' }, d.yaml || '')
      )
  )
}

function LogsTab(d: DetailState) {
  const [containers, setContainers] = React.useState<string[]>([])
  const [container, setContainer] = React.useState('')
  const [lines, setLines] = React.useState('')
  const [following, setFollowing] = React.useState(false)
  const [error, setError] = React.useState('')
  const [sessionId, setSessionId] = React.useState<string | null>(null)

  React.useEffect(() => {
    let alive = true
    call('pod-containers', { context: state.current, namespace: d.namespace, pod: d.name }).then((r: any) => {
      if (!alive) return
      if (!r.ok) { setError(r.error || ''); return }
      const c = r.containers || []
      setContainers(c)
      if (c.length) setContainer(c[0])
    })
    return () => { alive = false }
  }, [d.name, d.namespace])

  React.useEffect(() => {
    if (!following || !sessionId) return
    const iv = setInterval(() => {
      call('logs/poll', { sessionId }).then((r: any) => {
        if (r.ok && r.delta) {
          setLines((prev) => prev + r.delta)
        }
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [following, sessionId])

  async function startFollow() {
    setError('')
    try {
      const r = await call('logs/start', {
        context: state.current,
        namespace: d.namespace,
        pod: d.name,
        container,
      })
      if (!r.ok) { setError(r.error || 'failed'); return }
      setSessionId(r.sessionId)
      setFollowing(true)
      setLines('')
    } catch (e: any) {
      setError(e?.message || String(e))
    }
  }

  async function stopFollow() {
    if (sessionId) {
      try { await call('logs/stop', { sessionId }) } catch (e) {}
    }
    setFollowing(false)
    setSessionId(null)
  }

  return React.createElement('div', { className: 'k8s-detail-panel' },
    React.createElement('div', { className: 'k8s-log-controls' },
      React.createElement('select', {
        className: 'k8s-select-small', value: container,
        onChange: (e: any) => { setContainer(e.target.value); setLines('') }
      }, containers.map((c) => React.createElement('option', { key: c, value: c }, c))),
      React.createElement('button', {
        className: 'k8s-btn ' + (following ? 'k8s-btn-primary' : ''),
        onClick: following ? stopFollow : startFollow
      }, following ? 'Stop' : 'Follow'),
      error ? React.createElement('span', { className: 'k8s-error', style: { fontSize: 12 } }, error) : null
    ),
    React.createElement('div', { className: 'k8s-detail-scroll' },
      React.createElement('pre', { className: 'k8s-logs' }, lines || 'No logs yet.')
    )
  )
}

function ShellTab(d: DetailState) {
  const [containers, setContainers] = React.useState<string[]>([])
  const [container, setContainer] = React.useState('')
  const [error, setError] = React.useState('')
  const [connected, setConnected] = React.useState(false)
  const termRef = React.useRef<HTMLDivElement>(null)
  const wsRef = React.useRef<WebSocket | null>(null)

  React.useEffect(() => {
    let alive = true
    call('pod-containers', { context: state.current, namespace: d.namespace, pod: d.name }).then((r: any) => {
      if (!alive) return
      if (!r.ok) { setError(r.error || ''); return }
      const c = r.containers || []
      setContainers(c)
      if (c.length) setContainer(c[0])
    })
    return () => { alive = false }
  }, [d.name, d.namespace])

  async function connect() {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setError('')
    if (!termRef.current) return
    // Mount xterm into a manually created child so React won't clear it on re-render.
    const mount = document.createElement('div')
    mount.style.width = '100%'
    mount.style.height = '100%'
    mount.style.minHeight = '240px'
    mount.style.outline = 'none'
    mount.tabIndex = 0
    termRef.current.appendChild(mount)
    const term = new Terminal({ fontSize: 13, cursorBlink: true, theme: { background: '#000000', foreground: '#e0e0e0' } })
    term.open(mount)
    term.write('Connecting...\r\n')
    term.focus()
    mount.addEventListener('click', () => term.focus())
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${proto}//${window.location.host}/dsh-k8s-manager/ws/shell?` +
      `cluster=${encodeURIComponent(state.current)}` +
      `&namespace=${encodeURIComponent(d.namespace)}` +
      `&pod=${encodeURIComponent(d.name)}` +
      `&container=${encodeURIComponent(container)}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    ws.onopen = () => { setConnected(true); term.focus() }
    ws.onmessage = (e) => { term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data)) }
    ws.onclose = (e: any) => { setConnected(false); term.write(`\r\n[disconnected ${e.code}]`) }
    ws.onerror = (e: any) => { setError('WebSocket error: ' + (e?.message || 'unknown')); setConnected(false) }
    term.onData((data: string) => { if (ws.readyState === 1) ws.send(data) })
  }

  React.useEffect(() => {
    return () => { if (wsRef.current) { wsRef.current.close(); wsRef.current = null } }
  }, [])

  return React.createElement('div', { className: 'k8s-detail-panel' },
    React.createElement('div', { className: 'k8s-log-controls' },
      React.createElement('select', {
        className: 'k8s-select-small', value: container,
        onChange: (e: any) => setContainer(e.target.value)
      }, containers.map((c) => React.createElement('option', { key: c, value: c }, c))),
      React.createElement('button', { className: 'k8s-btn k8s-btn-primary', onClick: connect, disabled: connected }, connected ? 'Connected' : 'Connect'),
      error ? React.createElement('span', { className: 'k8s-error', style: { fontSize: 12 } }, error) : null
    ),
    React.createElement('div', {
      ref: termRef,
      className: 'k8s-detail-scroll',
      style: { background: '#000000', padding: 8 }
    })
  )
}

function Workbench({ ctx }: { ctx: any }) {
  const s = useStore()
  const [showInput, setShowInput] = React.useState(false)
  const [yaml, setYaml] = React.useState('')
  const [clusterName, setClusterName] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [configs, setConfigs] = React.useState<string[]>([])

  function loadConfigs() {
    call('list-kubeconfigs').then((r: any) => {
      if (r.ok) setConfigs(r.configs || [])
    })
  }

  React.useEffect(() => {
    loadConfigs()
  }, [])

  function onContextChange(e: any) {
    set({ current: e.target.value, overview: null, table: '', items: [], detail: null })
    if (s.view === 'overview') loadOverview()
    else loadKind(s.view)
  }

  async function saveKubeconfig() {
    if (!yaml.trim()) return
    const name = (clusterName.trim() || 'cluster').replace(/[^a-zA-Z0-9._-]/g, '_')
    setSaving(true)
    try {
      const r = await call('save-kubeconfig', { name, yaml: yaml.trim() })
      if (!r.ok) {
        alert('保存失败: ' + (r.error || 'unknown'))
      } else {
        setShowInput(false)
        setYaml('')
        setClusterName('')
        loadConfigs()
        boot()
      }
    } catch (e: any) {
      alert('保存失败: ' + (e?.message || String(e)))
    }
    setSaving(false)
  }

  async function deleteConfig(name: string) {
    if (!confirm(`确认删除集群配置 ${name} ?`)) return
    try {
      const r = await call('delete-kubeconfig', { name })
      if (r.ok) {
        loadConfigs()
        boot()
      } else {
        alert('删除失败: ' + (r.error || 'unknown'))
      }
    } catch (e: any) {
      alert('删除失败: ' + (e?.message || String(e)))
    }
  }

  return React.createElement('div', { className: 'k8s-view' },
    React.createElement('div', { className: 'k8s-topbar' },
      React.createElement('span', { className: 'k8s-title' }, icon('☸'), 'Kubernetes'),
      React.createElement('select', { className: 'k8s-select', value: s.current, onChange: onContextChange },
        s.configs.map((c) => React.createElement('option', { key: c, value: c }, c))
      ),
      React.createElement('button', { className: 'k8s-btn', onClick: () => { if (s.view === 'overview') loadOverview(); else loadKind(s.view) } }, 'Refresh'),
      React.createElement('button', { className: 'k8s-btn', onClick: () => setShowInput(true) }, 'Add Config')
    ),
    showInput ? React.createElement('div', { className: 'k8s-config-overlay' },
      React.createElement('div', { className: 'k8s-config-area', style: { maxHeight: '85vh' } },
        React.createElement('div', { className: 'k8s-title' }, 'Add Kubernetes Cluster'),
        React.createElement('input', {
          className: 'k8s-filter',
          style: { maxWidth: '100%' },
          placeholder: 'Cluster config name (e.g. cluster-a)',
          value: clusterName,
          onChange: (e: any) => setClusterName(e.target.value),
          disabled: saving,
        }),
        React.createElement('textarea', {
          className: 'k8s-textarea',
          style: { minHeight: 240 },
          value: yaml,
          onChange: (e: any) => setYaml(e.target.value),
          placeholder: 'apiVersion: v1\nkind: Config\n...',
          disabled: saving,
        }),
        configs.length > 0 ? React.createElement('div', { className: 'k8s-config-list' },
          React.createElement('div', { className: 'k8s-title', style: { fontSize: 13 } }, 'Saved configs'),
          configs.map((name) => React.createElement('div', {
            key: name,
            className: 'k8s-config-item',
          },
            React.createElement('span', null, name),
            React.createElement('button', { className: 'k8s-btn k8s-btn-warn', onClick: () => deleteConfig(name) }, 'Delete')
          ))
        ) : null,
        React.createElement('div', { className: 'k8s-config-actions' },
          React.createElement('button', { className: 'k8s-btn', onClick: () => setShowInput(false), disabled: saving }, 'Cancel'),
          React.createElement('button', { className: 'k8s-btn k8s-btn-primary', onClick: saveKubeconfig, disabled: saving }, saving ? 'Saving…' : 'Save')
        )
      )
    ) : null,
    React.createElement('div', { className: 'k8s-body' },
      React.createElement('div', { className: 'k8s-sidebar' },
        TREE.map((g) =>
          React.createElement('div', { key: g.group },
            React.createElement('div', { className: 'k8s-tree-group' }, g.group),
            g.items.map(([key, label]) =>
              React.createElement('div', {
                key,
                className: 'k8s-tree-item ' + (s.view === key ? 'active' : ''),
                onClick: () => key === 'overview' ? loadOverview() : loadKind(key)
              }, label as string)
            )
          )
        )
      ),
      s.boot === 'no-kubectl' ? React.createElement('div', { className: 'k8s-main' },
        React.createElement('div', { className: 'k8s-empty' },
          React.createElement('div', null, 'kubectl not found'),
          React.createElement('div', { style: { fontSize: 13, maxWidth: 460, textAlign: 'center', lineHeight: 1.5 } }, 'Please install kubectl and make sure it is on PATH. This plugin uses your local kubectl + kubeconfig.')
        )
      ) : null,
      s.boot === 'no-contexts' ? React.createElement('div', { className: 'k8s-main' }, React.createElement('div', { className: 'k8s-empty k8s-error' }, 'No kubeconfig contexts found. Please run kubectl config use-context or set KUBECONFIG.')) : null,
      s.boot === 'error' ? React.createElement('div', { className: 'k8s-main' }, React.createElement('div', { className: 'k8s-empty k8s-error' }, s.bootError || 'Unknown error')) : null,
      (s.boot === 'loading' || s.boot === 'idle') ? React.createElement('div', { className: 'k8s-main' }, React.createElement('div', { className: 'k8s-empty' }, s.boot === 'loading' ? 'Connecting to Kubernetes…' : 'Initializing…')) : null,
      s.boot === 'ready' ? React.createElement('div', { className: 'k8s-main' }, s.view === 'overview' ? React.createElement(OverviewView) : React.createElement(ResourceTable, { ctx })) : null,
      s.detail ? React.createElement(DetailDrawer) : null
    )
  )
}

export function apply(ctx: any) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  const css = `
    .k8s-view { display:flex; flex-direction:column; height:100%; max-height:calc(100vh - 100px); min-height:0; width:100%; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); overflow:hidden; }
    .k8s-topbar { display:flex; align-items:center; gap:12px; padding:10px 16px; border-bottom:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); }
    .k8s-body { display:flex; flex:1; min-height:0; overflow:hidden; }
    .k8s-sidebar { width:240px; flex:0 0 240px; overflow:auto; border-right:1px solid var(--dsw-alias-border-l1); background:var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1)); padding:12px 8px; }
    .k8s-main { flex:1; min-width:0; display:flex; flex-direction:column; overflow:hidden; }
    .k8s-content { flex:1; display:flex; flex-direction:column; overflow:hidden; padding:16px; }
    .k8s-detail { width:45%; max-width:600px; flex:0 0 45%; height:100%; border-left:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); overflow:hidden; box-sizing:border-box; display:flex; flex-direction:column; }
    .k8s-detail-head { flex:0 0 auto; }
    .k8s-detail-body { flex:1; min-height:0; overflow:hidden; display:flex; flex-direction:column; }
    .k8s-detail-panel { display:flex; flex-direction:column; flex:1; min-height:0; }
    .k8s-detail-scroll { flex:1; min-height:0; overflow:auto; }
    .k8s-title { font-weight:600; font-size:15px; display:flex; align-items:center; gap:8px; }
    .k8s-select { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); border:1px solid var(--dsw-alias-border-l2); border-radius:5px; padding:4px 8px; font-size:13px; max-width:260px; }
    .k8s-btn { padding:5px 10px; border-radius:5px; border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); cursor:pointer; font-size:12px; }
    .k8s-btn:hover { background:var(--dsw-alias-interactive-bg-hover); }
    .k8s-btn-primary { background:var(--dsw-alias-brand-primary); border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-label-primary-inverted, #fff); }
    .k8s-btn-warn { background:var(--dsw-alias-state-error-primary); border-color:var(--dsw-alias-state-error-primary); color:var(--dsw-alias-label-primary-inverted, #fff); }
    .k8s-tree-group { font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--dsw-alias-label-secondary); margin:12px 8px 6px; font-weight:600; }
    .k8s-tree-item { padding:5px 10px 5px 16px; border-radius:5px; cursor:pointer; font-size:13px; color:var(--dsw-alias-label-primary); }
    .k8s-tree-item:hover { background:var(--dsw-alias-interactive-bg-hover); }
    .k8s-tree-item.active { background:var(--dsw-specific-sidebar-nav-item-active, var(--dsw-alias-interactive-bg-active)); color:var(--dsw-alias-brand-primary); }
    .k8s-stat-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(180px,1fr)); gap:12px; margin-bottom:16px; }
    .k8s-stat-card { background:var(--dsw-alias-bg-layer-2); border:1px solid var(--dsw-alias-border-l1); border-radius:8px; padding:14px; }
    .k8s-stat-value { font-size:22px; font-weight:600; }
    .k8s-stat-label { font-size:12px; color:var(--dsw-alias-label-secondary); margin-top:4px; }
    .k8s-table-wrap { background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:8px; display:flex; flex-direction:column; flex:1; overflow:hidden; }
    .k8s-table-header { font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:12px; line-height:1.6; font-weight:600; padding:12px 12px 8px; border-bottom:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-2); white-space:pre; }
    .k8s-table-rows { flex:1; overflow:auto; padding:8px 0; }
    .k8s-table { font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:12px; line-height:1.6; margin:0; white-space:pre; padding:0 12px; color:var(--dsw-alias-label-primary); }
    .k8s-row { cursor:pointer; }
    .k8s-row:hover { background:var(--dsw-alias-interactive-bg-hover); }
    .k8s-row.active { background:var(--dsw-alias-interactive-bg-active); }
    .k8s-filter { width:100%; max-width:360px; padding:6px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:5px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font-size:13px; }
    .k8s-detail-head { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2); }
    .k8s-tabs { display:flex; gap:8px; margin-top:8px; }
    .k8s-tab { padding:3px 10px; border-radius:4px; cursor:pointer; font-size:12px; color:var(--dsw-alias-label-secondary); }
    .k8s-tab.active { background:var(--dsw-alias-bg-layer-3); color:var(--dsw-alias-label-primary); }
    .k8s-pre { font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:12px; line-height:1.5; padding:12px; white-space:pre-wrap; overflow-wrap:anywhere; }
    .k8s-empty { display:flex; align-items:center; justify-content:center; height:100%; color:var(--dsw-alias-label-dimmed); flex-direction:column; gap:12px; }
    .k8s-error { color:var(--dsw-alias-state-error-primary); }
    .k8s-log-wrap { display:flex; flex-direction:column-reverse; height:100%; overflow:auto; padding:12px; }
    .k8s-logs { font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:12px; line-height:1.5; white-space:pre-wrap; color:var(--dsw-alias-label-primary); }
    .k8s-log-controls { display:flex; gap:8px; align-items:center; padding:12px 16px; border-bottom:1px solid var(--dsw-alias-border-l1); }
    .k8s-select-small { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); border:1px solid var(--dsw-alias-border-l2); border-radius:4px; padding:3px 6px; font-size:12px; }
    .k8s-status-ok { color:var(--dsw-alias-state-success-primary); }
    .k8s-status-warn { color:var(--dsw-alias-state-warn-primary); }
    .k8s-status-err { color:var(--dsw-alias-state-error-primary); }
    .k8s-config-overlay { position:fixed; inset:0; z-index:1000; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; padding:20px; }
    .k8s-config-area { width:100%; max-width:720px; max-height:80vh; display:flex; flex-direction:column; gap:12px; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:12px; padding:16px; box-shadow:0 10px 30px rgba(0,0,0,0.2); }
    .k8s-textarea { width:100%; flex:1; min-height:300px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:12px; line-height:1.5; padding:12px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); resize:vertical; }
    .k8s-config-actions { display:flex; justify-content:flex-end; gap:8px; }
    .k8s-config-list { display:flex; flex-direction:column; gap:8px; max-height:160px; overflow:auto; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; padding:8px; background:var(--dsw-alias-bg-layer-2); }
    .k8s-config-item { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 8px; border-radius:5px; font-size:13px; }
    .k8s-config-item:hover { background:var(--dsw-alias-interactive-bg-hover); }
  `
  const styleEl = document.createElement('style')
  styleEl.textContent = css
  document.head.appendChild(styleEl)

  function K8sView() {
    React.useEffect(() => {
      if (state.boot === 'idle') boot()
    }, [])
    return React.createElement(Workbench, { ctx })
  }

  slots.inject('conversation.view', () => slots.register(
    { name: 'conversation.view', id: 'k8s-manager', label: 'Kubernetes', order: 10 },
    () => React.createElement(K8sView)
  ))
}

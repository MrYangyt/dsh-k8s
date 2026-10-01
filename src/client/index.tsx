import * as React from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { parseResourceTable, statusTone } from './resources.js'
import { watchTerminalTheme } from './theme.js'
import { FitAddon } from '@xterm/addon-fit'

export const inject = ['slots']
const PANEL_ID = 'k8s-manager'

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
  tab: 'yaml' | 'logs' | 'shell'
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
  items: { name: string; namespace: string; created: string; phase?: string; ready?: boolean }[]
  tableLoading: boolean
  tableError: string
  filter: string
  nsFilter: string
  statusFilter: string
  detail: DetailState | null
}

const TREE = [
  { group: '集群概览', items: [['overview', '集群概览']] },
  { group: '集群', items: [['nodes', 'Nodes'], ['namespaces', 'Namespaces'], ['events', 'Events']] },
  { group: '工作负载', items: [['pods', 'Pods'], ['deployments', 'Deployments'], ['statefulsets', 'StatefulSets'], ['daemonsets', 'DaemonSets'], ['jobs', 'Jobs'], ['cronjobs', 'CronJobs'], ['replicasets', 'ReplicaSets']] },
  { group: '网络', items: [['services', 'Services'], ['ingresses', 'Ingresses'], ['endpoints', 'Endpoints']] },
  { group: '配置', items: [['configmaps', 'ConfigMaps'], ['secrets', 'Secrets']] },
  { group: '存储', items: [['persistentvolumes', 'PVs'], ['persistentvolumeclaims', 'PVCs'], ['storageclasses', 'StorageClasses']] },
]

const KIND_LABEL: Record<string, string> = {
  overview: '集群概览', pods: 'Pods', deployments: 'Deployments', statefulsets: 'StatefulSets',
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
  statusFilter: 'all',
  detail: null,
}

let viewRequest = 0
let detailRequest = 0

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
  ++viewRequest
  ++detailRequest
  set({ boot: 'loading', bootError: '', overviewLoading: false, tableLoading: false, detail: null })
  try {
    const r = await call('detect')
    if (!r.ok) { set({ boot: 'error', bootError: r.error || 'unknown' }); return }
    if (!r.kubectl) { set({ boot: 'no-kubectl' }); return }
    if (!r.configs || r.configs.length === 0) { set({ boot: 'no-contexts', configs: [], current: '', detail: null }); return }
    set({ boot: 'ready', configs: r.configs, current: r.configs.includes(state.current) ? state.current : r.current || r.configs[0] })
    loadOverview()
  } catch (e: any) {
    set({ boot: 'error', bootError: e?.message || String(e) })
  }
}

async function loadOverview() {
  const context = state.current
  const request = ++viewRequest
  ++detailRequest
  set({ overviewLoading: true, tableLoading: false, overviewError: '', view: 'overview', detail: null, filter: '', nsFilter: 'all', statusFilter: 'all' })
  try {
    const r = await call('overview', { context })
    if (viewRequest !== request || state.current !== context) return
    if (!r.ok) { set({ overviewLoading: false, overviewError: r.error }); return }
    set({ overviewLoading: false, overview: r })
  } catch (e: any) {
    if (viewRequest === request && state.current === context) set({ overviewLoading: false, overviewError: e?.message || String(e) })
  }
}

async function loadKind(kind: string, statusFilter = 'all', preserveFilters = false) {
  const context = state.current
  const request = ++viewRequest
  ++detailRequest
  set({ tableLoading: true, overviewLoading: false, tableError: '', view: kind, detail: null, filter: preserveFilters ? state.filter : '', nsFilter: preserveFilters ? state.nsFilter : 'all', statusFilter, table: '', items: [] })
  try {
    const r = await call('list', { context, kind })
    if (viewRequest !== request || state.current !== context) return
    if (!r.ok) { set({ tableLoading: false, tableError: r.error, table: '', items: [] }); return }
    set({ tableLoading: false, table: r.table || '', items: r.items || [] })
  } catch (e: any) {
    if (viewRequest === request && state.current === context) set({ tableLoading: false, tableError: e?.message || String(e), table: '', items: [] })
  }
}

async function loadDetail(kind: string, idx: number) {
  const it = state.items[idx]
  if (!it) return
  const context = state.current
  const request = ++detailRequest
  const d: DetailState = { kind, name: it.name, namespace: it.namespace, tab: 'yaml', yaml: '', yamlLoading: true, yamlError: '' }
  set({ detail: d })
  try {
    const r = await call('yaml', { context, kind, namespace: it.namespace, name: it.name })
    if (state.current !== context || detailRequest !== request || !state.detail) return
    if (!r.ok) {
      set({ detail: { ...state.detail, yamlLoading: false, yamlError: r.error || 'failed' } })
    } else {
      set({ detail: { ...state.detail, yamlLoading: false, yaml: r.yaml } })
    }
  } catch (e: any) {
    if (state.current === context && detailRequest === request && state.detail) set({ detail: { ...state.detail, yamlLoading: false, yamlError: e?.message || String(e) } })
  }
}

const icon = (t: string) => React.createElement('span', { className: 'k8s-icon' }, t)

function EmptyState({ title, hint, error = false, retry }: { title: string; hint?: string; error?: boolean; retry?: () => void }) {
  return React.createElement('div', { className: 'k8s-empty', role: error ? 'alert' : 'status' },
    React.createElement('div', { className: 'k8s-empty-title' + (error ? ' k8s-error' : '') }, title),
    hint && React.createElement('div', { className: 'k8s-empty-hint' }, hint),
    retry && React.createElement('button', { className: 'k8s-btn', onClick: retry }, '重新加载')
  )
}

function OverviewView() {
  const s = useStore()
  if (s.overviewError) return React.createElement(EmptyState, { title: '无法读取集群概览', hint: s.overviewError, error: true, retry: loadOverview })
  if (s.overviewLoading || !s.overview) return React.createElement(EmptyState, { title: '正在读取集群状态…' })
  const ov = s.overview
  const pods = ov.pods || {}
  const cards = [
    { value: ov.nodes?.total || 0, label: '节点总数', hint: '查看集群节点', kind: 'nodes', filter: 'all', tone: 'neutral' },
    { value: ov.nodes?.ready || 0, label: '就绪节点', hint: '已准备好运行工作负载', kind: 'nodes', filter: 'Ready', tone: 'ok' },
    { value: pods.Running || 0, label: '运行中的 Pod', hint: '查看运行中的工作负载', kind: 'pods', filter: 'Running', tone: 'ok' },
    { value: pods.Pending || 0, label: '等待中的 Pod', hint: '检查调度或启动状态', kind: 'pods', filter: 'Pending', tone: 'warn' },
    { value: pods.Failed || 0, label: '失败的 Pod', hint: '检查故障工作负载', kind: 'pods', filter: 'Failed', tone: 'error' },
    { value: ov.namespaces || 0, label: '命名空间', hint: '查看资源隔离范围', kind: 'namespaces', filter: 'all', tone: 'neutral' },
  ]
  return React.createElement('div', { className: 'k8s-content' },
    React.createElement('div', { className: 'k8s-page-head' },
      React.createElement('div', { className: 'k8s-heading' },
        React.createElement('h2', null, '集群概览'),
        React.createElement('p', { className: 'k8s-subtitle' }, '快速了解集群状态，点击卡片查看对应资源。')
      ),
      ov.serverVersion && React.createElement('span', { className: 'k8s-badge neutral' }, ov.serverVersion)
    ),
    React.createElement('div', { className: 'k8s-stat-grid' }, cards.map(card =>
      React.createElement('button', {
        key: card.label, className: 'k8s-stat-card', type: 'button',
        onClick: () => loadKind(card.kind, card.filter),
      },
        React.createElement('span', { className: 'k8s-stat-label' }, card.label),
        React.createElement('strong', { className: 'k8s-stat-value k8s-status-' + card.tone }, card.value),
        React.createElement('span', { className: 'k8s-subtitle' }, card.hint)
      )
    )),
    React.createElement('div', { className: 'k8s-summary' },
      React.createElement('span', { className: 'k8s-badge ' + (pods.Pending || pods.Failed ? 'warn' : 'ok') },
        pods.Pending || pods.Failed ? '有待关注的工作负载' : '工作负载运行正常'),
      React.createElement('span', { className: 'k8s-subtitle' }, '点击刷新获取最新状态。')
    )
  )
}

function ResourceTable() {
  const s = useStore()
  if (s.tableLoading && !s.table) return React.createElement(EmptyState, { title: '正在读取资源…' })
  if (s.tableError) return React.createElement(EmptyState, { title: '无法读取资源', hint: s.tableError, error: true, retry: () => loadKind(s.view) })
  const { headers, rows } = parseResourceTable(s.table, s.items)
  const namespaces = ['all', ...Array.from(new Set(s.items.map(item => item.namespace).filter(Boolean))).sort()]
  const statuses = s.view === 'pods' ? ['Running', 'Pending', 'Failed', 'Succeeded', 'Unknown'] : s.view === 'nodes' ? ['Ready', 'NotReady'] : []
  const filtered = rows.filter(row => {
    const item = s.items[row.itemIndex]
    return (s.nsFilter === 'all' || item?.namespace === s.nsFilter) &&
      (s.statusFilter === 'all' || (s.view === 'nodes' ? (item?.ready ? 'Ready' : 'NotReady') : item?.phase) === s.statusFilter) &&
      (!s.filter || row.cells.join(' ').toLowerCase().includes(s.filter.toLowerCase()))
  })
  return React.createElement('div', { className: 'k8s-content' },
    React.createElement('div', { className: 'k8s-page-head' },
      React.createElement('div', { className: 'k8s-heading' },
        React.createElement('h2', null, KIND_LABEL[s.view] || s.view),
        React.createElement('p', { className: 'k8s-subtitle' }, '点击资源名称查看 YAML' + (s.view === 'pods' ? '、日志或进入终端。' : ' 和管理操作。'))
      ),
      React.createElement('span', { className: 'k8s-count' }, `${s.items.length} 个资源`)
    ),
    React.createElement('div', { className: 'k8s-toolbar' },
      namespaces.length > 1 && React.createElement('select', {
        className: 'k8s-select', 'aria-label': '筛选命名空间', value: s.nsFilter,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => set({ nsFilter: e.target.value }),
      }, namespaces.map(ns => React.createElement('option', { key: ns, value: ns }, ns === 'all' ? '全部命名空间' : ns))),
      statuses.length > 0 && React.createElement('select', {
        className: 'k8s-select-small', 'aria-label': s.view === 'pods' ? '筛选 Pod 阶段' : '筛选节点状态', value: s.statusFilter,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => set({ statusFilter: e.target.value }),
      }, ['all', ...statuses].map(status => React.createElement('option', { key: status, value: status }, status === 'all' ? (s.view === 'pods' ? '全部阶段' : '全部状态') : status))),
      React.createElement('div', { className: 'k8s-search' }, React.createElement('input', {
        className: 'k8s-filter', type: 'search', placeholder: '搜索资源名称、状态…',
        'aria-label': '搜索资源', value: s.filter,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ filter: e.target.value }),
      })),
      (s.filter || s.nsFilter !== 'all' || s.statusFilter !== 'all') && React.createElement('button', { className: 'k8s-btn', onClick: () => set({ filter: '', nsFilter: 'all', statusFilter: 'all' }) }, '清除筛选')
    ),
    React.createElement('div', { className: 'k8s-table-wrap' },
      React.createElement('div', { className: 'k8s-table-scroll' },
        React.createElement('table', { className: 'k8s-table', 'aria-label': KIND_LABEL[s.view] },
          React.createElement('thead', null, React.createElement('tr', null, headers.map(header => React.createElement('th', { key: header, scope: 'col' }, header)))),
          React.createElement('tbody', null, filtered.map(row => {
            const item = s.items[row.itemIndex]
            const active = item && s.detail?.name === item.name && s.detail.namespace === item.namespace
            return React.createElement('tr', { key: row.itemIndex >= 0 ? `${item.namespace}/${item.name}` : row.cells.join('|'), className: active ? 'active' : '' },
              row.cells.map((cell, index) => React.createElement('td', { key: index },
                headers[index] === 'NAME' && item ? React.createElement('button', { className: 'k8s-resource-name', onClick: () => loadDetail(s.view, row.itemIndex), title: item.name }, cell) :
                ['STATUS', 'READY'].includes(headers[index]) ? React.createElement('span', { className: 'k8s-badge ' + statusTone(cell) }, cell) : cell
              ))
            )
          }))
        ),
        filtered.length === 0 && React.createElement(EmptyState, { title: rows.length ? '没有匹配的资源' : '暂无资源', hint: rows.length ? '试试其他关键词或命名空间。' : '当前集群中没有此类资源。' })
      ),
      React.createElement('div', { className: 'k8s-table-footer' }, `显示 ${filtered.length} / ${rows.length} 个资源`)
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

  return React.createElement('section', { className: 'k8s-detail', 'aria-label': '资源详情' },
    React.createElement('div', { className: 'k8s-detail-head' },
      React.createElement('div', null,
        React.createElement('div', { className: 'k8s-title' }, d.name),
        React.createElement('div', { className: 'k8s-detail-meta' }, `${KIND_LABEL[d.kind]} · ${d.namespace || '集群级资源'}`),
        React.createElement('div', { className: 'k8s-tabs', role: 'tablist', 'aria-label': '资源详情视图' }, tabs.map((t) =>
          React.createElement('button', {
            key: t, className: 'k8s-tab ' + (d.tab === t ? 'active' : ''), role: 'tab', 'aria-selected': d.tab === t,
            onClick: () => set({ detail: { ...d, tab: t } })
          }, { yaml: 'YAML', logs: '日志', shell: '终端' }[t])
        ))
      ),
      React.createElement('div', { className: 'k8s-actions' },
        RESTARTABLE.includes(d.kind) ? React.createElement('button', { className: 'k8s-btn k8s-btn-warn', onClick: onRestart }, '重启') : null,
        SCALABLE.includes(d.kind) ? React.createElement('button', { className: 'k8s-btn', onClick: onScale }, '扩缩容') : null,
        React.createElement('button', { className: 'k8s-btn k8s-icon-btn', 'aria-label': '关闭资源详情', onClick: () => set({ detail: null }) }, '×')
      )
    ),
    React.createElement('div', { className: 'k8s-detail-body' },
      d.tab === 'yaml' ? React.createElement(YamlTab, { ...d, key: d.namespace + '/' + d.name }) : (d.tab === 'shell' ? React.createElement(ShellTab, { ...d, key: d.namespace + '/' + d.name }) : React.createElement(LogsTab, { ...d, key: d.namespace + '/' + d.name }))
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

  if (d.yamlLoading) return React.createElement('div', { className: 'k8s-empty' }, '正在读取 YAML…')
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
          React.createElement('button', { className: 'k8s-btn', onClick: () => setEditing(false), disabled: applying }, '取消'),
          React.createElement('button', { className: 'k8s-btn k8s-btn-primary', onClick: onApply, disabled: applying }, applying ? '正在应用…' : '应用修改')
        ) :
        React.createElement('button', { className: 'k8s-btn', onClick: () => setEditing(true) }, '编辑 YAML')
    ),
    editing ?
      React.createElement('div', { className: 'k8s-detail-scroll' },
        React.createElement('textarea', {
          className: 'k8s-textarea', 'aria-label': '编辑资源 YAML',
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
  const [starting, setStarting] = React.useState(false)
  const [error, setError] = React.useState('')
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const logSessionRef = React.useRef<string | null>(null)
  const mountedRef = React.useRef(true)
  const startingRef = React.useRef(false)
  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (logSessionRef.current) void call('logs/stop', { sessionId: logSessionRef.current }).catch(() => {})
      logSessionRef.current = null
    }
  }, [])

  React.useEffect(() => {
    let alive = true
    call('pod-containers', { context: state.current, namespace: d.namespace, pod: d.name }).then((r: any) => {
      if (!alive) return
      if (!r.ok) { setError(r.error || ''); return }
      const c = r.containers || []
      setContainers(c)
      if (c.length) setContainer(c[0])
    }).catch(e => { if (alive) setError(String(e?.message || e)) })
    return () => { alive = false }
  }, [d.name, d.namespace])

  React.useEffect(() => {
    if (!following || !sessionId) return
    let active = true
    let polling = false
    const iv = setInterval(() => {
      if (polling) return
      polling = true
      call('logs/poll', { sessionId }).then((r: any) => {
        if (!active) return
        if (!r.ok) { setError(r.error || '读取日志失败'); return }
        if (r.ok && r.delta) {
          setLines(prev => (prev + r.delta).slice(-1024 * 1024))
        }
      }).catch(e => { if (active) setError(String(e?.message || e)) }).finally(() => { polling = false })
    }, 1000)
    return () => { active = false; clearInterval(iv) }
  }, [following, sessionId])

  async function startFollow() {
    if (startingRef.current || logSessionRef.current || !container) return
    startingRef.current = true
    setStarting(true)
    setError('')
    try {
      const r = await call('logs/start', {
        context: state.current,
        namespace: d.namespace,
        pod: d.name,
        container,
      })
      if (!r.ok) { if (mountedRef.current) setError(r.error || '读取日志失败'); return }
      if (!mountedRef.current) { void call('logs/stop', { sessionId: r.sessionId }).catch(() => {}); return }
      logSessionRef.current = r.sessionId
      setSessionId(r.sessionId)
      setFollowing(true)
      setLines('')
    } catch (e: any) {
      if (mountedRef.current) setError(e?.message || String(e))
    } finally {
      startingRef.current = false
      if (mountedRef.current) setStarting(false)
    }
  }

  async function stopFollow() {
    const id = logSessionRef.current
    setFollowing(false)
    logSessionRef.current = null
    setSessionId(null)
    if (id) {
      try { await call('logs/stop', { sessionId: id }) }
      catch (e: any) { if (mountedRef.current) setError(e?.message || String(e)) }
    }
  }

  return React.createElement('div', { className: 'k8s-detail-panel' },
    React.createElement('div', { className: 'k8s-log-controls' },
      React.createElement('select', {
        className: 'k8s-select-small', 'aria-label': '选择容器', value: container,
        disabled: following || starting || !containers.length, onChange: (e: any) => { setContainer(e.target.value); setLines('') }
      }, containers.map((c) => React.createElement('option', { key: c, value: c }, c))),
      React.createElement('button', {
        className: 'k8s-btn ' + (following ? 'k8s-btn-primary' : ''),
        onClick: following ? stopFollow : startFollow, disabled: starting || !container
      }, starting ? '正在连接…' : following ? '停止跟随' : '跟随日志'),
      error ? React.createElement('span', { className: 'k8s-error', style: { fontSize: 12 } }, error) : null
    ),
    React.createElement('div', { className: 'k8s-detail-scroll' },
      React.createElement('pre', { className: 'k8s-logs' }, lines || '选择容器并点击“跟随日志”开始读取。')
    )
  )
}

function ShellTab(d: DetailState) {
  const [containers, setContainers] = React.useState<string[]>([])
  const [container, setContainer] = React.useState('')
  const [error, setError] = React.useState('')
  const [connected, setConnected] = React.useState(false)
  const [connecting, setConnecting] = React.useState(false)
  const termRef = React.useRef<HTMLDivElement>(null)
  const wsRef = React.useRef<WebSocket | null>(null)
  const disposeTerminal = React.useRef<(() => void) | null>(null)

  React.useEffect(() => {
    let alive = true
    call('pod-containers', { context: state.current, namespace: d.namespace, pod: d.name }).then((r: any) => {
      if (!alive) return
      if (!r.ok) { setError(r.error || ''); return }
      const c = r.containers || []
      setContainers(c)
      if (c.length) setContainer(c[0])
    }).catch(e => { if (alive) setError(String(e?.message || e)) })
    return () => { alive = false }
  }, [d.name, d.namespace])

  function cleanup() {
    const ws = wsRef.current
    wsRef.current = null
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
      ws.close()
    }
    disposeTerminal.current?.()
    disposeTerminal.current = null
  }

  function disconnect() {
    cleanup()
    setConnected(false)
    setConnecting(false)
  }

  function connect() {
    if (wsRef.current || !container) return
    cleanup()
    setError('')
    if (!termRef.current) return
    setConnecting(true)
    // Mount xterm into a manually created child so React won't clear it on re-render.
    const mount = document.createElement('div')
    mount.style.width = '100%'
    mount.style.height = '100%'
    mount.style.outline = 'none'
    mount.tabIndex = 0
    termRef.current.appendChild(mount)
    const term = new Terminal({ fontSize: 13, cursorBlink: true, allowTransparency: true, theme: { background: '#00000000' } })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(mount)
    let ws: WebSocket | undefined
    let ready = false
    let disposed = false
    let exitReason = ''
    const sendSize = () => {
      if (ready && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }
    const sizeListener = term.onResize(sendSize)
    const stopTheme = watchTerminalTheme(term, mount)
    fit.fit()
    const resize = new ResizeObserver(() => { if (!disposed && mount.isConnected) fit.fit() })
    resize.observe(mount)
    disposeTerminal.current = () => { disposed = true; ready = false; sizeListener.dispose(); stopTheme(); resize.disconnect(); term.dispose(); mount.remove() }
    term.write('正在连接容器…\r\n')
    term.focus()
    mount.addEventListener('click', () => term.focus())
    // Desktop loads a custom-scheme document; streams use the injected Host origin.
    const transport = (globalThis as typeof globalThis & {
      __DSH_TRANSPORT__?: { streamBaseUrl?: string }
    }).__DSH_TRANSPORT__
    const streamUrl = new URL('/dsh-k8s-manager/ws/shell', transport?.streamBaseUrl ?? document.baseURI)
    streamUrl.protocol = streamUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = streamUrl.href + '?' +
      `cluster=${encodeURIComponent(state.current)}` +
      `&namespace=${encodeURIComponent(d.namespace)}` +
      `&pod=${encodeURIComponent(d.name)}` +
      `&container=${encodeURIComponent(container)}` +
      `&protocol=2&cols=${term.cols}&rows=${term.rows}`
    ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws
    ws.onopen = () => { term.focus() }
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') { term.write(new Uint8Array(e.data)); return }
      let message: any
      try { message = JSON.parse(e.data) } catch { term.write(e.data); return }
      if (message.type === 'ready') {
        ready = true
        setConnecting(false)
        setConnected(true)
        fit.fit()
        sendSize()
        term.focus()
      } else if (message.type === 'output' && typeof message.data === 'string') {
        term.write(message.data)
      } else if (message.type === 'error') {
        ready = false
        setError(message.message || '终端启动失败')
        setConnecting(false)
        setConnected(false)
        term.write(`\r\n[${message.message || '终端启动失败'}]\r\n`)
      } else if (message.type === 'exit') {
        exitReason = `进程退出 ${message.code ?? message.signal ?? ''}`
      }
    }
    ws.onclose = (e: any) => { ready = false; wsRef.current = null; setConnecting(false); setConnected(false); term.write(`\r\n[${exitReason || '连接已断开 ' + e.code}]`) }
    ws.onerror = (e: any) => { setError('终端连接失败：' + (e?.message || '请检查容器状态和集群连接')); setConnecting(false); setConnected(false) }
    term.onData((data: string) => { if (ready && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data })) })
  }

  React.useEffect(() => {
    return () => {
      cleanup()
    }
  }, [])

  return React.createElement('div', { className: 'k8s-detail-panel' },
    React.createElement('div', { className: 'k8s-log-controls' },
      React.createElement('select', {
        className: 'k8s-select-small', 'aria-label': '选择容器', value: container,
        disabled: connected || connecting || !containers.length, onChange: (e: any) => setContainer(e.target.value)
      }, containers.map((c) => React.createElement('option', { key: c, value: c }, c))),
      React.createElement('button', { className: 'k8s-btn ' + (connected ? '' : 'k8s-btn-primary'), onClick: connected ? disconnect : connect, disabled: connecting || !container }, connecting ? '正在连接…' : connected ? '断开连接' : '连接终端'),
      connected && React.createElement('span', { className: 'k8s-badge ok' }, '已连接'),
      error ? React.createElement('span', { className: 'k8s-error', style: { fontSize: 12 } }, error) : null
    ),
    React.createElement('div', {
      ref: termRef,
      className: 'k8s-detail-scroll k8s-terminal'
    }, !connected && !connecting && !disposeTerminal.current && React.createElement('div', { className: 'k8s-terminal-placeholder' }, '选择容器并点击“连接终端”。'))
  )
}

function Workbench() {
  const s = useStore()
  const [showInput, setShowInput] = React.useState(false)
  const [yaml, setYaml] = React.useState('')
  const [clusterName, setClusterName] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [configs, setConfigs] = React.useState<string[]>([])
  const dialogRef = React.useRef<HTMLDialogElement>(null)
  React.useEffect(() => { if (showInput && !dialogRef.current?.open) dialogRef.current?.showModal() }, [showInput])
  React.useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !showInput) set({ detail: null }) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [showInput])

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
    React.createElement('header', { className: 'k8s-topbar' },
      React.createElement('div', { className: 'k8s-heading' },
        React.createElement('span', { className: 'k8s-title' }, icon('☸'), 'Kubernetes'),
        React.createElement('span', { className: 'k8s-subtitle' }, '集群与工作负载管理')
      ),
      React.createElement('label', { className: 'k8s-cluster-picker' },
        React.createElement('span', { className: 'k8s-subtitle' }, '当前集群'),
        React.createElement('select', { className: 'k8s-select', 'aria-label': '切换集群', value: s.current, disabled: !s.configs.length, onChange: onContextChange },
          !s.configs.length && React.createElement('option', { value: '' }, '尚未添加集群'),
          s.configs.map(c => React.createElement('option', { key: c, value: c }, c))
        )
      ),
      React.createElement('div', { className: 'k8s-actions' },
        React.createElement('button', {
          className: 'k8s-btn', disabled: s.boot !== 'ready' || s.overviewLoading || s.tableLoading,
          onClick: () => s.view === 'overview' ? loadOverview() : loadKind(s.view, s.statusFilter, true),
        }, s.overviewLoading || s.tableLoading ? '正在刷新…' : '刷新'),
        React.createElement('button', { className: 'k8s-btn k8s-btn-primary', onClick: () => setShowInput(true) }, '管理集群')
      )
    ),
    showInput ? React.createElement('dialog', { ref: dialogRef, className: 'k8s-config-overlay', 'aria-labelledby': 'k8s-config-title', onCancel: () => setShowInput(false) },
      React.createElement('div', { className: 'k8s-config-area', style: { maxHeight: '85vh' } },
        React.createElement('div', { className: 'k8s-config-heading' },
          React.createElement('div', { className: 'k8s-heading' },
            React.createElement('h2', { id: 'k8s-config-title' }, '管理集群'),
            React.createElement('p', { className: 'k8s-subtitle' }, '添加 kubeconfig，即可在不同集群间切换。')
          ),
          React.createElement('button', { className: 'k8s-btn k8s-icon-btn', 'aria-label': '关闭集群管理', onClick: () => setShowInput(false) }, '×')
        ),
        React.createElement('label', { className: 'k8s-field' }, '集群名称', React.createElement('input', {
          className: 'k8s-filter',
          style: { maxWidth: '100%' },
          'aria-label': '集群名称', autoFocus: true, placeholder: '集群名称，例如 staging 或 production',
          value: clusterName,
          onChange: (e: any) => setClusterName(e.target.value),
          disabled: saving,
        })),
        React.createElement('label', { className: 'k8s-field' }, 'kubeconfig', React.createElement('textarea', {
          className: 'k8s-textarea',
          style: { minHeight: 240 },
          'aria-label': '集群 kubeconfig 内容', value: yaml,
          onChange: (e: any) => setYaml(e.target.value),
          placeholder: 'apiVersion: v1\nkind: Config\n...',
          disabled: saving,
        })),
        configs.length > 0 ? React.createElement('div', { className: 'k8s-config-list' },
          React.createElement('div', { className: 'k8s-title', style: { fontSize: 13 } }, '已保存的集群'),
          configs.map((name) => React.createElement('div', {
            key: name,
            className: 'k8s-config-item',
          },
            React.createElement('span', null, name),
            React.createElement('button', { className: 'k8s-btn k8s-btn-warn', onClick: () => deleteConfig(name) }, '删除')
          ))
        ) : null,
        React.createElement('div', { className: 'k8s-config-actions' },
          React.createElement('button', { className: 'k8s-btn', onClick: () => setShowInput(false), disabled: saving }, '取消'),
          React.createElement('button', { className: 'k8s-btn k8s-btn-primary', onClick: saveKubeconfig, disabled: saving || !yaml.trim() }, saving ? '正在保存…' : '保存集群')
        )
      )
    ) : null,
    React.createElement('div', { className: 'k8s-body' },
      React.createElement('nav', { className: 'k8s-sidebar', 'aria-label': 'Kubernetes 资源类型' },
        TREE.map((g) =>
          React.createElement('div', { key: g.group },
            React.createElement('div', { className: 'k8s-tree-group' }, g.group),
            g.items.map(([key, label]) =>
              React.createElement('button', {
                key, type: 'button', 'aria-current': s.view === key ? 'page' : undefined, disabled: s.boot !== 'ready',
                className: 'k8s-tree-item ' + (s.view === key ? 'active' : ''),
                onClick: () => key === 'overview' ? loadOverview() : loadKind(key)
              }, label as string)
            )
          )
        )
      ),
      s.boot === 'no-kubectl' ? React.createElement('div', { className: 'k8s-main' }, React.createElement(EmptyState, { title: '未找到 kubectl', hint: '安装 kubectl 并确保 DSH 可以从 PATH 访问它。', retry: boot })) : null,
      s.boot === 'no-contexts' ? React.createElement('div', { className: 'k8s-main' }, React.createElement(EmptyState, { title: '添加您的第一个集群', hint: '点击右上角“管理集群”，粘贴 kubeconfig 开始使用。' })) : null,
      s.boot === 'error' ? React.createElement('div', { className: 'k8s-main' }, React.createElement(EmptyState, { title: '连接失败', hint: s.bootError, error: true, retry: boot })) : null,
      (s.boot === 'loading' || s.boot === 'idle') ? React.createElement('div', { className: 'k8s-main' }, React.createElement(EmptyState, { title: '正在连接集群…' })) : null,
      s.boot === 'ready' ? React.createElement('div', { className: 'k8s-main' }, s.view === 'overview' ? React.createElement(OverviewView) : React.createElement(ResourceTable)) : null,
      s.detail ? React.createElement(DetailDrawer) : null
    )
  )
}

export function apply(ctx: any) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  function K8sView() {
    React.useEffect(() => {
      if (state.boot === 'idle') boot()
    }, [])
    return React.createElement(Workbench)
  }

  function K8sPanel() {
    return React.createElement('div', { className: 'k8s-panel' }, React.createElement(K8sView))
  }

  function K8sPanelIcon({ size }: { size: number }) {
    return React.createElement('svg', {
      width: size, height: size, viewBox: '0 0 24 24',
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
      strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
    },
      React.createElement('path', { d: 'M12 2 20.7 7v10L12 22l-8.7-5V7Z' }),
      React.createElement('circle', { cx: 12, cy: 12, r: 3.5 }),
      React.createElement('path', { d: 'M12 5v3.5M12 15.5V19M5.9 8.5l3 1.75M15.1 13.75l3 1.75M5.9 15.5l3-1.75M15.1 10.25l3-1.75' }),
    )
  }

  // Sidebar owns the button and selection; the matching main key opens without a session.
  slots.inject('main', () => slots.register(
    { name: 'main', key: PANEL_ID }, K8sPanel
  ))
  slots.inject('sidebar.panellist', () => slots.register(
    { name: 'sidebar.panellist', id: PANEL_ID, label: 'Kubernetes', order: 1 }, K8sPanelIcon
  ))

  slots.inject('conversation.view', () => slots.register(
    { name: 'conversation.view', id: PANEL_ID, label: 'Kubernetes', order: 10 },
    () => React.createElement(K8sView)
  ))
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseResourceTable, statusTone } from '../src/client/resources.ts'

const item = (name, namespace = '') => ({ name, namespace, created: '' })

test('命名空间表按身份关联 JSON 项，不依赖两次 kubectl 查询的返回顺序', () => {
  const table = `NAMESPACE   NAME                 READY   STATUS             RESTARTS        AGE
default     web-app-7f6c8        1/1     Running            2 (6d3h ago)    20d
system      dns-7ffccd           0/1     ImagePullBackOff   0               9m
default     newly-created        0/1     Pending            0               1s
`
  const { headers, rows } = parseResourceTable(table, [item('dns-7ffccd', 'system'), item('web-app-7f6c8', 'default')])
  assert.deepEqual(headers, ['NAMESPACE', 'NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'])
  assert.deepEqual(rows, [
    { cells: ['default', 'web-app-7f6c8', '1/1', 'Running', '2 (6d3h ago)', '20d'], itemIndex: 1 },
    { cells: ['system', 'dns-7ffccd', '0/1', 'ImagePullBackOff', '0', '9m'], itemIndex: 0 },
    { cells: ['default', 'newly-created', '0/1', 'Pending', '0', '1s'], itemIndex: -1 },
  ])
})

test('跨命名空间重名资源不会打开错误的详情', () => {
  const table = `NAMESPACE   NAME   READY   STATUS    AGE
staging     api    1/1     Running   1d
prod        api    1/1     Running   9d`
  const { rows } = parseResourceTable(table, [item('api', 'prod'), item('api', 'staging')])
  assert.deepEqual(rows.map(row => row.itemIndex), [1, 0])
})

test('集群级表关联无命名空间资源，保留复合节点状态', () => {
  const table = `NAME                  STATUS                     ROLES           AGE   VERSION
node-worker-01        Ready                      <none>          45d   v1.34.0
node-control-plane    Ready,SchedulingDisabled   control-plane   45d   v1.34.0`
  const { headers, rows } = parseResourceTable(table, [item('node-control-plane'), item('node-worker-01')])
  assert.deepEqual(headers, ['NAME', 'STATUS', 'ROLES', 'AGE', 'VERSION'])
  assert.deepEqual(rows[1], {
    cells: ['node-control-plane', 'Ready,SchedulingDisabled', 'control-plane', '45d', 'v1.34.0'],
    itemIndex: 0,
  })
  assert.equal(rows[0].itemIndex, 1)
})

test('多词表头 LAST SEEN 与末列 MESSAGE 的空格完整保留', () => {
  const table = `LAST SEEN   TYPE      REASON      OBJECT        MESSAGE
12m         Warning   Failed      pod/api-123   Failed to pull image: registry is unavailable
3m          Normal    Scheduled   pod/api-123   Assigned  to node-worker-01`
  const { headers, rows } = parseResourceTable(table, [])
  assert.deepEqual(headers, ['LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE'])
  assert.deepEqual(rows[0].cells, ['12m', 'Warning', 'Failed', 'pod/api-123', 'Failed to pull image: registry is unavailable'])
  assert.equal(rows[1].cells[4], 'Assigned  to node-worker-01')
  assert.equal(rows[0].itemIndex, -1)
})

test('行长不一致时保持固定列数，末列不会丢失长值', () => {
  const table = `NAME       READY   STATUS    AGE
long-name  1/1     Running   123456789 days
short      0/1     Pending`
  const { rows } = parseResourceTable(table, [item('short'), item('long-name')])
  assert.deepEqual(rows, [
    { cells: ['long-name', '1/1', 'Running', '123456789 days'], itemIndex: 1 },
    { cells: ['short', '0/1', 'Pending', ''], itemIndex: 0 },
  ])
})

test('忽略空行，并兼容 Windows 换行与表头后空列表', () => {
  const { headers, rows } = parseResourceTable('\r\nNAME   STATUS\r\n\r\npod    Running\r\n', [item('pod')])
  assert.deepEqual(headers, ['NAME', 'STATUS'])
  assert.deepEqual(rows, [{ cells: ['pod', 'Running'], itemIndex: 0 }])
  assert.deepEqual(parseResourceTable('NAME   STATUS\n', []), { headers: ['NAME', 'STATUS'], rows: [] })
})

test('空输出与 kubectl 空列表提示不被误识别为表头', () => {
  for (const table of ['', '\n  \n', 'No resources found.\n', 'No resources found in default namespace.\n']) {
    assert.deepEqual(parseResourceTable(table, []), { headers: [], rows: [] })
  }
})

test('正常、异常与待关注状态显示不同状态色', () => {
  const statuses = {
    ok: ['Running', 'Active', 'Bound', 'Ready', 'Complete', 'Completed', 'Succeeded', ' running ', '1/1', '3/3', '0/0'],
    error: ['Failed', 'NotReady', 'CrashLoopBackOff', 'Init:CrashLoopBackOff', 'ErrImagePull', 'ImagePullBackOff', 'CreateContainerConfigError', 'Evicted', 'OOMKilled', 'InvalidImageName', 'OutOfcpu', 'OutOfmemory', 'Lost'],
    warn: ['Pending', 'Terminating', 'ContainerStatusUnknown', 'Waiting', 'ContainerCreating', 'PodInitializing', 'Init:0/2', 'Unschedulable', 'Ready,SchedulingDisabled', 'Released', '0/1', '2/3'],
    neutral: ['', '<none>', 'ClusterIP', 'custom-status'],
  }
  for (const [tone, values] of Object.entries(statuses)) {
    for (const value of values) assert.equal(statusTone(value), tone, value)
  }
})

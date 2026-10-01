import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { connectTerminal } from '../lib/terminal.js'

const options = {
  kubeconfig: '/tmp/k8s-fixtures/test.yaml',
  namespace: 'prod',
  pod: 'api-7f8c9',
  container: 'api',
  cols: 112,
  rows: 35,
  protocol: 'json',
}

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

class Socket extends EventEmitter {
  readyState = 1
  sent = []
  closures = []

  send(data) { this.sent.push(data) }
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return
    this.closures.push({ code, reason })
    this.readyState = 3
    this.emit('close', code, Buffer.from(reason))
  }
  message(value) { this.emit('message', Buffer.from(JSON.stringify(value))) }
  frames() {
    assert.ok(this.sent.every(data => typeof data === 'string'), '输出必须是文本 WebSocket 帧')
    return this.sent.map(data => JSON.parse(data))
  }
}

function terminal() {
  const done = deferred()
  const output = new PassThrough()
  const operations = []
  let terminations = 0
  return {
    output, operations, done: done.promise,
    exit: outcome => done.resolve(outcome),
    finish: outcome => { output.end(); done.resolve(outcome) },
    write: async data => { operations.push({ type: 'input', data }) },
    resize: async (cols, rows) => { operations.push({ type: 'resize', cols, rows }) },
    terminate: async () => {
      ++terminations
      output.end()
      done.resolve({ exitCode: null, signal: 'SIGTERM' })
    },
    get terminations() { return terminations },
  }
}

function harness(overrides = {}, terminalOptions = {}) {
  const ws = new Socket()
  const handle = terminal()
  const lookups = []
  const allocations = []
  const runtime = {
    async resolveExecutable(command, env, signal) {
      lookups.push({ command, env, signal })
      return '/opt/homebrew/bin/kubectl'
    },
    async spawnTerminal(spec) { allocations.push(spec); return handle },
    ...overrides,
  }
  const session = connectTerminal(ws, runtime, { ...options, ...terminalOptions })
  return { ws, handle, lookups, allocations, session }
}

test('终端经 DSH runtime 解析绝对 kubectl 路径，并仅显式传递所选 kubeconfig', async () => {
  const h = harness()
  await tick()
  try {
    assert.equal(h.lookups.length, 1)
    assert.equal(h.lookups[0].command, 'kubectl')
    assert.equal(h.lookups[0].env, undefined)
    const spec = h.allocations[0]
    assert.deepEqual(spec.argv, ['/opt/homebrew/bin/kubectl', 'exec', '-it', 'api-7f8c9', '-n', 'prod', '-c', 'api', '--', '/bin/sh'])
    assert.deepEqual(spec.env, { KUBECONFIG: options.kubeconfig })
    assert.equal(spec.cwd, process.cwd())
    assert.equal(spec.terminalType, 'xterm-256color')
    assert.equal(spec.cols, 112)
    assert.equal(spec.rows, 35)
    assert.equal(spec.graceMs, 1000)
    assert.equal(spec.signal, h.lookups[0].signal)
    assert.deepEqual(h.ws.frames(), [{ type: 'ready' }])
  } finally { h.ws.close(); await h.session }
  assert.equal(h.handle.terminations, 1)
})

test('真实 PTY 分配及初始尺寸同步完成前不会发送 ready', async () => {
  const allocation = deferred()
  const resizeFinished = deferred()
  const h = harness({ async spawnTerminal() { return allocation.promise } })
  h.handle.resize = async () => resizeFinished.promise
  await tick()
  assert.deepEqual(h.ws.sent, [])
  allocation.resolve(h.handle)
  await tick()
  assert.deepEqual(h.ws.sent, [], 'handle 已分配，但初始化未完成时仍不能标记 ready')
  resizeFinished.resolve()
  await tick()
  assert.deepEqual(h.ws.frames(), [{ type: 'ready' }])
  h.ws.close()
  await h.session
})

test('输入与窗口尺寸操作按 WebSocket 消息顺序执行', async () => {
  const h = harness()
  await tick()
  const writeFinished = deferred()
  h.handle.write = async data => {
    h.handle.operations.push({ type: 'input', data })
    if (data === 'first\r') await writeFinished.promise
  }
  try {
    h.ws.message({ type: 'input', data: 'first\r' })
    h.ws.message({ type: 'resize', cols: 140, rows: 42 })
    h.ws.message({ type: 'input', data: '\u0003second\r' })
    await tick()
    assert.deepEqual(h.handle.operations, [
      { type: 'resize', cols: 112, rows: 35 },
      { type: 'input', data: 'first\r' },
    ], '后续 resize/input 不能越过尚未完成的输入')
    writeFinished.resolve()
    await tick()
    assert.deepEqual(h.handle.operations.slice(1), [
      { type: 'input', data: 'first\r' },
      { type: 'resize', cols: 140, rows: 42 },
      { type: 'input', data: '\u0003second\r' },
    ])
  } finally { writeFinished.resolve(); h.ws.close(); await h.session }
})

test('PTY UTF-8 分片输出正确拼接为 JSON 文本帧，退出前排空输出', async () => {
  const h = harness()
  await tick()
  const bytes = Buffer.from('提示符：你好 ☸\r\n')
  h.handle.output.write(bytes.subarray(0, 2))
  h.handle.output.write(bytes.subarray(2, 7))
  h.handle.output.write(bytes.subarray(7, bytes.length - 1))
  h.handle.output.write(bytes.subarray(bytes.length - 1))
  h.handle.finish({ exitCode: 0, signal: null })
  await h.session
  const frames = h.ws.frames()
  assert.equal(frames.filter(frame => frame.type === 'output').map(frame => frame.data).join(''), '提示符：你好 ☸\r\n')
  assert.deepEqual(frames.at(-1), { type: 'exit', code: 0, signal: null })
  assert.deepEqual(h.ws.closures, [{ code: 1000, reason: 'exit 0' }])
  assert.equal(h.handle.terminations, 1)
})

test('done 先于末尾输出到达时，仍先发送所有输出再发送 exit', async () => {
  const h = harness()
  await tick()
  h.handle.exit({ exitCode: 0, signal: null })
  await tick()
  assert.equal(h.ws.frames().some(frame => frame.type === 'exit'), false)
  assert.equal(h.ws.readyState, 1)
  h.handle.output.end(Buffer.from('最后一行\r\n'))
  await h.session
  const frames = h.ws.frames()
  assert.deepEqual(frames.slice(-2), [
    { type: 'output', data: '最后一行\r\n' },
    { type: 'exit', code: 0, signal: null },
  ])
})

test('兼容 raw 协议时输出仍为文本，回车及控制键原样交给真实 PTY', async () => {
  const h = harness({}, { protocol: 'raw', container: undefined })
  await tick()
  try {
    h.ws.emit('message', Buffer.from('pwd\r\u0003'))
    h.handle.output.write(Buffer.from('shell prompt # '))
    await tick()
    assert.deepEqual(h.handle.operations.at(-1), { type: 'input', data: 'pwd\r\u0003' })
    assert.deepEqual(h.ws.sent, ['shell prompt # '])
    assert.equal(h.allocations[0].argv.includes('-c'), false)
  } finally { h.ws.close(); await h.session }
})

test('PTY 启动失败发送明确错误并关闭连接，不再静默降级为管道 shell', async () => {
  const h = harness({ async spawnTerminal() { throw new Error('posix_spawnp failed') } })
  await h.session
  assert.deepEqual(h.ws.frames(), [{ type: 'error', message: 'posix_spawnp failed' }])
  assert.deepEqual(h.ws.closures, [{ code: 1011, reason: 'terminal failed' }])
  assert.equal(h.ws.listenerCount('message'), 0)
  assert.equal(h.ws.listenerCount('close'), 0)
})

test('连接在分配 PTY 期间关闭会取消启动，并清理迟到的终端句柄', async () => {
  const allocation = deferred()
  let allocationSignal
  const h = harness({ async spawnTerminal(spec) { allocationSignal = spec.signal; return allocation.promise } })
  await tick()
  h.ws.close()
  assert.equal(allocationSignal.aborted, true)
  allocation.resolve(h.handle)
  await h.session
  assert.equal(h.handle.terminations, 1)
  assert.deepEqual(h.ws.sent, [])
  assert.deepEqual(h.handle.operations, [])
})

test('连接在 kubectl 路径解析期间关闭后，不再分配 PTY', async () => {
  const lookup = deferred()
  let lookupSignal
  const h = harness({ async resolveExecutable(command, env, signal) { lookupSignal = signal; return lookup.promise } })
  h.ws.close()
  assert.equal(lookupSignal.aborted, true)
  lookup.resolve('/opt/homebrew/bin/kubectl')
  await h.session
  assert.equal(h.allocations.length, 0)
  assert.deepEqual(h.ws.sent, [])
})

test('页面关闭会等待终端 terminate 完成，并移除消息监听器', async () => {
  const h = harness()
  await tick()
  const termination = deferred()
  let calls = 0
  h.handle.terminate = () => { ++calls; return termination.promise }
  let settled = false
  void h.session.then(() => { settled = true })
  h.ws.close()
  await tick()
  assert.equal(calls, 1)
  assert.equal(settled, false)
  assert.equal(h.ws.listenerCount('message'), 0)
  const sentBefore = h.ws.sent.length
  const operationsBefore = h.handle.operations.length
  h.ws.message({ type: 'input', data: 'ignored\r' })
  h.handle.output.write(Buffer.from('已关闭页面不能再收到输出'))
  await tick()
  assert.equal(h.ws.sent.length, sentBefore)
  assert.equal(h.handle.operations.length, operationsBefore)
  termination.resolve()
  await h.session
  assert.equal(settled, true)
})

test('插件卸载 signal 同时关闭连接并清理托管终端', async () => {
  const controller = new AbortController()
  const h = harness({}, { signal: controller.signal })
  await tick()
  controller.abort()
  await h.session
  assert.equal(h.handle.terminations, 1)
  assert.equal(h.lookups[0].signal.aborted, true)
  assert.deepEqual(h.ws.closures, [{ code: 1001, reason: 'plugin unloaded' }])
  assert.equal(h.ws.frames().some(frame => frame.type === 'error'), false)
})

test('终端运行期失败有错误帧，关闭连接并清理句柄', async () => {
  const h = harness()
  await tick()
  h.handle.output.destroy(new Error('terminal transport lost'))
  await h.session
  assert.deepEqual(h.ws.frames().at(-1), { type: 'error', message: 'terminal transport lost' })
  assert.deepEqual(h.ws.closures, [{ code: 1011, reason: 'terminal failed' }])
  assert.equal(h.handle.terminations, 1)
})

test('终端输入写入失败会发送错误、结束会话并清理句柄', async () => {
  const h = harness()
  await tick()
  h.handle.write = async () => { throw new Error('terminal input unavailable') }
  h.ws.message({ type: 'input', data: 'pwd\r' })
  await h.session
  assert.deepEqual(h.ws.frames().at(-1), { type: 'error', message: 'terminal input unavailable' })
  assert.deepEqual(h.ws.closures, [{ code: 1011, reason: 'terminal failed' }])
  assert.equal(h.handle.terminations, 1)
})

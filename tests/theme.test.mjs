import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// 只转译无副作用的 helper，无需运行客户端或连接 Kubernetes。
const source = readFileSync(new URL('../src/client/theme.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
const { createTerminalTheme, watchTerminalTheme } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('terminal uses host semantic colors and preserves translucent selection', () => {
  const palette = {
    foreground: '#eeeeeeff', surface: '#22222280', secondary: '#aaaaaaff', muted: '#777777ff',
    accent: '#112233ff', error: '#cc2222ff', success: '#22cc22ff', warning: '#ddaa22ff', selection: '#11223366',
  }
  const theme = createTerminalTheme(palette)
  assert.equal(theme.background, '#00000000')
  assert.equal(theme.cursor, palette.foreground)
  assert.equal(theme.cursorAccent, palette.surface)
  assert.equal(theme.selectionBackground, palette.selection)
  assert.equal(theme.selectionInactiveBackground, palette.selection)
  assert.equal(theme.red, palette.error)
  assert.equal(theme.brightRed, palette.error)
  assert.equal(theme.green, palette.success)
  assert.equal(theme.yellow, palette.warning)
  assert.equal(theme.blue, palette.accent)
  assert.equal(theme.white, palette.foreground)
})

function browserHarness() {
  const frames = new Map()
  let nextFrame = 0
  const observers = []
  const media = []
  const listeners = new Map()
  const tokens = new Map([
    ['--dsw-alias-label-primary', '#eeeeee'], ['--dsw-alias-bg-base', '#222222'],
    ['--dsw-alias-bg-document-selection', '#11223366'],
  ])
  const node = tagName => ({
    nodeType: 1, tagName, style: { color: '', cssText: '' }, parentNode: null, parentElement: null,
    setAttribute() {}, remove() { this.removed = true }, appendChild(child) { this.child = child },
  })
  const html = node('HTML')
  const body = node('BODY')
  const head = node('HEAD')
  const element = node('DIV')
  body.parentElement = html
  element.parentElement = body
  head.addEventListener = (type, callback) => listeners.set(type, callback)
  head.removeEventListener = type => listeners.delete(type)
  const view = {
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.nodes = []; observers.push(this) }
      observe(node, options) { this.nodes.push({ node, options }) }
      disconnect() { this.disconnected = true }
    },
    getComputedStyle: target => ({
      color: target.tagName === 'SPAN' ? target.style.color : '#eeeeee',
      backgroundColor: '#222222',
      getPropertyValue: name => tokens.get(name) ?? '',
    }),
    requestAnimationFrame: callback => { const id = ++nextFrame; frames.set(id, callback); return id },
    cancelAnimationFrame: id => frames.delete(id),
    matchMedia(query) {
      const result = {
        query,
        addEventListener(type, callback) { this.callback = callback },
        removeEventListener() { this.callback = undefined },
      }
      media.push(result)
      return result
    },
  }
  const context = {
    fillStyle: '', clearRect() {}, fillRect() {},
    getImageData() {
      const hex = this.fillStyle.slice(1).padEnd(8, 'f')
      return { data: Uint8ClampedArray.from([0, 2, 4, 6], offset => parseInt(hex.slice(offset, offset + 2), 16)) }
    },
  }
  const document = {
    defaultView: view, body, head,
    createElement: name => name === 'canvas' ? { getContext: () => context } : node('SPAN'),
  }
  element.ownerDocument = document
  const updates = []
  const terminal = { options: { set theme(value) { updates.push(value) } } }
  return { terminal, element, tokens, updates, observers, frames, media, listeners, flush: () => { const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback()) } }
}

test('terminal follows host palette changes, batches invalidations and releases observers on unmount', () => {
  const host = browserHarness()
  const dispose = watchTerminalTheme(host.terminal, host.element)
  assert.equal(host.updates.length, 1)
  assert.equal(host.updates[0].selectionBackground, '#11223366')
  // 仅观察祖先的属性，终端不断输出文本不会产生主题重算。
  assert.equal(host.observers[0].nodes.length, 3)
  assert.equal(host.observers[0].nodes[0].options.subtree, undefined)
  host.tokens.set('--dsw-alias-label-primary', '#111111')
  host.observers[0].callback([{ attributeName: 'style' }])
  host.observers[0].callback([{ attributeName: 'data-ds-dark-theme' }])
  host.media[0].callback()
  assert.equal(host.frames.size, 1)
  host.flush()
  assert.equal(host.updates.at(-1).foreground, '#111111ff')
  assert.equal(host.updates.at(-1).background, '#00000000')
  // 无颜色变化时不重新设置 xterm 主题。
  host.listeners.get('load')()
  host.flush()
  assert.equal(host.updates.length, 2)
  host.tokens.set('--dsw-alias-state-business-primary', '#abcdef')
  host.observers[1].callback([{ target: { nodeType: 1, tagName: 'STYLE' }, addedNodes: [], removedNodes: [] }])
  host.flush()
  assert.equal(host.updates.at(-1).blue, '#abcdefff')
  host.media[0].callback()
  dispose()
  assert.equal(host.frames.size, 0)
  assert.ok(host.observers.every(observer => observer.disconnected))
  assert.ok(host.media.every(query => query.callback === undefined))
  assert.equal(host.listeners.size, 0)
  assert.equal(host.element.child.removed, true)
})

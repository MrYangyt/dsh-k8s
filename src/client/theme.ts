import type { ITheme, Terminal } from '@xterm/xterm'

/** 已解析的宿主语义色；不存储或修改 DSH 的主题配置。 */
export interface TerminalThemeColors {
  foreground: string
  surface: string
  secondary: string
  muted: string
  accent: string
  error: string
  success: string
  warning: string
  selection: string
}

/** 透明终端沿用页面背景，ANSI 状态色沿用宿主的语义色。 */
export function createTerminalTheme(colors: TerminalThemeColors): ITheme {
  return {
    background: '#00000000',
    foreground: colors.foreground,
    cursor: colors.foreground,
    cursorAccent: colors.surface,
    selectionBackground: colors.selection,
    selectionInactiveBackground: colors.selection,
    black: colors.secondary,
    brightBlack: colors.muted,
    white: colors.foreground,
    brightWhite: colors.foreground,
    red: colors.error,
    brightRed: colors.error,
    green: colors.success,
    brightGreen: colors.success,
    yellow: colors.warning,
    brightYellow: colors.warning,
    blue: colors.accent,
    brightBlue: colors.accent,
    magenta: colors.accent,
    brightMagenta: colors.accent,
    cyan: colors.success,
    brightCyan: colors.success,
  }
}

/**
 * 跟随 DSH 及主题插件最终生效的 CSS，包括局部覆盖和透明颜色。
 * rc.2 的 theme/change 会由宿主 presenter 写入 body 的 token 和主题属性；
 * 只观察祖先属性和 head 样式，避免监视终端输出的整个 DOM 子树。
 */
export function watchTerminalTheme(terminal: Terminal, element: HTMLElement): () => void {
  const document = element.ownerDocument
  const view = document.defaultView
  if (!view) return () => {}

  // 浏览器先解析变量和 color-mix，再将现代 CSS 色规范化为 xterm 支持的 RGBA。
  // 探针仅位于插件自己的容器，不写入宿主 body/root/style sheet。
  const probe = document.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'all: initial; position: absolute; visibility: hidden; pointer-events: none; width: 0; height: 0; overflow: hidden;'
  element.appendChild(probe)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })

  const resolveColor = (value: string, fallback: string): string => {
    probe.style.color = ''
    probe.style.color = value.trim()
    if (!probe.style.color) return fallback
    const resolved = view.getComputedStyle(probe).color
    if (!context) return resolved || fallback
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = resolved
    context.fillRect(0, 0, 1, 1)
    const rgba = context.getImageData(0, 0, 1, 1).data
    return `#${Array.from(rgba, channel => channel.toString(16).padStart(2, '0')).join('')}`
  }

  let lastTheme = ''
  let frame: number | undefined
  let disposed = false
  const update = () => {
    frame = undefined
    if (disposed) return
    const style = view.getComputedStyle(element)
    const token = (name: string, fallback: string) => resolveColor(style.getPropertyValue(name), fallback)
    const foreground = token('--dsw-alias-label-primary', resolveColor(style.color, '#202124'))
    const surface = token('--dsw-alias-bg-base', resolveColor(view.getComputedStyle(document.body).backgroundColor, '#ffffff'))
    const secondary = token('--dsw-alias-label-secondary', foreground)
    const accent = token('--dsw-alias-state-business-primary', foreground)
    const theme = createTerminalTheme({
      foreground,
      surface,
      secondary,
      muted: token('--dsw-alias-label-tertiary', secondary),
      accent,
      error: token('--dsw-alias-state-error-primary', foreground),
      success: token('--dsw-alias-state-success-primary', foreground),
      warning: token('--dsw-alias-state-warn-label', token('--dsw-alias-state-warn-primary', foreground)),
      selection: token('--dsw-alias-bg-document-selection', accent),
    })
    const signature = JSON.stringify(theme)
    if (signature !== lastTheme) {
      lastTheme = signature
      terminal.options.theme = theme
    }
  }
  const schedule = () => {
    if (!disposed && frame === undefined) frame = view.requestAnimationFrame(update)
  }

  const ancestors = new view.MutationObserver(records => {
    if (records.some(record => record.attributeName === 'class' || record.attributeName === 'style' || record.attributeName?.startsWith('data-'))) schedule()
  })
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    ancestors.observe(node, { attributes: true })
  }

  const isStylesheet = (node: Node | null) => node?.nodeType === 1 && ['STYLE', 'LINK'].includes((node as Element).tagName)
  const stylesheets = new view.MutationObserver(records => {
    if (records.some(record => isStylesheet(record.target) || isStylesheet(record.target.parentNode) || Array.from(record.addedNodes).concat(Array.from(record.removedNodes)).some(isStylesheet))) schedule()
  })
  stylesheets.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['href', 'media', 'disabled', 'rel'],
  })
  document.head.addEventListener('load', schedule, true)
  const media = ['(prefers-color-scheme: dark)', '(prefers-reduced-transparency: reduce)'].map(query => view.matchMedia(query))
  media.forEach(query => query.addEventListener('change', schedule))
  update()

  return () => {
    disposed = true
    ancestors.disconnect()
    stylesheets.disconnect()
    document.head.removeEventListener('load', schedule, true)
    media.forEach(query => query.removeEventListener('change', schedule))
    if (frame !== undefined) view.cancelAnimationFrame(frame)
    probe.remove()
  }
}

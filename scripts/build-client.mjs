#!/usr/bin/env node
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const input = '.tsdown-output/index.cjs'
const styleInput = '.tsdown-output/style.css'
const output = 'client/client.js'

const bundle = readFileSync(input, 'utf8')
let css = ''
try {
  css = readFileSync(styleInput, 'utf8')
} catch (e) {}

const cssInject = css
  ? `const applyClient = module.exports.apply;
    module.exports.apply = (ctx, ...args) => {
      ctx.effect(() => {
        const style = document.createElement('style');
        style.textContent = ${JSON.stringify(css)};
        document.head.appendChild(style);
        return () => style.remove();
      }, 'k8s-manager.styles');
      return applyClient(ctx, ...args);
    };`
  : ''

const wrapped = `window.__ModuleLoader__.load({
  id: "dsh-k8s-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    ${bundle}
    ${cssInject}
    return module.exports;
  }
});
`

mkdirSync('client', { recursive: true })
writeFileSync(output, wrapped)

// clean up
rmSync('.tsdown-output', { recursive: true, force: true })

console.log('client/client.js written')

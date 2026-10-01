export interface ResourceItem { name: string; namespace: string; created: string }
export interface ResourceRow { cells: string[]; itemIndex: number }

/** kubectl aligns fields at header offsets, including headers such as LAST SEEN. */
export function parseResourceTable(table: string, items: ResourceItem[]) {
  const lines = table.split(/\r?\n/).filter(line => line.trim())
  // Some kubectl versions print the empty-list message on stdout rather than stderr.
  if (!lines.length || /^No resources found(?:[.\s]|$)/i.test(lines[0].trim())) {
    return { headers: [], rows: [] as ResourceRow[] }
  }
  const columns = Array.from((lines[0] || '').matchAll(/\S.*?(?=\s{2,}|$)/g))
  const headers = columns.map(column => column[0])
  const nameColumn = headers.indexOf('NAME')
  const namespaceColumn = headers.indexOf('NAMESPACE')
  const itemLookup = new Map(items.map((item, index) => [`${item.namespace}/${item.name}`, index]))
  const rows = lines.slice(1).map(line => {
    const cells = columns.map((column, index) => line.slice(column.index, columns[index + 1]?.index).trim())
    const namespace = namespaceColumn < 0 ? '' : cells[namespaceColumn]
    const itemIndex = itemLookup.get(`${namespace}/${cells[nameColumn]}`) ?? -1
    return { cells, itemIndex }
  })
  return { headers, rows }
}

export function statusTone(value: string): 'ok' | 'warn' | 'error' | 'neutral' {
  const status = value.trim()
  if (/(failed|error|errimagepull|crash|backoff|notready|evicted|oomkilled|invalidimagename|outofcpu|outofmemory|^lost$)/i.test(status)) return 'error'
  if (/(pending|terminating|unknown|waiting|creating|initializing|init:|unschedulable|schedulingdisabled|^released$)/i.test(status)) return 'warn'
  if (/^(running|active|bound|ready|complete|completed|succeeded)$/i.test(status)) return 'ok'
  const ready = /^(\d+)\/(\d+)$/.exec(status)
  if (ready) return Number(ready[1]) === Number(ready[2]) ? 'ok' : 'warn'
  return 'neutral'
}

/** Mounts the harness meta panel into its own React root (DEV ONLY). */
import { createRoot } from 'react-dom/client'
import { MetaPanel, META_PANEL_CSS, type MetaPanelOptions } from './MetaPanel'

let mounted = false

export function mountMetaPanel(options: MetaPanelOptions): void {
  if (mounted || typeof document === 'undefined') return
  mounted = true
  const host = document.createElement('div')
  host.id = 'edugames-harness'
  document.body.appendChild(host)
  const style = document.createElement('style')
  style.textContent = META_PANEL_CSS
  document.head.appendChild(style)
  createRoot(host).render(<MetaPanel {...options} />)
}

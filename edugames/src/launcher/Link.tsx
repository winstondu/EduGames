import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { navigate } from './nav'

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; replace?: boolean }

/** `<a>` that navigates in-app on plain left clicks (modifier clicks still open new tabs). */
export function Link({ href, replace, onClick, ...rest }: LinkProps) {
  function handle(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(href, { replace })
  }
  return <a href={href} onClick={handle} {...rest} />
}

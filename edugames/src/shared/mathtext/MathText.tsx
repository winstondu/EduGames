/**
 * Inline HTML rendering of `$…$` math text for banners, buttons and lists.
 * Inherits font, size and colour from its parent; fractions stack, scripts
 * shift, radicals get an overline. Each math span is announced to screen
 * readers as its plain-text form ("4x + 6x", "3/4").
 */
import { memo, useMemo, type CSSProperties, type ReactNode } from 'react'
import { parseMathText, toPlainText, type MathNode } from './parse'

export interface MathTextProps {
  /** Text with optional inline `$…$` math. */
  text: string
  className?: string
  style?: CSSProperties
}

const S = {
  math: { whiteSpace: 'nowrap' },
  var: { fontStyle: 'italic', paddingRight: '0.04em' },
  sup: { fontSize: '0.7em', verticalAlign: '0.5em', lineHeight: 0 },
  sub: { fontSize: '0.7em', verticalAlign: '-0.25em', lineHeight: 0 },
  frac: {
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    verticalAlign: 'middle',
    textAlign: 'center',
    fontSize: '0.82em',
    lineHeight: 1.1,
    margin: '0 0.1em',
  },
  num: { borderBottom: '0.08em solid currentColor', padding: '0 0.1em 0.04em' },
  den: { padding: '0.04em 0.1em 0' },
  sqrt: { display: 'inline-flex', alignItems: 'baseline', whiteSpace: 'nowrap' },
  radical: { fontStyle: 'normal', paddingRight: '0.02em' },
  radicand: { borderTop: '0.08em solid currentColor', padding: '0.06em 0.08em 0', lineHeight: 1.1 },
  index: { fontSize: '0.5em', verticalAlign: '0.9em', marginRight: '-0.35em', lineHeight: 0 },
} satisfies Record<string, CSSProperties>

const SPACING: Partial<Record<string, CSSProperties>> = {
  bin: { margin: '0 0.22em' },
  rel: { margin: '0 0.28em' },
  punct: { marginRight: '0.17em' },
}

function renderList(nodes: readonly MathNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
      case 'num':
        return <span key={i}>{node.text}</span>
      case 'var':
        return <i key={i} style={S.var}>{node.text}</i>
      case 'op':
        return <span key={i} style={SPACING[node.kind]}>{node.text}</span>
      case 'space':
        return <span key={i} style={{ marginRight: `${node.em}em` }} />
      case 'sup':
        return <span key={i} style={S.sup}>{renderList(node.children)}</span>
      case 'sub':
        return <span key={i} style={S.sub}>{renderList(node.children)}</span>
      case 'frac':
        return (
          <span key={i} style={S.frac}>
            <span style={S.num}>{renderList(node.num)}</span>
            <span style={S.den}>{renderList(node.den)}</span>
          </span>
        )
      case 'sqrt':
        return (
          <span key={i} style={S.sqrt}>
            {node.index && <span style={S.index}>{renderList(node.index)}</span>}
            <span style={S.radical}>√</span>
            <span style={S.radicand}>{renderList(node.children)}</span>
          </span>
        )
    }
  })
}

export const MathText = memo(function MathText({ text, className, style }: MathTextProps) {
  const content = useMemo(
    () =>
      parseMathText(text).map((node, i) =>
        node.type === 'text' ? (
          <span key={i}>{node.text}</span>
        ) : (
          <span key={i} role="img" aria-label={toPlainText(node.children).trim()} style={S.math}>
            <span aria-hidden="true">{renderList(node.children)}</span>
          </span>
        ),
      ),
    [text],
  )
  return (
    <span className={className} style={style}>
      {content}
    </span>
  )
})

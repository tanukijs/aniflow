import type { ReactNode } from 'react'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
      {children}
    </section>
  )
}

export function ChipGroup<T extends string>({
  values,
  selected,
  onToggle,
}: {
  values: T[]
  selected: T[]
  onToggle: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => {
        const isOn = selected.includes(v)
        return (
          <button
            key={v}
            type="button"
            onClick={() => {
              onToggle(v)
            }}
            className={
              'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ' +
              (isOn
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200')
            }
          >
            {v}
          </button>
        )
      })}
    </div>
  )
}

export function SegmentedGroup<T extends string>({
  values,
  selected,
  onChange,
}: {
  values: T[]
  selected: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => {
            onChange(v)
          }}
          className={
            'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ' +
            (selected === v
              ? 'bg-blue-600 text-white hover:bg-blue-500'
              : 'bg-slate-100 text-slate-500 hover:bg-slate-200')
          }
        >
          {v}
        </button>
      ))}
    </div>
  )
}

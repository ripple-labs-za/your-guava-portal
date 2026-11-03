import { Link } from 'react-router'

export function CafeSetupPrompt({ locationSet, hoursSet }: { locationSet: boolean; hoursSet: boolean }) {
  if (locationSet && hoursSet) return null
  return (
    <section aria-label="Cafe setup" className="mb-6 rounded-xl border border-guava-green/30 bg-guava-green/5 p-5">
      <h2 className="text-text text-base font-semibold">Finish setting up your cafe</h2>
      <p className="text-muted text-sm mt-1">Set your location and trading hours so forecasts reflect where and when you trade.</p>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        {!locationSet && <Link className="text-guava-green underline underline-offset-2" to="/settings?section=general">Set cafe location</Link>}
        {!hoursSet && <Link className="text-guava-green underline underline-offset-2" to="/settings?section=general">Set trading hours</Link>}
      </div>
    </section>
  )
}
